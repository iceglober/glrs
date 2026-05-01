/**
 * stage-docs.mjs — prebuild staging script for the @glrs-dev docs site.
 *
 * Reads package READMEs and docs/**\/*.md files, then writes staged copies
 * into docs-site/src/content/docs/ under the slug layout Starlight expects.
 *
 * Exports:
 *   - planStaging(opts)  — pure planner, returns Array<StagingEntry>
 *   - AUTHORED_FILES     — list of files the stager refuses to overwrite
 *
 * CLI entry: run directly with `bun run scripts/stage-docs.mjs`
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join, basename, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Files in the staged content dir that are human-authored and must not be
 * overwritten by the stager. The .gitignore negation list must match this.
 */
export const AUTHORED_FILES = ["index.md"];

/** Ignore patterns — relative to the source directory being scanned. */
const IGNORE_PATTERNS = ["pilot/spikes/**", "archive/**", "spike-results.md"];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip backticks and asterisks from a string (for title synthesis). */
function stripCodeEmphasis(s) {
  return s.replace(/[`*]/g, "").trim();
}

/** Strip markdown links, emphasis, inline code from a string (for description). */
function stripMarkdownSyntax(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // ![alt](url) → alt
    .replace(/`([^`]+)`/g, "$1")              // `code` → code
    .replace(/\*\*([^*]+)\*\*/g, "$1")        // **bold** → bold
    .replace(/\*([^*]+)\*/g, "$1")            // *em* → em
    .replace(/__([^_]+)__/g, "$1")            // __bold__ → bold
    .replace(/_([^_]+)_/g, "$1")              // _em_ → em
    .trim();
}

/** Simple glob-like pattern matching (supports ** and *). */
function matchesPattern(filePath, pattern) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  let regexStr = "";
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*") {
      regexStr += ".*";
      i += 2;
      if (normalizedPattern[i] === "/") i++;
    } else if (ch === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      regexStr += "\\" + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedPath);
}

/** Check if a relative path matches any of the given patterns. */
function matchesAny(relPath, patterns) {
  return patterns.some((p) => matchesPattern(relPath, p));
}

/** Recursively collect .md files from a directory. */
function collectMdFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.endsWith(".md")) {
      results.push(full);
    } else if (entry.endsWith(".mdx")) {
      // Refuse .mdx sources loudly
      throw new Error(
        `[stage-docs] .mdx source found: ${full}\n` +
        `The docs site is markdown-only. Rename to .md or remove this file.`
      );
    }
  }
  return results;
}

/**
 * Parse title and description from markdown body (no existing frontmatter).
 * Returns { title, description, bodyWithoutH1 }.
 * When the H1 is promoted to frontmatter title, the H1 line is stripped
 * from the body to avoid duplicate <h1> rendering.
 */
