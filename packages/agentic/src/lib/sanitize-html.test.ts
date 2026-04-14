import { describe, test, expect } from "bun:test";
import { sanitizeHtml, escapeHtml } from "./sanitize-html.js";

describe("sanitizeHtml", () => {
  test("strips script tags", () => {
    expect(sanitizeHtml("<script>alert(1)</script>Hello")).toBe("Hello");
  });

  test("strips iframe tags", () => {
    expect(sanitizeHtml('<iframe src="evil"></iframe>Hi')).toBe("Hi");
  });

  test("strips svg with onload", () => {
    const result = sanitizeHtml('<svg onload=alert(1)>');
    expect(result).not.toContain("<svg");
    expect(result).not.toContain("onload");
  });

  test("strips onerror handler quoted", () => {
    expect(sanitizeHtml('<img onerror="alert(1)">')).not.toContain("onerror");
  });

  test("strips onerror handler unquoted", () => {
    expect(sanitizeHtml("<img onerror=alert(1)>")).not.toContain("onerror");
  });

  test("neutralizes javascript: href", () => {
    expect(sanitizeHtml('<a href="javascript:void(0)">')).not.toContain("javascript:");
  });

  test("preserves safe HTML", () => {
    expect(sanitizeHtml("<strong>bold</strong>")).toBe("<strong>bold</strong>");
  });

  test("strips object tags", () => {
    expect(sanitizeHtml('<object data="x"></object>safe')).toBe("safe");
  });

  test("strips embed tags", () => {
    expect(sanitizeHtml('<embed src="x">safe')).toBe("safe");
  });
});

describe("escapeHtml", () => {
  test("escapes angle brackets", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  test("escapes double quotes", () => {
    expect(escapeHtml('a"b')).toBe("a&quot;b");
  });

  test("escapes single quotes", () => {
    expect(escapeHtml("a'b")).toBe("a&#39;b");
  });

  test("escapes ampersand", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  test("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  test("handles multiple special chars", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;");
  });
});
