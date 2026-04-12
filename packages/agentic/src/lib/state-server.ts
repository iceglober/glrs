import http from "node:http";
import { renderStatePage } from "./state-html.js";
import {
  listEpics,
  listTasks,
  listSteps,
  deriveEpicPhase,
  reviewSummary,
  loadPlan,
  type Task,
} from "./state.js";

export interface StateServer {
  url: string;
  port: number;
  close: () => void;
}

export function startStateServer(opts?: {
  port?: number;
}): Promise<StateServer> {
  return new Promise((resolve, reject) => {
    const port = opts?.port ?? 0;
    let cachedHtml: string | null = null;

    const server = http.createServer((req, res) => {
      // CORS for local dev
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (req.method === "GET" && req.url === "/") {
        if (!cachedHtml) {
          const addr = server.address() as { port: number };
          cachedHtml = renderStatePage(addr.port);
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(cachedHtml);
        return;
      }

      if (req.method === "GET" && req.url === "/api/state") {
        const data = buildStatePayload();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
        return;
      }

      // Match /api/plan/:id
      const planMatch = req.url?.match(/^\/api\/plan\/(.+)$/);
      if (req.method === "GET" && planMatch) {
        const id = decodeURIComponent(planMatch[1]);
        const content = loadPlan(id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content }));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
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

function buildStatePayload() {
  const epics = listEpics();
  const allTasks = listTasks();

  const epicData = epics.map((epic) => {
    const tasks = allTasks.filter((t) => t.epic === epic.id);
    const derivedPhase = deriveEpicPhase(epic.id);

    return {
      ...epic,
      derivedPhase,
      tasks: tasks.map((t) => enrichTask(t)),
    };
  });

  const standalone = allTasks
    .filter((t) => !t.epic)
    .map((t) => enrichTask(t));

  return { epics: epicData, standalone };
}

function enrichTask(task: Task) {
  const rs = reviewSummary({ taskId: task.id });
  const steps = listSteps({ task: task.id });

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
    steps: steps.length > 0 ? steps : undefined,
  };
}
