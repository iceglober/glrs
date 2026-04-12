import { command, option, optional, number as cmdNumber, flag } from "cmd-ts";
import { startStateServer } from "../../lib/state-server.js";
import { getSetting } from "../../lib/settings.js";
import { info, bold, dim } from "../../lib/fmt.js";
import { execFile } from "node:child_process";

export const web = command({
  name: "web",
  description: "Open state dashboard in browser",
  args: {
    port: option({
      type: optional(cmdNumber),
      long: "port",
      short: "p",
      description: "Server port (default: random)",
    }),
    all: flag({
      long: "all",
      short: "a",
      description: "Show all repos (not just current)",
    }),
  },
  handler: async (args) => {
    const server = await startStateServer({
      port: args.port ?? undefined,
      all: args.all,
    });

    if (getSetting("plan.auto-open") !== "false") {
      const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
      execFile(openCmd, [server.url]);
    }

    info(`State dashboard running at ${bold(server.url)}`);
    console.log(dim("Press Ctrl+C to stop.\n"));

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
