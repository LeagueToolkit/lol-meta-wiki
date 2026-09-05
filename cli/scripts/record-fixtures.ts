/**
 * Records the API responses the tests run against, trimmed to the classes
 * the tests name, into test/fixtures/. Re-run against the live API when the
 * dataset or the contract changes: `bun scripts/record-fixtures.ts`.
 *
 * Layout mirrors the URL space so the fixture server (test/support/
 * fixture-api.mjs) can map a request to a file mechanically:
 *
 *   api/v1.json                        /v1
 *   api/v1/<name>.json                 /v1/<name>          (exact routes)
 *   api/v1/classes/<name>.json         /v1/classes/{x}
 *   api/v1/classes-inherited/<name>    /v1/classes/{x}?inherited=1
 *   api/v1/changelog/<slug>.json       /v1/changelog/{slug}
 *   api/v1/docs/<name>.json            /v1/docs/{x}
 *   db.json                            /v1/db              (raw, trimmed)
 */

import fs from "node:fs";
import path from "node:path";
import { canon } from "../../api/scripts/lib/resolver";
import type { MetaDb } from "../../api/scripts/lib/types";
import type { ApiChangelogPatch, ApiClass, ApiHashIndex, ApiNameList, ApiWikiIndex } from "../src/api-types";
import { DEFAULT_API } from "../src/http";

const API = process.env["RITO_META_API"] ?? DEFAULT_API;
const root = path.resolve(import.meta.dir, "..", "test", "fixtures");

/**
 * The cast. VfxColorBase and its two subclasses give ancestry, a descendant
 * tree and List<->List2 history (patch 16.7); VfxProbabilityTableData is the
 * class one of those properties points at; 0x13f50786 is unnamed and carries
 * the String -> File change at build 8104348 the plan names; VfxEmissionSkeleton
 * (since 16.1) inherits properties from IVfxEmissionSource (since 15.24), so an
 * inherited property is dated by two different lifetimes. The last two are the
 * classes those properties link to, so the trimmed database resolves them.
 */
const CLASSES = [
  "0x13f50786",
  "VfxAnimatedColor",
  "VfxAnimatedColorVariableData",
  "VfxColorBase",
  "VfxProbabilityTableData",
  "VfxEmissionSkeleton",
  "IVfxEmissionSource",
  "VfxVector3DynamicProperty",
  "VfxEmissionSkeletonData",
];
const DOCS = ["BoolConcept"];
const CHANGELOGS = ["16-17", "16-7"];

async function get<T>(p: string): Promise<T> {
  const res = await fetch(API + p);
  if (!res.ok) throw new Error(`${p} answered ${res.status}`);
  return (await res.json()) as T;
}

function write(rel: string, value: unknown) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  console.log(`wrote ${rel}`);
}

fs.rmSync(root, { recursive: true, force: true });

write("api/v1.json", await get("/v1"));
write("api/v1/versions.json", await get("/v1/versions"));
write("api/v1/changelog.json", await get("/v1/changelog"));

const classes = new Map<string, ApiClass>();
for (const name of CLASSES) {
  const cls = await get<ApiClass>(`/v1/classes/${name}`);
  classes.set(cls.name, cls);
  write(`api/v1/classes/${cls.name}.json`, cls);
  write(`api/v1/classes-inherited/${cls.name}.json`, await get(`/v1/classes/${name}?inherited=1`));
}
const names = [...classes.keys()].sort();
write("api/v1/classes.json", { count: names.length, classes: names } satisfies ApiNameList);

const hashes = await get<ApiHashIndex>("/v1/hashes");
const keep = new Set([...classes.values()].map((c) => c.hash));
write("api/v1/hashes.json", {
  format: hashes.format,
  count: keep.size,
  classes: Object.fromEntries(Object.entries(hashes.classes).filter(([h]) => keep.has(h))),
  externals: hashes.externals,
} satisfies ApiHashIndex);

const index = await get<ApiWikiIndex>("/v1/index");
write("api/v1/index.json", Object.fromEntries(names.map((n) => [n, index[n]!])));

for (const slug of CHANGELOGS) {
  const log = await get<ApiChangelogPatch>(`/v1/changelog/${slug}`);
  const buildGroups = log.buildGroups
    .map((g) => ({ build: g.build, entries: g.entries.filter((e) => classes.has(e.name)) }))
    .filter((g) => g.entries.length > 0);
  const counts = { added: 0, readded: 0, removed: 0, changed: 0 };
  for (const g of buildGroups) for (const e of g.entries) counts[e.kind]++;
  write(`api/v1/changelog/${slug}.json`, { ...log, counts, buildGroups } satisfies ApiChangelogPatch);
}

const docsIndex = await get<ApiNameList>("/v1/docs");
write("api/v1/docs.json", { count: DOCS.length, classes: docsIndex.classes.filter((n) => DOCS.includes(n)) });
const all: Record<string, unknown> = {};
for (const name of DOCS) {
  const doc = await get(`/v1/docs/${name}`);
  all[name] = doc;
  write(`api/v1/docs/${name}.json`, doc);
}
write("api/v1/docs/all.json", all);

// The raw database, trimmed to the same classes (keys are unpadded hashes).
const db = await get<MetaDb>("/v1/db");
const rawKeys = Object.keys(db.classes).filter((k) => keep.has(canon(k)));
write("db.json", { ...db, classes: Object.fromEntries(rawKeys.map((k) => [k, db.classes[k]])) });
