---
"@glrs-dev/harness-plugin-opencode": minor
---

Add `glrs oc loop` as the canonical name for the Ralph-loop CLI runner (previously `glrs oc autopilot`). `autopilot` continues to work as an alias during this release cycle — no user scripts break.

A future release will diverge the two: `loop` stays as the raw-prompt Ralph-loop runner, and `autopilot` becomes an interactive scoping walkthrough that generates a structured multi-file plan and then invokes `loop` against it. This change (PR 2 of 3) lays the CLI plumbing for that split; PR 3 ships the interactive walkthrough and the structured plan format.

No behavior change in this release — both `glrs oc loop "<prompt>"` and `glrs oc autopilot "<prompt>"` do exactly what `autopilot` did before.
