/**
 * Worktree pool — manages git worktrees for the pilot worker.
 *
 * v0.1 hard-codes `workerCount = 1`; v0.3 will lift this. Even at 1
 * worker the pool's job is non-trivial:
 *
 *   - Allocate a worktree directory for each task.
 *   - Reuse the same worktree across tasks (cheaper than add/remove
 *     per task), but reset it cleanly between uses.
 *   - On task failure, "preserve" the worktree (skip the reset) so the
 *     user can inspect what the agent did.
 *
 * The pool is stateful but in-process only — its state lives in a
 * `Map<workerIndex, WorktreeSlot>`. All persistence (which task is
 * running on which worker) belongs to the SQLite state DB.
 *
 * Lifecycle for a single task:
 *
 *   1. `pool.acquire()`              → returns a WorktreeSlot (worker 0 in v0.1).
 *   2. `pool.prepare(slot, task)`    → ensures worktree exists at the
 *                                      slot's path, on a fresh branch
 *                                      `<branchPrefix>/<task.id>`, with
 *                                      a clean working state. Returns
 *                                      the SHA at HEAD (the worker
 *                                      records this as `sinceSha` for
 *                                      `enforceTouches`).
 *   3. (worker runs the task)
 *   4. Either `pool.release(slot)` (clean reset) OR
 *      `pool.preserveOnFailure(slot)` (skip reset, keep state for
 *      inspection — slot retires to `retiredSlots` on the NEXT
 *      `acquire` so downstream tasks can proceed on a fresh path).
 *
 * Ship-checklist alignment: Phase C1 of `PILOT_TODO.md`.
 */

import {
  gitWorktreeAdd,
  gitWorktreeRemove,
  checkoutFreshBranch,
  cleanWorktree,
  headSha,
} from "./git.js";

import { promises as fs } from "node:fs";

// --- Public types ----------------------------------------------------------

/**
 * One slot in the pool — corresponds to one persistent on-disk worktree.
 * v0.1 has exactly one slot; v0.3 will have N.
 */
export type WorktreeSlot = {
  /** 0-indexed worker number. */
  index: number;
  /** Absolute path to the worktree directory. */
  path: string;
  /** True once `prepare` has run at least once for this slot. */
  prepared: boolean;
  /** Set if `preserveOnFailure` was called — slot is "dirty" and unusable. */
  preserved: boolean;
};

export type PoolOptions = {
  /** Path to the main checkout (where `git worktree` is registered). */
  repoPath: string;
  /**
   * Function that, given a worker index, returns the absolute path
   * where that worker's worktree should live. The pilot CLI passes
   * `(n) => getWorktreeDir(cwd, runId, n)` from `paths.ts`.
   */
  worktreeDir: (workerIndex: number) => Promise<string>;
  /**
   * Number of workers. v0.1 hard-codes 1; if a caller passes >1, the
   * pool warns to stderr and clamps to 1 (matching `pilot build`'s
   * `--workers` policy in Phase G4).
   */
  workerCount?: number;
};

// --- Pool implementation ---------------------------------------------------

export class WorktreePool {
  readonly repoPath: string;
  private readonly worktreeDirOf: (n: number) => Promise<string>;
  private readonly slots: Map<number, WorktreeSlot> = new Map();
  /**
   * Slots that were preserved on failure. No longer reachable via
   * `acquire` — they stay here for `shutdown` (so `keepPreserved=false`
   * can still clean them up) and `inspect` (so debug tooling sees them).
   *
   * When a slot is preserved and a subsequent `acquire(n)` happens, the
   * current live slot at index `n` is MOVED here, and `slots` gets a
   * fresh stub at `n` with a bumped `retryCounter`. This is what
   * prevents a single failed task from poisoning every downstream task
   * (the pre-v0.2 bug: one preserve → all subsequent `prepare` calls
   * threw "slot N is preserved").
   */
  private readonly retiredSlots: WorktreeSlot[] = [];
  /**
   * Per-index retry counter. Bumps every time `acquire` retires a
   * preserved slot. Read by `prepare` to decide whether the worktree
   * path needs a `-<counter>` suffix (for retried slots) or the bare
   * `worktreeDirOf(n)` path (first-ever use — back-compat with the
   * existing on-disk layout).
   */
  private readonly retryCounter: Map<number, number> = new Map();
  private readonly workerCount: number;
  /**
   * Set of workers currently held by an `acquire`. v0.1 only ever holds
   * one at a time, but the structure scales to v0.3.
   */
  private readonly busy: Set<number> = new Set();

