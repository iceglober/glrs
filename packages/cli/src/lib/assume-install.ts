/**
 * Repair/migrate a user's assume install during `glrs assume init`.
 *
 * History: assume first shipped as `@glorious/assume` with a `gs-assume` bin.
 * The scope rename to `@glrs-dev/assume` (bin `glrs-assume`, alias `gsa`) can
 * leave the deprecated package globally installed, where its `gsa`/`gs-assume`
 * bin shims shadow or conflict with the current package — a `gsa` on PATH that
 * points at a stale binary. This routine removes the deprecated package and
 * (re)installs the latest current one, so a single `glrs assume init`
 * un-breaks a half-migrated machine.
 *
 * Config migration (the `gs-assume` config dir → `glrs-assume`) happens inside
 * the Rust `gsa init`, which owns config-dir resolution.
 */

import { spawnSync } from "node:child_process";

/** Runs a command and returns its exit code. Injectable for testing. */
export type Runner = (cmd: string, args: string[]) => number;

const defaultRunner: Runner = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  return r.status ?? 1;
};

/** Deprecated packages that fight over the `gsa`/`gs-assume` bin names. */
export const LEGACY_PACKAGES = ["@glorious/assume"] as const;
export const CURRENT_PACKAGE = "@glrs-dev/assume";

export interface RepairOptions {
  run?: Runner;
  log?: (msg: string) => void;
}

/** Whether a global npm package is installed (`npm ls -g` exits 0 if present). */
export function isGlobalPackageInstalled(name: string, run: Runner): boolean {
  return run("npm", ["ls", "-g", name, "--depth=0"]) === 0;
}

/**
 * Remove deprecated assume packages, then install the latest current package.
 *
 * Removing a legacy package is best-effort — a non-zero exit is logged and
 * ignored (it may just not be present). The final install is load-bearing: if
 * it fails, this throws, because `gsa init` can't run without the binary.
 */
export async function repairAssumeInstall(
  opts: RepairOptions = {},
): Promise<void> {
  const run = opts.run ?? defaultRunner;
  const log = opts.log ?? ((m: string) => process.stderr.write(m + "\n"));

  for (const pkg of LEGACY_PACKAGES) {
    if (isGlobalPackageInstalled(pkg, run)) {
      log(`[glrs] Removing deprecated ${pkg} (conflicts with ${CURRENT_PACKAGE})...`);
      if (run("npm", ["rm", "-g", pkg]) !== 0) {
        log(`[glrs] Warning: could not remove ${pkg} — continuing.`);
      }
    }
  }

  log(`[glrs] Installing latest ${CURRENT_PACKAGE}...`);
  if (run("npm", ["i", "-g", `${CURRENT_PACKAGE}@latest`]) !== 0) {
    throw new Error(
      `[glrs] Failed to install ${CURRENT_PACKAGE}. Check npm and your network, then re-run 'glrs assume init'.`,
    );
  }
}
