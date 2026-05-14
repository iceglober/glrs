# W3: opencode-background-agents (kdcokenny)

**Source:** https://github.com/kdcokenny/opencode-background-agents
**Canonical source:** https://github.com/kdcokenny/ocx/blob/main/workers/kdco-registry/files/plugins/background-agents.ts
**License:** MIT
**Stars:** 241 | **Forks:** 16
**First commit:** ~Jan 1, 2026 | **Last commit:** May 3, 2026
**Language:** TypeScript (100%)
**Status:** Active, maintained via OCX monorepo sync

---

## A. What Is It?

An OpenCode plugin that adds async background delegation — the ability to fire off long-running research/analysis tasks to sub-agents that run in isolated OpenCode sessions, persist their results to markdown files on disk, and notify the parent session when complete. The core value proposition is **surviving context compaction**: when OpenCode compresses the conversation history, delegated results aren't lost because they're written to `~/.local/share/opencode/delegations/` as markdown files that can be re-read on demand. It's modeled after Claude Code's background agent pattern but implemented entirely within OpenCode's plugin system.

---

## B. Architecture

### Spawning Mechanism

Background agents are **new OpenCode sessions** (child sessions of the parent). The plugin calls `client.session.create()` with a `parentID` linking it to the calling session, then fires `client.session.prompt()` on the new session with the delegated prompt. This is NOT a new OS process — it's a new session within the same OpenCode server process, using OpenCode's SDK client API.

**Source (line ~530-550 of canonical source):**
```typescript
const sessionResult = await this.client.session.create({
    body: {
        title: `Delegation: ${stableId}`,
        parentID: input.parentSessionID,
    },
})
// ...
this.client.session.prompt({
    path: { id: delegation.sessionID },
    body: {
        agent: input.agent,
        parts: [{ type: "text", text: input.prompt }],
        tools: {
            task: false,
            delegate: false,
            todowrite: false,
            plan_save: false,
        },
    },
})
```

### Communication

- **Parent → Background:** Via `client.session.prompt()` — sends the initial prompt to the child session.
- **Background → Parent:** Via `client.session.prompt()` with `noReply: true` — sends a `<task-notification>` XML block back to the parent session when the delegation reaches a terminal state.
- **Persistence:** Results are extracted from the child session's messages (`client.session.messages()`), then written to disk as markdown files.
- **Retrieval:** Parent calls `delegation_read(id)` which reads the persisted markdown file from disk.

### Lifecycle

1. `delegate(prompt, agent)` → registers delegation, creates child session, fires prompt
2. Status transitions: `registered` → `running` → terminal (`complete` | `error` | `cancelled` | `timeout`)
3. On terminal: extracts last assistant message, generates title/description via `small_model`, persists to disk, notifies parent
4. Timeout: 15 minutes (hardcoded default, `DEFAULT_MAX_RUN_TIME_MS = 15 * 60 * 1000`)
5. Completion detection: listens for `session.idle` / `session.status` events via the plugin's `event` hook

### Anti-recursion

The prompt to child sessions explicitly disables `task`, `delegate`, `todowrite`, and `plan_save` tools — preventing infinite delegation chains.

---

## C. The "Read-Only Limitation" — VERIFIED ✅

### Is it actually read-only? YES — CONFIRMED.

The limitation is real, explicitly documented, and **enforced in code**.

### WHAT is read-only?

The **background agents themselves** (the sub-agents that receive delegated work) must have ALL write permissions denied:
- `edit = "deny"`
- `write = "deny"`  
- `bash = {"*": "deny"}`

This means background agents **cannot edit files, cannot write new files, and cannot execute shell commands**. They can only read files, search, and produce text output.

### WHERE is it enforced?

**Two enforcement points in the source code:**

1. **In `delegate()` method (line ~510-520)** — before creating the child session, the plugin checks the target agent's permissions:

