# @glrs-dev/assume

## 0.6.3

### Major Changes

- First release under the `@glrs-dev` npm scope. Rust crate renamed from `assume` to `glrs-assume` for crates.io publishing; npm package name is `@glrs-dev/assume`.
- Bins `gs-assume` and `gsa` are preserved — existing shell aliases and muscle memory keep working.
- Source moved from [`iceglober/glorious`](https://github.com/iceglober/glorious) (now archived) to [`iceglober/glrs/packages/assume/`](https://github.com/iceglober/glrs/tree/main/packages/assume). Full git history preserved via `git-filter-repo`.

### Packaging

- npm package ships via the prebuilt-binary `optionalDependencies` pattern: five platform packages (`@glrs-dev/assume-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}`) each carry the prebuilt binary; the main `@glrs-dev/assume` package selects the right one at runtime via its TypeScript shim. No postinstall scripts.
- Rust crate also publishes to crates.io as `glrs-assume` — `cargo install glrs-assume` still works.

### Install

```bash
# Prebuilt binary via npm (recommended for most users)
npm i -g @glrs-dev/assume

# Build from source via cargo
cargo install glrs-assume
```

---

_For version history before the monorepo consolidation, see [`iceglober/glorious/releases`](https://github.com/iceglober/glorious/releases) (filter: `assume-*`)._
