# Wave 2 — Model Routing + Agent Overrides

**Focus:** Granular model routing per workflow stage, per agent, and per phase. Full model IDs supported everywhere.

---

## Items

- [ ] 2.1 **Model resolver.** Create a resolver that accepts a model specifier (tier name or full model ID) and returns the concrete model ID. Tier names (`deep`, `mid`, `mid-execute`, `autopilot-execute`, `fast`) resolve through the user's `opencode.json` tier config. Full model IDs (containing `/`) pass through as-is. Unknown tier names fall back to `deep` with a warning.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/model-resolver.ts` — `resolveModel(specifier, opencodeTiers): string`
    - `packages/harness-opencode/test/model-resolver.test.ts`
  - verify: `bun test test/model-resolver.test.ts`

- [ ] 2.2 **Workflow-stage model routing.** Use `config.models.enrichment` for the enrichment server's agent, `config.models.execution` for the loop's agent, `config.models.debrief` for the debrief agent. Today these are hardcoded: enrichment always uses `prime` (deep), execution uses `autopilot-fast` when `--fast` else deep, debrief uses deep. Replace with config-driven resolution.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — use `config.models.enrichment` to pick agent
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — use `config.models.execution` for `agentName`
    - `packages/harness-opencode/src/autopilot/cli.ts` — use `config.models.debrief` for debrief agent
  - verify: `bun run build && bun test`

- [ ] 2.3 **Agent override injection.** When `config.agents` has entries, merge them into the agent registrations at server startup. The plugin's `config` hook already runs `input.agent = { ...ourAgents, ...(input.agent ?? {}) }`. Add a step that applies config overrides before this merge: for each agent in `config.agents`, override `model`, and if `prompt` is set, read the file and replace the agent's prompt.

  - files (MODIFIED):
    - `packages/harness-opencode/src/index.ts` — accept agent overrides in the config hook; apply model + prompt overrides
    - `packages/harness-opencode/src/agents/index.ts` — export a function to apply overrides to the agent map: `applyAgentOverrides(agents, overrides)`
  - files (NEW):
    - `packages/harness-opencode/test/agent-overrides.test.ts`
  - verify: `bun test test/agent-overrides.test.ts`

- [ ] 2.4 **Pass config to server startup.** The autopilot starts a server via `startServer({ cwd })`. Add an optional `agentOverrides` parameter that flows into the plugin's config hook. Since the plugin is loaded by OpenCode at server init, the overrides need to be communicated via environment variable or a temp config file that the plugin reads. Evaluate: env var `GLRS_AGENT_OVERRIDES` (JSON-encoded) vs temp file `.agent/autopilot-agent-overrides.json`.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — set overrides before server start
    - `packages/harness-opencode/src/index.ts` — read overrides in config hook
    - `packages/harness-opencode/src/lib/opencode-server.ts` — accept and forward overrides
  - verify: `bun run build && bun test`

- [ ] 2.5 **Custom agent prompts.** When `config.agents.<name>.prompt` is set, read the `.md` file from the path (relative to repo root) and use it as the agent's prompt. Validate the file exists at config resolution time — fail fast if missing. Absolute paths are rejected.

  - files (MODIFIED):
    - `packages/harness-opencode/src/agents/index.ts` — `applyAgentOverrides` reads custom prompt files
    - `packages/harness-opencode/src/autopilot/config-reader.ts` — validate prompt paths exist
  - verify: `bun test test/agent-overrides.test.ts`
