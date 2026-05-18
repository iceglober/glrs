import React from "react";
import { render } from "ink";
import { Dashboard } from "./components/Dashboard.js";
import type { SessionManager } from "../session-manager.js";

export async function startDashboard(manager: SessionManager): Promise<void> {
  manager.start();

  const app = render(
    React.createElement(Dashboard, { manager }),
    { stdout: process.stderr, exitOnCtrlC: false },
  );

  await app.waitUntilExit();
  manager.stop();
}
