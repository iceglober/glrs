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

### Install

> [!NOTE]
> Requires Node.js 20+ and the [GitHub CLI](https://cli.github.com).

```bash
curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/agentic/install.sh | bash
```

### Install Claude Code skills

```bash
gsag skills
```

This installs slash commands (`/work`, `/ship`, `/deep-plan`, etc.) into your Claude Code project. All slash commands below are used inside Claude Code sessions, not directly in the terminal.

> [!TIP]
> Use `gsag skills --user` to install globally (all projects) or `gsag skills --project` to install per-repo. With no flag, an interactive picker appears.
> Use `--prefix gs-` for prefixed names (`/gs-work`, `/gs-ship`, etc.).

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

## Slash Commands

### Engineering

| Command | What it does |
|:--|:--|
| `/gs` | General workflow assistant |
| `/think` | Strategy session — forces "why" before "how" (read-only) |
| `/work` | Implement from a description — pulls latest, creates branch, codes |
| `/fix` | Targeted bug fix within task scope |
| `/qa` | Diff against acceptance criteria — PASS/FAIL per scenario |
| `/ship` | Typecheck, review, version bump, release notes, PR |
| `/build` | Implement a specific gsag task by ID |
| `/build-loop` | Loop through an epic's tasks, auto-claiming the next |
| `/deep-plan` | Zero-ambiguity implementation plan with epic + task creation |
| `/deep-review` | 6-agent parallel code review (security, data, API, tests, logic, frontend) |
| `/quick-review` | Fast single-pass code review |
| `/address-feedback` | Resolve PR review feedback |

### Research & Design

> Each step reduces ambiguity. Loop `enrich -> refine` until unknowns hit zero.

```
/research      Master orchestrator — routes to local, web, or auto research
      |
/research-web  ->  /spec-make  ->  /spec-enrich  ->  /spec-refine x N  ->  /spec-review
                                                                              |
                                                                          /spec-lab
```

| Command | What it does |
|:--|:--|
| `/research` | Master research orchestrator — plans workstreams, dispatches agents, iterates |
| `/research-web` | Multi-agent web research with parallel queries and synthesis |
| `/research-local` | Deep codebase research with parallel Explore subagents |
| `/spec-make` | Create a product spec from research or a plain description |
| `/spec-enrich` | Resolve unknowns autonomously by reading your codebase |
| `/spec-refine` | Walk through remaining unknowns with you, one at a time |
| `/spec-review` | Audit the spec for gaps, conflicts, and opportunities |
| `/spec-lab` | Run yes/no validation experiments against unknowns |

### Product Management

| Command | What it does |
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

### Auto-Activated Skills

These activate automatically when relevant — no slash command needed.

| Skill | When it activates |
|:--|:--|
| `browser` | UI testing in `/qa`, PR screenshots in `/ship`. Uses [Playwright CLI](https://github.com/anthropics/claude-code/tree/main/packages/playwright-mcp). |
| `research-auto` | Autonomous think-test-reflect experimentation loop |
| `writing-skills` | Skill authoring guidance — TDD patterns, testing, persuasion |

<br/>

## CLI Commands

### Workflow

| Command | What it does |
|:--|:--|
| `gsag status` | Tree view of all epics/tasks with phases, branches, and progress bars |
| `gsag status --epic e1` | Single epic view with progress bar |
| `gsag ready` | Show tasks ready to work on (all dependencies met) |
| `gsag skills` | Install Claude Code slash commands (interactive scope picker) |
| `gsag upgrade` | Self-update to latest release |

### State & Task Tracking

> All state lives in `~/.glorious/state.db` — shared across repos and worktrees.

```
Epic (e1) ─── Task (t1) ─── understand → design → implement → verify → ship → done
           ├── Task (t2)
           └── Task (t3)
```

| Command | What it does |
|:--|:--|
| `gsag state task create --title "..."` | Create a task (optionally `--epic <id>`) |
| `gsag state task show --id t1 --json` | Show task details (`--with-spec` for plan content) |
| `gsag state task current` | Show the task for the current branch |
| `gsag state task next --epic e1 --claim build` | Atomically claim the next ready task (prevents races) |
| `gsag state task transition --id t1 --phase done` | Move a task to a new phase |
| `gsag state task note --id t1 --body "..."` | Add a note to a task |
| `gsag state task list --epic e1 --json` | List tasks with filters |
| `gsag state epic create --title "..."` | Create an epic |
| `gsag state plan sync --stdin` | Create epic + tasks atomically from piped input |
| `gsag state plan show --id e1` | Display plan content for a task or epic |
| `gsag state review create --task t1 --source qa --commit-sha $(git rev-parse HEAD)` | Create a review record |
| `gsag state review add-item --review r1 --body "..." --severity HIGH` | Add a review finding |
| `gsag state qa --id t1 --status pass --summary "All green"` | Record QA pass/fail |
| `gsag state web` | Open browser dashboard (auto-refreshes, all repos) |

**Common pattern: review, plan, build loop**

```bash
# In Claude Code:
/deep-review                    # Review the diff, store findings in state
/deep-plan fix all findings     # Create an epic with sequenced tasks
/build-loop e1                  # Execute tasks one-by-one, auto-claiming next

# Atomic epic + tasks from CLI:
cat <<'EOF' | gsag state plan sync --stdin
title: Fix review findings
description: Address all critical and high findings
---
ref:1.1 | Fix SQL injection in query builder
ref:1.2 | Add input validation | depends:1.1
ref:2.1 | Add missing test coverage
EOF
```

### Plan Review

| Command | What it does |
|:--|:--|
| `gsag plan review --id e1` | Open plan in browser with per-step feedback buttons |

Starts a local server, renders the plan as HTML, and saves per-step feedback that skills can read during `/deep-plan` updates.

### Worktree Management

| Command | What it does |
|:--|:--|
| `gsag wt` | Interactive worktree picker — opens a shell in the selected worktree |
| `gsag wt create <name>` | Create branch + worktree from main |
| `gsag wt checkout <branch>` | Create worktree from an existing remote branch |
| `gsag wt list` | List all worktrees across all repos |
| `gsag wt delete` | Interactive multi-select deletion (or `gsag wt delete <name>`) |
| `gsag wt cleanup` | Delete worktrees whose branches are merged or whose remote is gone |
| `gsag wt root` | Print the main repo root path (useful from inside a worktree) |
| `gsag wt hooks` | Create `.glorious/hooks/` with a post_create template |

### Configuration

| Command | What it does |
|:--|:--|
| `gsag config list` | Show all settings with values and sources |
| `gsag config get <key>` | Get a config value |
| `gsag config set <key> <value>` | Set a config value |
| `gsag config unset <key>` | Reset to default |

Available settings:

| Key | Default | Description |
|:--|:--|:--|
| `plan.auto-open` | `true` | Open browser automatically in plan review |
| `state.auto-open` | `true` | Open browser automatically in state web |

### Environment Variables

| Variable | Description |
|:--|:--|
| `GLORIOUS_DIR` | Override where worktrees are stored (default: siblings of the repo) |

<br/>

## Development

```bash
bun run build        # Build to dist/index.js
bun run dev          # Watch mode build
bun run typecheck    # bun x tsc --noEmit
bun test             # Run tests (515 tests)
```

<br/>

## Architecture

State is managed via SQLite (sql.js WASM) at `~/.glorious/state.db`, shared across repos and worktrees with file-level locking for concurrent access. Plans live in `~/.glorious/plans/<repo-slug>/` as versioned files.

Skills are installed as Claude Code slash commands (`.claude/commands/*.md`). Each skill embeds a role-specific preamble that tells the AI how to find its current task and which state mutations are available.

The CLI is built with [cmd-ts](https://github.com/Schniz/cmd-ts), bundled with Bun into a single `dist/index.js`, and distributed via GitHub Releases with a curl installer.

---

<div align="center">
<sub>MIT License</sub>
</div>
