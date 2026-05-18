/**
 * SessionRunner — extracts the autopilot session lifecycle into a clean,
 * testable class that emits typed SessionEvents.
 *
 * Channel 1: EventEmitter (in-process, consumed by CLI renderer)
 * Channel 2: EventStreamWriter → .agent/autopilot-events.jsonl
 *
 * The runner wraps the existing `runLoopSession` and `enrichPlanForFastModel`
 * functions — it does NOT rewrite them. Events are emitted at the session
 * boundaries (start/done) and at enrichment boundaries. Items 0.5 will add
 * finer-grained events inside loop.ts and loop-session.ts.
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventStreamWriter } from "./event-stream.js";
import type { SessionEvent } from "./session-events.js";
import type { LoopResult } from "./loop.js";
import type { LoopSessionOptions } from "./loop-session-types.js";
import type { AutopilotLogger } from "./lib/logger.js";
import type { StatusState } from "./status.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionRunnerOptions {
  planPath: string;
  cwd: string;
  fast?: boolean;
  resume?: boolean;
  parallel?: number;
  ship?: boolean;
  maxIterationsPerPhase?: number;
  /**
   * The agent adapter (e.g. OpenCodeAdapter). Required for production use.
   * The adapter drives the actual agent CLI — start server, create session,
   * send prompts, wait for idle.
   */
  adapter?: import("./adapter.js").AgentAdapter;
  /**
   * Path for the NDJSON event stream file.
   * Defaults to `<cwd>/.agent/autopilot-events.jsonl`.
   */
  eventStreamPath?: string;
  /**
   * Enrichment configuration (strategy, retry, timeouts).
   * Passed through to enrichPlanForFastModel when --fast is used.
   */
  enrichmentConfig?: {
    strategy?: string;
    retry?: boolean;
    max_retries?: number;
    stall_timeout?: number;
  };
  /**
   * Resolved autopilot configuration from `.glrs/autopilot.yaml`.
   * Passed through to enrichment, loop execution, and debrief for model resolution.
   */
  config?: unknown;
  /**
   * Injectable dependencies for testing.
   * @internal
   */
  _deps?: SessionRunnerDeps;
}

export interface SessionResult {
  planPath: string;
  loopResult: LoopResult;
}

/**
 * Injectable dependencies for testing.
 * @internal
 */
export interface SessionRunnerDeps {
  /** Override enrichPlanForFastModel for testing. */
  enrichPlan?: (cwd: string, planPath: string, logger?: AutopilotLogger) => Promise<void>;
  /** Override runLoopSession for testing. */
  runLoopSession?: (opts: LoopSessionOptions & { _deps?: unknown }) => Promise<LoopResult>;
  /** Override createAutopilotLogger for testing. */
  createLogger?: (opts: { cwd: string }) => AutopilotLogger;
  /** Override EventStreamWriter constructor for testing. */
  createWriter?: (filePath: string) => EventStreamWriter;
}

// ---------------------------------------------------------------------------
// SessionRunner
// ---------------------------------------------------------------------------

/**
 * Typed EventEmitter for SessionEvents. Wraps Node's EventEmitter with a
 * typed `emit` method so callers get type-checked event payloads.
 */
export class SessionEventEmitter extends EventEmitter {
  emitEvent(event: SessionEvent): void {
    // Node's EventEmitter treats "error" as a special event that throws when
    // there are no listeners. Use a prefixed name to avoid that behavior.
    const eventName = event.type === "error" ? "session:error" : event.type;
    this.emit(eventName, event);
    // Also emit a wildcard "event" so listeners can subscribe to all events
    this.emit("event", event);
  }
}

// ---------------------------------------------------------------------------
// Legacy status file bridge
// ---------------------------------------------------------------------------

/** Debounce interval for writing the legacy status file (ms). */
const STATUS_WRITE_INTERVAL_MS = 5_000;

/**
 * Derives a minimal StatusState from accumulated session events and writes
 * it to `.agent/autopilot-status.json` for backward compatibility with
 * consumers that read the legacy status file format.
 *
 * Writes are debounced: at most once every STATUS_WRITE_INTERVAL_MS, plus
 * an immediate write on session:start and session:done.
 */
