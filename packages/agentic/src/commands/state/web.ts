import { command, option, optional, number as cmdNumber, flag } from "cmd-ts";
import { startStateServer } from "../../lib/state-server.js";
import { listAllRepos } from "../../lib/state.js";
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
    local: flag({
      long: "local",
      description: "Force single-repo mode (override auto-detection)",
    }),
  },
  handler: async (args) => {
    // Auto-detect multi-repo: default to --all when multiple repos exist
    const repos = listAllRepos();
    const effectiveAll = args.local ? false : (args.all || repos.length > 1);

    const server = await startStateServer({
      port: args.port ?? undefined,
      all: effectiveAll,
    });

    if (getSetting("state.auto-open") !== "false") {
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
