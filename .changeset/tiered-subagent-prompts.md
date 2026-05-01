---
"@glrs-dev/harness-plugin-opencode": minor
---

Add `mid-execute` model tier for strict-executor agents. When configured via `glrs oc install` or `models["mid-execute"]` in plugin options, `build`, `qa-reviewer`, and `pilot-builder` agents use strict-executor prompts (narrower scope, escalation-first, no self-correction). When not configured, those agents fall back to the `mid` tier model with reasoning prompts (existing behavior). Installer now asks an optional "Use a strict executor for build agents?" question after the standard deep/mid/fast picker.
