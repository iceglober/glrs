# `@glrs-dev/cli`

Unified CLI for the [@glrs-dev](https://www.npmjs.com/org/glrs-dev) ecosystem. One binary, six subcommands:

```bash
npm i -g @glrs-dev/cli
```

Requires [Bun](https://bun.sh) ≥ 1.2.0 on PATH at runtime.

## `glrs harness` — OpenCode agent harness

Plugin management for [`@glrs-dev/harness-plugin-opencode`](https://www.npmjs.com/package/@glrs-dev/harness-plugin-opencode) (bundled as a dependency).

```bash
glrs harness install      # register the harness in opencode.json
glrs harness configure    # interactive configuration
glrs harness doctor       # check installation health
glrs harness uninstall    # remove from opencode.json
```

## `glrs wt` — worktree management

```bash
glrs wt new               # create a new worktree (auto-named)
glrs wt list              # list all worktrees across repos
glrs wt switch            # interactively select and switch
glrs wt delete            # remove worktrees (interactive or by name)
glrs wt cleanup           # delete merged/stale worktrees
```

**Bare invocation:** running `glrs wt` with no arguments in a TTY drops into an interactive picker.

## `glrs autopilot` — autonomous orchestrator

Three-phase scope → plan → execute orchestrator with self-assessment.

```bash
glrs autopilot --plan docs/plans/my-plan/
```

## `glrs loop` — raw prompt loop

Runs PRIME in a loop with a raw prompt. Exits on `<autopilot-done>` sentinel or budget limits.

```bash
glrs loop "implement the auth middleware"
```

## `glrs dashboard` — live TUI

Real-time dashboard for all running autopilot sessions.

```bash
glrs dashboard
```

## `glrs upgrade` — self-update

```bash
glrs upgrade
```

Auto-update also runs on every CLI invocation (rate-limited to once per hour).

## Philosophy

- **One install, one thing to remember** for the harness + worktree + autopilot workflow.
- **Separate concerns stay separate.** The SSO credential tool [`@glrs-dev/assume`](https://www.npmjs.com/package/@glrs-dev/assume) is a standalone Rust binary installed separately.

## Docs

Full docs at [glrs.dev/cli/](https://glrs.dev/cli/).

## License

MIT.
