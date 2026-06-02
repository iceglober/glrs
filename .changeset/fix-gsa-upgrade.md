---
"@glrs-dev/assume": patch
---

fix(assume): `gsa upgrade` checked the wrong repo and never updated

`gsa upgrade` still pointed at the pre-rename repo (`iceglober/glorious`, tag
prefix `assume-v`), which froze at ~0.6.x. It reported that stale release as
"latest version: 0.6.4" and — since the installed 0.10.x is numerically newer —
declared "already up to date", so it could never actually upgrade.

- Point at the current repo and changesets tag format: `iceglober/glrs`,
  `@glrs-dev/assume@<version>`.
- Select the highest-semver matching release (not the first in list order) in
  both the gh-CLI and REST paths.
- npm installs now upgrade via `npm i -g @glrs-dev/assume@latest` instead of a
  GitHub binary-swap into node_modules, which would desync the binary from the
  package manifest.
