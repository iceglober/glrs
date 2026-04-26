#!/usr/bin/env node
/**
 * @glrs-dev/assume CLI entry — resolves the platform binary via the shim
 * and execs it with the current argv.
 */

import { spawn } from "node:child_process";
import { getBinaryPath } from "./index.js";

try {
  const binary = getBinaryPath();
  const args = process.argv.slice(2);

  const child = spawn(binary, args, {
    stdio: "inherit",
    windowsHide: false,
  });

  child.on("error", (err) => {
    console.error(`[@glrs-dev/assume] Failed to spawn binary: ${err.message}`);
    process.exit(127);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      // Forward the signal that killed the child so shell sees the right exit.
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
