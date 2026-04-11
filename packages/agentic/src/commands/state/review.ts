import { command, subcommands, option, flag, optional, string } from "cmd-ts";
import {
  createReview,
  addReviewItem,
  resolveReviewItem,
  listReviewItems,
  reviewSummary,
} from "../../lib/state.js";
import { ok, bold, dim, red, yellow, green, cyan } from "../../lib/fmt.js";

// ── gsag state review create ────────────────────────────────────────────────

const create = command({
  name: "create",
  description: "Create a new review",
  args: {
    task: option({ type: optional(string), long: "task", description: "Task ID" }),
    epic: option({ type: optional(string), long: "epic", description: "Epic ID" }),
    source: option({ type: string, long: "source", description: "Review source (deep_review, quick_review, pr_comment, pr_review)" }),
    commitSha: option({ type: string, long: "commit-sha", description: "Commit SHA this review is against" }),
    prNumber: option({ type: optional(string), long: "pr-number", description: "PR number" }),
    summary: option({ type: optional(string), long: "summary", description: "Review summary" }),
  },
  handler: (args) => {
    const review = createReview({
      taskId: args.task ?? undefined,
      epicId: args.epic ?? undefined,
      source: args.source,
      commitSha: args.commitSha,
      prNumber: args.prNumber ? parseInt(args.prNumber, 10) : undefined,
      summary: args.summary ?? undefined,
    });
    ok(`created review ${bold(review.id)}`);
    console.log(review.id);
  },
});

// ── gsag state review add-item ──────────────────────────────────────────────

const addItem = command({
  name: "add-item",
  description: "Add an item to a review",
  args: {
    review: option({ type: string, long: "review", description: "Review ID" }),
    body: option({ type: string, long: "body", description: "Finding description" }),
    severity: option({ type: optional(string), long: "severity", description: "Severity (CRITICAL, HIGH, MEDIUM, LOW, NITPICK)" }),
    agents: option({ type: optional(string), long: "agents", description: "Comma-separated agent names" }),
    file: option({ type: optional(string), long: "file", description: "File path" }),
    line: option({ type: optional(string), long: "line", description: "Line number or range (e.g., 42 or 42-45)" }),
    impact: option({ type: optional(string), long: "impact", description: "Impact description" }),
    suggestedFix: option({ type: optional(string), long: "suggested-fix", description: "Suggested fix" }),
    prCommentId: option({ type: optional(string), long: "pr-comment-id", description: "GitHub PR comment ID" }),
  },
  handler: (args) => {
    let lineStart: number | undefined;
    let lineEnd: number | undefined;
    if (args.line) {
      const parts = args.line.split("-");
      lineStart = parseInt(parts[0], 10);
      lineEnd = parts.length > 1 ? parseInt(parts[1], 10) : lineStart;
    }

    const item = addReviewItem({
      reviewId: args.review,
      body: args.body,
      severity: args.severity ?? undefined,
      agents: args.agents?.split(",").map((s) => s.trim()),
      filePath: args.file ?? undefined,
      lineStart,
      lineEnd,
      impact: args.impact ?? undefined,
      suggestedFix: args.suggestedFix ?? undefined,
      prCommentId: args.prCommentId ? parseInt(args.prCommentId, 10) : undefined,
    });
    ok(`added item ${bold(item.id)} to review ${args.review}`);
    console.log(item.id);
  },
});

// ── gsag state review resolve ───────────────────────────────────────────────

const resolve = command({
  name: "resolve",
  description: "Resolve a review item",
  args: {
    item: option({ type: string, long: "item", description: "Review item ID" }),
    status: option({ type: string, long: "status", description: "Resolution status (fixed, pushed_back, wont_fix, acknowledged)" }),
    resolution: option({ type: string, long: "resolution", description: "Resolution description" }),
    commitSha: option({ type: optional(string), long: "commit-sha", description: "Fix commit SHA" }),
  },
  handler: (args) => {
    const item = resolveReviewItem(args.item, {
      status: args.status,
      resolution: args.resolution,
      commitSha: args.commitSha ?? undefined,
    });
    ok(`resolved ${bold(item.id)} → ${item.status}`);
  },
});

