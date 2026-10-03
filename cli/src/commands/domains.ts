/**
 * `domains` - the domains every class is placed in, in the wiki's display
 * order, with how many classes each one holds.
 */

import { table } from "../output";
import { type Command, expectArgs } from "./shared";

export const domains: Command = async (ctx, args) => {
  expectArgs("domains", args, 0, 0, "no arguments");
  const list = await ctx.source.categories();
  return {
    outcome: "ok",
    payload: { count: list.count, domains: list.domains },
    text: (fmt) =>
      table(
        list.domains.map((d) => [
          fmt.bold(d.id),
          d.title + (d.unreleased ? fmt.dim(" (unreleased)") : ""),
          String(d.counts.classes),
          String(d.counts.live),
          String(d.counts.unnamed),
          String(d.counts.documented),
        ]),
        ["domain", "title", "classes", "live", "unnamed", "documented"]
      ),
  };
};
