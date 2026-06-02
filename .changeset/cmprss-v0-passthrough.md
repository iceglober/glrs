---
"@glrs-dev/cmprss": minor
---

feat(cmprss): new package — provider-agnostic context-compression proxy for AI coding agents

v0.1 ships the vertical slice: `cmprss wrap claude` starts a local Bun proxy on
127.0.0.1, accepts Anthropic Messages API requests, and translates them to AWS
Bedrock Converse (SigV4 via `@aws-sdk/client-bedrock-runtime` — no hand-rolled
crypto). Streaming responses are translated back to Anthropic SSE so Claude Code
sees a normal Anthropic endpoint.

What's in:
- Bedrock Converse streaming, IR ↔ Converse translator (text, tool_use,
  tool_result, image blocks), short-name model resolution (sonnet/haiku/opus →
  per-region inference profile IDs).
- AWS SDK default credential chain (env, profile, SSO cache, IRSA, IMDS).
- Anthropic Messages ingress with per-session stub bearer auth.
- claude-code wrap profile with env injection (strips
  `CLAUDE_CODE_USE_BEDROCK` so traffic actually hits the proxy).
- opencode wrap profile that injects `--model anthropic/<id>` so opencode
  routes through its anthropic provider (which honors `ANTHROPIC_BASE_URL`)
  rather than its native `amazon-bedrock/*` provider (which goes direct).
- Proxy pins the wrap-time model regardless of what the client sends, so
  opencode's anthropic-API model names get rewritten to the right Bedrock
  inference profile transparently.
- Pino logger with credential redaction; logs to
  `<cwd>/.agent/cmprss-logs/<ts>.log` (override with `CMPRSS_LOG_FILE`).

What's deliberately NOT in v0.1 (lands in v0.2+):
- Any compression. v0.1 is passthrough — value is consolidating Bedrock access
  behind one place we control.
- Other agents (Cursor / Aider / Codex wrap profiles).
- OpenAI / Bedrock-Converse ingress.
- Config file, daemon mode, doctor, telemetry, MCP server, CCR store.

Known limitation: in-session model switches in opencode to `amazon-bedrock/*`
will bypass cmprss until the user picks an `anthropic/*` model again.

Migration: `glrs headroom` continues to work; it'll be deprecated in a later
release once cmprss reaches feature parity.
