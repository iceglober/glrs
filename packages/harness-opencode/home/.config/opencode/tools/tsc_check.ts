import { tool } from "@opencode-ai/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export default tool({
  description:
    "Run TypeScript compiler in noEmit mode on the project. Returns errors only. " +
    "Faster than running the full test suite for type-correctness checks.",
  args: {
    project: tool.schema
      .string()
      .default("tsconfig.json")
      .describe("Path to tsconfig.json (relative to the project directory)"),
  },
  async execute(args, context) {
    try {
      const { stdout, stderr } = await exec(
        "npx",
        ["tsc", "--noEmit", "--project", args.project, "--pretty", "false"],
        { maxBuffer: 10 * 1024 * 1024, cwd: context.directory, encoding: "utf8" },
      );
      const out = String(stdout || "(no errors)");
      const warn = stderr ? `\n[warnings]\n${String(stderr)}` : "";
      return out + warn;
    } catch (err) {
      const e = err as { stdout?: string; message: string; code?: number };
      return String(e.stdout || e.message);
    }
  },
});
