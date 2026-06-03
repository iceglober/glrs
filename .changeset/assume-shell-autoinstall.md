---
"@glrs-dev/assume": minor
---

fix(assume): run the npm shim under Bun so `gsa` works on Bun-only machines

The bin shim shebang was `#!/usr/bin/env node`, so `gsa` died with
`env: node: No such file or directory` on the Bun-only machines this tool
targets — even though the package declares `engines.bun` and is driven by
`@glrs-dev/cli` (itself `#!/usr/bin/env bun`). Changed to `#!/usr/bin/env bun`;
the shim logic is unchanged and runs as-is under Bun.

feat(assume): auto-install shell integration so `gsa use`/`gsa login` work out of the box

`gsa use` and `gsa login` need a shell wrapper (the `eval "$(gsa shell-init …)"`
line) to set per-shell context — but nothing ever wrote it, so a fresh install
left those commands unable to mutate the shell until the user hand-edited their
rc file.

- `gsa init` now offers a confirmed step (after MCP wiring) that appends the
  integration to the detected shell's rc file (`~/.zshrc`, `~/.bashrc`, or
  `~/.config/fish/config.fish`).
- New `gsa shell-init --install [shell]` flag does the same non-interactively;
  the shell auto-detects from `$SHELL` when omitted. Re-runnable and scriptable.
- Idempotent: a guarded `# >>> glrs-assume >>>` marker block is appended once;
  re-running leaves an already-installed rc untouched.
- `gsa status` nudges when integration is missing, so auto-upgraded installs
  (which don't re-run init) get pointed at `gsa shell-init --install`.

The rc line invokes `gsa` by name (not an absolute path), so it survives
upgrades that relocate the binary inside the versioned package dir.
