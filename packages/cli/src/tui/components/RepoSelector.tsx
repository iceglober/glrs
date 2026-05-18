import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { UniqueRepo } from "../../repo-config.js";

interface RepoSelectorProps {
  repos: UniqueRepo[];
  onSelect: (repo: UniqueRepo) => void;
  onCancel: () => void;
}

/** Max visible items in the scrolling viewport. */
const VIEWPORT_SIZE = 10;

/**
 * Step 1 of the new session flow: select a repo.
 * Shows a scrolling list of unique repos (not individual worktrees).
 * Arrow keys to navigate, Enter to select, Esc to cancel.
 */
export function RepoSelector({ repos, onSelect, onCancel }: RepoSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (repos[selectedIndex]) {
        onSelect(repos[selectedIndex]);
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(repos.length - 1, i + 1));
    }
  });

  // Compute the visible window around the selected index
  const halfWindow = Math.floor(VIEWPORT_SIZE / 2);
  let windowStart = Math.max(0, selectedIndex - halfWindow);
  const windowEnd = Math.min(repos.length, windowStart + VIEWPORT_SIZE);
  // Adjust start if we're near the end
  if (windowEnd - windowStart < VIEWPORT_SIZE) {
    windowStart = Math.max(0, windowEnd - VIEWPORT_SIZE);
  }
  const visibleRepos = repos.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Select Repository</Text>
        <Text dimColor> — {repos.length} repos</Text>
      </Box>

      {repos.length === 0 ? (
        <Text dimColor>No repositories found. Add repos to ~/.config/glrs/repos.yaml</Text>
      ) : (
        <>
          {windowStart > 0 && (
            <Text dimColor>  ↑ {windowStart} more</Text>
          )}
          {visibleRepos.map((repo, i) => {
            const globalIndex = windowStart + i;
            const isSelected = globalIndex === selectedIndex;
            return (
              <Box key={`${repo.primaryPath}-${globalIndex}`}>
                <Text color={isSelected ? "blue" : undefined}>
                  {isSelected ? "▶ " : "  "}
                  <Text bold={isSelected}>{repo.name}</Text>
                </Text>
              </Box>
            );
          })}
          {windowEnd < repos.length && (
            <Text dimColor>  ↓ {repos.length - windowEnd} more</Text>
          )}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}
