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
# Wrap Claude Code with Bedrock backend (default region us-east-1, default model sonnet)
cmprss wrap claude

# Wrap opencode (TUI). Injects --model anthropic/<id> so opencode uses its
# anthropic provider (which honors ANTHROPIC_BASE_URL) rather than its native
# amazon-bedrock provider (which goes direct, bypassing cmprss).
cmprss wrap opencode --model sonnet

# Pick a different region / model / port
cmprss wrap claude --region us-west-2 --model haiku --port 8788

# Pass args through to the wrapped agent
cmprss wrap claude -- --version
cmprss wrap opencode -- /path/to/project
```

`cmprss` uses the AWS SDK default credential chain (env vars, profile, SSO cache, IRSA, IMDS). No bearer token plumbing.

**opencode caveat:** the proxy can only see traffic that goes through opencode's `anthropic/*` provider. If you switch to an `amazon-bedrock/*` model in-session, that traffic talks to Bedrock directly via AWS SDK and bypasses cmprss until you switch back.

## Status

Roadmap lives in the design plan; this is v0 of the vertical slice.
