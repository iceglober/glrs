# src/plugins — sub-plugins

OpenCode's plugin model allows multiple plugin objects. We ship one user-facing plugin (`src/index.ts`) and compose several sub-plugins here, each hooking into a specific lifecycle event.

## Current inventory

| File | Hook(s) | Purpose |
|---|---|---|
| `notify.ts` | `event` (question, idle) | Fires OS notifications so the user sees prompts when their terminal is off-screen. |
| `cost-tracker.ts` | `event` (`message.updated`) | Tallies cost/token usage per provider/model + writes `costs.jsonl` / summary files for `/costs` consumption. Emits a `model_turn` Counted event per finalized message (cost, token speed, outcome). |
| `dispatch-tracker.ts` | `tool.execute.after` (`task`) | Logs subagent dispatches to `dispatches.jsonl` + rollup for `/dispatches`. |
| `parallel-dispatch.ts` | `tool.execute.after` | Runs queued parallel subagent dispatches. |
| `stall-detector.ts` | `event`, `tool.execute.before/after` | Detects stalled sessions and nudges. |
| `dotenv.ts` | _none_ (module-init) | Parses `.env` / `.env.local` into `process.env` at plugin load so OpenCode's `{env:VAR}` MCP-config interpolation resolves. Shell env always wins. |
| `tool-hooks.ts` | `tool.execute.after` | Post-edit verification loop: after a TS/JS edit, runs `tsc --noEmit` and surfaces NEW errors only. Also caps output for `eslint_check`/`tsc_check`/`comment_check`/`todo_scan`. Emits `tool_used` (per call, with best-effort success + skill name) and `post_edit_verify` Counted events. |

Counted telemetry transport lives in `lib/analytics.ts` (the on-by-default, fail-silent SDK wrapper; opt out with `DO_NOT_TRACK` / `GLRS_NO_ANALYTICS`); event-property shaping lives in the pure, unit-tested `lib/telemetry-events.ts`. Plugins call `track(name, props)` — never PII, only ids/enums/booleans/counts.

> **Note:** The autopilot idle-nudge loop (`autopilot.ts`) was removed. Autopilot is now a CLI driver at `src/autopilot/` — see `src/autopilot/loop.ts` for the Ralph loop engine and `src/autopilot/cli.ts` for the `glrs autopilot` subcommand.

## Convention

Each sub-plugin is a default-exported `Plugin` function (from `@opencode-ai/plugin`) that returns an object of hooks:

```ts
import type { Plugin } from "@opencode-ai/plugin";

const plugin: Plugin = async (ctx) => {
  return {
    event: async ({ event }) => { /* ... */ },
    "tool.execute.before": async ({ tool, agent, args }) => { /* ... */ },
  };
};

export default plugin;
```

The root `src/index.ts` composes these sub-plugins into a single plugin object, which OpenCode receives as the default export.

## Adding a sub-plugin

1. Write `src/plugins/<name>.ts` with a default-exported `Plugin`.
2. Add it to the export array in `src/index.ts`.
3. Add a test in `test/<name>-plugin.test.ts` (pattern: import default, invoke with a fake ctx, assert hook behavior).
4. Verify `test/plugin-entry-single-default-export.test.ts` still passes — the root plugin entry must have exactly one default export.
5. Verify `test/plugin-hooks-no-undefined.test.ts` still passes — no hook key may resolve to `undefined` at runtime.

## Gotchas

- **Throwing from `tool.execute.before` is the documented "deny this tool execution" signal.** Swallow unrelated errors; rethrow the denial.
- **Telemetry must never block, throw, or delay a session.** `track()` is fire-and-forget and swallows everything; never `await` it on a hot path. Emit only non-PII primitives, and read any success/error signal from a tool's *original* output before backpressure/dedup mutate it.
- **Per-session state lives in closure or in SQLite, not in module-scope variables.** Plugins get re-instantiated per session; module-scope state leaks across.
