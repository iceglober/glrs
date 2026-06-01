#!/usr/bin/env bun
/**
 * gen-docs — regenerate docs-site reference content from code.
 *
 * Single source of truth lives in the harness package: agent identity in
 * `src/agents/names.ts`, commands in `src/commands/`, skills in
 * `src/skills/*\/SKILL.md`. This script renders three docs-site pages from
 * that data so the docs can't silently drift when an agent/command/skill is
 * added, removed, or renamed.
 *
 *   bun run gen-docs          # write the files
 *   bun run gen-docs --check  # fail (exit 1) if the on-disk files are stale
 *
 * Custom prose per item:
 *   - agents : the short "role" blurb in AGENT_DOC_META (names.ts)
 *   - commands: one markdown file per command in src/commands/docs/<name>.md
 *   - skills : the `description` frontmatter in each SKILL.md
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  AGENT_NAMES,
  AGENT_TIERS,
  AGENT_DOC_META,
  displayTier,
  type AgentName,
  type AgentCategory,
} from "../packages/agent-core/src/index.js";
import {
  createCommands,
  COMMAND_DOC_ORDER,
} from "../packages/harness-opencode/src/commands/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const HARNESS = join(REPO_ROOT, "packages", "harness-opencode", "src");
const CONTENT_DIR = join(REPO_ROOT, "docs-site", "src", "content");
const COMMAND_PROSE_DIR = join(HARNESS, "commands", "docs");
const SKILLS_DIR = join(HARNESS, "skills");

/** Parse the `description` field out of a SKILL.md YAML frontmatter block. */
function skillDescription(skillMd: string): string {
  if (!skillMd.startsWith("---")) return "";
  const end = skillMd.indexOf("\n---", 3);
  if (end === -1) return "";
  const block = skillMd.slice(4, end);
  const lines = block.split("\n");
  const parts: string[] = [];
  let capturing = false;
  for (const line of lines) {
    const m = /^description:\s*(.*)$/.exec(line);
    if (m) {
      capturing = true;
      const inline = m[1].trim();
      // `|` / `>` (with optional chomping like `|-`) are block-scalar
      // indicators, not the value itself — the text follows on indented lines.
      if (inline && !/^[|>][+-]?$/.test(inline)) parts.push(inline);
      continue;
    }
    if (capturing) {
      // Continuation lines are indented; a new top-level key ends the value.
      if (/^\S/.test(line)) break;
      parts.push(line.trim());
    }
  }
  let desc = parts.join(" ").replace(/\s+/g, " ").trim();
  // Strip a single layer of surrounding YAML quotes.
  if (
    (desc.startsWith('"') && desc.endsWith('"')) ||
    (desc.startsWith("'") && desc.endsWith("'"))
  ) {
    desc = desc.slice(1, -1).trim();
  }
  return desc;
}

/** Markdown-escape a table cell value (pipes would break the column). */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

// ---- agents.md ----

