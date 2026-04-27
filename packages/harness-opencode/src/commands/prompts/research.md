---
description: Deep codebase exploration via parallel subagents.
---

# /research — Research Command

**Research Topic:** $ARGUMENTS

## Behavior

This command is a **thin delegator** to the `@research` agent.

1. If no topic is provided, ask the user what they want to research.
2. Otherwise, invoke the `@research` agent via the task tool with the user's topic.

The `@research` agent handles all planning, parallel dispatch, gap review, iteration, and synthesis. Do NOT orchestrate research inline here.

## Delegation Template

```
Task tool → @research agent:
"Research query: {user's topic}

Context: Invoked via /research command."
```

Wait for `@research` to complete and return its findings to the user.
