/**
 * `cmprss wrap <agent>` command handler.
 *
 * v0: claude (claude-code), opencode. Starts the proxy, spawns the agent with
 * env vars pointing at it, forwards signals, exits with the child's code.
 *
 * cmprss is model-agnostic. The agent picks the model; the proxy maps each
 * request to the right Bedrock inference profile for the configured region.
 */

import type { ChildProcess } from "node:child_process";

import {
  claudeCodeEnv,
  detectClaudeCode,
  spawnClaudeCode,
} from "../wrap/profiles/claude-code.js";
import {
  detectOpencode,
  opencodeEnv,
  spawnOpencode,
} from "../wrap/profiles/opencode.js";
import { BedrockConverseProvider } from "../providers/bedrock-converse/provider.js";
import {
  assertCredentialsAvailable,
  defaultCredentials,
  NoCredentials,
} from "../auth/credentials.js";
import { startProxy } from "../proxy/server.js";
import { getLogger, logFilePath } from "../lib/logger.js";

export interface WrapArgs {
  agent: string;
  backend: "bedrock";
  region: string;
  port: number;
  passthroughArgs: string[];
}

const EXIT_USAGE = 2;
const EXIT_AGENT_MISSING = 3;
const EXIT_CREDS = 4;
const EXIT_PORT = 5;

type AgentId = "claude" | "opencode";

interface ResolvedProfile {
  id: AgentId;
  installName: string;
  installCmd: string;
  detect: typeof detectClaudeCode;
  buildEnv: (ctx: { proxyUrl: string; stubBearer: string }) => NodeJS.ProcessEnv;
  spawn: (args: string[], env: NodeJS.ProcessEnv) => ChildProcess;
  postWrapNotes?: string[];
}

function resolveProfile(agent: string): ResolvedProfile | null {
  if (agent === "claude" || agent === "claude-code") {
    return {
      id: "claude",
      installName: "claude",
      installCmd: "npm i -g @anthropic-ai/claude-code",
      detect: detectClaudeCode,
      buildEnv: claudeCodeEnv,
      spawn: spawnClaudeCode,
    };
  }
  if (agent === "opencode" || agent === "oc") {
    return {
      id: "opencode",
      installName: "opencode",
      installCmd: "https://opencode.ai (or: bunx opencode upgrade)",
      detect: detectOpencode,
      buildEnv: opencodeEnv,
      spawn: spawnOpencode,
      postWrapNotes: [
        "  note: only opencode's anthropic/* models flow through cmprss.",
        "  amazon-bedrock/*, openai/*, google-vertex/*, etc. bypass this proxy.",
      ],
    };
  }
  return null;
}

export async function runWrap(args: WrapArgs): Promise<number> {
  const log = getLogger();

  const profile = resolveProfile(args.agent);
  if (!profile) {
    process.stderr.write(
      `cmprss: agent '${args.agent}' is not supported yet. v0 supports: claude, opencode\n`,
    );
    return EXIT_USAGE;
  }

  // 1. Detect the agent.
  const detection = await profile.detect();
  if (!detection.installed) {
    process.stderr.write(
      `cmprss: ${profile.installName} is not installed.\n` +
        `  install: ${profile.installCmd}\n`,
    );
    return EXIT_AGENT_MISSING;
  }

  // 2. Verify AWS credentials resolve. Fail fast with a useful message.
  const creds = defaultCredentials();
  try {
    await assertCredentialsAvailable(creds);
  } catch (err) {
    if (err instanceof NoCredentials) {
      process.stderr.write(`cmprss: ${err.message}\n`);
      return EXIT_CREDS;
    }
    throw err;
  }

  // 3. Build provider + start proxy. The provider's default model resolver
  // maps anthropic-API model names to Bedrock inference profiles per-request
  // (see src/aws/model-resolver.ts).
  const provider = new BedrockConverseProvider({
    region: args.region,
    credentials: creds,
  });

  const stubBearer = `sk-cmprss-${randomToken()}`;
  let handle;
  try {
    handle = startProxy({
      port: args.port,
      host: "127.0.0.1",
      provider,
      stubBearer,
    });
  } catch (err) {
    process.stderr.write(
      `cmprss: failed to bind 127.0.0.1:${args.port}: ${(err as Error).message}\n` +
        `  another cmprss may be running — try: cmprss wrap ${args.agent} --port ${args.port + 1}\n`,
    );
    return EXIT_PORT;
  }

  log.info(
    {
      agent: args.agent,
      backend: args.backend,
      region: args.region,
      proxyPort: handle.port,
    },
    "wrap.start",
  );

  process.stderr.write(
    `cmprss  agent=${args.agent}  backend=${args.backend}  region=${args.region}  ` +
      `proxy=${handle.url}  log=${logFilePath()}\n`,
  );
  for (const note of profile.postWrapNotes ?? []) {
    process.stderr.write(`${note}\n`);
  }

  // 4. Spawn the agent. The agent decides what model(s) to use; the proxy
  // maps each request.
  const env = profile.buildEnv({ proxyUrl: handle.url, stubBearer });
  const child = profile.spawn(args.passthroughArgs, env);

  // 5. Forward signals; second SIGINT escalates.
  let lastSigint = 0;
  const sigHandler = (sig: NodeJS.Signals) => {
    if (!child.pid) return;
    if (sig === "SIGINT") {
      const now = Date.now();
      if (now - lastSigint < 1500) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          /* already dead */
        }
        return;
      }
      lastSigint = now;
    }
    try {
      process.kill(child.pid, sig);
    } catch {
      /* already dead */
    }
  };
  const signals: NodeJS.Signals[] = [
    "SIGINT",
    "SIGTERM",
    "SIGHUP",
    "SIGQUIT",
    "SIGWINCH",
    "SIGTSTP",
    "SIGCONT",
  ];
  for (const s of signals) process.on(s, () => sigHandler(s));

  // 6. Wait for child.
  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on("exit", (c, s) => resolve({ code: c, signal: s }));
    child.on("error", (err) => {
      process.stderr.write(
        `cmprss: failed to spawn ${profile.installName}: ${err.message}\n`,
      );
      resolve({ code: 1, signal: null });
    });
  });

  // 7. Drain proxy.
  await handle.stop();
  log.info({ exit: code, signal }, "wrap.exit");

  if (signal) {
    // Forward the signal so the shell sees the same exit cause.
    // SIGINT/SIGTERM/SIGHUP → 130/143/129 by convention.
    process.kill(process.pid, signal);
    return 128;
  }
  return code ?? 0;
}

function randomToken(): string {
  const uuid =
    (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID;
  if (uuid) return uuid().replaceAll("-", "");
  return Math.random().toString(16).slice(2, 18);
}
