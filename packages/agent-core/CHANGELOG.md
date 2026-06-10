# @glrs-dev/agent-core

## 0.2.0

### Minor Changes

- [#337](https://github.com/iceglober/glrs/pull/337) [`4381d0f`](https://github.com/iceglober/glrs/commit/4381d0fbbc33aaa76a9e90f5a25ad8444999a777) Thanks [@iceglober](https://github.com/iceglober)! - LLM council — multi-model deliberation @prime can convene for high-stakes judgment calls, after karpathy/llm-council.

  New `council` tool (registered only when configured): each configured member model answers the question independently, members peer-review the anonymized answers (labels shuffled per reviewer to kill positional bias), and a chairman model synthesizes a final answer informed by the aggregate peer ranking. Member calls run as locked-down `@council-member` child sessions (no tools, all-deny permissions) with a per-message model override, so any provider authed in opencode works. Runs take minutes, so the tool follows the background_run contract: returns a job id immediately and pushes the full report into the calling session when deliberation finishes (`council_check` for on-demand polling).

  Configure via `glrs harness configure` → new Council section (add/remove members from the Models.dev picker, set the chairman — defaults to the deep-tier model), or directly in plugin options:

  ```json
  "council": {
    "members": ["anthropic/claude-opus-4-7", "openai/gpt-5.1", "google/gemini-3-pro"],
    "chairman": "anthropic/claude-opus-4-7"
  }
  ```

  The configure TUI also navigates like an actual menu now, rebuilt on @clack/prompts: Esc pops back a layer from any submenu or picker instead of scrolling to a "← Back" list item, the model picker is a type-to-filter autocomplete, the main menu is section-registry based with per-section summaries, and its Models summary shows every configured tier, not just deep/mid. (Note: Ctrl+C inside a prompt now also means "back" — exit via Done or Esc at the top level.)

## 0.1.0

### Minor Changes

- [#331](https://github.com/iceglober/glrs/pull/331) [`4a32f65`](https://github.com/iceglober/glrs/commit/4a32f65fe15ab73575fcaf1fcc819bcc707930f3) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): @oracle bounded deep-reasoning consult + pattern-first discipline

  Two extensions aimed at solving hard problems without user intervention:

  - **`@oracle` agent** — a read-only Opus consult that answers ONE hard question per dispatch within a small tool budget (~5 calls) and returns Answer + Confidence + Evidence. PRIME's reasoning-depth test now routes "I can't articulate the root cause" to an oracle consult before guessing or paying for a full `@build-deep` dispatch; the repeated-failure escalation gains a comprehension-gap shortcut (oracle diagnoses, standard tier implements). `@build` and `@build-cheap` get task-tool access restricted to oracle consults, so a stuck Sonnet/GLM builder can ask one question instead of grinding.

  - **Complexity nudge routes by gap type** — the tool-hooks `COMPLEXITY CHECK` hint (fired after repeated failing verify runs with no delegation) now suggests a bounded `@oracle` consult for comprehension gaps ("you can't articulate WHY this fails") and reserves `@build-deep` for implementation-depth gaps. New `loopDetection.consultAgent` plugin option (default `"@oracle"`).

  - **`pattern-first` skill + `## Pattern decisions` plan section** — plans that introduce a new concept or add the Nth instance of an existing theme must now inventory the incumbent pattern, test its sustainability, and decide: follow / extend / replace-now / quarantine / set. `@plan-reviewer` rejects new-concept plans without the section; `@build` treats `Mirror:` files as subordinate to the pattern decision; code reviewers treat "matches existing code" as a non-pass when the matched code is a flagged-unsustainable pattern. Bad incumbent patterns stop getting silently propagated.
