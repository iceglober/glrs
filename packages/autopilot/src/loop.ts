/**
 * Ralph loop engine for the autopilot CLI driver.
 *
 * Sends the user's prompt to PRIME each iteration, waits for idle,
 * inspects the response for the `<autopilot-done>` sentinel, and either
 * exits (sentinel found) or re-sends the same prompt (no sentinel).
 *
 * The loop respects:
 *   - max-iterations budget
 *   - total timeout budget
 *   - per-iteration stall timeout (inherited from sendAndWait)
 *   - struggle detection (consecutive zero-progress iterations)
 *   - kill-switch file at `.agent/autopilot-disable`
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAutopilotLogger, childLogger, type AutopilotLogger } from "./lib/logger.js";
import type { AgentAdapter, AgentHandle } from "./adapter.js";
import { createStatusHeartbeat } from "./status.js";
import type { SessionEventEmitter } from "./session-runner.js";
import { parsePlanState } from "./plan-parser.js";
import { parseItems } from "./plan-parser.js";
import {
  getChangedFiles,
  validateScope,
} from "./scope-validator.js";
import { detectSentinel } from "./sentinel.js";
import { StruggleDetector, checkKillSwitch } from "./struggle.js";
import { notifyWebhook, type WebhookEvent } from "./lib/webhook-notifier.js";
import { estimateCost } from "./lib/model-pricing.js";
import {
  MAX_ITERATIONS,
  STRUGGLE_THRESHOLD,
  TIMEOUT_MS,
  STALL_MS,
  STALL_MS_BY_TIER,
  STATUS_INTERVAL_MS,
  MAX_ITERATIONS_PER_ITEM,
} from "./config.js";
import { classifyError } from "./lib/error-classifier.js";
import { detectProvider } from "./lib/credential-refresh.js";
import { writeCheckpoint } from "./checkpoint.js";

/**
 * Retry budget for transient errors per iteration.
 * 1s, 2s, 4s backoff (max 30s cap).
 */
const TRANSIENT_RETRY_MAX_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_MS = 1000;
const TRANSIENT_RETRY_MAX_MS = 30_000;

const execFile = promisify(execFileCb);

export type LoopExitReason =
  | "sentinel"
  | "max-iterations"
  | "timeout"
  | "struggle"
  | "kill-switch"
  | "stall"
  | "error"
  | "aborted";

export interface LoopResult {
  exitReason: LoopExitReason;
  iterations: number;
  message: string;
  /** The OpenCode session ID for the loop session. Used by the debrief module. */
  sessionId?: string;
  /** Cumulative cost in USD for the loop session. Used by the debrief module. */
  cumulativeCostUsd?: number;
  /**
   * Per-phase cost breakdown for multi-phase plans.
   * Populated by the multi-phase runner (loop-session.ts) when available.
   */
  phaseBreakdown?: Array<{
    phaseFile: string;
    iterations: number;
    costUsd: number;
  }>;
  /**
   * Per-lane cost breakdown for parallel-lane runs (item 3.5).
   * Populated by `loop-session.ts` only when `--parallel > 1` produced
   * a real parallel run. `Map<laneId, costUsd>`. Optional to preserve
   * backward compatibility for callers that never enabled parallelism.
   */
  laneCosts?: Map<string, number>;
  /**
   * Surviving worktree paths from a partially-failed parallel run
   * (item 3.6). When a lane's merge failed, its worktree is left on
   * disk and the path is reported here so the user can manually
   * `git worktree remove --force <path>`. Empty/undefined on clean runs.
   */
  orphanedWorktrees?: string[];
  /**
   * Per-phase verify-command results from the post-phase test gate
   * (item 4.1). Populated by `loop-session.ts` after each phase runs
   * its `verify:` commands (one per plan-state item). When any verify
   * command fails the phase is treated as incomplete (its main.md
   * checkbox is NOT marked) and the failures are surfaced here so the
   * debrief can render a results table. Optional to preserve back-
   * compat for callers that never enabled verify gating.
   */
  verifyResults?: Array<{
    phaseFile: string;
    results: import("./verify-runner.js").VerifyResult[];
  }>;
  /**
   * Path to the changeset file generated after all phases passed
   * (item 4.6). Absent when generation was skipped (test deps in
   * use, no phases run, or a prior failure short-circuited the run).
   */
  changesetPath?: string;
  /**
   * URL of the PR opened by --ship (item 4.7). Absent when --ship was
   * not passed or auto-ship failed. The hard-rule guards (no force-
   * push, no main/master push, no merge) live inside `auto-ship.ts`.
   */
  prUrl?: string;
  /**
   * The agent adapter + handle, kept alive for the caller to reuse
   * (e.g., for the debrief). The caller is responsible for calling
   * `adapter.shutdown(handle)` when done. Present only when `keepAlive` is
   * true in RalphLoopOptions (default: false — adapter is shut down
   * in the finally block).
   */
  agentHandle?: { adapter: AgentAdapter; handle: AgentHandle };
}

