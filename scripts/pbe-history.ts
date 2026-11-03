import type { MetaDb } from "./meta-db";
import type { ChangelogPatch, PreviewInfo } from "../site/src/types";

/** Keep every observed build, including builds with no schema changes. */
export function pbePatches(db: MetaDb, changes: ChangelogPatch[]): ChangelogPatch[] {
  const patches = new Map<string, ChangelogPatch>();
  for (const [i, version] of db.versions.entries()) {
    let patch = patches.get(version.patch);
    if (!patch) {
      const previous = db.versions[Math.max(0, i - 1)];
      const info: PreviewInfo = {
        channel: "pbe", ...version, base: previous.build, basePatch: previous.patch,
        baseChannel: "pbe",
      };
      const change = changes.find((p) => p.patch === version.patch);
      patch = {
        patch: version.patch, slug: `pbe-${version.patch.replaceAll(".", "-")}`,
        builds: [], counts: change?.counts ?? { added: 0, readded: 0, removed: 0, changed: 0 },
        buildGroups: [], preview: info,
      };
      patches.set(version.patch, patch);
    }
    patch.builds.push(version.build);
    patch.buildGroups.push({
      build: version.build,
      entries: changes.find((p) => p.patch === version.patch)?.buildGroups
        .find((g) => g.build === version.build)?.entries.map((entry) => ({
          ...entry,
          definitionHref: `/changelog/pbe-history/?build=${entry.kind === "removed"
            ? db.versions[Math.max(0, i - 1)].build : version.build}&class=${encodeURIComponent(entry.name)}`,
        })) ?? [],
    });
    patch.preview!.build = version.build;
  }
  return [...patches.values()].reverse();
}
