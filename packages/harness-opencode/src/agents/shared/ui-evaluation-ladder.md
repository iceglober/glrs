## UI evaluation ladder

When a task requires verifying a web UI, rendered output, or visual component, use the highest available capability tier and fall through on error.

### Tier A (Playwright) — best signal

Use when Playwright MCP is available. Navigate, screenshot, evaluate DOM.

```
playwright_navigate → playwright_screenshot → playwright_evaluate
```

Treat these MCP errors as "capability absent" and fall through to Tier B:
- `Tool not found`
- `Server connection refused`
- `ECONNREFUSED` in stderr
- `MCP server not available`
- Any error containing `playwright` and `not` (e.g. "playwright is not installed")

### Tier B — curl (structural HTML)

Use when Playwright is unavailable or URL is known server-side-rendered.

```bash
curl -sL <url>
```

Parse returned HTML for element structure, text content, and reachability. Covers SSR pages well. Falls through to Tier C if curl is unavailable or returns non-200.

### Tier C — webfetch (public URLs)

Use the built-in `webfetch` tool for public URLs when curl is unavailable. Lower signal than curl for structural work but simpler. Falls through to Tier D if the URL is not public or webfetch fails.

### Tier D — source inspection (last resort)

Read the component file directly and reason about rendering. Flag in your final message:

> **Visual verification skipped** — Playwright unavailable, curl/webfetch failed or URL not public. Verified by source inspection only. Install Chromium (`npx playwright install chromium`) for full visual verification.

### Fallback order

A → B → C → D. Try the highest available tier. Fall through on capability-absent errors. Do not retry the same tier more than once.

### Reporting obligation

Your final message must state which tier was used and why:
- Tier A: "Verified via Playwright screenshot at iteration N."
- Tier B: "Verified via curl — Playwright unavailable (MCP error: …)."
- Tier C: "Verified via webfetch — curl not available."
- Tier D: "visual verification skipped — [reason]. Source inspection confirms [what you found]."
