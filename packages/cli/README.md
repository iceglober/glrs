# `@glrs-dev/cli`

Unified CLI for the [@glrs-dev](https://www.npmjs.com/org/glrs-dev) ecosystem. One binary, two subcommands:

```bash
npm i -g @glrs-dev/cli
```

```bash
glrs oc install       # → OpenCode harness install
glrs wt new feature   # create a worktree
glrs wt list          # list worktrees across repos
glrs wt switch        # interactive picker
```

Requires [Bun](https://bun.sh) on PATH at runtime.

The `harness-opencode` bin remains available directly for power users who prefer the untagged entry point.

## How it works

The `glrs` binary has two subcommands:

- **`glrs oc <args>`** — dispatches to [`@glrs-dev/harness-opencode`](../harness-opencode/) (bundled as a dependency). Resolves the bin via `require.resolve(<package>/package.json)` → reads the `bin` field → spawns with argv forwarded.
- **`glrs wt <args>`** — worktree management, handled natively. Commands: `new`, `list`, `switch`, `delete`, `cleanup`. Worktrees are stored in `~/.glorious/worktrees/<repo>/<name>/`.

## Philosophy

- **Don't duplicate CLI logic.** `glrs oc` is a thin spawn wrapper around `harness-opencode`.
- **One install, one thing to remember** for the harness + worktree workflow.
- **Separate concerns stay separate.** The SSO credential tool [`@glrs-dev/assume`](../assume/) is a standalone Rust binary installed separately.

## Docs

[glrs.dev](https://glrs.dev) — full ecosystem docs.

## License

MIT.
