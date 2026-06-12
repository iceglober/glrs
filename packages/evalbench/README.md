# @glrs-dev/evalbench

Hermetic eval suite for the glrs harness — the yardstick for harness changes
and architecture-level experiments (PRIME/SPEAR alternatives, guard tuning,
seat assignment, variance reduction).

## Why hermetic

The suite was born from a 13-experiment research loop where the live tracker
drifted mid-eval (issue priority changed, comments appeared) and a sandbox gap
let a run mutate a real ticket. Here:

- the **repo substrate is a pinned local clone** (full `.git`, no worktree
  pointer leaking the source checkout's path),
- **tracker data is frozen JSON** served by a mock Linear MCP under the same
  tool names agents know, and
- **mutations are recorded, not performed** — `mutations.jsonl` makes "did it
  write back, and what?" an assertable outcome.

## Usage

```bash
# one fixture, one model
bun packages/evalbench/src/run.ts --fixture triage-gen2849 --model azure/deepseek-v4-pro

# score a finished run (3 blind evaluators, median; composites recomputed locally)
bun packages/evalbench/src/score.ts --run eval-runs/triage-gen2849/<stamp>

# whole suite, N repetitions, TSV report at eval-runs/results.tsv
bun packages/evalbench/src/suite.ts --model google-vertex/gemini-3.5-flash --runs 3
```

Runs land in `eval-runs/` (gitignored): `session.md`, `final-answer.md`,
`run.json` (metrics + deterministic checks), `score.json`.

The **harness under test is the locally built dist**
(`packages/harness-opencode/dist`) — build before benching. The fixture repo
ref pins the *task substrate*, not the harness.

## Fixtures (v1)

| fixture | shape | substrate | signal |
|---|---|---|---|
| `bugfix-mcp-output-crash` | bugfix | glrs @ pre-fix ref | diagnosis of a real shipped bug; verifyCommand proves the fix |
| `explain-loop-guard` | question | glrs (pinned) | code comprehension with checkable facts |
| `feature-bg-title` | feature | glrs @ parent ref | reimplement a real shipped feature; shipped tests are the oracle |

## Adding a fixture

`fixtures/<name>/`: `manifest.json` (schema in `src/manifest.ts`), `task.md`
(agent prompt — no answer hints), `ground-truth.md` (evaluators only),
`rubric.json` (weights sum to 1), optional `linear/` (frozen tracker JSON).
Prefer tasks reconstructed from real shipped work: revert the fix/feature at a
pinned ref and let the shipped tests/diff be the oracle.

## Private fixtures

Org-specific fixtures (real tracker data, internal repos) MUST NOT be
committed here — this is a public repo. Place them under
`~/.glrs/evalbench-private/fixtures/<name>/` (or set
`GLRS_EVALBENCH_PRIVATE_FIXTURES`); resolution checks the private dir first
and the suite runs the union.

## Notes
- Deterministic checks (`run.json.checks`) scan the final answer PLUS recorded
  mutation payloads — an executed mock write-back counts as a resolution.
- Evaluator panels run on the locked-down `council-member` agent via direct
  `session.prompt` (event-driven waits race on fast tool-less completions).
