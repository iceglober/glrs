/**
 * `cmprss wrap <agent>` command handler.
 *
 * v0: only `claude` is supported. Starts the proxy, spawns the agent with
 * env vars pointing at it, forwards signals, exits with the child's code.
 */

import {
  claudeCodeEnv,
  detectClaudeCode,
  spawnClaudeCode,
} from "../wrap/profiles/claude-code.js";
import { BedrockConverseProvider } from "../providers/bedrock-converse/provider.js";
import {
  assertCredentialsAvailable,
  defaultCredentials,
  NoCredentials,
} from "../auth/credentials.js";
import {
  ModelNotFound,
  resolveModel,
} from "../aws/model-resolver.js";
import { startProxy } from "../proxy/server.js";
import { getLogger, logFilePath } from "../lib/logger.js";

export interface WrapArgs {
  agent: string;
  backend: "bedrock";
  region: string;
  model: string;
  port: number;
  passthroughArgs: string[];
}

const EXIT_USAGE = 2;
const EXIT_AGENT_MISSING = 3;
const EXIT_CREDS = 4;
const EXIT_MODEL = 6;

export async function runWrap(args: WrapArgs): Promise<number> {
  const log = getLogger();

  if (args.agent !== "claude" && args.agent !== "claude-code") {
    process.stderr.write(
      `cmprss: agent '${args.agent}' is not supported yet. v0 supports: claude\n`,
    );
    return EXIT_USAGE;
  }

  // 1. Resolve model + region BEFORE starting anything.
  let resolvedModel: string;
  try {
    resolvedModel = resolveModel(args.model, args.region);
  } catch (err) {
    if (err instanceof ModelNotFound) {
      process.stderr.write(`cmprss: ${err.message}\n`);
      return EXIT_MODEL;
    }
    throw err;
  }

  // 2. Detect the agent.
  const detection = await detectClaudeCode();
  if (!detection.installed) {
    process.stderr.write(
      `cmprss: claude is not installed.\n` +
        `  install: npm i -g @anthropic-ai/claude-code\n`,
    );
    return EXIT_AGENT_MISSING;
  }

  // 3. Verify AWS credentials resolve. Fail fast with a useful message.
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

  // 4. Build provider + start proxy.
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
        `  another cmprss may be running — try: cmprss wrap claude --port ${args.port + 1}\n`,
    );
    return 5;
  }

  log.info(
    {
      agent: args.agent,
      backend: args.backend,
      region: args.region,
      model: args.model,
      resolvedModel,
      proxyPort: handle.port,
    },
    "wrap.start",
  );

  process.stderr.write(
    `cmprss  agent=${args.agent}  backend=${args.backend}  region=${args.region}  ` +
      `model=${args.model} → ${resolvedModel}  proxy=${handle.url}  log=${logFilePath()}\n`,
  );

  // 5. Spawn the agent.
  const env = claudeCodeEnv({
    proxyUrl: handle.url,
    stubBearer,
    resolvedModel,
    modelAlias: args.model,
  });

  const child = spawnClaudeCode(args.passthroughArgs, env);

  // 6. Forward signals; second SIGINT escalates.
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

  // 7. Wait for child.
  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on("exit", (c, s) => resolve({ code: c, signal: s }));
    child.on("error", (err) => {
      process.stderr.write(`cmprss: failed to spawn claude: ${err.message}\n`);
      resolve({ code: 1, signal: null });
    });
  });

  // 8. Drain proxy.
  await handle.stop();
  log.info({ exit: code, signal }, "wrap.exit");

  if (signal) {
    // Forward the signal to ourselves so the shell sees the same exit cause.
    // SIGINT/SIGTERM/SIGHUP -> 130/143/129 by convention.
    process.kill(process.pid, signal);
    // If for some reason the signal is ignored (unlikely), fall through.
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
