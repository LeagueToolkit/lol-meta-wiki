/**
 * Assembles the Worker's static asset tree (dist/assets/v1) from the
 * generated site data plus the raw meta DB:
 *
 *   site/db-data/classes/*                 ->  classes/, classes-inherited/,
 *                                              docs/ (prose split off)
 *   site/db-data/changelog/*               ->  changelog/
 *   site/public/db/classIndex.json         ->  index.json (absolute wiki URLs)
 *   db/meta.db.json                        ->  db.json, hashes.json, versions.json
 *   openapi.json                           ->  openapi.json
 *   (derived)                              ->  meta.json, src/generated/hash-to-name.json
 *
 * The API is hash-first: hashes are emitted in canonical form ("0x" + 8
 * lowercase hex digits) and the Worker resolves /v1/classes/{hash} through
 * the generated hash-to-name map. See lib/resolver.ts and lib/transform.ts
 * for the shape rules; this file is only I/O and layout.
 *
 * Facts and prose are split on purpose: class endpoints carry unrestricted
 * Factual Data, while human-authored CC BY-SA prose is served only from the
 * /v1/docs tree. Consumers who never touch /v1/docs never ingest licensed
 * content.
 *
 * Run `bun scripts/generate-db.ts` at the repo root first; this script only
 * repackages that output. Idempotent: re-running produces the same tree.
 */

import fs from "node:fs";
import path from "node:path";
import { Resolver, canonName } from "./lib/resolver";
import { extractDocs, flattenClass, transformChangelog, transformClass } from "./lib/transform";
import type { ApiClass, ClassDocs, MetaDb, SiteClass, SiteChangelogPatch } from "./lib/types";

const apiRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(apiRoot, "..");
const src = {
  classes: path.join(repoRoot, "site", "db-data", "classes"),
  changelog: path.join(repoRoot, "site", "db-data", "changelog"),
  classIndex: path.join(repoRoot, "site", "public", "db", "classIndex.json"),
  db: path.join(repoRoot, "db", "meta.db.json"),
  openapi: path.join(apiRoot, "openapi.json"),
};
const outFile = (...segments: string[]) => path.join(apiRoot, "dist", "assets", "v1", ...segments);
const generatedDir = path.join(apiRoot, "src", "generated");

// Wiki base for the /v1/index links; must match `site` in site/astro.config.mjs.
const SITE_URL = "https://meta-wiki.leaguetoolkit.dev";
const API_URL = "https://api.meta-wiki.leaguetoolkit.dev";
const HASH_FORMAT = 'FNV-1a 32-bit, "0x" + 8 lowercase hex digits, zero-padded';

// name.<12-hex-content-hash>.json, as emitted by generate-db
const HASHED = /^(.+)\.([0-9a-f]{12})\.json$/;
// names that would shadow derived files at the same route (case-insensitive:
// on a case-insensitive filesystem "Index.json" would clobber "index.json")
const RESERVED = new Set(["index", "all"]);

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file: string, value: unknown) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const sortedRecord = (entries: [string, unknown][]) =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));

function resetOutputDirs() {
  fs.rmSync(outFile(), { recursive: true, force: true });
  for (const dir of ["classes", "classes-inherited", "changelog", "docs"]) {
    fs.mkdirSync(outFile(dir), { recursive: true });
  }
  fs.mkdirSync(generatedDir, { recursive: true });
}

/** Read every site class, transform to the API shape, split the prose off. */
function loadClasses(resolver: Resolver) {
  const classes = new Map<string, ApiClass>(); // API name -> class
  const docs = new Map<string, ClassDocs>();
  for (const file of fs.readdirSync(src.classes)) {
    if (!HASHED.test(file)) continue;
    const site: SiteClass = readJson(path.join(src.classes, file));
    const name = canonName(site.name);
    if (RESERVED.has(name.toLowerCase())) throw new Error(`class name collides with a derived endpoint: ${file}`);
    if (classes.has(name)) throw new Error(`duplicate class file for ${name} - stale ${src.classes}?`);
    classes.set(name, transformClass(resolver, site));
    const doc = extractDocs(site);
    if (doc) docs.set(name, doc);
  }
  return { classes, docs };
}

function writeClassTree(classes: Map<string, ApiClass>) {
  for (const [name, cls] of classes) {
    writeJson(outFile("classes", `${name}.json`), cls);
    writeJson(outFile("classes-inherited", `${name}.json`), flattenClass(cls, classes));
  }
  const names = [...classes.keys()].sort();
  writeJson(outFile("classes", "index.json"), { count: names.length, classes: names });
}

function writeDocsTree(docs: Map<string, ClassDocs>) {
  for (const [name, doc] of docs) {
    writeJson(outFile("docs", `${name}.json`), doc);
  }
  const names = [...docs.keys()].sort();
  writeJson(outFile("docs", "index.json"), { count: names.length, classes: names });
  writeJson(outFile("docs", "all.json"), sortedRecord([...docs.entries()]));
}

