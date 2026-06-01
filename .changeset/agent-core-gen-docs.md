---
"@glrs-dev/harness-plugin-opencode": patch
"@glrs-dev/cli": patch
---

refactor: extract agent identity into `@glrs-dev/agent-core` and generate reference docs from code

- New private, framework-agnostic package `@glrs-dev/agent-core` holds the single source of truth for agent names, tiers, and doc metadata (`AGENTS`, `AGENT_TIERS`, `AGENT_DOC_META`). It's bundled into the published harness and CLI (no new runtime dependency), and is ready to be shared by a future Claude Code harness plugin.
- The OpenCode harness, autopilot, and the CLI adapters now import these constants instead of hard-coding agent-name strings, so a rename is a single edit.
- `dispatch-tracker` now derives an agent's tier from the authoritative `AGENT_TIERS` map (covering every registered agent) before falling back to name-suffix heuristics.
- New `bun run gen-docs` regenerates the docs-site agent, command, and skills reference pages from code (`bun run gen-docs:check` guards drift), and a new Skills page is added to the docs site.

No public API changes to the published packages.
