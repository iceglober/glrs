/**
 * `glrs headroom` — context compression via headroom-ai.
 *
 * Subcommands:
 *   init   — install headroom, start proxy, configure OpenCode to route through it
 *   start  — start the proxy daemon
 *   stop   — stop the proxy daemon
 *   status — check proxy health
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const PROXY_PORT = 8787;
const OPENCODE_CONFIG = resolve(
  process.env.HOME ?? "~",
  ".config/opencode/opencode.json",
);

function headroomInstalled(): boolean {
  try {
    execSync("which headroom", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function proxyRunning(): boolean {
  try {
    execSync(`curl -s --max-time 2 http://localhost:${PROXY_PORT}/health`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureUv(): Promise<boolean> {
  if (Bun.spawnSync(["which", "uv"]).exitCode === 0) return true;

  process.stderr.write("[glrs] uv not found — installing...\n");
  const install = spawn("sh", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"], {
    stdio: "inherit",
  });
  const code = await new Promise<number>((resolve) => {
    install.on("exit", (c) => resolve(c ?? 1));
    install.on("error", () => resolve(1));
  });
  if (code !== 0) return false;

  const uvBin = resolve(process.env.HOME ?? "~", ".local/bin");
  process.env.PATH = `${uvBin}:${process.env.PATH}`;
  return Bun.spawnSync(["which", "uv"]).exitCode === 0;
}

async function installHeadroom(): Promise<boolean> {
  process.stderr.write("[glrs] headroom not found — installing headroom-ai...\n");

  if (!(await ensureUv())) {
    process.stderr.write("[glrs] Failed to install uv. Install manually: https://docs.astral.sh/uv/\n");
    return false;
  }

  process.stderr.write("[glrs] Installing via uv tool install...\n");
  const uv = spawn(
    "uv",
    ["tool", "install", "--python", "3.13", "headroom-ai[proxy]"],
    { stdio: "inherit" },
  );
  const code = await new Promise<number>((resolve) => {
    uv.on("exit", (c) => resolve(c ?? 1));
    uv.on("error", () => resolve(1));
  });
  return code === 0;
}

const LAUNCHD_LABEL = "com.glorious.headroom-proxy";
const LAUNCHD_PLIST = resolve(
  process.env.HOME ?? "~",
  `Library/LaunchAgents/${LAUNCHD_LABEL}.plist`,
);

function headroomBin(): string {
  try {
    return execSync("which headroom", { encoding: "utf8" }).trim();
  } catch {
    return "headroom";
  }
}

function startProxy(): void {
  process.stderr.write(`[glrs] Starting headroom proxy on port ${PROXY_PORT}...\n`);
  const child = spawn("headroom", ["proxy", "--port", String(PROXY_PORT)], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();

  // Wait for proxy to be ready
  let attempts = 0;
  while (attempts < 10) {
    try {
      execSync(`curl -s --max-time 1 http://localhost:${PROXY_PORT}/health`, {
        stdio: "ignore",
      });
      process.stderr.write("[glrs] ✓ Proxy running\n");
      return;
    } catch {
      attempts++;
      execSync("sleep 1");
    }
  }
  process.stderr.write("[glrs] Warning: proxy started but health check not responding yet\n");
}

function installLaunchdAgent(): void {
  if (process.platform !== "darwin") {
    process.stderr.write("[glrs] Auto-start on boot is macOS-only for now. Start manually with 'glrs headroom start'.\n");
    return;
  }

  const bin = headroomBin();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>proxy</string>
    <string>--port</string>
    <string>${PROXY_PORT}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${process.env.HOME}/Library/Logs/headroom-proxy.log</string>
  <key>StandardErrorPath</key>
  <string>${process.env.HOME}/Library/Logs/headroom-proxy.log</string>
</dict>
</plist>`;

  writeFileSync(LAUNCHD_PLIST, plist);
  try {
    execSync(`launchctl bootout gui/$(id -u) ${LAUNCHD_PLIST}`, { stdio: "ignore" });
  } catch { /* not loaded yet */ }
  execSync(`launchctl bootstrap gui/$(id -u) ${LAUNCHD_PLIST}`);
  process.stderr.write("[glrs] ✓ Installed launchd agent (starts on boot)\n");
}

function uninstallLaunchdAgent(): void {
  if (existsSync(LAUNCHD_PLIST)) {
    try {
      execSync(`launchctl bootout gui/$(id -u) ${LAUNCHD_PLIST}`, { stdio: "ignore" });
    } catch { /* already unloaded */ }
    unlinkSync(LAUNCHD_PLIST);
    process.stderr.write("[glrs] ✓ Removed launchd agent\n");
  }
}

function stopProxy(): void {
  uninstallLaunchdAgent();
  try {
    execSync("pkill -f 'headroom proxy'", { stdio: "ignore" });
    process.stderr.write("[glrs] ✓ Proxy stopped\n");
  } catch {
    process.stderr.write("[glrs] Proxy not running\n");
  }
}

function configureOpenCode(): void {
  if (!existsSync(OPENCODE_CONFIG)) {
    process.stderr.write(`[glrs] opencode.json not found at ${OPENCODE_CONFIG}\n`);
    process.stderr.write("[glrs] Run 'glrs harness install' first\n");
    return;
  }

  const raw = readFileSync(OPENCODE_CONFIG, "utf8");
  const config = JSON.parse(raw);

  // Check if already configured
  const provider = config.provider ?? {};
  const anthropic = provider.anthropic ?? {};
  if (anthropic.baseURL === `http://localhost:${PROXY_PORT}`) {
    process.stderr.write("[glrs] ✓ OpenCode already configured for headroom proxy\n");
    return;
  }

  // Set the Anthropic base URL to route through the proxy
  if (!config.provider) config.provider = {};
  if (!config.provider.anthropic) config.provider.anthropic = {};
  config.provider.anthropic.baseURL = `http://localhost:${PROXY_PORT}`;

  writeFileSync(OPENCODE_CONFIG, JSON.stringify(config, null, 2) + "\n");
  process.stderr.write("[glrs] ✓ OpenCode configured to route through headroom proxy\n");
}

