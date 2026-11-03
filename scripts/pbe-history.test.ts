import { expect, test } from "bun:test";
import type { MetaDb } from "./meta-db";
import { pbePatches } from "./pbe-history";
import type { ClassChange } from "../site/src/types";

test("PBE changelog entries keep standard class navigation", () => {
  const db: MetaDb = {
    formatVersion: 1, latest: 400, externalTypeNames: {}, classes: {},
    versions: [{ patch: "16.22", build: 300 }, { patch: "16.23", build: 400 }],
  };
  const entries: ClassChange[] = ["added", "changed", "removed"].map((kind) => ({
    name: "Example", slug: "example", kind: kind as ClassChange["kind"],
    build: 400, propChanges: [],
  }));
  const [patch] = pbePatches(db, [{
    patch: "16.23", slug: "16-23", builds: [400],
    counts: { added: 1, changed: 1, removed: 1, readded: 0 },
    buildGroups: [{ build: 400, entries }],
  }]);
  expect(patch.buildGroups[0].entries).toEqual(entries);
  for (const entry of patch.buildGroups[0].entries) {
    expect(entry).not.toHaveProperty("definitionHref");
  }
});

test("PBE rollover keeps every build and compares the next patch to the preceding PBE", () => {
  const db: MetaDb = {
    formatVersion: 1, latest: 400, externalTypeNames: {}, classes: {},
    versions: [{ patch: "16.22", build: 300 }, { patch: "16.22", build: 310 },
      { patch: "16.23", build: 400 }],
  };
  const patches = pbePatches(db, []);
  expect(patches.map((p) => p.patch)).toEqual(["16.23", "16.22"]);
  expect(patches[0].preview).toMatchObject({ base: 310, basePatch: "16.22", baseChannel: "pbe" });
  expect(patches[1].builds).toEqual([300, 310]);
  expect(patches[1].buildGroups.map((g) => g.build)).toEqual([300, 310]);
});