```typescript
// Check if agent is read-only (Early Exit + Fail Fast)
const { isReadOnly } = await parseAgentWriteCapability(this.client, input.agent, this.log)
if (!isReadOnly) {
    throw new Error(
        `Agent "${input.agent}" is write-capable and requires the native \`task\` tool for proper undo/branching support.\n\n` +
        `Use \`task\` instead of \`delegate\` for write-capable agents.\n\n` +
        `Read-only sub-agents (edit/write/bash denied) use \`delegate\`.\n` +
        `Write-capable sub-agents (any write permission) use \`task\`.`,
    )
}
```

2. **In `tool.execute.before` hook (line ~1783-1817)** — the reverse guard: if someone tries to use the native `task` tool with a read-only sub-agent, it throws an error directing them to use `delegate` instead.

**Permission check implementation (line ~240-270):**
```typescript
async function parseAgentWriteCapability(
    client: OpencodeClient,
    agentName: string,
    log: Logger,
): Promise<{ isReadOnly: boolean }> {
    const config = await client.config.get()
    const permission = configData?.agent?.[agentName]?.permission ?? {}
    const editDenied = isPermissionDenied(permission.edit)
    const writeDenied = isPermissionDenied(permission.write)
    const bashDenied = isPermissionDenied(permission.bash)
    return { isReadOnly: editDenied && writeDenied && bashDenied }
}
```

### WHY is it read-only?

The README states the reason explicitly:

> **Why?** Background delegations run in isolated sessions outside OpenCode's session tree. The undo/branching system cannot track changes made in background sessions—reverting would not affect these changes, risking unexpected data loss.

This is an **architectural constraint of OpenCode itself**, not a design choice by the plugin author. OpenCode's undo/branching system (which lets users revert agent actions) only tracks changes within the main session tree. Background sessions created via the plugin API are outside that tree, so any file writes they make would be invisible to the undo system.

### Is there an open issue or PR about making it writable?

**No dedicated issue exists.** The README contains the note:

> A workaround is being explored.

The OCX issues tracker (https://github.com/kdcokenny/ocx/issues) has 4 open issues, none about write-capable background agents. Issue #199 is about UI status display for background agents, not about the read-only constraint.

### How fundamental is the limitation?

**Moderately fundamental.** It's NOT a simple config flag — it's a deliberate safety boundary enforced by runtime permission checks. However:
- The check is a **single function** (`parseAgentWriteCapability`) that reads from OpenCode's config
- The enforcement is a **single `if (!isReadOnly) throw`** in the delegate method
- The underlying session creation and prompting mechanism has **no inherent read-only constraint** — the child session could theoretically run any agent with any permissions
- The constraint exists because OpenCode's undo/branching system can't track changes in background sessions — this is an **OpenCode platform limitation**, not a plugin limitation

---

## D. Integration with OpenCode

### Plugin Type

It's an **OpenCode plugin** using the `@opencode-ai/plugin` API. Specifically:
- Exports a `Plugin` function that receives `{ client, directory }` context
- Registers three tools: `delegate`, `delegation_read`, `delegation_list`
- Hooks into `tool.execute.before` (to intercept `task` calls)
- Hooks into `experimental.chat.system.transform` (to inject delegation rules into system prompts)
- Hooks into `experimental.session.compacting` (to preserve delegation context through compaction)
- Hooks into `event` (to detect session idle for completion)

### Install/Config

Two options:
1. **Via OCX:** `ocx add kdco/background-agents --from https://registry.kdco.dev`
2. **Manual:** Copy `src/plugin/background-agents.ts` to `.opencode/plugin/background-agents.ts`, install `unique-names-generator` dependency

### Dependencies
- `@opencode-ai/plugin` (OpenCode plugin SDK)
- `@opencode-ai/sdk` (OpenCode client SDK)
- `unique-names-generator` (for readable delegation IDs like "elegant-blue-tiger")
- `./kdco-primitives/get-project-id` (gets git root commit hash for cross-worktree consistency)

---

## E. Invariants / Behavior

### What does it write to?

- **Delegation results:** `~/.local/share/opencode/delegations/{projectId}/{rootSessionId}/{delegationId}.md`
- **Debug log:** `~/.local/share/opencode/delegations/{projectId}/background-agents-debug.log`
- **System prompt injection:** Adds delegation routing rules to every system prompt via `experimental.chat.system.transform`

### Process spawning

Does NOT spawn OS processes. Creates new OpenCode sessions via the SDK client API. These are in-process async operations managed by the OpenCode server.

### Failure modes

- **Timeout:** 15-minute hard limit, delegation marked as `timeout`, partial results extracted
- **Session creation failure:** Throws immediately, delegation never registered
- **Agent not found:** Throws with list of available agents
- **Write-capable agent:** Throws with guidance to use `task` instead
- **Metadata generation failure:** Falls back to truncation (title = first 30 chars, description = first 150 chars)
- **Persistence failure:** Logged but doesn't block notification delivery

