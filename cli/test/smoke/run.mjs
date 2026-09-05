/**
 * Runs the built bundle under Node against the fixture API over real HTTP.
 * The unit tests run under Bun; this is the check that a Node-only break
 * (a Bun global, an ESM/JSON import Node rejects) cannot pass green.
 *
 *   bun run build && node test/smoke/run.mjs
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { respond } from "../support/fixture-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "..", "..", "dist", "rito-meta.js");
if (!fs.existsSync(bin)) {
  console.error(`missing ${bin}; run \`bun run build\` first`);
  process.exit(1);
}
assert.ok(fs.readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node\n"), "bundle is shebanged");

const server = createServer((req, res) => {
  const { status, body, etag } = respond(`http://127.0.0.1${req.url}`, req.headers);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...(etag && { etag }) });
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const api = `http://127.0.0.1:${server.address().port}`;

// Async on purpose: the fixture server runs on this event loop, so a blocking
// spawnSync would deadlock the child's requests against it.
const rito = (...args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args, "--api", api, "--no-cache"], { encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr, json: () => JSON.parse(stdout) });
    });
  });

const checks = {
  async "versions answers JSON on a pipe"() {
    const r = await rito("versions");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json().latest.patch, "16.17");
  },
  async "property at a build"() {
    const r = await rito("property", "0x13f50786.imagePath", "--at", "8104348");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json().type, { name: "File", tag: 18 });
  },
  async "exit 2, 3, 4, 5"() {
    assert.equal((await rito("property", "NoSuch.x")).code, 2);
    assert.equal((await rito("property", "0x13f50786.nope")).code, 3);
    assert.equal((await rito("property", "0x13f50786.imagePath", "--at", "15.23")).code, 4);
    assert.equal((await rito("property", "0x13f50786.imagePath", "--at", "99.1")).code, 5);
  },
  async "diff carries the known row"() {
    const r = await rito("diff", "16.16", "16.17");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.json().changes.some((c) => c.class === "0x13f50786" && c.property === "imagePath" && c.newType.tag === 18));
  },
  async "raw is verbatim"() {
    const r = await rito("raw", "/v1/versions");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, respond(`${api}/v1/versions`).body);
  },
  async "--version and --help"() {
    assert.match((await rito("--version")).stdout, /^rito-meta \d+\.\d+\.\d+/);
    assert.equal((await rito("--help")).code, 0);
  },
  async "an error goes to stderr with exit 1"() {
    const r = await rito("frobnicate");
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^rito-meta: unknown command/);
  },
};

let failed = 0;
for (const [name, check] of Object.entries(checks)) {
  try {
    await check();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n${err.message}`);
  }
}
server.close();
console.log(failed === 0 ? `smoke: ${Object.keys(checks).length} checks passed under ${process.version}` : `smoke: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
