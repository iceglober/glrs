# @glrs-dev/harness-plugin-opencode

OpenCode agent harness. 30 agents, 7 commands, 5 tools, 17 skills.

Docs: **[glrs.dev/harness](https://glrs.dev/harness)**

## Install

```bash
curl -fsSL https://glrs.dev/install.sh | bash
```

Or: `npm i -g @glrs-dev/cli && glrs harness install && opencode`

## Commands

```
/fresh ENG-1234              # branch + start SPEAR workflow
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
| `prime` | deep | SPEAR end-to-end (default) |
| `prime-ultra` | mid | Cost-optimized PRIME |
| `plan` | deep | Planner with gap analysis |
| `build` | mid | Plan executor |
| `research` | deep | Parallel codebase research |

Plus 25 subagents, autopilot variants, and cost-optimized tiers. Full list at [glrs.dev/harness/agents](https://glrs.dev/harness/agents).

## Configuration

Model overrides, MCP servers, env vars: [glrs.dev/harness/config](https://glrs.dev/harness/config)

## Security

Report vulnerabilities per [`SECURITY.md`](./SECURITY.md). Not a sandbox — treat the agent like a dev with shell access.

## License

MIT
