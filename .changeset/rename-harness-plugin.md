---
"@glrs-dev/harness-plugin-opencode": minor
"@glrs-dev/cli": patch
---

**Rename `@glrs-dev/harness-opencode` → `@glrs-dev/harness-plugin-opencode` and republish.**

## Why

OpenCode resolves plugins by npm-installing them into `~/.cache/opencode/packages/<plugin>@<version>/` at plugin-load time. The previous plan — marking `@glrs-dev/harness-opencode` as `private: true` and vendoring it only into `@glrs-dev/cli` — broke OpenCode's plugin loader because the package wasn't published on npm, causing `ETARGET: No matching version found for @glrs-dev/harness-opencode@1.0.0`.

The fix: publish the plugin under a new name (`@glrs-dev/harness-plugin-opencode`) so OpenCode can resolve it normally. The old name stays deprecated at its last published version (`0.16.2`).

## What changed

- `packages/harness-opencode/package.json`: renamed from `@glrs-dev/harness-opencode` to `@glrs-dev/harness-plugin-opencode`, `private: true` removed, `publishConfig.access: public` + `provenance: true` added, version reset to `0.1.0` (fresh name on npm).
- The `install` / `uninstall` / `doctor` flows now write the new name to `opencode.json`'s plugin array.
- `@glrs-dev/cli` still bundles a vendored copy of the plugin for standalone subprocess dispatch (`glrs oc`), but the npm-resolved copy is what OpenCode's plugin runtime loads.
- Bin names unchanged — `harness-opencode` and `glrs-oc` still work.

## Migration for existing users

Re-run `glrs oc install` to update your `opencode.json` plugin array from `@glrs-dev/harness-opencode` to `@glrs-dev/harness-plugin-opencode`. The old entry will be replaced; no data loss.
