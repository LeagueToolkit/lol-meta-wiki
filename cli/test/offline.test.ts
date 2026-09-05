import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIXTURES } from "./support/fixture-api.mjs";
import { DB, type Request, cli, comparable } from "./support/cli";

const fixture = (rel: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, rel), "utf8"));

/**
 * `--db` must answer exactly as the network does, from the same database.
 * The recorded API responses and the recorded raw database were taken from
 * the same generation, so every derived answer has a recorded one to match.
 */
describe("--db", () => {
  test("every read command answers offline with the same payload, and no request", async () => {
    const requests: Request[] = [];
    const cases = [
      ["property", "0x13f50786.imagePath", "--at", "8104348"],
      ["property", "0x13f50786.imagePath", "--at", "15.23"],
      ["property", "VfxAnimatedColor.times", "--at", "14.7"],
      ["property", "VfxAnimatedColor.modes", "--at", "14.8"],
      ["property", "VfxEmissionSkeleton.ShapeCenter"],
      ["property", "VfxEmissionSkeleton.ShapeCenter", "--at", "15.24"],
      ["property", "NoSuch.x"],
      ["class", "VfxAnimatedColor"],
      ["class", "VfxAnimatedColor", "--inherited", "--tree"],
      ["class", "VfxAnimatedColorVariableData", "--inherited"],
      ["class", "VfxColorBase", "--tree"],
      // Not --tree: the trimmed database holds one of its seven subclasses.
      ["class", "IVfxEmissionSource"],
      ["class", "VfxEmissionSkeleton", "--inherited", "--at", "16.1"],
      ["class", "VfxProbabilityTableData"],
      ["class", "0x13f50786", "--at", "16.16"],
      ["hash", "0x6878c1b5"],
      ["hash", "VfxColorBase"],
      ["search", "vfx*"],
      ["diff", "16.16", "16.17"],
      ["diff", "16.6", "16.7"],
      ["changelog", "16.7"],
      ["changelog", "16.17"],
      ["versions"],
    ];
    for (const args of cases) {
      const online = await cli(args);
      const offline = await cli([...args, "--db", DB], { requests });
      expect(offline.code).toBe(online.code);
      expect(comparable(offline.json())).toEqual(comparable(online.json()));
      expect(offline.json().source).toBe(DB);
    }
    expect(requests).toEqual([]);
  });

  test("docs are not in the database, and say so", async () => {
    const r = await cli(["docs", "BoolConcept", "--db", DB]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not part of /v1/db");
  });

  test("raw still goes to the network; the database is not even read", async () => {
    const requests: Request[] = [];
    const r = await cli(["raw", "/v1/versions", "--db", "does/not/exist.json"], { requests });
    expect(r.code).toBe(0);
    expect(requests.map((q) => q.url)).toEqual(["http://fixture.test/v1/versions"]);
  });

  test("a database with a different format version is rejected, not misread", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rito-meta-"));
    const file = path.join(dir, "db.json");
    fs.writeFileSync(file, JSON.stringify({ ...fixture("db.json"), formatVersion: 2 }));
    const r = await cli(["versions", "--db", file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("formatVersion 2");
  });
});

describe("db fetch / db check", () => {
  test("fetch writes the raw database and check compares generations with one small request", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rito-meta-"));
    const file = path.join(dir, "pinned.json");
    const fetched = await cli(["db", "fetch", file]);
    expect(fetched.code).toBe(0);
    expect(fetched.json()).toMatchObject({ path: file, generation: "2026-08-24T03:56:00Z", latest: { build: 8104348, patch: "16.17" } });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(fixture("db.json"));

    const requests: Request[] = [];
    const current = await cli(["db", "check", file], { requests });
    expect(current.code).toBe(0);
    expect(current.json()).toMatchObject({ outcome: "ok", current: true, local: { latest: { build: 8104348, patch: "16.17" } } });
    expect(requests.map((q) => q.url)).toEqual(["http://fixture.test/v1"]);

    const db = JSON.parse(fs.readFileSync(file, "utf8"));
    db.hashSource.fetchedAt = "2026-01-01T00:00:00Z";
    fs.writeFileSync(file, JSON.stringify(db));
    const stale = await cli(["db", "check", file]);
    expect(stale.code).toBe(5);
    expect(stale.json()).toMatchObject({
      outcome: "stale",
      current: false,
      local: { generation: "2026-01-01T00:00:00Z" },
      published: { generation: "2026-08-24T03:56:00Z", latest: { build: 8104348, patch: "16.17" } },
    });
  });
});
