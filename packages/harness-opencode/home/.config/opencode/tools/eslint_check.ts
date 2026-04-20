import { tool } from "@opencode-ai/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export default tool({
  description: "Run eslint on specific files. Returns lint errors as JSON.",
  args: {
    files: tool.schema
      .array(tool.schema.string())
      .describe("Files or globs to lint"),
    fix: tool.schema
      .boolean()
      .default(false)
      .describe("If true, auto-fix safe issues"),
  },
  async execute(args, context) {
    const cmdArgs = ["eslint", "--format", "json"];
    if (args.fix) cmdArgs.push("--fix");
    cmdArgs.push(...args.files);
    try {
      const { stdout } = await exec("npx", cmdArgs, {
        maxBuffer: 10 * 1024 * 1024,
        cwd: context.directory,
        encoding: "utf8",
      });
      return String(stdout || "[]");
    } catch (err) {
      const e = err as { stdout?: string; message: string };
      return String(e.stdout || `eslint error: ${e.message}`);
    }
  },
});
