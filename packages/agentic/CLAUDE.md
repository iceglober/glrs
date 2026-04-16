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
│   ├── status.ts         # gsag status — epic > task hierarchy view
│   ├── ready.ts          # gsag ready — show tasks ready to work on
│   ├── state/            # gsag state — task state management (internal)
│   │   ├── index.ts      # Subcommand group (task, epic, plan, review, qa, log, web)
│   │   ├── task.ts       # create, show, current, next, transition, update, cancel, list; epic: create, show, list, export
│   │   ├── task.test.ts  # CLI integration tests for task commands
│   │   ├── plan.ts       # show, set (--file/--content/--stdin), add-task, history, feedback, resolve-feedback
│   │   ├── review.ts     # create, add-item, resolve, list, summary
│   │   ├── qa.ts         # QA report
│   │   ├── log.ts        # Transition history
│   │   └── web.ts        # gsag state web — open state dashboard in browser
│   ├── go.ts             # gsag wt (bare) — interactive worktree picker
│   ├── create.ts         # gsag wt create
│   ├── checkout.ts       # gsag wt checkout
│   ├── list.ts           # gsag wt list (global, registry-based)
│   ├── delete.ts         # gsag wt delete (interactive multi-select or by name)
│   ├── cleanup.ts        # gsag wt cleanup
│   ├── root.ts           # gsag wt root
│   ├── plan-review.ts    # gsag plan review — open plan in browser with feedback
│   ├── install-skills.ts      # gsag skills (interactive scope picker, --user/--project/--prefix)
│   ├── install-skills.test.ts # Unit tests for install-skills
│   ├── config.ts         # gsag config (get/set/list/unset settings)
│   ├── init-hooks.ts     # gsag wt hooks
│   └── upgrade.ts        # gsag upgrade
├── lib/
│   ├── db.ts             # SQLite singleton (sql.js WASM), schema, getRepo()
│   ├── db.test.ts        # Database module tests
│   ├── migrate.ts        # JSON-to-SQLite one-time migration
│   ├── migrate.test.ts   # Migration tests
│   ├── state.ts          # Epic/Task/Review model, CRUD, phase validation, queries
│   ├── state.test.ts     # State module tests
│   ├── git.ts            # Git wrappers (git, gitRoot, listWorktrees)
│   ├── worktree.ts       # createWorktree, ensureWorktree (auto-registers)
│   ├── registry.ts       # Global worktree registry (~/.glorious/worktrees.json)
│   ├── select.ts         # Interactive terminal pickers (select, multiSelect)
│   ├── config.ts         # worktreePath, repoName, isProtected
│   ├── hooks.ts          # runHook (non-fatal, per-command resilient)
│   ├── slug.ts           # slugify
│   ├── open-browser.ts       # Open URL in default browser (execFile, setting-gated)
│   ├── open-browser.test.ts  # Open browser tests
│   ├── plan-feedback.ts      # Feedback read/write/clear for plan review
│   ├── plan-feedback.test.ts # Plan feedback tests
│   ├── plan-html.ts          # Markdown→HTML plan renderer with feedback buttons
│   ├── plan-html.test.ts     # Plan HTML tests
│   ├── plan-server.ts        # Local HTTP server for plan review sessions
│   ├── plan-server.test.ts   # Plan server tests
│   ├── state-html.ts         # React+htm CDN dashboard HTML renderer
│   ├── state-html.test.ts   # State HTML tests
│   ├── state-server.ts      # Local HTTP server for state web dashboard
│   ├── state-server.test.ts # State server tests
│   ├── settings.ts           # User settings (~/.glorious/settings.json)
│   ├── settings.test.ts      # Settings tests
│   ├── fmt.ts            # Terminal formatting (bold, dim, colors, ok/okErr/info/warn)
│   ├── version.ts        # VERSION constant
│   └── update-check.ts   # Update checker
└── skills/
    ├── index.ts          # SkillEntry type, GS_SKILL_NAMES, buildAllSkills(), buildCommands() (deprecated), BUILTIN_COLLISIONS
    ├── index.test.ts     # Unit tests for skill registry, buildAllSkills, enhanced frontmatter
    ├── preamble.ts       # Role-specific preambles (READONLY/TASK/REVIEW/BUILD/AUTO) for skills
    ├── preamble.test.ts  # Preamble tests (output convention, plan sync recipe, READONLY negatives, AUTO directives)
    │
    │  # Engineering skills (default: /think, /work, etc. — configurable via --prefix)
    ├── gs.ts             # /gs — general workflow assistant
    ├── gs.test.ts        # Unit tests for gs skill
    ├── gs-think.ts       # /think — product strategy (read-only analysis)
    ├── gs-think.test.ts  # Unit tests for think skill
    ├── gs-work.ts        # /work — implement a task
    ├── gs-fix.ts         # /fix — TDD bug resolution
    ├── gs-fix.test.ts    # Unit tests for fix skill
    ├── gs-qa.ts          # /qa — QA with review DB storage
    ├── gs-qa.test.ts     # Unit tests for qa skill
    ├── gs-ship.ts        # /ship — ship with review state check
    ├── gs-build.ts       # /build — implement a specific task
    ├── gs-build-loop.ts  # /build-loop — loop through epic tasks
    ├── gs-deep-plan.ts   # /deep-plan — zero-ambiguity planning
    ├── gs-deep-plan.test.ts # Unit tests for deep-plan skill
    ├── gs-deep-review.ts # /deep-review — 6-agent parallel review
    ├── gs-quick-review.ts # /quick-review — fast single-pass review
    ├── gs-address-feedback.ts # /address-feedback — resolve PR feedback
    ├── gs-plan-loop.ts   # /plan-loop — autonomous planning loop
    ├── gs-plan-loop.test.ts # Unit tests for plan-loop skill
    ├── gs-auto-loop.ts   # /auto-loop — autonomous implementation loop
    ├── gs-auto-loop.test.ts # Unit tests for auto-loop skill
    ├── cross-refs.test.ts # Verifies no skill uses /gs- prefixed cross-references
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

