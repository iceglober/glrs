import { command, subcommands, option, optional, string, number as cmdNumber } from "cmd-ts";
import { loadPlan } from "../lib/state.js";
import { startReviewServer, findRunningServer, registerPlan, waitForFinish, type ReviewServer } from "../lib/review-server.js";
import { openBrowser } from "../lib/open-browser.js";
import { info, ok, bold, dim } from "../lib/fmt.js";

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

    const existing = await findRunningServer();
    let serverUrl: string;
    let server: ReviewServer | null = null;

    if (existing) {
      serverUrl = existing.url;
      await registerPlan(serverUrl, args.id, content);
      openBrowser(serverUrl, "plan.auto-open");
      info(`Plan added to existing review session at ${bold(serverUrl)}`);
    } else {
      server = await startReviewServer({ port: args.port ?? undefined });
      serverUrl = server.url;
      await registerPlan(serverUrl, args.id, content);
      openBrowser(serverUrl, "plan.auto-open");
      info(`Plan review server running at ${bold(serverUrl)}`);
    }

    console.log(dim(`Feedback will be saved for ${args.id}. Read it later with:`));
    console.log(dim(`  gs-agentic state plan feedback --id ${args.id}\n`));

    const shutdown = () => {
      server?.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await waitForFinish(serverUrl, args.id);
    ok(`Review complete — feedback saved for ${args.id}`);
    server?.close();
    process.exit(0);
  },
});

export const plan = subcommands({
  name: "plan",
  description: "Plan viewer and feedback tools",
  cmds: { review },
});
