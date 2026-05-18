/**
 * SessionManager — polls event stream files and manages autopilot session lifecycle.
 *
 * Owns a Map of tracked sessions. Polls discovered sessions on an interval,
 * using EventStreamReader.readFrom() in tail mode for incremental updates.
 *
 * Exposes:
 *   getSessions()     — current snapshot of all tracked handles
 *   launchSession()   — spawn a detached autopilot subprocess
 *   killSession()     — send SIGINT to the session's process
 *   retrySession()    — re-launch with --resume
 *   cleanupSession()  — delete event/checkpoint/debug files
 *   start() / stop()  — polling lifecycle
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { EventStreamReader } from "@glrs-dev/autopilot";
import { deriveState } from "@glrs-dev/autopilot";
import type { SessionHandle } from "@glrs-dev/autopilot";
import { discoverSessions } from "./session-discovery.js";
import { createWorktree } from "./lib/worktree.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Poll interval for active sessions (running/enriching/verifying). */
const ACTIVE_POLL_MS = 1_000;
/** Poll interval for completed/stale sessions. */
const IDLE_POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Duration within which a second `k` escalates to SIGKILL. */
const KILL_ESCALATION_MS = 5_000;

interface TrackedSession {
  handle: SessionHandle;
  reader: EventStreamReader;
  offset: number;
  /** PID of the spawned process, if launched by this manager. */
  pid?: number;
  /** Absolute path to the event file. */
  eventFilePath: string;
  /** Timestamp (ms) of the last SIGINT sent, for escalation tracking. */
  lastSigintAt?: number;
}

// ---------------------------------------------------------------------------
// Resolve the CLI entry point for spawning autopilot subprocesses
// ---------------------------------------------------------------------------

/**
 * Find the CLI entry point to use when spawning autopilot subprocesses.
 * Uses the same binary that's currently running (so glrs-dev spawns glrs-dev,
 * not the globally installed glrs).
 */
function resolveCliArgs(): { bin: string; preArgs: string[] } {
  // process.argv[1] is the script being executed (e.g. dist/cli.js)
  const script = process.argv[1];
  if (script) {
    return { bin: process.execPath, preArgs: [script] };
  }
  // Fallback: use glrs from PATH
  return { bin: "glrs", preArgs: [] };
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  planPath: string;
  cwd: string;
  fast?: boolean;
  adapter?: string;
}

export interface LaunchWithWorktreeOptions {
  /** Repo name (used for worktree creation and plan path resolution). */
  repoName: string;
  /** Absolute path to the plan file. */
  planPath: string;
  /** Use --fast mode. */
  fast?: boolean;
}

export class SessionManager {
  private sessions: Map<string, TrackedSession> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastPollMs = 0;

  constructor(private readonly dirs: string[]) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Begin polling discovered sessions. */
  start(): void {
    if (this.pollInterval !== null) return;

    // Initial discovery
    this._discover();

    this.pollInterval = setInterval(() => {
      this._poll();
    }, ACTIVE_POLL_MS);
  }

  /** Stop polling. */
  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Returns a snapshot of all tracked session handles. */
  getSessions(): SessionHandle[] {
    return Array.from(this.sessions.values()).map((t) => t.handle);
  }

  // ---------------------------------------------------------------------------
  // Session operations
  // ---------------------------------------------------------------------------

  /**
   * Launch a new autopilot session as a detached subprocess.
   *
   * Uses the same CLI binary that's currently running (so glrs-dev spawns
   * glrs-dev, not the globally installed glrs).
   *
   * Returns a provisional SessionHandle (status: "running") immediately.
   * The handle will be updated on the next poll once the event file appears.
   */
  launchSession(opts: LaunchOptions): SessionHandle {
    const { planPath, cwd, fast = false } = opts;

    const { bin, preArgs } = resolveCliArgs();
    const args = [...preArgs, "oc", "autopilot", "--plan", planPath];
    if (fast) args.push("--fast");

    const child = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const pid = child.pid;
    const now = new Date().toISOString();

    // Build a provisional handle — will be replaced once events appear
    const provisionalHandle: SessionHandle = {
      id: `provisional-${pid ?? Date.now()}`,
      planPath,
      cwd,
      fast,
      resume: false,
      status: "running",
      totalIterations: 0,
      cost: 0,
      startedAt: now,
      lastEventAt: now,
    };

    // Register the expected event file path so polling picks it up
    const eventFilePath = path.join(cwd, ".agent", "autopilot-events.jsonl");
    const reader = new EventStreamReader(eventFilePath);

    this.sessions.set(provisionalHandle.id, {
      handle: provisionalHandle,
      reader,
      offset: 0,
      pid,
      eventFilePath,
    });

    return provisionalHandle;
  }

  /**
   * Create a fresh worktree and launch an autopilot session in it.
   *
   * Uses `createWorktree({ repo })` which resolves the repo via the
   * worktree registry, repo index, and filesystem scan — the same
   * resolution as `glrs wt new <repo>`.
   *
   * The plan path is resolved into the new worktree if it's inside the repo,
   * or passed as an absolute path if it's external (e.g. ~/.glrs/).
   */
  launchSessionWithWorktree(opts: LaunchWithWorktreeOptions): SessionHandle {
    const { repoName, planPath, fast = false } = opts;

    // createWorktree with just a repo name uses the same resolution as
    // `glrs wt new <repo>`: registry → index → filesystem scan.
    const { wtPath } = createWorktree({ repo: repoName });

    // Resolve the plan path for the new worktree.
    // If the plan is inside the repo (committed to git), it exists in the
    // new worktree at the same relative path. If it's external (e.g. ~/.glrs/),
    // pass the absolute path through.
    let resolvedPlanPath = planPath;

    // Check if the plan path is inside any known clone location for this repo.
    // The worktree was created from the primary clone, so repo-relative paths
    // will exist in the new worktree.
    const repoRoot = this._findRepoRoot(wtPath);
    if (repoRoot && planPath.startsWith(repoRoot)) {
      const relativePlan = path.relative(repoRoot, planPath);
      resolvedPlanPath = path.join(wtPath, relativePlan);
    }

    return this.launchSession({
      planPath: resolvedPlanPath,
      cwd: wtPath,
      fast,
    });
  }

