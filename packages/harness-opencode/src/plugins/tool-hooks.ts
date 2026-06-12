/**
 * tool-hooks — cross-cutting tool output middleware.
 *
 * A single sub-plugin registering `tool.execute.after` (and optionally
 * `tool.execute.before` in future) to apply four context-saving
 * optimisations on every tool call:
 *
 *   1. **Output backpressure.** Successful tool output above a character
 *      threshold is truncated (head + tail) with the full text written
 *      to disk. Failures always preserve full output.
 *
 *   2. **Post-edit verification loop.** After an edit to a TS/JS file,
 *      `tsc --noEmit` runs automatically and any NEW errors in the
 *      edited file are appended to the tool result. The agent
 *      self-corrects in the same turn instead of discovering breakage
 *      turns later. Based on the LangChain pattern that lifted their
 *      Terminal Bench 2.0 score from 52.8% to 66.5%.
 *
 *   3. **Loop detection.** Tracks per-file edit counts within a session.
 *      After N edits to the same file (default 5) the agent sees a
 *      nudge suggesting it reconsider its approach.
 *
 *   4. **Read deduplication.** Tracks file content hashes within a
 *      session. When a file is re-read and hasn't changed, the output
 *      is replaced with a short pointer to the earlier read, saving
 *      potentially thousands of tokens.
 *
 * All four concerns share per-session state and are orchestrated from a
 * single `tool.execute.after` handler so only one hook registration is
 * needed.
 *
 * Configuration (via plugin options in opencode.json):
 *
 *   "plugin": [["@glrs-dev/harness-plugin-opencode", {
 *     "toolHooks": {
 *       backpressure: {
 *         enabled: true,        // default
 *         threshold: 2000,      // chars — outputs above this get truncated
 *         headChars: 300,       // chars preserved at the start
 *         tailChars: 200,       // chars preserved at the end
 *         tools: ["bash", "read", "glob", "grep"],
 *       },
 *       verifyLoop: {
 *         enabled: true,        // default
 *         timeoutMs: 15000,     // tsc timeout
 *       },
 *       loopDetection: {
 *         enabled: true,        // default
 *         threshold: 5,         // edits before first warning
 *       },
 *       readDedup: {
 *         enabled: true,        // default
 *       },
 *     }
 *   }
 */

import type { Plugin, Config, PluginOptions } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import picomatch from "picomatch";

import { parseTscOutput, dedupeAndCap, formatRow } from "../tools/tsc_check.js";
import {
  listJobs,
  selectFreshCompletions,
  buildCompletionNotice,
  announcedFor,
  leadingSleepSeconds,
} from "../tools/background.js";
import { track } from "../lib/analytics.js";
import {
  inferToolOk,
  buildToolUsedProps,
  buildVerifyProps,
  buildLoopProps,
  extractSkillName,
} from "../lib/telemetry-events.js";

const exec = promisify(execFileCb);

// ---- Constants & defaults -------------------------------------------------

const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const DEFAULT_BACKPRESSURE_THRESHOLD = 6000;
const DEFAULT_BACKPRESSURE_HEAD = 300;
const DEFAULT_BACKPRESSURE_TAIL = 200;
const DEFAULT_BACKPRESSURE_TOOLS = new Set(["bash", "read", "glob", "grep"]);

type BackpressureShape = "skip" | "head-tail" | "tail" | "head-with-count";

const DEFAULT_PER_TOOL_SHAPES: Record<string, BackpressureShape> = {
  read: "skip", // Read has its own limit/offset; double-truncation violates that contract.
  glob: "skip", // glob output is a path list; middle-truncation makes it unusable.
  bash: "tail", // Failures and exit codes are at the end of the stream.
  grep: "head-with-count", // First N matches verbatim + count tail; middle-truncation breaks match blocks.
};

// For head-with-count: keep the first N complete match blocks.
// Block separator is a blank line (\n\n) which matches ripgrep/grep default output.
const DEFAULT_GREP_HEAD_MATCHES = 20;

// For "tail" shape, bash is high-value per char — use a larger tail budget.
const DEFAULT_BASH_TAIL_CHARS = 4000;

const DEFAULT_VERIFY_TIMEOUT_MS = 15_000;
const TSC_MAX_BUFFER = 2 * 1024 * 1024;
const VERIFY_MAX_ERRORS = 10;

const DEFAULT_LOOP_THRESHOLD = 5;

// ---- Tool-loop guard ------------------------------------------------------
// Catches a model that keeps calling tools without making progress. Two
// signatures, derived from real stalled sessions:
//   - exploration: a long unbroken run of read-only calls (read/grep/glob)
//     with no intervening mutation, command, or subagent — the model researches
//     forever and never converges to an edit or a conclusion.
//   - repeat: the same (tool + args) signature fired over and over, including
//     the same failing call retried — repeating it cannot change the result.
// Intervention escalates: an in-band corrective injected into the tool output
// first, then a hard `session.abort` + re-plan prompt if the loop continues.
const DEFAULT_EXPLORATION_WARN = 12;
const DEFAULT_EXPLORATION_ABORT = 22;
const DEFAULT_REPEAT_WARN = 3;
const DEFAULT_REPEAT_ABORT = 6;
// Rolling window (in tool calls) over which repeat scores are accumulated, so
// an identical call spread across a long session doesn't slowly accrue a false
// positive — only clustered repetition trips it.
const LOOP_WINDOW = 30;
// Read-only "exploration" tools: gathering context, not changing state. Any
// tool NOT classified passive (edit/write/bash/task/...) counts as forward
// progress and resets the exploration streak.
const PASSIVE_TOOLS = new Set(["read", "grep", "glob", "list", "webfetch"]);

// MCP read tools are exploration too. Evidence: a Gemini Flash PRIME session
// (2026-06-11) re-fetched the same Linear issues for an hour — every
// `linear_get_issue` / `linear_list_comments` call counted as "active" under
// the enumerated set above, reset the passive streak, and the exploration
// guard never accumulated a single warning across 15+ consecutive read-only
// calls. Heuristic: underscore-namespaced tools whose verb segment is a read
// verb are passive; any write verb wins (e.g. `linear_save_issue` is active).
// `check` is deliberately NOT a read verb: tsc_check/eslint_check/
// background_check are verify/poll steps that count as forward progress.
const PASSIVE_TOOL_VERB =
  /(^|_)(get|list|search|read|fetch|view|show|describe|query|find)(_|$)/;
const ACTIVE_TOOL_VERB =
  /(^|_)(save|create|update|delete|write|post|add|remove|set|send|run|exec|apply|move|archive|assign|comment|upload|merge|close|edit|start|stop|cancel)(_|$)/;

/** True when a tool call gathers context rather than changing state. */
function isPassiveTool(tool: string): boolean {
  if (PASSIVE_TOOLS.has(tool)) return true;
  if (ACTIVE_TOOL_VERB.test(tool)) return false;
  return PASSIVE_TOOL_VERB.test(tool);
}

