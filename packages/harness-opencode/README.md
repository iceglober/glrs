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

## Security

Report vulnerabilities per [`SECURITY.md`](./SECURITY.md). Not a sandbox — treat the agent like a dev with shell access.

## License

MIT
