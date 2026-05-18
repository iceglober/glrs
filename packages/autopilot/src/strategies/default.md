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

For each acceptance-criteria item in the plan:
1. Extract `id`, `intent`, `files`, `tests`, `verify` from the markdown.
2. Set `checked: false` for all items.
3. Add enrichment fields by reading the actual codebase:
   - **mirror**: Reference to a similar file in the codebase that could serve as a pattern
   - **context**: Key function signatures, 10-20 lines of code for modified files
   - **conventions**: Import style, export pattern, test framework, naming conventions
   - **proof**: Natural-language description of what the acceptance proof should assert — specific enough for a code-generation model to write the proof
   - **proof_type**: Category of verification based on the verify command pattern (e.g., "test", "api", "script", "manual")

### {{phaseFile}}
```markdown
{{content}}
```

Write the file `{{planDir}}/{{specPath}}` using the write/edit tool, then respond with "SPEC_COMPLETE" when done.
