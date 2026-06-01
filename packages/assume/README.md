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
gsa login aws                # authenticate (opens browser)
gsa use aws dev              # switch context (fuzzy match)
aws s3 ls                    # credentials served locally
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
