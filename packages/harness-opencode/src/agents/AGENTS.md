# src/agents — agent definitions + prompts

Every agent in the harness is registered here. If you're adding, editing, or retuning an agent, this is the directory.

## Layout

```
agents/
├── index.ts          # createAgents() — builds the Record<string, AgentConfig> passed to OpenCode
├── prompts/          # One <name>.md per agent — YAML frontmatter + body
└── shared/           # Content injected into multiple prompts (workflow-mechanics rule)
```

## Convention

Each agent is three coupled pieces:

1. **`prompts/<name>.md`** — YAML frontmatter (`name`, `description`, `mode`, `model`) + the prompt body. Read at runtime (see root rule 7 for why never to `import` a `.md` file).
2. **`<NAME>_PERMISSIONS`** in `index.ts` — a permission map controlling which tools/bash commands the agent may call. See `PRIME_PERMISSIONS`, `SPEC_REVIEWER_PERMISSIONS`, `CODE_REVIEWER_PERMISSIONS`, etc. for the shape.
3. **An entry in `createAgents()`** wiring the prompt + permissions + tier.

## Tiers (`ModelTier`)

- `deep` — Opus-class (PRIME, `@plan`, `@code-reviewer-thorough`, `@architecture-advisor`)
- `mid-execute` — Strict executor tier (`@spec-reviewer`, `@code-reviewer`, `@build`)
- `mid` — Sonnet-class (`@plan-reviewer`, `@docs-maintainer`)
- `fast` — Haiku-class (`@code-searcher`, `@lib-reader`, `@agents-md-writer`)

Tiers are placeholders — the user's `opencode.json` resolves them to concrete model IDs via the installer. Never hardcode a model ID in a prompt.

## Adding a new agent

1. Write `prompts/<name>.md` with frontmatter.
2. In `index.ts`: add `const <name>Prompt = readPrompt("<name>.md")`, declare `<NAME>_PERMISSIONS`, add an `agentFromPrompt(...)` entry to `createAgents()`.
3. Add a case in `test/agents.test.ts` — count bump + per-agent assertion.
4. `bun run build && bun run typecheck && bun test`.

## Gotchas

- `injectWorkflowMechanics()` splices `shared/workflow-mechanics.md` into the PRIME prompt. If you change that shared file, the test asserts it's present — expected.
- `CORE_BASH_ALLOW_LIST` / `CORE_DESTRUCTIVE_BASH_DENIES` in `index.ts` are shared between several agents. Changes to these affect all of them — don't edit casually.
- Permission-map type-surface escape hatches (per-tool-name keys like `ast_grep`, `tsc_check`) are required; the SDK types are narrower than runtime. See `docs/plugin-architecture.md`.
- Prompts must not reference `~/.claude` or `~/.config/opencode` anywhere — `test/prompts-no-dangling-paths.test.ts` fails the build if they do.
