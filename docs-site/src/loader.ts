/**
 * glrsContentLoader — custom Astro v5 content loader for the @glrs-dev docs site.
 *
 * Reads markdown from a configured set of repo paths and emits a Starlight
 * content collection. Supports:
 *   - Single-file mode (e.g. packages/<pkg>/README.md)
 *   - Directory tree mode (e.g. packages/<pkg>/docs/)
 *   - Configurable ignore patterns
 *   - Frontmatter synthesis (title from H1, description from first paragraph)
 *   - Collision detection (throws on duplicate ids)
 *
 * The loader is a pure function of its `sources` argument — unit-testable
 * without the Astro runtime.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join, basename, extname, dirname } from "node:path";
import matter from "gray-matter";
import type { Loader, LoaderContext } from "astro/loaders";

export interface GlrsSource {
  /** Repo-relative path to scan (relative to the docs-site directory). */
  base: string;
  /** URL prefix for emitted entries (e.g. '/cli/'). */
  slugPrefix: string;
  /** Single-file mode: only load this filename from `base`. */
  singleFile?: string;
  /** Glob-like patterns to include. Default: ['**\/*.md', '**\/*.mdx'] */
  include?: string[];
  /** Glob-like patterns to ignore. Default: [] */
  ignore?: string[];
  /** Fallback title when no H1 found. Default: basename of file without extension. */
  titleFallback?: string;
}

export interface GlrsEntry {
  id: string;
  filePath: string;
  body: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip backticks and asterisks from a string (for title synthesis). */
function stripCodeEmphasis(s: string): string {
  return s.replace(/[`*]/g, "").trim();
}

/** Strip markdown links, emphasis, inline code from a string (for description). */
function stripMarkdownSyntax(s: string): string {
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

/** Parse title and description from markdown body (no existing frontmatter). */
function synthesizeFrontmatter(
  body: string,
  titleFallback: string,
): { title: string; description: string } {
  const lines = body.split("\n");

  // Find first H1
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

  // After H1, skip blank lines, take next non-heading paragraph until blank line
  let description = "";
  const startIdx = h1LineIdx >= 0 ? h1LineIdx + 1 : 0;
  let inParagraph = false;
  const paragraphLines: string[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!inParagraph) {
      if (line.trim() === "") continue; // skip blank lines before paragraph
      if (line.match(/^#{1,6}\s/)) break; // heading — stop
      if (line.match(/^```/)) break;      // code block — stop
      inParagraph = true;
      paragraphLines.push(line);
    } else {
      if (line.trim() === "") break; // blank line ends paragraph
      paragraphLines.push(line);
    }
  }

  if (paragraphLines.length > 0) {
    description = stripMarkdownSyntax(paragraphLines.join(" "));
  }

  return { title, description };
}

/** Simple glob-like pattern matching (supports ** and *). */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize separators
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob to regex step by step
  // 1. Escape all regex special chars except * and ?
  // 2. Replace ** with a placeholder, then * with [^/]*, then restore **
  let regexStr = "";
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*") {
      // ** — matches any path including slashes and empty
      regexStr += ".*";
      i += 2;
      // Skip optional trailing slash after **
      if (normalizedPattern[i] === "/") i++;
    } else if (ch === "*") {
      // * — matches within a single segment (no slashes)
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
function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(relPath, p));
}

