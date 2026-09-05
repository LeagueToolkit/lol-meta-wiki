/**
 * `property <Class>.<field>` - the type of one property at one point in time.
 *
 * Looks the class up in the inherited view so a property defined on an
 * ancestor still answers, and names the defining class when it differs.
 */

import { propertyAt, propertyHistory } from "../at";
import type { ApiClass } from "../api-types";
import { UsageError } from "../outcome";
import { indent, keyValues, table } from "../output";
import { type Answer, type Command, atText, classRef, expectArgs, findProperty, historyPayload, historyRows, noSuchClass, resolveAt, typeText } from "./shared";

export const property: Command = async (ctx, args) => {
  expectArgs("property", args, 1, 1, "one argument: <Class>.<field>");
  const target = args[0]!;
  const dot = target.indexOf(".");
  if (dot <= 0 || dot === target.length - 1) throw new UsageError(`expected <Class>.<field>, got ${target}`);
  const className = target.slice(0, dot);
  const field = target.slice(dot + 1);

  const vm = await ctx.source.versions();
  const resolved = resolveAt(vm, ctx.flags.at);
  if ("answer" in resolved) return resolved.answer;
  const { at } = resolved;

  const cls = await ctx.source.class(className, true);
  if (!cls) return noSuchClass(className);
  const prop = findProperty(cls, field);
  if (!prop) return noSuchProperty(cls, field);

  const definedOn = prop.from !== undefined && prop.from !== cls.name ? prop.from : undefined;
  const owner = definedOn === undefined ? cls : ((await ctx.source.class(definedOn, false)) ?? cls);
  const history = propertyHistory(owner, prop, vm);
  const rev = propertyAt(cls, owner, prop, at, vm);
  const label = `${cls.name}.${prop.name}`;
  const base = {
    class: classRef(cls),
    property: { name: prop.name, hash: prop.hash, ...(definedOn !== undefined && { definedOn }) },
    at,
  };

  if (!rev) {
    const lifetime = { since: prop.since ?? owner.since ?? null, removedIn: prop.removedIn ?? owner.removedIn ?? null };
    return {
      outcome: "not-at-build",
      payload: { ...base, ...lifetime, history: historyPayload(history) },
      text: (fmt) =>
        `${fmt.name(label)} has no revision at ${atText(at)}\n` +
        indent(
          keyValues([
            ["since", lifetime.since ?? "start of tracking"],
            ["removed in", lifetime.removedIn ?? "-"],
          ]) +
            "\n\nhistory\n" +
            indent(table(historyRows(history)))
        ),
    };
  }

  return {
    outcome: "ok",
    payload: {
      ...base,
      type: rev.type,
      since: rev.since,
      until: rev.until,
      ...(rev.defaultValue !== undefined && { defaultValue: rev.defaultValue }),
      history: historyPayload(history),
    },
    text: (fmt) => {
      const pairs: [string, string][] = [
        ["type", `${fmt.bold(typeText(rev.type))}${rev.type.keyHash ? `  ${fmt.hash(rev.type.keyHash.hash)}` : ""}`],
        ["at", atText(at)],
        ["since", rev.since ?? "start of tracking"],
        ["until", rev.until ?? "current"],
      ];
      if (rev.defaultValue !== undefined) pairs.push(["default", rev.defaultValue]);
      if (definedOn !== undefined) pairs.push(["defined on", fmt.name(definedOn)]);
      let out = `${fmt.name(label)}  ${fmt.dim(prop.hash)}\n` + indent(keyValues(pairs));
      if (history.length > 1) out += "\n\nhistory\n" + indent(table(historyRows(history)));
      return out;
    },
  };
};

function noSuchProperty(cls: ApiClass, field: string): Answer {
  const lower = field.toLowerCase();
  const suggestions = cls.properties.map((p) => p.name).filter((n) => n.toLowerCase() === lower);
  return {
    outcome: "no-such-property",
    payload: {
      class: classRef(cls),
      property: field,
      ...(suggestions.length > 0 && { didYouMean: suggestions }),
    },
    text: (fmt) =>
      `${fmt.name(cls.name)} has no property ${fmt.bold(field)}` +
      (suggestions.length > 0 ? ` (did you mean ${suggestions.join(", ")}? names are case-sensitive)` : ""),
  };
}
