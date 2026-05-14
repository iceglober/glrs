/**
 * Loop session runner for the interactive autopilot orchestrator.
 *
 * Thin wrapper around runRalphLoop that shapes the prompt based on
 * whether the plan is a multi-file directory or a single-file .md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runRalphLoop, type LoopResult, type RalphLoopOptions } from "./loop.js";
import type { LoopSessionOptions } from "./interactive.js";

export type { LoopSessionOptions, LoopResult };

/**
 * Injectable dependencies for testing.
 * @internal
 */
export interface LoopSessionDeps {
  runRalphLoop?: (opts: RalphLoopOptions) => Promise<LoopResult>;
  /** Override filesystem stat check for testing. */
  isDirectory?: (p: string) => boolean;
}

/**
 * Run a headless loop session against a plan.
 *
 * Detects whether planPath is a directory (multi-file plan) or a file
 * (single-file plan) and shapes the prompt accordingly, then delegates
 * to runRalphLoop.
 */
export async function runLoopSession(
  opts: LoopSessionOptions & { _deps?: LoopSessionDeps },
): Promise<LoopResult> {
  const _runRalphLoop = opts._deps?.runRalphLoop ?? runRalphLoop;

  // Determine if the plan is multi-file (directory) or single-file
  const isDirectory = opts._deps?.isDirectory
    ? opts._deps.isDirectory(opts.planPath)
    : (() => {
        try {
          return fs.statSync(opts.planPath).isDirectory();
        } catch {
          return false;
        }
      })();

  let prompt: string;

  if (isDirectory) {
    const mainMd = path.join(opts.planPath, "main.md");
    prompt =
      `Work the plan at ${mainMd}. ` +
      `Find the first unchecked phase in ## Phases and complete all its items. ` +
      `Continue until all phases are checked and all main.md items are checked. ` +
      `Mark items done as they complete.`;
  } else {
    prompt =
      `Work the plan at ${opts.planPath}. ` +
      `Complete all items in ## Acceptance criteria. ` +
      `Mark items done as they complete.`;
  }

  return _runRalphLoop({ prompt, cwd: opts.cwd });
}
