export type RepoIndex = Record<string, string>;

export interface RegistryEntry {
  repo: string;
  repoPath: string;
  wtPath: string;
  branch: string;
  createdAt: string;
}
