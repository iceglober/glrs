---
"@glrs-dev/harness-plugin-opencode": minor
---

Add `@plan-ultra-cheap` agent — preserves PRIME-ULTRA's wave-based DAG dispatch when cascading to the cheap tier. Same DAG-writing prompt as `@plan-ultra`, runs on `amazon-bedrock/zai.glm-5`. PRIME-ULTRA's cascading table now points to `@plan-ultra-cheap` instead of `@plan-cheap` so the cheap-tier plan still includes `## Execution DAG`. `@plan-cheap` remains for standard PRIME, which doesn't need DAG output.