export interface RalphLoopOptions {
  /** The prompt to send to PRIME each iteration. */
  prompt: string;
  /** Working directory for the OpenCode server. */
  cwd: string;
  /** Agent name for the session (default: "autopilot-prime"). */
  agentName?: string;
  /** Maximum number of iterations (default: MAX_ITERATIONS). */
  maxIterations?: number;
  /** Total wall-clock timeout in ms (default: TIMEOUT_MS). */
  timeoutMs?: number;
  /** Per-iteration stall timeout in ms (default: STALL_MS). */
  stallMs?: number;
  /** Struggle threshold — consecutive zero-progress iterations (default: STRUGGLE_THRESHOLD). */
  struggleThreshold?: number;
  /**
   * Optional lane id for parallel-lane execution (item 3.4). When set,
   * all childLogger names are scoped under `autopilot.loop.lane.<id>`
   * (and tool/stream/status equivalents) so pino emits a `name` field
   * the user-facing formatter can prefix as `[lane-N]`. Status snapshots
   * also include this id so status.ts can render multi-lane state.
   * When unset (default), logging is scoped at `autopilot.loop` as before.
   */
  laneId?: string;
  /**
   * Webhook URL to POST lifecycle events to (optional).
   * Supports plain webhooks and Slack incoming webhooks (auto-detected).
   */
  notifyUrl?: string;
  /**
   * Webhook event types to send (optional).
   * When empty or undefined, all events are sent.
   * Valid event types: "iteration_complete", "phase_complete", "run_complete", "error", "struggle", "stall".
   * Events outside this list are silently dropped before any network call.
   */
  notifyEvents?: Array<"iteration_complete" | "phase_complete" | "run_complete" | "error" | "struggle" | "stall">;
  /**
   * When true, the agent adapter is NOT shut down in the finally block.
   * Instead, the adapter + handle are exposed on the LoopResult so the
   * caller can reuse them (e.g., for the debrief). The caller is
   * responsible for calling `adapter.shutdown(handle)`.
   * Default: false.
   */
  keepAlive?: boolean;
  /**
   * Pre-created logger to reuse. When provided, the loop skips creating
   * its own `createAutopilotLogger` and uses this one instead. This lets
   * the entire autopilot session (enrichment + loop + debrief) share a
   * single log file.
   */
  logger?: AutopilotLogger;
  /**
   * Optional event emitter for typed SessionEvents (Channel 1).
   * When provided, the loop emits iteration:start, iteration:done,
   * tool:call, cost:update, error, and credential:expired events.
   * The pino logger is kept as a verbose debug channel.
   */
  emitter?: SessionEventEmitter;
  /**
   * Agent adapter to use for driving the AI agent.
   * Required in production — the CLI injects the OpenCode adapter.
   * Optional only when _deps.startServer is provided (legacy test path).
   */
  adapter?: AgentAdapter;
  /**
   * Resolved model ID for this loop session. When provided, overrides
   * the default model resolution based on agentName or adapter config.
   * This field enables config-driven model routing for workflow stages.
   */
  model?: string;
  /**
   * Per-call agent overrides (item 4.2). When provided, passed to the
   * adapter's start() method to apply per-phase agent configuration.
   * Each phase can have its own agent-to-model mapping.
   */
  agentOverrides?: Record<string, unknown>;
  /**
   * Optional config object for iteration budget tuning (item 3.2),
   * commit settings (item 3.5), and other autopilot features.
   * - config.stall_timeout: per-iteration stall timeout in ms (overrides tier default)
   * - config.auto_commit: boolean (default true) — whether to commit on SIGINT/SIGTERM
   * - config.commit_prefix: string (optional) — prepended to commit subjects
   * When provided, extracted values override tier-based defaults in the loop.
   */
  config?: unknown;
}

/**
 * Read the autopilot prompt template and prepend it to the user's prompt.
 * The template is co-located with this loop at autopilot/prompt-template.md
 * (both in src/ for dev and dist/ for the built package).
 */
function buildFullPrompt(userPrompt: string): string {
  // Locate prompt-template.md relative to this file's location.
  // In dist/, this file is at dist/autopilot/loop.js and the template is
  // at dist/autopilot/prompt-template.md.
  // In src/ (tests), this file is at src/autopilot/loop.ts and the template
  // is at src/autopilot/prompt-template.md.
  const candidates = [
    join(import.meta.dir, "prompt-template.md"),
    join(import.meta.dir, "..", "..", "src", "autopilot", "prompt-template.md"),
  ];

  let template = "";
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8");
      // Strip YAML frontmatter
      template = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
      break;
    } catch {
      // try next candidate
    }
  }

  // Substitute $ARGUMENTS with the user's prompt
  const withArgs = template.replace("$ARGUMENTS", userPrompt);
  return withArgs || userPrompt;
}

/**
 * Check whether the agent made any filesystem progress during an iteration
 * by running `git diff --stat` against the pre-iteration HEAD.
 */
async function checkProgress(cwd: string, baseRef: string): Promise<boolean> {
  try {
    const { stdout } = await execFile("git", ["diff", "--stat", baseRef], { cwd });
    return stdout.trim().length > 0;
  } catch {
    // If git fails, assume progress (don't false-positive on struggle)
    return true;
  }
}

/**
 * Capture a snapshot of the working tree state for "no pending changes"
 * detection. Used by the iteration loop to decide whether a zero-progress
 * iteration after productive work means "agent is done" (snapshot
 * unchanged from iteration start) vs. "agent is struggling" (snapshot
 * differs but no commit was made).
 */
async function captureWorkingTreeSnapshot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["status", "--porcelain"], { cwd });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Get the current git HEAD SHA for progress tracking.
 */
async function getHeadSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return "HEAD";
  }
}

/**
 * Amend the last commit with a prefix if not already present (idempotent).
 * Returns true if amended, false otherwise.
 */
async function amendCommitWithPrefix(
  cwd: string,
  prefix: string,
): Promise<boolean> {
  try {
    const { stdout: subject } = await execFile("git", ["log", "-1", "--pretty=%s"], { cwd });
    const currentSubject = subject.trim();
    if (!currentSubject || currentSubject.startsWith(prefix)) {
      return false; // Already has prefix or no subject
    }
    const newSubject = `${prefix} ${currentSubject}`;
    await execFile("git", ["commit", "--amend", "-m", newSubject], { cwd });
    return true;
  } catch {
    return false; // Non-fatal amend failure
  }
}

/**
 * Run the Ralph loop: send prompt → wait for idle → inspect response →
 * retry or exit.
 */
