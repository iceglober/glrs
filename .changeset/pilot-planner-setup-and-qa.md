---
"@glrs-dev/harness-plugin-opencode": minor
---

The pilot-planner agent now detects package managers, docker-compose services, migration tooling, and UI/API/DB test frameworks during planning, and proposes a top-level `setup:` block + per-surface `verify:` patterns for user confirmation before writing the YAML. Two new rule files (`setup-authoring.md`, `qa-expectations.md`) back the new behaviour.
