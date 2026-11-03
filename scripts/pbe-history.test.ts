import { expect, test } from "bun:test";
import type { MetaDb } from "./meta-db";
import { pbePatches } from "./pbe-history";

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