function writeChangelog(resolver: Resolver): number {
  let patches = 0;
  for (const file of fs.readdirSync(src.changelog)) {
    const m = HASHED.exec(file);
    if (m) {
      patches++;
      const patch: SiteChangelogPatch = readJson(path.join(src.changelog, file));
      writeJson(outFile("changelog", `${m[1]}.json`), transformChangelog(resolver, patch));
    } else if (file === "index.json") {
      fs.copyFileSync(path.join(src.changelog, file), outFile("changelog", "index.json"));
    }
  }
  return patches;
}

function writeIndexes(resolver: Resolver, db: MetaDb) {
  // index.json: API class name -> absolute wiki URL (the wiki keeps its own
  // unpadded, lowercased slugs, so map through the site's classIndex).
  const siteClassIndex: Record<string, string> = readJson(src.classIndex);
  writeJson(
    outFile("index.json"),
    sortedRecord(Object.entries(siteClassIndex).map(([name, rel]) => [canonName(name), SITE_URL + rel]))
  );

  // hashes.json: canonical hash -> resolved name (null = dumped but unnamed;
  // every "classes" key is fetchable via /v1/classes/{hash}).
  writeJson(outFile("hashes.json"), {
    format: HASH_FORMAT,
    count: resolver.classByHash.size,
    classes: sortedRecord([...resolver.classByHash.entries()].map(([h, c]) => [h, c.name])),
    externals: sortedRecord([...resolver.externalNameByHash.entries()]),
  });

  // The Worker resolves /v1/classes/{hash} for named classes through this map
  // (unnamed classes are stored under their canonical hash already).
  writeJson(
    path.join(generatedDir, "hash-to-name.json"),
    sortedRecord([...resolver.classHashByName.entries()].map(([name, hash]) => [hash, name]))
  );

  // versions.json: the patch <-> build map, so the raw build numbers in
  // changelog entries and /v1/db can be translated to patches.
  writeJson(outFile("versions.json"), {
    latestPatch: latestVersion(db).patch,
    latestBuild: db.latest,
    count: db.versions.length,
    versions: db.versions,
  });
}

const latestVersion = (db: MetaDb) =>
  db.versions.filter((v) => v.build === db.latest).pop() ?? db.versions[db.versions.length - 1];

function writeMeta(resolver: Resolver, db: MetaDb, counts: { classes: number; documented: number; patches: number }) {
  const changelogIndex = readJson(outFile("changelog", "index.json"));
  writeJson(outFile("meta.json"), {
    name: "LoL Meta Wiki API",
    version: "v1",
    site: SITE_URL,
    baseUrl: API_URL,
    generatedAt: changelogIndex.generatedAt,
    hashFormat: HASH_FORMAT,
    dataset: {
      // The observation window: classes/properties already present at firstBuild
      // have since == null ("present when tracking began"), not "added then".
      firstPatch: db.versions[0].patch,
      firstBuild: db.versions[0].build,
      latestPatch: latestVersion(db).patch,
      latestBuild: db.latest,
      fetchedAt: db.hashSource?.fetchedAt ?? null,
    },
    counts: {
      classes: counts.classes,
      namedClasses: resolver.classHashByName.size,
      documentedClasses: counts.documented,
      patches: counts.patches,
    },
    endpoints: {
      meta: "/v1",
      openapi: "/v1/openapi",
      classList: "/v1/classes",
      classDetail: "/v1/classes/{name-or-hash}",
      classDetailInherited: "/v1/classes/{name-or-hash}?inherited=1",
      hashIndex: "/v1/hashes",
      wikiUrlIndex: "/v1/index",
      versions: "/v1/versions",
      changelogIndex: "/v1/changelog",
      changelogPatch: "/v1/changelog/{slug}",
      bulkDatabase: "/v1/db",
      docsIndex: "/v1/docs",
      docsDetail: "/v1/docs/{name-or-hash}",
      docsBulk: "/v1/docs/all",
    },
  });
}

// --- main ---

for (const p of Object.values(src)) {
  if (!fs.existsSync(p)) {
    console.error(`missing input: ${p}\nRun \`bun scripts/generate-db.ts\` at the repo root first.`);
    process.exit(1);
  }
}

const db: MetaDb = readJson(src.db);
const resolver = new Resolver(db);

resetOutputDirs();
const { classes, docs } = loadClasses(resolver);
writeClassTree(classes);
writeDocsTree(docs);
const patches = writeChangelog(resolver);
writeIndexes(resolver, db);
fs.copyFileSync(src.db, outFile("db.json"));
fs.copyFileSync(src.openapi, outFile("openapi.json"));
writeMeta(resolver, db, { classes: classes.size, documented: docs.size, patches });

console.log(
  `assets built: ${classes.size} classes (${resolver.classHashByName.size} named, ${docs.size} documented), ${patches} patches -> ${outFile()}`
);
