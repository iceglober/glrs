import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { RepoInfo } from "../../repo-config.js";

interface WorktreeInfo {
  /** Human-readable label. */
  label: string;
  /** Absolute path to the worktree root. */
  path: string;
  /** True if this is the repo root (not a worktree). */
  isRoot: boolean;
}

interface WorktreeSelectorProps {
  repo: RepoInfo;
  onSelect: (worktreePath: string) => void;
  onCancel: () => void;
}

/**
 * Scan for worktrees for the given repo.
 * Returns the repo root as the first option, then any worktrees found under
 * ~/.glrs/worktrees/<repo-name>/ (primary) and ~/.glorious/worktrees/<repo-name>/
 * (legacy fallback). Deduplicates by resolved path.
 */
function discoverWorktrees(repo: RepoInfo): WorktreeInfo[] {
  const results: WorktreeInfo[] = [];
  const seenPaths = new Set<string>();

  // Always include the repo root itself
  results.push({ label: `${repo.name} (root)`, path: repo.path, isRoot: true });
  seenPaths.add(path.resolve(repo.path));

  // Scan worktrees dirs: ~/.glrs/worktrees/<repo-name>/ (primary) then
  // ~/.glorious/worktrees/<repo-name>/ (legacy fallback)
  const worktreesBases = [
    path.join(os.homedir(), ".glrs", "worktrees", repo.name),
    path.join(os.homedir(), ".glorious", "worktrees", repo.name),
  ];

  for (const worktreesBase of worktreesBases) {
    try {
      if (!fs.existsSync(worktreesBase)) continue;

      const entries = fs.readdirSync(worktreesBase, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const wtPath = path.join(worktreesBase, entry.name);
        const resolved = path.resolve(wtPath);
        if (seenPaths.has(resolved)) continue;
        seenPaths.add(resolved);
        results.push({
          label: entry.name,
          path: wtPath,
          isRoot: false,
        });
      }
    } catch {
      // Unreadable — skip
    }
  }

  return results;
}

/**
 * Step 2 of the new session flow: select a worktree.
 * Arrow keys to navigate, Enter to select, Esc to go back.
 */
export function WorktreeSelector({ repo, onSelect, onCancel }: WorktreeSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const worktrees = useMemo(() => discoverWorktrees(repo), [repo]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (worktrees[selectedIndex]) {
        onSelect(worktrees[selectedIndex].path);
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(worktrees.length - 1, i + 1));
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Select Worktree</Text>
        <Text dimColor> — {repo.name}</Text>
      </Box>

      {worktrees.map((wt, i) => (
        <Box key={wt.path}>
          <Text color={i === selectedIndex ? "blue" : undefined}>
            {i === selectedIndex ? "▶ " : "  "}
            <Text bold={i === selectedIndex}>{wt.label}</Text>
            {"  "}
            <Text dimColor>{wt.path}</Text>
          </Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
      </Box>
    </Box>
  );
}
