#!/usr/bin/env bun
/**
 * Refresh db/meta.db.json from the LeagueToolkit/lol-meta-classes repository.
 *
 * Usage:
 *   bun run scripts/update-db.ts [--out db/meta.db.json]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DB_URL =
  "https://raw.githubusercontent.com/LeagueToolkit/lol-meta-classes/main/db/meta.db.json";

const outFile = (() => {
  const i = process.argv.indexOf("--out");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "db/meta.db.json";
})();

async function main() {
  console.log(`[..] fetching ${DB_URL}`);
  const res = await fetch(DB_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch meta db: HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();

  // Validate before overwriting anything
  const db = JSON.parse(text);
  if (db.formatVersion !== 1) {
    throw new Error(
      `Fetched db has formatVersion ${db.formatVersion}; this repo expects 1. ` +
      `scripts/generate-db.ts likely needs updating first.`
    );
  }
  const latest = db.versions[db.versions.length - 1];

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, text, "utf8");
  console.log(
    `[ok] ${outFile}: ${Object.keys(db.classes).length} classes, ` +
    `latest patch ${latest.patch} (build ${latest.build})`
  );
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
