import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execaSync } from "execa";
import { VERSION } from "./version.js";
import { ok, info, warn } from "./fmt.js";

const REPO = "iceglober/glorious";
const CACHE_FILE = path.join(os.homedir(), ".cache", "glorious", "latest-version.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedVersion {
  version: string;
  checkedAt: number;
}

function readCache(): CachedVersion | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data: CachedVersion = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    if (Date.now() - data.checkedAt < CACHE_TTL_MS) return data;
    return null; // expired
  } catch {
    return null;
  }
}

function writeCache(version: string): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version, checkedAt: Date.now() }));
  } catch {
    // best-effort — don't crash if we can't write cache
  }
}

function fetchLatestVersionGh(): string | null {
  try {
    const result = execaSync(
      "gh",
      ["release", "list", "-R", REPO, "--json", "tagName", "-L", "10"],
      { stderr: "pipe", timeout: 5000 },
    );
    const out = result.stdout.trim();
    if (!out) return null;
    const releases: Array<{ tagName: string }> = JSON.parse(out);
    const match = releases.find((r) => r.tagName.startsWith("v"));
    return match ? match.tagName.slice(1) : null;
  } catch {
    return null;
  }
}

function fetchLatestVersionApi(): string | null {
  try {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "glorious-cli",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    // Use execaSync to call curl since we need this to be synchronous
    const result = execaSync(
      "curl",
      [
        "-fsSL",
        "-H", `Accept: ${headers.Accept}`,
        "-H", `User-Agent: ${headers["User-Agent"]}`,
        "-H", `X-GitHub-Api-Version: ${headers["X-GitHub-Api-Version"]}`,
        ...(token ? ["-H", `Authorization: Bearer ${token}`] : []),
        `https://api.github.com/repos/${REPO}/releases?per_page=10`,
      ],
      { stderr: "pipe", timeout: 5000 },
    );
    const out = result.stdout.trim();
    if (!out) return null;
    const releases: Array<{ tag_name: string }> = JSON.parse(out);
    const match = releases.find((r) => r.tag_name.startsWith("v"));
    return match ? match.tag_name.slice(1) : null;
  } catch {
    return null;
  }
}

function fetchLatestVersion(): string | null {
  return fetchLatestVersionGh() ?? fetchLatestVersionApi();
}

function parseVersion(v: string): [number, number, number] {
  const parts = v.split(".").map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function isMajorBump(current: string, latest: string): boolean {
  const [curMajor] = parseVersion(current);
  const [latMajor] = parseVersion(latest);
  return latMajor > curMajor;
}

/** Attempt to download and replace the binary. Returns true on success. */
function tryAutoUpgrade(tag: string): boolean {
  try {
    const scriptPath = fs.realpathSync(fileURLToPath(import.meta.url));
    const installDir = path.dirname(scriptPath);

    // Check write permission
    fs.accessSync(installDir, fs.constants.W_OK);

    const tmp = scriptPath + ".tmp";
    execaSync(
      "gh",
      ["release", "download", tag, "-R", REPO, "-p", "gs-agentic", "-O", tmp],
      { stderr: "pipe", timeout: 30_000 },
    );
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, scriptPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a newer version is available. Uses a 24h cache.
 * Auto-upgrades for minor/patch bumps. Warns for major bumps.
 * Never throws — all errors are silently swallowed.
 */
export function checkForUpdate(): void {
  try {
    let latest: string | null = null;

    const cached = readCache();
    if (cached) {
      latest = cached.version;
    } else {
      latest = fetchLatestVersion();
      if (latest) writeCache(latest);
    }

    if (!latest || compareVersions(latest, VERSION) <= 0) return;

    if (isMajorBump(VERSION, latest)) {
      warn(`glorious v${latest} available (major update) — run \`gs-agentic upgrade\` to update`);
      return;
    }

    // Auto-upgrade for minor/patch
    info(`updating glorious v${VERSION} → v${latest}...`);
    const tag = `v${latest}`;
    if (tryAutoUpgrade(tag)) {
      ok(`updated to v${latest} — changes take effect on next run`);
      // Invalidate cache so we don't re-download
      writeCache(latest);
    } else {
      warn(`glorious v${latest} available (current: v${VERSION}) — run \`gs-agentic upgrade\``);
    }
  } catch {
    // never crash the CLI for a version check
  }
}