class LegacyStatusBridge {
  private readonly statusFilePath: string;
  private lastWriteMs = 0;
  private startedAt: number = Date.now();
  private iterationsCompleted = 0;
  private cumulativeCostUsd = 0;
  private phasesCompleted = 0;
  private phaseCount = 0;
  private lastIterationProgress = false;
  private lastIterationErrored = false;

  constructor(cwd: string) {
    this.statusFilePath = path.join(cwd, ".agent", "autopilot-status.json");
  }

  /** Update internal state from an event and conditionally write the file. */
  onEvent(event: SessionEvent): void {
    switch (event.type) {
      case "session:start":
        this.startedAt = Date.now();
        this._writeNow();
        return;

      case "iteration:done":
        this.iterationsCompleted = event.iteration;
        this.lastIterationProgress = event.madeProgress ?? false;
        this.lastIterationErrored = false;
        break;

      case "cost:update":
        this.cumulativeCostUsd = event.cumulativeCostUsd;
        break;

      case "phase:start":
        this.phaseCount = event.total;
        break;

      case "phase:done":
        this.phasesCompleted += 1;
        break;

      case "error":
        this.lastIterationErrored = true;
        break;

      case "session:done":
        if (event.cumulativeCostUsd !== undefined) {
          this.cumulativeCostUsd = event.cumulativeCostUsd;
        }
        this._writeNow();
        return;

      default:
        break;
    }

    // Debounced write for intermediate events
    const now = Date.now();
    if (now - this.lastWriteMs >= STATUS_WRITE_INTERVAL_MS) {
      this._writeNow();
    }
  }

  private _writeNow(): void {
    const now = Date.now();
    this.lastWriteMs = now;

    const state: StatusState = {
      startedAt: this.startedAt,
      iterationsCompleted: this.iterationsCompleted,
      cumulativeCostUsd: this.cumulativeCostUsd,
      lastIterationProgress: this.lastIterationProgress,
      lastIterationErrored: this.lastIterationErrored,
      phaseCount: this.phaseCount > 0 ? this.phaseCount : undefined,
      phasesCompleted: this.phasesCompleted > 0 ? this.phasesCompleted : undefined,
    };

    const snapshot = {
      ...state,
      elapsedMs: now - this.startedAt,
      writtenAt: new Date(now).toISOString(),
    };

    try {
      const dir = path.dirname(this.statusFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${this.statusFilePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
      fs.renameSync(tmp, this.statusFilePath);
    } catch {
      // Non-fatal — legacy bridge failure should not break the session
    }
  }
}

export class SessionRunner {
  /** Channel 1: in-process event emitter. Subscribe to event types or "event" for all. */
  readonly events: SessionEventEmitter;

  private readonly opts: SessionRunnerOptions;
  private _abortController: AbortController | null = null;
  private _abortCount = 0;

  constructor(opts: SessionRunnerOptions) {
    this.opts = opts;
    this.events = new SessionEventEmitter();
  }

  /**
   * Request graceful shutdown. First call signals the running loop session
   * to stop at the next phase boundary (checkpoint is written). Second call
   * force-exits via process.exit(1).
   */
  abort(): void {
    this._abortCount++;
    if (this._abortCount === 1) {
      // First press: graceful abort — signal the loop to stop at next phase boundary
      if (this._abortController) {
        this._abortController.abort();
      }
    } else {
      // Second press: force-exit
      process.exit(1);
    }
  }

  /**
   * Run the autopilot session:
   * 1. Emit session:start
   * 2. If --fast, run enrichment (emitting enrich:* events)
   * 3. Run the loop session (emitting phase:* events via loop-session.ts)
   * 4. Emit session:done
   *
   * Returns a SessionResult with the final LoopResult.
   */
  async run(): Promise<SessionResult> {
    // Create a fresh AbortController for this run so abort() can signal it
    this._abortController = new AbortController();
    this._abortCount = 0;

    const { planPath, cwd, fast, resume, parallel, ship, maxIterationsPerPhase } = this.opts;
    const eventStreamPath =
      this.opts.eventStreamPath ?? path.join(cwd, ".agent", "autopilot-events.jsonl");

    // Resolve injectable deps
    const _createWriter = this.opts._deps?.createWriter ?? ((fp: string) => new EventStreamWriter(fp));
    const _createLogger = this.opts._deps?.createLogger;
    const _enrichPlan = this.opts._deps?.enrichPlan;
    const _runLoopSession = this.opts._deps?.runLoopSession;

    // Open the event stream file
    const writer = _createWriter(eventStreamPath);

    // Legacy status file bridge — writes .agent/autopilot-status.json
    const statusBridge = new LegacyStatusBridge(cwd);

    const emitEvent = (event: SessionEvent): void => {
      this.events.emitEvent(event);
      writer.emit(event);
      statusBridge.onEvent(event);
    };

    // Create the session-wide logger (shared across enrichment + loop)
    let logger: AutopilotLogger | undefined;
    if (_createLogger) {
      logger = _createLogger({ cwd });
    } else {
      const { createAutopilotLogger } = await import("./lib/logger.js");
      logger = createAutopilotLogger({ cwd });
    }

    // Resolve model names from opencode config for display
    let enrichModel = "unknown";
    let executeModel = "unknown";
    try {
      const { join } = await import("node:path");
      const { readFileSync } = await import("node:fs");
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
            const deepArr = models["deep"] ?? models["prime"];
            if (Array.isArray(deepArr) && deepArr[0]) enrichModel = deepArr[0];
            const execArr = models["autopilot-execute"] ?? models["mid-execute"] ?? models["mid"];
            if (Array.isArray(execArr) && execArr[0]) executeModel = execArr[0];
          }
        }
      }
      // Also check top-level model field
      if (typeof config.model === "string" && enrichModel === "unknown") {
        enrichModel = config.model;
      }
    } catch {
      // Config read failure — use "unknown"
    }

