import { describe, test, expect } from "bun:test";
import { renderStatePage } from "./state-html.js";

describe("renderStatePage", () => {
  test("returns valid HTML document", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  test("loads React from CDN", () => {
    const html = renderStatePage(3000);
    expect(html).toMatch(/src="[^"]*react@/);
  });

  test("loads htm from CDN", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("htm");
    expect(html).toContain("cdn.jsdelivr.net/npm/htm");
  });

  test("uses correct API port", () => {
    const html = renderStatePage(4567);
    expect(html).toContain("localhost:4567");
  });

  test("all mode embeds all flag in fetch URL", () => {
    const html = renderStatePage(3000, { all: true });
    expect(html).toContain("all=true");
  });

  test("default mode does not include all param", () => {
    const html = renderStatePage(3000);
    expect(html).not.toContain("all=true");
  });

  test("no innerHTML usage", () => {
    const html = renderStatePage(3000);
    expect(html).not.toContain(".innerHTML");
  });

  test("embeds CSS styles", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("<style>");
  });

  test("contains root mount point", () => {
    const html = renderStatePage(3000);
    expect(html).toContain('id="root"');
  });
});
