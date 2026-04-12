import { command, subcommands, option, optional, string, number as cmdNumber } from "cmd-ts";
import { loadPlan } from "../lib/state.js";
import { startPlanReviewServer } from "../lib/plan-server.js";
import { getSetting } from "../lib/settings.js";
import { info, bold, dim } from "../lib/fmt.js";
import { exec } from "node:child_process";

const review = command({
  name: "review",
  description: "Open plan in browser for review with inline feedback",
  args: {
    id: option({ type: string, long: "id", short: "i", description: "Epic or Task ID" }),
    port: option({ type: optional(cmdNumber), long: "port", short: "p", description: "Server port (default: random)" }),
  },
  handler: async (args) => {
    const content = loadPlan(args.id);
    if (!content) {
      console.error(`No plan found for "${args.id}".`);
      process.exit(1);
    }

    const server = await startPlanReviewServer({
      planId: args.id,
      planContent: content,
      port: args.port ?? undefined,
    });

    if (getSetting("plan.auto-open") !== "false") {
      const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
      exec(`${openCmd} ${server.url}`);
    }

    info(`Plan review server running at ${bold(server.url)}`);
    console.log(dim("Press Ctrl+C to stop.\n"));
    console.log(dim(`Feedback will be saved for ${args.id}. Read it later with:`));
    console.log(dim(`  gs-agentic state plan feedback --id ${args.id}\n`));

    const shutdown = () => {
      server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep process alive
    await new Promise(() => {});
  },
});

export const plan = subcommands({
  name: "plan",
  description: "Plan viewer and feedback tools",
  cmds: { review },
});
