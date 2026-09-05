import { describe, expect, test } from "bun:test";
import { type Request, cli, comparable } from "./support/cli";

describe("property", () => {
  test("names both the build and the patch, whichever was asked", async () => {
    const byBuild = await cli(["property", "0x13f50786.imagePath", "--at", "8104348"]);
    const byPatch = await cli(["property", "0x13f50786.imagePath", "--at", "16.17"]);
    expect(byBuild.json()).toEqual(byPatch.json());
    expect(byBuild.json()).toMatchObject({ at: { build: 8104348, patch: "16.17" }, type: { name: "File", tag: 18 }, since: "16.17", until: null, defaultValue: '"0x0"' });
  });

  test("a patch with several builds answers as the patch ended", async () => {
    const byPatch = await cli(["property", "0x13f50786.imagePath", "--at", "16.16"]);
    const byFirstBuild = await cli(["property", "0x13f50786.imagePath", "--at", "8042660"]);
    expect(byPatch.json().at).toEqual({ build: 8049184, patch: "16.16" });
    expect(byFirstBuild.json().at).toEqual({ build: 8042660, patch: "16.16" });
    const { at: _a, ...a } = byPatch.json();
    const { at: _b, ...b } = byFirstBuild.json();
    expect(a).toEqual(b);
    expect(a.type).toEqual({ name: "String", tag: 16 });
  });

  test("an unobserved build answers as of the nearest earlier one and says so", async () => {
    const r = await cli(["property", "0x13f50786.imagePath", "--at", "8100000"]);
    expect(r.json().at).toEqual({ build: 8049184, patch: "16.16", requestedBuild: 8100000 });
  });

  test("defaults to the latest build", async () => {
    const r = await cli(["property", "0x13f50786.imagePath"]);
    expect(r.json()).toMatchObject({ at: { build: 8104348, patch: "16.17" }, type: { name: "File" } });
  });

  test("hashes are accepted on either side, in any spelling", async () => {
    const r = await cli(["property", "0x13F50786.0xF511A169"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ class: { hash: "0x13f50786" }, property: { name: "imagePath", hash: "0xf511a169" } });
  });

  test("carries the whole history so a caller never re-fetches", async () => {
    const r = await cli(["property", "VfxAnimatedColor.times"]);
    expect(r.json<{ history: unknown[] }>().history).toEqual([
      { since: "13.16", until: "14.7", type: { name: "List2", tag: 129, value: { name: "F32", tag: 10 } }, defaultValue: "[]" },
      { since: "14.8", until: "16.6", type: { name: "List", tag: 128, value: { name: "F32", tag: 10 } }, defaultValue: "[]" },
      { since: "16.7", until: null, type: { name: "List2", tag: 129, value: { name: "F32", tag: 10 } }, defaultValue: "[]" },
    ]);
  });

  test("a removed property is absent at the latest build but the payload keeps what is known", async () => {
    const r = await cli(["property", "VfxAnimatedColor.modes"]);
    expect(r.code).toBe(4);
    expect(r.json()).toMatchObject({ removedIn: "14.8", history: [{ since: "13.16", until: "14.7", type: { name: "List2" } }] });
    const earlier = await cli(["property", "VfxAnimatedColor.modes", "--at", "14.7"]);
    expect(earlier.code).toBe(0);
    expect(earlier.json()).toMatchObject({ type: { name: "List2", tag: 129, value: { name: "U8", tag: 3 } }, until: "14.7" });
  });

  test("the removal patch itself is absence: a patch answers as it ended", async () => {
    const r = await cli(["property", "VfxAnimatedColor.modes", "--at", "14.8"]);
    expect(r.code).toBe(4);
    expect(r.json()).toMatchObject({ outcome: "not-at-build", at: { patch: "14.8" }, removedIn: "14.8" });
  });
});

