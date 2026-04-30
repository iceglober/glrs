---
name: adr
description: "Use when drafting, revising, or reading any engineering ADR in `docs/adr/`. Encodes grounding steps, the mandatory section template, the Unspecified-interactions-vs-Open-questions rubric, the security-default-deny rule, and self-check red flags. Use when the task is to write an ADR, draft an architecture decision, produce a design doc for a schema/contract/cross-package change, propose a new table/entity, or capture a consequential decision. Do NOT draft an ADR without this skill loaded."
---

# Engineering ADR Skill (docs/adr/)

Purpose: every engineering ADR in this repo starts from the same
opinionated foundation. Read prior ADRs in `docs/adr/` before drafting
(see Step 1) — each one's lessons compound.

This skill describes **what** to do and **how** to structure an ADR.
It deliberately does NOT prescribe a review process — how an ADR gets
scrutinized before merge is up to whoever is shipping it and whichever
harness or team workflow applies. The skill's job is to make the draft
good; the review process is a separate concern.

## When you MUST load this skill

- Drafting a new file in `docs/adr/`.
- Revising an existing ADR (even a typo-sized change — you may trip
  one of the red flags below).
- Reading an existing ADR to understand a past decision, if you need
  to write a supersession or cite its pattern.

## When this skill does NOT apply

- Product decisions (if a `docs/product/` directory exists, use that).
- LLM-feature proposals (if a dedicated template exists, use that).
- Implementation plans, task breakdowns, build sequencing — Linear
  issues or plan files.
- Bug fixes, refactors, single-PR work — Linear issue, no ADR.

## The iron rules (five rules; every ADR should honor them)

1. **Ground before you draft.** Run the grounding checklist below
   BEFORE writing the Decision section. Invented table/column/module
   names are the #1 cause of ADR rework.
2. **Section order is frozen** (see Template). Don't reorder. Don't
   omit. A missing section is a signal you skipped work, not that the
   work wasn't needed.
3. **Security-sensitive capabilities DEFAULT DENY.** Every new role
   grant, every new partner scope, every new cross-org read path
   starts in the `off` position with an explicit, logged
   per-principal enablement path. "Probably fine" is not a stance.
4. **Cross-system couplings go in `Consequences -> Unspecified
   interactions`, not `Open questions`.** See the rubric below.
5. **"Pre-implementation codebase investigation" items must be
   genuinely unknown at write time.** If it's "verify my bullets are
   right", it's already your job — do it before drafting.

## Step 1: Grounding (mandatory, before drafting)

This is not optional. Perform each step and capture the real
names/paths in a scratch note you'll use while drafting:

