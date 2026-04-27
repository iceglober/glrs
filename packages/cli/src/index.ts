/**
 * @glrs-dev/cli — unified CLI for the glrs ecosystem.
 *
 * Provides a single `glrs` binary with subcommands:
 *
 *   glrs oc <args>       → harness-opencode (vendored)
 *   glrs wt <args>       → worktree management commands
 *
 * The harness-opencode code is VENDORED into this package's
 * dist/vendor/harness-opencode/ at build time — users install one
 * package (@glrs-dev/cli) and get both surfaces.
 *
 * Runtime: Bun. The CLI spawns harness-opencode with `bun` explicitly rather
 * than `process.execPath`, because harness-opencode uses bun-native APIs
 * (`bun:sqlite`) that Node cannot load. If `bun` isn't on PATH, dispatch
 * fails with a friendly install hint.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Subcommand = "oc" | "wt";

export interface ResolvedBin {
  /** The executable to invoke. For Bun-based bins, this is always "bun". */
  executable: string;
  /** Arguments to prepend before user-supplied argv (e.g. the JS file path). */
  preArgs: string[];
}

/**
 * Locate the vendored harness-opencode bin.
 *
 * At build time, packages/cli/scripts/vendor-harness.ts copies
 * packages/harness-opencode/dist/ into
 * packages/cli/dist/vendor/harness-opencode/dist/ and drops a stripped
 * package.json alongside. Dev mode (source not built yet) falls back to
 * resolving from the workspace.
 */
function resolveVendoredHarness(binKey: string): ResolvedBin {
  // This file lives at dist/index.js or dist/chunk-*.js at runtime.
  // Go up one level to find dist/, then into vendor/harness-opencode/.
  const here = dirname(fileURLToPath(import.meta.url));
  const vendorPkgJson = pathResolve(here, "vendor", "harness-opencode", "package.json");

  let pkgJsonPath: string;
  try {
    readFileSync(vendorPkgJson, "utf8");
    pkgJsonPath = vendorPkgJson;
  } catch {
    throw new Error(
      `[@glrs-dev/cli] Vendored harness-opencode not found at ${vendorPkgJson}.\n` +
        `  This means the cli package was built incorrectly or the tarball is incomplete.\n` +
        `  Report at https://github.com/iceglober/glrs/issues.`,
    );
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = pkgJson.bin;
  let relative: string;
  if (typeof bin === "string") {
    relative = bin;
  } else if (bin && typeof bin === "object" && typeof bin[binKey] === "string") {
    relative = bin[binKey];
  } else {
    throw new Error(
      `[@glrs-dev/cli] Vendored harness-opencode has no bin entry for '${binKey}'. ` +
        `This shouldn't happen — report at https://github.com/iceglober/glrs/issues.`,
    );
  }
  const binPath = pathResolve(dirname(pkgJsonPath), relative);
  return { executable: "bun", preArgs: [binPath] };
}

export function resolveSubcommand(sub: Subcommand): ResolvedBin {
  switch (sub) {
    case "oc":
      return resolveVendoredHarness("harness-opencode");
    case "wt":
      // Worktree commands are handled natively, not dispatched
      throw new Error("Worktree commands should be handled natively");
    default: {
      const exhaustive: never = sub;
      throw new Error(`Unknown subcommand: ${exhaustive as string}`);
    }
  }
}

export const SUBCOMMANDS: Subcommand[] = ["oc", "wt"];

export const HELP_TEXT = `glrs — unified CLI for the @glrs-dev ecosystem

USAGE
  glrs <subcommand> [args...]

SUBCOMMANDS
  oc         OpenCode agent harness (install, pilot, etc.)
  wt         Worktree management (create, list, switch, delete, cleanup)

Run 'glrs <subcommand> --help' for per-command help.

EXAMPLES
  glrs oc install
  glrs wt new
  glrs wt list
  glrs wt switch

REQUIREMENTS
  Bun >= 1.2.0 on PATH (install: https://bun.sh)

DOCS  https://glrs.dev
ISSUES https://github.com/iceglober/glrs/issues
`;

// Worktree help text
export const WORKTREE_HELP_TEXT = `glrs wt — worktree management

USAGE
  glrs wt <command> [args...]

COMMANDS
  new              Create a new worktree (auto-named from origin/default)
  list, ls         List all worktrees across repos
  switch, sw       Interactively select and switch to a worktree
  delete, rm       Remove worktrees (interactive or by name)
  cleanup          Delete merged/stale worktrees

EXAMPLES
  glrs wt new                    # Create worktree in current repo
  glrs wt new myrepo             # Create worktree for named repo
  glrs wt list                   # Show all worktrees
  glrs wt list -i                # Interactive picker
  glrs wt switch                 # Interactive switcher
  glrs wt delete my-branch       # Delete specific worktree
  glrs wt cleanup                # Clean up merged worktrees

Worktrees are stored in ~/.glorious/worktrees/<repo>/<name>/
`;