// ---- Complexity-delegation hint -------------------------------------------
// A signal DISTINCT from the loop signatures above: the agent is doing real,
// active work (editing, running tests) but the test/build keeps FAILING across
// attempts — the errors may differ each time, so the "same call repeated" and
// "same error twice" rules never fire. That pattern is the fingerprint of
// grinding on inherent complexity. After enough failing verify runs with no
// delegation, suggest (once, softly — never abort) handing the problem to a
// deeper-reasoning subagent. The default agent name matches the harness's
// deep-tier build agent.
const DEFAULT_COMPLEXITY_WARN = 4;
const DEFAULT_DEEP_AGENT = "@build-deep";
// Bounded read-only consult suggested for comprehension gaps (the agent can't
// articulate WHY it's failing) — cheaper than a full deep-tier re-dispatch.
const DEFAULT_CONSULT_AGENT = "@oracle";
// Bash commands that look like running tests / type-checks / builds — i.e. a
// "verify" step. Conservative: only well-known runners, so an ordinary command
// that merely contains "test" in a path doesn't count.
const VERIFY_COMMAND = new RegExp(
  [
    "\\b(vitest|jest|pytest|mocha|ava)\\b",
    "\\b(tsc|tsgo)\\b",
    "\\bcargo\\s+(test|clippy|build|check)\\b",
    "\\bgo\\s+test\\b",
    "\\bbun\\s+test\\b",
    "\\b(pnpm|npm|yarn|bun)\\s+(run\\s+)?(test|build|typecheck|lint|check)\\b",
    "\\bmake\\s+(test|check|build)\\b",
  ].join("|"),
  "i",
);

/** True when a bash command string is a test/build/typecheck "verify" run. */
function isVerifyCommand(command: string): boolean {
  return VERIFY_COMMAND.test(command);
}

// ---- Foreground-sleep guard -------------------------------------------------
// A foreground `sleep N && check` burns the whole turn doing nothing and is
// usually a DUPLICATE of a wait the agent already backgrounded — observed in a
// real session: PRIME backgrounded `sleep 180 && <CI check>`, then ALSO ran a
// foreground `sleep 190 && <same check>`, then ended the turn "waiting" with
// no live watcher. Long inline sleeps are blocked before execution with a
// teaching error; short pauses (retry backoff etc.) pass through.
const DEFAULT_MAX_INLINE_SLEEP_SECONDS = 15;

/**
 * If the bash command leads with a sleep at/over the threshold, return the
 * teaching error message to block it with; otherwise null. Pure.
 */
function checkInlineSleep(
  command: string,
  maxSeconds: number,
): string | null {
  const secs = leadingSleepSeconds(command);
  if (secs === null || secs < maxSeconds) return null;
  return (
    `Blocked: foreground \`sleep ${secs}\` burns the turn doing nothing — and if you already ` +
    `backgrounded a wait for the same condition, this duplicates it. ` +
    `To wait on an external condition (CI, deploy): background ONE watcher that exits when it ` +
    `settles — background_run with \`gh pr checks <pr> --watch\`, \`gh run watch <run-id>\`, or ` +
    `\`until <settled-check>; do sleep 30; done && <status-cmd>\` — then END your turn with a ` +
    `one-line status. The completion ping wakes you the moment it exits. ` +
    `Pauses under ${maxSeconds}s run normally.`
  );
}

// ---- Hook output shape adapters ----------------------------------------------
// Built-in tools reach tool.execute.after as { title, metadata, output:
// string, attachments }. MCP tools reach it as { content: [{type:"text",
// text}, …] } — NO `output` key (verified empirically via
// GLRS_TOOL_HOOKS_DEBUG, 2026-06-11). Every consumer that reads or mutates
// the result text must go through these two adapters, or it silently no-ops
// for MCP tools — which is how the loop guard spent a 20-minute Gemini Flash
// session blind and mute while the model re-fetched the same Linear comments
// nine times.

type HookOutput = {
  output?: unknown;
  content?: unknown[];
};

/** Human-visible text of a tool result, regardless of shape. Null when none. */
function readHookOutput(output: unknown): string | null {
  const o = output as HookOutput;
  if (typeof o?.output === "string") return o.output;
  if (Array.isArray(o?.content)) {
    const texts = o.content
      .filter(
        (c): c is { type: string; text: string } =>
          !!c &&
          (c as { type?: unknown }).type === "text" &&
          typeof (c as { text?: unknown }).text === "string",
      )
      .map((c) => c.text);
    if (texts.length > 0) return texts.join("\n");
  }
  return null;
}

/** Append corrective text to a tool result in whichever shape it has. */
function appendHookOutput(output: unknown, text: string): void {
  const o = output as HookOutput;
  if (typeof o?.output === "string") {
    o.output += text;
    return;
  }
  if (Array.isArray(o?.content)) {
    o.content.push({ type: "text", text });
    return;
  }
  // Last resort — better a stray key than a silent drop.
  (o as { output?: string }).output = text;
}

// ---- Env-gated tool denylist -------------------------------------------------
// GLRS_TOOL_DENYLIST="linear_save_issue,linear_create_*" hard-blocks matching
// tools for the lifetime of the server. Used by sandboxed/experiment runs
// (e.g. harness evals that must not mutate a real issue tracker). The thrown
// error becomes the tool result the model sees, so it teaches the recovery:
// state the intended mutation instead of performing it.

/** Returns the teaching error message when `tool` matches the denylist, else null. Pure. */
function checkToolDenylist(
  tool: string,
  denylist: string | undefined,
): string | null {
  if (!denylist) return null;
  const patterns = denylist
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (patterns.length === 0) return null;
  const matches = patterns.some((p) => picomatch.isMatch(tool, p));
  if (!matches) return null;
  return (
    `Tool "${tool}" is disabled in this sandbox (GLRS_TOOL_DENYLIST). Do NOT retry it ` +
    `or look for an equivalent mutation path. Instead, state precisely what you would ` +
    `have done with it (e.g. the exact comment text or field change) as part of your ` +
    `final answer, and continue with the rest of the task.`
  );
}

// ---- Per-session state ----------------------------------------------------

interface ReadCacheEntry {
  hash: string;
  callSeq: number;
}