/** Recursively collect files from a directory. */
function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/** Normalize a slug: remove leading/trailing slashes, collapse doubles. */
function normalizeSlug(s: string): string {
  return s.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

// ---------------------------------------------------------------------------
// Core: scan sources and emit entries
// ---------------------------------------------------------------------------

/**
 * Scan all sources and return GlrsEntry objects.
 * This is the pure, unit-testable core — no Astro runtime needed.
 *
 * @param sources  Array of GlrsSource configs
 * @param baseDir  Absolute path to resolve `source.base` against (typically docs-site dir)
 */
export function scanSources(sources: GlrsSource[], baseDir: string): GlrsEntry[] {
  const entries: GlrsEntry[] = [];
  // Track id → source path for collision detection
  const seen = new Map<string, string>();

  for (const source of sources) {
    const absBase = resolve(baseDir, source.base);
    const include = source.include ?? ["**/*.md", "**/*.mdx"];
    const ignore = source.ignore ?? [];

    if (source.singleFile) {
      // Single-file mode
      const absFile = resolve(absBase, source.singleFile);
      if (!existsSync(absFile)) continue;

      const raw = readFileSync(absFile, "utf8");
      const parsed = matter(raw);
      const body = parsed.content;

      let data: Record<string, unknown>;
      if (Object.keys(parsed.data).length > 0) {
        data = { ...parsed.data };
      } else {
        const fallback = source.titleFallback ?? basename(source.singleFile, extname(source.singleFile));
        const synth = synthesizeFrontmatter(body, fallback);
        data = { title: synth.title, description: synth.description };
      }

      // id: if slugPrefix is root ('/'), emit 'index'; otherwise emit
      // '<section>/index' so Starlight's autogenerate picks it up as the
      // section root. Bare '<section>' ids are treated as top-level
      // routes and don't populate the autogenerated sidebar group.
      const prefix = normalizeSlug(source.slugPrefix);
      const id = prefix === "" ? "index" : `${prefix}/index`;
      // filePath: Starlight's autogenerate matches against filePath
      // relative to the docs collection root, NOT against the entry id.
      // Synthesize a path inside the collection so autogenerate works.
      // (We keep the real source path in `data.sourcePath` for editLinks
      // and tooling that cares about the original file.)
      const syntheticFilePath = `${id}.md`;
      const realRepoRelPath = relative(baseDir, absFile);
      data.sourcePath = realRepoRelPath;

      if (seen.has(id)) {
        throw new Error(
          `Duplicate entry id '${id}' from ${seen.get(id)} and ${realRepoRelPath}`,
        );
      }
      seen.set(id, realRepoRelPath);

      entries.push({ id, filePath: syntheticFilePath, body, data });
    } else {
      // Directory tree mode
      const allFiles = collectFiles(absBase);

      for (const absFile of allFiles) {
        const relToBase = relative(absBase, absFile).replace(/\\/g, "/");

        // Check include patterns
        if (!matchesAny(relToBase, include)) continue;
        // Check ignore patterns
        if (ignore.length > 0 && matchesAny(relToBase, ignore)) continue;

        const raw = readFileSync(absFile, "utf8");
        const parsed = matter(raw);
        const body = parsed.content;

        let data: Record<string, unknown>;
        if (Object.keys(parsed.data).length > 0) {
          data = { ...parsed.data };
        } else {
          const fallback = source.titleFallback ?? basename(absFile, extname(absFile));
          const synth = synthesizeFrontmatter(body, fallback);
          data = { title: synth.title, description: synth.description };
        }

        // id = slugPrefix + relToBase without extension
        const relWithoutExt = relToBase.replace(/\.(md|mdx)$/, "");
        const id = normalizeSlug(source.slugPrefix + "/" + relWithoutExt);
        // Synthesize filePath inside the content collection so Starlight's
        // autogenerate matching (which keys off filePath, not id) works.
        const syntheticFilePath = `${id}.md`;
        const realRepoRelPath = relative(baseDir, absFile);
        data.sourcePath = realRepoRelPath;

        if (seen.has(id)) {
          throw new Error(
            `Duplicate entry id '${id}' from ${seen.get(id)} and ${realRepoRelPath}`,
          );
        }
        seen.set(id, realRepoRelPath);

        entries.push({ id, filePath: syntheticFilePath, body, data });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Astro Loader factory
// ---------------------------------------------------------------------------

/**
 * Create an Astro v5 content loader that reads markdown from the given sources.
 */
export function glrsContentLoader(sources: GlrsSource[]): Loader {
  return {
    name: "glrs-content-loader",
    async load(context: LoaderContext): Promise<void> {
      // Resolve baseDir as the directory containing this loader file (docs-site/src/)
      // We need to go up one level to docs-site/, then sources are relative to that.
      const loaderDir = dirname(new URL(import.meta.url).pathname);
      const docsiteDir = resolve(loaderDir, "..");

      const entries = scanSources(sources, docsiteDir);

      context.store.clear();

      for (const entry of entries) {
        const parsed = await context.parseData({
          id: entry.id,
          data: entry.data,
          filePath: entry.filePath,
        });

        // Render the markdown body so Starlight can display it.
        // Without this, the page wrapper renders but `<Content />` is empty.
        const rendered = await context.renderMarkdown(entry.body);

        context.store.set({
          id: entry.id,
          data: parsed,
          body: entry.body,
          filePath: entry.filePath,
          rendered,
        });
      }
    },
  };
}
