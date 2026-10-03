/**
 * `search <pattern>` - find a class by case-insensitive substring, or by
 * glob when the pattern contains `*` or `?`. Matches names and hashes.
 *
 * `--domain <id>` keeps only the classes placed in that domain; the pattern
 * is then optional, and without one the whole domain is listed.
 */

import { CliError } from "../outcome";
import { table } from "../output";
import { type Command, type Context, expectArgs } from "./shared";

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

/** The names of the classes in `domain`; an id the API does not list is an error, not an empty answer. */
async function domainMembers(source: Context["source"], domain: string): Promise<Set<string>> {
  const list = await source.domainClasses(domain);
  if (!list) throw new CliError(`no such domain: ${domain}`, "list the ids with `rito-meta domains`");
  return new Set(list.classes);
}

export const search: Command = async (ctx, args) => {
  const domain = ctx.flags.domain;
  expectArgs("search", args, domain === undefined ? 1 : 0, 1, "one argument: <pattern> (optional with --domain)");
  const pattern = args[0];
  const match = pattern === undefined ? () => true : matcher(pattern);
  const members = domain === undefined ? null : await domainMembers(ctx.source, domain);
  const index = await ctx.source.hashes();
  const matches = Object.entries(index.classes)
    .map(([hash, name]) => ({ name: name ?? hash, hash }))
    .filter((c) => (!members || members.has(c.name)) && (match(c.name) || match(c.hash)))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    outcome: "ok",
    payload: { ...(pattern !== undefined && { pattern }), ...(domain !== undefined && { domain }), count: matches.length, matches },
    text: (fmt) =>
      matches.length === 0
        ? `no class${domain === undefined ? "" : ` in ${fmt.bold(domain)}`}${pattern === undefined ? "" : ` matches ${fmt.bold(pattern)}`}`
        : table(matches.map((m) => [fmt.name(m.name), fmt.hash(m.hash)])),
  };
};