interface SessionState {
  editCounts: Map<string, number>;
  readCache: Map<string, ReadCacheEntry>;
  callSeq: number;
  lastVerifyTs: number;
  directory: string | null;
  /** Provider/model ids of the latest assistant message in this session, for telemetry. */
  provider: string | null;
  model: string | null;
  // ---- tool-loop guard state ----
  /** Consecutive passive (read-only) tool calls since the last active call. */
  passiveStreak: number;
  /** Rolling window of recent call signatures (with their weight) for repeat scoring. */
  loopWindow: { sig: string; w: number }[];
  /** Signature → accumulated weight within the window. */
  sigScores: Map<string, number>;
  /** Signature → hash of its most recent output, for identical-result weighting. */
  sigLastOutput: Map<string, string>;
  /** Escalation stage: 0 none, 1 warned, 2 aborted. */
  loopStage: 0 | 1 | 2;
  /**
   * Subagent `task` calls currently in flight on this session. Incremented in
   * tool.execute.before, decremented in after. The hard-abort path is suppressed
   * while this is >0: session.abort would cancel the orchestrator's live
   * children, not just the (non-existent) runaway turn.
   */
  inFlightTasks: number;
  // ---- complexity-delegation hint ----
  /** Failing test/build ("verify") runs seen this session. */
  failedVerifyRuns: number;
  /** Whether the agent has delegated via the `task` tool this session. */
  delegated: boolean;
  /** Whether the complexity-delegation hint has already been emitted. */
  complexitySuggested: boolean;
}

const sessions = new Map<string, SessionState>();

/** Get-or-create the session state without advancing the call sequence. */
function ensureSession(sessionID: string): SessionState {
  let s = sessions.get(sessionID);
  if (!s) {
    s = {
      editCounts: new Map(),
      readCache: new Map(),
      callSeq: 0,
      lastVerifyTs: 0,
      directory: null,
      provider: null,
      model: null,
      passiveStreak: 0,
      loopWindow: [],
      sigScores: new Map(),
      sigLastOutput: new Map(),
      loopStage: 0,
      inFlightTasks: 0,
      failedVerifyRuns: 0,
      delegated: false,
      complexitySuggested: false,
    };
    sessions.set(sessionID, s);
  }
  return s;
}

function getSession(sessionID: string): SessionState {
  const s = ensureSession(sessionID);
  s.callSeq++;
  return s;
}

// ---- Configuration --------------------------------------------------------

interface ToolHooksConfig {
  backpressure: {
    enabled: boolean;
    threshold: number;
    headChars: number;
    tailChars: number;
    tools: Set<string>;
    perTool: Record<
      string,
      {
        threshold?: number;
        headChars?: number;
        tailChars?: number;
        shape: BackpressureShape;
        grepHeadMatches?: number;
      }
    >;
  };
  verifyLoop: {
    enabled: boolean;
    timeoutMs: number;
  };
  loopDetection: {
    enabled: boolean;
    /** Same-file edit warn threshold (legacy checkEditLoop). */
    threshold: number;
    /** Consecutive passive (read-only) calls before warning / hard-abort. */
    explorationWarn: number;
    explorationAbort: number;
    /** Repeated-signature score before warning / hard-abort (failures count 2x). */
    repeatWarn: number;
    repeatAbort: number;
    /** Master switch for the hard `session.abort` escalation. */
    abortEnabled: boolean;
    /** Failing verify (test/build) runs, with no delegation, before suggesting
     * a deeper agent. 0 disables the complexity-delegation hint. */
    complexityWarn: number;
    /** Subagent to suggest when the complexity hint fires. */
    deepAgent: string;
    /** Bounded consult subagent to suggest for comprehension gaps. */
    consultAgent: string;
  };
  readDedup: {
    enabled: boolean;
  };
  sleepGuard: {
    enabled: boolean;
    /** Leading foreground sleeps at/over this many seconds are blocked. */
    maxSeconds: number;
  };
}

function isValidShape(s: unknown): s is BackpressureShape {
  return (
    s === "skip" || s === "head-tail" || s === "tail" || s === "head-with-count"
  );
}

function resolveConfig(config: Config, pluginOptions?: PluginOptions): ToolHooksConfig {
  // Prefer plugin options; fall back to legacy top-level harness key.
  const raw = (pluginOptions?.toolHooks ??
    (config as any).harness?.toolHooks ?? {}) as Record<string, any>;
  const bp = raw.backpressure ?? {};
  const vl = raw.verifyLoop ?? {};
  const ld = raw.loopDetection ?? {};
  const rd = raw.readDedup ?? {};

  // Build perTool: defaults merged with user per-tool overrides.
  const userPerTool =
    bp.perTool && typeof bp.perTool === "object" ? bp.perTool : {};
  const perTool: ToolHooksConfig["backpressure"]["perTool"] = {};
  for (const tool of ["bash", "read", "glob", "grep"]) {
    const u = (userPerTool as Record<string, any>)[tool] ?? {};
    perTool[tool] = {
      threshold: typeof u.threshold === "number" ? u.threshold : undefined,
      headChars: typeof u.headChars === "number" ? u.headChars : undefined,
      tailChars: typeof u.tailChars === "number" ? u.tailChars : undefined,
      shape: isValidShape(u.shape)
        ? u.shape
        : DEFAULT_PER_TOOL_SHAPES[tool] ?? "head-tail",
      grepHeadMatches:
        typeof u.grepHeadMatches === "number" ? u.grepHeadMatches : undefined,
    };
  }

  return {
    backpressure: {
      enabled: bp.enabled !== false,
      threshold: typeof bp.threshold === "number" ? bp.threshold : DEFAULT_BACKPRESSURE_THRESHOLD,
      headChars: typeof bp.headChars === "number" ? bp.headChars : DEFAULT_BACKPRESSURE_HEAD,
      tailChars: typeof bp.tailChars === "number" ? bp.tailChars : DEFAULT_BACKPRESSURE_TAIL,
      tools: Array.isArray(bp.tools)
        ? new Set(bp.tools)
        : DEFAULT_BACKPRESSURE_TOOLS,
      perTool,
    },
    verifyLoop: {
      enabled: vl.enabled !== false,
      timeoutMs:
        typeof vl.timeoutMs === "number" ? vl.timeoutMs : DEFAULT_VERIFY_TIMEOUT_MS,
    },
    loopDetection: {
      enabled: ld.enabled !== false,
      threshold:
        typeof ld.threshold === "number" ? ld.threshold : DEFAULT_LOOP_THRESHOLD,
      explorationWarn:
        typeof ld.explorationWarn === "number"
          ? ld.explorationWarn
          : DEFAULT_EXPLORATION_WARN,
      explorationAbort:
        typeof ld.explorationAbort === "number"
          ? ld.explorationAbort
          : DEFAULT_EXPLORATION_ABORT,
      repeatWarn:
        typeof ld.repeatWarn === "number" ? ld.repeatWarn : DEFAULT_REPEAT_WARN,
      repeatAbort:
        typeof ld.repeatAbort === "number" ? ld.repeatAbort : DEFAULT_REPEAT_ABORT,
      abortEnabled: ld.abortEnabled !== false,
      complexityWarn:
        typeof ld.complexityWarn === "number"
          ? ld.complexityWarn
          : DEFAULT_COMPLEXITY_WARN,
      deepAgent:
        typeof ld.deepAgent === "string" && ld.deepAgent
          ? ld.deepAgent
          : DEFAULT_DEEP_AGENT,
      consultAgent:
        typeof ld.consultAgent === "string" && ld.consultAgent
          ? ld.consultAgent
          : DEFAULT_CONSULT_AGENT,
    },
    readDedup: {
      enabled: rd.enabled !== false,
    },
    sleepGuard: {
      enabled: (raw.sleepGuard?.enabled as boolean | undefined) !== false,
      maxSeconds:
        typeof raw.sleepGuard?.maxSeconds === "number"
          ? raw.sleepGuard.maxSeconds
          : DEFAULT_MAX_INLINE_SLEEP_SECONDS,
    },
  };
}