1. **Discover prior ADRs.** Read existing ADRs in `docs/adr/` to
   understand established conventions and patterns. If an `adr-index`
   MCP tool is available, use it to find ADRs by subject-area tags.
   Otherwise, list and skim the directory. Pay particular attention to
   conventions in each ADR's `establishes` frontmatter — those are in
   force (unless a later ADR's `supersedes:` includes it).

2. **Read every referenced file.** For the decision you're about to
   make, identify the 3-10 existing files/tables/contracts your ADR
   will touch or adjoin. Read them. Copy real symbol names into your
   scratch note — do not paraphrase from memory.

3. **Grep-verify every table, column, entity, and symbol name before
   it lands in the draft.** Use AST-aware symbol lookup for code
   symbols where available; fall back to `grep`. An invented name in
   the Decision section is the #1 cause of ADR rework.

4. **Identify the access/tenancy story.** Is the new entity scoped to
   a user, an org, global, or cross-tenant? Confirm it follows
   existing access patterns and doesn't accidentally bypass them.

5. **Identify every touched contract.** Internal vs external, file
   paths, permission keys. The ADR must cite the real file paths.

6. **Identify circuit breakers and cross-system coupling.** List every
   module/table/entity whose behavior will change because of this
   decision.

7. **Decide whether this ADR warrants a follow-up project.** If the
   decision produces 3+ implementable issues, file a project when the
   ADR merges. Small decisions that land in one PR don't need one.

Only after these seven steps do you touch the template.

## Step 2: Template (frozen section order)

```markdown
---
touches: [<coarse subject-area tags>]
establishes:
  - <convention-slug-this-adr-introduces>
  - <another-convention-if-any>
supersedes: []  # or [<prior-adr-filename-without-.md>] if this replaces one
---

# ADR: <Short decision title>

---

---

## 1. Context

What system state exists today, cited with real file paths + symbol
names. Who the actors/roles are. What's broken, missing, or ambiguous.
Include a "Prior art in this repo" subsection listing existing
patterns that inform or constrain the decision.

## 2. Decision

What we will do, subsectioned by concern:

  2.1 Data model (if any — new tables/columns/enums with real names)
  2.2 Resolution / runtime semantics (pure functions, state transitions)
  2.3 External API contract (paths, verbs, schemas, file locations)
  2.4 Internal API contract (same)
  2.5 UI design (surfaces, routes, key flows, broken-state treatment)
  2.6 External integration surface (third-party APIs, adapters, etc.)
  2.7 Role-based access matrix (see iron rule #3)
  2.8 Migration strategy (new table? rename? backfill? legacy handling?)

Execution planning — merge units, task sequencing, PR boundaries —
does NOT belong in an ADR. Those are implementation concerns tracked
separately. If a project exists for the decision, the project is
where sequencing lives, not here.

## 3. Consequences

### Positive
### Negative / trade-offs
### Neutral / noted

### Unspecified interactions with existing mechanisms
  (see rubric below; this subsection is mandatory if any exist)

## 4. Alternatives considered

Alt 1, Alt 2, ..., each with a one-paragraph rejection reason. Include
the genuinely-considered options; don't straw-man. If only one
alternative existed, this section is a red flag — you haven't
explored the decision space.

## 5. Decision linkages

Consumers, dependencies, blockers, future extensions, what this ADR
establishes (e.g. a new convention).

## 6. Open questions

ITERATE UNTIL EMPTY. An ADR should not merge with unresolved open
questions. Each question is either: (a) answerable now — answer it
inline and move to a "Resolved during drafting" appendix, or (b) a
blocker that requires external input — in which case the ADR is not
ready to merge. Do not use this section as a parking lot for
laziness. If you can grep the codebase or reason through the
tradeoffs to resolve a question, do it before declaring the draft
complete.

Format when all questions are resolved:
  "None. All questions resolved during drafting:"
  followed by a "### Resolved during drafting" subsection with
  numbered answers preserving the original question for traceability.

## 7. Pre-implementation codebase investigation

ITERATE UNTIL EMPTY. Same rule as S6. Every item here must be
resolved before the ADR merges — either by doing the investigation
during drafting (preferred) or by explicitly blocking the ADR on the
investigation. An ADR with unresolved S7 items is an ADR that will
produce wrong implementation work.

Format when all items are confirmed:
  "None. All items confirmed during drafting:"
  followed by a "### Resolved during drafting" subsection with
  numbered findings.

## 8. References

Every file cited, every external doc, every ticket/issue, and the
convention this ADR establishes or modifies.
```

Sections with no content in your decision: write "Not applicable" and
one sentence explaining why. Do not delete the heading.

### Frontmatter contract

The YAML frontmatter is the **only** machine-readable metadata on an
ADR. There is no prose header block — no `Date`, no `Authors`, no
status. The date is in the filename, authorship is in `git log`,
and whether an ADR is in force is determined by Git (on `main` = in
force; named in a later ADR's `supersedes:` = superseded).
Duplicating any of this in the body would create drift. The body
opens straight with the `# ADR: <title>` heading and goes to S1
Context.

The frontmatter carries only facts about the ADR's content, never
state or intent about implementation follow-through (whether a
project gets created, whether the decision has been acted on, etc. —
those are independently observable and don't belong here).

Rules:

- **`touches`** — inline list of coarse subject-area tags. Err toward
  more tags — matching is cheap, missing a cross-reference is
  expensive.
- **`establishes`** — block list of convention slugs this ADR
  introduces (kebab-case; descriptive, not clever). These are what
  future ADR authors discover when their decision is constrained by
  conventions you set.
- **`supersedes`** — list of prior ADR filenames (without `.md`) that
  this ADR replaces. Empty for most ADRs. Supersession lives in the
  superseding ADR's frontmatter, not as a flag on the superseded ADR —
  that one stays unchanged on `main` as a truthful historical record.

## Rubric: Unspecified interactions vs. Open questions vs. Pre-implementation investigation

This is the most common ADR failure. Use this table:

| Item type | Goes in | Test |
|---|---|---|
| A coupling we know exists in the codebase today that this decision changes or newly touches, but we deliberately are not specifying here | `Consequences -> Unspecified interactions with existing mechanisms` | "Implementers need to know about X coupling to avoid breaking it." |
| A design sub-decision we deferred because it isn't blocking and has multiple valid answers | `Open questions` | "A reasonable person could answer this two ways and either is defensible; we'll pick one during implementation." |
| A fact we don't know yet about the codebase that must be verified before the first PR | `Pre-implementation codebase investigation` | "The answer is knowable by grepping / reading code, not by discussion." |

If an item is really "I haven't done my homework" dressed up as an
open question, it fails this rubric. Do the homework or move it to
Pre-implementation investigation with a specific grep/read
prescribed.

## Security default-deny rule (iron rule #3, expanded)

For every capability that can:

- Write to another user's/org's data
- Stamp long-lived credentials used on outbound traffic
- Grant a partner/API-key/integration-user role any verb beyond
  `read` on its own scope

the ADR must:

1. Default to `off` (not-granted). Do not write "probably fine, worth
   confirming."
2. Specify the enablement mechanism: who grants it, where it's logged,
   and how it's revoked.
3. State the blast radius if the grant is misused (a mistaken or
   compromised principal).
4. Name the expected flow without the grant (what does the actor do
   instead?).

## Red flags — author self-check

These are common failure modes observed across ADRs. Use this list as
a self-check before you consider a draft complete.

- Any table, column, enum, or code symbol in your draft has not been
  grep-confirmed against the actual codebase.
- Your Decision section says "probably fine" about a security grant.
  Make it default-deny.
- You have zero alternatives in S4 beyond the chosen one.
- Your S7 "pre-implementation investigation" reads like "verify my
  bullets are right." Move these to grounding and do them now.
- A coupling with existing mechanisms is not mentioned. If you
  honestly looked and found none, state that.
- Your ADR introduces a new enum/channel/role/surface whose naming
  collides with an existing one.
- Your S2 Decision subsections leak into execution planning — merge
  units, PR boundaries, task sequencing. That belongs in issues, not
  in the ADR.
- Your UI section doesn't describe the broken-state case (what
  happens when a referenced entity is archived/inactive/missing).
- Your migration section doesn't describe the down() path.
- Your S6 Open questions are really S3 Unspecified interactions (they
  describe *existing* couplings, not *deferred* design decisions).
- Your S6 or S7 has unresolved items. Both sections must be iterated
  to empty before the ADR merges. If you can answer a question by
  reading code or reasoning through tradeoffs, do it now — don't
  defer to implementation what you can resolve during drafting.
- Your ADR is missing YAML frontmatter. Without frontmatter, the ADR
  is invisible to discovery and future authors will rediscover your
  lessons from scratch.
- A convention you introduce in S2 is not listed in `establishes:`
  frontmatter. Future ADRs can't find that it exists.

## Inline-vs-follow-on decision rubric

When you discover during drafting that a sub-decision is bigger than
you thought:

- **Inline it** if: the sub-decision touches <=3 files, introduces no
  new abstractions, and doesn't shift the boundary of any existing
  subsystem.
- **Follow-on ADR** if: crosses a package boundary you haven't
  mapped, introduces a new abstraction (new model pattern, new
  helper), or requires re-architecting an existing subsystem.
- **Resolve it now** if: you can answer the question by reading code
  or reasoning through tradeoffs. S6 must be empty at merge — don't
  defer what you can decide during drafting.

A follow-on ADR is cited in S5 Decision linkages as a "Blocker" or
"Future extension."

## File placement and naming

- **Location:** `docs/adr/`.
- **Filename:** `YYYY-MM-DD-<slug>.md`. ISO date (authored date),
  kebab-case slug, 3-7 words.
- **Branch name:** `docs/<slug>` or `<user>/<ticket>-<slug>` if
  tracked by an issue.

## Commit sequence

1. Verify the frontmatter block parses (no tabs, list items use
   `  - ` indent). Check that `touches` tags are meaningful and any
   new conventions are listed in `establishes`.
2. `git add docs/adr/<file>.md`
3. Commit message: `docs(adr): <title>`.
4. Push branch and open PR. Link the issue in the PR body if one
   exists.
5. If the decision warrants a follow-up project (per grounding step
   7), create the project on merge and link it from the ADR's S5
   Decision linkages in a follow-up commit.
