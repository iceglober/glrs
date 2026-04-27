---
"@glrs-dev/harness-plugin-opencode": patch
---

**Add automatic migration from old plugin name to new.**

The plugin was renamed from `@glrs-dev/harness-opencode` to `@glrs-dev/harness-plugin-opencode`. Users with the old plugin name in their `opencode.json` would have duplicate entries and missing agents.

## Changes

- `install` command now automatically migrates the old plugin entry to the new name, preserving any configuration (models, etc.)
- `uninstall` command now removes both old and new plugin names
- `doctor` command warns if the old plugin name is still present
- Added helper functions `getPluginName()` and `getPluginOptions()` for consistent plugin entry parsing

## Migration behavior

When `glrs oc install` runs:
1. Detects if old plugin name exists in plugin array
2. Extracts any configuration from the old entry
3. Adds new plugin entry with transferred config (or updates existing new entry)
4. Removes the old plugin entry
5. Reports migration success to user

Users upgrading from versions prior to the rename will have their config automatically migrated with no data loss.
