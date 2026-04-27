const isTTY = process.stdout.isTTY;

export const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
export const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
export const red = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
export const green = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
export const yellow = (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s);
export const cyan = (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s);

export const ok = (msg: string) => console.log(`${green("✓")} ${msg}`);
export const okErr = (msg: string) => console.error(`${green("✓")} ${msg}`);
export const info = (msg: string) => console.log(`${cyan("▸")} ${msg}`);
export const warn = (msg: string) => console.error(`${yellow("warning:")} ${msg}`);
