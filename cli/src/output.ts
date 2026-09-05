/**
 * Terminal rendering: a small color palette, aligned tables and key/value
 * lists. JSON rendering lives in main.ts, where the envelope is stamped.
 */

const ANSI = /\u001b\[[0-9;]*m/g;

export const stripAnsi = (s: string): string => s.replace(ANSI, "");

export interface Fmt {
  readonly color: boolean;
  bold(s: string): string;
  dim(s: string): string;
  name(s: string): string;
  hash(s: string): string;
  added(s: string): string;
  removed(s: string): string;
}

export function makeFmt(color: boolean): Fmt {
  const wrap = (open: number, close: number) => (s: string) =>
    color ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    color,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    name: wrap(36, 39),
    hash: wrap(33, 39),
    added: wrap(32, 39),
    removed: wrap(31, 39),
  };
}

const width = (s: string) => stripAnsi(s).length;
const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - width(s)));

/** Space-aligned columns; the last column is never padded. */
export function table(rows: readonly (readonly string[])[], header?: readonly string[]): string {
  const all = header ? [header, ...rows] : rows;
  if (all.length === 0) return "";
  const cols = Math.max(...all.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(...all.map((r) => width(r[i] ?? ""))));
  const line = (r: readonly string[]) =>
    r.map((cell, i) => (i === cols - 1 ? cell : pad(cell, widths[i]!))).join("  ").trimEnd();
  return all.map(line).join("\n");
}

/** `key  value` lines with the keys right-aligned to one column. */
export function keyValues(pairs: readonly (readonly [string, string])[]): string {
  const w = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${" ".repeat(w - k.length)}${k}  ${v}`).join("\n");
}

/** Indent every non-empty line of a block. */
export function indent(block: string, spaces = 2): string {
  const p = " ".repeat(spaces);
  return block
    .split("\n")
    .map((l) => (l ? p + l : l))
    .join("\n");
}