  constructor(opts: PoolOptions) {
    this.repoPath = opts.repoPath;
    this.worktreeDirOf = opts.worktreeDir;
    const requested = opts.workerCount ?? 1;
    if (requested > 1) {
      process.stderr.write(
        `[pilot] WorktreePool: workerCount=${requested} requested, but v0.1 supports only 1 — clamping.\n`,
      );
    }
    this.workerCount = 1;
  }

  /**
   * Acquire a worker slot. Returns the live slot for the given worker
   * index, or a fresh stub if the current live slot was preserved on
   * failure.
   *
   * v0.1 always uses slot 0. First call returns a fresh stub. If that
   * slot is later `preserveOnFailure`'d, the next `acquire()` retires
   * the preserved slot into `retiredSlots`, bumps the retry counter,
   * and mints a new stub at index 0. The old slot stays on disk (for
   * operator inspection) but is no longer the pool's live slot.
   */
  acquire(): WorktreeSlot {
    for (let n = 0; n < this.workerCount; n++) {
      if (this.busy.has(n)) continue;
      this.busy.add(n);
      const existing = this.slots.get(n);
      // Preserved slots are retired on next acquire; caller gets a
      // fresh stub. The existing `prepare()` guard is still correct
      // defence-in-depth against a caller reusing a stale slot ref.
      if (existing && existing.preserved) {
        this.retiredSlots.push(existing);
        this.slots.delete(n);
        this.retryCounter.set(n, (this.retryCounter.get(n) ?? 0) + 1);
      } else if (existing) {
        return existing;
      }
      // Slot doesn't exist yet (or we just retired the preserved one)
      // — create a fresh stub. The path is filled in lazily on first
      // `prepare` (we don't know `runId` here, and that's the
      // caller's domain).
      const stub: WorktreeSlot = {
        index: n,
        path: "", // filled by prepare
        prepared: false,
        preserved: false,
      };
      this.slots.set(n, stub);
      return stub;
    }
    throw new Error(
      `WorktreePool.acquire: no free worker slots (workerCount=${this.workerCount}, busy=${[...this.busy].join(",")})`,
    );
  }

