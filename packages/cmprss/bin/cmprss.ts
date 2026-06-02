#!/usr/bin/env bun
/**
 * cmprss CLI entry point.
 *
 * v0 surface:
 *   cmprss wrap <agent> [--backend bedrock] [--region us-east-1] [--port 8787] [-- <agent-args>]
 *   cmprss --version
 *   cmprss --help
 *
 * cmprss is model-agnostic: it does not pick a model. The wrapped agent
 * (claude-code, opencode, ...) sends whatever model it wants; the proxy maps
 * each request to the right Bedrock inference profile for the region.
 */

import { runWrap } from "../src/cli/wrap.js";

declare const __PKG_VERSION__: string;

const HELP = `cmprss — provider-agnostic context-compression proxy for AI coding agents.

USAGE
  cmprss wrap <agent> [flags] [-- <agent-args>]
  cmprss --version | --help

AGENTS (v0)
  claude              wrap Claude Code (anthropic provider → cmprss → Bedrock)
  opencode            wrap opencode TUI (anthropic provider → cmprss → Bedrock)

FLAGS
  --backend <id>      bedrock (default; only option in v0)
  --region <region>   AWS region (default: AWS_REGION, AWS_DEFAULT_REGION, or us-east-1)
  --port <n>          proxy port (default: 8787)
  --help, -h          show this help
  --version, -V       show version

EXAMPLES
  cmprss wrap claude
  cmprss wrap claude --region us-west-2
  cmprss wrap opencode
  cmprss wrap opencode -- /path/to/project        # extra args pass through

MODELS
  cmprss does not pick a model — the wrapped agent does. Each request from
  the agent carries its own model name; the proxy maps anthropic-API names
  (e.g. claude-sonnet-4-5-20250929) to the equivalent Bedrock inference
  profile for the configured region. Switch models in the agent's UI as
  normal — every request gets mapped independently.

  Caveat: only traffic that the agent routes through its *anthropic* provider
  reaches cmprss. opencode's amazon-bedrock/*, openai/*, google-vertex/*
  providers go direct and bypass this proxy.

NOTES
  v0.1 is passthrough only — compression lands in v0.2. The proxy speaks
  Anthropic Messages on /v1/messages and translates to Bedrock Converse
  (SigV4 via AWS SDK).
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (sub === "--version" || sub === "-V") {
    process.stdout.write(`cmprss ${__PKG_VERSION__}\n`);
    return 0;
  }

  if (sub === "wrap") {
    const rest = argv.slice(1);
    if (rest.length === 0 || rest[0] === "--help") {
      process.stdout.write(HELP);
      return rest.length === 0 ? 2 : 0;
    }
    const parsed = parseWrap(rest);
    if (!parsed) return 2;
    return runWrap(parsed);
  }

  process.stderr.write(`cmprss: unknown subcommand '${sub}'. Try: cmprss --help\n`);
  return 2;
}

function parseWrap(args: string[]):
  | {
      agent: string;
      backend: "bedrock";
      region: string;
      port: number;
      passthroughArgs: string[];
    }
  | null {
  let agent = "";
  let backend: "bedrock" = "bedrock";
  let region =
    process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  let port = 8787;
  const passthrough: string[] = [];
  let inPassthrough = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (inPassthrough) {
      passthrough.push(a);
      continue;
    }
    if (a === "--") {
      inPassthrough = true;
      continue;
    }
    if (a === "--backend") {
      const v = args[++i];
      if (v !== "bedrock") {
        process.stderr.write(
          `cmprss: --backend '${v}' not supported in v0 (only: bedrock)\n`,
        );
        return null;
      }
      backend = v;
      continue;
    }
    if (a === "--region") {
      region = args[++i] ?? "";
      if (!region) {
        process.stderr.write("cmprss: --region requires a value\n");
        return null;
      }
      continue;
    }
    if (a === "--port") {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0 || v >= 65536) {
        process.stderr.write("cmprss: --port must be a valid port number\n");
        return null;
      }
      port = v;
      continue;
    }
    if (a.startsWith("--")) {
      process.stderr.write(`cmprss: unknown flag '${a}'\n`);
      return null;
    }
    if (!agent) {
      agent = a;
      continue;
    }
    // Positional after agent without `--` separator: treat as passthrough.
    passthrough.push(a);
  }

  if (!agent) {
    process.stderr.write("cmprss: wrap requires an agent. Try: cmprss wrap claude\n");
    return null;
  }
  return {
    agent,
    backend,
    region,
    port,
    passthroughArgs: passthrough,
  };
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`cmprss: ${(err as Error).stack ?? err}\n`);
    process.exit(1);
  },
);
