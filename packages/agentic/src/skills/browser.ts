export function browser(): string {
  return `---
description: Browse the web, interact with pages, fill forms, and extract data using a real browser via Playwright CLI. Use when user says 'open this page', 'browse to', 'fill out the form', 'scrape this site', 'take a screenshot', 'test this URL', 'check this website'. Do NOT use for web research across multiple sources (use /research-web instead).
---

# /browser — Browser Automation via Playwright CLI

Control a real browser to navigate pages, interact with elements, fill forms, extract data, and test websites using the \\\`playwright-cli\\\` command-line tool.

## Critical Rules

- **Install before first use** — run \\\`npm install -g @playwright/cli@latest\\\` if not already installed.
- **Use snapshots to find element refs** — never guess refs, always snapshot first.
- **One action at a time** — wait for each command to complete before the next.
- **Close sessions when done** — don't leave browsers hanging.

## Setup

Before using browser commands, check if Playwright CLI is installed:

\\\`\\\`\\\`bash
playwright-cli --version
\\\`\\\`\\\`

If not found, install it:

\\\`\\\`\\\`bash
npm install -g @playwright/cli@latest
\\\`\\\`\\\`

## Commands

All commands are run via Bash. The CLI manages browser sessions automatically.

### Navigation
\\\`\\\`\\\`bash
playwright-cli open <url>              # Open a URL
playwright-cli back                     # Go back
playwright-cli forward                  # Go forward
playwright-cli wait                     # Wait for page to settle
\\\`\\\`\\\`

### Reading the page
\\\`\\\`\\\`bash
playwright-cli snapshot                 # Get accessibility snapshot with element refs
playwright-cli screenshot               # Capture a screenshot
playwright-cli screenshot --full        # Full-page screenshot
\\\`\\\`\\\`

### Interaction
\\\`\\\`\\\`bash
playwright-cli click <ref>             # Click an element by ref from snapshot
playwright-cli type "text"              # Type text into focused field
playwright-cli select <ref> "value"     # Select from dropdown
playwright-cli press Enter              # Press a key
playwright-cli drag <from-ref> <to-ref> # Drag between elements
\\\`\\\`\\\`

### Sessions
\\\`\\\`\\\`bash
playwright-cli sessions                 # List open sessions
playwright-cli close                    # Close current session
\\\`\\\`\\\`

## Workflow

1. **Open** the target URL
2. **Snapshot** to see element refs
3. **Click/type** using refs from the snapshot
4. **Snapshot** again to verify the result
5. **Close** when done

### Example: fill out a form

\\\`\\\`\\\`bash
playwright-cli open "https://example.com/signup"
playwright-cli snapshot                  # find the form field refs
playwright-cli click e12                 # click "Name" field (ref from snapshot)
playwright-cli type "Jane Doe"
playwright-cli press Tab
playwright-cli type "jane@example.com"
playwright-cli click e18                 # click "Submit" button
playwright-cli snapshot                  # verify success message
playwright-cli close
\\\`\\\`\\\`

### Example: take a screenshot for a PR

\\\`\\\`\\\`bash
playwright-cli open "http://localhost:3000/dashboard"
playwright-cli wait
playwright-cli screenshot --full
playwright-cli close
\\\`\\\`\\\`

## Troubleshooting

**"command not found: playwright-cli"**
\\\`\\\`\\\`bash
npm install -g @playwright/cli@latest
\\\`\\\`\\\`

**Page not loading / timeout:**
Use \\\`playwright-cli wait\\\` after opening — SPAs need time to render.

**Can't find an element:**
Take a fresh \\\`playwright-cli snapshot\\\` — the page state may have changed. Always use refs from the latest snapshot.

**Headless environment (CI, SSH):**
The CLI runs headed by default. Pass \\\`--headless\\\` to \\\`open\\\`:
\\\`\\\`\\\`bash
playwright-cli open --headless "https://example.com"
\\\`\\\`\\\`
`;
}