  /**
   * Find the primary clone root from a worktree path by reading .git file.
   */
  private _findRepoRoot(wtPath: string): string | null {
    try {
      const gitFile = path.join(wtPath, ".git");
      const content = fs.readFileSync(gitFile, "utf8").trim();
      const match = content.match(/^gitdir:\s*(.+)$/);
      if (match) {
        // gitdir: /path/to/repo/.git/worktrees/<name>
        const gitWorktreeDir = match[1];
        const dotGitDir = path.resolve(path.dirname(path.dirname(gitWorktreeDir)));
        return path.dirname(dotGitDir);
      }
    } catch {
      // Not a worktree or can't read — return null
    }
    return null;
  }

  /**
   * Send SIGINT to the session's process (graceful kill).
   * If called a second time within KILL_ESCALATION_MS, escalates to SIGKILL.
   * No-op if the session was not launched by this manager or PID is unknown.
   */
  killSession(id: string): void {
    const tracked = this.sessions.get(id);
    if (!tracked?.pid) return;

    const now = Date.now();
    const isEscalation =
      tracked.lastSigintAt !== undefined &&
      now - tracked.lastSigintAt < KILL_ESCALATION_MS;

    const signal = isEscalation ? "SIGKILL" : "SIGINT";

    try {
      process.kill(tracked.pid, signal);
    } catch {
      // Process already dead — ignore
    }

    // Record the time of this kill attempt (for escalation tracking)
    tracked.lastSigintAt = now;
  }

  /**
   * Unconditionally send SIGKILL to the session's process.
   * No-op if the session was not launched by this manager or PID is unknown.
   */
  forceKillSession(id: string): void {
    const tracked = this.sessions.get(id);
    if (!tracked?.pid) return;

    try {
      process.kill(tracked.pid, "SIGKILL");
    } catch {
      // Process already dead — ignore
    }
  }

  /**
   * Re-launch the session with --resume.
   * Finds the session's planPath and cwd, then spawns a new process.
   */
  retrySession(id: string): void {
    const tracked = this.sessions.get(id);
    if (!tracked) return;

    const { planPath, cwd, fast } = tracked.handle;

    const { bin, preArgs } = resolveCliArgs();
    const args = [...preArgs, "oc", "autopilot", "--plan", planPath, "--resume"];
    if (fast) args.push("--fast");

    const child = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Update the tracked session's PID
    if (child.pid !== undefined) {
      tracked.pid = child.pid;
    }
    // Reset offset so we re-read from the beginning (new session:start will appear)
    tracked.offset = 0;
  }

  /**
   * Delete the event file, checkpoint file, and debug log for a session.
   * Removes the session from the tracked map.
   */
  cleanupSession(id: string): void {
    const tracked = this.sessions.get(id);
    if (!tracked) return;

    const agentDir = path.dirname(tracked.eventFilePath);

    const filesToDelete = [
      path.join(agentDir, "autopilot-events.jsonl"),
      path.join(agentDir, "autopilot-checkpoint.json"),
      path.join(agentDir, "autopilot-debug.log"),
      path.join(agentDir, "autopilot-status.json"),
    ];

    for (const f of filesToDelete) {
      try {
        fs.unlinkSync(f);
      } catch {
        // File doesn't exist — ignore
      }
    }

    this.sessions.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Internal polling
  // ---------------------------------------------------------------------------

  /** Discover new sessions from configured dirs. */
  private _discover(): void {
    const discovered = discoverSessions(this.dirs);

    for (const { eventFilePath, handle } of discovered) {
      // Skip if already tracked by event file path
      const alreadyTracked = Array.from(this.sessions.values()).some(
        (t) => t.eventFilePath === eventFilePath,
      );
      if (alreadyTracked) continue;

      const reader = new EventStreamReader(eventFilePath);
      // Read all events to get the initial offset
      const { newOffset } = reader.readFrom(0);

      this.sessions.set(handle.id, {
        handle,
        reader,
        offset: newOffset,
        eventFilePath,
      });
    }
  }

  /** Poll all tracked sessions for new events. */
  private _poll(): void {
    const now = Date.now();

    // Re-discover periodically (every IDLE_POLL_MS)
    if (now - this.lastPollMs >= IDLE_POLL_MS) {
      this._discover();
      this.lastPollMs = now;
    }

    for (const [id, tracked] of this.sessions) {
      // Skip idle polling for completed/stale sessions (only re-check every IDLE_POLL_MS)
      const isIdle =
        tracked.handle.status === "complete" ||
        tracked.handle.status === "stale";
      if (isIdle && now - this.lastPollMs < IDLE_POLL_MS) {
        continue;
      }

      // Read new events since last offset
      const { events, newOffset } = tracked.reader.readFrom(tracked.offset);
      if (events.length === 0) continue;

      tracked.offset = newOffset;

      // Re-derive state from scratch by reading all events
      const allEvents = tracked.reader.readAll();
      const newHandle = deriveState(allEvents);
      if (newHandle) {
        this.sessions.set(id, { ...tracked, handle: newHandle, offset: newOffset });
      }
    }
  }
}
