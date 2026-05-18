import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanLocation {
  /** Absolute path to the plan directory. */
  dir: string;
  /** Display label (e.g. "~/.glrs/tino-assistant/plans"). */
  label: string;
  /** Number of plan files/directories found. */
  fileCount: number;
  /** Whether this location is deprecated. */
  deprecated?: boolean;
  /** Whether this is the "explore" option. */
  explore?: boolean;
}

interface PlanInfo {
  name: string;
  planPath: string;
  itemCount: number;
  mtimeMs: number;
}

interface PlanSelectorProps {
  repoPath: string;
  repoName: string;
  onSelect: (planPath: string) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countCheckboxes(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const matches = content.match(/^\s*-\s*\[[ x]\]/gm);
    return matches?.length ?? 0;
  } catch {
    return 0;
  }
}

function getMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function countPlanEntries(dir: string): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const mainMd = path.join(dir, entry.name, "main.md");
        const specYaml = path.join(dir, entry.name, "spec", "main.yaml");
        if (fs.existsSync(mainMd) || fs.existsSync(specYaml)) count++;
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function scanPlanDir(dir: string): PlanInfo[] {
  const results: PlanInfo[] = [];
  try {
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const mainMd = path.join(entryPath, "main.md");
        if (fs.existsSync(mainMd)) {
          results.push({
            name: entry.name,
            planPath: mainMd,
            itemCount: countCheckboxes(mainMd),
            mtimeMs: getMtimeMs(mainMd),
          });
          continue;
        }
        const specYaml = path.join(entryPath, "spec", "main.yaml");
        if (fs.existsSync(specYaml)) {
          results.push({
            name: `${entry.name} (yaml)`,
            planPath: specYaml,
            itemCount: 0,
            mtimeMs: getMtimeMs(specYaml),
          });
          continue;
        }
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
        const itemCount = countCheckboxes(entryPath);
        if (itemCount > 0) {
          results.push({
            name: entry.name.replace(/\.md$/, ""),
            planPath: entryPath,
            itemCount,
            mtimeMs: getMtimeMs(entryPath),
          });
        }
      }
    }
  } catch {
    // Unreadable
  }
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

