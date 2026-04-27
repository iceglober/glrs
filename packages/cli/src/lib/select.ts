import { bold, dim, cyan, green } from "./fmt.js";

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

export interface Group<T> {
  title: string;
  choices: Choice<T>[];
}

interface FlatItem<T> {
  type: "header" | "choice";
  label: string;
  hint?: string;
  value?: T;
}

function flatten<T>(groups: Group<T>[]): FlatItem<T>[] {
  const items: FlatItem<T>[] = [];
  for (const group of groups) {
    items.push({ type: "header", label: group.title });
    for (const choice of group.choices) {
      items.push({
        type: "choice",
        label: choice.label,
        hint: choice.hint,
        value: choice.value,
      });
    }
  }
  return items;
}

function selectableIndices<T>(items: FlatItem<T>[]): number[] {
  return items.reduce<number[]>((acc, item, i) => {
    if (item.type === "choice") acc.push(i);
    return acc;
  }, []);
}

/** Interactive single-select picker with groups. Returns null on cancel. */
export function select<T>(opts: {
  message: string;
  groups: Group<T>[];
}): Promise<T | null> {
  const items = flatten(opts.groups);
  const selectable = selectableIndices(items);
  if (selectable.length === 0) return Promise.resolve(null);

  let cursor = 0;

  return new Promise<T | null>((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      resolve(null);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write("\x1b[?25l");

    let lineCount = 0;

    function render() {
      let out = "";
      if (lineCount > 0) out += `\x1b[${lineCount}A`;
      const lines: string[] = [];
      lines.push(`${cyan("?")} ${bold(opts.message)}`);
      lines.push("");
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === "header") {
          lines.push(`  ${bold(item.label)}`);
        } else {
          const active = selectable[cursor] === i;
          const prefix = active ? cyan("> ") : "  ";
          const label = active ? item.label : dim(item.label);
          const hint = item.hint ? `  ${dim(item.hint)}` : "";
          lines.push(`${prefix}${label}${hint}`);
        }
      }
      out += lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n";
      stdout.write(out);
      lineCount = lines.length;
    }

    function cleanup() {
      stdin.removeListener("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\x1b[?25h");
    }

    function onKey(data: string) {
      if (data === "\x03") {
        cleanup();
        process.exit(130);
        return;
      }
      if (data === "\r" || data === "\n") {
        cleanup();
        resolve(items[selectable[cursor]].value!);
        return;
      }
      if (data === "\x1b[A" || data === "k") {
        cursor = Math.max(0, cursor - 1);
        render();
      } else if (data === "\x1b[B" || data === "j") {
        cursor = Math.min(selectable.length - 1, cursor + 1);
        render();
      }
    }

    stdin.on("data", onKey);
    render();
  });
}

/** Interactive multi-select picker with groups. Returns empty array on cancel. */
export function multiSelect<T>(opts: {
  message: string;
  groups: Group<T>[];
}): Promise<T[]> {
  const items = flatten(opts.groups);
  const selectable = selectableIndices(items);
  if (selectable.length === 0) return Promise.resolve([]);

  let cursor = 0;
  const selected = new Set<number>();

  return new Promise<T[]>((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      resolve([]);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write("\x1b[?25l");

    let lineCount = 0;

    function render() {
      let out = "";
      if (lineCount > 0) out += `\x1b[${lineCount}A`;
      const lines: string[] = [];
      lines.push(
        `${cyan("?")} ${bold(opts.message)} ${dim("(space = toggle, enter = confirm)")}`,
      );
      lines.push("");
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === "header") {
          lines.push(`  ${bold(item.label)}`);
        } else {
          const idx = selectable.indexOf(i);
          const active = cursor === idx;
          const checked = selected.has(idx);
          const box = checked ? green("[x]") : dim("[ ]");
          const prefix = active ? cyan("> ") : "  ";
          const hint = item.hint ? `  ${dim(item.hint)}` : "";
          lines.push(`${prefix}${box} ${item.label}${hint}`);
        }
      }
      out += lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n";
      stdout.write(out);
      lineCount = lines.length;
    }

    function cleanup() {
      stdin.removeListener("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\x1b[?25h");
    }

    function onKey(data: string) {
      if (data === "\x03") {
        cleanup();
        process.exit(130);
        return;
      }
      if (data === "\r" || data === "\n") {
        cleanup();
        resolve([...selected].map((idx) => items[selectable[idx]].value!));
        return;
      }
      if (data === " ") {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        render();
      } else if (data === "\x1b[A" || data === "k") {
        cursor = Math.max(0, cursor - 1);
        render();
      } else if (data === "\x1b[B" || data === "j") {
        cursor = Math.min(selectable.length - 1, cursor + 1);
        render();
      }
    }

    stdin.on("data", onKey);
    render();
  });
}
