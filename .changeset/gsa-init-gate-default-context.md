---
"@glrs-dev/assume": minor
"@glrs-dev/cli": minor
---

feat(assume): `gsa init` requires a default context, gates all commands until set up, and self-repairs broken installs

`gsa init` now requires choosing a default context (what the bare credential
endpoint and `gsa exec`/agents resolve to when none is pinned). Pick it
interactively or pass `--default-context <pattern>`.

`glrs assume init` repairs and migrates in one shot: it removes the deprecated
`@glorious/assume` package (whose stale `gsa`/`gs-assume` bins shadow the
current install), installs the latest `@glrs-dev/assume`, and migrates a
pre-rebrand `gs-assume` config directory forward (copy, never delete) so you
keep providers, contexts, and credentials.

Breaking: until `gsa init` completes, gsa is non-functional — every command
except `init`, `upgrade`, `shell-init`, `status`, and `config` refuses with a
pointer to `gsa init`. This prevents the half-configured state where the daemon
is running but no default context exists. Existing users must run `gsa init`
once after upgrading to write the new init marker.
