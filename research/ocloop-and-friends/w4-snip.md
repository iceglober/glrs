# W4: opencode-snip (VincentHardouin)

**Status:** Complete  
**Date:** 2026-05-11  
**Source:** https://github.com/VincentHardouin/opencode-snip

---

## A. What does it do?

opencode-snip is an OpenCode plugin that transparently prefixes every shell command the LLM executes (via the `bash` tool) with the `snip` CLI binary. `snip` itself (a separate Go binary by [edouard-claude/snip](https://github.com/edouard-claude/snip)) is a CLI proxy that intercepts shell output and filters it through declarative YAML pipelines before it reaches the LLM's context window — stripping verbose test output, git logs, build noise, etc. down to the essential signal. The plugin claims 60–90% token reduction on typical commands (e.g., `go test ./...` goes from 689 tokens to 16 tokens). The plugin does NOT provide "snippets" or "templates" — the name "snip" refers to snipping/trimming shell output.

**Sources:**
- [README](https://github.com/VincentHardouin/opencode-snip#readme)
- [snip upstream README](https://github.com/edouard-claude/snip#readme)

---

## B. Mechanism

### Type
OpenCode plugin. Uses the `@opencode-ai/plugin` SDK (`^1.0.0`). Registered via `opencode.json` plugin array.

### How it works
1. Exports a default `Plugin` factory function (`SnipPlugin`).
2. On load, checks `which snip` — if not found, logs a warning and returns an empty hooks object (graceful degradation).
3. If `snip` is available, registers a single hook: `tool.execute.before`.
4. The hook intercepts every `bash` tool call, parses the command string, and prepends `snip ` to each sub-command segment (handling `&&`, `||`, `;`, `&`, pipes, env-var prefixes, and quoted strings).
5. Shell builtins (`cd`, `source`, `.`, `export`, `alias`, `unset`, `set`, `shopt`, `eval`, `exec`) are skipped.
6. Already-prefixed commands (`snip ...`) are skipped.
7. For piped commands, only the first segment before the pipe gets prefixed (the rest pass through).

### Where snippets/config are stored
There are no "snippets" stored anywhere. The plugin is stateless. The upstream `snip` binary stores its YAML filter definitions in `~/.config/snip/filters/` and tracking data in `~/.local/share/snip/tracking.db` (SQLite).

### Invocation
Automatic — no slash command, no keybinding, no user interaction. Every bash tool call is intercepted transparently.

### Language/runtime
TypeScript (ESM). Entry point: `.opencode/plugins/index.ts` re-exports from `src/index.ts`. 80 lines of source code total. Tests via Vitest.

**Sources:**
- [src/index.ts](https://github.com/VincentHardouin/opencode-snip/blob/main/src/index.ts)
- [.opencode/plugins/index.ts](https://github.com/VincentHardouin/opencode-snip/blob/main/.opencode/plugins/index.ts)
- [package.json](https://github.com/VincentHardouin/opencode-snip/blob/main/package.json)

---

## C. Integration surface

| Aspect | Detail |
|--------|--------|
| Hook used | `tool.execute.before` |
| SDK dependency | `@opencode-ai/plugin ^1.0.0` |
| Registration | `"plugin": ["opencode-snip@latest"]` in `~/.config/opencode/opencode.json` |
| Commands registered | None |
| Slash commands | None |
| Tools registered | None |
| MCPs | None |
| File watching | None |

The integration is minimal: a single hook that mutates `output.args.command` before the bash tool executes.

**Source:** [src/index.ts lines 48-65](https://github.com/VincentHardouin/opencode-snip/blob/main/src/index.ts)

---

## D. Invariants / behavior

### Filesystem writes
- **Plugin itself:** Zero writes. Purely in-memory command rewriting.
- **Upstream `snip` binary:** Writes to `~/.local/share/snip/tracking.db` (SQLite) for token-savings tracking. Reads from `~/.config/snip/filters/` and `~/.config/snip/config.toml`.

### Modification of `~/.config/opencode/opencode.json`
No. The user manually adds the plugin entry. The plugin does not modify config.

### Shared state / globals / caching
None. The plugin is stateless — each hook invocation is pure string transformation.

### Maturity
| Metric | Value |
|--------|-------|
| Stars | 90 |
| Forks | 6 |
| First release | v1.0.0 (circa March 2026) |
| Latest release | v1.6.1 (2026-04-10) |
| Total commits | 24 |
| Total releases | 8 |
| License | MIT |
| Archived | No |
| Active | Yes (8 releases in ~5 weeks) |
| Node engine | `^24` |
| Upstream snip | 228 stars, 27 forks, v0.15.0, MIT, Go 1.25+ |

**Sources:**
- [Releases page](https://github.com/VincentHardouin/opencode-snip/releases)
- [snip repo](https://github.com/edouard-claude/snip)

---

## E. Fit with our plugin

### Does it fill a need we don't address?
**Yes.** Our plugin (`@glrs-dev/harness-plugin-opencode`) provides slash commands, skills, agents, and prompt orchestration — but does NOT do anything to reduce token consumption from shell output. Token reduction is an orthogonal concern that directly saves money and context-window space for long-running agent sessions.

### Can a user install it alongside our plugin?
**Yes, with a caveat.** Both plugins can coexist because:
- opencode-snip registers zero commands, zero tools, zero MCPs — only a `tool.execute.before` hook.
- Our plugin's precedence rules (plugin-wins for skills, user-wins for commands/MCPs) are irrelevant here since there's no overlap in those categories.

**Potential conflict:** If our plugin also registers a `tool.execute.before` hook (now or in the future), the execution order of multiple plugins' hooks on the same event is determined by OpenCode's plugin loading order. This is not a hard conflict but could produce unexpected behavior if both try to mutate the same command string.

### Collisions

| Surface | opencode-snip | Our plugin | Conflict? |
|---------|---------------|------------|-----------|
| Bin names | None | `harness-opencode`, `glrs-oc` | No |
| Slash commands | None | `/fresh`, `/ship`, `/autopilot`, `/research`, `/review`, `/costs`, `/init-deep` | No |
| Hook: `tool.execute.before` | Yes | Not currently, but possible future | **Watch** |
| npm package name | `opencode-snip` | `@glrs-dev/harness-plugin-opencode` | No |

### Adoption recommendation

**Do not absorb into our plugin. Recommend as a companion.**

Rationale:
1. The value comes from the upstream `snip` Go binary (126 YAML filters, SQLite tracking, 228 stars). The plugin wrapper is trivial (80 lines).
2. Absorbing it would create a hard dependency on an external Go binary that users must install separately — violating our "zero user-filesystem-writes" invariant if we tried to auto-install it.
3. The plugin is MIT-licensed, well-maintained, and designed to be installed alongside other plugins.
4. If we want to offer token reduction natively in the future, we'd need to implement the filtering logic in-process (TypeScript/Bun) rather than shelling out to a Go binary — a fundamentally different architecture.
5. Users who want this can simply add `"opencode-snip@latest"` to their plugin array alongside our plugin.

**Alternative consideration:** We could document `opencode-snip` as a recommended companion plugin in our docs, or even mention it in `/init-deep` output as an optional optimization.

---

## Summary

| Dimension | Assessment |
|-----------|------------|
| What it is | Token-reduction proxy plugin (NOT snippets/templates) |
| Complexity | Trivial (80 LOC wrapper around external Go binary) |
| Conflict risk | Low (no command/tool/MCP overlap; hook ordering is only theoretical risk) |
| User value | High (60-90% token savings on shell output) |
| Adoption path | Recommend alongside, do not absorb |
| Invariant violations | None |
