/**
 * mock-linear — fixture-backed stdio MCP server impersonating the Linear MCP.
 *
 * Why: real tracker data drifts (GEN-2849's priority and comments changed
 * UNDER a running eval session) and real mutations are incidents. The mock
 * serves frozen JSON and RECORDS attempted writes to mutations.jsonl, which
 * turns "did the agent try to write back, and what?" into an assertable
 * outcome instead of a sandbox breach.
 *
 * Registered in the eval worktree's opencode.json under server key "linear",
 * so tools surface with the exact names agents already know
 * (linear_get_issue, linear_list_comments, ...).
 *
 * Env:
 *   MOCK_LINEAR_FIXTURE_DIR — fixture linear/ dir (issues/, comments/, search-index.json)
 *   MOCK_LINEAR_STATE_DIR   — per-run dir for mutations.jsonl
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport).
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---- fixture access ----------------------------------------------------------

function fixtureDir(): string {
  const d = process.env["MOCK_LINEAR_FIXTURE_DIR"];
  if (!d) throw new Error("MOCK_LINEAR_FIXTURE_DIR not set");
  return d;
}

function readJson(p: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function getIssue(dir: string, id: string): unknown | null {
  return readJson(path.join(dir, "issues", `${id.toUpperCase()}.json`));
}

export function listComments(dir: string, issueId: string): unknown {
  return (
    readJson(path.join(dir, "comments", `${issueId.toUpperCase()}.json`)) ?? {
      comments: [],
      hasNextPage: false,
    }
  );
}

/** Substring match over search-index keys; returns issue summaries. */
export function listIssues(dir: string, query: string): unknown {
  const index =
    (readJson(path.join(dir, "search-index.json")) as Record<string, string[]> | null) ?? {};
  const q = (query ?? "").toLowerCase().trim();
  const ids = new Set<string>();
  for (const [key, hits] of Object.entries(index)) {
    if (!q || key.toLowerCase().includes(q) || q.includes(key.toLowerCase())) {
      for (const id of hits) ids.add(id);
    }
  }
  const issues = [...ids]
    .map((id) => getIssue(dir, id))
    .filter((x): x is Record<string, unknown> => !!x)
    .map((iss) => ({
      id: iss["id"],
      title: iss["title"],
      description: String(iss["description"] ?? "").slice(0, 300),
      status: iss["status"],
      statusType: iss["statusType"],
      url: iss["url"],
      gitBranchName: iss["gitBranchName"],
    }));
  return { issues, hasNextPage: false };
}

export function recordMutation(stateDir: string, tool: string, args: unknown): unknown {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(
    path.join(stateDir, "mutations.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), tool, args }) + "\n",
  );
  return { ok: true, recorded: true, note: "mutation recorded by eval mock — nothing was written to Linear" };
}

// ---- MCP plumbing --------------------------------------------------------------

const TOOLS = [
  { name: "get_issue", description: "Get a Linear issue by id", schema: { id: "Issue id, e.g. GEN-123" } },
  { name: "list_issues", description: "Search Linear issues", schema: { query: "Search query" } },
  { name: "list_comments", description: "List comments on an issue", schema: { issueId: "Issue id" } },
  { name: "list_issue_statuses", description: "List workflow statuses", schema: {} },
  { name: "save_issue", description: "Create or update an issue", schema: { id: "Issue id", title: "Title", status: "Status" } },
  { name: "save_comment", description: "Create or update a comment", schema: { issueId: "Issue id", body: "Comment body" } },
] as const;

const STATUSES = {
  statuses: [
    { id: "todo", name: "Todo", type: "unstarted" },
    { id: "in-progress", name: "In Progress", type: "started" },
    { id: "done", name: "Done", type: "completed" },
    { id: "duplicate", name: "Duplicate", type: "canceled" },
    { id: "canceled", name: "Canceled", type: "canceled" },
  ],
};

export function callTool(
  dir: string,
  stateDir: string,
  name: string,
  args: Record<string, unknown>,
): { text: string; isError?: boolean } {
  switch (name) {
    case "get_issue": {
      const issue = getIssue(dir, String(args["id"] ?? ""));
      return issue
        ? { text: JSON.stringify(issue) }
        : { text: `Issue not found: ${args["id"]}`, isError: true };
    }
    case "list_issues":
      return { text: JSON.stringify(listIssues(dir, String(args["query"] ?? ""))) };
    case "list_comments":
      return { text: JSON.stringify(listComments(dir, String(args["issueId"] ?? ""))) };
    case "list_issue_statuses":
      return { text: JSON.stringify(STATUSES) };
    case "save_issue":
    case "save_comment":
      return { text: JSON.stringify(recordMutation(stateDir, name, args)) };
    default:
      return { text: `Unknown tool: ${name}`, isError: true };
  }
}

function rpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function handleMessage(msg: {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}): string | null {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "mock-linear", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(t.schema).map(([k, desc]) => [k, { type: "string", description: desc }]),
          ),
        },
      })),
    });
  }
  if (method === "tools/call") {
    const out = callTool(
      fixtureDir(),
      process.env["MOCK_LINEAR_STATE_DIR"] ?? "/tmp/mock-linear-state",
      params?.name ?? "",
      params?.arguments ?? {},
    );
    return rpcResult(id, {
      content: [{ type: "text", text: out.text }],
      ...(out.isError ? { isError: true } : {}),
    });
  }
  if (method === "ping") return rpcResult(id, {});
  // Unknown request with an id → empty result keeps clients from hanging.
  return id !== undefined ? rpcResult(id, {}) : null;
}

// ---- entrypoint -----------------------------------------------------------------

if (import.meta.main) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const reply = handleMessage(JSON.parse(line));
        if (reply) process.stdout.write(reply + "\n");
      } catch {
        // Malformed line — ignore; the protocol recovers on the next message.
      }
    }
  });
}