// ---- Helpers --------------------------------------------------------------

function getToolOutputDir(): string {
  const stateHome =
    process.env["XDG_STATE_HOME"] ||
    path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "harness-opencode", "tool-output");
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function extractFilePath(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const o = args as Record<string, unknown>;
  if (typeof o.filePath === "string") return o.filePath;
  if (typeof o.path === "string") return o.path;
  if (typeof o.file === "string") return o.file;
  return null;
}

/**
 * Heuristic: does the bash output look like a failure?
 * Conservative — uncertain cases are treated as failures so output
 * is preserved.
 */
function looksLikeBashFailure(output: string): boolean {
  // OpenCode's bash tool typically appends exit code info
  // Check for common failure indicators
  if (/Exit code:\s*[1-9]\d*/i.test(output)) return true;
  if (/\bexited with code [1-9]/i.test(output)) return true;
  if (/\bcommand failed\b/i.test(output)) return true;
  if (/\bERROR\b/.test(output) && output.length < 500) return true;
  // Short outputs are unlikely to need backpressure anyway
  return false;
}

/**
 * Resolve the session's working directory via the client API (cached).
 */
async function resolveSessionDir(
  client: OpencodeClient,
  sess: SessionState,
  sessionID: string,
): Promise<string> {
  if (sess.directory) return sess.directory;
  try {
    const r = await client.session.get({ path: { id: sessionID } });
    const data = r.data as { directory?: string } | undefined;
    sess.directory = data?.directory ?? process.cwd();
  } catch {
    sess.directory = process.cwd();
  }
  return sess.directory;
}

// ---- Headroom compression -------------------------------------------------

const HEADROOM_URL = "http://localhost:8787";
const HEADROOM_COMPRESS_TIMEOUT = 10_000;
let headroomAvailable: boolean | null = null;

async function isHeadroomRunning(): Promise<boolean> {
  if (headroomAvailable !== null) return headroomAvailable;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${HEADROOM_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    headroomAvailable = res.ok;
  } catch {
    headroomAvailable = false;
  }
  // Re-check every 5 minutes (proxy might start/stop)
  setTimeout(() => { headroomAvailable = null; }, 5 * 60 * 1000);
  return headroomAvailable;
}