function renderAgentsDoc(): string {
  const byCategory = (cat: AgentCategory): AgentName[] =>
    AGENT_NAMES.filter((n) => AGENT_DOC_META[n].category === cat);

  const userSelectable = byCategory("user-selectable");
  const subagents = byCategory("subagent");
  const autopilot = byCategory("autopilot");
  const costVariants = byCategory("cost-variant");

  const roleRows = (names: AgentName[]) =>
    names
      .map(
        (n) =>
          `| \`${n}\` | ${displayTier(AGENT_TIERS[n])} | ${cell(AGENT_DOC_META[n].role)} |`,
      )
      .join("\n");

  const variantRows = (names: AgentName[]) =>
    names
      .map((n) => {
        const base = AGENT_DOC_META[n].base;
        return `| \`${n}\` | ${AGENT_TIERS[n]} | \`${base}\` |`;
      })
      .join("\n");

  return `# Agents

${AGENT_NAMES.length} agents. ${userSelectable.length} user-selectable, the rest are subagents dispatched automatically.

## User-selectable

Pick these via Tab in OpenCode.

| Agent | Tier | Role |
|-------|------|------|
${roleRows(userSelectable)}

## Subagents

Dispatched by user-selectable agents. You don't pick these directly.

| Agent | Tier | Role |
|-------|------|------|
${roleRows(subagents)}

## Autopilot-only

Used by [\`glrs loop\`](/autopilot). Not user-selectable.

| Agent | Tier | Role |
|-------|------|------|
${roleRows(autopilot)}

## Cost-optimized variants

Automatic cost cascading — try cheap first, escalate on failure.

| Agent | Tier | Base |
|-------|------|------|
${variantRows(costVariants)}

## Tiers

| Tier | Model class | Override |
|------|------------|---------|
| deep | Opus-class | \`harness.models.deep\` |
| mid | Sonnet-class | \`harness.models.mid\` |
| mid-execute | Sonnet-class | \`harness.models.mid\` |
| fast | Haiku-class | \`harness.models.fast\` |
| cheap | GLM 4.7 Flash | \`harness.models.cheap\` |

See [configuration](/harness/config) for model overrides.
`;
}

// ---- commands.md ----

function renderCommandsDoc(): string {
  const commands = createCommands(REPO_ROOT);
  const registered = new Set(Object.keys(commands));
  const ordered = new Set<string>(COMMAND_DOC_ORDER);

  // Sync guards: every registered command must be ordered, and vice versa.
  for (const name of registered) {
    if (!ordered.has(name)) {
      throw new Error(
        `gen-docs: command "${name}" is registered but missing from COMMAND_DOC_ORDER (src/commands/index.ts).`,
      );
    }
  }
  for (const name of ordered) {
    if (!registered.has(name)) {
      throw new Error(
        `gen-docs: COMMAND_DOC_ORDER lists "${name}" but it is not registered by createCommands().`,
      );
    }
  }

  const sections = COMMAND_DOC_ORDER.map((name) => {
    const prosePath = join(COMMAND_PROSE_DIR, `${name}.md`);
    if (!existsSync(prosePath)) {
      throw new Error(
        `gen-docs: missing command prose file ${prosePath}. Create it (the curated /${name} section body).`,
      );
    }
    const prose = readFileSync(prosePath, "utf8").trim();
    return `## /${name}\n\n${prose}`;
  });

  return `# Commands

${COMMAND_DOC_ORDER.length} slash commands available inside OpenCode. Type them in the chat input.

${sections.join("\n\n")}
`;
}

// ---- skills.md ----

function renderSkillsDoc(): string {
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, "SKILL.md")))
    .sort();

  const rows = entries
    .map((name) => {
      const md = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
      return `| \`${name}\` | ${cell(skillDescription(md))} |`;
    })
    .join("\n");

  return `# Skills

${entries.length} bundled skills. The harness loads them automatically; agents pull a skill into context with the Skill tool when its trigger matches.

| Skill | Description |
|-------|-------------|
${rows}
`;
}

// ---- driver ----

const TARGETS: Array<{ file: string; render: () => string }> = [
  { file: "agents.md", render: renderAgentsDoc },
  { file: "commands.md", render: renderCommandsDoc },
  { file: "skills.md", render: renderSkillsDoc },
];

const checkOnly = process.argv.includes("--check");
let drift = 0;

for (const { file, render } of TARGETS) {
  const target = join(CONTENT_DIR, file);
  const next = render();
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;

  if (checkOnly) {
    if (current !== next) {
      drift++;
      console.error(`✗ ${file} is stale — run \`bun run gen-docs\``);
    } else {
      console.log(`✓ ${file} up to date`);
    }
  } else if (current === next) {
    console.log(`= ${file} unchanged`);
  } else {
    writeFileSync(target, next);
    console.log(`✎ ${file} written`);
  }
}

if (checkOnly && drift > 0) {
  console.error(`\n${drift} doc file(s) out of sync with code.`);
  process.exit(1);
}
