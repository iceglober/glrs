# `@glrs-dev/cli`

Unified CLI for the [@glrs-dev](https://www.npmjs.com/org/glrs-dev) ecosystem. One binary, two subcommands:

```bash
npm i -g @glrs-dev/cli
```

Requires [Bun](https://bun.sh) ≥ 1.2.0 on PATH at runtime.

## `glrs oc` — OpenCode agent harness

Dispatches to [`@glrs-dev/harness-plugin-opencode`](https://www.npmjs.com/package/@glrs-dev/harness-plugin-opencode) (bundled as a dependency). Resolves the bin via `require.resolve` → reads the `bin` field → spawns with argv forwarded.

```bash
glrs oc install       # install the OpenCode harness
glrs oc --help        # full harness help
```

The `harness-opencode` bin remains available directly for power users who prefer the untagged entry point.

## `glrs wt` — worktree management

Five named subcommands:

```bash
glrs wt new <name>    # create a new git worktree
glrs wt list          # list all worktrees for this repo
glrs wt switch        # switch to a worktree by name
glrs wt delete <name> # delete a worktree
glrs wt cleanup       # remove stale worktrees
```

**Bare invocation:** running `glrs wt` with no arguments in a TTY drops into an interactive picker — select a worktree to switch to without typing its name.

Worktrees are stored in `~/.glorious/worktrees/<repo>/<name>/`.

## Philosophy

- **Don't duplicate CLI logic.** `glrs oc` is a thin spawn wrapper around `harness-opencode`.
- **One install, one thing to remember** for the harness + worktree workflow.
- **Separate concerns stay separate.** The SSO credential tool [`@glrs-dev/assume`](https://www.npmjs.com/package/@glrs-dev/assume) is a standalone Rust binary installed separately.

## Docs

Full docs at [glrs.dev/cli/](https://glrs.dev/cli/) — generated from this README via the docs-site custom content loader.

## License

MIT.