async function tryHeadroomCompress(
  cfg: ToolHooksConfig["backpressure"],
  toolName: string,
  output: { output: string },
): Promise<boolean> {
  if (!cfg.enabled) return false;
  if (!cfg.tools.has(toolName)) return false;

  const text = output.output;
  const threshold = cfg.perTool[toolName]?.threshold ?? cfg.threshold;
  if (text.length <= threshold) return false;

  if (!(await isHeadroomRunning())) return false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEADROOM_COMPRESS_TIMEOUT);
    const res = await fetch(`${HEADROOM_URL}/v1/compress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [{ role: "user", content: text }],
        model: "compression-only",
      }),
    });
    clearTimeout(timer);

    if (!res.ok) return false;

    const data = (await res.json()) as {
      messages?: Array<{ content?: string }>;
      tokens_saved?: number;
    };

    const compressed = data.messages?.[0]?.content;
    if (!compressed || compressed.length >= text.length) return false;

    const saved = text.length - compressed.length;
    output.output = compressed + `\n\n[headroom: ${saved} chars compressed]`;
    return true;
  } catch {
    return false;
  }
}

// ---- Backpressure ---------------------------------------------------------

/** Returns true if `filePath` is within the plugin's tool-output spill dir. */
function isUnderToolOutputDir(filePath: string): boolean {
  try {
    const abs = path.resolve(filePath);
    const spillDir = path.resolve(getToolOutputDir());
    // Simple prefix check — spillDir never ends in trailing slash from path.join.
    return abs === spillDir || abs.startsWith(spillDir + path.sep);
  } catch {
    return false;
  }
}

/**
 * Split a grep-style output into match blocks (blank-line separated),
 * keep the first `maxMatches`, and return the head + count of omitted.
 * Blocks are rejoined with the same \n\n separator they were split on.
 */
function takeGrepHead(
  text: string,
  maxMatches: number,
): { head: string; matchesKept: number; matchesOmitted: number } {
  const blocks = text.split(/\n\n+/);
  if (blocks.length <= maxMatches) {
    return { head: text, matchesKept: blocks.length, matchesOmitted: 0 };
  }
  const kept = blocks.slice(0, maxMatches);
  return {
    head: kept.join("\n\n"),
    matchesKept: kept.length,
    matchesOmitted: blocks.length - maxMatches,
  };
}

function applyBackpressure(
  cfg: ToolHooksConfig["backpressure"],
  toolName: string,
  callID: string,
  output: { output: string },
  args?: unknown,
): void {
  if (!cfg.enabled) return;
  if (!cfg.tools.has(toolName)) return;

  const perTool = cfg.perTool[toolName];
  const shape: BackpressureShape = perTool?.shape ?? "head-tail";

  // Shape "skip" — never truncate this tool's output.
  if (shape === "skip") return;

  // Recovery-read bypass: reading a spill file must never re-truncate.
  if (toolName === "read") {
    const fp = extractFilePath(args);
    if (fp && isUnderToolOutputDir(fp)) return;
  }

  const text = output.output;
  const threshold = perTool?.threshold ?? cfg.threshold;
  if (text.length <= threshold) return;

  // Bash-failure bypass stays FIRST among truncation paths.
  if (toolName === "bash" && looksLikeBashFailure(text)) return;

  // Write full output to disk
  let diskPath: string | null = null;
  try {
    const dir = getToolOutputDir();
    fs.mkdirSync(dir, { recursive: true });
    diskPath = path.join(dir, `${callID}.txt`);
    fs.writeFileSync(diskPath, text);
  } catch {
    // Disk write failed — fall back to in-memory truncation only.
  }

  const pathNote = diskPath ? ` Full output saved to: ${diskPath}` : "";

  if (shape === "tail") {
    const tailChars =
      perTool?.tailChars ??
      (toolName === "bash" ? DEFAULT_BASH_TAIL_CHARS : cfg.tailChars);
    const tail = text.slice(-tailChars);
    const omitted = text.length - tail.length;
    output.output = `... [${omitted} chars truncated — ${text.length} total.${pathNote}]\n\n${tail}`;
    return;
  }

  if (shape === "head-with-count") {
    const maxMatches = perTool?.grepHeadMatches ?? DEFAULT_GREP_HEAD_MATCHES;
    const { head, matchesOmitted } = takeGrepHead(text, maxMatches);
    if (matchesOmitted === 0) {
      // Fewer blocks than limit — fall back to plain head/tail.
      const fallbackHead = text.slice(0, perTool?.headChars ?? cfg.headChars);
      const fallbackTail = text.slice(-(perTool?.tailChars ?? cfg.tailChars));
      const omitted =
        text.length - fallbackHead.length - fallbackTail.length;
      output.output = `${fallbackHead}\n\n... [${omitted} chars truncated — ${text.length} total.${pathNote}]\n\n${fallbackTail}`;
      return;
    }
    const spillNote = diskPath ? ` — full output at ${diskPath}` : "";
    output.output = `${head}\n\n... [${matchesOmitted} more matches${spillNote}]`;
    return;
  }

  // Default shape "head-tail" (current behavior).
  const headChars = perTool?.headChars ?? cfg.headChars;
  const tailChars = perTool?.tailChars ?? cfg.tailChars;
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const omitted = text.length - headChars - tailChars;
  output.output = `${head}\n\n... [${omitted} chars truncated — ${text.length} total.${pathNote}]\n\n${tail}`;
}

// ---- Verification loop ----------------------------------------------------

/**
 * Run `tsc --noEmit` after a TS/JS edit and append any new errors in the edited
 * file to the tool output. Returns the number of errors found in that file
 * (0 = clean), or `null` when the check did not actually run (disabled, not a
 * TS/JS file, debounced, timed out, or errored) — the caller uses this to emit
 * the `post_edit_verify` telemetry event only when a check truly completed.
 */
async function runPostEditVerify(
  cfg: ToolHooksConfig["verifyLoop"],
  client: OpencodeClient,
  sess: SessionState,
  sessionID: string,
  filePath: string,
  output: { output: string },
): Promise<number | null> {
  if (!cfg.enabled) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (!TS_EXTENSIONS.has(ext)) return null;

  // Debounce: skip if we verified < 2s ago
  const now = Date.now();
  if (now - sess.lastVerifyTs < 2000) return null;
  sess.lastVerifyTs = now;

  const cwd = await resolveSessionDir(client, sess, sessionID);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    let raw: string;
    try {
      const { stdout, stderr } = await exec(
        "npx",
        ["tsc", "--noEmit", "--pretty", "false"],
        {
          maxBuffer: TSC_MAX_BUFFER,
          cwd,
          encoding: "utf8",
          signal: controller.signal,
        },
      );
      raw = String(stdout || "");
      if (stderr) raw += `\n${String(stderr)}`;
    } catch (err) {
      const e = err as { stdout?: string; killed?: boolean; code?: string };
      if (e.killed || e.code === "ABORT_ERR") return null; // timeout — skip silently
      raw = String(e.stdout || "");
    } finally {
      clearTimeout(timer);
    }

    if (!raw.trim()) return 0; // clean

    const errors = parseTscOutput(raw);
    // Filter to only errors in the edited file
    const normPath = path.resolve(cwd, filePath);
    const fileErrors = errors.filter((e) => {
      const errPath = path.isAbsolute(e.file)
        ? e.file
        : path.resolve(cwd, e.file);
      return path.normalize(errPath) === path.normalize(normPath);
    });

    if (fileErrors.length === 0) return 0; // clean for this file

    const { rows } = dedupeAndCap(fileErrors, VERIFY_MAX_ERRORS);
    const lines = rows.map(formatRow);

    output.output +=
      `\n\n--- POST-EDIT DIAGNOSTICS (${fileErrors.length} error${fileErrors.length !== 1 ? "s" : ""} in ${path.basename(filePath)}) ---\n` +
      lines.join("\n") +
      `\n--- Fix these before proceeding ---`;
    return fileErrors.length;
  } catch {
    // Any unexpected error — skip verification silently.
    // Never let verification break the edit operation.
    return null;
  }
}

// ---- Loop detection -------------------------------------------------------

function checkEditLoop(
  cfg: ToolHooksConfig["loopDetection"],
  sess: SessionState,
  filePath: string,
  output: { output: string },
): void {
  if (!cfg.enabled) return;

  const count = (sess.editCounts.get(filePath) ?? 0) + 1;
  sess.editCounts.set(filePath, count);

  // Warn at threshold, then at every multiple of threshold
  if (count >= cfg.threshold && count % cfg.threshold === 0) {
    output.output +=
      `\n\n--- LOOP WARNING ---\n` +
      `You've edited ${path.basename(filePath)} ${count} times this session. ` +
      `Consider reconsidering your approach — are you stuck in a loop? ` +
      `Step back and think about whether a different strategy would be more effective.\n` +
      `---`;
  }
}

// ---- Tool-loop guard ------------------------------------------------------

/**
 * Stable signature for a tool call: tool name + its salient args. Used to
 * detect the same call being fired repeatedly. Path-bearing tools key on the
 * path; the rest fall back to a length-capped JSON of the args so distinct
 * calls don't collide and a giant arg blob can't bloat the window.
 */
function normalizeToolSig(tool: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  let detail: string;
  if (typeof a.pattern === "string") {
    // grep/glob — pattern plus optional path/glob scope.
    const scope =
      (typeof a.path === "string" && a.path) ||
      (typeof a.glob === "string" && a.glob) ||
      "";
    detail = `${a.pattern}|${scope}`;
  } else if (typeof a.command === "string") {
    detail = a.command.trim();
  } else {
    const fp = extractFilePath(args);
    if (fp) {
      // Re-reading the exact same slice is a loop; a different offset is not.
      const off = typeof a.offset === "number" ? a.offset : "";
      detail = `${fp}@${off}`;
    } else {
      try {
        detail = JSON.stringify(args);
      } catch {
        detail = "";
      }
    }
  }
  return `${tool}:${detail.slice(0, 200)}`;
}

export type LoopVerdict = {
  level: "none" | "warn" | "abort";
  kind: "explore" | "repeat" | null;
  sig: string;
  /** Repeat score (weighted) or passive streak that drove the verdict. */
  count: number;
  /** True when this call's output was byte-identical to its previous run. */
  identicalResult?: boolean;
};

/**
 * Pure loop detector. Updates the session's rolling window + passive streak and
 * returns the current verdict. Failures weigh double so a call that keeps
 * erroring trips the repeat threshold roughly twice as fast — and so does a
 * call whose output is byte-identical to its previous run: re-fetching data
 * that is already in context is the canonical no-progress signature (a Gemini
 * Flash session re-fetched the same Linear issue for an hour, each call
 * returning identical JSON). Side-effect-free apart from the session-state
 * bookkeeping it owns, so it is unit-testable.
 */
