# glrs

glorious tools for tomorrow

**[glrs.dev](https://glrs.dev)**

## Install

```bash
curl -fsSL https://glrs.dev/install.sh | bash
```

Or: `npm i -g @glrs-dev/cli && glrs harness install`

## Packages

| Package | What it is |
|---|---|
| [`@glrs-dev/cli`](./packages/cli) | `glrs` binary — harness, worktrees, autopilot |
| [`@glrs-dev/harness-plugin-opencode`](./packages/harness-opencode) | OpenCode agent harness — agents, commands, tools, skills |
| [`@glrs-dev/assume`](./packages/assume) | SSO credential manager for AWS/GCP (Rust, standalone) |

## Usage

```bash
glrs harness install         # register harness plugin
glrs wt new                  # create a worktree
glrs loop "ship ENG-1234"    # hands-off autopilot
glrs upgrade                 # self-update
```

## Development

```bash
bun install && bun run build && bun test
```

## License

MIT
