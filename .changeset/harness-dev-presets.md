---
"@glrs-dev/cli": minor
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): internal dev presets for A/B-ing per-agent models/prompts

Adds `glrs harness dev-preset <id> -- <command>` (internal/dev — hidden from
`glrs harness --help`). A preset is a named set of per-agent `{model, prompt}`
overrides; the command exports it as `GLRS_AGENT_OVERRIDES` plus a
`GLRS_DEV_PRESET=<id>` tag and runs the given command, e.g.
`glrs harness dev-preset 1 -- opencode`.

Presets are bundled in the package and overridable/extendable via
`~/.glrs/dev-presets.json`. The cost-tracker and dispatch-tracker now stamp a
`preset` field into their JSONL logs, so spend, speed, and dispatch counts can
be correlated per preset by a downstream analytics tool.
