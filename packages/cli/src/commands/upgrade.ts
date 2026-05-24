/**
 * `glrs upgrade` — force-update to the latest published version.
 *
 * Fetches the latest version directly from the npm registry (bypasses
 * bun's stale resolution cache) and installs that exact version globally.
 */

import { command } from "cmd-ts";
import { execFileSync } from "node:child_process";

const PACKAGE_NAME = "@glrs-dev/cli";
const REGISTRY_TIMEOUT_MS = 5000;

async function fetchLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    signal: controller.signal,
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);
  const data = (await res.json()) as { version?: string };
  if (!data.version) throw new Error("No version field in registry response");
  return data.version;
}

function getCurrentVersion(): string {
  const pkgPath = new URL("../../package.json", import.meta.url).pathname;
  const pkg = JSON.parse(
    require("node:fs").readFileSync(pkgPath, "utf8"),
  );
  return pkg.version ?? "unknown";
}

export const upgradeCmd = command({
  name: "upgrade",
  description: "Upgrade glrs to the latest published version",
  args: {},
  handler: async () => {
    const current = getCurrentVersion();
    process.stderr.write(`\x1b[36m[glrs]\x1b[0m Current version: ${current}\n`);

    let latest: string;
    try {
      latest = await fetchLatestVersion();
    } catch (err) {
      process.stderr.write(
        `\x1b[31m[glrs]\x1b[0m Failed to check registry: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    if (latest === current) {
      process.stderr.write(`\x1b[32m[glrs]\x1b[0m Already on latest (${current})\n`);
      process.exit(0);
    }

    process.stderr.write(
      `\x1b[36m[glrs]\x1b[0m Upgrading ${current} → ${latest}...\n`,
    );

    try {
      execFileSync("bun", ["install", "-g", `${PACKAGE_NAME}@${latest}`], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      });
      process.stderr.write(`\x1b[32m[glrs]\x1b[0m Upgraded to ${latest}\n`);
    } catch (err) {
      process.stderr.write(
        `\x1b[31m[glrs]\x1b[0m Upgrade failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  },
});
