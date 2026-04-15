import { execFile as nodeExecFile } from "node:child_process";
import { getSetting } from "./settings.js";
import { dim, warn } from "./fmt.js";

/**
 * Open a URL in the default browser.
 * Returns true if the open command was attempted, false if skipped due to setting.
 */
export function openBrowser(
  url: string,
  settingKey: string,
  opts?: {
    platform?: string;
    exec?: typeof nodeExecFile;
  },
): boolean {
  if (getSetting(settingKey) === "false") {
    console.log(dim(`Browser auto-open disabled. To enable: gsag config set ${settingKey} true`));
    return false;
  }

  const platform = opts?.platform ?? process.platform;
  const exec = opts?.exec ?? nodeExecFile;
  const openCmd = platform === "darwin" ? "open" : "xdg-open";

  exec(openCmd, [url], (err) => {
    if (err) warn(`Could not open browser automatically. Visit: ${url}`);
  });

  return true;
}
