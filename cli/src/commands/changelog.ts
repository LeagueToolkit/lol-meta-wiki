/**
 * `changelog [patch]` - the patch index, or one patch in full with every
 * type rendered in the CLI's one type shape.
 */

import type { ApiClassChange, ApiPropChange } from "../api-types";
import { indent, table } from "../output";
import { type TypeShape, typeShape } from "../tags";
import { type Answer, type Command, expectArgs, resolvePoint, typeText } from "./shared";

const PATCH_OR_SLUG = /^(\d+)[.-](\d+)$/;

export const changelog: Command = async (ctx, args) => {
  expectArgs("changelog", args, 0, 1, "at most one argument: a patch, a patch slug or a build number");
  if (args.length === 0) return index(ctx);

  const vm = await ctx.source.versions();
  const point = resolvePoint(vm, args[0]!.replace(PATCH_OR_SLUG, "$1.$2"), "[patch]");
  if ("answer" in point) return point.answer;
  const patch = point.at.patch;
  const slug = patch.replace(/\./g, "-");
  const log = await ctx.source.changelog(slug);
  if (!log) {
    return {
      outcome: "no-changelog",
      payload: { patch, slug, builds: vm.buildsOf(patch) },
      text: (fmt) => `no changelog for patch ${fmt.bold(patch)}` + (patch === vm.first.patch ? " (tracking began there; nothing to compare against)" : ""),
    };
  }

  const buildGroups = log.buildGroups.map((g) => ({ build: g.build, entries: g.entries.map(shapeEntry) }));
  return {
    outcome: "ok",
    payload: { patch: log.patch, slug: log.slug, builds: log.builds, counts: log.counts, buildGroups },
    text: (fmt) => {
      const c = log.counts;
      let out = `patch ${fmt.bold(log.patch)}  ${fmt.added(`+${c.added} added`)}  ${c.readded} re-added  ${fmt.removed(`-${c.removed} removed`)}  ${c.changed} changed`;
      for (const g of buildGroups) {
        const rows = g.entries.map((e) => [e.kind, fmt.name(e.name), summarize(e)]);
        out += `\n\nbuild ${g.build}\n` + indent(table(rows));
      }
      return out;
    },
  };
};

/** A class change with its property changes' types in the CLI's one type shape. */
type ShapedClassChange = Omit<ApiClassChange, "propChanges"> & {
  propChanges: (Omit<ApiPropChange, "oldType" | "newType"> & { oldType?: TypeShape; newType?: TypeShape })[];
};

function shapeEntry(e: ApiClassChange): ShapedClassChange {
  return {
    ...e,
    propChanges: e.propChanges.map((p) => ({
      name: p.name,
      kind: p.kind,
      ...(p.oldType && { oldType: typeShape(p.oldType) }),
      ...(p.newType && { newType: typeShape(p.newType) }),
    })),
  };
}

function summarize(e: ShapedClassChange): string {
  const parts: string[] = [];
  if (e.baseChange) parts.push(`bases ${e.baseChange.old.join(", ") || "-"} -> ${e.baseChange.new.join(", ") || "-"}`);
  const counts = { added: 0, readded: 0, removed: 0, typechanged: 0 };
  for (const p of e.propChanges) counts[p.kind]++;
  if (counts.added) parts.push(`+${counts.added}`);
  if (counts.readded) parts.push(`re-added ${counts.readded}`);
  if (counts.removed) parts.push(`-${counts.removed}`);
  for (const p of e.propChanges) {
    if (p.kind === "typechanged" && p.oldType && p.newType) parts.push(`${p.name}: ${typeText(p.oldType)} -> ${typeText(p.newType)}`);
  }
  return parts.join("; ");
}

async function index(ctx: Parameters<Command>[0]): Promise<Answer> {
  const idx = await ctx.source.changelogIndex();
  return {
    outcome: "ok",
    payload: { latestPatch: idx.latestPatch, count: idx.patches.length, patches: idx.patches },
    text: (fmt) =>
      table(
        idx.patches.map((p) => [
          fmt.bold(p.patch),
          p.builds.join(", "),
          fmt.added(`+${p.counts.added}`),
          String(p.counts.readded),
          fmt.removed(`-${p.counts.removed}`),
          String(p.counts.changed),
        ]),
        ["patch", "builds", "added", "re-added", "removed", "changed"]
      ),
  };
}