- **Global state** lives in `~/.glorious/state.db` (SQLite via sql.js WASM, shared across repos/worktrees, file-locked for concurrent access)
- **Plans** live in `~/.glorious/plans/<repo-slug>/` (global, versioned, immutable v1/v2/vN files)
- **`gsag state`** is the sole interface for reading/writing state — skills call it via Bash, never edit DB directly
- **Hierarchy**: Epic (`e1`) > Task (`t1`) > Step (`s1`) — all tracked in DB, all can have plans attached
- **Pipeline phases**: understand → design → implement → verify → ship → done
- **Repo-scoped by default** — each task is keyed by `(repo, id)`. `state web` shows all repos by default; use `--local` for single-repo view.
- **Reviews** are stored in DB with commit SHA anchoring for persistence across context compaction
- **SkillEntry type** — generators return `Record<string, string>` where `"SKILL.md"` is the main file and other keys are reference files (e.g., `"references/agent-prompts.md"`)
- **Skills install to `.claude/skills/<name>/SKILL.md`** — the v3 format uses SKILL.md directories instead of legacy `.claude/commands/*.md` flat files
- **All skills have `disable-model-invocation: false` after install** — source generators use `true` but `buildAllSkills()` flips to `false` so skills can be invoked via the Skill tool
- **Plugin manifest** at `.claude-plugin/plugin.json` — generated by `gsag plugin generate`
- **Claude Code hooks** — `gsag claude-hooks` scaffolds PostToolUse (formatting) and PreToolUse (safety) hooks to `.claude/settings.local.json`
- Skills use role-specific preambles from `preamble.ts`: `READONLY_PREAMBLE` (think), `TASK_PREAMBLE` (work/fix/ship/plan), `REVIEW_PREAMBLE` (review/qa), `BUILD_PREAMBLE` (build), `AUTO_PREAMBLE` (plan-loop/auto-loop)
- Large skills use progressive disclosure: heavy content in `references/` files, loaded on demand via reference maps

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

### v3.0.0 — Skills-Native Architecture Overhaul

- **SkillEntry type**: all generators return `Record<string, string>` (SKILL.md + optional references)
- **Skills format**: install to `.claude/skills/<name>/SKILL.md` instead of `.claude/commands/*.md`
- **Enhanced frontmatter**: `name`, `argument-hint`, `disable-model-invocation`, `allowed-tools`
- **Progressive disclosure**: deep-review agent prompts and deep-plan TDD methodology extracted to reference files
- **Plugin packaging**: `gsag plugin generate` creates `.claude-plugin/plugin.json`
- **Hook infrastructure**: `gsag claude-hooks` scaffolds PostToolUse formatting and PreToolUse safety hooks
- **State tokens**: `--format agent` for compact output, `gsag status --compact` for single-line dashboard
- **Skill testing**: `validateSkill()` and `testTriggers()` for skill validation
- **Auto-migration**: old commands-format installs automatically migrate to skills format on CLI startup

See `releases/` for full version history.
