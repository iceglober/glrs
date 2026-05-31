# @glrs-dev/assume

SSO credential manager for AWS and GCP. Rust binary.

Docs: **[glrs.dev/assume](https://glrs.dev/assume)**

## Install

```bash
glrs assume init
```

Or standalone: `npm i -g @glrs-dev/assume`

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
