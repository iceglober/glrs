import { SessionManager } from "../session-manager.js";
import { getConfiguredRepos } from "../repo-config.js";
import { startDashboard } from "../tui/index.js";

export async function runDashboard(): Promise<void> {
  const repos = getConfiguredRepos();
  const dirs = repos.map((r) => r.path);

  // Add current directory if not already included
  const cwd = process.cwd();
  if (!dirs.includes(cwd)) {
    dirs.unshift(cwd);
  }

  const manager = new SessionManager(dirs);

  // Non-TTY fallback
  if (!process.stderr.isTTY) {
    manager.start();
    const sessions = manager.getSessions();
    manager.stop();

    if (sessions.length === 0) {
      process.stderr.write("No active autopilot sessions.\n");
      return;
    }

    for (const s of sessions) {
      const repo = s.cwd.split("/").pop() || s.cwd;
      process.stderr.write(
        `${s.status.toUpperCase().padEnd(10)} ${repo} — $${s.cost.toFixed(2)} — ${s.totalIterations} iterations\n`,
      );
    }
    return;
  }

  await startDashboard(manager);
}
