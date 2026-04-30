---
"@glrs-dev/cli": patch
"@glrs-dev/harness-plugin-opencode": patch
---

chore(changesets): move @glrs-dev/cli and @glrs-dev/harness-plugin-opencode from `linked` to `fixed`

The `linked` group synchronizes versions only among packages that are ALREADY being bumped — it does not force a package into a release. A changeset that named only the harness (as most of our changesets do) would ship a new harness on npm without republishing the CLI, even though the CLI vendors the harness `dist/` at build time (`packages/cli/scripts/vendor-harness.ts`). End users running `glrs oc ...` would keep getting the old vendored harness until somebody remembered to write a no-op CLI changeset.

Moving the pair to `fixed` guarantees any harness publish drags the CLI along at a matching version, so a fresh CLI tarball always re-vendors the latest harness `dist/`. The trade-off — CLI-only changesets now also force a no-op harness republish — is cheap because CLI-only changes are rare in this repo.
