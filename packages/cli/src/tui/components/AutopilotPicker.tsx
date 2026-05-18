import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  isDir: boolean;
  path: string;
  /** True if this directory contains main.md or spec/main.yaml (it's a plan). */
  isPlan?: boolean;
}

interface AutopilotPickerProps {
  startDir: string;
  onSelect: (planPath: string) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortenHome(p: string): string {
  const home = process.env.HOME ?? "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function isPlanDir(dirPath: string): "md" | "yaml" | false {
  if (fs.existsSync(path.join(dirPath, "main.md"))) return "md";
  if (fs.existsSync(path.join(dirPath, "spec", "main.yaml"))) return "yaml";
  return false;
}

function readDir(dir: string): FileEntry[] {
  try {
    const raw = fs.readdirSync(dir, { withFileTypes: true });
    const dirs: FileEntry[] = [];
    const files: FileEntry[] = [];

    for (const entry of raw) {
      // Skip noise
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === "target") continue;
      if (entry.name.startsWith(".") && entry.name !== ".glrs" && entry.name !== ".opencode" && entry.name !== ".agent" && entry.name !== ".claude") continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const planType = isPlanDir(fullPath);
        dirs.push({
          name: planType ? `${entry.name}/` : `${entry.name}/`,
          isDir: true,
          path: fullPath,
          isPlan: !!planType,
        });
      } else if (entry.name.endsWith(".md") || entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
        files.push({ name: entry.name, isDir: false, path: fullPath });
      }
    }

    // Sort: plan directories first, then other dirs, then files
    dirs.sort((a, b) => {
      if (a.isPlan && !b.isPlan) return -1;
      if (!a.isPlan && b.isPlan) return 1;
      return a.name.localeCompare(b.name);
    });
    files.sort((a, b) => a.name.localeCompare(b.name));

    return [...dirs, ...files];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const VIEWPORT = 15;

/**
 * File explorer for picking a plan file.
 * Plan directories (containing main.md) are highlighted and selectable directly.
 * Regular directories can be navigated into.
 * .md/.yaml files can be selected directly.
 */
export function AutopilotPicker({ startDir, onSelect, onCancel }: AutopilotPickerProps) {
  const [cwd, setCwd] = useState(startDir);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const entries = useMemo(() => readDir(cwd), [cwd]);

  useInput((_input, key) => {
    if (key.escape) {
      if (cwd === startDir) {
        onCancel();
      } else {
        setCwd(path.dirname(cwd));
        setSelectedIndex(0);
      }
      return;
    }
    if (key.return && entries[selectedIndex]) {
      const entry = entries[selectedIndex];
      if (entry.isPlan) {
        // Return the DIRECTORY path, not the main.md file inside it.
        // runLoopSession checks isDirectory to decide between multi-phase
        // orchestration (phases, verify, checkpoints) vs single-file mode.
        onSelect(entry.path);
      } else if (entry.isDir) {
        setCwd(entry.path);
        setSelectedIndex(0);
      } else {
        onSelect(entry.path);
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(entries.length - 1, i + 1));
    }
  });

  // Viewport
  const halfWindow = Math.floor(VIEWPORT / 2);
  let windowStart = Math.max(0, selectedIndex - halfWindow);
  const windowEnd = Math.min(entries.length, windowStart + VIEWPORT);
  if (windowEnd - windowStart < VIEWPORT) {
    windowStart = Math.max(0, windowEnd - VIEWPORT);
  }
  const visible = entries.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Select a plan</Text>
        <Text dimColor> — {shortenHome(cwd)}</Text>
      </Box>

      {entries.length === 0 ? (
        <Text dimColor>Empty directory.</Text>
      ) : (
        <>
          {windowStart > 0 && <Text dimColor>  ↑ {windowStart} more</Text>}
          {visible.map((entry, i) => {
            const globalIndex = windowStart + i;
            const isSelected = globalIndex === selectedIndex;
            return (
              <Box key={`${entry.path}-${globalIndex}`}>
                <Text color={isSelected ? "blue" : undefined}>
                  {isSelected ? "▶ " : "  "}
                  {entry.isPlan ? (
                    <Text bold color="green">{entry.name}</Text>
                  ) : entry.isDir ? (
                    <Text color="cyan">{entry.name}</Text>
                  ) : (
                    <Text>{entry.name}</Text>
                  )}
                  {entry.isPlan && <Text color="green"> ← plan</Text>}
                </Text>
              </Box>
            );
          })}
          {windowEnd < entries.length && <Text dimColor>  ↓ {entries.length - windowEnd} more</Text>}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter {entries[selectedIndex]?.isPlan ? "select plan" : entries[selectedIndex]?.isDir ? "open" : "select"} · Esc {cwd === startDir ? "quit" : "back"}</Text>
      </Box>
    </Box>
  );
}
