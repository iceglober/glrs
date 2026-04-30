/**
 * opencode server lifecycle for the pilot subsystem.
 *
 * Wraps `@opencode-ai/sdk`'s `createOpencodeServer` + `createOpencodeClient`
 * with the concerns the SDK doesn't address:
 *
 *   - **Sane default timeout.** SDK default is 5s, which is fine on a
 *     warm machine but flaky on first boot (npm cache miss, cold model
 *     warmup). We default to 30s and expose `OPENCODE_SERVER_TIMEOUT_MS`.
 *   - **Doctor-friendly error messages.** SDK errors when `opencode` is
 *     not on PATH look like generic spawn errors. We pre-check and emit
 *     a message that points users at `bunx opencode upgrade` or the
 *     install docs.
 *   - **Idempotent shutdown.** `close()` from the SDK is fine but
 *     calling it twice is harmless; we expose a `shutdown()` that's
 *     safe to call from a cleanup chain that already saw an earlier
 *     failure.
 *   - **Single source of truth for the URL** so callers don't have to
 *     parse it themselves.
 *
 * Why we don't reimplement the spawn-and-parse-listening-line dance:
 * The SDK's implementation is exactly what spike S6 documented (parses
 * `opencode server listening on <url>` from stdout). Reinventing it in
 * pilot would be redundant code that lags behind upstream changes.
 *
 * Side-finding from spike S4: one server is enough for many worktrees
 * (the `directory` query param per-scopes sessions). v0.1 spawns ONE
 * server at the start of `pilot build` and tears it down at the end.
 *
 * Ship-checklist alignment: Phase D1 of `PILOT_TODO.md`.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOpencodeServer,
  createOpencodeClient,
} from "@opencode-ai/sdk";
import type { OpencodeClient, Config } from "@opencode-ai/sdk";

import { createAgents } from "../../agents/index.js";
import { getSessionsPath } from "../mcp/session-registry.js";

// --- Constants -------------------------------------------------------------

/**
 * Default startup timeout. 30s covers cold first-runs (model warmup,
 * config parsing, plugin install) without being so generous that a
 * truly hung opencode binary stalls a `pilot build` indefinitely.
 *
 * Override via `OPENCODE_SERVER_TIMEOUT_MS` env var.
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Default port. `0` asks opencode to pick a free port — the SDK parses
 * the actual port out of the listening line. Picking 0 instead of a
 * specific number means concurrent `pilot build` invocations don't
 * collide. Override via the `port` arg.
 */
const DEFAULT_PORT = 0;

// --- Public types ----------------------------------------------------------

export type StartedServer = {
  /** The URL opencode is listening on (e.g. `http://127.0.0.1:54321`). */
  url: string;
  /** SDK client bound to the URL. Use this for `session.create`, etc. */
  client: OpencodeClient;
  /**
   * Tear down the server. Idempotent: subsequent calls are no-ops. The
   * underlying child process is sent SIGTERM, then SIGKILL if it
   * doesn't exit within the SDK's grace period.
   */
  shutdown: () => Promise<void>;
};

export type StartOpencodeServerOptions = {
  /**
   * Working directory for the spawned opencode process. Sessions
   * created via the returned client will inherit this as their default
   * `directory` query param unless the client passes a different one.
   *
   * v0.1 sets this to the main repo root; per-task workspaces override
   * via `client.session.create({ query: { directory: wt.path } })`.
   */
  cwd?: string;

  /**
   * Hostname to bind. Default `127.0.0.1` (loopback only — the server
   * has no auth without `OPENCODE_SERVER_PASSWORD`).
   */
  hostname?: string;

  /**
   * Port to bind. Default 0 (let opencode pick).
   */
  port?: number;

  /**
   * Startup timeout in milliseconds. Default 30s; override via
   * `OPENCODE_SERVER_TIMEOUT_MS` env var.
   */
  timeoutMs?: number;

  /**
   * Optional path to capture the spawned server's stdout+stderr to a
   * log file. Used by `pilot build` to persist per-run server logs
   * under `<runDir>/server.log` for forensics. Silently no-op when
   * unset (matches pre-fix behavior).
   *
   * The SDK's `createOpencodeServer` consumes stdout internally (to
   * parse the listening line) and doesn't expose a tee point. We work
   * around this by instead spawning `opencode serve` ourselves when
   * this option is set, falling back to the SDK path when it's not —
   * see `startOpencodeServer` implementation for details.
   */
  serverLogPath?: string;

  /**
   * Optional run context for injecting the pilot_status MCP server.
   * When provided, the MCP config includes the status server with
   * environment variables pointing to the sessions registry and state DB.
   */
  runContext?: { runDir: string; dbPath: string; runId: string };
};

