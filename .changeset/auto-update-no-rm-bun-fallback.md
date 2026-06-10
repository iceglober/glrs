---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(auto-update): never delete node_modules before installing; fall back to bun when npm is missing

The 3.16.0 release bricked plugin load on npm-less (bun-only) machines: the auto-updater rewrote the cache pin, deleted `node_modules/`, then ran `npm install` which failed with ENOENT (swallowed). OpenCode does not reliably reinstall a cache dir without node_modules, and concurrent instances racing to recover left a torn package — `Could not find shared file: workflow-mechanics.md` → `failed to load plugin`.

The updater now installs in place (old tree keeps loading if the install fails) and picks the package manager via `pickInstaller()` — npm when available, bun otherwise, rewrite-only when neither exists.

If you're already stuck on a broken 3.16.0 cache: `rm -rf ~/.cache/opencode/packages/@glrs-dev/harness-plugin-opencode@latest && glrs harness install` (or reinstall via your normal flow).
