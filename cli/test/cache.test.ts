import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Request, cli } from "./support/cli";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rito-meta-cache-"));

describe("response cache", () => {
  test("a second run revalidates with If-None-Match and answers from the 304", async () => {
    const cacheDir = tmp();
    const first: Request[] = [];
    const a = await cli(["property", "0x13f50786.imagePath"], { cacheDir, requests: first });
    expect(first.every((q) => q.headers["if-none-match"] === undefined)).toBe(true);
    expect(fs.readdirSync(cacheDir).length).toBeGreaterThan(0);

    const second: Request[] = [];
    const b = await cli(["property", "0x13f50786.imagePath"], { cacheDir, requests: second });
    expect(second.length).toBe(first.length);
    expect(second.every((q) => typeof q.headers["if-none-match"] === "string")).toBe(true);
    expect(b.json()).toEqual(a.json());
  });

  test("--no-cache sends unconditional requests", async () => {
    const requests: Request[] = [];
    await cli(["versions"], { requests });
    expect(requests.every((q) => q.headers["if-none-match"] === undefined)).toBe(true);
  });

  test("without --cache-dir the cache lands in the platform's per-user location", async () => {
    const linuxHome = tmp();
    await cli(["versions"], { defaultCache: true, platform: "linux", homedir: linuxHome });
    expect(fs.readdirSync(path.join(linuxHome, ".cache", "rito-meta")).length).toBeGreaterThan(0);

    const xdg = tmp();
    await cli(["versions"], { defaultCache: true, platform: "linux", homedir: linuxHome, env: { XDG_CACHE_HOME: xdg } });
    expect(fs.readdirSync(path.join(xdg, "rito-meta")).length).toBeGreaterThan(0);

    const macHome = tmp();
    await cli(["versions"], { defaultCache: true, platform: "darwin", homedir: macHome });
    expect(fs.readdirSync(path.join(macHome, "Library", "Caches", "rito-meta")).length).toBeGreaterThan(0);

    const localAppData = tmp();
    await cli(["versions"], { defaultCache: true, platform: "win32", homedir: tmp(), env: { LOCALAPPDATA: localAppData } });
    expect(fs.readdirSync(path.join(localAppData, "rito-meta", "cache")).length).toBeGreaterThan(0);

    const explicit = tmp();
    await cli(["versions"], { defaultCache: true, env: { RITO_META_CACHE_DIR: explicit } });
    expect(fs.readdirSync(explicit).length).toBeGreaterThan(0);
  });
});
