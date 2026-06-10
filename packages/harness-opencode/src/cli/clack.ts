/**
 * clack — thin wrappers around @clack/prompts for `glrs harness configure`.
 *
 * @clack/prompts gives us the menu behavior we previously hand-rolled
 * (esc-prompts.ts, now deleted): Esc cancels any prompt out of the box
 * (@clack/core maps both `escape` and Ctrl+C to the cancel action), prompts
 * resolve a cancel symbol testable via `isCancel`, and `autocomplete` covers
 * the type-to-filter model picker. These wrappers add the two conventions
 * the configure flow relies on:
 *
 * - cancel (Esc / Ctrl+C) resolves a caller-supplied `backValue` — menus pop
 *   a layer instead of aborting the process. Consequence: Ctrl+C also means
 *   "back", not "exit"; the top-level menu treats back as Done.
 * - non-TTY resolves `backValue` immediately (same convention as
 *   plugin-check.ts) so headless invocations never hang on a prompt.
 */

import {
  select,
  autocomplete,
  multiselect,
  text,
  isCancel,
} from "@clack/prompts";

type MenuValue = Readonly<string | number | boolean>;

export interface MenuOption<T extends MenuValue = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** Single choice from a fixed list. Esc/Ctrl+C resolves `backValue`. */
export async function menuSelect<T extends MenuValue>(
  message: string,
  options: MenuOption<T>[],
  backValue: T,
  maxItems?: number,
): Promise<T> {
  if (!process.stdin.isTTY) return backValue;
  const result = await select<T>({
    message,
    // MenuOption always carries a label, satisfying both branches of clack's
    // conditional Option<T> — but TS can't resolve the conditional over a
    // generic T, so cast at the boundary.
    options: options as never,
    ...(maxItems !== undefined ? { maxItems } : {}),
  });
  return isCancel(result) ? backValue : result;
}

/** Type-to-filter choice from a large list. Esc/Ctrl+C resolves `backValue`. */
export async function menuAutocomplete<T extends MenuValue>(
  message: string,
  options: MenuOption<T>[],
  backValue: T,
): Promise<T> {
  if (!process.stdin.isTTY) return backValue;
  const result = await autocomplete<T>({
    message,
    options: options as never,
    placeholder: "Type to filter…",
    maxItems: 12,
  });
  return isCancel(result) ? backValue : (result as T);
}

/**
 * Checkbox multi-select. Resolves the selected values, or `null` when the
 * user backs out (Esc/Ctrl+C/non-TTY) — callers must treat null as
 * "no change", never as "empty selection".
 */
export async function menuMultiselect<T extends MenuValue>(
  message: string,
  options: MenuOption<T>[],
  initialValues: T[],
): Promise<T[] | null> {
  if (!process.stdin.isTTY) return null;
  const result = await multiselect<T>({
    message,
    options: options as never,
    initialValues,
    required: false,
  });
  return isCancel(result) ? null : result;
}

/** Free-text input. Resolves null when backed out or left empty. */
export async function menuText(
  message: string,
  opts: { initialValue?: string; placeholder?: string } = {},
): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const result = await text({
    message,
    ...(opts.initialValue ? { initialValue: opts.initialValue } : {}),
    ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
  });
  if (isCancel(result)) return null;
  return result ? String(result) : null;
}

export { intro, outro, note, isCancel } from "@clack/prompts";