    // Emit session:start
    emitEvent({
      type: "session:start",
      timestamp: new Date().toISOString(),
      planPath,
      cwd,
      fast: fast ?? false,
      resume: resume ?? false,
      enrichModel,
      executeModel,
    });

    let loopResult: LoopResult;

    try {
      // Enrichment phase (only when --fast)
      if (fast && planPath) {
        emitEvent({
          type: "enrich:start",
          timestamp: new Date().toISOString(),
          planPath,
          fileCount: 0, // file count is determined inside enrichPlanForFastModel
        });

        try {
          if (_enrichPlan) {
            await _enrichPlan(cwd, planPath, logger);
            // Test-injected enrichPlan doesn't emit events — emit done here.
            emitEvent({
              type: "enrich:done",
              timestamp: new Date().toISOString(),
              filesProcessed: 0,
            });
          } else {
            const { enrichPlanForFastModel } = await import("./plan-enrichment.js");
            await enrichPlanForFastModel(cwd, planPath, logger, this.events, this.opts.adapter, this.opts.enrichmentConfig, this.opts.config);
            // Note: enrichPlanForFastModel emits its own enrich:done event
            // internally — do NOT emit a duplicate here.
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitEvent({
            type: "error",
            timestamp: new Date().toISOString(),
            message: `Enrichment failed: ${message}`,
          });
          // Enrichment failure is non-fatal — continue to execution
        }
      }

      // Execution phase
      const loopOpts: LoopSessionOptions = {
        planPath,
        cwd,
        fast,
        resume,
        parallel,
        ship,
        maxIterationsPerPhase,
        logger,
        emitter: this.events,
        adapter: this.opts.adapter,
        config: this.opts.config,
        signal: this._abortController?.signal,
      };

      if (_runLoopSession) {
        loopResult = await _runLoopSession(loopOpts);
      } else {
        const { runLoopSession } = await import("./loop-session.js");
        loopResult = await runLoopSession(loopOpts);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitEvent({
        type: "error",
        timestamp: new Date().toISOString(),
        message,
      });

      loopResult = {
        exitReason: "error",
        iterations: 0,
        message,
      };
    } finally {
      // Flush the logger
      if (logger) {
        await logger.flush().catch(() => {});
      }
    }

    // Emit session:done
    emitEvent({
      type: "session:done",
      timestamp: new Date().toISOString(),
      exitReason: loopResult.exitReason,
      iterations: loopResult.iterations,
      cumulativeCostUsd: loopResult.cumulativeCostUsd,
      message: loopResult.message,
    });

    writer.close();

    return { planPath, loopResult };
  }
}
