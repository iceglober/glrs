import { execaSync, execa } from "execa";

/** Find the system-installed Claude Code CLI path. */
function findClaudeCli(): string {
  try {
    const p = execaSync("which", ["claude"]).stdout.trim();
    if (p) return p;
  } catch {}
  throw new Error("Claude CLI not found. Install it from https://claude.ai/download");
}

export interface RunSessionOpts {
  /** Working directory for the session */
  cwd: string;
  /** Prompt to send (e.g., `/spec-make <args>`) */
  prompt: string;
}

/** Sentinel error thrown when user ctrl+c's a session. */
export class SessionInterrupted extends Error {
  constructor() {
    super("Session interrupted by user.");
    this.name = "SessionInterrupted";
  }
}

/**
 * Spawn a Claude Code session as a subprocess.
 *
 * Runs in print mode (-p) with dangerously-skip-permissions since sessions
 * operate in isolated worktrees. Stdout is inherited so the user sees
 * Claude's output. Stderr is piped so we can suppress it on interrupt.
 *
 * Returns the exit code. Throws SessionInterrupted on SIGINT.
 */
export async function runSession(opts: RunSessionOpts): Promise<number> {
  const claude = findClaudeCli();

  return new Promise<number>((resolve, reject) => {
    const subprocess = execa(claude, [
      "-p",
      "--dangerously-skip-permissions",
    ], {
      cwd: opts.cwd,
      stdin: "pipe",
      stdout: "inherit",
      stderr: "pipe",
      reject: false,
    });

    // Pass prompt via stdin (avoids --allowedTools eating the positional arg)
    subprocess.stdin?.write(opts.prompt);
    subprocess.stdin?.end();

    let interrupted = false;

    subprocess.stderr?.on("data", (chunk: Buffer) => {
      if (!interrupted) {
        process.stderr.write(chunk);
      }
    });

    const sigHandler = () => {
      if (interrupted) {
        subprocess.kill("SIGKILL");
        return;
      }
      interrupted = true;
      subprocess.kill("SIGINT");
      setTimeout(() => {
        if (!subprocess.killed) subprocess.kill("SIGINT");
      }, 100);
    };
    process.on("SIGINT", sigHandler);

    subprocess.on("close", (code, signal) => {
      process.off("SIGINT", sigHandler);

      if (interrupted || signal === "SIGINT" || signal === "SIGTERM" || code === 130) {
        reject(new SessionInterrupted());
        return;
      }

      resolve(code ?? 1);
    });

    subprocess.on("error", (err) => {
      process.off("SIGINT", sigHandler);
      resolve(1);
    });
  });
}
