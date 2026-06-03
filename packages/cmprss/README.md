# @glrs-dev/cmprss

Provider-agnostic context-compression proxy for AI coding agents. Bedrock-first.

> **v0.1 status:** passthrough proxy only. `cmprss wrap claude` starts a local proxy, translates Anthropic Messages requests to Bedrock Converse outbound (with SigV4 via AWS SDK), and streams responses back. **Compression lands in v0.2.**

## Install

```bash
bun add -g @glrs-dev/cmprss
# or
npm i -g @glrs-dev/cmprss
```

## Usage

```bash
# Wrap Claude Code with Bedrock backend (default region us-east-1)
cmprss wrap claude

# Wrap opencode TUI
cmprss wrap opencode

# Different region / port
cmprss wrap claude --region us-west-2 --port 8788

# Pass args through to the wrapped agent
cmprss wrap claude -- --version
cmprss wrap opencode -- /path/to/project
```

`cmprss` uses the AWS SDK default credential chain (env vars, profile, SSO cache, IRSA, IMDS). No bearer token plumbing.

## Model selection — cmprss does not pick

cmprss is **model-agnostic**. Pick models in your agent's UI as normal — the proxy maps each request independently to the right Bedrock inference profile for the configured region.

A single opencode/claude-code session typically uses several models (main + summarizer + planner). Each one passes through cmprss; each one gets its own mapping.

Anthropic-API names → Bedrock inference profiles (e.g. `claude-sonnet-4-5-20250929` → `us.anthropic.claude-sonnet-4-5-20250929-v1:0`). Already-formatted Bedrock IDs pass through unchanged. Unknown models return a 400 with the list of recognized names — open an issue if you hit something we should add.

**opencode caveat:** only opencode's `anthropic/*` provider routes through `ANTHROPIC_BASE_URL`. Its `amazon-bedrock/*`, `openai/*`, `google-vertex/*` etc. providers go direct to their respective backends and bypass cmprss.

## Status

Roadmap lives in the design plan; this is v0 of the vertical slice.
