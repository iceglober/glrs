# @glrs-dev/autopilot

## 0.5.0

### Minor Changes

- [#129](https://github.com/iceglober/glrs/pull/129) [`3e818da`](https://github.com/iceglober/glrs/commit/3e818daebc6d114a5bf7e24a2d28826b2d23528b) Thanks [@iceglober](https://github.com/iceglober)! - Per-item rollback, checkpoint.json removal, and dead code cleanup — commits are the checkpoint mechanism now

## 0.4.2

### Patch Changes

- [#127](https://github.com/iceglober/glrs/pull/127) [`8a0ce16`](https://github.com/iceglober/glrs/commit/8a0ce167bcbf94e3eea4bec2222a05ed56ffe442) Thanks [@iceglober](https://github.com/iceglober)! - Add autopilot observability: recovery event rendering, 30s heartbeat timer, per-phase wall-clock timeout (30 min default)

- [#127](https://github.com/iceglober/glrs/pull/127) [`8a0ce16`](https://github.com/iceglober/glrs/commit/8a0ce167bcbf94e3eea4bec2222a05ed56ffe442) Thanks [@iceglober](https://github.com/iceglober)! - Fix crash recovery: catch thrown exceptions (socket errors, fetch failures) in retry loop instead of letting them kill the run

## 0.4.1

### Patch Changes

- [#125](https://github.com/iceglober/glrs/pull/125) [`9b0524a`](https://github.com/iceglober/glrs/commit/9b0524a0b7d3cd8b73d6bfc0883c0d960a24ad8f) Thanks [@iceglober](https://github.com/iceglober)! - Add autopilot observability: recovery event rendering, 30s heartbeat timer, per-phase wall-clock timeout (30 min default)

## 0.4.0

### Minor Changes

- [#122](https://github.com/iceglober/glrs/pull/122) [`088dcd8`](https://github.com/iceglober/glrs/commit/088dcd8a2cbf40e2e83271d1f8dc794fceeee2b5) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot recovery: 5 evolving retry attempts on every failure mode (verify, crash, stall, max-iterations) with progressive strategy changes and deep-model escalation. Phases never skip on failure — the run halts if all attempts exhaust.

  CLI: fix preflight validation blocking unenriched plans (single-file and directory without spec/) from reaching the enrichment step.

## 0.3.0

### Minor Changes

- [#118](https://github.com/iceglober/glrs/pull/118) [`d1ce47e`](https://github.com/iceglober/glrs/commit/d1ce47e8e1846587dfe0bc7fef2cf5e486464f38) Thanks [@iceglober](https://github.com/iceglober)! - Eliminate plan shapes — collapse freeform file, markdown directory, and YAML spec directory into a single enrichment path that always produces spec/main.yaml + spec/wave_N.yaml. Remove useYamlSpec branching, markdown parsers, orphan recovery, and decomposition pipeline.

## 0.2.5

### Patch Changes

- [#114](https://github.com/iceglober/glrs/pull/114) [`d987e11`](https://github.com/iceglober/glrs/commit/d987e1197e8ee62cbd40dad8e9f4f3cfc5944c07) Thanks [@iceglober](https://github.com/iceglober)! - Speed up PRIME sessions: downgrade gap-analyzer and plan-reviewer to Sonnet, add pre-Assess session-green timestamps, and add sisyphus-style parallel-dispatch enforcement hook. Fix autopilot conflict graph silently falling back to sequential for enriched YAML specs.

## 0.2.4

### Patch Changes

- [#106](https://github.com/iceglober/glrs/pull/106) [`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1) Thanks [@iceglober](https://github.com/iceglober)! - fix(autopilot): detect empty phases when plan directory has phase markdown files

  Adds `empty-phases-with-plan-files` validation error when spec/main.yaml has 0 phases but the plan directory contains phase markdown files. The repair prompt now includes the plan's markdown file list so the LLM can generate the missing phase references and spec files.

- [#106](https://github.com/iceglober/glrs/pull/106) [`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1) Thanks [@iceglober](https://github.com/iceglober)! - fix(autopilot): resilient spec enrichment with LLM-based validation+repair loop

  Pass actual phase filenames to the main.yaml generation prompt so the LLM uses correct references instead of inventing simplified names. After enrichment, validate the spec and send any errors back to the LLM for repair, looping until validation passes or the repair budget is exhausted.

- [#106](https://github.com/iceglober/glrs/pull/106) [`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1) Thanks [@iceglober](https://github.com/iceglober)! - fix(autopilot): validate that phase spec files on disk are referenced in main.yaml

  Adds `unreferenced-spec-phase-file` validation error when spec files exist on disk but aren't listed in spec/main.yaml's phases array. Prevents the case where the LLM generates an empty phases array and the executor thinks all work is done.

## 0.2.3

### Patch Changes

- [#104](https://github.com/iceglober/glrs/pull/104) [`82b1221`](https://github.com/iceglober/glrs/commit/82b122100ecb67edd01fcc169f43fcaab55f4108) Thanks [@iceglober](https://github.com/iceglober)! - fix(autopilot): resilient spec enrichment with LLM-based validation+repair loop

  Pass actual phase filenames to the main.yaml generation prompt so the LLM uses correct references instead of inventing simplified names. After enrichment, validate the spec and send any errors back to the LLM for repair, looping until validation passes or the repair budget is exhausted.

- [#104](https://github.com/iceglober/glrs/pull/104) [`82b1221`](https://github.com/iceglober/glrs/commit/82b122100ecb67edd01fcc169f43fcaab55f4108) Thanks [@iceglober](https://github.com/iceglober)! - fix(autopilot): validate that phase spec files on disk are referenced in main.yaml

  Adds `unreferenced-spec-phase-file` validation error when spec files exist on disk but aren't listed in spec/main.yaml's phases array. Prevents the case where the LLM generates an empty phases array and the executor thinks all work is done.

## 0.2.2

### Patch Changes

- [#102](https://github.com/iceglober/glrs/pull/102) [`05c5fa7`](https://github.com/iceglober/glrs/commit/05c5fa76322634bfa1ec08594d7dff0127404c45) Thanks [@iceglober](https://github.com/iceglober)! - fix(autopilot): resilient spec enrichment with LLM-based validation+repair loop

  Pass actual phase filenames to the main.yaml generation prompt so the LLM uses correct references instead of inventing simplified names. After enrichment, validate the spec and send any errors back to the LLM for repair, looping until validation passes or the repair budget is exhausted.

## 0.2.1

### Patch Changes

- [#99](https://github.com/iceglober/glrs/pull/99) [`6d307dc`](https://github.com/iceglober/glrs/commit/6d307dc93011603d1b031ac757ed3d6e94ebffa4) Thanks [@iceglober](https://github.com/iceglober)! - fix(autopilot): enrich freeform plan files instead of skipping them

  Removes the "no enrichable items" skip that silently dropped plan files without
  pre-existing checkboxes or numbered headings. All plan files now go through spec
  generation — the LLM decomposes freeform content into structured YAML items.
  Also constrains main.md spec generation to only reference phase files that
  actually exist on disk, preventing phantom phase file references that cause
  validation failures.

## 0.2.0

### Minor Changes

- [#83](https://github.com/iceglober/glrs/pull/83) [`407e0a5`](https://github.com/iceglober/glrs/commit/407e0a5b20c96474c556a88e45ae9e0dcde8cc36) Thanks [@iceglober](https://github.com/iceglober)! - Remove `--fast` flag. Enrichment now runs unconditionally (idempotent skip when specs already enriched). Per-item execution is the sole strategy with 25-iteration budget and 5-min stall timeout.

## 0.1.1

### Patch Changes

- [#77](https://github.com/iceglober/glrs/pull/77) [`d684392`](https://github.com/iceglober/glrs/commit/d68439287a0a4bd9496011232e3e81d72bbda398) Thanks [@iceglober](https://github.com/iceglober)! - Fix phase cost summaries showing $0.00 by returning cumulativeCostUsd from all runRalphLoop exit paths. Route `glrs autopilot` through cmd-ts so --plan, --fast, and other flags are parsed.
