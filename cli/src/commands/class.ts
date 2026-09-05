/**
 * `class <nameOrHash>` - hash, flags, bases, lifetime and properties.
 *
 * `--inherited` serves the flattened view (each property stamped with the
 * class defining it), `--tree` adds the descendant tree, and `--at` narrows
 * the properties to those in force at that point in time, typed as they
 * were then.
 */

import type { ApiDescendantNode } from "../api-types";
import { classLiveAt, propertyAt, propertyHistory } from "../at";
import { indent, keyValues, table } from "../output";
import { type TypeShape, typeShape } from "../tags";
import { type Answer, type Command, atText, classRef, definingClasses, expectArgs, historyPayload, noSuchClass, resolveAt, typeText } from "./shared";

interface ClassProperty {
  name: string;
  hash: string;
  type: TypeShape;
  since?: string;
  removedIn?: string;
  defaultValue?: string;
  from?: string;
  history?: ReturnType<typeof historyPayload>;
}

export const classCommand: Command = async (ctx, args) => {
  expectArgs("class", args, 1, 1, "one argument: <nameOrHash>");
  const query = args[0]!;
  const vm = await ctx.source.versions();
  const resolved = ctx.flags.at === undefined ? null : resolveAt(vm, ctx.flags.at);
  if (resolved && "answer" in resolved) return resolved.answer;
  const at = resolved?.at ?? null;

  const cls = await ctx.source.class(query, ctx.flags.inherited);
  if (!cls) return noSuchClass(query);

  if (at && !classLiveAt(cls, at)) {
    const answer: Answer = {
      outcome: "not-at-build",
      payload: { class: classRef(cls), at, since: cls.since, removedIn: cls.removedIn },
      text: (fmt) =>
        `${fmt.name(cls.name)} did not exist at ${atText(at)}\n` +
        indent(keyValues([["since", cls.since ?? "start of tracking"], ["removed in", cls.removedIn ?? "-"]])),
    };
    return answer;
  }

  const owners = cls.flattened ? await definingClasses(ctx.source, cls) : new Map([[cls.name, cls]]);
  const properties: ClassProperty[] = [];
  for (const p of cls.properties) {
    const owner = owners.get(p.from ?? cls.name) ?? cls;
    const rev = at ? propertyAt(cls, owner, p, at, vm) : null;
    if (at && !rev) continue;
    const type = rev?.type ?? typeShape(p);
    properties.push({
      name: p.name,
      hash: p.hash,
      type,
      ...(p.since !== undefined && { since: p.since }),
      ...(p.removedIn !== undefined && { removedIn: p.removedIn }),
      ...(rev?.defaultValue !== undefined ? { defaultValue: rev.defaultValue } : p.defaultValue !== undefined && { defaultValue: p.defaultValue }),
      ...(p.from !== undefined && { from: p.from }),
      ...(p.history && { history: historyPayload(propertyHistory(owner, p, vm)) }),
    });
  }

  const payload = {
    class: {
      name: cls.name,
      hash: cls.hash,
      interface: cls.interface,
      value: cls.value,
      bases: cls.bases,
      since: cls.since,
      removedIn: cls.removedIn,
      ancestorLevels: cls.ancestorLevels,
      ...(cls.flattened && { flattened: true }),
      properties,
      ...(ctx.flags.tree && { descendants: cls.descendantTree }),
    },
    ...(at && { at }),
  };

  return {
    outcome: "ok",
    payload,
    text: (fmt) => {
      const flags = [cls.interface && "interface", cls.value && "value"].filter(Boolean).join(", ") || "-";
      const pairs: [string, string][] = [
        ["hash", fmt.hash(cls.hash)],
        ["flags", flags],
        ["bases", cls.bases.length ? cls.bases.map(fmt.name).join(", ") : "-"],
        ["ancestors", cls.ancestorLevels.length ? cls.ancestorLevels.map((l) => l.join(", ")).join(" > ") : "-"],
        ["since", cls.since ?? "start of tracking"],
        ["removed in", cls.removedIn ?? "-"],
      ];
      if (at) pairs.push(["at", atText(at)]);
      let out = `${fmt.bold(fmt.name(cls.name))}\n` + indent(keyValues(pairs));
      const header = ["property", "type", "since", "default", ...(cls.flattened ? ["from"] : [])];
      const rows = properties.map((p) => [
        p.removedIn ? fmt.removed(p.name) : p.name,
        typeText(p.type),
        p.removedIn ? `${p.since ?? "start"} .. ${p.removedIn}` : (p.since ?? ""),
        p.defaultValue ?? "",
        ...(cls.flattened ? [p.from ?? ""] : []),
      ]);
      out += `\n\nproperties (${properties.length})\n` + (rows.length ? indent(table(rows, header)) : "  none");
      if (ctx.flags.tree) out += "\n\ndescendants\n" + (cls.descendantTree.length ? indent(treeLines(cls.descendantTree).join("\n")) : "  none");
      return out;
    },
  };
};

function treeLines(nodes: ApiDescendantNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [`${"  ".repeat(depth)}${n.name}`, ...treeLines(n.children, depth + 1)]);
}
