/**
 * `versions` - the patch to build map and the newest build covered.
 */

import { keyValues, table } from "../output";
import { type Command, atText, expectArgs } from "./shared";

export const versions: Command = async (ctx, args) => {
  expectArgs("versions", args, 0, 0, "no arguments");
  const vm = await ctx.source.versions();
  const patches = vm.patches.map((patch) => ({ patch, builds: vm.buildsOf(patch) }));
  return {
    outcome: "ok",
    payload: { first: vm.first, latest: vm.latest, count: vm.versions.length, patches },
    text: (fmt) =>
      keyValues([
        ["first", atText(vm.first)],
        ["latest", atText(vm.latest)],
        ["builds", String(vm.versions.length)],
      ]) +
      "\n\n" +
      table(patches.map((p) => [fmt.bold(p.patch), p.builds.join(", ")]), ["patch", "builds"]),
  };
};
