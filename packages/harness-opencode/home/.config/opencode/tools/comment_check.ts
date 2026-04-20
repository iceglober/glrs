import { tool } from "@opencode-ai/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const DEFAULT_TYPES = ["TODO", "FIXME", "HACK", "XXX", "DEPRECATED"] as const;

export default tool({
  description:
    "Find attributed code annotations like @TODO(alice), @FIXME, @HACK, @XXX, " +
    "@DEPRECATED. Returns structured matches with author if captured, plus " +
    "optional age-in-days via git blame. Use this before planning or editing " +
    "an area to inventory known tech debt.",
  args: {
    paths: tool.schema
      .array(tool.schema.string())
      .default(["."])
      .describe("Files or directories to scan"),
    types: tool.schema
      .array(tool.schema.string())
      .default([...DEFAULT_TYPES])
      .describe("Annotation types to surface (e.g. TODO, FIXME, HACK, DEPRECATED)"),
    includeAge: tool.schema
      .boolean()
      .default(false)
      .describe(
        "If true, run git blame per match to determine age in days (slow on large result sets)",
      ),
    maxResults: tool.schema
      .number()
      .default(100)
      .describe("Cap on matches returned"),
  },
  async execute(args, context) {
    const typesAlt = args.types.join("|");
    const pattern = `@(${typesAlt})(\\(([^)]+)\\))?`;
    const rgArgs = [
      "--line-number",
      "--no-heading",
      "--color=never",
      "-e",
      pattern,
      ...args.paths,
    ];

    let raw: string;
    try {
      const { stdout } = await exec("rg", rgArgs, {
        cwd: context.directory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      raw = String(stdout);
    } catch (err) {
      const e = err as { code?: number; message: string };
      if (e.code === 1) return "(no annotations found)";
      return `rg error: ${e.message}`;
    }

    const annotRe = new RegExp(`@(${typesAlt})(?:\\(([^)]+)\\))?`);
    const lineRe = /^(.+?):(\d+):(.*)$/;

    const rows: string[] = [];
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      if (rows.length >= args.maxResults) break;
      const parts = line.match(lineRe);
      if (!parts) continue;
      const [, file, lineStr, text] = parts;
      const am = text.match(annotRe);
      if (!am) continue;
      const type = am[1];
      const author = am[2] ?? "";
      let age = "";
      if (args.includeAge) {
        try {
          const { stdout: blame } = await exec(
            "git",
            ["log", "-1", "--format=%ct", "-L", `${lineStr},${lineStr}:${file}`],
            { cwd: context.directory, encoding: "utf8", maxBuffer: 1024 * 1024 },
          );
          const ts = parseInt(String(blame).trim().split("\n")[0] ?? "", 10);
          if (!Number.isNaN(ts)) {
            age = ` (${Math.floor((Date.now() / 1000 - ts) / 86400)}d old)`;
          }
        } catch {
          // blame can fail for newly added lines; non-fatal
        }
      }
      const authorPart = author ? ` [${author}]` : "";
      rows.push(`${file}:${lineStr} @${type}${authorPart}${age} — ${text.trim().slice(0, 200)}`);
    }

    if (rows.length === 0) return "(no annotations found)";
    const truncated =
      lines.length > args.maxResults
        ? `\n\n[truncated: ${lines.length - args.maxResults} more]`
        : "";
    return rows.join("\n") + truncated;
  },
});