// ── gsag state review list ──────────────────────────────────────────────────

const list = command({
  name: "list",
  description: "List review items",
  args: {
    task: option({ type: optional(string), long: "task", description: "Filter by task ID" }),
    status: option({ type: optional(string), long: "status", description: "Filter by status" }),
    severity: option({ type: optional(string), long: "severity", description: "Filter by severity" }),
    json: flag({ long: "json", description: "Output as JSON" }),
    summary: flag({ long: "summary", description: "Return only id, severity, status, filePath (compact)" }),
  },
  handler: (args) => {
    const items = listReviewItems({
      taskId: args.task ?? undefined,
      status: args.status ?? undefined,
      severity: args.severity ?? undefined,
    });

    if (args.json && args.summary) {
      const compact = items.map((i) => ({ id: i.id, severity: i.severity, status: i.status, filePath: i.filePath, lineStart: i.lineStart }));
      console.log(JSON.stringify(compact));
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(items));
      return;
    }

    if (items.length === 0) {
      console.log(dim("No review items found."));
      return;
    }

    for (const item of items) {
      const sevColor = {
        CRITICAL: red,
        HIGH: (s: string) => `\x1b[31m${s}\x1b[0m`,
        MEDIUM: yellow,
        LOW: cyan,
        NITPICK: dim,
      }[item.severity ?? ""] ?? dim;

      const statusIcon = item.status === "open" ? "●" : item.status === "fixed" ? "✓" : "○";
      console.log(`  ${statusIcon} ${bold(item.id)} [${sevColor(item.severity ?? "?")}] ${item.body.slice(0, 80)}`);
      if (item.filePath) console.log(`    ${dim(`${item.filePath}:${item.lineStart ?? "?"}`)}`);
      if (item.resolution) console.log(`    ${dim(`→ ${item.resolution}`)}`);
    }
  },
});

// ── gsag state review summary ───────────────────────────────────────────────

const summary = command({
  name: "summary",
  description: "Show review summary for a task",
  args: {
    task: option({ type: optional(string), long: "task", description: "Task ID" }),
    json: flag({ long: "json", description: "Output as JSON" }),
  },
  handler: (args) => {
    const result = reviewSummary({ taskId: args.task ?? undefined });

    if (args.json) {
      console.log(JSON.stringify(result));
      return;
    }

    if (result.total === 0) {
      console.log(dim("No review items."));
      return;
    }

    console.log(bold(`Review Summary${args.task ? ` for ${args.task}` : ""}`));
    console.log("─".repeat(30));

    for (const [sev, counts] of Object.entries(result.bySeverity)) {
      const parts: string[] = [];
      if (counts.open) parts.push(`${counts.open} open`);
      if (counts.fixed) parts.push(`${counts.fixed} fixed`);
      if (counts.pushed_back) parts.push(`${counts.pushed_back} pushed_back`);
      if (counts.wont_fix) parts.push(`${counts.wont_fix} wont_fix`);
      if (counts.acknowledged) parts.push(`${counts.acknowledged} acknowledged`);
      console.log(`  ${sev}: ${parts.join(", ")}`);
    }

    console.log("");
    console.log(`Total: ${result.total} | Open: ${result.open} | Fixed: ${result.fixed} | Pushed back: ${result.pushedBack}`);

    if (result.open > 0) {
      const openItems = listReviewItems({ taskId: args.task ?? undefined, status: "open", severity: "CRITICAL" });
      const highOpen = listReviewItems({ taskId: args.task ?? undefined, status: "open", severity: "HIGH" });
      const blocking = [...openItems, ...highOpen];
      if (blocking.length > 0) {
        console.log("");
        console.log(bold("Unresolved (blocking):"));
        for (const item of blocking) {
          console.log(`  ${bold(item.id)} [${item.severity}] ${item.body.slice(0, 60)}`);
        }
      }
    }
  },
});

// ── Export subcommands ───────────────────────────────────────────────

export const stateReview = subcommands({
  name: "review",
  description: "Review management",
  cmds: {
    create,
    "add-item": addItem,
    resolve,
    list,
    summary,
  },
});
