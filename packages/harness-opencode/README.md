# @glrs-dev/harness-plugin-opencode

OpenCode agent harness. 27 agents, 7 commands, 5 tools, 18 skills.

Docs: **[glrs.dev/harness](https://glrs.dev/harness)**

## Install

```bash
curl -fsSL https://glrs.dev/install.sh | bash
```

Or: `npm i -g @glrs-dev/cli && glrs harness install && opencode`

## Commands

```
/fresh ENG-1234              # branch + start [SPEAR](https://www.edge.ceo/p/introducing-spear-the-management) workflow
/fresh add rate limiting     # same, from description
/ship                        # squash, push, open PR
/review 87                   # adversarial code review
/research how does auth work # parallel codebase search
/costs                       # LLM spend
/dispatches                  # subagent history
```

## Autopilot

```bash
glrs loop "implement the auth middleware"
```

## Agents

| Agent | Tier | What it does |
|-------|------|------|
| `prime` | mid | [SPEAR](https://www.edge.ceo/p/introducing-spear-the-management) end-to-end — Sonnet orchestrator, delegates hard work to Opus (default) |
| `prime-heavy` | deep | PRIME on Opus — use for heavyweight orchestration |
| `plan` | deep | Planner with gap analysis |
| `build` | mid | Plan executor |
| `research` | deep | Parallel codebase research |

Plus 22 subagents, autopilot variants, and cost-optimized tiers. Full list at [glrs.dev/harness/agents](https://glrs.dev/harness/agents).

## Configuration

Model overrides, MCP servers, env vars: [glrs.dev/harness/config](https://glrs.dev/harness/config)

## Telemetry

The harness sends anonymous usage events via [Counted](https://app.counted.dev)
to help prioritize work: per-model token speed and cost (`model_turn`), tool and
skill usage with best-effort success (`tool_used`), and post-edit type-check
results (`post_edit_verify`). No cookies, no fingerprinting, no PII — never repo
names, branch names, paths, prompts, or arguments; properties are public
model/provider ids, enums, booleans, and counts only. Tracking never blocks or
breaks a session and a dead network can never delay it.

Opt out with either:

```bash
export DO_NOT_TRACK=1        # the cross-tool Do Not Track standard
export GLRS_NO_ANALYTICS=1   # glrs-specific
```

## Security

Report vulnerabilities per [`SECURITY.md`](./SECURITY.md). Not a sandbox — treat the agent like a dev with shell access.

## License

MIT
