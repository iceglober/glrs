# @glrs-dev/assume

SSO credential manager for AWS and GCP. Rust binary.

Docs: **[glrs.dev/assume](https://glrs.dev/assume)**

## Install

```bash
glrs assume init
```

Installs the latest binary (clearing the deprecated `@glorious/assume`), migrates any legacy `gs-assume` config forward, logs you in, approves agent contexts, has you pick a default context, and offers to wire shell integration into your rc file. Re-run any time to repair a broken install. Until init completes, gsa is inert — every command except `init`, `upgrade`, `shell-init`, `status`, and `config` refuses.

Or standalone: `bun add -g @glrs-dev/assume` (then `gsa init`). The package targets Bun (`engines.bun`); `glrs assume` also accepts npm/pnpm/yarn.

## Usage

```bash
gsa init                     # one-time setup (required first — see Install)
aws s3 ls                    # credentials served locally (default context)
gsa use aws dev              # switch this shell to another context (fuzzy match)
gsa status                   # token expiry, daemon health
gsa contexts                 # list available contexts
```

## Shell integration

`gsa use` and `gsa login` set credentials for the current shell, so they need a
wrapper in your rc file (it evals the context into the live shell and adds a
prompt tag). `gsa init` offers to install it; to (re)install non-interactively:

```bash
gsa shell-init --install        # detects your shell from $SHELL
gsa shell-init --install zsh     # or name it explicitly (bash, zsh, fish)
```

This appends a guarded `# >>> glrs-assume >>>` block to `~/.zshrc`,
`~/.bashrc`, or `~/.config/fish/config.fish`. It's idempotent — re-running
leaves an already-installed rc untouched. Restart your shell (or `source` the
rc) to pick it up. `gsa status` flags when integration is missing.

## Agent integration

```bash
gsa agent allow              # approve contexts for agents
gsa agent mcp                # start MCP server
```

## License

MIT
