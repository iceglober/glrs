---
"@glrs-dev/harness-plugin-opencode": minor
"@glrs-dev/cli": patch
---

feat(harness): headroom tool-output compression — provider-agnostic

The harness now compresses large tool outputs through headroom's local compression
service (if running). Works with any LLM provider (Bedrock, Anthropic, OpenAI).
Falls back to built-in truncation when headroom isn't available.

Also removes the old proxy-redirect approach from `glrs headroom init` — headroom
is now a compression service, not an API proxy.
