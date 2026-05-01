import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

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

function existsSync(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readTextSync(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function writeTextSync(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
}

/** Load registry, pruning entries whose worktree paths no longer exist. */
export function loadRegistry(): RegistryEntry[] {
  if (!existsSync(REGISTRY_FILE)) return [];

  try {
    const raw = readTextSync(REGISTRY_FILE);
    if (!raw) return [];
    const entries: RegistryEntry[] = JSON.parse(raw);
    const valid = entries.filter((e) => existsSync(e.wtPath));
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
  writeTextSync(REGISTRY_FILE, JSON.stringify(entries, null, 2) + "\n");
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
