/**
 * Struggle detection for the Ralph loop autopilot engine.
 *
 * Tracks consecutive zero-progress iterations. "Progress" is defined as
 * at least one filesystem write (non-empty `git diff --stat` output)
 * during the iteration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { KILL_SWITCH_PATH } from "./config.js";

/**
 * Tracks consecutive zero-progress iterations and signals when the
 * agent is struggling (no progress for `threshold` consecutive iterations).
 */
export class StruggleDetector {
  private _consecutiveStalls = 0;
  private readonly _threshold: number;

  constructor(threshold: number) {
    this._threshold = threshold;
  }

  /** Number of consecutive stall iterations recorded so far. */
  get consecutiveStalls(): number {
    return this._consecutiveStalls;
  }

  /**
   * Record the result of one iteration.
   * @param madeProgress - true if the agent made filesystem changes this iteration.
   */
  record(madeProgress: boolean): void {
    if (madeProgress) {
      this._consecutiveStalls = 0;
    } else {
      this._consecutiveStalls++;
    }
  }

  /**
   * Returns true if the agent has stalled for `threshold` consecutive
   * iterations without making progress.
   */
  isStruggling(): boolean {
    return this._consecutiveStalls >= this._threshold;
  }
}

/**
 * Returns true if the kill-switch file exists at `.agent/autopilot-disable`
 * relative to `cwd`. The loop should exit immediately when this returns true.
 */
export function checkKillSwitch(cwd: string): boolean {
  const killSwitchFile = path.join(cwd, KILL_SWITCH_PATH);
  return fs.existsSync(killSwitchFile);
}
