---
name: howto
description: Use when the user asks how to perform an operational task in this codebase — running tests, deploying, migrating the database, setting up local dev, debugging a service, etc. Use when the question starts with "how do I", "how to", "what's the command to", or "walk me through". Do NOT use for architecture questions (use /research instead).
---

# How To: Operational Codebase Guide

Answer the question: **$ARGUMENTS**

## YOU ARE AN ORCHESTRATOR ONLY

**NEVER** use Glob, Grep, Read, or Bash directly. YOU MUST delegate ALL exploration to Explore subagents. Violating this rule produces stale, hallucinated answers.

---

## Ground Truth Hierarchy

When subagents search, instruct them to trust sources in this order:

1. CI/CD configs (`.github/workflows/`, `Makefile`, `Justfile`) — what actually runs
2. `package.json` scripts, `Dockerfile`, `docker-compose.yml` — what devs invoke
3. Shell scripts and inline comments
4. Documentation (README, `docs/`) — **treat as possibly stale; verify against above**

---

## Phase 1: Decompose

Identify 3–5 parallel search threads. Standard threads for operational questions:

- **Entry points** — Where is the command/script defined? (`package.json`, Makefile, CI)
- **Prerequisites** — What must exist first? (env vars, running services, credentials, installed tools)
- **Happy path** — What does the code actually do when invoked? Trace it.
- **Competing approaches** — Multiple ways to do this? Which is current vs legacy?
- **Gotchas** — What breaks, what's env-specific, what changed recently?

If the question is ambiguous (e.g., "how do I deploy" when there are multiple services), ask the user to clarify **before** launching subagents.

---

## Phase 2: Parallel Exploration

Launch **ALL Explore subagents in a single message**. Use this prompt for each:

```
Operational question: [ORIGINAL QUESTION]
Search thread: [SPECIFIC THREAD]

Explore the codebase to answer this. CRITICAL: trust CI configs, Makefile, and package.json scripts over README/docs — docs may be stale. Read actual file contents, not just filenames.

Report:
1. Exact files and line numbers for relevant config/scripts
2. The actual commands to run (copy-pasteable)
3. Prerequisites (env vars, running services, installed tools)
4. Evidence of recency — is this used in CI? Recently touched?
5. Red flags — stale docs, multiple competing versions, broken references
```

---

## Phase 3: Fill Gaps

If Phase 2 reveals a conflict (docs say X, CI does Y), launch one targeted Explore subagent to resolve it before synthesizing.

---

## Phase 4: Synthesize and Respond

Produce output in this format — no preamble, go straight to it:

---

## How to [THING]

**TL;DR:** [one sentence]

### Prerequisites
- [tool / env var / running service required]

### Steps
```bash
# [what this does]
command

# [what this does]
command
```

### Notes
- [env-specific behavior, gotcha, common failure mode]
- [if multiple methods exist: "Two approaches — use X for Y, use Z for W"]

### Sources
- `path/to/file:line` — [what this confirms]

### Watch out for
- [anything where docs and code disagreed — call it out explicitly]

---

## Output Rules

- **Commands over prose.** Give the exact command the project uses (e.g., `pnpm test`, `npm test`, `cargo test`, `pytest`), not "you should run the test suite."
- **Every command must trace to a source file:line.** No inference.
- **Stale doc conflicts must be surfaced**, not silently resolved.
- **No history, rationale, or theory** unless the user asked for it.
