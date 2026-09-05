import { describe, expect, test } from "bun:test";
import { cli } from "./support/cli";

/** Each code, including all three shades of absence, through the one seam. */
describe("exit codes", () => {
  test("0: an answered question, with the envelope stamped", async () => {
    const r = await cli(["property", "0x13f50786.imagePath", "--at", "8104348"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const body = r.json();
    expect(body.outcome).toBe("ok");
    expect(body.api).toBe("v1");
    expect(body.generation).toBe("2026-08-24T03:56:00Z");
    expect(body.source).toBe("http://fixture.test");
  });

  test("2: no such class, on every command that names one", async () => {
    for (const args of [["property", "NoSuchClass.field"], ["class", "NoSuchClass"], ["hash", "0xdeadbeef"], ["hash", "NoSuchClass"], ["docs", "NoSuchClass"]]) {
      const r = await cli(args);
      expect(r.code).toBe(2);
      expect(r.json().outcome).toBe("no-such-class");
    }
  });

  test("3: class known, property not described", async () => {
    const r = await cli(["property", "0x13f50786.nope"]);
    expect(r.code).toBe(3);
    expect(r.json()).toMatchObject({ outcome: "no-such-property", class: { name: "0x13f50786", hash: "0x13f50786" }, property: "nope" });
  });

  test("3: a case mismatch is still absence, but the payload says what it saw", async () => {
    const r = await cli(["property", "0x13f50786.ImagePath"]);
    expect(r.code).toBe(3);
    expect(r.json().didYouMean).toEqual(["imagePath"]);
  });

  test("3: class known, no prose written", async () => {
    const r = await cli(["docs", "VfxColorBase"]);
    expect(r.code).toBe(3);
    expect(r.json()).toMatchObject({ outcome: "not-documented", class: { name: "VfxColorBase" } });
  });

  test("4: property known, no revision covers that build", async () => {
    const r = await cli(["property", "0x13f50786.imagePath", "--at", "15.23"]);
    expect(r.code).toBe(4);
    const body = r.json<{ outcome: string; since: string; history: unknown[] }>();
    expect(body.outcome).toBe("not-at-build");
    expect(body.since).toBe("15.24");
    expect(body.history).toHaveLength(2);
  });

  test("4: class known, did not exist at that build", async () => {
    const r = await cli(["class", "0x13f50786", "--at", "15.22"]);
    expect(r.code).toBe(4);
    expect(r.json()).toMatchObject({ outcome: "not-at-build", since: "15.23" });
  });

  test("4: a patch inside the window with no changelog", async () => {
    const r = await cli(["changelog", "13.15"]);
    expect(r.code).toBe(4);
    expect(r.json()).toMatchObject({ outcome: "no-changelog", patch: "13.15", slug: "13-15" });
  });

  test("5: build or patch past the dataset's window, either side", async () => {
    const after = await cli(["property", "0x13f50786.imagePath", "--at", "99.1"]);
    expect(after.code).toBe(5);
    expect(after.json()).toMatchObject({ outcome: "outside-window", reason: "after-window" });
    const before = await cli(["property", "0x13f50786.imagePath", "--at", "1"]);
    expect(before.code).toBe(5);
    expect(before.json()).toMatchObject({ outcome: "outside-window", reason: "before-window", window: { first: { patch: "13.15" } } });
    const diff = await cli(["diff", "16.17", "99.0"]);
    expect(diff.code).toBe(5);
  });

  test("1: bad arguments print to stderr, nothing to stdout", async () => {
    for (const args of [
      ["frobnicate"],
      ["property"],
      ["property", "NoDot"],
      ["property", "0x13f50786.imagePath", "--at", "16.17.1"],
      ["property", "0x13f50786.imagePath", "--at", "abc"],
      ["diff", "16.17", "--at", "1"],
      ["class", "--bogus"],
      ["raw", "v1/versions"],
      ["diff", "16.17", "16.16"],
      ["db", "check"],
    ]) {
      const r = await cli(args);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/^rito-meta: /);
    }
  });

  test("1: a network failure is an error, not an absence", async () => {
    const r = await cli(["property", "0x13f50786.imagePath"], {
      fetch: async () => {
        throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("network error");
    expect(r.stderr).toContain("ECONNREFUSED");
  });

  test("1: an unreadable --db", async () => {
    const r = await cli(["versions", "--db", "does/not/exist.json"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cannot read --db");
  });
});
