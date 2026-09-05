/**
 * `search <pattern>` - find a class by case-insensitive substring, or by
 * glob when the pattern contains `*` or `?`. Matches names and hashes.
 */

import { table } from "../output";
import { type Command, expectArgs } from "./shared";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive matcher: a glob when the pattern has wildcards, else a substring. */
export function matcher(pattern: string): (s: string) => boolean {
  if (/[*?]/.test(pattern)) {
    const re = new RegExp(`^${pattern.split(/([*?])/).map((part) => (part === "*" ? ".*" : part === "?" ? "." : escapeRegex(part))).join("")}$`, "i");
    return (s) => re.test(s);
  }
  const needle = pattern.toLowerCase();
  return (s) => s.toLowerCase().includes(needle);
}

export const search: Command = async (ctx, args) => {
  expectArgs("search", args, 1, 1, "one argument: <pattern>");
  const pattern = args[0]!;
  const match = matcher(pattern);
  const index = await ctx.source.hashes();
  const matches = Object.entries(index.classes)
    .map(([hash, name]) => ({ name: name ?? hash, hash }))
    .filter((c) => match(c.name) || match(c.hash))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    outcome: "ok",
    payload: { pattern, count: matches.length, matches },
    text: (fmt) =>
      matches.length === 0
        ? `no class matches ${fmt.bold(pattern)}`
        : table(matches.map((m) => [fmt.name(m.name), fmt.hash(m.hash)])),
  };
};
