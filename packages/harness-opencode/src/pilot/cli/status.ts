/**
 * `pilot status` — show workflow status from SQLite.
 */

import { command, option, string as stringType, optional, flag } from "cmd-ts";
import { openStateDb, getWorkflow, latestWorkflow, readEvents } from "../state.js";
import { getStateDbPath } from "../paths.js";

export const statusCmd = command({
  name: "status",
  description: "Show pilot workflow status.",
  args: {
    workflow: option({
      long: "workflow",
      type: optional(stringType),
      description: "Workflow ID (defaults to the latest)",
    }),
    json: flag({
      long: "json",
      description: "Output JSON",
    }),
  },
  handler: async ({ workflow, json }) => {
    const cwd = process.cwd();

    const dbPath = await getStateDbPath(cwd);
    const { db, close } = openStateDb(dbPath);

    try {
      const wf = workflow
        ? getWorkflow(db, workflow)
        : latestWorkflow(db);

      if (!wf) {
        process.stderr.write("No workflows found. Run `pilot scope \"<goal>\"` to start one.\n");
        process.exit(1);
      }

      const events = readEvents(db, { workflowId: wf.id, limit: 100 });

      if (json) {
        process.stdout.write(JSON.stringify({ workflow: wf, events }, null, 2) + "\n");
        process.exit(0);
      }

      // Human-readable
      const started = new Date(wf.started_at).toLocaleString();
      const finished = wf.finished_at ? new Date(wf.finished_at).toLocaleString() : "--";
      const statusColor = wf.status === "completed" ? "\x1b[32m" : wf.status === "failed" ? "\x1b[31m" : "\x1b[33m";

      console.log(`\nWorkflow ${wf.id}`);
      console.log(`  Goal:    ${wf.goal}`);
      console.log(`  Status:  ${statusColor}${wf.status}\x1b[0m`);
      console.log(`  Started: ${started}`);
      console.log(`  Ended:   ${finished}`);
      console.log(`\nRecent events (${events.length}):`);

      for (const event of events.slice(-20)) {
        const ts = new Date(event.ts).toLocaleTimeString();
        const payload = (() => {
          try {
            const p = JSON.parse(event.payload);
            return Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
          } catch {
            return event.payload;
          }
        })();
        console.log(`  ${ts} [${event.phase}] ${event.kind} ${payload}`);
      }
      console.log();

      process.exit(0);
    } finally {
      close();
    }
  },
});
