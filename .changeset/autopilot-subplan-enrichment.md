---
"@glrs-dev/autopilot": patch
---

fix(autopilot): enrich freeform plan files instead of skipping them

Removes the "no enrichable items" skip that silently dropped plan files without
pre-existing checkboxes or numbered headings. All plan files now go through spec
generation — the LLM decomposes freeform content into structured YAML items.
Also constrains main.md spec generation to only reference phase files that
actually exist on disk, preventing phantom phase file references that cause
validation failures.