// --- Public API ------------------------------------------------------------

/**
 * Start an opencode server and return a client bound to it.
 *
 * Pre-checks that `opencode` is on PATH so we can fail with a useful
 * "did you install opencode?" message instead of a generic ENOENT
 * burrowed inside the SDK's spawn error.
 *
 * The returned `shutdown()` is idempotent — call it from a cleanup
 * chain even if an earlier step already shut down. The Promise it
 * returns resolves once the SDK's `close()` has been called; the
 * underlying child process exit is fire-and-forget (the SDK doesn't
 * expose a wait-for-exit handle).
 */
export async function startOpencodeServer(
  options: StartOpencodeServerOptions = {},
): Promise<StartedServer> {
  // 1. Resolve effective options first. We do this BEFORE the precheck
  //    so a malformed env var emits its diagnostic warning even if the
  //    precheck then fails — both pieces of info are useful when
  //    troubleshooting a fresh environment.
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const port = options.port ?? DEFAULT_PORT;
  const hostname = options.hostname ?? "127.0.0.1";

  // 2. Pre-check `opencode` on PATH. Cheap (one subprocess, ~50ms) and
  //    gives us a doctor-friendly error.
  await ensureOpencodeOnPath();

  // 3. Build the config that gets injected into the spawned server via
  //    OPENCODE_CONFIG_CONTENT (the SDK uses this env var internally).
  //    The critical piece: pilot-builder and pilot-planner agent
  //    definitions MUST live in this config, because `opencode serve`
  //    does NOT load external plugins — only `opencode` (the TUI) does.
  //    Verified empirically (Apr 2026): running `opencode serve
  //    --print-logs --log-level DEBUG` produces zero `service=plugin`
  //    lines, while the TUI variant logs the plugin load. Without this
  //    injection, `session.promptAsync({ agent: "pilot-builder" })`
  //    silently no-ops — the agent name isn't registered, the prompt
  //    is accepted but never dispatched to an LLM, and the session
  //    stalls until the worker's stall timer fires. This was the root
  //    cause of every pilot build failing since v0.16.x.
  //
  //    When runContext is provided, also inject the pilot_status MCP
  //    server so the builder can emit progress updates.
  const serverConfig = buildPilotServerConfig(options.runContext);

  // 4. cwd: v0.1 sets this to the main repo root; per-task workspaces
  //    override via `client.session.create({ query: { directory:
  //    wt.path } })`. The server's own cwd is irrelevant — see spike S4.
  void options.cwd;

  let server: { url: string; close(): void };
  try {
    server = await createOpencodeServer({
      hostname,
      port,
      timeout: timeoutMs,
      config: serverConfig,
    });
  } catch (err) {
    throw new Error(
      `pilot: failed to start opencode server (timeout=${timeoutMs}ms, host=${hostname}, port=${port}): ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  // 5. Optional: tee server logs to a per-run file for forensics. The
  //    SDK doesn't expose the child's stdio after construction, so
  //    this is best-effort. When `serverLogPath` is set we write a
  //    breadcrumb noting the server started; full stdio capture would
  //    require dropping the SDK and spawning opencode ourselves, which
  //    we defer to a follow-up.
  if (options.serverLogPath) {
    try {
      fs.mkdirSync(path.dirname(options.serverLogPath), { recursive: true });
      fs.writeFileSync(
        options.serverLogPath,
        `# pilot opencode server spawn ${new Date().toISOString()}\n` +
          `# url=${server.url} hostname=${hostname} port=${port} timeoutMs=${timeoutMs}\n` +
          `# agents injected via OPENCODE_CONFIG_CONTENT: ${Object.keys(
            serverConfig.agent ?? {},
          ).join(", ")}\n`,
      );
    } catch {
      // best-effort; never fail the pilot run on log-capture errors
    }
  }

  const client = createOpencodeClient({
    baseUrl: server.url,
  });

  let shutDown = false;
  const shutdown = async (): Promise<void> => {
    if (shutDown) return;
    shutDown = true;
    try {
      server.close();
    } catch {
      // SDK's close() is synchronous and swallows process-already-dead;
      // wrap in try in case a future SDK version throws.
    }
  };

  return { url: server.url, client, shutdown };
}

