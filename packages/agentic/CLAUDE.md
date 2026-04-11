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
│   ├── start.ts          # gsag start — pipeline orchestrator
│   ├── status.ts         # gsag status — epic > task hierarchy view
│   ├── ready.ts          # gsag ready — show tasks ready to work on
│   ├── state/            # gsag state — task state management (internal)
│   │   ├── index.ts      # Subcommand group (task, epic, spec, review, qa, log)
│   │   ├── task.ts       # create, show, current, next, transition, update, cancel, list
│   │   ├── spec.ts       # show, set, add-task
│   │   ├── review.ts     # create, add-item, resolve, list, summary
│   │   ├── qa.ts         # QA report
│   │   └── log.ts        # Transition history
│   ├── go.ts             # gsag wt (bare) — interactive worktree picker
│   ├── create.ts         # gsag wt create
│   ├── checkout.ts       # gsag wt checkout
│   ├── list.ts           # gsag wt list (global, registry-based)
│   ├── delete.ts         # gsag wt delete (interactive multi-select or by name)
│   ├── cleanup.ts        # gsag wt cleanup
│   ├── root.ts           # gsag wt root
│   ├── install-skills.ts      # gsag skills (interactive scope picker, --user/--project)
│   ├── install-skills.test.ts # Unit tests for install-skills
│   ├── init-hooks.ts     # gsag wt hooks
│   └── upgrade.ts        # gsag upgrade
├── lib/
│   ├── db.ts             # SQLite singleton (sql.js WASM), schema, getRepo()
│   ├── db.test.ts        # Database module tests
│   ├── migrate.ts        # JSON-to-SQLite one-time migration
│   ├── migrate.test.ts   # Migration tests
│   ├── state.ts          # Epic/Task/Review model, CRUD, phase validation, queries
│   ├── state.test.ts     # State module tests
│   ├── pipeline.ts       # Orchestrator logic (skill sequencing, resume, epic task runner)
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
    ├── preamble.ts       # Shared task context for skills (uses gsag state task current)
    │
    │  # Engineering skills
    ├── think.ts          # /think — product strategy session
    ├── work.ts           # /work — implement a task
    ├── fix.ts            # /fix — bug fixes
    ├── qa.ts             # /qa — QA against acceptance criteria
    ├── ship.ts           # /ship — typecheck, review, version bump, release notes, CLAUDE.md sync, PR, CI monitoring
    │
    │  # gs- engineering skills (SQLite state)
    ├── gs-think.ts       # /gs-think — product strategy (SQLite state)
    ├── gs-work.ts        # /gs-work — implement a task (SQLite state)
    ├── gs-fix.ts         # /gs-fix — bug fixes (SQLite state)
    ├── gs-qa.ts          # /gs-qa — QA (SQLite state)
    ├── gs-ship.ts        # /gs-ship — ship with review state check
    ├── gs-build.ts       # /gs-build — implement a specific task
    ├── gs-build-loop.ts  # /gs-build-loop — loop through epic tasks
    ├── gs-deep-plan.ts   # /gs-deep-plan — zero-ambiguity planning
    ├── gs-deep-review.ts # /gs-deep-review — 6-agent parallel review
    ├── gs-quick-review.ts # /gs-quick-review — fast single-pass review
    ├── gs-address-feedback.ts # /gs-address-feedback — resolve PR feedback
    │
    │  # Research & spec skills
    ├── research.ts       # /research — master research orchestrator (routes to local/web/auto)
    ├── research-local.ts # /research-local — deep codebase research with parallel Explore subagents
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

- **Global state** lives in `~/.glorious/state.db` (SQLite via sql.js WASM, shared across repos/worktrees)
- **Specs** live in `.glorious/specs/` (committed, shared, per-repo)
- **`gsag state`** is the sole interface for reading/writing state — skills call it via Bash, never edit DB directly
- **Hierarchy**: Epic (`e1`) > Task (`t1`) > Step (plan text, not tracked in DB)
- **Pipeline phases**: understand → design → implement → verify → ship → done
- **Repo-scoped by default** — each task is keyed by `(repo, id)`. Use `--all` for cross-repo views.
- **Reviews** are stored in DB with commit SHA anchoring for persistence across context compaction
- Skills use `TASK_PREAMBLE` from `preamble.ts` to find the current task via `gsag state task current`

## Stack

- **Runtime**: Bun
- **CLI framework**: cmd-ts
- **Language**: TypeScript (ESM)
- **Build**: Bun bundler (build.ts)
- **Database**: sql.js (SQLite compiled to WASM, pure JS, fully bundled)
- **Claude integration**: @anthropic-ai/claude-agent-sdk

## Conventions

- All CLI commands use `cmd-ts` with the `command()` / `subcommands()` pattern
- Use `--id` options (not positional args) for task IDs in state commands
- Use `src/lib/fmt.ts` for terminal output (bold, dim, colors, ok, info, warn)
- `gitRoot()` resolves to the main repo root from any worktree
- `getRepo()` normalizes git remote URL for stable repo identification
- `initState()` must be called before any state operations (done in index.ts)

## Recent changes

See `releases/` for version history and changelogs.
