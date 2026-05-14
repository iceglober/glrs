#!/usr/bin/env bun
/**
 * dev-link.ts — symlink the current (or specified) worktree as the active
 * dev build for the `glrs-dev` shell alias.
 *
 * Usage:
 *   bun run dev-link            # symlink the current worktree
 *   bun run dev-link <path>     # symlink a specific worktree
 *
 * The symlink lives at ~/.glrs-dev-active. Pair with a shell alias:
 *
 *   alias glrs-dev='bun ~/.glrs-dev-active/packages/cli/dist/cli.js'
 *
 * Then `glrs-dev oc autopilot "..."` works from anywhere, pointing at
 * whichever worktree is currently linked.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LINK_PATH = path.join(os.homedir(), ".glrs-dev-active");
const CLI_BUNDLE_REL = "packages/cli/dist/cli.js";
const CLI_PACKAGE_JSON_REL = "packages/cli/package.json";

function resolveTarget(rawArg: string | undefined): string {
  if (!rawArg) {
    // No arg — use the current working directory (where the user ran the script).
    // Bun sets INIT_CWD to the directory where `bun run` was invoked, even when
    // package scripts run from the package.json's directory.
    return process.env.INIT_CWD ?? process.cwd();
  }
  // Expand ~ since bun doesn't do shell expansion on args.
  if (rawArg.startsWith("~")) {
    return path.join(os.homedir(), rawArg.slice(1));
  }
  return path.resolve(rawArg);
}

function validateTarget(target: string): void {
  if (!fs.existsSync(target)) {
    console.error(`✗ Target does not exist: ${target}`);
    process.exit(1);
  }
  if (!fs.statSync(target).isDirectory()) {
    console.error(`✗ Target is not a directory: ${target}`);
    process.exit(1);
  }
  const cliPkg = path.join(target, CLI_PACKAGE_JSON_REL);
  if (!fs.existsSync(cliPkg)) {
    console.error(
      `✗ Target is not a glrs worktree (no ${CLI_PACKAGE_JSON_REL}): ${target}`,
    );
    process.exit(1);
  }
}

function link(target: string): void {
  // ln -sfn semantics: remove existing link/file, create new symlink.
  // Using fs instead of spawning ln for portability.
  try {
    const existing = fs.lstatSync(LINK_PATH);
    if (existing.isSymbolicLink() || existing.isFile()) {
      fs.unlinkSync(LINK_PATH);
    } else if (existing.isDirectory()) {
      console.error(
        `✗ ${LINK_PATH} exists and is a real directory (not a symlink).\n` +
        `  Refusing to remove it — move or delete it manually if you want to reuse this path.`,
      );
      process.exit(1);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // Doesn't exist yet — fall through to create.
  }
  fs.symlinkSync(target, LINK_PATH, "dir");
}

function reportBuildStatus(target: string): void {
  const bundle = path.join(target, CLI_BUNDLE_REL);
  if (!fs.existsSync(bundle)) {
    console.log(
      `⚠ ${CLI_BUNDLE_REL} not built yet.\n` +
      `  Run 'bun run build' in the worktree before invoking glrs-dev.`,
    );
  }
}

function firstTimeHint(): void {
  // Check if the user has the shell alias configured.
  // Match literal "alias glrs-dev" or "glrs-dev=" (fish-style function) so
  // we don't false-match on unrelated `glrs-dev` substrings (npm tokens, etc).
  const rcFiles = [".zshrc", ".bashrc", ".bash_profile", ".config/fish/config.fish"];
  const ALIAS_PATTERNS = [/\balias\s+glrs-dev\b/, /\bfunction\s+glrs-dev\b/];
  const hasAlias = rcFiles.some((rc) => {
    const full = path.join(os.homedir(), rc);
    if (!fs.existsSync(full)) return false;
    try {
      const contents = fs.readFileSync(full, "utf-8");
      return ALIAS_PATTERNS.some((re) => re.test(contents));
    } catch {
      return false;
    }
  });
  if (!hasAlias) {
    console.log(
      `\nFirst-time setup: add this to your shell rc:\n\n` +
      `  alias glrs-dev='bun ~/.glrs-dev-active/packages/cli/dist/cli.js'\n`,
    );
  }
}

function main(): void {
  const arg = process.argv[2];
  const target = resolveTarget(arg);
  validateTarget(target);
  link(target);
  console.log(`✓ ${LINK_PATH} → ${target}`);
  reportBuildStatus(target);
  firstTimeHint();
}

main();