function checkToolLoop(
  cfg: ToolHooksConfig["loopDetection"],
  sess: SessionState,
  tool: string,
  args: unknown,
  ok: boolean,
  outputHash: string | null = null,
): LoopVerdict {
  const sig = normalizeToolSig(tool, args);
  if (!cfg.enabled) return { level: "none", kind: null, sig, count: 0 };

  // Dispatching a subagent is forward progress, never a loop. N parallel `task`
  // calls share a long prompt preamble, so they collide under the 200-char
  // truncated signature and would otherwise trip the repeat guard — whose hard
  // abort calls session.abort on the WHOLE orchestrator session, cancelling the
  // in-flight sibling subagents ("Task cancelled" at spin-up). Treat task as an
  // active call (it resets the passive streak) but never score it for repeats.
  if (tool === "task") {
    sess.passiveStreak = 0;
    return { level: "none", kind: null, sig, count: 0 };
  }

  // Identical-result detection: same signature, same output as last time.
  const identicalResult =
    outputHash !== null && sess.sigLastOutput.get(sig) === outputHash;
  if (outputHash !== null) {
    sess.sigLastOutput.set(sig, outputHash);
    // Bound the map; a long healthy session touches many unique signatures.
    if (sess.sigLastOutput.size > 500) sess.sigLastOutput.clear();
  }

  // Repeat scoring over a bounded window. Failed calls and identical-result
  // re-fetches count double — neither can change anything by being repeated.
  const w = ok && !identicalResult ? 1 : 2;
  sess.loopWindow.push({ sig, w });
  sess.sigScores.set(sig, (sess.sigScores.get(sig) ?? 0) + w);
  while (sess.loopWindow.length > LOOP_WINDOW) {
    const old = sess.loopWindow.shift()!;
    const next = (sess.sigScores.get(old.sig) ?? 0) - old.w;
    if (next <= 0) sess.sigScores.delete(old.sig);
    else sess.sigScores.set(old.sig, next);
  }

  // Exploration streak: passive calls (builtin read tools AND MCP-style read
  // tools — get/list/search/...) advance it; any active (state-changing or
  // verify) call resets it — that is forward progress.
  if (isPassiveTool(tool)) sess.passiveStreak++;
  else sess.passiveStreak = 0;

  const score = sess.sigScores.get(sig) ?? 0;
  const repeat =
    score >= cfg.repeatAbort ? 2 : score >= cfg.repeatWarn ? 1 : 0;
  const explore =
    sess.passiveStreak >= cfg.explorationAbort
      ? 2
      : sess.passiveStreak >= cfg.explorationWarn
        ? 1
        : 0;

  // Prefer the repeat signature when it's at least as severe — it's the more
  // specific, lower-false-positive signal and yields a clearer corrective.
  if (repeat >= explore && repeat > 0) {
    return { level: repeat === 2 ? "abort" : "warn", kind: "repeat", sig, count: score, identicalResult };
  }
  if (explore > 0) {
    return {
      level: explore === 2 ? "abort" : "warn",
      kind: "explore",
      sig,
      count: sess.passiveStreak,
      identicalResult,
    };
  }
  return { level: "none", kind: null, sig, count: 0, identicalResult };
}

/** Corrective text injected into the offending tool's output (in-band nudge). */
function loopCorrective(v: LoopVerdict): string {
  if (v.kind === "repeat") {
    const identical = v.identicalResult
      ? `This output is BYTE-IDENTICAL to what you already received — the data has not changed and is already in your context. `
      : ``;
    return (
      `\n\n--- LOOP WARNING ---\n` +
      `You've issued the same tool call (${v.sig}) repeatedly (weighted score ${v.count}). ` +
      identical +
      `Repeating it will not change the result. Do NOT re-fetch, re-read, or re-confirm ` +
      `anything you already have. Use what you already know, or ` +
      `try a materially different approach. If you're blocked, say so explicitly ` +
      `with a BLOCKED status and what you need.\n---`
    );
  }
  return (
    `\n\n--- LOOP WARNING ---\n` +
    `You've made ${v.count} read-only calls in a row (file reads, searches, ` +
    `issue/API lookups) without editing a file, running a command, dispatching a ` +
    `subagent, or reaching a conclusion. You may be stuck exploring. ` +
    `STOP gathering more context now. State your current hypothesis in one sentence, ` +
    `then either take a concrete action (edit, run, dispatch, or answer the user) or declare ` +
    `BLOCKED with exactly what you're missing.\n---`
  );
}

/** Re-plan directive queued after a hard abort. */
const LOOP_ABORT_PROMPT =
  "You were interrupted by the loop guard after a run of tool calls with no forward " +
  "progress — no edits, no commands, no conclusion. Do NOT resume exploring. " +
  "Summarize what you've already found, state your best current answer or hypothesis, " +
  "and then either take one concrete action or ask the user a specific question. " +
  "If you genuinely cannot proceed, reply with a BLOCKED status naming what you need.";

// ---- Complexity-delegation hint -------------------------------------------

type ComplexityVerdict = { suggest: boolean; fails: number };

/**
 * Track the complexity signal for one tool call and decide whether to emit the
 * one-time delegation hint. Distinct from the loop signatures: it keys on
 * *failing verify runs* (tests/builds that fail), not on repetition or
 * passivity — varied failures across real fix attempts that the repeat/explore
 * checks never catch. Suppressed once the agent delegates (`task`). Pure apart
 * from the session counters it owns.
 */
function checkComplexityHint(
  cfg: ToolHooksConfig["loopDetection"],
  sess: SessionState,
  tool: string,
  command: string | null,
  ok: boolean,
): ComplexityVerdict {
  // Delegating cancels the hint — the agent already reached for help.
  if (tool === "task") sess.delegated = true;
  if (tool === "bash" && command && !ok && isVerifyCommand(command)) {
    sess.failedVerifyRuns++;
  }
  const suggest =
    cfg.enabled &&
    cfg.complexityWarn > 0 &&
    !sess.delegated &&
    !sess.complexitySuggested &&
    sess.failedVerifyRuns >= cfg.complexityWarn;
  if (suggest) sess.complexitySuggested = true;
  return { suggest, fails: sess.failedVerifyRuns };
}

/** Soft, in-band hint suggesting delegation to a deeper-reasoning subagent.
 * Routes by gap type: comprehension gaps (can't articulate WHY it fails) go to
 * the bounded consult agent — diagnosis for a few tool calls — while
 * implementation-depth gaps go to the deep-tier executor. */
function complexityHint(
  deepAgent: string,
  consultAgent: string,
  fails: number,
): string {
  return (
    `\n\n--- COMPLEXITY CHECK ---\n` +
    `You've had ${fails} failing test/build runs this session and haven't delegated. ` +
    `If the gap is comprehension — you can't articulate WHY this fails in one sentence — ` +
    `dispatch ${consultAgent} with that ONE question plus what you've traced (files read, ` +
    `call chain, failed attempts); it's a bounded deep-reasoning consult, far cheaper than ` +
    `more blind retries. If you understand the why but the fix itself needs deep reasoning — ` +
    `a root cause several layers down, subtle cross-module behavior, invariants across ` +
    `transitions — package what you've learned and delegate to ${deepAgent}. ` +
    `If this is ordinary polish, ignore this.\n---`
  );
}

