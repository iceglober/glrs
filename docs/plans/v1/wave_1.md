# Wave 1 — Notifications + Observability

**Focus:** The user should never have to watch the terminal to know what's happening. Autopilot should reach out to them.

---

## Items

- [x] 1.1 **Webhook notifications on lifecycle events.** Add a `--notify <url>` flag (or config in `opencode.json`) that POSTs a JSON payload to a webhook URL on: iteration complete, phase complete, run complete, error, struggle, stall. Payload includes: event type, iteration number, phase file, cost so far, files changed, commit subject, error message. This is the foundation — Slack, Discord, iMessage Shortcuts, PagerDuty all consume webhooks.

  - mirror: `packages/harness-opencode/src/plugins/notify.ts` (existing OS-notification plugin; new webhook notifier follows the same default-export `Plugin` shape but lives at `src/plugins/webhook-notify.ts` or a `src/lib/webhook-notifier.ts` helper invoked from `loop.ts`)
  - files (NEW):
    - `packages/harness-opencode/src/lib/webhook-notifier.ts` — `notifyWebhook(url, event)` function
    - `packages/harness-opencode/test/webhook-notifier.test.ts` — bun:test suite
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop.ts` — call `notifyWebhook` at iteration boundaries / exit reasons
    - `packages/harness-opencode/src/autopilot/cli.ts` — add `--notify <url>` option via cmd-ts `option(...)`
  - context (`loop.ts` exit-reason returns, lines ~406-438):
    ```ts
    if (result.kind === "abort") {
      log.warn({ iteration, iterDurationMs }, "Iteration aborted (total timeout)");
      return { exitReason: "timeout", iterations: iteration, ... };
    }
    if (result.kind === "stall") { ... return { exitReason: "stall", ... }; }
    if (result.kind === "error") { ... return { exitReason: "error", ... }; }
    ```
    Webhook calls go BEFORE each `return` — fire-and-forget with `.catch(() => {})` so a failing webhook never fails the loop.
  - context (`cli.ts` cmd-ts options block, lines 26-46):
    ```ts
    args: {
      prompt: positional({ type: stringType, displayName: "prompt", ... }),
      maxIterations: option({ long: "max-iterations", type: optional(numberType), ... }),
      timeout: option({ long: "timeout", type: optional(numberType), ... }),
      noDebrief: flag({ long: "no-debrief", ... }),
    },
    ```
    Add: `notify: option({ long: "notify", type: optional(stringType), description: "..." })`.
  - conventions: ESM-only (`import ... from "./foo.js"` with `.js` extension even from `.ts` sources); named exports; test framework is `bun:test` (`import { describe, it, expect } from "bun:test"`); error handling = swallow non-fatal errors with try/catch + `process.stderr.write` warning, never throw from event/notification paths; CLI flags use `cmd-ts` builders (`option`, `flag`, `positional`, `optional`); fetch is the global Node 18+ `fetch` (no `node-fetch` dep).

- [x] 1.2 **Slack integration.** Ship a pre-built Slack webhook formatter. User provides a Slack incoming webhook URL via `glrs oc configure` (new "Notifications" section). Messages are compact: one message per phase completion, one on error, one on run complete. Thread replies for iteration details. Use Slack Block Kit for structured formatting.

  - mirror: `packages/harness-opencode/src/cli/configure.ts` (existing `configureMcps`/`configureModels` flow — add a `configureNotifications` peer following the same `promptChoice` + `writePluginOption` pattern)
  - files (NEW):
    - `packages/harness-opencode/src/lib/slack-formatter.ts` — `formatSlackMessage(event): SlackBlocks`
    - `packages/harness-opencode/test/slack-formatter.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/cli/configure.ts` — add `configureNotifications` section to the top-level menu loop (sections array around line 196-200)
    - `packages/harness-opencode/src/lib/webhook-notifier.ts` — detect Slack webhook URL (`hooks.slack.com/...`) and route through `formatSlackMessage`
  - context (`configure.ts` top-level menu, lines 184-210):
    ```ts
    const sections = [
      `Models — deep: ${deepModel.split("/").pop()}, autopilot --fast: ${autopilotExecModel.split("/").pop()}`,
      `MCPs — ${mcpEnabled.length > 0 ? mcpEnabled.join(", ") : "none"}`,
      "Done",
    ];
    const choice = await promptChoice("What to configure?", sections, sections.length - 1);
    ```
    Insert a `Notifications — ${slackConfigured ? "Slack" : "none"}` entry before "Done" and route `choice === <new index>` to `configureNotifications(configPath, currentNotifyConfig)`.
  - context (Slack Block Kit payload shape — POST body for `hooks.slack.com` webhooks):
    ```ts
    {
      blocks: [
        { type: "header", text: { type: "plain_text", text: "..." } },
        { type: "section", fields: [{ type: "mrkdwn", text: "*Iterations:* 5" }, ...] },
        { type: "context", elements: [{ type: "mrkdwn", text: "..." }] },
      ],
    }
    ```
  - conventions: same as 1.1; `writePluginOption(configPath, key, value, { dryRun: false })` is the standard write helper imported from `./install.js`; new menu sections follow the `promptChoice(question, choices, defaultIndex)` pattern from `plugin-check.ts`; ANSI color helpers are the local `c` object in `configure.ts`.

- [x] 1.3 **iMessage via Shortcuts.** Document how to wire the webhook to an Apple Shortcut that sends an iMessage. Ship an example `.shortcut` file in `docs/`. The webhook payload is already JSON — the Shortcut just extracts the message field and sends it.

  - mirror: `docs/plans/v1/main.md` (existing docs — markdown with H1 title, ## sections, fenced code blocks); the example artifact is binary, no in-repo mirror — distribute as-is.
  - files (NEW):
    - `docs/autopilot/imessage-shortcut.md` — step-by-step doc with screenshots/instructions
    - `docs/autopilot/imessage-webhook.shortcut` — example Apple Shortcut binary
  - context: no MODIFIED files; documentation-only. The webhook payload shape that the Shortcut consumes must match the JSON schema defined in 1.1 (event type, iteration number, message field, etc.) — reference 1.1's payload structure verbatim in the doc.
  - conventions: docs use plain markdown (no Starlight frontmatter required for files under `docs/` — those go to `docs-site/` if rendered); shipped binary files are checked into the repo (no LFS); reference paths from docs to source use repo-relative paths (`packages/harness-opencode/...`).

- [x] 1.4 **Status file for cross-terminal visibility.** Write a `.agent/autopilot-status.json` file updated every 30 seconds with: current phase, current iteration, last tool call, cost so far, elapsed time, exit reason (if done). A separate `glrs oc autopilot --status` command reads and pretty-prints it. Works across terminals, SSH sessions, tmux panes.

  - mirror: `packages/harness-opencode/src/autopilot/status.ts` (existing in-process `StatusHeartbeat` — extend its `tick()` to also write to disk; the cost-tracker plugin's atomic-rename pattern at `src/plugins/cost-tracker.ts` lines 280-305 is the reference for safe concurrent writes)
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/status.ts` — add `statusFilePath?: string` to `StatusHeartbeatOptions`; in `tick()`, after `opts.logger.info(...)`, also write the state snapshot to disk via tmp-file-then-rename
    - `packages/harness-opencode/src/autopilot/loop.ts` — pass `statusFilePath: path.join(cwd, ".agent/autopilot-status.json")` when creating the heartbeat (around line 252)
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — add `status: flag({ long: "status", ... })` and short-circuit at the top of the handler when set: read the status file, pretty-print, exit 0
  - context (`status.ts` `tick` function, lines 138-158):
    ```ts
    const tick = () => {
      if (opts.pollCost) {
        opts.pollCost().then((cost) => {
          if (cost > 0) state.cumulativeCostUsd = cost;
        }).catch(() => {});
      }
      const message = composeStatusMessage(state, now());
      opts.logger.info(
        { elapsedMs: now() - state.startedAt, iterationsCompleted: state.iterationsCompleted, ... },
        message,
      );
    };
    ```
    Add a `writeStatusFile()` call after the `logger.info` — atomic rename via `${path}.tmp.${pid}.${rand}` → `path` (see cost-tracker `writeRollup` for the exact pattern).
  - context (`autopilot-cmd.ts` handler entrypoint, lines 33-56):
    ```ts
    handler: async ({ plan, fast }) => {
      let planPath = plan;
      if (!planPath) { ... }
      if (fast && planPath) { ... }
      const result = await runInteractiveAutopilot(process.cwd(), planPath, undefined, { fast });
      ...
    }
    ```
    Branch on `args.status` BEFORE any of this work — read `.agent/autopilot-status.json` from cwd, JSON.parse, format with the same `formatElapsed`/`formatCost` helpers from `status.ts`, write to stdout, exit.
  - conventions: ESM with `.js` import suffix; atomic file writes use `${target}.tmp.${process.pid}.${Math.random().toString(36).slice(2,10)}` then `fs.rename`; status file is JSON pretty-printed (`JSON.stringify(state, null, 2) + "\n"`); fs operations use `fs/promises` (async) for production code, sync `fs.readFileSync` only for synchronous CLI startup paths; the `.agent/` directory is the standard kill-switch + status home (matches `KILL_SWITCH_PATH` in `config.ts`).

