You are generating a YAML spec file from a markdown plan phase, enriched with codebase context.

Read the markdown plan content below and write `${specPath}` (relative to the plan directory: ${planDir}) using the write/edit tool.

The output file should follow this schema:

${schemaExample}

For each acceptance-criteria item in the plan:
1. Extract `id`, `intent`, `files`, `tests`, `verify` from the markdown.
2. Set `checked: false` for all items.
3. Add enrichment fields by reading the actual codebase:
   - **mirror**: Find the most similar existing file in the codebase and set `mirror: <path>`. This is the pattern-match target the executor will follow.
   - **context**: For each file being MODIFIED (not NEW), read the relevant function/section and add 10-20 lines of the current code. For NEW files, add the key function signatures the file should export.
   - **conventions**: List project-specific patterns: import style (named vs default), export pattern, test framework (vitest/jest/bun:test), naming conventions, error handling pattern.

Rules:
- Read actual files from the codebase to get accurate code pointers. Do not hallucinate file contents.
- Be concise — 10-20 lines of context per file, not the whole file.
- Only add enrichment fields you can verify from the codebase.

Here is the plan file to convert:

### {{file}}
```markdown
{{content}}
```

Write the file `${planDir}/${specPath}` using the write/edit tool, then respond with "SPEC_COMPLETE" when done.
