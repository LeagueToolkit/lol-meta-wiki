import { describe, expect, test } from "bun:test";
import type { MetaDb } from "./meta-db";
import { mergePreview, type MetaOverlay } from "./preview";

const liveDb = (): MetaDb => ({
  formatVersion: 1,
  latest: 200,
  versions: [
    { patch: "1.1", build: 100 },
    { patch: "1.2", build: 200 },
  ],
  externalTypeNames: { "0xe1": "Vec3" },
  classes: {
    "0xa": {
      name: "Kept",
      revisions: [{ from: 100, bases: [], interface: false, value: false }],
      properties: {},
    },
    "0xb": {
      name: "Changed",
      revisions: [{ from: 100, bases: [], interface: false, value: false }],
      properties: {},
    },
  },
});

const overlay = (over: Partial<MetaOverlay> = {}): MetaOverlay => ({
  formatVersion: 1,
  channel: "pbe",
  patch: "1.3",
  build: 150,
  base: 200,
  externalTypeNames: { "0xe2": "Color" },
  classes: {
    "0xb": {
      name: "Changed",
      revisions: [
        { from: 100, to: 200, bases: [], interface: false, value: false },
        { from: 150, bases: ["0xa"], interface: false, value: false },
      ],
      properties: {},
    },
    "0xc": {
      name: "Added",
      revisions: [{ from: 150, bases: [], interface: false, value: false }],
      properties: {},
    },
  },
  ...over,
});

describe("mergePreview", () => {
  test("mergePreview returns none if the overlay has no build", () => {
    const empty = overlay({ patch: null, build: null, base: null, classes: {} });
    expect(mergePreview(liveDb(), empty)).toEqual({ status: "none" });
  });

  test("mergePreview returns mismatch if base differs from latest", () => {
    expect(mergePreview(liveDb(), overlay({ base: 100 }))).toEqual({
      status: "mismatch",
      base: 100,
      latest: 200,
    });
  });

  test("mergePreview appends the PBE build after the live builds", () => {
    const merged = mergePreview(liveDb(), overlay());
    if (merged.status !== "ok") throw new Error(merged.status);
    // 150 is lower than the live build 200 and still comes last.
    expect(merged.db.versions.map((v) => v.build)).toEqual([100, 200, 150]);
    expect(merged.db.latest).toBe(150);
    expect(merged.info).toEqual({
      channel: "pbe",
      patch: "1.3",
      build: 150,
      base: 200,
      basePatch: "1.2",
    });
  });

  test("mergePreview spreads the overlay entries over the live entries", () => {
    const db = liveDb();
    const merged = mergePreview(db, overlay());
    if (merged.status !== "ok") throw new Error(merged.status);
    expect(Object.keys(merged.db.classes)).toEqual(["0xa", "0xb", "0xc"]);
    expect(merged.db.classes["0xa"]).toBe(db.classes["0xa"]);
    expect(merged.db.classes["0xb"].revisions).toHaveLength(2);
    expect(merged.db.externalTypeNames).toEqual({ "0xe1": "Vec3", "0xe2": "Color" });
  });

  test("mergePreview does not modify the live db", () => {
    const db = liveDb();
    mergePreview(db, overlay());
    expect(db).toEqual(liveDb());
  });

  test("mergePreview throws if the PBE build is a live build", () => {
    expect(() => mergePreview(liveDb(), overlay({ build: 100 }))).toThrow(
      "already a live build"
    );
  });

  test("mergePreview throws if the overlay has an unsupported format version", () => {
    expect(() => mergePreview(liveDb(), overlay({ formatVersion: 2 }))).toThrow(
      "formatVersion 2"
    );
  });
});