describe("property, inherited", () => {
  test("answers for a property defined on an ancestor and names the defining class", async () => {
    const r = await cli(["property", "VfxEmissionSkeleton.ShapeCenter"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({
      class: { name: "VfxEmissionSkeleton", hash: "0xdbd91337" },
      property: { name: "ShapeCenter", hash: "0xa8d060cb", definedOn: "IVfxEmissionSource" },
      type: { name: "Embed", tag: 131, keyHash: { hash: "0x67104c43", name: "VfxVector3DynamicProperty", kind: "class" } },
      since: "16.1",
    });
    const own = await cli(["property", "IVfxEmissionSource.ShapeCenter"]);
    expect(own.json().property).toEqual({ name: "ShapeCenter", hash: "0xa8d060cb" });
  });

  test("is dated by the class asked about as well as by the defining class", async () => {
    // IVfxEmissionSource exists since 15.24, VfxEmissionSkeleton only since 16.1.
    const throughChild = await cli(["property", "VfxEmissionSkeleton.ShapeCenter", "--at", "15.24"]);
    expect(throughChild.code).toBe(4);
    const inheritedView = await cli(["class", "VfxEmissionSkeleton", "--inherited", "--at", "16.1"]);
    const props = inheritedView.json<{ class: { properties: { name: string; from: string }[] } }>().class.properties;
    expect(props.map((p) => `${p.from}.${p.name}`)).toEqual([
      "VfxEmissionSkeleton.SkeletonData",
      "IVfxEmissionSource.ShapeCenter",
      "IVfxEmissionSource.rotation",
      "IVfxEmissionSource.scale",
    ]);
  });
});

describe("class", () => {
  test("hash, flags, bases, lifetime, properties", async () => {
    const r = await cli(["class", "VfxAnimatedColor"]);
    const body = r.json<{ class: Record<string, unknown> & { properties: { name: string }[] } }>();
    expect(body.class).toMatchObject({ name: "VfxAnimatedColor", hash: "0x6878c1b5", interface: false, value: false, bases: ["VfxColorBase"], since: "13.16", removedIn: null, ancestorLevels: [["VfxColorBase"]] });
    expect(body.class.properties.map((p) => p.name)).toEqual(["InterpModes", "modes", "probabilityTables", "times", "values"]);
    expect(body.class).not.toHaveProperty("descendants");
  });

  test("--tree adds the descendants, --inherited the flattened view", async () => {
    const tree = await cli(["class", "VfxColorBase", "--tree"]);
    expect(tree.json<{ class: { descendants: { name: string }[] } }>().class.descendants.map((d) => d.name)).toEqual(["VfxAnimatedColor", "VfxAnimatedColorVariableData"]);
    const inherited = await cli(["class", "VfxAnimatedColor", "--inherited"]);
    const body = inherited.json<{ class: { flattened: boolean; properties: { from: string }[] } }>();
    expect(body.class.flattened).toBe(true);
    expect(body.class.properties.every((p) => p.from === "VfxAnimatedColor")).toBe(true);
  });

  test("--at narrows the properties to that point in time, typed as they were", async () => {
    const r = await cli(["class", "VfxAnimatedColor", "--at", "14.7"]);
    const props = r.json<{ class: { properties: { name: string; type: { name: string } }[] } }>().class.properties;
    expect(props.map((p) => p.name)).toEqual(["modes", "times", "values"]);
    expect(props.find((p) => p.name === "times")!.type.name).toBe("List2");
  });

  test("a terminal rendering lists every property once", async () => {
    const r = await cli(["class", "VfxAnimatedColor", "--no-color"], { tty: true });
    expect(r.stdout).toContain("properties (5)");
    expect(r.stdout).toContain("List<Pointer<VfxProbabilityTableData>>[4] (128)");
  });
});

describe("hash", () => {
  test("hash to name and back, plus the wiki URL", async () => {
    const byHash = await cli(["hash", "0x6878C1B5"]);
    expect(byHash.json()).toMatchObject({ hash: "0x6878c1b5", name: "VfxAnimatedColor", kind: "class", url: "https://meta-wiki.leaguetoolkit.dev/classes/vfxanimatedcolor" });
    const byName = await cli(["hash", "VfxAnimatedColor"]);
    expect(byName.json()).toMatchObject({ hash: "0x6878c1b5", name: "VfxAnimatedColor" });
    const unnamed = await cli(["hash", "0x13f50786"]);
    expect(unnamed.json()).toMatchObject({ hash: "0x13f50786", name: null, kind: "class", url: "https://meta-wiki.leaguetoolkit.dev/classes/0x13f50786" });
  });
});

describe("search", () => {
  test("substring, glob, and hash", async () => {
    const sub = await cli(["search", "color"]);
    expect(sub.json<{ matches: { name: string }[] }>().matches.map((m) => m.name)).toEqual(["VfxAnimatedColor", "VfxAnimatedColorVariableData", "VfxColorBase"]);
    const glob = await cli(["search", "vfxanimated*"]);
    expect(glob.json().count).toBe(2);
    const exact = await cli(["search", "VfxColor*"]);
    expect(exact.json().count).toBe(1);
    const hash = await cli(["search", "0x13f5"]);
    expect(hash.json<{ matches: { name: string; hash: string }[] }>().matches).toEqual([{ name: "0x13f50786", hash: "0x13f50786" }]);
    const none = await cli(["search", "zzz"]);
    expect(none.code).toBe(0);
    expect(none.json().count).toBe(0);
  });
});

describe("diff", () => {
  test("the known row: 0x13f50786.imagePath went String to File at build 8104348", async () => {
    const r = await cli(["diff", "16.16", "16.17"]);
    expect(r.json()).toMatchObject({ from: { build: 8049184, patch: "16.16" }, to: { build: 8104348, patch: "16.17" } });
    const changes = r.json<{ changes: Record<string, unknown>[] }>().changes;
    expect(changes).toContainEqual({
      class: "0x13f50786",
      property: "imagePath",
      build: 8104348,
      patch: "16.17",
      oldType: { name: "String", tag: 16 },
      newType: { name: "File", tag: 18 },
    });
  });

  test("the same span by build numbers gives the same rows", async () => {
    const byPatch = await cli(["diff", "16.16", "16.17"]);
    const byBuild = await cli(["diff", "8049184", "8104348"]);
    expect(comparable(byBuild.json())).toEqual(comparable(byPatch.json()));
  });

  test("a wider span walks every patch it touches, one request each", async () => {
    const requests: Request[] = [];
    const r = await cli(["diff", "16.5", "16.17"], { requests });
    expect(r.json<{ changes: { patch: string }[] }>().changes.map((c) => c.patch)).toEqual(expect.arrayContaining(["16.7", "16.17"]));
    const changelogs = requests.filter((q) => /\/v1\/changelog\/\d+-\d+$/.test(q.url)).map((q) => q.url.split("/").pop());
    expect(changelogs).toHaveLength(new Set(changelogs).size);
    expect(changelogs).toContain("16-7");
    expect(changelogs).toContain("16-17");
  });

  test("a terminal rendering is a table of before and after", async () => {
    const r = await cli(["diff", "16.16", "16.17", "--no-color"], { tty: true });
    expect(r.stdout).toContain("0x13f50786.imagePath");
    expect(r.stdout).toMatch(/String \(16\)\s+->\s+File \(18\)/);
  });
});

describe("changelog", () => {
  test("the index, and one patch in full with typed changes", async () => {
    const index = await cli(["changelog"]);
    expect(index.json()).toMatchObject({ latestPatch: "16.17" });
    for (const arg of ["16.17", "16-17", "8104348"]) {
      const patch = await cli(["changelog", arg]);
      expect(patch.code).toBe(0);
      const body = patch.json<{ patch: string; buildGroups: { build: number; entries: { name: string; propChanges: { name: string; kind: string; newType?: { name: string; tag: number } }[] }[] }[] }>();
      expect(body.patch).toBe("16.17");
      const entry = body.buildGroups[0]!.entries.find((e) => e.name === "0x13f50786")!;
      expect(entry.propChanges.find((p) => p.name === "imagePath")).toMatchObject({ kind: "typechanged", newType: { name: "File", tag: 18 } });
    }
  });
});

describe("versions", () => {
  test("the patch to build map and the newest build covered", async () => {
    const r = await cli(["versions"]);
    expect(r.json()).toMatchObject({ first: { build: 5229820, patch: "13.15" }, latest: { build: 8104348, patch: "16.17" }, count: 249 });
    const patches = r.json<{ patches: { patch: string; builds: number[] }[] }>().patches;
    expect(patches.find((p) => p.patch === "16.16")!.builds).toEqual([8042660, 8049184]);
  });
});

describe("docs", () => {
  test("one class, marked with its license", async () => {
    const r = await cli(["docs", "BoolConcept"]);
    expect(r.json()).toMatchObject({ license: "CC BY-SA 4.0", docs: { name: "BoolConcept" } });
    const tty = await cli(["docs", "BoolConcept", "--no-color"], { tty: true });
    expect(tty.stdout).toContain("BoolConcept");
  });

  test("`all` is routed as the bulk endpoint, not as a class named all", async () => {
    const requests: Request[] = [];
    const r = await cli(["docs", "all"], { requests });
    expect(r.json()).toMatchObject({ count: 1 });
    expect(requests.map((q) => q.url)).toContain("http://fixture.test/v1/docs/all");
  });
});
