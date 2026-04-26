/**
 * @glrs-dev/cli — unified dispatcher for the glrs ecosystem.
 *
 * Provides a single `glrs` binary with three subcommands, each of which
 * dispatches to the underlying tool:
 *
 *   glrs oc <args>       → harness-opencode <args>
 *   glrs agentic <args>  → gs-agentic <args>
 *   glrs assume <args>   → gs-assume <args>
 *
 * Each underlying package still publishes its own direct bin (`harness-opencode`,
 * `gs-agentic` / `gsag`, `gs-assume` / `gsa`) for power users and existing scripts.
 * The dispatcher exists to give new users one entry point and one thing to install.
 *
 * Resolution strategy:
 *   - For @glrs-dev/harness-opencode and @glrs-dev/agentic we resolve the
 *     package's bin field via its package.json and spawn `node <bin.js>`.
 *   - For @glrs-dev/assume we import getBinaryPath() directly and skip the
 *     TS shim middle-layer — one fewer process startup and zero
 *     double-node-startup latency for interactive credential lookups.
 */

import { createRequire } from "node:module";
import { dirname, resolve as pathResolve } from "node:path";

const require = createRequire(import.meta.url);

export type Subcommand = "oc" | "agentic" | "assume";

export interface ResolvedBin {
  /** The executable to invoke (usually `process.execPath` for node bins). */
  executable: string;
  /** Arguments to prepend before user-supplied argv (e.g. the JS file path). */
  preArgs: string[];
}

/**
 * Resolve a Node-based bin (`.js` file) from a sibling workspace package.
 * Returns `{ executable: node, preArgs: [binPath] }`.
 */
function resolveNodeBin(packageName: string, binKey: string): ResolvedBin {
  const pkgJsonPath = require.resolve(`${packageName}/package.json`);
  const pkgJson = require(pkgJsonPath);
  const bin = pkgJson.bin;
  let relative: string;
  if (typeof bin === "string") {
    relative = bin;
  } else if (bin && typeof bin === "object" && typeof bin[binKey] === "string") {
    relative = bin[binKey];
  } else {
    throw new Error(
      `[@glrs-dev/cli] Package ${packageName} has no bin entry for '${binKey}'. ` +
        `This shouldn't happen — report at https://github.com/iceglober/glrs/issues.`,
    );
  }
  const binPath = pathResolve(dirname(pkgJsonPath), relative);
  return { executable: process.execPath, preArgs: [binPath] };
}

export function resolveSubcommand(sub: Subcommand): ResolvedBin {
  switch (sub) {
    case "oc":
      return resolveNodeBin("@glrs-dev/harness-opencode", "harness-opencode");
    case "agentic":
      return resolveNodeBin("@glrs-dev/agentic", "gs-agentic");
    case "assume": {
      // Delegate directly to the platform-binary resolver in @glrs-dev/assume
      // rather than spawning its TS shim. This saves one node startup cycle.
      // The assume package's src/npm-shim/index.ts exports getBinaryPath().
      const assume = require("@glrs-dev/assume") as {
        getBinaryPath: () => string;
      };
      return { executable: assume.getBinaryPath(), preArgs: [] };
    }
    default: {
      const exhaustive: never = sub;
      throw new Error(`Unknown subcommand: ${exhaustive as string}`);
    }
  }
}

export const SUBCOMMANDS: Subcommand[] = ["oc", "agentic", "assume"];

export const HELP_TEXT = `glrs — unified CLI for the @glrs-dev ecosystem

USAGE
  glrs <subcommand> [args...]

SUBCOMMANDS
  oc         Open code harness (harness-opencode install, pilot, etc.)
  agentic    Agentic CLI (gs-agentic / gsag — worktrees, state, skills)
  assume     SSO credential manager (gs-assume / gsa)

Each subcommand forwards the rest of argv to the underlying tool.
Run 'glrs <subcommand> --help' for per-tool help.

EXAMPLES
  glrs oc install
  glrs agentic wt new my-feature
  glrs assume login aws

Each subtool also ships a direct bin:
  harness-opencode, gs-agentic/gsag, gs-assume/gsa
Use those directly if you prefer.

DOCS  https://glrs.dev
ISSUES https://github.com/iceglober/glrs/issues
`;
