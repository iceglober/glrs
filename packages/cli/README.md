# `@glrs-dev/cli`

Unified CLI for the [@glrs-dev](https://www.npmjs.com/org/glrs-dev) ecosystem. One binary, three subcommands:

```bash
npm i -g @glrs-dev/cli
```

```bash
glrs oc install              # → harness-opencode install
glrs agentic wt new feature  # → gs-agentic wt new feature
glrs assume login aws        # → gs-assume login aws
```

Each subtool still ships its own direct bin — `harness-opencode`, `gs-agentic` / `gsag`, `gs-assume` / `gsa` — if you prefer typing those. The dispatcher exists to give new users one install command and one entry point to remember.

## How it works

The `glrs` binary is a thin dispatcher. It:

1. Reads the first positional arg as the subcommand (`oc`, `agentic`, `assume`)
2. Resolves the underlying binary via `require.resolve(<package>/package.json)` → reads the `bin` field
3. Spawns the binary with the remaining argv forwarded, inheriting stdio
4. Exits with the child's exit code

For the `assume` subcommand, the dispatcher imports `@glrs-dev/assume`'s exported `getBinaryPath()` directly and execs the prebuilt Rust binary — skipping the TS shim middle-layer for interactive credential operations.

## Philosophy

- **Don't duplicate CLI logic.** Every flag, every subcommand, every option lives in the underlying tool. The dispatcher adds no behavior.
- **Don't fragment muscle memory.** `harness-opencode` / `gsag` / `gsa` keep working forever. `glrs` is additive, not a replacement.
- **One install, one thing to remember.** For new users in the @glrs-dev ecosystem, `npm i -g @glrs-dev/cli` gets them everything.

## Docs

[glrs.dev](https://glrs.dev) — full ecosystem docs.

## License

MIT.
