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
  tool_result, image blocks).
- **Per-request, region-aware model mapping** — claude-4.x family covered.
  Each request the harness makes carries its own model name; the proxy maps
  it independently. cmprss does not pick a model.
- AWS SDK default credential chain (env, profile, SSO cache, IRSA, IMDS).
- Anthropic Messages ingress with per-session stub bearer auth.
- claude-code wrap profile (drops `CLAUDE_CODE_USE_BEDROCK`, leaves model
  selection to claude-code).
- opencode wrap profile (leaves model selection to opencode; only traffic
  routed through opencode's `anthropic/*` provider reaches us).
- Pino logger with credential redaction; logs to
  `<cwd>/.agent/cmprss-logs/<ts>.log` (override with `CMPRSS_LOG_FILE`).

What's deliberately NOT in v0.1 (lands in v0.2+):
- Any compression. v0.1 is passthrough — value is consolidating Bedrock access
  behind one place we control.
- Other agents (Cursor / Aider / Codex wrap profiles).
- OpenAI / Bedrock-Converse ingress.
- Config file, daemon mode, doctor, telemetry, MCP server, CCR store.

Known limitation: opencode traffic via `amazon-bedrock/*`, `openai/*`,
`google-vertex/*` etc. providers bypasses cmprss. Only `anthropic/*` flows
through the proxy.

Migration: `glrs headroom` continues to work; it'll be deprecated in a later
release once cmprss reaches feature parity.
