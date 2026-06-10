# @glrs-dev/agent-core

## 0.1.0

### Minor Changes

- [#331](https://github.com/iceglober/glrs/pull/331) [`4a32f65`](https://github.com/iceglober/glrs/commit/4a32f65fe15ab73575fcaf1fcc819bcc707930f3) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): @oracle bounded deep-reasoning consult + pattern-first discipline

  Two extensions aimed at solving hard problems without user intervention:

  - **`@oracle` agent** — a read-only Opus consult that answers ONE hard question per dispatch within a small tool budget (~5 calls) and returns Answer + Confidence + Evidence. PRIME's reasoning-depth test now routes "I can't articulate the root cause" to an oracle consult before guessing or paying for a full `@build-deep` dispatch; the repeated-failure escalation gains a comprehension-gap shortcut (oracle diagnoses, standard tier implements). `@build` and `@build-cheap` get task-tool access restricted to oracle consults, so a stuck Sonnet/GLM builder can ask one question instead of grinding.

  - **Complexity nudge routes by gap type** — the tool-hooks `COMPLEXITY CHECK` hint (fired after repeated failing verify runs with no delegation) now suggests a bounded `@oracle` consult for comprehension gaps ("you can't articulate WHY this fails") and reserves `@build-deep` for implementation-depth gaps. New `loopDetection.consultAgent` plugin option (default `"@oracle"`).

  - **`pattern-first` skill + `## Pattern decisions` plan section** — plans that introduce a new concept or add the Nth instance of an existing theme must now inventory the incumbent pattern, test its sustainability, and decide: follow / extend / replace-now / quarantine / set. `@plan-reviewer` rejects new-concept plans without the section; `@build` treats `Mirror:` files as subordinate to the pattern decision; code reviewers treat "matches existing code" as a non-pass when the matched code is a flagged-unsustainable pattern. Bad incumbent patterns stop getting silently propagated.
