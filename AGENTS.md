# glrs — repo context for agents

You are working in the unified `@glrs-dev` ecosystem monorepo. Three published packages plus a docs site live here.

## What this repo is

```
glrs/
├── packages/
│   ├── harness-opencode/    # @glrs-dev/harness-plugin-opencode — OpenCode agent harness
│   ├── cli/                 # @glrs-dev/cli — `glrs` dispatcher + worktree management
│   └── assume/              # @glrs-dev/assume — Rust-based SSO tool (gs-assume, gsa)
│       ├── src/             # Rust sources
│       ├── Cargo.toml
│       └── npm/             # Platform-specific npm tarballs
│           ├── darwin-arm64/
│           ├── darwin-x64/
│           ├── linux-x64/
│           ├── linux-arm64/
│           └── win32-x64/
├── docs/                    # Starlight → glrs.dev
├── infra/
│   └── gcp/                 # Pulumi stack: GCS bucket, CDN, managed TLS, WIF
├── .changeset/              # Changesets config + pending changesets
├── .github/workflows/       # CI, release, rust-build-matrix, docs-deploy
├── tsconfig.base.json
├── bun.lock                 # Bun lockfile
└── package.json             # private monorepo root (Bun workspaces)
```

## Tooling

- **Package manager:** Bun (`bun install`, `bun run <script>`, `bun test`)
- **Workspaces:** declared in root `package.json` (`workspaces` array)
- **Build orchestration:** Bun's `--filter` flag runs scripts across workspaces. No turborepo.
- **Versioning + publishing:** Changesets

## Ground rules

1. **One release pipeline.** All publishes go through Changesets. Never run `npm publish` manually. Never run `cargo publish` outside the release workflow. Branch protection on `main` is the gate: merging a Version Packages PR auto-publishes.

2. **No postinstall scripts.** The `.npmrc` has `enable-pre-post-scripts=false`. The Rust-as-npm pattern relies on `optionalDependencies` + runtime-detection shim, NOT postinstall downloads.

3. **Bin-name stability is a contract.** `harness-opencode`, `glrs-oc`, `glrs`, `gs-assume`, `gsa` are all promised-stable. The npm scope rename (`@glorious/*` → `@glrs-dev/*`) does NOT rename any bin. User muscle memory is protected.

4. **History preservation.** `packages/harness-opencode/`, `packages/assume/` were imported via `git-filter-repo --to-subdirectory-filter`. `git log --follow` works back to original commits. Do not rewrite or squash history that pre-dates the unification merge.

5. **Changesets linked groups.** `@glrs-dev/assume` and its five platform siblings (`-darwin-arm64`, `-darwin-x64`, `-linux-x64`, `-linux-arm64`, `-win32-x64`) are a **linked** group — they publish at matching versions. A changeset on any bumps all six. The docs package is in `ignore` — it's not published to npm.

6. **OpenCode plugin invariants (binding on `packages/harness-opencode/`).** See `packages/harness-opencode/AGENTS.md` for full rules. Key ones:
   - Zero user-filesystem-writes outside the installer (`~/.config/opencode/opencode.json` merge only)
   - Skills precedence: plugin-wins (shadow user-dropped overrides)
   - Agents/commands/MCPs: user-wins precedence
   - Prompt files read via `readFileSync` at runtime, NOT static `import`
   - No dangling path references in prompts (CI-enforced)

7. **Rust-specific rules (binding on `packages/assume/`).**
   - `cargo fmt --check` + `cargo clippy -- -D warnings` both must be clean on every PR
   - Cross-platform builds use GitHub's matrix + `cross` for non-native targets
   - `Cargo.toml` `version` and `packages/assume/package.json` `version` are synced at release time via `scripts/sync-version.mjs`

8. **Docs content is separate from scaffold.** `docs/` ships the Starlight scaffold + nav. Authoring docs content is a follow-up effort.

9. **Philosophy.** This is meant to feel inevitable, not clever. If you're tempted to add a "cool" feature, ask: does it reduce the friction of the published packages? If no, leave it out.

## Per-directory AGENTS.md

- `packages/harness-opencode/AGENTS.md` — OpenCode plugin invariants (most complex set)
- `packages/assume/` — Rust toolchain + build matrix
- `packages/cli/` — dispatcher conventions
- `docs/` — Starlight + content conventions
- `infra/gcp/` — Pulumi stack conventions
