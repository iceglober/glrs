/**
 * Autopilot run checkpoint persistence.
 *
 * After each phase completes, the multi-phase loop writes a checkpoint
 * to `<cwd>/.agent/autopilot-checkpoint.json`. On startup with
 * `--resume` (or whenever the checkpoint matches the current `--plan`),
 * the loop skips already-completed phases and continues from the next
 * unchecked one.
 *
 * On successful run completion (all phases done), the checkpoint is
 * deleted.
 *
 * Design notes:
 *   - Atomic write via tmp-file + rename (mirrors cost-tracker's rollup
 *     pattern at src/plugins/cost-tracker.ts lines 280-305).
 *   - Read failures (corrupt JSON, missing file, perm denial) return
 *     `null`. This module never throws — failure modes are silent.
 *   - The checkpoint is purely advisory: callers must validate the
 *     `planPath` matches the current run's plan before trusting any
 *     `completedPhases` list.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Checkpoint {
  /**
   * Absolute path to the plan (file or directory) that this checkpoint
   * was created for. Resume only valid when the current --plan matches.
   */
  planPath: string;
  /** Phase filenames that have completed (e.g. ["wave_1.md"]). */
  completedPhases: string[];
  /** Cumulative cost across completed phases, in USD. */
  totalCostUsd: number;
  /** Cumulative iteration count across completed phases. */
  totalIterations: number;
  /** ISO 8601 timestamp of the last write. */
  timestamp: string;
}

/**
 * Injectable filesystem deps for testing. Production code should call
 * the exported functions without `_deps`; tests inject mocks.
 *
 * @internal
 */
export interface CheckpointDeps {
  readFileSync?: (p: string) => string;
  writeFileSync?: (p: string, content: string) => void;
  unlinkSync?: (p: string) => void;
  renameSync?: (from: string, to: string) => void;
  existsSync?: (p: string) => boolean;
  mkdirSync?: (p: string, opts: { recursive: boolean }) => void;
}

const CHECKPOINT_REL_PATH = path.join(".agent", "autopilot-checkpoint.json");

/**
 * Compute the absolute checkpoint file path for a given working dir.
 */
export function checkpointPath(cwd: string): string {
  return path.join(cwd, CHECKPOINT_REL_PATH);
}

/**
 * Atomically write the checkpoint file. Never throws — write errors
 * are swallowed (best-effort persistence; the run continues even if
 * the checkpoint can't be persisted).
 */
export function writeCheckpoint(
  cwd: string,
  state: Checkpoint,
  deps?: CheckpointDeps,
): void {
  const _writeFileSync =
    deps?.writeFileSync ??
    ((p: string, content: string) => fs.writeFileSync(p, content, "utf8"));
  const _renameSync = deps?.renameSync ?? fs.renameSync;
  const _mkdirSync =
    deps?.mkdirSync ??
    ((p: string, opts: { recursive: boolean }) => fs.mkdirSync(p, opts));

  const target = checkpointPath(cwd);
  const dir = path.dirname(target);

  try {
    _mkdirSync(dir, { recursive: true });
  } catch {
    // mkdir failure is fatal for the write — bail.
    return;
  }

  // Atomic rename: write to tmp, then rename onto target. tmp name
  // includes pid + random suffix to avoid collisions.
  const tmp = `${target}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  try {
    _writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    _renameSync(tmp, target);
  } catch {
    // best-effort; swallow write errors so the loop continues.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

/**
 * Read and parse the checkpoint file. Returns `null` if the file is
 * missing, unreadable, or contains corrupt JSON / wrong shape.
 */
export function readCheckpoint(
  cwd: string,
  deps?: CheckpointDeps,
): Checkpoint | null {
  const _readFileSync =
    deps?.readFileSync ?? ((p: string) => fs.readFileSync(p, "utf8"));

  const target = checkpointPath(cwd);
  let raw: string;
  try {
    raw = _readFileSync(target);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Shape validation. Any deviation → null.
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["planPath"] !== "string") return null;
  if (!Array.isArray(obj["completedPhases"])) return null;
  if (!obj["completedPhases"].every((p) => typeof p === "string")) return null;
  if (typeof obj["totalCostUsd"] !== "number") return null;
  if (typeof obj["totalIterations"] !== "number") return null;
  if (typeof obj["timestamp"] !== "string") return null;

  return {
    planPath: obj["planPath"] as string,
    completedPhases: obj["completedPhases"] as string[],
    totalCostUsd: obj["totalCostUsd"] as number,
    totalIterations: obj["totalIterations"] as number,
    timestamp: obj["timestamp"] as string,
  };
}

/**
 * Delete the checkpoint file. Silent on missing / permission errors.
 */
export function deleteCheckpoint(cwd: string, deps?: CheckpointDeps): void {
  const _unlinkSync = deps?.unlinkSync ?? fs.unlinkSync;
  const _existsSync = deps?.existsSync ?? fs.existsSync;
  const target = checkpointPath(cwd);
  try {
    if (_existsSync(target)) {
      _unlinkSync(target);
    }
  } catch {
    // ignore
  }
}
