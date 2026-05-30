/**
 * Auto-update for the glrs CLI.
 *
 * On every invocation, checks if a newer version is available on npm.
 * If yes, installs it globally and re-execs the current command so the
 * user always runs the latest version.
 *
 * Rate-limited: checks at most once per hour (timestamp file).
 * Non-blocking on network failure: if the registry is unreachable, skip silently.
 * Opt-out: set GLRS_AUTO_UPDATE=0 to disable.
 *
 * The update installs @glrs-dev/cli@latest which pulls the harness as
 * a dependency (via the fixed changesets group), so both packages update together.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const PACKAGE_NAME = "@glrs-dev/cli";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REGISTRY_TIMEOUT_MS = 3000;

/** Where we store the last-check timestamp + cached latest version. */
function getStateDir(): string {
  const dir = join(homedir(), ".glrs", "cli");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getStatePath(): string {
  return join(getStateDir(), "auto-update.json");
}

type UpdateState = {
  lastCheckAt: number;
  latestVersion: string | null;
};

function readState(): UpdateState {
  try {
    return JSON.parse(readFileSync(getStatePath(), "utf8"));
  } catch {
    return { lastCheckAt: 0, latestVersion: null };
  }
}

function writeState(state: UpdateState): void {
  try {
    writeFileSync(getStatePath(), JSON.stringify(state), "utf8");
  } catch {
    // Best effort — don't crash the CLI over a state file
  }
}

/**
 * Record a fresh registry result so the rate-limited autoUpdate() picks it
 * up without waiting for the next check window. Called by `glrs upgrade`
 * after it fetches the latest version independently.
 */
export function recordLatestVersion(version: string): void {
  writeState({ lastCheckAt: Date.now(), latestVersion: version });
}

/**
 * Get the currently installed version of @glrs-dev/cli.
 */
function getCurrentVersion(): string | null {
  try {
    const __dirname = import.meta.dir;
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the latest version from the npm registry.
 * Returns null on any failure (network, timeout, parse error).
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
    const res = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings. Returns true if `latest` is newer than `current`.
 */
function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [cMaj, cMin, cPat] = parse(current);
  const [lMaj, lMin, lPat] = parse(latest);
  if (lMaj! > cMaj!) return true;
  if (lMaj! < cMaj!) return false;
  if (lMin! > cMin!) return true;
  if (lMin! < cMin!) return false;
  return lPat! > cPat!;
}

/**
 * Detect whether the CLI is running from a dev checkout (source tree) vs
 * an installed package. If from source, auto-update should be silent —
 * re-exec'ing via PATH would hijack a developer's local build.
 *
 * Heuristic: installed packages always have `/node_modules/` in their
 * resolved path. Source trees (git checkouts, symlinked via `bun link`
 * that resolve through the source tree itself) do not.
 */
function isRunningFromDevCheckout(): boolean {
  // Resolve symlinks so `bun link` / manual symlinks don't fool us.
  const resolvedDir = realpathSync(import.meta.dir);
  return !resolvedDir.includes(`${sep}node_modules${sep}`);
}

/**
 * Run the auto-update check. Call this at the top of cli.ts.
 *
 * Returns true if the CLI was updated and the process should re-exec.
 * Returns false if no update needed or update failed.
 */
export async function autoUpdate(): Promise<boolean> {
  // Opt-out
  if (process.env["GLRS_AUTO_UPDATE"] === "0") return false;

  // Don't update during CI or non-interactive environments
  if (process.env["CI"]) return false;

  // Don't recurse — if we're already in an update, skip
  if (process.env["GLRS_UPDATING"] === "1") return false;

  // Don't auto-update dev checkouts — re-exec'ing via PATH would jump
  // out of the user's local build into whatever global version is
  // installed. That defeats the whole point of running from source.
  if (isRunningFromDevCheckout()) return false;

  const currentVersion = getCurrentVersion();
  if (!currentVersion) return false;

  const state = readState();
  const now = Date.now();

  // Rate limit: check at most once per hour
  if (now - state.lastCheckAt < CHECK_INTERVAL_MS) {
    // Use cached latest version if available
    if (state.latestVersion && isNewer(currentVersion, state.latestVersion)) {
      return doUpdate(currentVersion, state.latestVersion);
    }
    return false;
  }

  // Fetch latest version from registry
  const latestVersion = await fetchLatestVersion();

  // Update state regardless of result
  writeState({ lastCheckAt: now, latestVersion });

  if (!latestVersion) return false;
  if (!isNewer(currentVersion, latestVersion)) return false;

  return doUpdate(currentVersion, latestVersion);
}

/**
 * Perform the actual update.
 */
function doUpdate(currentVersion: string, latestVersion: string): boolean {
  process.stderr.write(
    `\x1b[36m[glrs]\x1b[0m Updating ${currentVersion} → ${latestVersion}...\n`,
  );

  try {
    execFileSync("bun", ["add", "-g", `${PACKAGE_NAME}@${latestVersion}`], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30_000,
      env: { ...process.env, GLRS_UPDATING: "1" },
    });

    process.stderr.write(
      `\x1b[36m[glrs]\x1b[0m Updated to ${latestVersion} ✓\n`,
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `\x1b[33m[glrs]\x1b[0m Auto-update failed (running ${currentVersion}): ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return false;
  }
}
