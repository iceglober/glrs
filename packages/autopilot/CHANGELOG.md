# @glrs-dev/autopilot

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
