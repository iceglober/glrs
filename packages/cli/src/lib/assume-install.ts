/**
 * Install/repair `@glrs-dev/assume` (the `gsa` binary) for `glrs assume`.
 *
 * Two properties beyond the original npm-only repair:
 *
 *  - Resilient: never assume `npm` exists. `glrs` itself runs on Bun, so at
 *    least one JS package manager is always present. We probe npm → bun → pnpm
 *    → yarn and use the first that's installed. If somehow none is, we fail with
 *    a copy-pasteable manual install line instead of a bare "npm not found".
 *
 *  - Idempotent: a working `gsa` already on PATH short-circuits the lazy
 *    install (`ensureGsaInstalled`) to a no-op. `repairAssumeInstall` (the
 *    `init` path) instead converges — it removes deprecated packages and
 *    (re)installs the latest, so repeated runs land on the same end state.
 *
 * History: assume first shipped as `@glorious/assume` (bin `gs-assume`). The
 * scope rename to `@glrs-dev/assume` (bin `glrs-assume`, alias `gsa`) can leave
 * the deprecated package globally installed, shadowing the current one. The
 * legacy cleanup below removes it — but only via npm, since that's the only way
 * it could have been installed.
 *
 * Config migration (the `gs-assume` config dir → `glrs-assume`) happens inside
 * the Rust `gsa init`, which owns config-dir resolution.
 */

import { spawnSync } from "node:child_process";

/** Runs a command, inheriting stdio; returns its exit code. Injectable for tests. */
export type Runner = (cmd: string, args: string[]) => number;

const defaultRunner: Runner = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  return r.status ?? 1;
};

/** Quiet runner for existence probes — no inherited stdio. Injectable for tests. */
const defaultProbe: Runner = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return r.status ?? 1;
};

/** Deprecated packages that fight over the `gsa`/`gs-assume` bin names. */
export const LEGACY_PACKAGES = ["@glorious/assume"] as const;
export const CURRENT_PACKAGE = "@glrs-dev/assume";

/**
 * Global-install recipe for one package manager, listed in preference order.
 * `probeArgs` is a cheap "are you installed" check (exit 0 = present). Only npm
 * carries list/remove recipes — legacy `@glorious/assume` could only have been
 * npm-installed, so that's the only manager we clean up after.
 */
export interface PackageManager {
  name: string;
  probeArgs: string[];
  install: (pkg: string) => string[];
}

export const PACKAGE_MANAGERS: PackageManager[] = [
  { name: "npm", probeArgs: ["--version"], install: (p) => ["i", "-g", p] },
  { name: "bun", probeArgs: ["--version"], install: (p) => ["add", "-g", p] },
  { name: "pnpm", probeArgs: ["--version"], install: (p) => ["add", "-g", p] },
  { name: "yarn", probeArgs: ["--version"], install: (p) => ["global", "add", p] },
];

export interface InstallDeps {
  /** State-changing commands (install/remove) — inherits stdio so the user sees progress. */
  run?: Runner;
  /** Existence checks (`pm --version`, `npm ls`) — quiet. */
  probe?: Runner;
  log?: (msg: string) => void;
  /** Whether a working `gsa` is already reachable; injectable for tests. */
  gsaReady?: () => boolean;
}

/** First package manager whose probe exits 0, or null if none is installed. */
export function detectPackageManager(probe: Runner): PackageManager | null {
  for (const pm of PACKAGE_MANAGERS) {
    if (probe(pm.name, pm.probeArgs) === 0) return pm;
  }
  return null;
}

/** Whether a global npm package is installed (`npm ls -g` exits 0 if present). */
export function isGlobalPackageInstalled(name: string, probe: Runner): boolean {
  return probe("npm", ["ls", "-g", name, "--depth=0"]) === 0;
}

/** Whether `gsa` resolves on PATH and runs. Quiet. */
export function isGsaReady(): boolean {
  return spawnSync("gsa", ["--version"], { stdio: "ignore" }).status === 0;
}

const NO_PM_MESSAGE =
  `[glrs] No JavaScript package manager found (looked for npm, bun, pnpm, yarn).\n` +
  `       Install one, then re-run — or install assume manually, e.g.:\n` +
  `         bun add -g ${CURRENT_PACKAGE}`;

function installFailedMessage(pm: string): string {
  return (
    `[glrs] Failed to install ${CURRENT_PACKAGE} via ${pm}.\n` +
    `       Check your network and that ${pm}'s global bin dir is on PATH, then re-run 'glrs assume init'.`
  );
}

/**
 * Remove deprecated assume packages (npm only, best-effort), then install the
 * latest current package via the first available package manager.
 *
 * Convergent/idempotent: repeated runs reach the same end state. Throws if no
 * package manager is available, or if the load-bearing install fails.
 */
export async function repairAssumeInstall(opts: InstallDeps = {}): Promise<void> {
  const run = opts.run ?? defaultRunner;
  const probe = opts.probe ?? defaultProbe;
  const log = opts.log ?? ((m: string) => process.stderr.write(m + "\n"));

  const pm = detectPackageManager(probe);
  if (!pm) throw new Error(NO_PM_MESSAGE);

  // Legacy cleanup is npm-specific. We probe npm directly (not `pm`), so a
  // Bun-primary machine still gets a stale npm-global legacy package removed.
  if (probe("npm", ["--version"]) === 0) {
    for (const pkg of LEGACY_PACKAGES) {
      if (isGlobalPackageInstalled(pkg, probe)) {
        log(`[glrs] Removing deprecated ${pkg} (conflicts with ${CURRENT_PACKAGE})...`);
        if (run("npm", ["rm", "-g", pkg]) !== 0) {
          log(`[glrs] Warning: could not remove ${pkg} — continuing.`);
        }
      }
    }
  }

  log(`[glrs] Installing latest ${CURRENT_PACKAGE} via ${pm.name}...`);
  if (run(pm.name, pm.install(`${CURRENT_PACKAGE}@latest`)) !== 0) {
    throw new Error(installFailedMessage(pm.name));
  }
}

/**
 * Ensure `gsa` is available for a non-`init` subcommand. Idempotent: a working
 * `gsa` already on PATH returns immediately. Otherwise installs the current
 * package via the first available package manager and re-checks.
 */
export async function ensureGsaInstalled(opts: InstallDeps = {}): Promise<void> {
  const run = opts.run ?? defaultRunner;
  const probe = opts.probe ?? defaultProbe;
  const log = opts.log ?? ((m: string) => process.stderr.write(m + "\n"));
  const gsaReady = opts.gsaReady ?? isGsaReady;

  if (gsaReady()) return; // already installed — no-op

  const pm = detectPackageManager(probe);
  if (!pm) throw new Error(NO_PM_MESSAGE);

  log(`[glrs] gsa not found — installing ${CURRENT_PACKAGE} via ${pm.name}...`);
  if (run(pm.name, pm.install(CURRENT_PACKAGE)) !== 0) {
    throw new Error(installFailedMessage(pm.name));
  }
  if (!gsaReady()) {
    throw new Error(
      `[glrs] Installed ${CURRENT_PACKAGE} via ${pm.name}, but 'gsa' is still not on PATH.\n` +
        `       Add ${pm.name}'s global bin directory to PATH and re-run.`,
    );
  }
}
