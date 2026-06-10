/**
 * Background command tools — launch long-running shell commands that outlive a
 * single tool call, then poll them.
 *
 * Why: opencode's MCP/tool request layer cancels a call after ~30s
 * (`-32001 Request timed out`), so a multi-minute backfill/migration can't run
 * inline. These tools spawn the command **detached** (its own process group,
 * stdio redirected to a per-job dir, parent `unref`'d) so it survives both the
 * request timeout and an MCP-server/opencode restart, and record the exit code
 * to disk so a later poll can report it.
 *
 * Credentials: an optional `with_gsa` field takes a gsa context name and wraps
 * the command in `glrs-assume exec -c <ctx>` so AWS credentials are injected —
 * the same capability as the gsa `run_with_credentials` tool, but for the
 * background case. Omit it for ordinary (non-credential) background work; one
 * tool set covers both.
 */

import { tool } from "@opencode-ai/plugin";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

const GSA_BIN = "glrs-assume";
const OUTPUT_TAIL_CHARS = 4000;
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // purge finished jobs older than this

interface JobMeta {
  id: string;
  command: string;
  /** Human label shown in listings/sidebar instead of the raw command. */
  title: string | null;
  /** opencode session that launched the job — for per-session isolation. */
  sessionID: string | null;
  withGsa: string | null;
  cwd: string;
  pid: number;
  startedAt: number;
}

type JobStatus = "running" | "exited" | "failed" | "unknown";

// ---- paths -----------------------------------------------------------------

/** Root dir for background-job state. Honors XDG_STATE_HOME like other tools. */
export function jobsRoot(): string {
  const base =
    process.env["XDG_STATE_HOME"] || path.join(os.homedir(), ".local", "state");
  return path.join(base, "harness-opencode", "background-jobs");
}

function jobDir(id: string): string {
  return path.join(jobsRoot(), id);
}

function newJobId(): string {
  // Date.now()/randomBytes are fine here (normal Node, not a workflow script).
  return `bg-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

// ---- wait discipline (pure, testable) ---------------------------------------

/**
 * Detect a "timer poll" — a command whose leading step is a fixed sleep
 * (e.g. `sleep 180 && <check>`). These are the #1 way an agent strands a
 * session: the job fires once at an arbitrary time; if the awaited state
 * hasn't settled by then, the job is already finished, no watcher remains,
 * and nothing will ever wake the agent — the arc hangs until a human pokes
 * it. A correct watcher exits WHEN the condition settles (an until-loop,
 * `gh pr checks --watch`, `gh run watch`). Returns the leading sleep's
 * seconds, or null when the command doesn't start with a sleep.
 */
export function leadingSleepSeconds(command: string): number | null {
  const m = /^\s*sleep\s+(\d+(?:\.\d+)?)\s*(?:[;&|]|$)/.exec(command);
  return m ? Number(m[1]) : null;
}

/** Teaching rejection for timer-poll background commands. */
export function timerPollRejection(seconds: number): string {
  return (
    `Rejected: this is a single-shot timer poll (leading \`sleep ${seconds}\`). ` +
    `When the sleep elapses the wait is OVER whether or not the thing you're waiting on has settled — ` +
    `if it hasn't, no watcher remains and nothing will ever wake you; the session hangs until the user pokes it.\n\n` +
    `Background a WATCHER that exits only when the condition settles, then end your turn — ` +
    `the completion ping resumes you exactly when there's something to act on:\n` +
    `- PR checks: gh pr checks <pr> --watch   (or gh run watch <run-id>)\n` +
    `- generic:   until <settled-check>; do sleep 30; done && <final-status-command>\n\n` +
    `If you just want the CURRENT state, run the check directly — no sleep, no background job.`
  );
}

// ---- spawn planning (pure, testable) ---------------------------------------

