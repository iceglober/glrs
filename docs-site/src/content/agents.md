# Agents

30 agents. 7 user-selectable, the rest are subagents dispatched automatically.

## User-selectable

Pick these via Tab in OpenCode.

| Agent | Tier | Role |
|-------|------|------|
| `prime` | deep | [SPEAR](https://www.edge.ceo/p/introducing-spear-the-management) end-to-end workflow (default). Uses wave-based DAG execution for complex tasks. |
| `prime-ultra` | mid | Cost-optimized PRIME variant for fast execution |
| `plan` | deep | Interactive planner with gap analysis. Uses DAG-based planning by default. |
| `build` | mid | Plan executor |
| `scoper` | deep | Codebase scoping and context gathering |
| `designer` | mid | UI/UX design |
| `research` | deep | Multi-workstream research orchestrator |

## Subagents

Dispatched by user-selectable agents. You don't pick these directly.

| Agent | Tier | Role |
|-------|------|------|
| `code-reviewer` | mid | Adversarial code review |
| `code-reviewer-thorough` | deep | Full-suite adversarial review |
| `spec-reviewer` | mid | Spec and requirements review |
| `plan-reviewer` | mid | Adversarial plan review |
| `plan-ultra` | deep | DAG planner for wave-based dispatch |
| `gap-analyzer` | mid | Identifies gaps in plans |
| `architecture-advisor` | deep | Architecture guidance |
| `code-searcher` | fast | Codebase search |
| `docs-maintainer` | mid | Documentation updates |
| `lib-reader` | mid | Library/dependency reader |
| `agents-md-writer` | mid | AGENTS.md generation |
| `debriefer` | mid | Post-run summary |
| `research-web` | deep | Web search subagent |
| `research-local` | deep | Local codebase exploration subagent |
| `research-auto` | deep | Auto-selecting research subagent |

## Legacy agents

Previous-generation prompts, available as fallbacks.

| Agent | Tier | Role |
|-------|------|------|
| `prime-legacy` | deep | Pre-ultra PRIME prompt |
| `plan-legacy` | deep | Pre-ultra plan prompt |

## Autopilot-only

Used by [`glrs loop`](/autopilot). Not user-selectable.

| Agent | Tier | Role |
|-------|------|------|
| `autopilot-prime` | deep | PRIME without question [tool](/harness/tools) |
| `autopilot-fast` | mid | Fast executor for `--fast` sessions |

## Cost-optimized variants

Automatic cost cascading — try cheap first, escalate on failure.

| Agent | Tier | Base |
|-------|------|------|
| `build-cheap` | cheap | `build` |
| `build-deep` | deep | `build` |
| `plan-ultra-cheap` | cheap | `plan-ultra` |
| `plan-legacy-cheap` | cheap | `plan-legacy` |

## Tiers

| Tier | Model class | Override |
|------|------------|---------|
| deep | Opus-class | `harness.models.deep` |
| mid | Sonnet-class | `harness.models.mid` |
| mid-execute | Sonnet-class | `harness.models.mid` |
| fast | Haiku-class | `harness.models.fast` |
| cheap | GLM 4.7 Flash | `harness.models.cheap` |

See [configuration](/harness/config) for model overrides.