function shortenPath(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

// ---------------------------------------------------------------------------
// Build the list of plan locations for a repo
// ---------------------------------------------------------------------------

/**
 * Try to find the actual git clone for a repo by name.
 * Searches common locations: ~/repos/, ~/repos/<org>/, ~/projects/, etc.
 */
function findClonePath(repoName: string, candidatePath: string): string | null {
  const home = os.homedir();

  // If the candidate is already a real repo, use it
  if (isGitRepo(candidatePath)) return candidatePath;

  // Search common locations
  const searchRoots = [
    path.join(home, "repos"),
    path.join(home, "projects"),
    path.join(home, "src"),
    path.join(home, "code"),
    path.join(home, "dev"),
  ];

  for (const root of searchRoots) {
    // Direct: ~/repos/<repoName>
    const direct = path.join(root, repoName);
    if (isGitRepo(direct)) return direct;

    // Nested one level: ~/repos/<org>/<repoName>
    try {
      if (!fs.existsSync(root)) continue;
      const orgs = fs.readdirSync(root, { withFileTypes: true });
      for (const org of orgs) {
        if (!org.isDirectory()) continue;
        const nested = path.join(root, org.name, repoName);
        if (isGitRepo(nested)) return nested;
      }
    } catch {
      // Unreadable
    }
  }

  return null;
}

function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

function buildPlanLocations(repoPath: string, repoName: string): PlanLocation[] {
  const home = os.homedir();
  const locations: PlanLocation[] = [];

  // Try to find the actual clone if repoPath isn't one
  const clonePath = isGitRepo(repoPath) ? repoPath : findClonePath(repoName, repoPath);

  // Repo-local locations (only if we found the actual clone)
  if (clonePath) {
    const localDirs = [
      { dir: path.join(clonePath, ".glrs", "plans"), label: `${shortenPath(clonePath)}/.glrs/plans` },
      { dir: path.join(clonePath, ".opencode", "plans"), label: `${shortenPath(clonePath)}/.opencode/plans` },
      { dir: path.join(clonePath, "docs", "plans"), label: `${shortenPath(clonePath)}/docs/plans` },
      { dir: path.join(clonePath, "plans"), label: `${shortenPath(clonePath)}/plans` },
    ];
    for (const { dir, label } of localDirs) {
      const fileCount = countPlanEntries(dir);
      if (fileCount > 0 || dir.includes(".glrs")) {
        locations.push({ dir, label, fileCount });
      }
    }
  }

  // Global locations
  const globalDirs = [
    { dir: path.join(home, ".glrs", repoName, "plans"), label: `~/.glrs/${repoName}/plans` },
    { dir: path.join(home, ".glorious", "opencode", repoName, "plans"), label: `~/.glorious/opencode/${repoName}/plans`, deprecated: true },
  ];
  for (const { dir, label, deprecated } of globalDirs) {
    const fileCount = countPlanEntries(dir);
    if (fileCount > 0 || !deprecated) {
      locations.push({ dir, label, fileCount, deprecated });
    }
  }

  // Explore option — browse from the clone or home
  const exploreDir = clonePath ?? home;
  locations.push({
    dir: exploreDir,
    label: `${shortenPath(exploreDir)} [EXPLORE]`,
    fileCount: 0,
    explore: true,
  });

  return locations;
}

// ---------------------------------------------------------------------------
// File explorer component
// ---------------------------------------------------------------------------

interface FileExplorerProps {
  startDir: string;
  onSelect: (planPath: string) => void;
  onCancel: () => void;
}

function FileExplorer({ startDir, onSelect, onCancel }: FileExplorerProps) {
  const [cwd, setCwd] = useState(startDir);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const entries = useMemo(() => {
    try {
      const raw = fs.readdirSync(cwd, { withFileTypes: true });
      const dirs: Array<{ name: string; isDir: true; path: string }> = [];
      const files: Array<{ name: string; isDir: false; path: string }> = [];

      for (const entry of raw) {
        if (entry.name.startsWith(".") && entry.name !== ".glrs" && entry.name !== ".opencode") continue;
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
        const fullPath = path.join(cwd, entry.name);
        if (entry.isDirectory()) {
          dirs.push({ name: entry.name + "/", isDir: true, path: fullPath });
        } else if (entry.name.endsWith(".md") || entry.name.endsWith(".yaml")) {
          files.push({ name: entry.name, isDir: false, path: fullPath });
        }
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      return [...dirs, ...files];
    } catch {
      return [];
    }
  }, [cwd]);

  useInput((_input, key) => {
    if (key.escape) {
      // Go up one level, or cancel if at startDir
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
      if (entry.isDir) {
        // Check if this directory IS a plan (contains main.md or spec/main.yaml)
        const mainMd = path.join(entry.path, "main.md");
        const specYaml = path.join(entry.path, "spec", "main.yaml");
        if (fs.existsSync(mainMd)) {
          onSelect(mainMd);
        } else if (fs.existsSync(specYaml)) {
          onSelect(specYaml);
        } else {
          // Navigate into directory
          setCwd(entry.path);
          setSelectedIndex(0);
        }
      } else {
        // Select the file directly
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
  const VIEWPORT = 12;
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
        <Text bold>Explore: </Text>
        <Text dimColor>{shortenPath(cwd)}</Text>
      </Box>

      {windowStart > 0 && <Text dimColor>  ↑ {windowStart} more</Text>}
      {visible.map((entry, i) => {
        const globalIndex = windowStart + i;
        const isSelected = globalIndex === selectedIndex;
        return (
          <Box key={`${entry.path}-${globalIndex}`}>
            <Text color={isSelected ? "blue" : undefined}>
              {isSelected ? "▶ " : "  "}
              <Text bold={isSelected} color={entry.isDir ? "cyan" : undefined}>
                {entry.name}
              </Text>
            </Text>
          </Box>
        );
      })}
      {windowEnd < entries.length && <Text dimColor>  ↓ {entries.length - windowEnd} more</Text>}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter open/select · Esc back</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Plan list view (when a location is selected)
// ---------------------------------------------------------------------------

interface PlanListProps {
  location: PlanLocation;
  onSelect: (planPath: string) => void;
  onBack: () => void;
}

function PlanList({ location, onSelect, onBack }: PlanListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const plans = useMemo(() => scanPlanDir(location.dir), [location.dir]);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return && plans[selectedIndex]) {
      onSelect(plans[selectedIndex].planPath);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(plans.length - 1, i + 1));
    }
  });

  const VIEWPORT = 10;
  const halfWindow = Math.floor(VIEWPORT / 2);
  let windowStart = Math.max(0, selectedIndex - halfWindow);
  const windowEnd = Math.min(plans.length, windowStart + VIEWPORT);
  if (windowEnd - windowStart < VIEWPORT) {
    windowStart = Math.max(0, windowEnd - VIEWPORT);
  }
  const visible = plans.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Plans in </Text>
        <Text dimColor>{location.label}</Text>
      </Box>

      {plans.length === 0 ? (
        <Text dimColor>No plans in this location.</Text>
      ) : (
        <>
          {windowStart > 0 && <Text dimColor>  ↑ {windowStart} more</Text>}
          {visible.map((plan, i) => {
            const globalIndex = windowStart + i;
            const isSelected = globalIndex === selectedIndex;
            return (
              <Box key={`${plan.planPath}-${globalIndex}`}>
                <Text color={isSelected ? "blue" : undefined}>
                  {isSelected ? "▶ " : "  "}
                  <Text bold={isSelected}>{plan.name}</Text>
                  {plan.itemCount > 0 && <Text dimColor> ({plan.itemCount} items)</Text>}
                </Text>
              </Box>
            );
          })}
          {windowEnd < plans.length && <Text dimColor>  ↓ {plans.length - windowEnd} more</Text>}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// PlanSelector — top-level component
// ---------------------------------------------------------------------------

const VIEWPORT_SIZE = 10;

type PlanView =
  | { kind: "locations" }
  | { kind: "plans"; location: PlanLocation }
  | { kind: "explore"; startDir: string };

export function PlanSelector({ repoPath, repoName, onSelect, onCancel }: PlanSelectorProps) {
  const [view, setView] = useState<PlanView>({ kind: "locations" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const locations = useMemo(() => buildPlanLocations(repoPath, repoName), [repoPath, repoName]);

  // All hooks must be called unconditionally
  useInput((_input, key) => {
    if (view.kind !== "locations") return;

    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return && locations[selectedIndex]) {
      const loc = locations[selectedIndex];
      if (loc.explore) {
        setView({ kind: "explore", startDir: loc.dir });
      } else if (loc.fileCount > 0) {
        setView({ kind: "plans", location: loc });
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(locations.length - 1, i + 1));
    }
  });

  if (view.kind === "plans") {
    return (
      <PlanList
        location={view.location}
        onSelect={onSelect}
        onBack={() => setView({ kind: "locations" })}
      />
    );
  }

  if (view.kind === "explore") {
    return (
      <FileExplorer
        startDir={view.startDir}
        onSelect={onSelect}
        onCancel={() => setView({ kind: "locations" })}
      />
    );
  }

  // Locations view
  const halfWindow = Math.floor(VIEWPORT_SIZE / 2);
  let windowStart = Math.max(0, selectedIndex - halfWindow);
  const windowEnd = Math.min(locations.length, windowStart + VIEWPORT_SIZE);
  if (windowEnd - windowStart < VIEWPORT_SIZE) {
    windowStart = Math.max(0, windowEnd - VIEWPORT_SIZE);
  }
  const visible = locations.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Select Plan Location</Text>
        <Text dimColor> — {repoName}</Text>
      </Box>

      {locations.length === 0 ? (
        <Text dimColor>No plan locations found for this repo.</Text>
      ) : (
        <>
          {windowStart > 0 && <Text dimColor>  ↑ {windowStart} more</Text>}
          {visible.map((loc, i) => {
            const globalIndex = windowStart + i;
            const isSelected = globalIndex === selectedIndex;
            const canEnter = loc.fileCount > 0 || loc.explore;
            return (
              <Box key={`${loc.dir}-${globalIndex}`}>
                <Text color={isSelected ? "blue" : undefined} dimColor={!canEnter && !isSelected}>
                  {isSelected ? "▶ " : "  "}
                  <Text bold={isSelected}>{loc.label}</Text>
                  {loc.deprecated && <Text color="yellow"> [DEPRECATED]</Text>}
                  {!loc.explore && <Text dimColor> ({loc.fileCount} files)</Text>}
                </Text>
              </Box>
            );
          })}
          {windowEnd < locations.length && <Text dimColor>  ↓ {locations.length - windowEnd} more</Text>}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter open · Esc back</Text>
      </Box>
    </Box>
  );
}
