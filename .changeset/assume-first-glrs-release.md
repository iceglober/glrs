---
"@glrs-dev/assume": patch
"@glrs-dev/assume-darwin-arm64": patch
"@glrs-dev/assume-darwin-x64": patch
"@glrs-dev/assume-linux-x64": patch
"@glrs-dev/assume-linux-arm64": patch
"@glrs-dev/assume-win32-x64": patch
---

First publish to npm under the `@glrs-dev` scope. The Rust crate renamed from `assume` to `glrs-assume` for crates.io publishing. Bins `gs-assume` and `gsa` preserved. npm distribution uses the prebuilt-binary `optionalDependencies` pattern — five platform tarballs + a TypeScript shim in the main package. No postinstall scripts. Source now lives at `iceglober/glrs/packages/assume/` (from archived `iceglober/glorious/packages/assume/`).