// ---- Read dedup -----------------------------------------------------------

function checkReadDedup(
  cfg: ToolHooksConfig["readDedup"],
  sess: SessionState,
  filePath: string | null,
  output: { output: string },
): boolean {
  if (!cfg.enabled) return false;
  if (!filePath) return false;

  const hash = hashContent(output.output);
  const cached = sess.readCache.get(filePath);

  if (cached && cached.hash === hash) {
    // Content unchanged — replace with pointer
    output.output =
      `[File unchanged since tool call #${cached.callSeq}. ` +
      `Content identical (hash: ${hash}). See earlier read for full text.]`;
    return true;
  }

  // First read or content changed — cache and pass through
  sess.readCache.set(filePath, { hash, callSeq: sess.callSeq });
  return false;
}

// ---- Plugin entry ---------------------------------------------------------

let pluginConfig: ToolHooksConfig | null = null;
let storedPluginOptions: PluginOptions | undefined;

const plugin: Plugin = async ({ client }, options) => {
  storedPluginOptions = options;

  // Tag telemetry with the active dev preset (if any) so analytics can
  // correlate tool/skill outcomes with a given model/prompt configuration.
  const devPreset = process.env["GLRS_DEV_PRESET"] || undefined;

  // Run the loop detector and act on its verdict. `warn` injects a corrective
  // into the tool output (read on the model's next step). `abort` does that
  // AND hard-stops the runaway turn via session.abort, then queues a re-plan
  // prompt — but only once per loop (loopStage gate). After an abort the loop
  // counters reset so a recovered session can be guarded again later. Every
  // branch is wrapped fail-silent: a telemetry/SDK hiccup must never break the
  // tool result we're decorating.
  async function maybeInterveneOnLoop(
    cfg: ToolHooksConfig["loopDetection"],
    sess: SessionState,
    sessionID: string,
    tool: string,
    args: unknown,
    output: unknown,
    ok: boolean,
  ): Promise<void> {
    // Hash the (pre-truncation) result text so identical-result re-fetches
    // can be weighted like failures — re-fetching unchanged data is not
    // progress. readHookOutput handles both built-in ({output: string}) and
    // MCP ({content: [...]}) shapes; hashing only strings also keeps the
    // hook from throwing on exotic shapes (a throw here surfaces as the
    // TOOL failing).
    const outText = readHookOutput(output);
    const outputHash = outText !== null ? hashContent(outText) : null;
    const v = checkToolLoop(cfg, sess, tool, args, ok, outputHash);
    if (v.level === "none" || v.kind === null) return;

    // Never hard-abort while subagents are in flight: session.abort cancels the
    // orchestrator's live children (the parallel-dispatch deadlock). The in-band
    // corrective below still applies; the abort just downgrades to a warn.
    const hardAbort =
      v.level === "abort" &&
      cfg.abortEnabled &&
      sess.loopStage < 2 &&
      sess.inFlightTasks === 0;

    // In-band corrective: always present while looping so the freshest tool
    // output carries it. Cheap and the single highest-recovery intervention.
    // Shape-aware append — for MCP tools this lands in content[], the only
    // place the model actually sees.
    appendHookOutput(output, loopCorrective(v));

    track(
      "loop_detected",
      buildLoopProps({
        tool,
        kind: v.kind,
        level: hardAbort ? "abort" : "warn",
        count: v.count,
        provider: sess.provider ?? undefined,
        model: sess.model ?? undefined,
        ...(devPreset ? { preset: devPreset } : {}),
      }),
    );

    if (!hardAbort) {
      if (sess.loopStage < 1) sess.loopStage = 1;
      return;
    }

    sess.loopStage = 2;
    appendHookOutput(
      output,
      `\n\n--- LOOP ABORTED ---\n` +
        `The loop guard interrupted this turn. ${LOOP_ABORT_PROMPT}\n---`,
    );
    try {
      await client.session.abort({ path: { id: sessionID } });
      await client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: LOOP_ABORT_PROMPT }] },
      });
    } catch {
      // Session gone/busy — the in-band corrective above still applies.
    }
    // Reset counters so a recovered session is judged afresh.
    sess.passiveStreak = 0;
    sess.loopWindow = [];
    sess.sigScores.clear();
    sess.sigLastOutput.clear();
    sess.loopStage = 0;
  }

  return {
    config: async (config: Config) => {
      pluginConfig = resolveConfig(config, storedPluginOptions);
    },

    // Count in-flight subagents so the loop guard never aborts a session that
    // has live children. Fires before the task tool starts; the matching
    // decrement is at the top of tool.execute.after. Also hosts the
    // foreground-sleep guard: throwing here blocks the call, and the model
    // sees the teaching error as the tool result.
    "tool.execute.before": async (
      input: { sessionID: string; tool?: string },
      output?: { args?: Record<string, unknown> },
    ) => {
      // Sandbox denylist first — a denied tool must not affect any other
      // bookkeeping (it never executes).
      if (input.tool) {
        const denied = checkToolDenylist(input.tool, process.env["GLRS_TOOL_DENYLIST"]);
        if (denied) throw new Error(denied);
      }
      if (input.tool === "task") {
        ensureSession(input.sessionID).inFlightTasks++;
        return;
      }
      if (input.tool === "bash") {
        const cfg = pluginConfig ?? resolveConfig({} as Config, storedPluginOptions);
        if (!cfg.sleepGuard.enabled) return;
        const cmd = output?.args?.["command"];
        if (typeof cmd !== "string") return;
        const blocked = checkInlineSleep(cmd, cfg.sleepGuard.maxSeconds);
        if (blocked) throw new Error(blocked);
      }
    },

    // Track the active provider/model per session so tool/verify telemetry can
    // be segmented like `model_turn` already is. The assistant message (which
    // carries providerID/modelID) is created before its tool calls execute, so
    // by the time `tool.execute.after` fires this is populated. Fail-silent.
    event: async ({ event }) => {
      if (event.type !== "message.updated") return;
      const info = (event.properties as { info?: unknown }).info as
        | { role?: string; sessionID?: string; providerID?: string; modelID?: string }
        | undefined;
      if (!info || info.role !== "assistant") return;
      const sessionID = info.sessionID;
      if (!sessionID) return;
      const sess = ensureSession(sessionID);
      if (info.providerID) sess.provider = info.providerID;
      if (info.modelID) sess.model = info.modelID;
    },

    "tool.execute.after": async (input, output) => {
      // GLRS_TOOL_HOOKS_DEBUG=<file> appends one shape-line per call — used to
      // diagnose what the hook actually receives per tool type (built-in vs
      // MCP outputs differ in ways the docs don't state).
      const dbg = process.env["GLRS_TOOL_HOOKS_DEBUG"];
      if (dbg) {
        try {
          const o = output as { output?: unknown };
          fs.appendFileSync(
            dbg,
            JSON.stringify({
              tool: input.tool,
              outputType: typeof o.output,
              outputLen: typeof o.output === "string" ? o.output.length : null,
              keys: Object.keys(output ?? {}),
            }) + "\n",
          );
        } catch {}
      }
      // Config may not yet be resolved on the very first tool call
      // (race between config hook and first tool execution). Use
      // defaults if so.
      const cfg = pluginConfig ?? resolveConfig({} as Config, storedPluginOptions);
      const sess = getSession(input.sessionID);

      const toolName = input.tool;

      // A subagent just finished — drop it from the in-flight count BEFORE the
      // loop guard runs, so the guard sees only the siblings still running. If
      // any remain, the hard-abort stays suppressed (it would cancel them).
      if (toolName === "task") {
        sess.inFlightTasks = Math.max(0, sess.inFlightTasks - 1);
      }

      // Best-effort success signal, read from the ORIGINAL output before dedup/
      // backpressure below mutate it. Reused by telemetry and the loop guard.
      const ok = inferToolOk(
        toolName,
        readHookOutput(output) ?? output.output,
        (output as { metadata?: unknown }).metadata,
      );

      // Telemetry: one `tool_used` event per call, with best-effort success and
      // (for skill invocations) the skill name. Buffered and fire-and-forget —
      // never blocks or throws.
      track(
        "tool_used",
        buildToolUsedProps({
          tool: toolName,
          ok,
          provider: sess.provider ?? undefined,
          model: sess.model ?? undefined,
          skill: extractSkillName(toolName, input.args),
          ...(devPreset ? { preset: devPreset } : {}),
        }),
      );

      // Tool-loop guard: detect a model spinning without progress (repeated
      // calls or a long passive-exploration streak) and intervene — an in-band
      // corrective first, then a hard abort if it keeps going. Runs for EVERY
      // tool so it can reset the streak on active calls. Fail-silent.
      await maybeInterveneOnLoop(cfg.loopDetection, sess, input.sessionID, toolName, input.args, output, ok);

      // Complexity-delegation hint: distinct from the loop guard — keys on
      // repeated FAILING verify runs (not repetition/passivity) and suggests
      // (once, never aborts) handing the problem to a deeper agent.
      {
        const cmd =
          toolName === "bash" &&
          input.args &&
          typeof (input.args as { command?: unknown }).command === "string"
            ? ((input.args as { command: string }).command)
            : null;
        const cx = checkComplexityHint(cfg.loopDetection, sess, toolName, cmd, ok);
        if (cx.suggest) {
          appendHookOutput(
            output,
            complexityHint(
              cfg.loopDetection.deepAgent,
              cfg.loopDetection.consultAgent,
              cx.fails,
            ),
          );
          track(
            "loop_detected",
            buildLoopProps({
              tool: toolName,
              kind: "complexity",
              level: "warn",
              count: cx.fails,
              provider: sess.provider ?? undefined,
              model: sess.model ?? undefined,
              ...(devPreset ? { preset: devPreset } : {}),
            }),
          );
        }
      }

      // 1. Read dedup (runs before backpressure — dedup replaces the
      //    entire output, so backpressure on the replacement is moot)
      if (toolName === "read") {
        const fp = extractFilePath(input.args);
        const deduped = checkReadDedup(cfg.readDedup, sess, fp, output);
        if (deduped) return; // output already replaced
      }

      // 2. Edit-related hooks (verify loop + loop detection)
      if (EDIT_TOOLS.has(toolName)) {
        const fp = extractFilePath(input.args);
        if (fp) {
          // Loop detection (sync, cheap)
          checkEditLoop(cfg.loopDetection, sess, fp, output);
          // Verification loop (async, may append diagnostics)
          const verifyErrors = await runPostEditVerify(
            cfg.verifyLoop,
            client as OpencodeClient,
            sess,
            input.sessionID,
            fp,
            output,
          );
          // Telemetry: emit only when a tsc check actually ran (non-null).
          if (verifyErrors !== null) {
            track(
              "post_edit_verify",
              buildVerifyProps({
                errorCount: verifyErrors,
                tool: toolName,
                provider: sess.provider ?? undefined,
                model: sess.model ?? undefined,
                ...(devPreset ? { preset: devPreset } : {}),
              }),
            );
          }
        }
      }

      // 3. Headroom compression or backpressure (runs last — after verify
      //    loop has had a chance to append diagnostics to edit output)
      const compressed = await tryHeadroomCompress(
        cfg.backpressure,
        toolName,
        output,
      );
      if (!compressed) {
        applyBackpressure(cfg.backpressure, toolName, input.callID, output, input.args);
      }

      // 4. Background-job completion notices. Surface jobs that finished in THIS
      //    session, once, by appending to this tool's output (the safe channel —
      //    never the user message, so no part-schema/persistence issue). Runs
      //    last so it survives backpressure truncation. Skipped on the
      //    background_* tools themselves (they already report). Fail-silent.
      if (!toolName.startsWith("background")) {
        try {
          const announced = announcedFor(input.sessionID);
          const fresh = selectFreshCompletions(
            listJobs(input.sessionID),
            input.sessionID,
            announced,
          );
          if (fresh.length > 0) {
            for (const j of fresh) announced.add(j.id);
            output.output += buildCompletionNotice(fresh);
          }
        } catch {
          // a job-state hiccup must never corrupt a tool result
        }
      }
    },
  };
};

