import * as path from "node:path";
import * as os from "node:os";

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
  // @ts-ignore - Bun types
  Bun.mkdir(REGISTRY_DIR, { recursive: true });
}

function existsSync(filePath: string): boolean {
  // @ts-ignore - Bun types
  return Bun.file(filePath).existsSync();
}

function readTextSync(filePath: string): string | null {
  try {
    // @ts-ignore - Bun types
    return Bun.file(filePath).textSync();
  } catch {
    return null;
  }
}

function writeTextSync(filePath: string, content: string): void {
  // @ts-ignore - Bun types
  Bun.file(filePath).writer().write(content);
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