  /**
   * Prepare a worktree for the given task. Idempotent: on first call,
   * runs `git worktree add`; on subsequent calls, recycles the existing
   * worktree (clean + checkout fresh branch).
   *
   * Returns the SHA at HEAD post-prepare. The worker records this as
   * `sinceSha` for the post-task `enforceTouches` diff.
   *
   * `branchPrefix` typically = `pilot/<plan-slug>`; the actual branch
   * is `<branchPrefix>/<taskId>`. `base` is the commit-ish the branch
   * is created from — usually the main branch's HEAD or a specific
   * sha if reproducibility matters.
   *
   * For retried slots (i.e. `retryCounter[n] > 0`), the resolved path
   * gets a `-<counter>` suffix so retries don't collide with the
   * preserved predecessor on disk.
   */
  async prepare(args: {
    slot: WorktreeSlot;
    taskId: string;
    branchPrefix: string;
    base: string;
  }): Promise<{ sinceSha: string; branch: string; path: string }> {
    if (args.slot.preserved) {
      throw new Error(
        `WorktreePool.prepare: slot ${args.slot.index} is preserved (failed task awaiting cleanup); cannot reuse`,
      );
    }
    const branch = `${args.branchPrefix}/${args.taskId}`;

    if (!args.slot.prepared) {
      // First use: resolve target path and add the worktree. Retried
      // slots (retryCounter > 0) get a `-<counter>` suffix so they
      // live beside the preserved predecessor on disk.
      const basePath = await this.worktreeDirOf(args.slot.index);
      const counter = this.retryCounter.get(args.slot.index) ?? 0;
      const wtPath = counter > 0 ? `${basePath}-${counter}` : basePath;
      args.slot.path = wtPath;

      // Ensure the path doesn't already exist as a stale dir from a
      // previous run that was force-killed. If it does, attempt a
      // remove + delete dance; if that fails, error loudly.
      try {
        await fs.stat(wtPath);
        // Stale dir exists — try to clean it up.
        await gitWorktreeRemove({
          repoPath: this.repoPath,
          worktreePath: wtPath,
        });
        await fs.rm(wtPath, { recursive: true, force: true });
      } catch {
        // Doesn't exist — fine.
      }

      await gitWorktreeAdd({
        repoPath: this.repoPath,
        worktreePath: wtPath,
        commitIsh: args.base,
        branch,
      });
      args.slot.prepared = true;
    } else {
      // Reuse: clean + checkout fresh branch.
      await cleanWorktree(args.slot.path);
      await checkoutFreshBranch({
        worktree: args.slot.path,
        branch,
        base: args.base,
      });
    }

    const sinceSha = await headSha(args.slot.path);
    return { sinceSha, branch, path: args.slot.path };
  }

  /**
   * Release a slot back to the pool — slot becomes available for
   * `acquire` again. Call after a clean task completion (commit
   * succeeded, no preserved state needed).
   *
   * Does NOT clean the worktree — the next `prepare` call will reset
   * it. If you want eager cleanup (e.g. before a long idle), call
   * `cleanWorktree(slot.path)` separately.
   */
  release(slot: WorktreeSlot): void {
    if (!this.busy.has(slot.index)) {
      throw new Error(
        `WorktreePool.release: slot ${slot.index} is not held`,
      );
    }
    this.busy.delete(slot.index);
  }

  /**
   * Preserve a slot's state on failure. The slot is marked preserved
   * and removed from the busy set. Unlike pre-v0.2 behaviour, the
   * next `acquire()` call retires this slot into `retiredSlots` and
   * mints a fresh stub — so a single failure doesn't cascade-block
   * the rest of the run.
   *
   * The CLI's `pilot worktrees prune` (Phase G6) remains the path to
   * permanently remove preserved slots from disk.
   */
  preserveOnFailure(slot: WorktreeSlot): void {
    slot.preserved = true;
    this.busy.delete(slot.index);
  }

  /**
   * Tear down all worktrees managed by this pool — BOTH live and
   * retired. Called at end of `pilot build` (whether success or
   * failure). Preserved slots are skipped when `keepPreserved` is
   * true (the default) — those are the user's to inspect.
   */
  async shutdown(args: { keepPreserved?: boolean } = {}): Promise<void> {
    const keepPreserved = args.keepPreserved ?? true;
    const errors: Error[] = [];
    const all = [...this.slots.values(), ...this.retiredSlots];
    for (const slot of all) {
      if (slot.preserved && keepPreserved) continue;
      if (!slot.prepared || slot.path === "") continue;
      try {
        await gitWorktreeRemove({
          repoPath: this.repoPath,
          worktreePath: slot.path,
        });
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `WorktreePool.shutdown: ${errors.length} worktree removal(s) failed:\n` +
          errors.map((e) => e.message).join("\n---\n"),
      );
    }
  }

  /**
   * Inspect current slots (for tests / `pilot worktrees list`). Returns
   * live slots followed by retired slots, in insertion order within
   * each group.
   */
  inspect(): ReadonlyArray<WorktreeSlot> {
    return [...this.slots.values(), ...this.retiredSlots];
  }
}
