import { command, subcommands } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import { generatePluginManifest } from "../lib/plugin.js";
import { gitRoot } from "../lib/git.js";
import { ok, warn } from "../lib/fmt.js";

const generate = command({
  name: "generate",
  description: "Generate .claude-plugin/plugin.json in the current repo",
  args: {},
  handler: async () => {
    let root: string;
    try {
      root = gitRoot();
    } catch {
      console.error("Not in a git repository");
      process.exit(1);
    }

    const pluginDir = path.join(root, ".claude-plugin");
    const manifestPath = path.join(pluginDir, "plugin.json");

    if (fs.existsSync(manifestPath)) {
      warn("plugin.json already exists — overwriting");
    }

    fs.mkdirSync(pluginDir, { recursive: true });
    const manifest = generatePluginManifest();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    ok(`wrote ${path.relative(root, manifestPath)}`);
  },
});

export const plugin = subcommands({
  name: "plugin",
  cmds: { generate },
});
