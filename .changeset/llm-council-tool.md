---
"@glrs-dev/harness-plugin-opencode": minor
"@glrs-dev/agent-core": minor
---

LLM council — multi-model deliberation @prime can convene for high-stakes judgment calls, after karpathy/llm-council.

New `council` tool (registered only when configured): each configured member model answers the question independently, members peer-review the anonymized answers (labels shuffled per reviewer to kill positional bias), and a chairman model synthesizes a final answer informed by the aggregate peer ranking. Member calls run as locked-down `@council-member` child sessions (no tools, all-deny permissions) with a per-message model override, so any provider authed in opencode works. Runs take minutes, so the tool follows the background_run contract: returns a job id immediately and pushes the full report into the calling session when deliberation finishes (`council_check` for on-demand polling).

Configure via `glrs harness configure` → new Council section (add/remove members from the Models.dev picker, set the chairman — defaults to the deep-tier model), or directly in plugin options:

```json
"council": {
  "members": ["anthropic/claude-opus-4-7", "openai/gpt-5.1", "google/gemini-3-pro"],
  "chairman": "anthropic/claude-opus-4-7"
}
```

The configure TUI also navigates like an actual menu now, rebuilt on @clack/prompts: Esc pops back a layer from any submenu or picker instead of scrolling to a "← Back" list item, the model picker is a type-to-filter autocomplete, the main menu is section-registry based with per-section summaries, and its Models summary shows every configured tier, not just deep/mid. (Note: Ctrl+C inside a prompt now also means "back" — exit via Done or Esc at the top level.)
