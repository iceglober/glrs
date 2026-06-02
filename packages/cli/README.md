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

## Telemetry

`glrs` sends anonymous usage events (which command ran, plus non-PII flags like
success/failure and counts) via [Counted](https://app.counted.dev) to help
prioritize work. No cookies, no fingerprinting, no PII — never repo names,
branch names, paths, or arguments. Tracking never blocks or fails a command.

Opt out with either:

```bash
export DO_NOT_TRACK=1        # the cross-tool Do Not Track standard
export GLRS_NO_ANALYTICS=1   # glrs-specific
```

## License

MIT
