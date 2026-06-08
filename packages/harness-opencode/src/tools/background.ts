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
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
}

/** Enumerate all known jobs with their current status, newest first. */
export function listJobs(): JobSummary[] {
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
    const { status, exitCode } = readJobState(dir);
    out.push({ id: meta.id, command: meta.command, status, exitCode, startedAt: meta.startedAt });
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/**
 * Build the compact banner appended to a user message so the model sees live
 * job state. Shows every running job, plus any finished job NOT already in
 * `surfaced` (surface-once). Returns null when there's nothing worth saying.
 * Caller marks finished ids as surfaced after emitting.
 */
export function buildJobsBanner(
  jobs: JobSummary[],
  surfaced: Set<string>,
  now: number = Date.now(),
): string | null {
  const running = jobs.filter((j) => j.status === "running");
  const finishedNew = jobs.filter(
    (j) => (j.status === "exited" || j.status === "failed") && !surfaced.has(j.id),
  );
  if (running.length === 0 && finishedNew.length === 0) return null;

  const clip = (cmd: string) => cmd.replace(/\s+/g, " ").trim().slice(0, 80);
  const lines = ["[background jobs]"];
  for (const j of running) {
    lines.push(`- ${j.id}  running ${fmtRuntime(j.startedAt, now)}  ·  ${clip(j.command)}`);
  }
  for (const j of finishedNew) {
    const tag =
      j.status === "exited"
        ? `exited(${j.exitCode ?? "?"})${j.exitCode === 0 ? "" : " — FAILED"}`
        : "stopped/crashed";
    lines.push(`- ${j.id}  ${tag}  ·  ${clip(j.command)}`);
  }
  lines.push("Inspect output with background_check(job_id); stop with background_stop(job_id).");
  return lines.join("\n");
}

// ---- tools -----------------------------------------------------------------

const backgroundRunTool = tool({
  description:
    "Launch a long-running shell command in the BACKGROUND and return immediately " +
    "with a job id (sub-second). Use for work that exceeds the ~30s tool timeout — " +
    "backfills, migrations, long builds. The job is detached: it survives the " +
    "timeout AND an MCP-server/opencode restart. Poll it with background_check. " +
    "Set `with_gsa` to a gsa context name to inject AWS credentials (wraps the " +
    "command in `gsa exec`); omit for ordinary commands.",
  args: {
    command: tool.schema.string().describe("Shell command to run (passed to sh -c)"),
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
      withGsa: args.with_gsa ?? null,
      cwd,
      pid,
      startedAt: Date.now(),
    });

    const credLine = args.with_gsa ? ` AWS creds: gsa context "${args.with_gsa}".` : "";
    return (
      `Started background job ${id} (pid ${pid}).${credLine}\n` +
      `Poll: background_check(job_id: "${id}"). Stop: background_stop(job_id: "${id}"). ` +
      `Survives the tool timeout and MCP restarts.`
    );
  },
});

const backgroundCheckTool = tool({
  description:
    "Check a background job's status and recent output. Returns running / exited " +
    "(with exit code) / failed, runtime, and bounded stdout+stderr tails.",
  args: {
    job_id: tool.schema.string().describe("Job id returned by background_run"),
  },
  async execute(args) {
    const dir = jobDir(args.job_id);
    const meta = readMeta(dir);
    if (!meta) return `Unknown job: ${args.job_id}`;

    const { status, exitCode } = readJobState(dir);
    const header =
      status === "exited"
        ? `Job ${meta.id}: exited (code ${exitCode ?? "unknown"})${exitCode === 0 ? "" : " — FAILED"}`
        : status === "running"
          ? `Job ${meta.id}: running (pid ${meta.pid}, ${fmtRuntime(meta.startedAt)})`
          : status === "failed"
            ? `Job ${meta.id}: process gone without recording an exit code (killed or crashed)`
            : `Job ${meta.id}: state unknown`;

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
  description: "List background jobs and their statuses (most recent first).",
  args: {},
  async execute() {
    let ids: string[];
    try {
      ids = fs.readdirSync(jobsRoot());
    } catch {
      return "(no background jobs)";
    }
    const rows = ids
      .map((id) => ({ id, meta: readMeta(jobDir(id)) }))
      .filter((r): r is { id: string; meta: JobMeta } => r.meta !== null)
      .sort((a, b) => b.meta.startedAt - a.meta.startedAt)
      .map(({ id, meta }) => {
        const { status, exitCode } = readJobState(jobDir(id));
        const tag =
          status === "exited" ? `exited(${exitCode ?? "?"})` : status;
        return `${id}  ${tag}  ${fmtRuntime(meta.startedAt)}  ${meta.command.slice(0, 80)}`;
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
