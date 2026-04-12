import { describe, test, expect } from "bun:test";
import { renderStatePage, escapeHtml } from "./state-html.js";

describe("renderStatePage", () => {
  test("returns valid HTML document", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  test("embeds CSS styles", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("<style>");
  });

  test("embeds JavaScript with fetch", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("fetch(");
    expect(html).toContain("/api/state");
  });

  test("contains app container", () => {
    const html = renderStatePage(3000);
    expect(html).toContain('id="app"');
  });

  test("uses correct API port", () => {
    const html = renderStatePage(4567);
    expect(html).toContain("localhost:4567");
  });
});

describe("escapeHtml", () => {
  test("escapes angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes ampersands", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });
});