/** Single-quote a string for safe interpolation into an `sh -c` wrapper. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface SpawnPlan {
  file: string;
  argv: string[];
}

/**
 * Build the (file, argv) to spawn. The command runs inside a subshell whose
 * exit status is then recorded to `exitPath` — so even a fully detached process
 * leaves its result on disk. The subshell matters: a bare `exit N` in the
 * command would otherwise terminate the wrapper before the exit code is written;
 * inside `( … )` it only exits the subshell, and `$?` still carries the code.
 * With `withGsa`, the wrapper runs under `glrs-assume exec -c <ctx>`, which
 * injects AWS creds; gsa-injected vars win over any caller `env` because they
 * are set inside the inner exec.
 */
export function buildSpawnPlan(
  command: string,
  exitPath: string,
  withGsa?: string | null,
  gsaBin: string = GSA_BIN,
): SpawnPlan {
  const wrapper = `(\n${command}\n)\nprintf '%s' "$?" > ${shQuote(exitPath)}`;
  if (withGsa) {
    return { file: gsaBin, argv: ["exec", "-c", withGsa, "sh", "-c", wrapper] };
  }
  return { file: "sh", argv: ["-c", wrapper] };
}

// ---- job state -------------------------------------------------------------

function writeMeta(dir: string, meta: JobMeta): void {
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");
}

function readMeta(dir: string): JobMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as JobMeta;
  } catch {
    return null;
  }
}

/** Is a pid still alive? `kill(pid, 0)` probes without signaling. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = gone; EPERM = exists but not ours (still "alive").
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface JobState {
  status: JobStatus;
  exitCode: number | null;
}

/**
 * Determine a job's status from its dir: an `exit_code` file means it finished;
 * otherwise a live pid means running, and a dead pid with no exit code means it
 * died without recording (killed/crashed).
 */
export function readJobState(dir: string): JobState {
  const ecPath = path.join(dir, "exit_code");
  if (fs.existsSync(ecPath)) {
    const raw = fs.readFileSync(ecPath, "utf8").trim();
    const code = Number.parseInt(raw, 10);
    return { status: "exited", exitCode: Number.isFinite(code) ? code : null };
  }
  const meta = readMeta(dir);
  if (!meta) return { status: "unknown", exitCode: null };
  return isAlive(meta.pid)
    ? { status: "running", exitCode: null }
    : { status: "failed", exitCode: null };
}

