---
"@glrs-dev/harness-opencode": major
---

**Breaking change: standalone bin invocation now exits 1 with a redirect notice.**

The `harness-opencode` and `glrs-oc` bins now print a one-line redirect to stderr and exit with code 1 when invoked directly (i.e., not via `@glrs-dev/cli`'s dispatcher). This is intentional — `@glrs-dev/cli` is the new single install path.

## Migration

```bash
# Before
npm i -g @glrs-dev/harness-opencode
harness-opencode install
glrs-oc pilot run

# After
npm i -g @glrs-dev/cli
glrs oc install
glrs oc pilot run
```

The `harness-opencode` and `glrs-oc` bin names continue to exist (bin-name stability is a contract), but they redirect when invoked standalone. When dispatched by `glrs oc`, they run normally.

## Why

`@glrs-dev/cli` is now the unified entry point for the entire `@glrs-dev` ecosystem. Installing one package gives you `glrs oc`, `glrs agentic`, and `glrs assume`. The three sub-packages (`@glrs-dev/harness-opencode`, `@glrs-dev/agentic`, `@glrs-dev/assume`) are now private and will no longer publish to npm. Version `0.16.2` of `@glrs-dev/harness-opencode` is the last published version.

See [https://glrs.dev/install](https://glrs.dev/install) for the updated install instructions.
