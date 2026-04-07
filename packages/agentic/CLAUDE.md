# agentic

AI-native development workflow CLI. Manages worktrees, tasks, and Claude Code skills.

## Commands

```bash
bun run build        # Build to dist/index.js
bun run dev          # Watch mode build
bun run typecheck    # bun x tsc --noEmit
bun test             # Run tests
```

Run the CLI locally: `node dist/index.js <command>`

## Architecture

```
src/
├── index.ts              # CLI entry point (cmd-ts router)
├── help.ts               # Manual text
├── commands/
│   ├── start.ts          # gs-agentic start — pipeline orchestrator
│   ├── status.ts         # gs-agentic status — task tree view
│   ├── state/            # gs-agentic state — task state management (internal)
│   │   ├── index.ts      # Subcommand group
│   │   ├── task.ts       # create, show, transition, update, cancel, list
│   │   ├── spec.ts       # show, set, add-workstream
│   │   ├── qa.ts         # QA report
│   │   └── log.ts        # Transition history
│   ├── go.ts             # gs-agentic wt (bare) — interactive worktree picker
│   ├── create.ts         # gs-agentic wt create
│   ├── checkout.ts       # gs-agentic wt checkout
│   ├── list.ts           # gs-agentic wt list (global, registry-based)
│   ├── delete.ts         # gs-agentic wt delete (interactive multi-select or by name)
│   ├── cleanup.ts        # gs-agentic wt cleanup
│   ├── root.ts           # gs-agentic wt root
│   ├── install-skills.ts # gs-agentic skills
│   ├── init-hooks.ts     # gs-agentic wt hooks
│   └── upgrade.ts        # gs-agentic upgrade
├── lib/
│   ├── state.ts          # Task model, CRUD, phase validation, auto-setup
│   ├── state.test.ts     # State module tests
│   ├── pipeline.ts       # Orchestrator logic (skill sequencing, resume)
│   ├── session-runner.ts # Spawn Claude sessions as subprocesses
│   ├── git.ts            # Git wrappers (git, gitRoot, listWorktrees)
│   ├── worktree.ts       # createWorktree, ensureWorktree (auto-registers)
│   ├── registry.ts       # Global worktree registry (~/.glorious/worktrees.json)
│   ├── select.ts         # Interactive terminal pickers (select, multiSelect)
│   ├── config.ts         # worktreePath, repoName, isProtected
│   ├── hooks.ts          # runHook (non-fatal, per-command resilient)
│   ├── slug.ts           # slugify
│   ├── fmt.ts            # Terminal formatting (bold, dim, colors)
│   ├── version.ts        # VERSION constant
│   └── update-check.ts   # Update checker
└── skills/
    ├── index.ts          # COMMANDS & SKILLS registry
    ├── preamble.ts       # Shared task context for skills (uses gs-agentic state)
    │
    │  # Engineering skills
    ├── think.ts          # /think — product strategy session
    ├── work.ts           # /work — implement a task
    ├── fix.ts            # /fix — bug fixes
    ├── qa.ts             # /qa — QA against acceptance criteria
    ├── ship.ts           # /ship — typecheck, review, version bump, release notes, CLAUDE.md sync, PR
    │
    │  # Research & spec skills
    ├── research-auto.ts  # /research-auto — autonomous experimentation
    ├── research-web.ts   # /research-web — multi-agent web research
    ├── spec-make.ts      # /spec-make — create product spec
    ├── spec-refine.ts    # /spec-refine — interactive spec refinement
    ├── spec-enrich.ts    # /spec-enrich — enrich spec from codebase
    ├── spec-review.ts    # /spec-review — spec gap analysis
    ├── spec-lab.ts       # /spec-lab — validation experiments
    │
    │  # Product management suite
    ├── product-manager.ts            # /product-manager — end-to-end PM workflow
    ├── product-acceptance.ts         # /product-acceptance — acceptance criteria
    ├── product-build.ts              # /product-build — build product artifacts
    ├── product-evaluate.ts           # /product-evaluate — artifact quality scoring
    ├── product-engineering-handoff.ts # /product-engineering-handoff — eng handoff doc
    ├── product-interview.ts          # /product-interview — stakeholder interview
    ├── product-problem.ts            # /product-problem — problem definition
    ├── product-requirements.ts       # /product-requirements — tier-1 PRD
    ├── product-research-benchmarks.ts    # /product-research-benchmarks — industry KPIs
    ├── product-research-competitive.ts   # /product-research-competitive — competitor analysis
    ├── product-research-domain.ts        # /product-research-domain — domain knowledge
    ├── product-research-market.ts        # /product-research-market — market sizing
    ├── product-research-technical.ts     # /product-research-technical — codebase feasibility
    │
    │  # Auto-activated skills
    ├── browser.ts        # /browser — browser automation via Playwright CLI
    └── writing-skills.ts # /writing-skills — skill authoring guide (TDD, testing, persuasion)
```

## Key concepts

- **Task state** lives in `.glorious/state/` (gitignored, per-engineer)
- **Specs** live in `.glorious/specs/` (committed, shared)
- **`gs-agentic state`** is the sole interface for reading/writing state — skills call it via Bash, never edit files directly
- **Pipeline phases**: understand → design → implement → verify → ship → done
- **Each skill runs as a separate Claude session** to avoid context window bloat
- Skills use `TASK_PREAMBLE` from `preamble.ts` to find the current task via `gs-agentic state`

## Stack

- **Runtime**: Bun
- **CLI framework**: cmd-ts
- **Language**: TypeScript (ESM)
- **Build**: Bun bundler (build.ts)
- **Claude integration**: @anthropic-ai/claude-agent-sdk

## Conventions

- All CLI commands use `cmd-ts` with the `command()` / `subcommands()` pattern
- Use `--id` options (not positional args) for task IDs in state commands
- Use `src/lib/fmt.ts` for terminal output (bold, dim, colors, ok, info, warn)
- `gitRoot()` resolves to the main repo root from any worktree
- State auto-creates directories and `.gitignore` entries on first write

## Recent changes

See `releases/` for version history and changelogs.
