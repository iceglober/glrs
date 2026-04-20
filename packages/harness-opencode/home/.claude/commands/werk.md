---
description: Wrap your prompt with instructions to manage todos in .werk/
---

# Werk Task Management

You are managing work tasks tracked in `.werk/todos.txt`. Before and after responding to the user's request, you must read and update this file.

## Instructions

1. **Read current state**: First, read `.werk/todos.txt` to understand current work contexts and tasks
2. **Process the user's request**: Execute what the user asked for (shown below in the prompt section)
3. **Update todos.txt**: After completing work or receiving new information, update the file to reflect:
   - New tasks discovered
   - Tasks completed (check the checkbox)
   - Context updates or clarifications
   - Reordering if priorities changed

## Plan Mode Behavior

If you are in **Plan Mode**, do NOT directly update `.werk/todos.txt`. Instead:
- Include the todos.txt updates as part of your plan
- Specify which tasks will be added, completed, or modified
- The actual file update should happen when the plan is executed

## File Format for `.werk/todos.txt`

```
# Work Contexts

## project-name-1
Brief description of what this project/feature is about. Include enough context
that future sessions can understand the goal without additional explanation.

## project-name-2
Another project context with its description.

---

# Tasks

## project-name-1

- [ ] First task - commit-sized, actionable work item
- [ ] Second task - another discrete piece of work
- [x] Completed task - checked when done

## project-name-2

- [ ] Task for second project
- [ ] Another task

---

# Notes

Any additional notes, blockers, or context that doesn't fit above.
Last updated: YYYY-MM-DD
```

## Formatting Rules

1. **Work Contexts**: Each context should have a kebab-case identifier and a plain-English description explaining the project's purpose, goal, or scope
2. **Tasks**:
   - Must be commit-sized (completable in a single focused effort)
   - Use `- [ ]` for incomplete, `- [x]` for complete
   - Order by priority/dependency (do first tasks at top)
   - Group under their related work context
3. **Checkboxes**: Mark `[x]` immediately when a task is done
4. **Adding tasks**: When the user mentions new work, add it as tasks under the appropriate context (create a new context if needed)
5. **Notes section**: Use for blockers, decisions, or context that spans multiple tasks

## Behavior

- If `.werk/todos.txt` doesn't exist, create it with the user's first request as context
- Always preserve existing completed tasks (don't delete history)
- When a task is completed, check it off but keep it in the file
- If all tasks in a context are done, you may archive them to a `# Completed` section
- Update "Last updated" timestamp when modifying the file

---

# User's Request

$ARGUMENTS