/** Last `maxChars` of a file, with a truncation marker. */
export function tailFile(p: string, maxChars: number = OUTPUT_TAIL_CHARS): string {
  let s: string;
  try {
    s = fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
  if (s.length <= maxChars) return s;
  return `…[${s.length - maxChars} earlier chars truncated]…\n${s.slice(-maxChars)}`;
}

/** Resolve the gsa binary; null if not on PATH. */
function resolveGsaBin(): string | null {
  try {
    execFileSync("command", ["-v", GSA_BIN], { stdio: "ignore", shell: true });
    return GSA_BIN;
  } catch {
    return null;
  }
}

/** Best-effort purge of finished jobs older than the TTL. */
function cleanupOldJobs(root: string): void {
  let ids: string[];
  try {
    ids = fs.readdirSync(root);
  } catch {
    return;
  }
  const now = Date.now();
  for (const id of ids) {
    const dir = path.join(root, id);
    const meta = readMeta(dir);
    if (!meta) continue;
    if (now - meta.startedAt < JOB_TTL_MS) continue;
    if (readJobState(dir).status === "running") continue; // never reap a live job
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function fmtRuntime(startedAt: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ---- job summaries (shared with the chat.message banner) -------------------

export interface JobSummary {
  id: string;
  command: string;
  /** Human label, when the caller supplied one; else null (fall back to command). */
  title: string | null;
  sessionID: string | null;
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
}

/** What to show in listings: the title if given, else a clipped command. */
export function jobLabel(j: { title: string | null; command: string }): string {
  if (j.title && j.title.trim()) return j.title.trim();
  return j.command.replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Enumerate known jobs with their current status, newest first. When
 * `sessionID` is given, return that session's jobs plus any session-less job
 * (per-session isolation; a `null` sessionID — legacy/un-stamped — is treated
 * as global and shown everywhere). Pass nothing to see every session's jobs.
 */
export function listJobs(sessionID?: string): JobSummary[] {
  let ids: string[];
  try {
    ids = fs.readdirSync(jobsRoot());
  } catch {
    return [];
  }
  const out: JobSummary[] = [];
  for (const id of ids) {
    const dir = jobDir(id);
    const meta = readMeta(dir);
    if (!meta) continue;
    const ms = meta.sessionID ?? null;
    if (sessionID !== undefined && ms !== null && ms !== sessionID) continue;
    const { status, exitCode } = readJobState(dir);
    out.push({
      id: meta.id,
      command: meta.command,
      title: meta.title ?? null,
      sessionID: meta.sessionID ?? null,
      status,
      exitCode,
      startedAt: meta.startedAt,
    });
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/**
 * Pick the just-finished jobs for `sessionID` that haven't been announced yet.
 *
 * Strictly this session's jobs (a `null`/global job is NOT announced — those are
 * accumulated/legacy and would spam every session). The model learns of a
 * completion exactly once, the next time it acts. Pure.
 */
export function selectFreshCompletions(
  jobs: JobSummary[],
  sessionID: string,
  announced: Set<string>,
): JobSummary[] {
  return jobs.filter(
    (j) =>
      j.sessionID === sessionID &&
      (j.status === "exited" || j.status === "failed") &&
      !announced.has(j.id),
  );
}

/**
 * Per-session ledger of job ids already announced to the model — shared by both
 * delivery channels so a completion is surfaced exactly once. The tool-output
 * channel (tool-hooks `tool.execute.after`) and the idle channel
 * (background-notifier on `session.idle`) both read/write the same set, so
 * whichever fires first wins and the other skips. Module-level: opencode runs
 * server plugins in one process, so the Map is shared by import. In-memory and
 * intentionally ephemeral (reset on opencode restart), matching the original
 * #323 design.
 */
const announcedBySession = new Map<string, Set<string>>();

/** Get-or-create the announced-job set for a session. */
export function announcedFor(sessionID: string): Set<string> {
  let s = announcedBySession.get(sessionID);
  if (!s) {
    s = new Set();
    announcedBySession.set(sessionID, s);
  }
  return s;
}

/**
 * Compact, append-to-tool-output notice for finished jobs. This is the SAFE
 * channel: it's added to a tool's textual output (like backpressure/loop-guard),
 * never to the user message — so there's no part-schema or persisted-history
 * problem. Capped; the overflow points at `background_list`.
 */
export function buildCompletionNotice(fresh: JobSummary[], cap = 3): string {
  const shown = fresh.slice(0, cap);
  const lines = shown.map((j) => {
    const tag =
      j.status === "exited"
        ? `exited ${j.exitCode ?? "?"}${j.exitCode === 0 ? "" : " — FAILED"}`
        : "stopped/crashed";
    return `- ${jobLabel(j)} — ${tag}  (background_check job_id: ${j.id})`;
  });
  const more =
    fresh.length > cap ? `\n  (+${fresh.length - cap} more — background_list)` : "";
  const n = fresh.length;
  return `\n\n[background] ${n} job${n === 1 ? "" : "s"} finished:\n${lines.join("\n")}${more}`;
}

/**
 * Wake-up framing for the idle channel. Unlike buildCompletionNotice (appended to
 * a tool's output), this is the whole text of a standalone user turn pushed via
 * promptAsync when the session is idle — so it leads with context and tells the
 * model how to react instead of silently spinning up a turn.
 */
export function buildIdleNotice(fresh: JobSummary[], cap = 3): string {
  const n = fresh.length;
  return (
    `[background] ${n} background job${n === 1 ? "" : "s"} you launched finished while you were idle.` +
    buildCompletionNotice(fresh, cap) +
    "\n\nIf this completes what you were waiting on, continue the work; otherwise acknowledge and stop."
  );
}

// ---- tools -----------------------------------------------------------------

const backgroundRunTool = tool({
  description:
    "Launch a long-running shell command in the BACKGROUND and return immediately " +
    "with a job id (sub-second). Use for work that exceeds the ~30s tool timeout — " +
    "backfills, migrations, long builds. The job is detached: it survives the " +
    "timeout AND an MCP-server/opencode restart. You are notified automatically " +
    "when it finishes — on your next tool call, or proactively if you go idle — so " +
    "do NOT poll background_check in a loop. Go do other work (or wrap up) and the " +
    "completion will reach you; call background_check only when you want output or " +
    "progress before it finishes. " +
    "To WAIT on an external condition (CI, deploy, remote queue), run a command that " +
    "exits WHEN the condition settles — `gh pr checks --watch`, `gh run watch`, or " +
    "`until <check>; do sleep 30; done && <status-cmd>` — never a fixed-delay poll " +
    "(`sleep N && check`, rejected): if the condition hasn't settled when the sleep " +
    "elapses, no watcher remains and nothing will wake you. " +
    "Set `with_gsa` to a gsa context name to inject AWS credentials (wraps the " +
    "command in `gsa exec`); omit for ordinary commands. Pass a short `title` for " +
    "a readable label in listings/sidebar.",
  args: {
    command: tool.schema.string().describe("Shell command to run (passed to sh -c)"),
    title: tool.schema
      .string()
      .optional()
      .describe(
        "Short human label shown in job listings and the sidebar instead of the raw command (e.g. 'Poll PR #2478 checks'). Omit to show the command.",
      ),
    with_gsa: tool.schema
      .string()
      .optional()
      .describe(
        "gsa context name (e.g. 'production / developer') to inject AWS credentials. Omit for a non-credential command.",
      ),
    env: tool.schema
      .record(tool.schema.string(), tool.schema.string())
      .optional()
      .describe("Extra environment variables for the command (string values)."),
    cwd: tool.schema
      .string()
      .optional()
      .describe("Working directory. Defaults to the workspace root."),
  },
  async execute(args, context) {
    const timerSleep = leadingSleepSeconds(args.command);
    if (timerSleep !== null) {
      return timerPollRejection(timerSleep);
    }
    if (args.with_gsa && !resolveGsaBin()) {
      return (
        `Error: with_gsa="${args.with_gsa}" was requested but the gsa binary ` +
        `(${GSA_BIN}) is not on PATH. Install gsa, or omit with_gsa to run without credentials.`
      );
    }
    const root = jobsRoot();
    cleanupOldJobs(root);

    const id = newJobId();
    const dir = jobDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const exitPath = path.join(dir, "exit_code");
    const cwd = args.cwd || context.directory;
    const plan = buildSpawnPlan(args.command, exitPath, args.with_gsa, resolveGsaBin() ?? GSA_BIN);
    const env = { ...process.env, ...(args.env ?? {}) };

    const out = fs.openSync(path.join(dir, "stdout.log"), "a");
    const err = fs.openSync(path.join(dir, "stderr.log"), "a");
    let pid: number | undefined;
    try {
      const child = spawn(plan.file, plan.argv, {
        cwd,
        env,
        detached: true, // own process group → survives parent exit
        stdio: ["ignore", out, err],
      });
      pid = child.pid;
      child.unref();
    } catch (e) {
      return `Error: failed to launch background command: ${(e as Error).message}`;
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
    if (!pid) return "Error: failed to launch background command (no pid).";

    writeMeta(dir, {
      id,
      command: args.command,
      title: args.title?.trim() || null,
      sessionID: context.sessionID ?? null,
      withGsa: args.with_gsa ?? null,
      cwd,
      pid,
      startedAt: Date.now(),
    });

    const credLine = args.with_gsa ? ` AWS creds: gsa context "${args.with_gsa}".` : "";
    return (
      `Started background job ${id} (pid ${pid}).${credLine}\n` +
      `You'll be notified when it finishes — don't poll in a loop. ` +
      `Check output anytime: background_check(job_id: "${id}"). Stop: background_stop(job_id: "${id}"). ` +
      `Survives the tool timeout and MCP restarts.`
    );
  },
});

const backgroundCheckTool = tool({
  description:
    "Optionally inspect a background job's status and recent output — you're told " +
    "automatically when a job finishes, so this is for peeking at progress/output " +
    "before completion, not for polling. Returns running / exited (with exit code) " +
    "/ failed, runtime, and bounded stdout+stderr tails.",
  args: {
    job_id: tool.schema.string().describe("Job id returned by background_run"),
  },
  async execute(args) {
    const dir = jobDir(args.job_id);
    const meta = readMeta(dir);
    if (!meta) return `Unknown job: ${args.job_id}`;

    const { status, exitCode } = readJobState(dir);
    const name = meta.title ? `${meta.id} — ${meta.title}` : meta.id;
    const header =
      status === "exited"
        ? `Job ${name}: exited (code ${exitCode ?? "unknown"})${exitCode === 0 ? "" : " — FAILED"}`
        : status === "running"
          ? `Job ${name}: running (pid ${meta.pid}, ${fmtRuntime(meta.startedAt)})`
          : status === "failed"
            ? `Job ${name}: process gone without recording an exit code (killed or crashed)`
            : `Job ${name}: state unknown`;

    const stdout = tailFile(path.join(dir, "stdout.log"));
    const stderr = tailFile(path.join(dir, "stderr.log"));
    const parts = [header, `command: ${meta.command}`];
    if (stdout) parts.push(`--- stdout ---\n${stdout}`);
    if (stderr) parts.push(`--- stderr ---\n${stderr}`);
    if (!stdout && !stderr) parts.push("(no output yet)");
    return parts.join("\n");
  },
});

const backgroundListTool = tool({
  description:
    "List THIS session's background jobs and their statuses (most recent first). " +
    "Jobs are isolated per session.",
  args: {},
  async execute(_args, context) {
    const now = Date.now();
    const rows = listJobs(context.sessionID).map((j) => {
      const tag = j.status === "exited" ? `exited(${j.exitCode ?? "?"})` : j.status;
      return `${j.id}  ${tag}  ${fmtRuntime(j.startedAt, now)}  ${jobLabel(j)}`;
    });
    return rows.length ? rows.join("\n") : "(no background jobs)";
  },
});

const backgroundStopTool = tool({
  description:
    "Stop a running background job. Terminates the whole process group (the " +
    "command and anything it spawned).",
  args: {
    job_id: tool.schema.string().describe("Job id returned by background_run"),
  },
  async execute(args) {
    const dir = jobDir(args.job_id);
    const meta = readMeta(dir);
    if (!meta) return `Unknown job: ${args.job_id}`;
    if (readJobState(dir).status !== "running") {
      return `Job ${meta.id} is not running; nothing to stop.`;
    }
    try {
      process.kill(-meta.pid, "SIGTERM"); // negative pid → the process group
    } catch {
      try {
        process.kill(meta.pid, "SIGTERM");
      } catch (e) {
        return `Could not stop job ${meta.id}: ${(e as Error).message}`;
      }
    }
    return `Sent SIGTERM to job ${meta.id} (pid ${meta.pid}).`;
  },
});

export const backgroundTools = {
  background_run: backgroundRunTool,
  background_check: backgroundCheckTool,
  background_list: backgroundListTool,
  background_stop: backgroundStopTool,
};

export const __test__ = {
  buildSpawnPlan,
  readJobState,
  tailFile,
  jobsRoot,
  shQuote,
  fmtRuntime,
};