- [x] 1.5 **Rich tool call logging.** Enhance `onToolCall` to include the first argument (file path for read/edit/write, command for bash, pattern for grep). Output: `tool: edit apps/web-app/src/app/rcm/aging/page.tsx` instead of `tool: edit`. Requires changes to `opencode-server.ts`'s event parsing — the `message.part.updated` event includes tool args.

  - mirror: `packages/harness-opencode/src/lib/opencode-server.ts` (the `waitForIdle` function's existing tool-detection block — extend it; no new file needed)
  - files (MODIFIED):
    - `packages/harness-opencode/src/lib/opencode-server.ts` — change `onToolCall` callback signature from `(toolName: string) => void` to `(toolName: string, firstArg?: string) => void`; in the event-stream loop, extract the first arg from `part.state.input`
    - `packages/harness-opencode/src/autopilot/loop.ts` — update the `onToolCall` callsite (line 334) to format `tool: ${name} ${firstArg ?? ""}`
    - `packages/harness-opencode/test/opencode-server-integration.test.ts` — add assertions for the new firstArg parameter
  - context (`opencode-server.ts` tool-detection block, lines 357-388):
    ```ts
    if (opts.onToolCall && type === "message.part.updated") {
      const part = props["part"] as
        | { type?: string; sessionID?: string; tool?: string; callID?: string; state?: { status?: string } }
        | undefined;
      if (part && part.type === "tool" && part.sessionID === opts.sessionId &&
          part.state?.status === "completed" && part.callID && !reportedToolCalls.has(part.callID)) {
        reportedToolCalls.add(part.callID);
        resetStall();
        try { opts.onToolCall(part.tool ?? "unknown"); } catch { /* ... */ }
        continue;
      }
    }
    ```
    Extend the `state` shape with `input?: Record<string, unknown>` and pull `firstArg` from input keys in priority order: `filePath`, `file_path`, `path`, `command`, `pattern`, `query`. First defined string wins.
  - context (`loop.ts` onToolCall callsite, lines 334-346):
    ```ts
    onToolCall: (toolName) => {
      log.info(`tool: ${toolName}`);
      thinkingToolCalls++;
      thinkingChars = 0;
      thinkingStartTime = 0;
      lastToolOrStreamLogAt = Date.now();
      streamDeltaCount = 0;
      streamCharCount = 0;
      lastStreamLogAt = Date.now();
    },
    ```
    Update signature to `(toolName, firstArg) =>` and the log line to ``log.info(`tool: ${toolName}${firstArg ? " " + firstArg : ""}`);``.
  - conventions: SDK type-narrowing uses `as unknown as { ... }` (per `AGENTS.md` rule 2 escape-hatch policy); never break existing `onToolCall` callsites — make `firstArg` optional; truncate displayed arg paths to ~80 chars to keep log lines readable; `bun:test`.

- [x] 1.6 **Mid-run cost estimation.** Since Bedrock doesn't report cost mid-stream, estimate it from token counts. Track input/output tokens from `message.updated` events (the `tokens` field). Apply per-model pricing from a hardcoded table (Opus: $15/$75 per M, Sonnet: $3/$15, Haiku: $0.25/$1.25, GLM-5: TBD, Kimi: TBD). Show estimated cost in iteration summaries and status heartbeats. Mark as "~$X.XX est" to distinguish from API-reported cost.

  - mirror: `packages/harness-opencode/src/plugins/cost-tracker.ts` (existing token tracking — same `Tokens` shape, same `readTokens` parser); pricing table is a new module
  - files (NEW):
    - `packages/harness-opencode/src/lib/model-pricing.ts` — `MODEL_PRICING: Record<string, { input: number; output: number }>` and `estimateCost(modelId, tokens): number`
    - `packages/harness-opencode/test/model-pricing.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/lib/opencode-server.ts` — `onCostUpdate` callback already receives tokens; no signature change needed
    - `packages/harness-opencode/src/autopilot/status.ts` — `formatCost` learns to render `~$0.025 est` when an `estimated: true` flag is set on state
    - `packages/harness-opencode/src/autopilot/loop.ts` — when `cost === 0` but tokens > 0, compute estimate via `estimateCost(modelName, tokens)` and pass to heartbeat
  - context (`opencode-server.ts` onCostUpdate handler, lines 318-336):
    ```ts
    if (opts.onCostUpdate && type === "message.updated") {
      const info = props["info"] as
        | { role?: string; cost?: number; tokens?: { input?: number; output?: number } }
        | undefined;
      if (info && info.role === "assistant" && typeof info.cost === "number") {
        resetStall();
        try {
          opts.onCostUpdate(info.cost, { input: info.tokens?.input ?? 0, output: info.tokens?.output ?? 0 });
        } catch { /* ... */ }
      }
    }
    ```
    Behavior is unchanged here — the estimation lives in `loop.ts`'s `onCostUpdate` callback (lines 347-363).
  - context (`status.ts` `formatCost`, lines 89-92):
    ```ts
    export function formatCost(usd: number): string {
      if (usd === 0) return "pending";
      return `$${usd.toFixed(3)}`;
    }
    ```
    Extend to accept an optional `estimated: boolean` arg and prepend `~` and append ` est` when true.
  - conventions: pricing table values are USD per million tokens, stored as numbers (e.g., `{ input: 15, output: 75 }` for Opus); estimate formula is `(inputTokens * input + outputTokens * output) / 1_000_000`; unknown model IDs return 0 (caller decides whether to show "pending" or "$0.00 est"); `bun:test`; named exports.

- [x] 1.7 **Debrief improvements.** The debrief currently starts a new server. Instead, keep the loop's server alive and pass it to the debrief. Include per-phase cost breakdown in the debrief output. Add a `--debrief-only` flag that runs the debrief against the last completed run's log file without re-executing.

  - mirror: `packages/harness-opencode/src/autopilot/debrief.ts` (existing `runDebrief` already accepts an injected `server: StartedServer` — the wiring change lives in `loop.ts` and `cli.ts`)
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop.ts` — return the `server` from `runRalphLoop` (currently shut down in the `finally` block, line 587) so the caller can reuse it for the debrief
    - `packages/harness-opencode/src/autopilot/cli.ts` — pass the loop's server into `runDebrief` instead of starting a new one (lines 67-84)
    - `packages/harness-opencode/src/autopilot/debrief.ts` — add per-phase cost breakdown to `buildContextMessage` (read from `loopResult` if multi-phase data is present)
    - `packages/harness-opencode/src/autopilot/cli.ts` — add `debriefOnly: flag({ long: "debrief-only", ... })`; when true, skip `runRalphLoop` entirely and run `runDebrief` against the most recent log file
  - context (`cli.ts` debrief invocation, lines 67-84):
    ```ts
    if (shouldRunDebrief({ noDebrief, env: process.env as Record<string, string | undefined> })) {
      const { startServer } = await import("../lib/opencode-server.js");
      let debriefServer;
      try {
        debriefServer = await startServer({ cwd });
        await runDebrief({ server: debriefServer, loopResult: result, prompt, cwd });
      } catch {
        process.stderr.write("\x1b[33m⚠ Debrief server failed to start (non-fatal)\x1b[0m\n");
      } finally {
        await debriefServer?.shutdown().catch(() => {});
      }
    }
    ```
    Replace `await startServer({ cwd })` with reuse of the loop's server (now exposed via the `LoopResult`'s new `server` field, or by refactoring `runRalphLoop` to defer shutdown until after the debrief).
  - context (`loop.ts` server lifecycle, lines 226-588):
    ```ts
    const server = await _startServer({ cwd: opts.cwd });
    ...
    } finally {
      delete process.env["GLRS_AUTOPILOT_HEADLESS"];
      clearTimeout(timeoutHandle);
      heartbeat?.stop();
      log.info({}, "Shutting down server");
      await server.shutdown();
      await autopilotLog.flush();
    }
    ```
    Remove the unconditional `server.shutdown()` from the `finally`; expose `server` on the LoopResult and let the caller own shutdown. Or accept an optional `keepAlive: boolean` in `RalphLoopOptions`.
  - context (`debrief.ts` `runDebrief`, lines 139-176): the function already takes `opts.server: StartedServer` — no signature change needed; just stop building a fresh one in `cli.ts`.
  - conventions: `LoopResult` is a public exported type — adding fields is non-breaking only if optional (`server?: StartedServer`); the `--debrief-only` flag bypasses the loop entirely, so it must locate the most recent log file under the per-run log directory established by `createAutopilotLogger` in `lib/logger.ts`; `bun:test` for tests; ESM imports with `.js` extension.

---

## Open Questions

1. **Binary `.shortcut` file fidelity (item 1.3):** Apple Shortcuts binaries are plist-based archives that must be created in the Shortcuts app. They cannot be fabricated programmatically. The `docs/autopilot/imessage-webhook.shortcut` file is a text placeholder. Users must build their own shortcut following the instructions in `docs/autopilot/imessage-shortcut.md` and replace the placeholder with a real export.

2. **`--debrief-only` log discovery (item 1.7):** The `--debrief-only` flag is implemented as a stub that exits with a clear error message. The log directory convention is `<cwd>/.agent/autopilot-logs/<timestamp>.log` (from `lib/logger.ts`). To implement fully: read the most recent `.log` file from that directory, parse it for session context, and pass it to `runDebrief`. This requires either (a) a structured summary file written at loop exit, or (b) parsing the NDJSON log file for the session ID and cost. Deferred to a follow-up.

3. **Per-phase cost breakdown (item 1.7):** The `phaseBreakdown` field is added to `LoopResult` but is not yet populated by `loop-session.ts` (which is outside the Wave 1 file list). The debrief will display the breakdown when present; it degrades gracefully when absent. Populating it requires a Wave 2 change to `loop-session.ts`.

4. **`configure.ts` — `writeNotifyUrl` vs `writePluginOption`:** The `writePluginOption` helper in `install.ts` only accepts `"models" | "mcp"` as the subKey. Rather than modifying `install.ts` (not in the file list), `configure.ts` implements its own `writeNotifyUrl` helper that follows the same atomic-write pattern. This is a minor duplication; a future refactor could extend `writePluginOption` to accept arbitrary string keys.