export async function runRalphLoop(opts: RalphLoopOptions): Promise<LoopResult> {
  // Signal to the plugin's permission.ask hook that we're in headless mode.
  // Any question-tool permission requests should be auto-denied at the plugin
  // level, before they reach the event stream — preventing wasted iterations.
  process.env["GLRS_AUTOPILOT_HEADLESS"] = "1";

  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  // Resolve tier early so the stall-timeout default and modelName lookup
  // share the same tier. Resolution order: opts.stallMs (CLI/caller) >
  // config.stall_timeout > tier default.
  const tier: keyof typeof STALL_MS_BY_TIER =
    opts.agentName === "autopilot-fast" ? "autopilot-execute" : "deep";
  const cfgObj = opts.config as Record<string, unknown> | undefined;
  const cfgStallMs = cfgObj?.stall_timeout as number | undefined;
  const stallMs = opts.stallMs ?? cfgStallMs ?? STALL_MS_BY_TIER[tier];
  const struggleThreshold = opts.struggleThreshold ?? STRUGGLE_THRESHOLD;

  // Extract commit settings from config (item 3.5)
  const autoCommit = (cfgObj?.auto_commit as boolean) ?? true;
  const commitPrefix = (cfgObj?.commit_prefix as string | undefined);

  // Extract notification settings from config (item 3.6)
  // CLI flags override config settings
  const cfgNotifyUrl = cfgObj?.notify_url as string | undefined;
  const cfgNotifyEvents = cfgObj?.notify_events as Array<string> | undefined;
  const resolvedNotifyUrl = opts.notifyUrl ?? cfgNotifyUrl;
  const resolvedNotifyEvents = cfgNotifyEvents as Array<"iteration_complete" | "phase_complete" | "run_complete" | "error" | "struggle" | "stall"> | undefined;
  // Merge CLI events with config events (or use CLI events if both present)
  const finalNotifyEvents = opts.notifyEvents ?? resolvedNotifyEvents;

  if (!opts.adapter) {
    throw new Error("runRalphLoop: adapter is required");
  }
  const adapter = opts.adapter;

  const fullPrompt = buildFullPrompt(opts.prompt);
  const struggle = new StruggleDetector(struggleThreshold);
  const startTime = Date.now();

  // Fire-and-forget webhook notification helper.
  // Never throws — errors are swallowed by notifyWebhook itself.
  const notify = (event: WebhookEvent) => {
    if (resolvedNotifyUrl) {
      notifyWebhook(resolvedNotifyUrl, event, finalNotifyEvents).catch(() => {});
    }
  };

  // Create the per-run logger. Two sinks: stderr (user-visible) and
  // a per-run log file (captures everything at trace level).
  // When a logger is injected (e.g., from the CLI handler), reuse it
  // so the entire session shares one log file.
  const autopilotLog = opts.logger ?? createAutopilotLogger({ cwd: opts.cwd });
  // When laneId is set (parallel execution per item 3.4), every child
  // logger is scoped under the lane name so pino's `name` field carries
  // the lane id. The user-facing TTY formatter doesn't render `name`,
  // but the file sink + JSON consumers can.
  const laneSuffix = opts.laneId ? `.lane.${opts.laneId}` : "";
  const log = childLogger(autopilotLog.root, `autopilot.loop${laneSuffix}`);
  const toolLog = childLogger(autopilotLog.root, `autopilot.tool${laneSuffix}`);
  const streamLog = childLogger(autopilotLog.root, `autopilot.stream${laneSuffix}`);
  const statusLog = childLogger(autopilotLog.root, `autopilot.status${laneSuffix}`);
  // Prefix used in user-visible info-level messages for the run header
  // and tool/iteration lines. Empty string when not in lane mode so the
  // sequential path stays unchanged.
  const lanePrefix = opts.laneId ? `[${opts.laneId}] ` : "";

  // Typed event emitter (Channel 1) — optional, wired by SessionRunner.
  const emitter = opts.emitter;

  // Per-iteration thinking state for progress output.
  let thinkingChars = 0;
  let thinkingStartTime = 0;
  let thinkingToolCalls = 0;

  // Resolve the actual model name from opencode.json for logging.
  let modelName = "unknown";
  try {
    const configHome = process.env["XDG_CONFIG_HOME"] ?? join(process.env["HOME"] ?? "", ".config");
    const configPath = join(configHome, "opencode", "opencode.json");
    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const plugins: unknown[] = Array.isArray(config.plugin) ? config.plugin : [];
    for (const entry of plugins) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const opts2 = entry[1] as Record<string, unknown>;
        const models = opts2?.models as Record<string, string[]> | undefined;
        if (models) {
          // Use the tier hoisted above so stall-timeout and modelName
          // lookup are coherent.
          const modelArr = models[tier] ?? (tier === "autopilot-execute" ? (models["mid-execute"] ?? models["mid"]) : models["deep"]);
          if (Array.isArray(modelArr) && modelArr[0]) {
            modelName = modelArr[0];
          }
        }
      }
    }
  } catch {
    // Config read failure — use "unknown"
  }

  // Print the run header.
  const agentLabel = opts.agentName === "autopilot-fast" ? "fast executor" : "deep";
  log.info(`${lanePrefix}Autopilot loop — ${agentLabel} (${modelName})`);
  log.info(`${lanePrefix}Prompt: ${opts.prompt.length > 80 ? opts.prompt.slice(0, 80) + "…" : opts.prompt}`);
  log.info(`${lanePrefix}Max iterations: ${maxIterations}, timeout: ${(timeoutMs / 3_600_000).toFixed(1)}h`);

  // Status heartbeat placeholder — created after session so we can
  // pass the cost poller with the session ID.
  let heartbeat: ReturnType<typeof createStatusHeartbeat> | null = null;

  if (autopilotLog.logFilePath) {
    log.info({ file: autopilotLog.logFilePath }, `Logging to ${autopilotLog.logFilePath}`);
  }

  // Start the agent
  log.info({ cwd: opts.cwd, maxIterations, timeoutMs }, `Starting agent (${adapter.name})`);
  const handle = await adapter.start({ cwd: opts.cwd, agents: opts.agentOverrides });
  log.info({ agentId: handle.id }, "Agent ready");
  const abort = new AbortController();

  // Set up total timeout
  const timeoutHandle = setTimeout(() => {
    abort.abort();
  }, timeoutMs);

  // Graceful shutdown on SIGINT/SIGTERM. First signal: abort the
  // current iteration, fall through to the finally block (which
  // commits any WIP and writes a checkpoint), then exit normally.
  // Second signal: force-exit immediately with code 130.
  //
  // Listeners are removed in the finally block to avoid accumulating
  // handlers across nested or repeated runRalphLoop invocations.
  let signalCount = 0;
  let interruptedSignal: string | undefined;
  const onSignal = (signal: string) => {
    signalCount++;
    if (signalCount === 1) {
      interruptedSignal = signal;
      log.warn({ signal }, `Signal ${signal} received — graceful shutdown (commit WIP + write checkpoint)`);
      abort.abort();
    } else {
      log.error({ signal, signalCount }, "Second signal — force exit");
      process.exit(130);
    }
  };
  const sigintHandler = () => onSignal("SIGINT");
  const sigtermHandler = () => onSignal("SIGTERM");
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  // Track session ID at function scope so all return paths can include it.
  let sessionId: string | undefined;

  // Track whether ownership of the agent handle was transferred to the caller
  // via a successful return when keepAlive=true. If the function rejects
  // before transfer, the finally block must shut the agent down to avoid
  // leaking the process. The `transferHandle()` helper is called inline at
  // each return site to compute the optional agentHandle field and
  // simultaneously mark ownership as transferred.
  let handleTransferred = false;
  const transferHandle = (): { adapter: AgentAdapter; handle: AgentHandle } | undefined => {
    if (opts.keepAlive) {
      handleTransferred = true;
      return { adapter, handle };
    }
    return undefined;
  };

  try {
    // Create a session with the configured agent (autopilot-prime for deep,
    // autopilot-fast for autopilot-execute tier when --fast is used).
    const agentName = opts.agentName ?? "autopilot-prime";
    const tierLabel = agentName === "autopilot-fast" ? "autopilot-execute tier" : "deep tier";
    sessionId = await adapter.createSession(handle, { agentName, model: opts.model });
    log.info({ sessionId, agentName, tier: tierLabel }, `Session created with ${agentName} (${tierLabel})`);

    // Create the status heartbeat now that we have a session — the cost
    // poller needs the session ID to call getSessionCost().
    const statusFileEnabled = (opts.config as Record<string, unknown> | undefined)?.status_file !== false;
    heartbeat = createStatusHeartbeat({
      logger: statusLog,
      intervalMs: STATUS_INTERVAL_MS,
      pollCost: async () => adapter.getSessionCost(handle, sessionId!),
      statusFilePath: statusFileEnabled ? join(opts.cwd, ".agent", "autopilot-status.json") : undefined,
    });

    // Start the status heartbeat. First tick fires after STATUS_INTERVAL_MS.
    heartbeat!.start();

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // Check kill switch before each iteration
      if (checkKillSwitch(opts.cwd)) {
        log.warn({ iteration: iteration - 1 }, "Kill switch active — stopping");
        notify({
          event: "run_complete",
          iteration: iteration - 1,
          costUsd: heartbeat?.getState().cumulativeCostUsd,
          message: `Kill switch active (.agent/autopilot-disable exists). Stopping after ${iteration - 1} iteration(s).`,
          timestamp: new Date().toISOString(),
        });
        return {
          exitReason: "kill-switch",
          iterations: iteration - 1,
          message: `Kill switch active (.agent/autopilot-disable exists). Stopping after ${iteration - 1} iteration(s).`,
          sessionId,
          cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
          agentHandle: transferHandle(),
        };
      }

      // Check total timeout
      if (Date.now() - startTime >= timeoutMs) {
        log.warn({ iteration: iteration - 1, timeoutMs }, "Total timeout exceeded");
        notify({
          event: "run_complete",
          iteration: iteration - 1,
          costUsd: heartbeat?.getState().cumulativeCostUsd,
          message: `Total timeout (${timeoutMs}ms) exceeded after ${iteration - 1} iteration(s).`,
          timestamp: new Date().toISOString(),
        });
        return {
          exitReason: "timeout",
          iterations: iteration - 1,
          message: `Total timeout (${timeoutMs}ms) exceeded after ${iteration - 1} iteration(s).`,
          sessionId,
          cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
          agentHandle: transferHandle(),
        };
      }

      // Record git HEAD before this iteration for progress tracking
      const headBefore = await getHeadSha(opts.cwd);
      // Snapshot working-tree state before this iteration so we can
      // distinguish "no progress + no pending changes = done" from
      // "no progress + pending changes = struggle".
      const snapshotBefore = await captureWorkingTreeSnapshot(opts.cwd);

      // Snapshot the cumulative cost at iteration start so real-time
      // cost updates from message.updated events can be added on top.
      const iterationBaseCost = heartbeat!.getState().cumulativeCostUsd;

      const iterStart = Date.now();
      log.debug({ iteration, maxIterations }, `Iteration ${iteration}/${maxIterations} — sending prompt`);

      // Progress reporter: mark iteration start.
      log.info(`${lanePrefix}Iteration ${iteration}/${maxIterations}`);

      // Emit typed iteration:start event
      emitter?.emitEvent({
        type: "iteration:start",
        timestamp: new Date().toISOString(),
        iteration,
        maxIterations,
        ...(opts.laneId ? { laneId: opts.laneId } : {}),
      });

      // Reset per-iteration thinking state
      thinkingChars = 0;
      thinkingStartTime = 0;
      thinkingToolCalls = 0;

      // Stream-liveness state for this iteration. The agent emits text
      // deltas (character-by-character streaming) while reasoning
      // between tool calls. Without visible output here, a 30s-to-
      // several-minute reasoning stream looks indistinguishable from a
      // hang. Throttled to avoid log spam at ~6 deltas/sec.
      let streamDeltaCount = 0;
      let streamCharCount = 0;
      let lastStreamLogAt = 0;
      let lastToolOrStreamLogAt = Date.now();
      let lastThinkingEventAt = 0;
      const THINKING_EVENT_INTERVAL_MS = 5_000;
      const DEBUG_STREAM_INTERVAL_MS = 15_000;
      const INFO_STREAM_INTERVAL_MS = 60_000;

      // Tool-call events go through pino at `debug` level. Default stderr
      // level is `info`, so users don't see tool chatter by default — but
      // the file sink captures everything. Set GLRS_LOG_LEVEL=debug (or
      // pass the CLI flag wired to it) to see tool calls live.
      //
      // Wrap the send in a retry loop that re-issues sendAndWait when the
      // server reports a transient error (network blip, 429, 5xx). Up to
      // 3 total attempts with exponential backoff (1s → 2s → 4s, capped
      // at 30s). Permanent errors and credential-expiry fall through to
      // the existing error branches without retry.
      const sendOnce = () =>
        adapter.sendAndWait(handle, {
          sessionId: sessionId!,
          message: fullPrompt,
          stallMs,
          abortSignal: abort.signal,
          onToolCall: (toolName, firstArg) => {
            log.info(`${lanePrefix}tool: ${toolName}${firstArg ? " " + firstArg : ""}`);
            thinkingToolCalls++;
            // Reset thinking state — a tool call means reasoning reached a checkpoint
            thinkingChars = 0;
            thinkingStartTime = 0;
            lastToolOrStreamLogAt = Date.now();
            lastThinkingEventAt = 0;
            // Reset the stream indicator when a tool fires — a tool call
            // means the reasoning stream reached a natural checkpoint.
            streamDeltaCount = 0;
            streamCharCount = 0;
            lastStreamLogAt = Date.now();
            // Emit typed tool:call event
            emitter?.emitEvent({
              type: "tool:call",
              timestamp: new Date().toISOString(),
              toolName,
              ...(firstArg ? { firstArg } : {}),
              iteration,
              ...(opts.laneId ? { laneId: opts.laneId } : {}),
            });
          },
          onCostUpdate: (cost, tokens) => {
            // Cost update — tracked by heartbeat, no separate progress line needed
            // Real-time cost from message.updated events. The cost value
            // is the TOTAL for the current message (not a delta), so we
            // just set the heartbeat's cumulative cost to the running
            // session total sampled at iteration boundaries PLUS this
            // message's current cost. This slightly over-reports during
            // an iteration (the iteration-boundary sample already
            // included prior messages) but is directionally correct and
            // never shows $0.00 during a long iteration.
            //
            // The iteration-boundary cost sample (getSessionCost) will
            // correct the cumulative total after the iteration completes.
            //
            // When cost === 0 (e.g., Bedrock doesn't report mid-stream cost),
            // fall back to token-count estimation if tokens are available.
            const effectiveCost = cost > 0
              ? cost
              : (tokens.input > 0 || tokens.output > 0)
                ? estimateCost(modelName, tokens)
                : 0;
            const isEstimated = cost === 0 && effectiveCost > 0;

            heartbeat!.update({
              cumulativeCostUsd: iterationBaseCost + effectiveCost,
              ...(isEstimated ? { costIsEstimated: true } : {}),
            });
            // Emit typed cost:update event — always emit so token counts
            // flow to the TUI even when cost is still $0.00 (Bedrock
            // reports cost=0 mid-stream).
            emitter?.emitEvent({
              type: "cost:update",
              timestamp: new Date().toISOString(),
              cumulativeCostUsd: iterationBaseCost + effectiveCost,
              isEstimated,
              iteration,
              tokensIn: tokens.input,
              tokensOut: tokens.output,
            });
          },
          onTextDelta: (charCount) => {
            streamDeltaCount += 1;
            streamCharCount += charCount;
            thinkingChars += charCount;
            const now = Date.now();
            if (thinkingStartTime === 0) thinkingStartTime = now;

            // Emit a throttled "thinking" event to the TUI every 5s so
            // the user sees the model is alive between tool calls.
            if (now - lastThinkingEventAt >= THINKING_EVENT_INTERVAL_MS) {
              const elapsedSec = Math.round((now - thinkingStartTime) / 1000);
              emitter?.emitEvent({
                type: "thinking",
                timestamp: new Date().toISOString(),
                iteration,
                chars: thinkingChars,
                elapsedSec,
                ...(opts.laneId ? { laneId: opts.laneId } : {}),
              });
              lastThinkingEventAt = now;
            }

            // Debug-level stream indicator every 15s during sustained
            // streaming. Always captured to file; only on stderr if
            // GLRS_LOG_LEVEL=debug.
            if (now - lastStreamLogAt >= DEBUG_STREAM_INTERVAL_MS) {
              streamLog.debug(
                { iteration, deltas: streamDeltaCount, chars: streamCharCount },
                `streaming (${streamDeltaCount} deltas, ${streamCharCount} chars)`,
              );
              lastStreamLogAt = now;
            }

            // Human-readable thinking indicator after 60s with no tool call.
            // Uses the progress logger (no timestamp/component prefix in TTY).
            const silenceSinceLastTool = now - lastToolOrStreamLogAt;
            if (silenceSinceLastTool >= INFO_STREAM_INTERVAL_MS) {
              const elapsedS = Math.round((now - thinkingStartTime) / 1000);
              const fmtElapsed = elapsedS < 60 ? `${elapsedS}s` : `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s`;
              log.info({ thinking: fmtElapsed }, `thinking (${fmtElapsed})`);
              // Also log structured version for the file sink
              streamLog.info(
                {
                  iteration,
                  deltas: streamDeltaCount,
                  chars: streamCharCount,
                  silenceMs: silenceSinceLastTool,
                },
                `still streaming (${streamDeltaCount} deltas, ${streamCharCount} chars, ${Math.round(silenceSinceLastTool / 1000)}s since last tool)`,
              );
              lastToolOrStreamLogAt = now;
            }
          },
        });

      let result = await sendOnce();
      // Transient retry: if the send returned a "transient" error,
      // backoff and re-issue up to TRANSIENT_RETRY_MAX_ATTEMPTS - 1 times.
      // Stall/abort/idle/question_rejected/credential-expired/permanent
      // errors fall through unchanged.
      if (result.kind === "error") {
        const initialClass = classifyError(result.message);
        if (initialClass === "transient") {
          for (let attempt = 1; attempt < TRANSIENT_RETRY_MAX_ATTEMPTS; attempt++) {
            const delay = Math.min(
              TRANSIENT_RETRY_BASE_MS * Math.pow(2, attempt - 1),
              TRANSIENT_RETRY_MAX_MS,
            );
            log.warn(
              { iteration, attempt, delayMs: delay, err: result.message },
              `Transient error — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${TRANSIENT_RETRY_MAX_ATTEMPTS})`,
            );
            // Honor abort during the backoff sleep.
            const aborted = await new Promise<boolean>((resolve) => {
              if (abort.signal.aborted) {
                resolve(true);
                return;
              }
              const handle = setTimeout(() => {
                abort.signal.removeEventListener("abort", onAbort);
                resolve(false);
              }, delay);
              const onAbort = () => {
                clearTimeout(handle);
                resolve(true);
              };
              abort.signal.addEventListener("abort", onAbort, { once: true });
            });
            if (aborted) break;
            result = await sendOnce();
            if (result.kind !== "error") break;
            const cls = classifyError(result.message);
            if (cls !== "transient") break;
          }
        }
      }

      const iterDurationMs = Date.now() - iterStart;

      if (result.kind === "abort") {
        log.warn({ iteration, iterDurationMs }, "Iteration aborted (total timeout)");
        notify({
          event: "run_complete",
          iteration,
          costUsd: heartbeat?.getState().cumulativeCostUsd,
          message: `Aborted after ${iteration} iteration(s) (total timeout exceeded).`,
          timestamp: new Date().toISOString(),
        });
        return {
          exitReason: "timeout",
          iterations: iteration,
          message: `Aborted after ${iteration} iteration(s) (total timeout exceeded).`,
          sessionId,
          cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
          agentHandle: transferHandle(),
        };
      }

      if (result.kind === "stall") {
        log.warn({ iteration, stallMs: result.stallMs }, "Iteration stalled");
        notify({
          event: "stall",
          iteration,
          costUsd: heartbeat?.getState().cumulativeCostUsd,
          message: `Iteration ${iteration} stalled for ${result.stallMs}ms with no idle signal.`,
          timestamp: new Date().toISOString(),
        });
        return {
          exitReason: "stall",
          iterations: iteration,
          message: `Iteration ${iteration} stalled for ${result.stallMs}ms with no idle signal.`,
          sessionId,
          cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
          agentHandle: transferHandle(),
        };
      }

      if (result.kind === "error") {
        // Credential-expired (item 2.6) is a special case: retry won't
        // help, the user must run `gs-assume`. Write a best-effort
        // checkpoint, surface the actionable message, and exit with
        // code 2 (distinct from the generic error path's exit 1 and
        // the SIGINT path's exit 130).
        const errorClass = classifyError(result.message);
        if (errorClass === "credential-expired") {
          const provider = detectProvider(modelName);
          log.error(
            { iteration, provider, err: result.message },
            "Credentials expired — autopilot cannot continue",
          );
          // Emit typed credential:expired event
          emitter?.emitEvent({
            type: "credential:expired",
            timestamp: new Date().toISOString(),
            provider,
            message: `Credentials expired (${provider}). Run \`gs-assume\` and then \`glrs oc autopilot --resume\`.`,
            iteration,
          });
          // Best-effort checkpoint write so --resume picks up here.
          // multi-phase runs already write per-phase checkpoints; this
          // ensures the run-level state is captured for single-phase
          // (loop CLI) and pre-first-phase scenarios too.
          try {
            writeCheckpoint(opts.cwd, {
              planPath: opts.cwd,
              completedPhases: [],
              totalCostUsd: heartbeat?.getState().cumulativeCostUsd ?? 0,
              totalIterations: iteration - 1,
              timestamp: new Date().toISOString(),
            });
          } catch {
            // writeCheckpoint already swallows internally.
          }
          notify({
            event: "error",
            iteration,
            costUsd: heartbeat?.getState().cumulativeCostUsd,
            errorMessage: result.message,
            message: `Credentials expired (${provider}). Run \`gs-assume\` and then \`glrs oc autopilot --resume\`.`,
            timestamp: new Date().toISOString(),
          });
          log.error(
            "Credentials expired. Run `gs-assume` and then `glrs oc autopilot --resume`.",
          );
          // exit(2) signals "credential refresh required" — distinct
          // from generic error (1) and signal-triggered (130) exits.
          process.exit(2);
        }

        log.error({ iteration, err: result.message }, "Iteration errored");
        // Emit typed error event
        emitter?.emitEvent({
          type: "error",
          timestamp: new Date().toISOString(),
          message: result.message ?? "unknown error",
          iteration,
        });
        heartbeat!.update({
          iterationsCompleted: iteration,
          lastIterationErrored: true,
        });
        notify({
          event: "error",
          iteration,
          costUsd: heartbeat?.getState().cumulativeCostUsd,
          errorMessage: result.message,
          message: `Error in iteration ${iteration}: ${result.message}`,
          timestamp: new Date().toISOString(),
        });
        return {
          exitReason: "error",
          iterations: iteration,
          message: `Error in iteration ${iteration}: ${result.message}`,
          sessionId,
          cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
          agentHandle: transferHandle(),
        };
      }

      if (result.kind === "question_rejected") {
        // The agent tried to use the question tool. The question was
        // rejected via the /question/{id}/reject endpoint.
        //
        // DO NOT re-send the prompt here. Empirically, sending a new
        // message after a question rejection leaves the OpenCode session
        // in a broken state — the LLM API call hangs silently and the
        // session never produces another event. Instead, just log the
        // rejection, count it as a zero-progress iteration (toward
        // struggle detection), and let the NEXT iteration's fresh
        // sendAndWait start clean with the original prompt.
        log.warn(
          { iteration, questionTitle: result.title },
          `Question rejected — skipping to next iteration (iteration ${iteration})`,
        );
        log.warn(`question rejected — skipping to next iteration`);
        // Fall through to progress tracking — counts as no-progress
      }

      // result.kind === "idle" (or fell through from question_rejected recovery)
      // An agent that emits <autopilot-done> on a zero-progress iteration
      // (e.g., "I'm confirming completion; previous iterations wrote all the
      // files") must exit as "sentinel", NOT be counted toward struggle.
      // Sentinel check must happen before struggle accounting.
      const lastMessage = await adapter.getLastResponse(handle, sessionId);
      if (detectSentinel(lastMessage)) {
        log.info({ iteration, iterDurationMs }, "Sentinel detected — autopilot done");
        notify({
          event: "run_complete",
          iteration,
          costUsd: heartbeat?.getState().cumulativeCostUsd,
          message: `Agent emitted <autopilot-done> at iteration ${iteration}.`,
          timestamp: new Date().toISOString(),
        });
        return {
          exitReason: "sentinel",
          iterations: iteration,
          message: `Agent emitted <autopilot-done> at iteration ${iteration}.`,
          sessionId,
          cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
          agentHandle: transferHandle(),
        };
      }

      // No sentinel — record progress and check struggle.
      // Only reached when the agent did NOT emit the sentinel this iteration.
      const madeProgress = await checkProgress(opts.cwd, headBefore);
      struggle.record(madeProgress);

      // File-list scope validation (item 4.2). Compare the files the
      // agent actually touched this iteration against the union of
      // files declared in the current phase's plan-state items. This
      // is informational — warnings only, never blocks the loop.
      // Activates only when the prompt contains a `## Your phase`
      // section we can parse (the per-phase prompt shape from
      // loop-session.ts). Plan-blind single-file runs skip this check.
      try {
        const phaseMatch = opts.prompt.match(
          /## Your phase \([^)]+\)\n([\s\S]*?)(?=\n##\s|$)/,
        );
        if (phaseMatch) {
          const phaseItems = parseItems(phaseMatch[1]);
          const expectedFiles = new Set<string>();
          for (const it of phaseItems) {
            if (it.checked) continue;
            for (const f of it.files) {
              if (f.path) expectedFiles.add(f.path);
            }
          }
          if (expectedFiles.size > 0) {
            const changedFiles = await getChangedFiles(opts.cwd, headBefore);
            const { extra, missing } = validateScope(
              [...expectedFiles],
              changedFiles,
            );
            for (const f of extra) {
              log.warn(
                { scopeDrift: f, iteration },
                `Scope drift: agent edited ${f} which is not in the plan.`,
              );
            }
            for (const f of missing) {
              log.warn(
                { incomplete: f, iteration },
                `Incomplete: plan expects changes to ${f} but none were made.`,
              );
            }
          }
        }
      } catch (err) {
        // Validation is best-effort — never block the loop.
        log.debug({ err }, "scope validation skipped");
      }

      // Sample cumulative session cost + tokens via the adapter.
      // The SSE-based onCostUpdate callback often doesn't fire (message.updated
      // events arrive after session.idle settles the promise), so this
      // post-iteration fetch is the reliable path for cost/token visibility.
      let cumulativeCostUsd = 0;
      let iterTokensIn = 0;
      let iterTokensOut = 0;
      if (adapter.getSessionStats) {
        const stats = await adapter.getSessionStats(handle, sessionId!);
        cumulativeCostUsd = stats.cost;
        iterTokensIn = stats.tokensIn;
        iterTokensOut = stats.tokensOut;
      } else {
        cumulativeCostUsd = await adapter.getSessionCost(handle, sessionId!);
      }

      // Emit cost:update so the TUI shows real numbers after each iteration.
      // This is the reliable path — the SSE-based onCostUpdate fires only
      // when message.updated events arrive during streaming, which many
      // providers (Bedrock) don't emit until after session.idle.
      if (cumulativeCostUsd > 0 || iterTokensIn > 0 || iterTokensOut > 0) {
        emitter?.emitEvent({
          type: "cost:update",
          timestamp: new Date().toISOString(),
          cumulativeCostUsd,
          isEstimated: false,
          iteration,
          tokensIn: iterTokensIn,
          tokensOut: iterTokensOut,
        });
      }

      // Get git diff stat and commit subject for the progress reporter.
      let filesChanged = 0;
      let commitSubject = "";
      try {
        const { stdout: diffStat } = await execFile("git", ["diff", "--stat", "HEAD~1", "HEAD"], { cwd: opts.cwd });
        // Count changed files from the summary line: "N files changed, ..."
        const match = diffStat.match(/(\d+) files? changed/);
        if (match) filesChanged = parseInt(match[1], 10);
      } catch {
        // git diff stat is non-fatal
      }
      const headAfter = await getHeadSha(opts.cwd);
      if (headAfter !== headBefore) {
        try {
          const { stdout: logOut } = await execFile("git", ["log", "--oneline", "-1"], { cwd: opts.cwd });
          // Strip the short SHA prefix: "abc1234 subject line" → "subject line"
          commitSubject = logOut.trim().replace(/^[0-9a-f]+ /, "");
        } catch {
          // non-fatal
        }
        // Amend agent-authored commit with prefix if configured (item 3.5)
        // Fire-and-forget: don't block iteration on amendment
        if (commitSubject && commitPrefix) {
          amendCommitWithPrefix(opts.cwd, commitPrefix).catch(() => {
            // Non-fatal amendment failure
          });
        }
        if (commitSubject) {
          log.info(`${lanePrefix}commit: ${commitSubject}`);
        }
      }

      // Iteration summary
      const costDelta = cumulativeCostUsd - iterationBaseCost;
      const durationMin = iterDurationMs / 60_000;
      const fmtDur = iterDurationMs < 60_000
        ? `${Math.round(iterDurationMs / 1000)}s`
        : `${Math.floor(durationMin)}m ${Math.round((iterDurationMs / 1000) % 60)}s`;
      const reqPerMin = durationMin > 0 ? Math.round(thinkingToolCalls / durationMin) : 0;
      log.info(
        {
          elapsed: fmtDur,
          ...(costDelta > 0 ? { cost: `$${costDelta.toFixed(2)}` } : {}),
          ...(filesChanged > 0 ? { filesChanged } : {}),
          ...(reqPerMin > 0 ? { reqPerMin } : {}),
        },
        `Iteration ${iteration} done`,
      );

      // Emit typed iteration:done event
      emitter?.emitEvent({
        type: "iteration:done",
        timestamp: new Date().toISOString(),
        iteration,
        durationMs: iterDurationMs,
        madeProgress,
        ...(filesChanged > 0 ? { filesChanged } : {}),
        ...(commitSubject ? { commitSubject } : {}),
        ...(cumulativeCostUsd > 0 ? { costUsd: cumulativeCostUsd } : {}),
        ...(opts.laneId ? { laneId: opts.laneId } : {}),
      });

      // Detect plan path from the prompt (looks for plans/<slug>/ directory
      // reference). If found, parse plan progress for the heartbeat.
      // Parser errors are caught and logged at debug level; plan-progress
      // fields stay absent on error so the heartbeat degrades cleanly.
      const planPathMatch = opts.prompt.match(/plans\/([^/\s]+(?:\/[^/\s]+)?)/);
      let planProgressPatch: Record<string, unknown> = {};
      if (planPathMatch) {
        try {
          const planPath = planPathMatch[0];
          const planState = parsePlanState(planPath);
          if (planState.type === "multi") {
            planProgressPatch = {
              phaseCount: planState.phaseCount,
              phasesCompleted: planState.phasesCompleted,
              mainCheckboxesTotal: planState.totalItems,
              mainCheckboxesCompleted: planState.checkedItems,
            };
          }
        } catch (err) {
          log.debug({ err }, "plan-parser error — falling back to plan-blind heartbeat");
        }
      }

      heartbeat!.update({
        iterationsCompleted: iteration,
        cumulativeCostUsd,
        lastIterationProgress: madeProgress,
        lastIterationErrored: false,
        ...planProgressPatch,
      });

      // Notify iteration complete (after heartbeat update so costUsd is current)
      notify({
        event: "iteration_complete",
        iteration,
        costUsd: cumulativeCostUsd,
        filesChanged: filesChanged > 0 ? filesChanged : undefined,
        commitSubject: commitSubject || undefined,
        message: `Iteration ${iteration} complete`,
        timestamp: new Date().toISOString(),
      });

      log.debug(
        { iteration, iterDurationMs, madeProgress, cumulativeCostUsd },
        `Iteration ${iteration} idle (${(iterDurationMs / 1000).toFixed(1)}s, ${madeProgress ? "progress" : "no progress"})`,
      );

      // Early exit: if no progress was made this iteration AND the agent
      // made progress in a prior iteration, check if there's nothing left
      // to do. A zero-progress iteration after productive work is not
      // "struggle" — it's the agent finishing without emitting the sentinel.
      // Only applies after at least one productive iteration (iteration > 1
      // and prior progress recorded).
      if (!madeProgress && iteration > 1 && heartbeat?.getState().lastIterationProgress) {
        const currentSnapshot = await captureWorkingTreeSnapshot(opts.cwd);
        if (currentSnapshot === snapshotBefore) {
          log.info("No progress and no pending changes — treating as complete");
          return {
            exitReason: "sentinel",
            iterations: iteration,
            message: `No further progress possible at iteration ${iteration}. Treating as complete.`,
            sessionId,
            cumulativeCostUsd,
          };
        }
      }

      if (struggle.isStruggling()) {
        log.warn({ iteration, struggleThreshold }, "Struggle detected — stopping");
        notify({
          event: "struggle",
          iteration,
          costUsd: heartbeat?.getState().cumulativeCostUsd,
          message: `Agent made no filesystem progress for ${struggleThreshold} consecutive iteration(s). Stopping at iteration ${iteration}.`,
          timestamp: new Date().toISOString(),
        });
        return {
          exitReason: "struggle",
          iterations: iteration,
          message: `Agent made no filesystem progress for ${struggleThreshold} consecutive iteration(s). Stopping at iteration ${iteration}.`,
          sessionId,
          cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
          agentHandle: transferHandle(),
        };
      }
    }

    log.warn({ maxIterations }, "Reached max iterations");
    notify({
      event: "run_complete",
      iteration: maxIterations,
      costUsd: heartbeat?.getState().cumulativeCostUsd,
      message: `Reached maximum iterations (${maxIterations}). Stopping.`,
      timestamp: new Date().toISOString(),
    });
    return {
      exitReason: "max-iterations",
      iterations: maxIterations,
      message: `Reached maximum iterations (${maxIterations}). Stopping.`,
      sessionId,
      cumulativeCostUsd: heartbeat?.getState().cumulativeCostUsd,
      agentHandle: transferHandle(),
    };
  } finally {
    delete process.env["GLRS_AUTOPILOT_HEADLESS"];
    clearTimeout(timeoutHandle);
    heartbeat?.stop();

    // Always remove the signal listeners so a second runRalphLoop
    // invocation in the same process doesn't accumulate handlers.
    process.removeListener("SIGINT", sigintHandler);
    process.removeListener("SIGTERM", sigtermHandler);

    // If we were interrupted by SIGINT/SIGTERM, commit any WIP and
    // write a best-effort checkpoint so a subsequent --resume can pick
    // up where we left off. All best-effort — failures here are
    // logged but never thrown.
    if (signalCount > 0) {
      try {
        const { stdout: porcelain } = await execFile("git", ["status", "--porcelain"], { cwd: opts.cwd });
        if (porcelain.trim().length > 0) {
          if (autoCommit) {
            log.info({ signal: interruptedSignal }, "Committing WIP before exit");
            try {
              await execFile("git", ["add", "-A"], { cwd: opts.cwd });
              // No --no-verify: hooks run normally per AGENTS.md hard rule.
              // If a hook rejects the commit, log the failure and move on
              // — the user's WIP is still in the index.
              const commitMsg = commitPrefix
                ? `${commitPrefix} [WIP] autopilot interrupted`
                : "[WIP] autopilot interrupted";
              await execFile("git", ["commit", "-m", commitMsg], { cwd: opts.cwd });
            } catch (err) {
              log.warn({ err: err instanceof Error ? err.message : String(err) }, "WIP commit failed (hooks may have rejected)");
            }
          } else {
            log.warn(
              { signal: interruptedSignal },
              "Pending changes left unstaged (auto_commit: false)",
            );
          }
        }
      } catch (err) {
        log.debug({ err }, "WIP-status check failed (non-fatal)");
      }

      // Best-effort checkpoint write — used by --resume to pick up
      // from the next phase. Multi-phase runs already write checkpoints
      // per phase; this is a final safety net to capture the
      // interruption timestamp.
      try {
        writeCheckpoint(opts.cwd, {
          planPath: opts.cwd,
          completedPhases: [],
          totalCostUsd: heartbeat?.getState().cumulativeCostUsd ?? 0,
          totalIterations: heartbeat?.getState().iterationsCompleted ?? 0,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // writeCheckpoint already swallows; this is belt-and-suspenders.
      }
    }

    // Shut down the agent unless ownership was transferred to the caller via
    // a successful return with keepAlive=true. On error paths (the function
    // rejected before any return executed), handleTransferred stays false and
    // we shut down here to avoid leaking the agent process.
    if (!handleTransferred) {
      log.info({}, "Shutting down agent");
      await adapter.shutdown(handle);
    }
    await autopilotLog.flush();
  }
}
