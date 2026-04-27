import { command } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execaSync } from "execa";
import { VERSION } from "../lib/version.js";
import { ok, info, warn, red } from "../lib/fmt.js";

const REPO = "iceglober/glorious";
const TAG_PREFIX = "agentic-v";

interface Release {
  version: string;
  tag: string;
  assetUrl: string;
}

/** Try `gh` CLI first (handles private repo auth), fall back to fetch + GITHUB_TOKEN. */
async function fetchLatestRelease(): Promise<Release | null> {
  // Try gh CLI — returns { found: true, release } or { found: false } if gh worked but no releases
  const ghResult = tryGhCli();
  if (ghResult !== undefined) return ghResult;

  // gh CLI not available — fall back to GitHub API with optional token
  return fetchFromApi();
}

/**
 * Try gh CLI. Returns Release if found, null if gh worked but no matching
 * release exists, or undefined if gh CLI is not available.
 */
function tryGhCli(): Release | null | undefined {
  try {
    const result = execaSync(
      "gh",
      ["release", "list", "-R", REPO, "--json", "tagName", "-L", "50"],
      { stderr: "pipe" },
    );
    const out = result.stdout.trim();

    if (!out) return null;

    const releases: Array<{ tagName: string }> = JSON.parse(out);
    const match = releases.find((r) => r.tagName.startsWith(TAG_PREFIX));
    if (!match) return null;

    const tag = match.tagName;
    const version = tag.slice(TAG_PREFIX.length);

    // Asset URL not needed — we download via `gh release download`
    return { version, tag, assetUrl: "" };
  } catch {
    return undefined; // gh CLI not available
  }
}

async function fetchFromApi(): Promise<Release | null> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "glorious-cli",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=20`,
    { headers },
  );

  if (!res.ok) {
    if (res.status === 404 || res.status === 403) {
      warn(
        "cannot access releases — for private repos, install the gh CLI or set GITHUB_TOKEN",
      );
    }
    return null;
  }

  // GitHub releases API response shape we consume. Unchecked cast via
  // `as` — we trust the endpoint and handle missing fields at use sites
  // rather than running a schema validator for a release-list fetch.
  const releases = (await res.json()) as Array<{
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  }>;

  const release = releases.find((r) => r.tag_name.startsWith(TAG_PREFIX));
  if (!release) return null;

  const version = release.tag_name.slice(TAG_PREFIX.length);
  const asset = release.assets.find((a) => a.name === "gs-agentic");

  return {
    version,
    tag: release.tag_name,
    assetUrl: asset?.browser_download_url || "",
  };
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

async function downloadBinary(
  release: Release,
  dest: string,
): Promise<boolean> {
  // Try gh CLI download first
  try {
    const tmp = dest + ".tmp";
    execaSync(
      "gh",
      ["release", "download", release.tag, "-R", REPO, "-p", "gs-agentic", "-O", tmp],
      { stderr: "pipe" },
    );
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, dest);
    return true;
  } catch {
    // Fall through to fetch
  }

  // Fall back to direct download
  if (!release.assetUrl) {
    console.error(red("no download URL available"));
    return false;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers: Record<string, string> = { "User-Agent": "glorious-cli" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(release.assetUrl, { headers, redirect: "follow" });
  if (!res.ok) {
    console.error(red(`download failed: HTTP ${res.status}`));
    return false;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const tmp = dest + ".tmp";
  fs.writeFileSync(tmp, buffer, { mode: 0o755 });
  fs.renameSync(tmp, dest);
  return true;
}

export const upgrade = command({
  name: "upgrade",
  description: "Update glorious to the latest version",
  args: {},
  handler: async () => {
    info(`current version: ${VERSION}`);

    // Find where we're installed
    const scriptPath = fs.realpathSync(
      fileURLToPath(import.meta.url),
    );
    info(`installed at: ${scriptPath}`);

    // Check latest release
    info("checking for updates...");
    const latest = await fetchLatestRelease();

    if (!latest) {
      warn("no releases found");
      console.log("  Push a tag to create the first release:");
      console.log("    git tag agentic-v0.2.0 && git push origin --tags");
      process.exit(1);
    }

    info(`latest version: ${latest.version}`);

    if (compareVersions(latest.version, VERSION) <= 0) {
      ok("already up to date");
      return;
    }

    // Check write permission
    const installDir = path.dirname(scriptPath);
    try {
      fs.accessSync(installDir, fs.constants.W_OK);
    } catch {
      console.error(
        red(`no write permission to ${installDir} — try with sudo`),
      );
      process.exit(1);
    }

    // Download and replace
    info(`downloading v${latest.version}...`);
    const success = await downloadBinary(latest, scriptPath);
    if (!success) {
      process.exit(1);
    }

    ok(`updated to v${latest.version}`);
    console.log("");
    info("skills will auto-sync on next run");
  },
});
