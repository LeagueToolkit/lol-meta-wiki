import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const read = (...segments: string[]) => JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, "..", ...segments), "utf8"));

/** Repository invariants the publish workflow also enforces. */
describe("package contract", () => {
  test("the package major is pinned to the API's major", () => {
    const pkg = read("package.json");
    const openapi = read("..", "api", "openapi.json");
    expect(pkg.version.split(".")[0]).toBe(openapi.info.version.split(".")[0]);
  });

  test("the bin is the built bundle and nothing ships but it", () => {
    const pkg = read("package.json");
    expect(pkg.bin["rito-meta"]).toBe("dist/rito-meta.js");
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.engines.node).toBe(">=22");
  });
});
