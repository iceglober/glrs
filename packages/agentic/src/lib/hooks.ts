import { execaSync } from "execa";
import fs from "node:fs";
import path from "node:path";
import { info, warn } from "./fmt.js";

// ── Claude Code hook config generation ──────────────────────────────

export interface ClaudeHookEntry {
  matcher: string;
  hooks: Array<{ type: "command"; command: string }>;
}

export interface ClaudeHookConfig {
  hooks: {
    PreToolUse?: ClaudeHookEntry[];
    PostToolUse?: ClaudeHookEntry[];
  };
}

/**
 * Generate a PostToolUse hook config that runs a formatter after Write/Edit.
 * The formatter command is run in the project root.
 *
 * SECURITY: The formatter string is written directly to settings.local.json
 * and will be executed by Claude Code on every file write. Only pass trusted
 * values — use detectFormatter() to get safe, hardcoded commands.
 */
export function generateFormatterHook(formatter: string): ClaudeHookConfig {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [{ type: "command", command: formatter }],
        },
      ],
    },
  };
}

/**
 * Generate a PreToolUse hook config that warns on dangerous Bash patterns.
 * Checks for: rm -rf, git push --force, git reset --hard, git checkout -- .
 */
export function generateSafetyHook(): ClaudeHookConfig {
  const script = [
    'CMD="$TOOL_INPUT"',
    'case "$CMD" in',
    '  *"rm -rf"*|*"git push --force"*|*"git push -f"*|*"git reset --hard"*|*"git checkout -- ."*|*"git clean -f"*)',
    '    echo "WARN: Potentially dangerous command detected. Please confirm." >&2',
    "    ;;",
    "esac",
  ].join("\n");

  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `bash -c '${script.replace(/'/g, "'\\''")}'` }],
        },
      ],
    },
  };
}

/**
 * Merge multiple Claude Code hook configs into one.
 * Concatenates hook arrays for each lifecycle event.
 */
export function mergeHookConfigs(...configs: ClaudeHookConfig[]): ClaudeHookConfig {
  const merged: ClaudeHookConfig = { hooks: {} };
  for (const config of configs) {
    if (config.hooks.PreToolUse) {
      merged.hooks.PreToolUse = [
        ...(merged.hooks.PreToolUse ?? []),
        ...config.hooks.PreToolUse,
      ];
    }
    if (config.hooks.PostToolUse) {
      merged.hooks.PostToolUse = [
        ...(merged.hooks.PostToolUse ?? []),
        ...config.hooks.PostToolUse,
      ];
    }
  }
  return merged;
}

/** Detect the project's formatter by checking for config files. */
export function detectFormatter(rootDir: string): string | null {
  const checks: Array<[string, string]> = [
    [".prettierrc", "npx prettier --write"],
    [".prettierrc.json", "npx prettier --write"],
    [".prettierrc.js", "npx prettier --write"],
    [".prettierrc.cjs", "npx prettier --write"],
    ["prettier.config.js", "npx prettier --write"],
    ["prettier.config.cjs", "npx prettier --write"],
    ["biome.json", "npx @biomejs/biome check --write"],
    ["biome.jsonc", "npx @biomejs/biome check --write"],
  ];

  for (const [file, cmd] of checks) {
    if (fs.existsSync(path.join(rootDir, file))) {
      return cmd;
    }
  }
  return null;
}

export interface HookEnv {
  WORKTREE_DIR: string;
  WORKTREE_NAME: string;
  BASE_BRANCH: string;
  REPO_ROOT: string;
}

/** Run a hook script if it exists and is executable. Non-fatal on failure. */
export function runHook(name: string, env: HookEnv): void {
  const hookFile = path.join(env.REPO_ROOT, ".glorious", "hooks", name);
  if (!fs.existsSync(hookFile)) return;

  const stat = fs.statSync(hookFile);
  if (!(stat.mode & 0o111)) return; // not executable

  info(`running ${name} hook...`);
  try {
    execaSync("bash", ["-c", 'set +e\nsource "$HOOK_FILE"\ntrue'], {
      stdio: "inherit",
      env: { ...process.env, ...env, HOOK_FILE: hookFile },
    });
  } catch (err: unknown) {
    const code = (err as { exitCode?: number }).exitCode;
    warn(`${name} hook exited with code ${code ?? "unknown"}`);
  }
}
