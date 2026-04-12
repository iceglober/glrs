import { command, subcommands, option, string, positional } from "cmd-ts";
import { getSetting, setSetting, unsetSetting, listSettings, settingsHelp } from "../lib/settings.js";
import { ok, bold, dim, yellow } from "../lib/fmt.js";

const get = command({
  name: "get",
  description: "Get a config value",
  args: {
    key: positional({ type: string, displayName: "key", description: "Setting key (e.g. plan.auto-open)" }),
  },
  handler: (args) => {
    const value = getSetting(args.key);
    if (value === undefined) {
      console.error(`Unknown setting: "${args.key}"`);
      console.error(dim("Run 'gs-agentic config list' to see available settings."));
      process.exit(1);
    }
    console.log(value);
  },
});

const set = command({
  name: "set",
  description: "Set a config value",
  args: {
    key: positional({ type: string, displayName: "key", description: "Setting key" }),
    value: positional({ type: string, displayName: "value", description: "Setting value" }),
  },
  handler: (args) => {
    setSetting(args.key, args.value);
    ok(`${bold(args.key)} = ${args.value}`);
  },
});

const unset = command({
  name: "unset",
  description: "Reset a config value to its default",
  args: {
    key: positional({ type: string, displayName: "key", description: "Setting key" }),
  },
  handler: (args) => {
    unsetSetting(args.key);
    const def = getSetting(args.key);
    ok(`${bold(args.key)} reset${def !== undefined ? ` (default: ${def})` : ""}`);
  },
});

const list = command({
  name: "list",
  description: "List all config settings",
  args: {},
  handler: () => {
    const settings = listSettings();
    const help = settingsHelp();
    const descMap = new Map(help.map(h => [h.key, h.description]));

    if (settings.length === 0) {
      console.log(dim("No settings configured."));
      return;
    }

    for (const s of settings) {
      const source = s.source === "user" ? yellow("(user)") : dim("(default)");
      const desc = descMap.get(s.key);
      console.log(`${bold(s.key)} = ${s.value} ${source}`);
      if (desc) console.log(`  ${dim(desc)}`);
    }
  },
});

export const config = subcommands({
  name: "config",
  description: "Configuration management",
  cmds: { get, set, unset, list },
});
