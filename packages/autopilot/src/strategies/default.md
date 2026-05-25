You are generating a YAML spec file from a markdown plan phase, enriched with codebase context.

Read the markdown plan content below and write `{{specPath}}` (relative to the plan directory: {{planDir}}) using the write/edit tool.

The output file should follow this schema:

```yaml
# spec/{{specFileName}}
items:
  - id: "0.1"
    intent: "What this item does"
    checked: false
    files:
      - path: src/foo.ts
        isNew: false
        change: "What changes"
    tests:
      - "test/foo.test.ts"
    verify: "bun test test/foo.test.ts"
    mirror: "src/similar-file.ts"
    context: |
      // relevant code from the file being modified
    conventions: "ESM imports, named exports, bun:test"
    proof: "The acceptance proof should verify that the new function accepts valid inputs and rejects invalid ones"
    proof_type: "test"
```

## Process

The input markdown may be structured (numbered headings like `### N.M` or checkboxes) or freeform prose. Handle both:

- **Structured input**: Extract each existing item's `id`, `intent`, `files`, `tests`, `verify` from the markdown.
- **Freeform input**: Decompose the prose into concrete, actionable items. Each item should modify 1–3 files. Assign sequential ids (e.g., `0.1`, `0.2`, …). Infer `intent`, `files`, `tests`, and `verify` from the content and your codebase exploration.

For every item (extracted or decomposed):
1. Set `checked: false`.
2. Add enrichment fields. For each item, read the files it references to gather real codebase context. **Warning: file paths in the plan may be outdated (files moved or renamed). Always verify a path exists before using it. If a path doesn't exist, search for the file by name using `find` or `ls` to locate the current path.**
   - **mirror**: Path to an existing file that follows the same pattern this item will follow. **Do not copy paths verbatim from the plan — verify each mirror path exists by reading or listing it.** Prefer files you've already opened for other items.
   - **context**: 10–20 lines of the most relevant code from the files being modified: function signatures, type definitions, or the section being changed.
   - **conventions**: Patterns observed in the files you read: import style, export pattern, test framework, naming conventions.
   - **proof**: What the acceptance proof should assert — specific enough for a model to write the proof without reading the plan.
   - **proof_type**: One of: `test`, `type-check`, `script`, `manual`.

### {{phaseFile}}
```markdown
{{content}}
```

Write the file `{{planDir}}/{{specPath}}` using the write/edit tool, then respond with "SPEC_COMPLETE" when done.
