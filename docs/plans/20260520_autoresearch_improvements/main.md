# Autopilot Performance Improvements

**Created:** 2026-05-20
**Status:** Planning
**Scope:** Five changes to the autopilot pipeline derived from autoresearch on the complex webapp eval (12 iterations, 6 configurations). Target: push the eval score from 0.881 to >0.92 by reducing session overhead, eliminating redundant enrichment, routing models adaptively, fixing cost tracking, and making retries surgical.

---

## What the autoresearch showed

- **Session count dominates execution time.** 4 sessions (aggressive variant) ran in 700s. 12 sessions (baseline) ran in 2900s. Each session pays ~60s of fixed startup cost regardless of item size.
- **Enrichment is redundant on stable plans.** 300s of a 950s full-pipeline run was enrichment that produced identical YAML to the previous run. The enrichment ratio check (`computeEnrichmentRatio`) already skips when spec exists, but only when spec files are present — there's no content-based invalidation.
- **Cheap models work for most items.** Haiku (coding index 33, $1/$5) and GLM-5 (coding index 44, $1/$3.20) both hit 100% accuracy on most runs. Sonnet ($3/$15) is 4-5x more expensive with no accuracy gain on straightforward items.
- **Cost tracking is broken.** Claude Code CLI always reports $0. OpenCode applies wrong pricing to non-native models ($1.17 reported for GLM-5 when real Bedrock cost was ~$0.25).
- **Retries start from scratch.** Wave_1 retried in 3 of 12 runs. Each retry spawns a fresh session with no knowledge of prior work, costing 150-200s to redo what was 90% correct.

---

## Waves

| Wave | Focus | Impact | Risk | File |
|------|-------|--------|------|------|
| 0 | Item batching in fast-mode execution | 3-4x speed on multi-item phases | Medium | [wave_0.md](./wave_0.md) |
| 1 | Content-hash enrichment cache | ~300s saved per stable-plan run | Low | [wave_1.md](./wave_1.md) |
| 2 | Tiered model routing with escalation | 2-5x cost reduction, haiku-level speed | Medium | [wave_2.md](./wave_2.md) |
| 3 | Adapter-agnostic cost estimation | Accurate scoring across all adapters | Low | [wave_3.md](./wave_3.md) |
| 4 | Context-aware retry with prior work | 150-200s saved per retry | Medium | [wave_4.md](./wave_4.md) |

---

## Safety invariants

- Item batching must never merge items across waves. Wave boundaries are dependency fences.
- Enrichment cache invalidation is mandatory. A stale spec is worse than a slow enrichment.
- Model escalation must use the same adapter — no adapter switching mid-phase.
- Cost estimation is best-effort. It informs scoring but never blocks execution.
- Retry context includes the diff of work done, not a full session transcript. Keep prompt size bounded.
