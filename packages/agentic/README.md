<div align="center">

<br/>

# `agentic`

**Design specs. Write code. Ship it.**<br/>
AI workflows for product & engineering, powered by Claude Code.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/iceglober/glorious?style=flat-square&label=latest)](https://github.com/iceglober/glorious/releases)

<br/>

</div>

## Getting Started

### Installation

> [!NOTE]
> Requires Node.js 20+ and the [GitHub CLI](https://cli.github.com).

```bash
curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/agentic/install.sh | bash
```

### Get the skills

```bash
gs-agentic skills
```

<br/>

## The Full Loop

> From blank page to merged PR — 7 commands.

```bash
# ── design ──────────────────────────────────────────
/research-web  Build a multi-tenant billing system with usage-based pricing
/spec-make     research/billing focused on metering and invoicing
/spec-enrich
/spec-refine

# ── build ───────────────────────────────────────────
/work  billing system spec
/qa
/ship
```

<br/>

## Commands

### `design` — idea to spec

> Each step reduces ambiguity. Loop `enrich → refine` until unknowns hit zero.

```
/research-web  →  /spec-make  →  /spec-enrich  →  /spec-refine × N  →  /spec-review
                                                                           ↕
                                                                       /spec-lab
```

| Command | What happens |
|:--|:--|
| `/research-web` | Spawns parallel research agents, synthesizes findings |
| `/spec-make` | Turns research _or a plain description_ into a spec with tracked unknowns |
| `/spec-enrich` | Reads your codebase to resolve unknowns autonomously |
| `/spec-refine` | Walks through remaining unknowns with you, one at a time |
| `/spec-review` | Audits the spec for gaps, conflicts, and opportunities |
| `/spec-lab` | Runs yes/no validation experiments against unknowns |

<details>
<summary><code>/spec-make</code> works from research or a description</summary>

```bash
/spec-make research/billing focused on metering
/spec-make A CSV export feature with configurable column selection
```
</details>

<br/>

### `build` — spec to production

| Command | What happens |
|:--|:--|
| `/think` | Strategy session — forces "why" before "how" |
| `/work` | Implements from a description. Pulls latest, creates branch, codes. |
| `/work-backlog` | Works through `.glorious/backlog.json` checklist items |
| `/fix` | Targeted bug fixes within task scope |
| `/qa` | Diffs against acceptance criteria. PASS/FAIL per scenario. |
| `/ship` | Typecheck → review → commit → push → PR |

<br/>

## Skills

> Skills activate automatically when relevant — no slash command needed.

| Skill | When it activates |
|:--|:--|
| `/browser` | UI testing in `/qa`, PR screenshots in `/ship`. Powered by [Playwright CLI](https://github.com/microsoft/playwright-cli). |
| `/research-auto` | Autonomous think→test→reflect experimentation loop. Based on [ResearcherSkill](https://github.com/krzysztofdudek/ResearcherSkill). |

```bash
/research-auto  Optimize p99 latency of /api/billing/usage endpoint
```

<br/>

## Worktrees

```bash
gs-agentic wt create feature-auth        # new branch + worktree
gs-agentic wt checkout feature-payments   # from existing remote branch
gs-agentic wt list                        # show all
gs-agentic wt cleanup                     # delete merged/stale
```

---

<div align="center">
<sub>MIT License</sub>
</div>
