import { command, subcommands, option, optional, string, number as cmdNumber } from "cmd-ts";
import { loadPlan, listPlanVersions } from "../lib/state.js";
import { startReviewServer, findRunningServer, registerPlan, waitForFinish, type ReviewServer } from "../lib/review-server.js";
import { openBrowser } from "../lib/open-browser.js";
import { info, ok, warn, bold, dim } from "../lib/fmt.js";

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

    const versions = listPlanVersions(args.id);
    const version = versions.length > 0 ? versions[versions.length - 1] : undefined;

    const existing = await findRunningServer();
    let serverUrl: string;
    let server: ReviewServer | null = null;

    if (existing) {
      serverUrl = existing.url;
      await registerPlan(serverUrl, args.id, content, { version });
      info(`Plan added to existing review session at ${bold(serverUrl)}`);
    } else {
      server = await startReviewServer({ port: args.port ?? undefined });
      serverUrl = server.url;
      await registerPlan(serverUrl, args.id, content, { version });
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

    try {
      const result = await waitForFinish(serverUrl, args.id);
      if (result.outcome === "changes-requested") {
        warn(`Changes requested — feedback saved for ${args.id}`);
      } else {
        ok(`Plan approved — ${args.id}`);
      }
    } catch {
      warn("Review server disconnected — check if feedback was saved");
    }
    server?.close();
    process.exit(0);
  },
});

export const plan = subcommands({
  name: "plan",
  description: "Plan viewer and feedback tools",
  cmds: { review },
});
