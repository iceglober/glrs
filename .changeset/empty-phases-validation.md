---
"@glrs-dev/autopilot": patch
---

fix(autopilot): detect empty phases when plan directory has phase markdown files

Adds `empty-phases-with-plan-files` validation error when spec/main.yaml has 0 phases but the plan directory contains phase markdown files. The repair prompt now includes the plan's markdown file list so the LLM can generate the missing phase references and spec files.