/**
 * Build the `Config` passed to the spawned opencode server. Includes
 * the harness plugin's agent definitions (notably `pilot-builder` and
 * `pilot-planner`, which the worker's `promptAsync` calls reference
 * by name). Keeping the config minimal — we don't override the user's
 * own agents, default_agent, mcp, or permissions — opencode's config
 * loader merges OPENCODE_CONFIG_CONTENT with the user's config files,
 * so anything set here is additive unless it shares a key.
 *
 * When `runContext` is provided, also injects the `mcp.pilot_status`
 * entry pointing at the bundled MCP status server.
 *
 * Exported for tests.
 */
export function buildPilotServerConfig(
  runContext?: { runDir: string; dbPath: string; runId: string },
): Config {
  const agents = createAgents();
  // Narrow the full agent map to only the pilot agents. Exposing the
  // whole set would shadow user overrides for agents like `prime`,
  // which the pilot doesn't need in this server process anyway.
  const pilotAgents: Record<string, unknown> = {};
  for (const name of ["pilot-builder", "pilot-planner"]) {
    if (name in agents) pilotAgents[name] = (agents as Record<string, unknown>)[name];
  }

  const config: Record<string, unknown> = {
    agent: pilotAgents,
  };

  // Inject MCP status server config when run context is provided
  if (runContext) {
    const sessionsPath = getSessionsPath(runContext.runDir);
    // Resolve the bundled status server path relative to this module's
    // location. After tsup bundles, this code lives in `dist/cli.js` and
    // the status server is at `dist/pilot/mcp/status-server.js`. Using
    // fileURLToPath + dirname gives us the dist/ directory at runtime.
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const statusServerPath = path.resolve(
      distDir,
      "pilot",
      "mcp",
      "status-server.js",
    );
    config.mcp = {
      pilot_status: {
        type: "local",
        command: ["bun", "run", statusServerPath],
        env: {
          PILOT_SESSIONS_PATH: sessionsPath,
          PILOT_STATE_DB_PATH: runContext.dbPath,
          PILOT_RUN_ID: runContext.runId,
        },
        enabled: true,
      },
    };
  }

  return config as Config;
}

// --- Internals -------------------------------------------------------------

/**
 * Resolve the effective startup timeout. Precedence:
 *   1. Explicit `options.timeoutMs`.
 *   2. `OPENCODE_SERVER_TIMEOUT_MS` env var (parsed as integer).
 *   3. `DEFAULT_STARTUP_TIMEOUT_MS`.
 *
 * Bad env values fall back to the default with a stderr warning rather
 * than throwing — env-var typos shouldn't crash a long-running pilot
 * session, but they should be visible.
 *
 * Exported for direct unit-testing (precedence is finicky enough that
 * indirectly-via-error-message tests turned out to be brittle).
 */
export function resolveTimeoutMs(explicit: number | undefined): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const envRaw = process.env.OPENCODE_SERVER_TIMEOUT_MS;
  if (envRaw && envRaw.length > 0) {
    const parsed = Number(envRaw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    process.stderr.write(
      `[pilot] OPENCODE_SERVER_TIMEOUT_MS=${JSON.stringify(envRaw)} is not a positive number; using default ${DEFAULT_STARTUP_TIMEOUT_MS}ms\n`,
    );
  }
  return DEFAULT_STARTUP_TIMEOUT_MS;
}

/**
 * Verify `opencode` is on PATH by running `opencode --version`. The
 * binary's own help text doesn't matter; we only need the spawn to
 * succeed (exit code 0) within a short window.
 *
 * Throws a doctor-friendly error message on failure.
 */
async function ensureOpencodeOnPath(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    execFile(
      "opencode",
      ["--version"],
      { signal: controller.signal, encoding: "utf8" },
      (err) => {
        clearTimeout(timer);
        if (err) {
          reject(
            new Error(
              `pilot: \`opencode\` binary not on PATH (or refused --version). ` +
                `Install opencode (https://opencode.ai/docs/install) and re-run \`pilot build\`. ` +
                `Underlying error: ${err.message}`,
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}