### Maturity

- **Age:** ~5 months (first commit Jan 2026)
- **Activity:** 41 commits, actively synced from OCX monorepo (last sync May 3, 2026)
- **Community:** 241 stars, 16 forks — significant adoption for an OpenCode plugin
- **License:** MIT
- **Not archived:** Active development

---

## F. What Would a Writable Variant Look Like?

### The Core Problem

OpenCode's undo/branching system tracks file changes per-session. Background sessions created via the plugin API are outside this tracking. If a background agent writes files and the user later "undoes" in the main session, those background writes persist — creating an inconsistent state.

### Minimum Architectural Change

**Option 1: Accept the risk (simplest)**
Remove the `isReadOnly` check in `delegate()`. The child session already runs with the specified agent's permissions — if that agent has write access, it would work immediately. The only change is deleting ~5 lines of enforcement code. Risk: users can't undo background writes.

**Option 2: Write-then-report pattern**
Background agent writes files, then reports what it wrote (file paths + content hashes). Parent session can verify/accept/reject. Still no undo integration, but at least the parent knows what changed.

**Option 3: Worktree isolation (git-based safety)**
Run writable background agents in a separate git worktree or branch. Changes are isolated until explicitly merged. This provides undo semantics via git (revert the merge). Requires git infrastructure but aligns with how our harness already uses worktrees.

**Option 4: OpenCode upstream fix**
Wait for OpenCode to extend its undo/branching system to track changes across child sessions. The README's "workaround is being explored" suggests this may be on the roadmap.

### Safety Concerns

- **Race conditions:** Two background agents writing to the same file simultaneously
- **Undo inconsistency:** User reverts main session but background writes persist
- **Conflict resolution:** Background agent's writes may conflict with main session's concurrent edits
- **Security:** A background agent with bash access could run arbitrary commands without user awareness

### Could it be implemented in our existing arc?

**Yes, partially.** Our harness already has:
- Subagent definitions with per-agent tool allowlists (could define a "background-writer" agent)
- The `task` tool for write-capable subagents (synchronous, blocks parent)
- Worktree management via `@glrs-dev/cli` (could isolate background writes)

**What's missing for a full implementation:**
- Async execution with notification (the core value of this plugin)
- Persistence layer for results surviving compaction
- Event-driven completion detection

**Composition approach:** Define a subagent with write permissions, use the native `task` tool (which preserves undo), but add a persistence wrapper that saves results to disk. This gives you writable background work WITH undo support, but it's synchronous (blocks the parent). True async + writable requires either accepting the undo gap or implementing worktree isolation.

---

## Invariant Conflicts with Our Plugin

| Concern | Status |
|---------|--------|
| Writes to user filesystem (`~/.local/share/opencode/delegations/`) | ⚠️ Our plugin has "zero user-filesystem-writes outside the installer" invariant. This plugin writes delegation results to `~/.local/share/`. If adopted, we'd need to either relax this invariant or store delegations differently. |
| System prompt injection | ⚠️ Uses `experimental.chat.system.transform` to inject delegation routing rules. Our plugin uses prompt files read via `readFileSync`. These could conflict or duplicate. |
| Tool name conflicts | ✅ No conflict — `delegate`, `delegation_read`, `delegation_list` don't overlap with our existing tools. |
| Plugin precedence | ⚠️ The `tool.execute.before` hook intercepts the native `task` tool. If our harness also hooks `task`, ordering matters. |
| Dependencies | ⚠️ Adds `unique-names-generator` as a runtime dependency. Our plugin currently has zero npm dependencies beyond the OpenCode SDK. |

---

## Key Takeaways for Synthesis

1. The read-only limitation is **real, deliberate, and enforced in code** — not a bug or oversight.
2. The root cause is **OpenCode's undo/branching system not tracking background session writes** — a platform limitation.
3. The plugin is well-engineered (~1900 lines), handles edge cases (timeout, compaction, metadata generation), and has significant community adoption.
4. A writable variant is architecturally straightforward to build (remove the check) but **unsafe without additional infrastructure** (worktree isolation or upstream undo support).
5. The most valuable capability to adopt is the **persistence + compaction survival pattern**, not necessarily the background execution itself (which OpenCode's native `task` tool already provides synchronously).
