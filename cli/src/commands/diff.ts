/**
 * `diff <from> <to>` - every property whose type changed in the span
 * (from, to], as a projection over the changelog of each patch touched.
 *
 * Changelogs are fetched one patch at a time and only the `typechanged`
 * rows are kept, so a wide span never holds every payload at once.
 */

import { UsageError } from "../outcome";
import { table } from "../output";
import { type TypeShape, typeShape } from "../tags";
import type { At } from "../versions";
import { type Command, atText, expectArgs, resolvePoint, typeText } from "./shared";

export interface TypeChange {
  class: string;
  property: string;
  build: number;
  patch: string;
  oldType: TypeShape;
  newType: TypeShape;
}

export const diff: Command = async (ctx, args) => {
  expectArgs("diff", args, 2, 2, "two arguments: <from> <to>, each a build number or a patch");
  const vm = await ctx.source.versions();
  const bounds: At[] = [];
  for (const [i, input] of args.entries()) {
    const point = resolvePoint(vm, input!, i === 0 ? "<from>" : "<to>");
    if ("answer" in point) return point.answer;
    bounds.push(point.at);
  }
  const [from, to] = bounds as [At, At];
  if (from.build >= to.build) throw new UsageError(`<from> must be earlier than <to> (${from.build} >= ${to.build})`);

  const changes: TypeChange[] = [];
  for (const patch of vm.patchesBetween(from.build, to.build)) {
    const log = await ctx.source.changelog(patch.replace(/\./g, "-"));
    if (!log) continue;
    for (const group of log.buildGroups) {
      if (group.build <= from.build || group.build > to.build) continue;
      for (const entry of group.entries) {
        for (const change of entry.propChanges) {
          if (change.kind !== "typechanged" || !change.oldType || !change.newType) continue;
          changes.push({
            class: entry.name,
            property: change.name,
            build: group.build,
            patch: log.patch,
            oldType: typeShape(change.oldType),
            newType: typeShape(change.newType),
          });
        }
      }
    }
  }
  changes.sort((a, b) => a.build - b.build || a.class.localeCompare(b.class) || a.property.localeCompare(b.property));

  return {
    outcome: "ok",
    payload: { from, to, count: changes.length, changes },
    text: (fmt) =>
      changes.length === 0
        ? `no property changed type between ${atText(from)} and ${atText(to)}`
        : table(
            changes.map((c) => [`${fmt.name(c.class)}.${c.property}`, fmt.removed(typeText(c.oldType)), "->", fmt.added(typeText(c.newType)), `${c.build} (${c.patch})`]),
            ["property", "from", "", "to", "build"]
          ),
  };
};
