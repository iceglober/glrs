# W5: open-ralph-wiggum vs OCLoop — Comparison & Adoption Analysis

**Status:** COMPLETE  
**Last updated:** 2026-05-11  
**Sources:**
- https://github.com/Th0rgal/open-ralph-wiggum (README, `ralph.ts`, `package.json`, LICENSE)
- https://github.com/d3vr/ocloop (README, `package.json`)
- https://ghuntley.com/ralph/ (original technique description by Geoffrey Huntley)

---

## Part 1 — open-ralph-wiggum Description

### A. What does it do?

Open Ralph Wiggum is a CLI tool that wraps any supported AI coding agent (OpenCode, Claude Code, Codex, Copilot CLI, Cursor Agent) in a **persistent retry loop**, sending the same prompt repeatedly until the agent signals completion via a `<promise>DONE</promise>` tag in its output. Each iteration, the agent sees the same prompt but the codebase has changed from previous iterations (via git history and modified files), creating a self-correcting feedback loop. The name references Ralph Wiggum from The Simpsons — the joke is that Ralph is "deterministically bad in a nondeterministic world" (per Geoffrey Huntley's blog post), meaning the technique works by being reliably dumb: just keep running the same prompt until the task converges to completion, like Ralph eventually stumbling into the right answer.

**Source:** [README "What is Open Ralph Wiggum?" section](https://github.com/Th0rgal/open-ralph-wiggum#what-is-open-ralph-wiggum); [ghuntley.com/ralph/](https://ghuntley.com/ralph/)

### B. Mechanism

- **Type:** CLI wrapper (not a plugin, not a daemon, not a TUI)
- **Language/Runtime:** TypeScript, runs on Bun
- **Package:** `@th0rgal/ralph-wiggum` on npm, installs globally as `ralph` binary
- **How it works:**
  1. Parses CLI args (prompt, agent type, model, iteration limits, etc.)
  2. Builds a prompt with iteration metadata, context injection, and task-mode instructions
  3. Spawns the selected agent CLI as a child process (`Bun.$` shell execution)
  4. Streams stdout, parses for tool usage and completion promise tags
  5. If `<promise>COMPLETE</promise>` (or custom promise text) is found in output AND min-iterations met → stop
  6. Otherwise, loop: same prompt, new process spawn
  7. Optional: auto-commit between iterations, task-mode progression, agent rotation

- **State storage:** `.ralph/` directory in CWD containing:
  - `ralph-loop.state.json` — active loop metadata
  - `ralph-history.json` — iteration history/metrics
  - `ralph-context.md` — user-injected mid-loop hints
  - `ralph-tasks.md` — task list for Tasks Mode
  - `ralph-questions.json` — pending user answers

- **Zero dependencies** beyond Bun runtime and `@types/bun` (devDep only)

**Source:** [`ralph.ts` lines 1-50](https://github.com/Th0rgal/open-ralph-wiggum/blob/master/ralph.ts); [`package.json`](https://github.com/Th0rgal/open-ralph-wiggum/blob/master/package.json)

### C. Integration Surface with OpenCode

Ralph integrates with OpenCode via **process spawn** — it runs `opencode run -m <model> <prompt>` as a subprocess. Specifically:

```typescript
// From ralph.ts ARGS_TEMPLATES["opencode"]
const cmdArgs = ["run"];
if (model) cmdArgs.push("-m", model);
cmdArgs.push(prompt);
```

It also manipulates OpenCode's config to:
1. **Filter plugins** (keeps only auth-related plugins when `--no-plugins` is used)
2. **Set permissions to allow-all** for non-interactive use (writes a temporary `ralph-opencode.config.json` in `.ralph/` and sets `OPENCODE_CONFIG` env var)

There is **no plugin API integration**, no SDK usage, no TUI automation. It's purely CLI-to-CLI.

**Source:** [`ralph.ts` `ARGS_TEMPLATES["opencode"]`](https://github.com/Th0rgal/open-ralph-wiggum/blob/master/ralph.ts); [`ensureRalphConfig()` function](https://github.com/Th0rgal/open-ralph-wiggum/blob/master/ralph.ts)

### D. Invariants & Safety

| Concern | Behavior |
|---------|----------|
| **Filesystem writes** | Writes `.ralph/` directory in CWD (state, history, context, tasks, questions, temp config). Also writes `ralph-opencode.config.json` inside `.ralph/`. |
| **Config modification** | Creates a temporary OpenCode config file and passes it via `OPENCODE_CONFIG` env var. Does NOT modify user's `~/.config/opencode/opencode.json`. |
| **Safety gates** | `--max-iterations` (hard stop), `--min-iterations` (prevents premature exit), `--abort-promise` (early exit on precondition failure), `--last-activity-timeout` (kills stuck iterations) |
| **Failure modes** | Agent CLI not found → exits with error. Agent crashes → iteration ends, loop continues. Promise not detected → loop continues until max-iterations. Ctrl+C → graceful shutdown. |
| **Git interaction** | Auto-commits after each iteration by default (`--no-commit` to disable). Does NOT push. |

**Invariant conflicts with `@glrs-dev/harness-plugin-opencode`:**
- Ralph writes `.ralph/ralph-opencode.config.json` and sets `OPENCODE_CONFIG` env var, which could conflict with the plugin's config expectations
- Ralph's `--no-plugins` flag filters out non-auth plugins, which would disable our harness plugin during Ralph-driven loops
- Ralph's permission auto-allow writes a config that overrides the plugin's permission model

**Source:** [`ralph.ts` state file paths](https://github.com/Th0rgal/open-ralph-wiggum/blob/master/ralph.ts); [`ensureRalphConfig()` function](https://github.com/Th0rgal/open-ralph-wiggum/blob/master/ralph.ts)

---

## Part 2 — Comparison with OCLoop

| Dimension | ocloop | open-ralph-wiggum |
|---|---|---|
| **What it loops** | Tasks from a `PLAN.md` file — one task per iteration, each in a fresh OpenCode session. The agent works through a structured task list. | The same prompt, repeatedly. Agent sees its prior work via filesystem/git state. Optionally, a task list in `.ralph/ralph-tasks.md` (Tasks Mode). |
| **Trigger (how you invoke a round)** | Automatic: OCLoop creates a new OpenCode session via the SDK, sends the loop prompt, waits for idle. Press `S` to start, `Space` to pause/resume. | Automatic: Ralph spawns a new agent CLI process each iteration. Starts immediately on invocation. |
| **Termination condition** | Agent appends `<plan-complete>summary</plan-complete>` to the plan file, OR all tasks marked `[x]`, OR user quits, OR unrecoverable error. | Agent outputs `<promise>COMPLETE</promise>` in stdout (configurable text), AND min-iterations met, OR max-iterations reached, OR abort-promise detected. |
| **Integration surface** | **SDK-based** — uses `@opencode-ai/sdk` to programmatically create sessions, send messages, and monitor state. Also uses `@opentui/solid` for TUI dashboard. OpenCode-specific. | **CLI process spawn** — runs `opencode run`, `claude`, `codex`, `copilot`, or `cursor-agent` as child processes. Agent-agnostic. |
| **Language / runtime** | TypeScript + Bun + Solid.js (TUI). Published as `ocloop` on npm. | TypeScript + Bun. Published as `@th0rgal/ralph-wiggum` on npm. |
| **Filesystem writes outside its own scope** | Reads/writes `PLAN.md` (task status updates by the agent). Reads `.loop-prompt.md`. Writes `.loop.log` (debug). Saves terminal prefs to `~/.config/ocloop/ocloop.json`. | Writes `.ralph/` directory (state, history, context, tasks, questions, temp OpenCode config). Auto-commits to git by default. |
| **Maturity (age, last commit, stars)** | ~220 commits, 9 stars, 2 forks, 1 contributor. No releases published. Version 0.2.0. Newer/less mature. | ~90 commits, 1.7k stars, 127 forks. Latest release v1.3.0 (Apr 29, 2026). 6 releases total. More community traction. |
| **License** | MIT | MIT |

**Source:** [ocloop README](https://github.com/d3vr/ocloop); [ocloop package.json](https://github.com/d3vr/ocloop/blob/main/package.json); [ralph-wiggum README](https://github.com/Th0rgal/open-ralph-wiggum); [ralph-wiggum package.json](https://github.com/Th0rgal/open-ralph-wiggum/blob/master/package.json)

---

## Part 2E — Fit for `/autopilot`-Driven Sequence Loop

### What `/autopilot` already handles

Per the task brief, `/autopilot` manages:
1. A sequence of Linear/GH issues
2. `/fresh --yes` between each issue (clean worktree/session)
3. PRIME runs plan → build → verify → STOP per issue
4. Issue-level orchestration (next issue, mark done, etc.)

### Could either REPLACE `/autopilot`?

**Neither can replace `/autopilot`.** Here's why:

| `/autopilot` capability | ocloop | ralph-wiggum |
|---|---|---|
| Multi-issue sequencing (Linear/GH) | No — loops tasks within ONE project, no issue-tracker integration | No — loops ONE prompt or a local task list, no issue-tracker integration |
| `/fresh --yes` between issues (clean state) | Partial — creates fresh sessions per task, but within same worktree | No — reuses same worktree, relies on git state accumulation |
| PRIME agent orchestration (plan→build→verify→STOP) | No — sends a generic loop prompt, no multi-phase agent pipeline | No — sends same prompt repeatedly, no phase awareness |
| Issue lifecycle management | No | No |

**Verdict:** Both tools solve a DIFFERENT problem than `/autopilot`. They handle "iterate on the same task until convergence" (intra-issue looping), while `/autopilot` handles "sequence across multiple issues" (inter-issue orchestration).

### Would we adopt them for a DIFFERENT kind of loop?

**Yes — the "keep iterating until tests pass" loop.** This is the specific gap:

- `/autopilot` runs PRIME once per issue: plan → build → verify → STOP
- If verify fails, `/autopilot` currently does NOT retry the build phase
- Ralph/OCLoop would handle: "keep running the agent on this issue until the verification command passes"

This is the **intra-issue retry loop** — the thing that makes the Ralph Wiggum technique powerful. The agent keeps seeing its failures and self-corrects.

### Is there a scenario where we'd want BOTH?

**Yes, conceptually:** `/autopilot` sequences issues, and within each issue, a Ralph-style retry loop handles convergence. The architecture would be:

```
/autopilot (inter-issue)
  └── for each issue:
       ├── /fresh --yes
       ├── PRIME: plan
       ├── PRIME: build (with intra-issue retry loop until verify passes)
       └── mark done, next issue
```

However, implementing this doesn't require adopting either external tool. The retry-until-verify logic is ~50 lines of code: run agent, check exit/output, retry if not converged.

### Specific capability that `/autopilot` lacks (if any)

1. **Retry-until-convergence within a single issue** — Ralph's core value prop. `/autopilot` runs PRIME once and stops. If tests fail, the user must intervene.
2. **Mid-loop context injection** — Ralph's `--add-context` lets a human nudge a stuck agent without stopping the loop. `/autopilot` has no equivalent.
3. **Struggle detection** — Ralph tracks iteration history and flags when the agent is stuck (no file changes, repeated errors, short iterations). `/autopilot` doesn't monitor for stuck states.
4. **Agent rotation** — Ralph can cycle through different agent/model combos per iteration. Not relevant to `/autopilot`'s current design but interesting for resilience.

### Which is the better fit?

**For our plugin's needs, neither is worth adopting as a dependency.** Reasons:

| Factor | ocloop | ralph-wiggum |
|---|---|---|
| Integration approach | SDK-based (tight coupling to OpenCode internals) — interesting but fragile across OpenCode versions | CLI spawn (loose coupling) — works but adds process overhead and loses plugin context |
| OpenCode-specific? | Yes, exclusively | No, agent-agnostic (supports 5 agents) |
| Would it run WITH our plugin? | Unclear — it starts its own OpenCode server | Explicitly disables non-auth plugins by default (`--no-plugins`) |
| Dependency weight | Heavy (Solid.js TUI, OpenCode SDK) | Light (zero runtime deps beyond Bun) |
| What we'd actually use | The "fresh session per task" pattern | The "retry until promise detected" pattern |

**Recommendation:** Extract the retry-until-convergence PATTERN (not the tool) from Ralph Wiggum and implement it natively in `/autopilot` as an optional `--retry-on-failure` mode. This gives us:
- No external dependency
- Full plugin context preserved (skills, agents, MCPs all active)
- Integration with our existing PRIME pipeline
- No conflict with plugin invariants (no temp config files, no plugin filtering)

The specific patterns worth stealing:
1. Promise-tag-based completion detection (`<promise>COMPLETE</promise>`)
2. Min/max iteration bounds
3. Struggle detection heuristics (no-progress counter, repeated errors)
4. Mid-loop context injection (already partially exists as PRIME's ability to read updated plans)

---

## Invariant Conflicts Summary

### open-ralph-wiggum conflicts with `@glrs-dev/harness-plugin-opencode`:

| Invariant | Conflict |
|---|---|
| Zero user-filesystem-writes outside installer | Ralph writes `.ralph/ralph-opencode.config.json` and sets `OPENCODE_CONFIG` env var, overriding config resolution |
| Skills precedence (plugin-wins) | Ralph's `--no-plugins` flag disables the harness plugin entirely, removing all skills |
| Plugin active during agent runs | Ralph spawns OpenCode as a subprocess — plugin IS loaded unless `--no-plugins` is used, but the temp config may interfere with plugin behavior |
| Permission model | Ralph's `ensureRalphConfig()` sets all permissions to "allow", bypassing any plugin-managed permission gates |

### ocloop conflicts with `@glrs-dev/harness-plugin-opencode`:

| Invariant | Conflict |
|---|---|
| Single OpenCode instance | OCLoop starts its own OpenCode server via SDK — unclear if this conflicts with an already-running instance |
| Plugin loading | OCLoop uses the SDK to create sessions programmatically — plugins should still load, but this is untested territory |
| Session management | OCLoop creates fresh sessions per task — this may or may not trigger plugin initialization correctly |

---

## Key Takeaways

1. **Ralph Wiggum is the more popular/mature tool** (1.7k stars, 6 releases, multi-agent support) but is fundamentally a CLI wrapper that spawns processes — it cannot leverage plugin internals.

2. **OCLoop is more architecturally interesting** (SDK-based, TUI dashboard, fresh sessions per task) but is immature (0.2.0, 9 stars, no releases) and tightly coupled to OpenCode's SDK which may change.

3. **Neither replaces `/autopilot`** — they solve intra-issue convergence, not inter-issue sequencing.

4. **The valuable pattern is retry-until-convergence with promise detection**, which is ~50-100 lines to implement natively without the invariant conflicts that either external tool introduces.

5. **If forced to choose one for inspiration**, Ralph Wiggum is the better reference because its patterns are well-documented (Geoffrey Huntley's blog post is essentially a design doc) and its CLI-agnostic approach means the patterns transfer cleanly even if the tool itself doesn't.
