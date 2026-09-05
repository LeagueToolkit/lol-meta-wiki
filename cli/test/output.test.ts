import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { FIXTURES } from "./support/fixture-api.mjs";
import { cli } from "./support/cli";

const ESC = "[";

describe("output mode", () => {
  test("a pipe gets JSON without any flag", async () => {
    const r = await cli(["versions"]);
    expect(() => r.json()).not.toThrow();
    expect(r.stdout.endsWith("\n")).toBe(true);
  });

  test("a terminal gets a table, colored unless told otherwise", async () => {
    const colored = await cli(["property", "0x13f50786.imagePath"], { tty: true });
    expect(colored.code).toBe(0);
    expect(() => colored.json()).toThrow();
    expect(colored.stdout).toContain("File (18)");
    expect(colored.stdout).toContain(ESC);

    const plain = await cli(["property", "0x13f50786.imagePath", "--no-color"], { tty: true });
    expect(plain.stdout).not.toContain(ESC);
    expect(plain.stdout).toContain("generation 2026-08-24T03:56:00Z");

    const noColorEnv = await cli(["property", "0x13f50786.imagePath"], { tty: true, env: { NO_COLOR: "1" } });
    expect(noColorEnv.stdout).not.toContain(ESC);
  });

  test("--json forces JSON on a terminal", async () => {
    const r = await cli(["versions", "--json"], { tty: true });
    expect(r.json().outcome).toBe("ok");
  });

  test("a non-zero non-error code still prints a well-formed payload", async () => {
    const piped = await cli(["property", "NoSuch.x"]);
    expect(piped.json<unknown>()).toEqual({ outcome: "no-such-class", api: "v1", generation: "2026-08-24T03:56:00Z", source: "http://fixture.test", class: "NoSuch" });
    const tty = await cli(["property", "NoSuch.x", "--no-color"], { tty: true });
    expect(tty.code).toBe(2);
    expect(tty.stdout).toContain("no such class: NoSuch");
  });

  test("every type is rendered as one shape, wherever it came from", async () => {
    const cls = await cli(["class", "VfxAnimatedColor"]);
    const props = cls.json<{ class: { properties: { name: string; type: unknown }[] } }>().class.properties;
    expect(props.find((p) => p.name === "probabilityTables")!.type).toEqual({
      name: "List",
      tag: 128,
      size: 4,
      value: { name: "Pointer", tag: 130 },
      keyHash: { hash: "0x53a6c97e", name: "VfxProbabilityTableData", kind: "class" },
    });
    const diff = await cli(["diff", "16.6", "16.7"]);
    const row = diff.json<{ changes: { class: string; property: string; oldType: unknown; newType: unknown }[] }>().changes.find((c) => c.class === "VfxAnimatedColor" && c.property === "times") as { oldType: unknown; newType: unknown };
    expect(row.oldType).toEqual({ name: "List", tag: 128, value: { name: "F32", tag: 10 } });
    expect(row.newType).toEqual({ name: "List2", tag: 129, value: { name: "F32", tag: 10 } });
  });

  test("every type the fixtures name carries the bin format's tag", async () => {
    interface Atom {
      name: string;
      tag: number | null;
      key?: Atom;
      value?: Atom;
    }
    interface Prop {
      type: Atom;
      history?: { type: Atom }[];
    }
    const seen = new Set<string>();
    const check = (t: Atom) => {
      seen.add(t.name);
      expect(typeof t.tag).toBe("number");
      if (t.key) check(t.key);
      if (t.value) check(t.value);
    };
    const names: string[] = JSON.parse(fs.readFileSync(path.join(FIXTURES, "api/v1/classes.json"), "utf8")).classes;
    for (const name of names) {
      const r = await cli(["class", name]);
      for (const p of r.json<{ class: { properties: Prop[] } }>().class.properties) {
        check(p.type);
        for (const h of p.history ?? []) check(h.type);
      }
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(["Embed", "F32", "File", "List", "List2", "Pointer", "String", "U32", "U8", "Vec4"]));
  });

  test("raw prints the endpoint verbatim, with no envelope", async () => {
    const r = await cli(["raw", "/v1/versions"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(fs.readFileSync(path.join(FIXTURES, "api/v1/versions.json"), "utf8"));
    const missing = await cli(["raw", "/v1/classes/NoSuch"]);
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout).error).toBe("not found");
  });

  test("--help and --version", async () => {
    const help = await cli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("property <Class>.<field>");
    const version = await cli(["--version"]);
    expect(version.stdout).toMatch(/^rito-meta \d+\.\d+\.\d+\n$/);
    const nothing = await cli([]);
    expect(nothing.code).toBe(1);
    expect(nothing.stderr).toContain("Usage:");
  });
});