function synthesizeFrontmatter(body, titleFallback) {
  const lines = body.split("\n");

  let title = titleFallback;
  let h1LineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) {
      title = stripCodeEmphasis(m[1]);
      h1LineIdx = i;
      break;
    }
  }

  // Strip the H1 line from the body (avoid duplicate <h1>)
  let bodyWithoutH1 = body;
  if (h1LineIdx >= 0) {
    const newLines = [...lines];
    newLines.splice(h1LineIdx, 1);
    // Also remove a blank line immediately after the H1 if present
    if (newLines[h1LineIdx] !== undefined && newLines[h1LineIdx].trim() === "") {
      newLines.splice(h1LineIdx, 1);
    }
    bodyWithoutH1 = newLines.join("\n");
  }

  // After H1, find first paragraph for description
  let description = "";
  const startIdx = h1LineIdx >= 0 ? h1LineIdx + 1 : 0;
  let inParagraph = false;
  const paragraphLines = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!inParagraph) {
      if (line.trim() === "") continue;
      if (line.match(/^#{1,6}\s/)) break;
      if (line.match(/^```/)) break;
      inParagraph = true;
      paragraphLines.push(line);
    } else {
      if (line.trim() === "") break;
      paragraphLines.push(line);
    }
  }

  if (paragraphLines.length > 0) {
    description = stripMarkdownSyntax(paragraphLines.join(" "));
  }

  return { title, description, bodyWithoutH1 };
}

// ---------------------------------------------------------------------------
// Core planner — pure function, no filesystem writes
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SourceDescriptor
 * @property {string} sourcePath   - Absolute path to the source file
 * @property {string} stagedSlug   - Relative slug within staged content dir (e.g. "cli/index.md")
 * @property {string} titleFallback - Fallback title if no H1 found
 */

/**
 * @typedef {Object} StagingEntry
 * @property {string} sourcePath   - Absolute path to the source file
 * @property {string} stagedPath   - Absolute path to the staged output file
 * @property {string} content      - Final content to write (with frontmatter)
 * @property {boolean} synthesizedFrontmatter - Whether frontmatter was synthesized
 */

/**
 * Plan staging from a list of source descriptors.
 * Pure function — takes descriptors (with file content already read) and
 * returns the list of staging entries to write.
 *
 * @param {Object} opts
 * @param {Array<{sourcePath: string, slug: string, rawContent: string, titleFallback: string}>} opts.sources
 * @param {string} opts.stagedContentDir - Absolute path to staged content dir
 * @returns {StagingEntry[]}
 */
export function planStaging({ sources, stagedContentDir }) {
  const entries = [];
  const seenSlugs = new Map(); // slug → sourcePath

  for (const src of sources) {
    const { sourcePath, slug, rawContent, titleFallback } = src;

    // Refuse .mdx sources
    if (sourcePath.endsWith(".mdx")) {
      throw new Error(
        `[stage-docs] .mdx source refused: ${sourcePath}\n` +
        `The docs site is markdown-only. Rename to .md or remove this file.`
      );
    }

    // Collision detection
    if (seenSlugs.has(slug)) {
      throw new Error(
        `[stage-docs] Duplicate output slug '${slug}' from:\n` +
        `  ${seenSlugs.get(slug)}\n` +
        `  ${sourcePath}`
      );
    }
    seenSlugs.set(slug, sourcePath);

    // Refuse to overwrite authored files
    if (AUTHORED_FILES.includes(slug)) {
      throw new Error(
        `[stage-docs] Refusing to overwrite authored file '${slug}' from source ${sourcePath}.\n` +
        `Authored files are managed by humans, not the stager.`
      );
    }

    const stagedPath = resolve(stagedContentDir, slug);

    // Parse frontmatter
    const parsed = matter(rawContent);
    let finalContent;
    let synthesized = false;

    if (Object.keys(parsed.data).length > 0) {
      // Preserve existing frontmatter verbatim
      finalContent = rawContent;
    } else {
      // Synthesize frontmatter
      synthesized = true;
      const fallback = titleFallback ?? basename(sourcePath, extname(sourcePath));
      const { title, description, bodyWithoutH1 } = synthesizeFrontmatter(parsed.content, fallback);
      const fm = matter.stringify(bodyWithoutH1, { title, description });
      finalContent = fm;
    }

    entries.push({
      sourcePath,
      stagedPath,
      content: finalContent,
      synthesizedFrontmatter: synthesized,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Filesystem scanner — builds source descriptors from the real repo
// ---------------------------------------------------------------------------

/**
 * Scan the repo and build source descriptors for planStaging.
 * This is the part that touches the filesystem.
 *
 * @param {string} repoRoot - Absolute path to the monorepo root
 * @param {string} stagedContentDir - Absolute path to staged content dir
 * @returns {Array<{sourcePath, slug, rawContent, titleFallback}>}
 */
function buildSourceDescriptors(repoRoot, _stagedContentDir) {
  const sources = [];

  // Helper: add a single README as <pkg>/index.md
  function addReadme(pkgDir, slugPrefix, titleFallback) {
    const readmePath = join(pkgDir, "README.md");
    if (!existsSync(readmePath)) {
      console.info(`[stage-docs] INFO: README not found, skipping: ${readmePath}`);
      return;
    }
    const rawContent = readFileSync(readmePath, "utf8");
    sources.push({
      sourcePath: readmePath,
      slug: `${slugPrefix}/index.md`,
      rawContent,
      titleFallback,
    });
  }

  // Helper: add all .md files from a docs dir
  function addDocsDir(docsDir, slugPrefix) {
    if (!existsSync(docsDir)) {
      console.info(`[stage-docs] INFO: docs dir not found, skipping: ${docsDir}`);
      return;
    }
    const files = collectMdFiles(docsDir);
    for (const absFile of files) {
      const relToBase = relative(docsDir, absFile).replace(/\\/g, "/");
      // Apply ignore patterns
      if (matchesAny(relToBase, IGNORE_PATTERNS)) {
        console.info(`[stage-docs] INFO: ignoring: ${relToBase}`);
        continue;
      }
      const relWithoutExt = relToBase.replace(/\.md$/, "");
      const slug = `${slugPrefix}/${relWithoutExt}.md`;
      const rawContent = readFileSync(absFile, "utf8");
      sources.push({
        sourcePath: absFile,
        slug,
        rawContent,
        titleFallback: basename(absFile, ".md"),
      });
    }
  }

  // Helper: add all .md files from repo-root docs/ as top-level slugs
  function addRootDocs(docsDir) {
    if (!existsSync(docsDir)) {
      console.info(`[stage-docs] INFO: root docs dir not found, skipping: ${docsDir}`);
      return;
    }
    const files = collectMdFiles(docsDir);
    for (const absFile of files) {
      const relToBase = relative(docsDir, absFile).replace(/\\/g, "/");
      if (matchesAny(relToBase, IGNORE_PATTERNS)) {
        console.info(`[stage-docs] INFO: ignoring: ${relToBase}`);
        continue;
      }
      const relWithoutExt = relToBase.replace(/\.md$/, "");
      const slug = `${relWithoutExt}.md`;
      const rawContent = readFileSync(absFile, "utf8");
      sources.push({
        sourcePath: absFile,
        slug,
        rawContent,
        titleFallback: basename(absFile, ".md"),
      });
    }
  }

  // Package READMEs
  addReadme(join(repoRoot, "packages/cli"), "cli", "@glrs-dev/cli");
  addReadme(join(repoRoot, "packages/harness-opencode"), "harness-opencode", "@glrs-dev/harness-plugin-opencode");
  addReadme(join(repoRoot, "packages/assume"), "assume", "@glrs-dev/assume");

  // Package docs dirs
  addDocsDir(join(repoRoot, "packages/cli/docs"), "cli");
  addDocsDir(join(repoRoot, "packages/harness-opencode/docs"), "harness-opencode");
  addDocsDir(join(repoRoot, "packages/assume/docs"), "assume");

  // Repo-root docs/
  addRootDocs(join(repoRoot, "docs"));

  return sources;
}

// ---------------------------------------------------------------------------
// Writer — applies staging entries to the filesystem
// ---------------------------------------------------------------------------

/**
 * Write staging entries to disk. Idempotent — only writes if content changed.
 *
 * @param {StagingEntry[]} entries
 */
function writeEntries(entries) {
  let written = 0;
  let skipped = 0;

  for (const entry of entries) {
    const dir = dirname(entry.stagedPath);
    mkdirSync(dir, { recursive: true });

    // Idempotent: skip if content is identical
    if (existsSync(entry.stagedPath)) {
      const existing = readFileSync(entry.stagedPath, "utf8");
      if (existing === entry.content) {
        skipped++;
        continue;
      }
    }

    writeFileSync(entry.stagedPath, entry.content, "utf8");
    written++;
  }

  console.info(`[stage-docs] Staged ${written} files (${skipped} unchanged).`);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);

if (import.meta.url === `file://${__filename}` || process.argv[1] === __filename) {
  // Resolve repo root: scripts/ is inside docs-site/, which is inside the repo root
  const scriptsDir = dirname(__filename);
  const docsiteDir = dirname(scriptsDir);
  const repoRoot = dirname(docsiteDir);
  const stagedContentDir = resolve(docsiteDir, "src/content/docs");

  console.info(`[stage-docs] Repo root: ${repoRoot}`);
  console.info(`[stage-docs] Staged content dir: ${stagedContentDir}`);

  const sources = buildSourceDescriptors(repoRoot, stagedContentDir);
  const entries = planStaging({ sources, stagedContentDir });
  writeEntries(entries);
}
