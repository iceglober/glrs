/** Convert a string to a URL/branch-safe kebab-case slug. */
export function slugify(text: string, maxLen = 50): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length <= maxLen) return slug;

  // Truncate on a word boundary (at a hyphen)
  const truncated = slug.slice(0, maxLen);
  const lastHyphen = truncated.lastIndexOf("-");
  return lastHyphen > 10 ? truncated.slice(0, lastHyphen) : truncated;
}
