import http from "node:http";
import { renderStatePage } from "./state-html.js";
import {
  listEpics,
  listTasks,
  listAllRepos,
  deriveEpicPhase,
  reviewSummary,
  loadPlan,
  type Task,
  type ReviewSummaryResult,
} from "./state.js";

export interface StateServer {
  url: string;
  port: number;
  close: () => void;
}

export function startStateServer(opts?: {
  port?: number;
  all?: boolean;
}): Promise<StateServer> {
  return new Promise((resolve, reject) => {
    const port = opts?.port ?? 0;
    let cachedHtml: string | null = null;

    const server = http.createServer((req, res) => {
      try {
        if (req.method === "GET" && req.url === "/") {
          if (!cachedHtml) {
            const addr = server.address() as { port: number };
            cachedHtml = renderStatePage(addr.port, { all: opts?.all });
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(cachedHtml);
          return;
        }

        if (req.method === "GET" && (req.url === "/api/state" || req.url?.startsWith("/api/state?"))) {
          const url = new URL(req.url, `http://localhost`);
          const all = url.searchParams.get("all") === "true";
          const data = buildStatePayload({ all });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
          return;
        }

        // Match /api/plan/:id
        const planMatch = req.url?.match(/^\/api\/plan\/(.+)$/);
        if (req.method === "GET" && planMatch) {
          const id = decodeURIComponent(planMatch[1]);
          if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid plan ID");
            return;
          }
          const content = loadPlan(id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ content }));
          return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message ?? "Internal server error" }));
      }
    });

    server.on("error", reject);

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://localhost:${addr.port}`,
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}

function buildStatePayload(opts?: { all?: boolean }) {
  const epics = listEpics({ all: opts?.all });
  const allTasks = listTasks({ all: opts?.all });

  function buildEpicData(epicList: typeof epics, taskList: typeof allTasks) {
    return epicList.map((epic) => {
      const tasks = taskList.filter((t) => t.epic === epic.id);
      const derivedPhase = deriveEpicPhase(epic.id);
      const enrichedTasks = tasks.map((t) => enrichTask(t));

      const epicReview = enrichedTasks.reduce(
        (acc, t) => {
          const rs = t.reviewSummary;
          if (!rs) return acc;
          return { total: acc.total + rs.total, open: acc.open + rs.open, fixed: acc.fixed + rs.fixed };
        },
        { total: 0, open: 0, fixed: 0 },
      );

      return {
        ...epic,
        derivedPhase,
        tasks: enrichedTasks,
        reviewSummary: epicReview.total > 0 ? epicReview : undefined,
      };
    });
  }

  if (opts?.all) {
    // Group by repo
    const repos = listAllRepos();
    return {
      repos: repos.map((r) => {
        const repoEpics = epics.filter((e: any) => e.repo === r);
        const repoTasks = allTasks.filter((t: any) => t.repo === r);
        return {
          repo: r,
          epics: buildEpicData(repoEpics, repoTasks),
          standalone: repoTasks.filter((t) => !t.epic).map((t) => enrichTask(t)),
        };
      }),
    };
  }

  // Single-repo mode: flat structure (backward compat)
  return {
    epics: buildEpicData(epics, allTasks),
    standalone: allTasks.filter((t) => !t.epic).map((t) => enrichTask(t)),
  };
}

function enrichTask(task: Task) {
  const rs = reviewSummary({ taskId: task.id });

  return {
    id: task.id,
    epic: task.epic,
    title: task.title,
    description: task.description,
    phase: task.phase,
    dependencies: task.dependencies,
    branch: task.branch,
    worktree: task.worktree,
    pr: task.pr,
    plan: task.plan,
    claimedBy: task.claimedBy,
    claimedAt: task.claimedAt,
    qaResult: task.qaResult,
    reviewSummary: rs.total > 0 ? rs : undefined,
  };
}
