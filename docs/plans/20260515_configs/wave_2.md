# Wave 2 — Model Routing + Agent Overrides

**Focus:** Adapter-aware model routing per workflow stage, per agent, and per phase. Full model IDs supported everywhere. Agent overrides for adapters that support them.

---

## Adapter context

Two adapters exist with fundamentally different model routing:

| | OpenCode | Claude Code CLI |
|---|---|---|
| **Model selection** | Tier names (`deep`, `mid`, `autopilot-execute`) resolved through `opencode.json` plugin config | Model IDs (`claude-opus-4-7`, `claude-haiku-4-5-20251001`) passed as `--model` flag |
| **Agent system** | Named agents registered at plugin init, each with a model + prompt | No agent concept — model is per-invocation, prompt is the message itself |
| **Server lifecycle** | Persistent server, agent selected per-session | No server — fresh subprocess per `sendAndWait` |

The model resolver must handle both. Config values in `models.*` are adapter-interpreted: the same field (`models.execution`) holds `"autopilot-execute"` for OpenCode or `"claude-haiku-4-5-20251001"` for Claude Code CLI. Full model IDs (containing `/` or matching known Claude model patterns) pass through for both adapters.

---

## Items

- [x] 2.1 **Adapter-aware model resolver.** Create a resolver that accepts a model specifier and the active adapter name, and returns the concrete model ID. Resolution strategy depends on the adapter:

  - **OpenCode:** Tier names (`deep`, `mid`, `mid-execute`, `autopilot-execute`, `fast`) resolve through the user's `opencode.json` tier config. Full model IDs pass through as-is. Unknown tier names fall back to `deep` with a warning.
  - **Claude Code CLI:** Values are expected to be Claude model IDs (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`). As a convenience, tier aliases are mapped to sensible defaults: `deep` → `claude-opus-4-7`, `mid`/`mid-execute`/`autopilot-execute` → `claude-sonnet-4-6`, `fast` → `claude-haiku-4-5-20251001`. Full model IDs pass through.
  - **Both:** A value containing `/` (e.g., `amazon-bedrock/global.anthropic.claude-opus-4-7`) is always treated as a full model ID.

  - files (NEW):
    - `packages/autopilot/src/model-resolver.ts` — `resolveModel(specifier, adapterName, opencodeTiers?): string`
    - `packages/autopilot/test/model-resolver.test.ts`
  - verify: `bun test test/model-resolver.test.ts`

- [x] 2.2 **Workflow-stage model routing.** Use `config.models.enrichment` for the enrichment session, `config.models.execution` for the loop session, `config.models.debrief` for the debrief session. Today these are hardcoded: enrichment always uses `prime` (deep), execution uses `autopilot-fast` when `--fast` else deep, debrief uses deep. Replace with config-driven resolution.

  For **OpenCode**, the resolved model drives agent selection (`agentName` in `createSession`).
  For **Claude Code CLI**, the resolved model is passed to the adapter which adds `--model <id>` to the CLI args. The `ClaudeCodeCliAdapter.resolveModel()` method (already implemented) maps agentName to model — this item replaces that hardcoded mapping with config-driven resolution.

  - files (MODIFIED):
    - `packages/autopilot/src/plan-enrichment.ts` — use `config.models.enrichment` via resolver
    - `packages/autopilot/src/loop-session.ts` — use `config.models.execution` for `agentName` / model
    - `packages/cli/src/commands/debrief.ts` — use `config.models.debrief`
    - `packages/adapter-claude-code/src/claude-code-adapter.ts` — replace hardcoded `resolveModel()` with config-driven lookup
  - verify: `bun run build && bun test`

- [x] 2.3 **Agent override injection (OpenCode only).** When `config.adapters.opencode.agents` has entries, merge them into the agent registrations at server startup. The plugin's `config` hook already runs `input.agent = { ...ourAgents, ...(input.agent ?? {}) }`. Add a step that applies config overrides before this merge: for each agent in the config, override `model`, and if `prompt` is set, read the file and replace the agent's prompt.

  Skipped entirely when `config.adapter !== "opencode"`.

  - files (MODIFIED):
    - `packages/harness-opencode/src/index.ts` — accept agent overrides in the config hook; apply model + prompt overrides
    - `packages/harness-opencode/src/agents/index.ts` — export a function to apply overrides to the agent map: `applyAgentOverrides(agents, overrides)`
  - files (NEW):
    - `packages/harness-opencode/test/agent-overrides.test.ts`
  - verify: `bun test test/agent-overrides.test.ts`

- [x] 2.4 **Pass config to server startup (OpenCode only).** The autopilot starts a server via `startServer({ cwd })`. Add an optional `agentOverrides` parameter that flows into the plugin's config hook. Since the plugin is loaded by OpenCode at server init, the overrides need to be communicated via environment variable or a temp config file that the plugin reads. Evaluate: env var `GLRS_AGENT_OVERRIDES` (JSON-encoded) vs temp file `.agent/autopilot-agent-overrides.json`.

  Not applicable to `claude-code-cli` — no persistent server, no plugin system.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — set overrides before server start
    - `packages/harness-opencode/src/index.ts` — read overrides in config hook
    - `packages/harness-opencode/src/lib/opencode-server.ts` — accept and forward overrides
  - verify: `bun run build && bun test`

- [x] 2.5 **Custom agent prompts (OpenCode only).** When `config.adapters.opencode.agents.<name>.prompt` is set, read the `.md` file from the path (relative to repo root) and use it as the agent's prompt. Validate the file exists at config resolution time — fail fast if missing. Absolute paths are rejected.

  For `claude-code-cli`, the equivalent is CLAUDE.md (read automatically by the CLI). A future item could add `config.adapters.claude_code_cli.claude_md_path` to override the default location, but this is out of scope for wave 2.

  - files (MODIFIED):
    - `packages/harness-opencode/src/agents/index.ts` — `applyAgentOverrides` reads custom prompt files
    - `packages/harness-opencode/src/autopilot/config-reader.ts` — validate prompt paths exist
  - verify: `bun test test/agent-overrides.test.ts`

- [x] 2.6 **Claude Code CLI adapter-specific config.** Read `config.adapters.claude_code_cli` and pass it to `ClaudeCodeCliAdapter` constructor. Supported fields:
  - `skip_permissions: boolean` (default: true) — maps to `--dangerously-skip-permissions`
  - `allowed_tools: string[]` (optional) — maps to `--allowedTools`
  - `max_turns: number` (optional) — maps to `--max-turns`

  This replaces the hardcoded `{ dangerouslySkipPermissions: true }` in `adapter-factory.ts`.

  - files (MODIFIED):
    - `packages/cli/src/adapter-factory.ts` — read adapter-specific config from `AutopilotConfig`
    - `packages/adapter-claude-code/src/claude-code-cli.ts` — ensure options map cleanly from YAML field names
  - verify: `bun run build && bun test`
