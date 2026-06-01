---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): make scoper, plan, and build non-primary agents

`scoper`, `plan`, and `build` move from `mode: "all"` to `mode: "subagent"`, so
they no longer appear in OpenCode's interactive primary-agent picker (Tab). This
declutters the picker down to the true entry points: `prime`, `prime-heavy`,
`designer`, and `research`.

They remain fully dispatchable — `@prime` delegates to them via the task tool,
the scoper wizard and autopilot drive them programmatically (agent selection by
name works regardless of mode), and you can still invoke them directly with
`@scoper` / `@plan` / `@build`. The docs agent table now lists them under
Subagents. No change to model tiers, prompts, or permissions.
