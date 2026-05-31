# @glrs-dev/cli

One binary. Requires [Bun](https://bun.sh) ≥ 1.2.0.

Docs: **[glrs.dev/cli](https://glrs.dev/cli)**

## Install

```bash
npm i -g @glrs-dev/cli
```

## Commands

```bash
glrs harness install         # register OpenCode harness
glrs harness configure       # interactive config
glrs harness doctor          # check health
glrs wt new                  # create worktree
glrs wt list                 # list all worktrees
glrs wt switch               # interactive picker
glrs wt delete               # remove worktrees
glrs wt cleanup              # delete merged/stale
glrs wt                      # bare invocation — interactive picker
glrs loop "do the thing"     # raw prompt autopilot
glrs autopilot --plan ...    # structured orchestrator
glrs upgrade                 # self-update
```

## License

MIT
