import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface RegistryEntry {
  repo: string;
  repoPath: string;
  wtPath: string;
  branch: string;
  createdAt: string;
}

const REGISTRY_DIR = path.join(os.homedir(), ".glorious");
const REGISTRY_FILE = path.join(REGISTRY_DIR, "worktrees.json");

function ensureDir(): void {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
}

/** Load registry, pruning entries whose worktree paths no longer exist. */
export function loadRegistry(): RegistryEntry[] {
  if (!fs.existsSync(REGISTRY_FILE)) return [];

  try {
    const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
    const entries: RegistryEntry[] = JSON.parse(raw);
    const valid = entries.filter((e) => fs.existsSync(e.wtPath));
    if (valid.length !== entries.length) {
      saveRegistry(valid);
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveRegistry(entries: RegistryEntry[]): void {
  ensureDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(entries, null, 2) + "\n");
}

export function registerWorktree(entry: RegistryEntry): void {
  const entries = loadRegistry();
  const filtered = entries.filter((e) => e.wtPath !== entry.wtPath);
  filtered.push(entry);
  saveRegistry(filtered);
}

export function unregisterWorktree(wtPath: string): void {
  const entries = loadRegistry();
  const filtered = entries.filter((e) => e.wtPath !== wtPath);
  if (filtered.length !== entries.length) {
    saveRegistry(filtered);
  }
}
