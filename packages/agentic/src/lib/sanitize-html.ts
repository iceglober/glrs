/** Strip dangerous HTML from content (script tags, dangerous elements, on* handlers, javascript: URLs). */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<(iframe|object|embed|svg)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "")
    .replace(/<(iframe|object|embed|svg)\b[^>]*\/?>(?!.*<\/\1>)/gi, "")
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\s+on\w+\s*=\s*[^\s>"']+/gi, "")
    .replace(/\bhref\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"')
    .replace(/\bhref\s*=\s*javascript:[^\s>]*/gi, 'href="#"');
}

/** Escape HTML special characters including single quotes (safe for use in attributes and inline JS). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
