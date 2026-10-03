import { describe, expect, test } from "bun:test";
import {
  categorize,
  parseCategoryConfig,
  type CategorizeClass,
  type UsageEdge,
} from "./categorize";

const cls = (name: string, base?: string, removed = false): CategorizeClass => ({
  name,
  base,
  removed,
});
const uses = (user: string, used: string, live = true): UsageEdge => ({ user, used, live });

/** Every reference resolves to itself unless it starts with "Missing". */
const resolve = (ref: string) => (ref.startsWith("Missing") ? undefined : ref);

const config = (raw: unknown) => {
  const parsed = parseCategoryConfig(raw, resolve);
  expect(parsed.errors).toEqual([]);
  return parsed.config;
};

const twoDomains = config({
  domains: {
    vfx: { title: "VFX", roots: ["IVfxDriver"], prefixes: ["Vfx"] },
    ui: { title: "UI", roots: ["ViewController"] },
  },
});

describe("categorize", () => {
  test("a seed reaches every subclass through the primary base chain", () => {
    const out = categorize(
      [cls("IVfxDriver"), cls("A", "IVfxDriver"), cls("B", "A")],
      [],
      twoDomains
    );
    expect(out.get("B")).toEqual({ domain: "vfx", via: "seed", family: "IVfxDriver" });
  });

  test("the nearest seeded ancestor wins over the family root", () => {
    const cfg = config({
      domains: {
        materials: { title: "Materials", roots: ["IResource"] },
        vfx: { title: "VFX", roots: ["VfxSystem"] },
      },
    });
    const out = categorize(
      [cls("IResource"), cls("Texture", "IResource"), cls("VfxSystem", "IResource"), cls("Sub", "VfxSystem")],
      [],
      cfg
    );
    expect(out.get("Texture")!.domain).toBe("materials");
    expect(out.get("Sub")).toEqual({ domain: "vfx", via: "seed", family: "IResource" });
  });

  test("a pin overrides a seed", () => {
    const cfg = config({
      domains: { vfx: { title: "VFX", roots: ["IVfxDriver"] }, ui: { title: "UI" } },
      pins: { Odd: "ui" },
    });
    const out = categorize([cls("IVfxDriver"), cls("Odd", "IVfxDriver")], [], cfg);
    expect(out.get("Odd")).toEqual({ domain: "ui", via: "pin", family: "IVfxDriver" });
  });

  test("a prefix applies to the family root, the longest one winning", () => {
    const cfg = config({
      domains: {
        vfx: { title: "VFX", prefixes: ["Vfx"] },
        shimmer: { title: "Shimmer", prefixes: ["VfxShimmer"] },
      },
    });
    const out = categorize(
      [cls("VfxBase"), cls("Emitter", "VfxBase"), cls("VfxShimmerBase"), cls("0xabc")],
      [],
      cfg
    );
    expect(out.get("Emitter")).toEqual({ domain: "vfx", via: "prefix", family: "VfxBase" });
    expect(out.get("VfxShimmerBase")!.domain).toBe("shimmer");
    expect(out.get("0xabc")!.domain).toBe("uncategorized");
  });

  test("a family used by one domain joins it, transitively", () => {
    const out = categorize(
      [cls("IVfxDriver"), cls("Helper"), cls("0x1"), cls("Lonely")],
      [uses("IVfxDriver", "Helper"), uses("Helper", "0x1")],
      twoDomains
    );
    expect(out.get("Helper")).toEqual({ domain: "vfx", via: "usage", family: "Helper" });
    expect(out.get("0x1")!.domain).toBe("vfx");
    expect(out.get("Lonely")).toEqual({ domain: "uncategorized", via: "none", family: "Lonely" });
  });

  test("a family used by two domains is shared, listed in display order", () => {
    const out = categorize(
      [cls("IVfxDriver"), cls("ViewController"), cls("Value")],
      [uses("ViewController", "Value"), uses("IVfxDriver", "Value")],
      twoDomains
    );
    expect(out.get("Value")).toEqual({
      domain: "shared",
      via: "shared",
      family: "Value",
      usedByDomains: ["vfx", "ui"],
    });
  });

  test("an unplaced user holds a family back, and shared is not a vote", () => {
    const out = categorize(
      [cls("IVfxDriver"), cls("ViewController"), cls("Value"), cls("Stuck"), cls("Mystery"), cls("Below")],
      [
        uses("ViewController", "Value"),
        uses("IVfxDriver", "Value"),
        uses("IVfxDriver", "Stuck"),
        uses("Mystery", "Stuck"),
        uses("Value", "Below"),
        uses("Mystery", "Below"),
      ],
      twoDomains
    );
    expect(out.get("Stuck")!.domain).toBe("uncategorized");
    expect(out.get("Below")!.domain).toBe("uncategorized");
  });

  test("a live family ignores users that are gone; a removed one keeps them", () => {
    const classes = [
      cls("IVfxDriver"),
      cls("ViewController"),
      cls("OldUi", "ViewController", true),
      cls("Live"),
      cls("Gone", undefined, true),
    ];
    const out = categorize(
      classes,
      [uses("IVfxDriver", "Live"), uses("OldUi", "Live", false), uses("OldUi", "Gone", false)],
      twoDomains
    );
    expect(out.get("Live")!.domain).toBe("vfx");
    expect(out.get("Gone")).toEqual({ domain: "ui", via: "usage", family: "Gone" });
  });

  test("every class gets exactly one category, in any input order", () => {
    const classes = [
      cls("IVfxDriver"),
      cls("A", "IVfxDriver"),
      cls("ViewController"),
      cls("Panel", "ViewController"),
      cls("H1"),
      cls("H2"),
      cls("H3", "H2"),
      cls("Value"),
      cls("VfxLoose"),
      cls("Cycle1", "Cycle2"),
      cls("Cycle2", "Cycle1"),
    ];
    const edges = [
      uses("A", "H1"),
      uses("H1", "H2"),
      uses("Panel", "Value"),
      uses("A", "Value"),
      uses("H3", "VfxLoose"),
    ];
    const expected = categorize(classes, edges, twoDomains);
    expect(expected.size).toBe(classes.length);
    const shuffled = categorize([...classes].reverse(), [...edges].reverse(), twoDomains);
    for (const [name, category] of expected) expect(shuffled.get(name)).toEqual(category);
  });
});

describe("parseCategoryConfig", () => {
  test("unreleased domains sort after the rest, keeping file order", () => {
    const cfg = config({
      domains: {
        monarch: { title: "Monarch", unreleased: true },
        vfx: { title: "VFX" },
        nova: { title: "Nova", unreleased: true },
        ui: { title: "UI" },
      },
    });
    expect(cfg.domains.map((d) => d.id)).toEqual(["vfx", "ui", "monarch", "nova"]);
  });

  test("an unknown class is a warning, not an error", () => {
    const parsed = parseCategoryConfig(
      { domains: { vfx: { title: "VFX", roots: ["MissingRoot", "Real"] } }, pins: { MissingPin: "vfx" } },
      resolve
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.config.domains[0].roots).toEqual(["Real"]);
  });

  test("mistakes in the file are errors", () => {
    const parsed = parseCategoryConfig(
      {
        domains: {
          shared: { title: "Reserved" },
          untitled: {},
          a: { title: "A", roots: ["Same"], prefixes: ["P"] },
          b: { title: "B", roots: ["Same"], prefixes: ["P"] },
        },
        pins: { Thing: "nowhere" },
      },
      resolve
    );
    expect(parsed.errors).toHaveLength(5);
  });
});
