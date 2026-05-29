---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): add anti-stall rules to all primary and executor agents

Adds explicit anti-stall instructions to prime, prime-ultra, plan, plan-ultra, build, and build.open prompts. The stall pattern: the model describes what it will do next ("Let me check X", "Now I'll run Y") then stops generating without making the tool call. The anti-stall rules:

- Iron-law fenced block: "NEVER STOP MID-TASK"
- Self-check instruction: verify last output completed the described action
- Common stall patterns enumerated (plan-without-execute, prose-instead-of-tool-call)
- Subagent stall detection guidance for PRIME: re-dispatch or proceed without result
- Build agents: every turn must end with a completed action or explicit STOP/DONE/BLOCKED