function unconfigureOpenCode(): void {
  if (!existsSync(OPENCODE_CONFIG)) return;

  const raw = readFileSync(OPENCODE_CONFIG, "utf8");
  const config = JSON.parse(raw);

  if (config.provider?.anthropic?.baseURL === `http://localhost:${PROXY_PORT}`) {
    delete config.provider.anthropic.baseURL;
    if (Object.keys(config.provider.anthropic).length === 0) {
      delete config.provider.anthropic;
    }
    if (Object.keys(config.provider).length === 0) {
      delete config.provider;
    }
    writeFileSync(OPENCODE_CONFIG, JSON.stringify(config, null, 2) + "\n");
    process.stderr.write("[glrs] ✓ OpenCode provider config restored to direct\n");
  }
}

const HELP = `glrs headroom — context compression via headroom-ai

USAGE
  glrs headroom <command>

COMMANDS
  init     Install headroom, start proxy, configure OpenCode
  start    Start the compression proxy
  stop     Stop the proxy and restore direct provider access
  status   Check proxy health and compression stats

EXAMPLES
  glrs headroom init
  glrs headroom status
  glrs headroom stop
`;

export async function headroomCmd(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    process.stderr.write(HELP);
    process.exit(0);
  }

  if (sub === "init") {
    // 1. Install headroom if missing
    if (!headroomInstalled()) {
      const ok = await installHeadroom();
      if (!ok) {
        process.stderr.write("[glrs] Failed to install headroom-ai\n");
        process.exit(1);
      }
    } else {
      process.stderr.write("[glrs] ✓ headroom installed\n");
    }

    // 2. Install launchd agent + start proxy
    installLaunchdAgent();
    if (!proxyRunning()) {
      // launchd should have started it, but give it a moment
      let attempts = 0;
      while (attempts < 5 && !proxyRunning()) {
        execSync("sleep 1");
        attempts++;
      }
      if (!proxyRunning()) {
        startProxy();
      }
    }
    process.stderr.write("[glrs] ✓ Proxy running (persists across reboots)\n");

    // 3. Configure OpenCode
    configureOpenCode();

    process.stderr.write("\n[glrs] ✓ Done. Restart OpenCode to enable compression.\n");
    process.stderr.write(`[glrs]   Proxy: http://localhost:${PROXY_PORT}\n`);
    process.stderr.write("[glrs]   All LLM traffic now routes through headroom for compression.\n");
    process.stderr.write("[glrs]   Run 'glrs headroom stop' to disable and restore direct access.\n");
    return;
  }

  if (sub === "start") {
    if (!headroomInstalled()) {
      process.stderr.write("[glrs] headroom not installed. Run 'glrs headroom init' first.\n");
      process.exit(1);
    }
    installLaunchdAgent();
    if (!proxyRunning()) {
      startProxy();
    }
    configureOpenCode();
    return;
  }

  if (sub === "stop") {
    stopProxy();
    unconfigureOpenCode();
    return;
  }

  if (sub === "status") {
    if (!headroomInstalled()) {
      process.stderr.write("headroom: not installed\n");
      process.exit(1);
    }
    process.stderr.write(`headroom: installed\n`);

    if (proxyRunning()) {
      process.stderr.write(`proxy: running on port ${PROXY_PORT}\n`);
      try {
        const raw = execSync(
          `curl -s http://localhost:${PROXY_PORT}/stats`,
          { encoding: "utf8" },
        );
        const s = JSON.parse(raw);
        const reqs = s.summary?.api_requests ?? s.requests?.total ?? 0;
        const saved = s.tokens?.saved ?? s.summary?.compression?.total_tokens_saved ?? 0;
        const pct = s.tokens?.savings_percent ?? s.summary?.compression?.avg_compression_pct ?? 0;
        const costSaved = s.cost?.savings_usd ?? s.summary?.cost?.total_saved_usd ?? 0;
        process.stderr.write(`requests: ${reqs}\n`);
        process.stderr.write(`tokens saved: ${saved.toLocaleString()}\n`);
        if (pct > 0) {
          process.stderr.write(`compression: ${Math.round(pct)}% reduction\n`);
        }
        if (costSaved > 0) {
          process.stderr.write(`cost saved: $${costSaved.toFixed(2)}\n`);
        }
      } catch {
        // Stats endpoint might not exist in all versions
      }
    } else {
      process.stderr.write("proxy: not running\n");
    }

    if (existsSync(OPENCODE_CONFIG)) {
      const config = JSON.parse(readFileSync(OPENCODE_CONFIG, "utf8"));
      const baseURL = config.provider?.anthropic?.baseURL;
      if (baseURL === `http://localhost:${PROXY_PORT}`) {
        process.stderr.write("opencode: routing through proxy\n");
      } else {
        process.stderr.write("opencode: direct (not routing through proxy)\n");
      }
    }
    return;
  }

  // Unknown subcommand — pass through to headroom CLI
  if (headroomInstalled()) {
    const child = spawn("headroom", args, { stdio: "inherit" });
    child.on("exit", (code, signal) => {
      if (signal) { process.kill(process.pid, signal); return; }
      process.exit(code ?? 0);
    });
    child.on("error", () => process.exit(1));
    await new Promise(() => {});
  } else {
    process.stderr.write("[glrs] headroom not installed. Run 'glrs headroom init' first.\n");
    process.exit(1);
  }
}
