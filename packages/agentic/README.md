<div align="center">

<br/>

# `glorious-agentic`

**Design specs. Write code. Ship it.**<br/>
AI workflows for product & engineering, powered by Claude Code.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/iceglober/glorious?filter=agentic-*&style=flat-square&label=latest)](https://github.com/iceglober/glorious/releases)

<br/>

</div>

## Getting Started

### Installation

> [!NOTE]
> Requires Node.js 20+ and the [GitHub CLI](https://cli.github.com).

```bash
curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/agentic/install.sh | bash
```

### Install the Claude Code skills

```bash
gs-agentic skills
```

This installs slash commands (`/work`, `/ship`, etc.) into your Claude Code project settings. All commands below are invoked inside Claude Code sessions, not directly in the terminal.

<br/>

## The Full Loop

> From blank page to merged PR — 7 slash commands in Claude Code.

```
/research-web  Build a multi-tenant billing system with usage-based pricing
/spec-make     research/billing focused on metering and invoicing
/spec-enrich
/spec-refine

/work  billing system spec
/qa
/ship
```

<br/>

## Commands

### CLI

| Command | What happens |
|:--|:--|
| `gs-agentic start` | Launch the pipeline orchestrator for a task |
| `gs-agentic status` | Show task tree and progress |
| `gs-agentic skills` | Install Claude Code slash commands into project |
| `gs-agentic hooks` | Create post-create hook templates |
| `gs-agentic upgrade` | Self-update to latest release |
| `gs-agentic wt create <name>` | Create branch + worktree |
| `gs-agentic wt checkout <name>` | Checkout existing remote branch as worktree |
| `gs-agentic wt list` | List all worktrees |
| `gs-agentic wt cleanup` | Delete merged/stale worktrees |

### State & task tracking

> Epics contain tasks. Tasks flow through phases. Everything is tracked.

```
Epic (e1) ─── Task (t1) ─── understand → design → implement → verify → ship → done
           ├── Task (t2)
           └── Task (t3)
```

| Command | What happens |
|:--|:--|
| `gs-agentic status` | Tree view of all epics/tasks with progress bars |
| `gs-agentic ready` | Show tasks ready to work on (dependencies met) |
| `gs-agentic state plan sync --stdin` | Create epic + tasks atomically from piped input |
| `gs-agentic state task next --epic e1 --claim build` | Claim the next ready task (prevents races) |
| `gs-agentic state web` | Open read-only dashboard in the browser |

**Workflow: review → plan → build loop**

```
/deep-review   Review the diff, store findings in state
/deep-plan     Create an epic with sequenced tasks from review findings
/build-loop e1       Execute tasks one by one, auto-claiming the next
```

### Design — idea to spec

> Each step reduces ambiguity. Loop `enrich -> refine` until unknowns hit zero.

```
/research-web  ->  /spec-make  ->  /spec-enrich  ->  /spec-refine x N  ->  /spec-review
                                                                              |
                                                                          /spec-lab
```

| Slash command | What happens |
|:--|:--|
| `/research-web` | Spawns parallel research agents, synthesizes findings |
| `/spec-make` | Turns research _or a plain description_ into a spec with tracked unknowns |
| `/spec-enrich` | Reads your codebase to resolve unknowns autonomously |
| `/spec-refine` | Walks through remaining unknowns with you, one at a time |
| `/spec-review` | Audits the spec for gaps, conflicts, and opportunities |
| `/spec-lab` | Runs yes/no validation experiments against unknowns |

### Build — spec to production

| Slash command | What happens |
|:--|:--|
| `/think` | Strategy session — forces "why" before "how" |
| `/work` | Implements from a description. Pulls latest, creates branch, codes. |
| `/work-backlog` | Works through `.glorious/backlog.json` checklist items |
| `/fix` | Targeted bug fixes within task scope |
| `/qa` | Diffs against acceptance criteria. PASS/FAIL per scenario. |
| `/ship` | Typecheck -> review -> version bump -> release notes -> PR |

### Product management

| Slash command | What happens |
|:--|:--|
| `/product-manager` | End-to-end PM workflow |
| `/product-problem` | Problem definition |
| `/product-interview` | Stakeholder interview |
| `/product-requirements` | Tier-1 PRD |
| `/product-acceptance` | Acceptance criteria |
| `/product-build` | Build product artifacts |
| `/product-evaluate` | Artifact quality scoring |
| `/product-engineering-handoff` | Engineering handoff doc |
| `/product-research-benchmarks` | Industry KPIs |
| `/product-research-competitive` | Competitor analysis |
| `/product-research-domain` | Domain knowledge |
| `/product-research-market` | Market sizing |
| `/product-research-technical` | Codebase feasibility |

### Auto-activated skills

> These activate automatically when relevant — no slash command needed.

| Skill | When it activates |
|:--|:--|
| `/browser` | UI testing in `/qa`, PR screenshots in `/ship`. Powered by [Playwright CLI](https://github.com/microsoft/playwright-cli). |
| `/research-auto` | Autonomous think->test->reflect experimentation loop. Based on [ResearcherSkill](https://github.com/krzysztofdudek/ResearcherSkill). |

<br/>

## Development

```bash
bun run build        # Build to dist/index.js
bun run dev          # Watch mode build
bun run typecheck    # bun x tsc --noEmit
bun test             # Run tests
```

---

<div align="center">
<sub>MIT License</sub>
</div>
