---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(auto-update): never delete node_modules before installing; fall back to bun when npm is missing

The 3.16.0 release bricked plugin load on npm-less (bun-only) machines: the auto-updater rewrote the cache pin, deleted `node_modules/`, then ran `npm install` which failed with ENOENT (swallowed). OpenCode does not reliably reinstall a cache dir without node_modules, and concurrent instances racing to recover left a torn package — `Could not find shared file: workflow-mechanics.md` → `failed to load plugin`.

The updater now installs in place (old tree keeps loading if the install fails) and picks the package manager via `pickInstaller()` — npm when available, bun otherwise, rewrite-only when neither exists.

Also fixes the background-jobs **TUI sidebar registration**, which never loaded on opencode ≥1.16: the installer wrote a `<pkg>/tui` subpath entry into the opencode.json `plugin` array, which the loader rejects at startup ("Could not read package.json … failed to install plugin"). The correct mechanism — verified against what `opencode plugin <pkg>` itself writes — is listing the base package in `tui.json` next to opencode.json. `ensureTuiPluginRegistered` now writes tui.json and migrates away (with backup) any legacy `…/tui` entries.

If you're already stuck on a broken 3.16.0 cache: `rm -rf ~/.cache/opencode/packages/@glrs-dev/harness-plugin-opencode@latest && glrs harness install` (or reinstall via your normal flow). Re-running `glrs harness install` also migrates the sidebar registration.
