/**
 * Post-build smoke test for docs-site/dist/.
 *
 * Asserts expected routes exist in the built site and that ignored paths
 * are absent. Also asserts rendered body content, sidebar shape, and
 * absence of literal MDX passthrough.
 *
 * Skips (not fails) when dist/ is absent — the verify command chains `build` first.
 *
 * Covers acceptance criteria a4, a5, a6, a7, a8.
 */
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../dist");

function distExists(): boolean {
  return existsSync(distDir);
}

function readHtml(relPath: string): string {
  return readFileSync(resolve(distDir, relPath), "utf8");
}

/**
 * Extract the body content region from a built HTML page.
 * Looks for sl-markdown-content or the main content area.
 * Uses a start-index approach to avoid regex backtracking issues with nested divs.
 */
function extractBodyContent(html: string): string {
  // Find sl-markdown-content div start
  const marker = '<div class="sl-markdown-content">';
  const startIdx = html.indexOf(marker);
  if (startIdx >= 0) {
    // Return everything from the marker to end of file — the content is what matters
    // (we don't need to find the exact closing tag)
    return html.slice(startIdx + marker.length);
  }

  // Fallback: look for <main> content
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (mainMatch) return mainMatch[1];

  return html;
}

/**
 * Count visible text characters (strip HTML tags).
 */
function countVisibleText(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().length;
}

/**
 * Count <p> tags in HTML.
 */
function countParagraphs(html: string): number {
  const matches = html.match(/<p[\s>]/gi);
  return matches ? matches.length : 0;
}

/**
 * Walk all HTML files in a directory recursively.
 */
function walkHtmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkHtmlFiles(full));
    } else if (entry.endsWith(".html")) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// a8: Existing route-existence assertions (preserved)
// ---------------------------------------------------------------------------

describe("built site contains expected pages", () => {
  test("built site contains /cli/, /harness-opencode/, /assume/, /install/, and /", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }
    expect(existsSync(resolve(distDir, "index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "cli/index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "harness-opencode/index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "assume/index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "install/index.html"))).toBe(true);
  });

  test("built site contains /harness-opencode/plugin-architecture/ and /harness-opencode/migration-from-clone-install/", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }
    expect(
      existsSync(resolve(distDir, "harness-opencode/plugin-architecture/index.html")),
    ).toBe(true);
    expect(
      existsSync(resolve(distDir, "harness-opencode/migration-from-clone-install/index.html")),
    ).toBe(true);
  });

  test("built site does not contain spike pages under /harness-opencode/pilot/spikes/", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }
    expect(
      existsSync(resolve(distDir, "harness-opencode/pilot/spikes")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// a4: Homepage hero + H3 package grid
// ---------------------------------------------------------------------------

describe("homepage body content", () => {
  test("homepage dist/index.html contains hero tagline AND three H3 package sections with links", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }
    const html = readHtml("index.html");

    // Hero tagline
    expect(html, "homepage should contain hero tagline").toContain("One install. One CLI. Focused tools.");

    // Three H3 package sections
    expect(html, "homepage should contain @glrs-dev/cli H3").toMatch(/<h3[^>]*>.*@glrs-dev\/cli.*<\/h3>/s);
    expect(html, "homepage should contain @glrs-dev/harness-plugin-opencode H3").toMatch(/<h3[^>]*>.*@glrs-dev\/harness-plugin-opencode.*<\/h3>/s);
    expect(html, "homepage should contain @glrs-dev/assume H3").toMatch(/<h3[^>]*>.*@glrs-dev\/assume.*<\/h3>/s);

    // Links to package pages
    expect(html, "homepage should link to /cli/").toContain('href="/cli/');
    expect(html, "homepage should link to /harness-opencode/").toContain('href="/harness-opencode/');
    expect(html, "homepage should link to /assume/").toContain('href="/assume/');
  });
});

// ---------------------------------------------------------------------------
// a5: Interior pages have non-empty body content
// ---------------------------------------------------------------------------

describe("interior page body content", () => {
  const interiorPages = [
    { path: "cli/index.html", label: "/cli/" },
    { path: "harness-opencode/index.html", label: "/harness-opencode/" },
    { path: "assume/index.html", label: "/assume/" },
    { path: "install/index.html", label: "/install/" },
    { path: "harness-opencode/plugin-architecture/index.html", label: "/harness-opencode/plugin-architecture/" },
  ];

  test("each interior page has a non-empty sl-markdown-content with at least 500 chars and 3 paragraphs", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }

    for (const page of interiorPages) {
      const html = readHtml(page.path);
      const body = extractBodyContent(html);
      const charCount = countVisibleText(body);
      const paraCount = countParagraphs(body);

      expect(
        charCount,
        `Page ${page.label}: expected ≥500 visible chars in body, got ${charCount}`
      ).toBeGreaterThanOrEqual(500);

      expect(
        paraCount,
        `Page ${page.label}: expected ≥3 <p> tags in body, got ${paraCount}`
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// a6: Sidebar shape on /cli/
// ---------------------------------------------------------------------------

describe("sidebar shape", () => {
  test("cli page sidebar has at least 4 anchors covering install, cli, harness-opencode, and assume", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }

    const html = readHtml("cli/index.html");

    // Extract sidebar region by id (more reliable than <nav> which also matches mobile menu)
    const sidebarMarker = 'id="starlight__sidebar"';
    const sidebarStart = html.indexOf(sidebarMarker);
    const sidebarHtml = sidebarStart >= 0 ? html.slice(sidebarStart) : html;

    // Count anchors in sidebar
    const anchors = sidebarHtml.match(/<a\s[^>]*href="[^"]*"[^>]*>/gi) ?? [];
    expect(
      anchors.length,
      `cli page sidebar: expected ≥4 anchors, got ${anchors.length}`
    ).toBeGreaterThanOrEqual(4);

    // Must include links to each major section (with or without trailing slash)
    expect(sidebarHtml, "sidebar should link to /install").toMatch(/href="\/install\/?"/);
    expect(sidebarHtml, "sidebar should link to /cli/").toContain("/cli/");
    expect(sidebarHtml, "sidebar should link to /harness-opencode/").toContain("/harness-opencode/");
    expect(sidebarHtml, "sidebar should link to /assume/").toContain("/assume/");
  });
});

// ---------------------------------------------------------------------------
// a7: No literal MDX passthrough in any built page body
// ---------------------------------------------------------------------------

describe("no MDX passthrough in built pages", () => {
  test("no built page contains literal MDX passthrough in its rendered body", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }

    const htmlFiles = walkHtmlFiles(distDir);
    expect(htmlFiles.length, "should have built HTML files").toBeGreaterThan(0);

    const mdxSignals = [
      'from "@astrojs/starlight/components"',
      "<cardgrid>",
      "</cardgrid>",
    ];

    const failures: string[] = [];

    for (const filePath of htmlFiles) {
      const html = readFileSync(filePath, "utf8");
      const body = extractBodyContent(html);
      const bodyLower = body.toLowerCase();

      // Check for "import {" — but only in body text, not in script tags
      // Strip script tags first to avoid false positives
      const bodyNoScripts = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
      if (bodyNoScripts.includes("import {")) {
        failures.push(`${filePath}: contains "import {" in body content`);
      }

      for (const signal of mdxSignals) {
        if (bodyLower.includes(signal.toLowerCase())) {
          failures.push(`${filePath}: contains MDX signal "${signal}" in body content`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `MDX passthrough detected in ${failures.length} page(s):\n` +
        failures.map((f) => `  - ${f}`).join("\n")
      );
    }
  });
});
