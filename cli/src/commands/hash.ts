/**
 * `hash <hashOrName>` - a name to its hash and back, plus the wiki URL.
 *
 * Reads the API's lookup tables (`/v1/hashes`, `/v1/index`), which cover
 * external engine types as well as dumped classes.
 */

import { HEX, canon } from "../../../api/scripts/lib/resolver";
import { keyValues } from "../output";
import type { LinkKind } from "../tags";
import { type Command, expectArgs, noSuchClass } from "./shared";

interface Resolved {
  hash: string;
  name: string | null;
  kind: LinkKind;
}

export const hash: Command = async (ctx, args) => {
  expectArgs("hash", args, 1, 1, "one argument: <hashOrName>");
  const query = args[0]!;
  const index = await ctx.source.hashes();

  let resolved: Resolved | null = null;
  if (HEX.test(query)) {
    const h = canon(query);
    if (h in index.classes) resolved = { hash: h, name: index.classes[h] ?? null, kind: "class" };
    else if (h in index.externals) resolved = { hash: h, name: index.externals[h]!, kind: "external" };
  } else {
    const cls = Object.entries(index.classes).find(([, name]) => name === query);
    const ext = cls ? undefined : Object.entries(index.externals).find(([, name]) => name === query);
    if (cls) resolved = { hash: cls[0], name: query, kind: "class" };
    else if (ext) resolved = { hash: ext[0], name: query, kind: "external" };
  }
  if (!resolved) return noSuchClass(query);

  const url = resolved.kind === "class" ? ((await ctx.source.wikiIndex())[resolved.name ?? resolved.hash] ?? null) : null;
  return {
    outcome: "ok",
    payload: { query, ...resolved, url },
    text: (fmt) =>
      keyValues([
        ["hash", fmt.hash(resolved.hash)],
        ["name", resolved.name === null ? fmt.dim("(unknown)") : fmt.name(resolved.name)],
        ["kind", resolved.kind],
        ["url", url ?? "-"],
      ]),
  };
};