export default plugin;

// ---- Test exports ---------------------------------------------------------

export const __test__ = {
  getSession,
  sessions,
  resolveConfig,
  applyBackpressure,
  checkEditLoop,
  checkToolLoop,
  normalizeToolSig,
  loopCorrective,
  checkComplexityHint,
  complexityHint,
  checkInlineSleep,
  checkToolDenylist,
  readHookOutput,
  appendHookOutput,
  DEFAULT_MAX_INLINE_SLEEP_SECONDS,
  isVerifyCommand,
  checkReadDedup,
  looksLikeBashFailure,
  extractFilePath,
  hashContent,
  getToolOutputDir,
  isUnderToolOutputDir,
  takeGrepHead,
  EDIT_TOOLS,
  TS_EXTENSIONS,
  DEFAULT_BACKPRESSURE_THRESHOLD,
  DEFAULT_LOOP_THRESHOLD,
  DEFAULT_EXPLORATION_WARN,
  DEFAULT_EXPLORATION_ABORT,
  DEFAULT_REPEAT_WARN,
  DEFAULT_REPEAT_ABORT,
  DEFAULT_COMPLEXITY_WARN,
  DEFAULT_DEEP_AGENT,
  DEFAULT_CONSULT_AGENT,
  PASSIVE_TOOLS,
  isPassiveTool,
  DEFAULT_PER_TOOL_SHAPES,
  DEFAULT_GREP_HEAD_MATCHES,
  DEFAULT_BASH_TAIL_CHARS,
};
