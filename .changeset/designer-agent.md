---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): add @designer agent + ux-for-ai skill

New `@designer` subagent for UI/UX design work. PRIME dispatches it for building interfaces, auditing designs, choosing typography/color/layout, or diagnosing UX issues. Loads both `design-for-ai` and `ux-for-ai` skills for principle-driven design grounded in Kadavy, Tufte, Refactoring UI, Every Layout, and Norman. Runs on Sonnet tier with BUILD_PERMISSIONS.

Also bundles the `ux-for-ai` skill (Norman's Design of Everyday Things + Emotional Design) with 8 chapter reference files covering the two gulfs, discoverability, feedback, mental models, constraints, and the visceral/behavioral/reflective joy layers.
