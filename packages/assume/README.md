# @glrs-dev/assume

SSO credential manager for AWS and GCP. Rust binary.

Docs: **[glrs.dev/assume](https://glrs.dev/assume)**

## Install

```bash
glrs assume init
```

Installs the latest binary (clearing the deprecated `@glorious/assume`), migrates any legacy `gs-assume` config forward, logs you in, approves agent contexts, and has you pick a default context. Re-run any time to repair a broken install. Until init completes, gsa is inert — every command except `init`, `upgrade`, `shell-init`, `status`, and `config` refuses.

Or standalone: `npm i -g @glrs-dev/assume` (then `gsa init`).

## Usage

```bash
gsa init                     # one-time setup (required first — see Install)
aws s3 ls                    # credentials served locally (default context)
gsa use aws dev              # switch this shell to another context (fuzzy match)
gsa status                   # token expiry, daemon health
gsa contexts                 # list available contexts
```

## Agent integration

```bash
gsa agent allow              # approve contexts for agents
gsa agent mcp                # start MCP server
```

## License

MIT
