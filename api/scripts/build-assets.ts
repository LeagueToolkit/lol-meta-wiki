/**
 * Assembles the Worker's static asset tree (dist/assets/v1) from the
 * generated site data plus the raw meta DB:
 *
 *   site/db-data/classes/*                 ->  classes/, classes-inherited/,
 *                                              docs/ (prose split off)
 *   site/db-data/changelog/*               ->  changelog/
 *   site/public/db/classIndex.json         ->  index.json (absolute wiki URLs)
 *   site/public/db/categories.json         ->  categories.json, classes-by-domain/
 *   db/meta.db.json                        ->  db.json, hashes.json, versions.json
 *   db/meta.pbe.json                       ->  db-pbe.json
 *   site/db-data/preview/classes/*         ->  pbe/classes/, pbe/classes-inherited/
 *   openapi.json                           ->  openapi.json
 *   (derived)                              ->  meta.json, src/generated/hash-to-name.json,
 *                                              src/generated/pbe-hash-to-name.json
 *
 * Every default response is live data. The pbe/ tree is the delta behind
 * `?channel=pbe`: it holds a class file only if the response differs from the
 * live one, and the Worker falls back to the live file for every other class.
 * Without a PBE preview the tree is empty.
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
import { mergePreview, type MetaOverlay } from "../../scripts/preview";
import type { PreviewInfo } from "../../site/src/types";
import { Resolver, canonName } from "./lib/resolver";
import { extractDocs, flattenClass, transformChangelog, transformClass } from "./lib/transform";
import type { ApiClass, ClassDocs, MetaDb, SiteClass, SiteChangelogPatch, SiteDomain } from "./lib/types";

const apiRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(apiRoot, "..");
const src = {
  classes: path.join(repoRoot, "site", "db-data", "classes"),
  changelog: path.join(repoRoot, "site", "db-data", "changelog"),
  classIndex: path.join(repoRoot, "site", "public", "db", "classIndex.json"),
  categories: path.join(repoRoot, "site", "public", "db", "categories.json"),
  db: path.join(repoRoot, "db", "meta.db.json"),
  openapi: path.join(apiRoot, "openapi.json"),
};
// The PBE overlay and the generator's merged-view classes. Both are optional:
// a checkout without the overlay builds the live API alone.
const previewSrc = {
  overlay: path.join(repoRoot, "db", "meta.pbe.json"),
  classes: path.join(repoRoot, "site", "db-data", "preview", "classes"),
};
// Slug of the PBE page of the changelog, as scripts/generate-db.ts names it.
const PREVIEW_SLUG = "pbe";
const outFile = (...segments: string[]) => path.join(apiRoot, "dist", "assets", "v1", ...segments);
const generatedDir = path.join(apiRoot, "src", "generated");

// Wiki base for the /v1/index links; must match `site` in site/astro.config.mjs.
const SITE_URL = "https://meta-wiki.leaguetoolkit.dev";
const API_URL = "https://meta-api.leaguetoolkit.dev";
const HASH_FORMAT = 'FNV-1a 32-bit, "0x" + 8 lowercase hex digits, zero-padded';

// name.<12-hex-content-hash>.json, as emitted by generate-db
const HASHED = /^(.+)\.([0-9a-f]{12})\.json$/;
// names that would shadow derived files at the same route (case-insensitive:
// on a case-insensitive filesystem "Index.json" would clobber "index.json")
const RESERVED = new Set(["index", "all"]);
// a domain id becomes a file name and a ?domain= value; this is the Worker's
// SEGMENT rule, so an id that fails it would be an asset no route can reach
const DOMAIN_ID = /^[A-Za-z0-9._-]+$/;

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file: string, value: unknown) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const sortedRecord = (entries: [string, unknown][]) =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));

function resetOutputDirs() {
  fs.rmSync(outFile(), { recursive: true, force: true });
  for (const dir of [
    "classes",
    "classes-inherited",
    "classes-by-domain",
    "changelog",
    "docs",
    "pbe/classes",
    "pbe/classes-inherited",
  ]) {
    fs.mkdirSync(outFile(dir), { recursive: true });
  }
  fs.mkdirSync(generatedDir, { recursive: true });
}

/**
 * Read every live site class, transform to the API shape, split the prose off.
 * A page of a PBE-only class is skipped: the class is not in the live db, and
 * its data reaches the API through the preview tree.
 */
function loadClasses(resolver: Resolver) {
  const sites = new Map<string, SiteClass>(); // API name -> site class
  const classes = new Map<string, ApiClass>(); // API name -> class
  const docs = new Map<string, ClassDocs>();
  for (const file of fs.readdirSync(src.classes)) {
    if (!HASHED.test(file)) continue;
    const site: SiteClass = readJson(path.join(src.classes, file));
    if (site.preview?.kind === "only") continue;
    const name = canonName(site.name);
    if (RESERVED.has(name.toLowerCase())) throw new Error(`class name collides with a derived endpoint: ${file}`);
    if (classes.has(name)) throw new Error(`duplicate class file for ${name} - stale ${src.classes}?`);
    sites.set(name, site);
    classes.set(name, transformClass(resolver, site));
    const doc = extractDocs(site);
    if (doc) docs.set(name, doc);
  }
  return { sites, classes, docs };
}

/** Write the class tree. Returns the inherited view of each class. */
function writeClassTree(classes: Map<string, ApiClass>): Map<string, ApiClass> {
  const inherited = new Map<string, ApiClass>();
  for (const [name, cls] of classes) {
    const flat = flattenClass(cls, classes);
    inherited.set(name, flat);
    writeJson(outFile("classes", `${name}.json`), cls);
    writeJson(outFile("classes-inherited", `${name}.json`), flat);
  }
  const names = [...classes.keys()].sort();
  writeJson(outFile("classes", "index.json"), { count: names.length, classes: names });
  return inherited;
}

// --- PBE preview ---

interface Preview {
  info: PreviewInfo;
  /** Resolver over the merged database (scripts/preview.ts). */
  resolver: Resolver;
  /** API name -> the generator's merged-view site class. */
  sites: Map<string, SiteClass>;
}

/**
 * Read the overlay and the generator's merged-view classes. Returns null if
 * there is no overlay file, the overlay holds no preview, or it was built on
 * another live build than the db. The generator makes the same decision from
 * the same two files, so a preview tree that disagrees with it is stale site
 * data and stops the build.
 */
function loadPreview(db: MetaDb): Preview | null {
  const files = fs.existsSync(previewSrc.classes)
    ? fs.readdirSync(previewSrc.classes).filter((f) => f.endsWith(".json"))
    : [];
  const overlay: MetaOverlay | null = fs.existsSync(previewSrc.overlay) ? readJson(previewSrc.overlay) : null;
  const merged = overlay ? mergePreview(db, overlay) : null;
  if (merged?.status !== "ok") {
    if (merged?.status === "mismatch") {
      console.warn(
        `meta.pbe.json was built on live build ${merged.base}, but meta.db.json is at build ${merged.latest}; no PBE preview`
      );
    }
    if (files.length > 0) {
      throw new Error(`${previewSrc.classes} holds ${files.length} classes but there is no PBE preview - site data is stale, re-run generate-db`);
    }
    return null;
  }
  if (files.length === 0) {
    throw new Error(`meta.pbe.json holds a PBE preview but ${previewSrc.classes} is empty - site data is stale, re-run generate-db`);
  }
  const sites = new Map<string, SiteClass>();
  for (const file of files) {
    const site: SiteClass = readJson(path.join(previewSrc.classes, file));
    sites.set(canonName(site.name), site);
  }
  return { info: merged.info, resolver: new Resolver(merged.db), sites };
}

/**
 * Write the pbe/ tree: the database as of the PBE build, reduced to the class
 * files whose response differs from the live one. Every live class is
 * transformed again with the merged resolver, because a type reference can
 * change kind (an unknown hash that PBE turns into a class) without the site
 * class changing. Returns the number of class files written.
 */
function writePreviewTree(
  preview: Preview,
  live: { sites: Map<string, SiteClass>; classes: Map<string, ApiClass>; inherited: Map<string, ApiClass> }
): number {
  const classes = new Map<string, ApiClass>();
  for (const [name, site] of live.sites) {
    classes.set(name, transformClass(preview.resolver, preview.sites.get(name) ?? site));
  }
  for (const [name, site] of preview.sites) {
    if (classes.has(name)) continue;
    if (RESERVED.has(name.toLowerCase())) throw new Error(`class name collides with a derived endpoint: ${name}`);
    classes.set(name, transformClass(preview.resolver, site));
  }

  const differs = (a: ApiClass, b: ApiClass | undefined) => JSON.stringify(a) !== JSON.stringify(b);
  let written = 0;
  for (const [name, cls] of classes) {
    if (differs(cls, live.classes.get(name))) {
      writeJson(outFile("pbe", "classes", `${name}.json`), cls);
      written++;
    }
    const flat = flattenClass(cls, classes);
    if (differs(flat, live.inherited.get(name))) {
      writeJson(outFile("pbe", "classes-inherited", `${name}.json`), flat);
    }
  }
  const names = [...classes.keys()].sort();
  writeJson(outFile("pbe", "classes", "index.json"), { count: names.length, classes: names });
  return written;
}

/**
 * The domain list, plus one class-name list per domain: the precomputed
 * answers to /v1/classes?domain={id}. Every domain gets a list, empty or not,
 * so a known id never 404s.
 */
function writeCategories(classes: Map<string, ApiClass>): number {
  const domains: SiteDomain[] = readJson(src.categories);
  const members = new Map<string, string[]>();
  for (const { id } of domains) {
    if (!DOMAIN_ID.test(id)) throw new Error(`domain id is not routable: ${id}`);
    members.set(id, []);
  }
  for (const [name, cls] of classes) {
    const list = cls.category && members.get(cls.category.domain);
    if (!list) {
      throw new Error(`class ${name} has no domain from ${src.categories} - site data is stale, re-run generate-db`);
    }
    list.push(name);
  }
  for (const [id, names] of members) {
    names.sort();
    writeJson(outFile("classes-by-domain", `${id}.json`), { count: names.length, classes: names });
  }
  writeJson(outFile("categories.json"), { count: domains.length, domains });
  return domains.length;
}

function writeDocsTree(docs: Map<string, ClassDocs>) {
  for (const [name, doc] of docs) {
    writeJson(outFile("docs", `${name}.json`), doc);
  }
  const names = [...docs.keys()].sort();
  writeJson(outFile("docs", "index.json"), { count: names.length, classes: names });
  writeJson(outFile("docs", "all.json"), sortedRecord([...docs.entries()]));
}

function writeChangelog(resolver: Resolver, preview: Preview | null): number {
  let patches = 0;
  for (const file of fs.readdirSync(src.changelog)) {
    const m = HASHED.exec(file);
    if (m && m[1] === PREVIEW_SLUG) {
      // The PBE page names PBE-only classes, which only the merged resolver knows.
      if (!preview) throw new Error(`${file} exists but there is no PBE preview - site data is stale, re-run generate-db`);
      const patch: SiteChangelogPatch = readJson(path.join(src.changelog, file));
      writeJson(outFile("changelog", `${m[1]}.json`), transformChangelog(preview.resolver, patch));
    } else if (m) {
      patches++;
      const patch: SiteChangelogPatch = readJson(path.join(src.changelog, file));
      writeJson(outFile("changelog", `${m[1]}.json`), transformChangelog(resolver, patch));
    } else if (file === "index.json") {
      fs.copyFileSync(path.join(src.changelog, file), outFile("changelog", "index.json"));
    }
  }
  return patches;
}

function writeIndexes(resolver: Resolver, db: MetaDb, classes: Map<string, ApiClass>, preview: Preview | null) {
  // index.json: API class name -> absolute wiki URL (the wiki keeps its own
  // unpadded, lowercased slugs, so map through the site's classIndex). The
  // site's index also lists the pages of PBE-only classes; those stay out.
  const siteClassIndex: Record<string, string> = readJson(src.classIndex);
  writeJson(
    outFile("index.json"),
    sortedRecord(
      Object.entries(siteClassIndex)
        .map(([name, rel]): [string, string] => [canonName(name), SITE_URL + rel])
        .filter(([name]) => classes.has(name))
    )
  );

  // The classes and external types that only the merged database has.
  const previewClasses = preview
    ? [...preview.resolver.classByHash.entries()].filter(([h]) => !resolver.classByHash.has(h))
    : [];
  const previewExternals = preview
    ? [...preview.resolver.externalNameByHash.entries()].filter(([h]) => !resolver.externalNameByHash.has(h))
    : [];

  // hashes.json: canonical hash -> resolved name (null = dumped but unnamed;
  // every "classes" key is fetchable via /v1/classes/{hash}).
  writeJson(outFile("hashes.json"), {
    format: HASH_FORMAT,
    count: resolver.classByHash.size,
    classes: sortedRecord([...resolver.classByHash.entries()].map(([h, c]) => [h, c.name])),
    externals: sortedRecord([...resolver.externalNameByHash.entries()]),
    // The hashes that exist on PBE only; a "classes" key is fetchable via
    // /v1/classes/{hash}?channel=pbe.
    preview: preview && {
      ...preview.info,
      count: previewClasses.length,
      classes: sortedRecord(previewClasses.map(([h, c]) => [h, c.name])),
      externals: sortedRecord(previewExternals),
    },
  });

  // The Worker resolves /v1/classes/{hash} for named classes through this map
  // (unnamed classes are stored under their canonical hash already).
  writeJson(
    path.join(generatedDir, "hash-to-name.json"),
    sortedRecord([...resolver.classHashByName.entries()].map(([name, hash]) => [hash, name]))
  );
  // The same map for the named PBE-only classes, consulted first under
  // ?channel=pbe. Always written: the Worker imports it.
  writeJson(
    path.join(generatedDir, "pbe-hash-to-name.json"),
    sortedRecord(previewClasses.filter(([, c]) => c.name !== null).map(([h, c]) => [h, c.name]))
  );

  // versions.json: the patch <-> build map, so the raw build numbers in
  // changelog entries and /v1/db can be translated to patches.
  writeJson(outFile("versions.json"), {
    latestPatch: latestVersion(db).patch,
    latestBuild: db.latest,
    count: db.versions.length,
    versions: db.versions,
    // The PBE build is not a live build, so it stays out of `versions`.
    preview: preview?.info ?? null,
  });
}

const latestVersion = (db: MetaDb) =>
  db.versions.filter((v) => v.build === db.latest).pop() ?? db.versions[db.versions.length - 1];

function writeMeta(
  resolver: Resolver,
  db: MetaDb,
  counts: { classes: number; documented: number; patches: number },
  preview: (PreviewInfo & { classes: number }) | null
) {
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
    // The PBE build that ?channel=pbe describes, or null. `classes` counts the
    // classes whose ?channel=pbe response differs from the live one.
    preview,
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
      classListByDomain: "/v1/classes?domain={id}",
      classListPreview: "/v1/classes?channel=pbe",
      classDetail: "/v1/classes/{name-or-hash}",
      classDetailInherited: "/v1/classes/{name-or-hash}?inherited=1",
      classDetailPreview: "/v1/classes/{name-or-hash}?channel=pbe",
      categories: "/v1/categories",
      hashIndex: "/v1/hashes",
      wikiUrlIndex: "/v1/index",
      versions: "/v1/versions",
      changelogIndex: "/v1/changelog",
      changelogPatch: "/v1/changelog/{slug}",
      changelogPreview: "/v1/changelog/pbe",
      bulkDatabase: "/v1/db",
      bulkPreviewOverlay: "/v1/db/pbe",
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
const preview = loadPreview(db);

resetOutputDirs();
const { sites, classes, docs } = loadClasses(resolver);
const inherited = writeClassTree(classes);
const previewClasses = preview ? writePreviewTree(preview, { sites, classes, inherited }) : 0;
const domains = writeCategories(classes);
writeDocsTree(docs);
const patches = writeChangelog(resolver, preview);
writeIndexes(resolver, db, classes, preview);
fs.copyFileSync(src.db, outFile("db.json"));
// The overlay as fetched, so /v1/db/pbe pairs with /v1/db. A checkout without
// the file serves the no-preview form.
if (fs.existsSync(previewSrc.overlay)) {
  fs.copyFileSync(previewSrc.overlay, outFile("db-pbe.json"));
} else {
  const empty: MetaOverlay = {
    formatVersion: 1,
    channel: "pbe",
    patch: null,
    build: null,
    base: null,
    externalTypeNames: {},
    classes: {},
  };
  writeJson(outFile("db-pbe.json"), empty);
}
fs.copyFileSync(src.openapi, outFile("openapi.json"));
writeMeta(
  resolver,
  db,
  { classes: classes.size, documented: docs.size, patches },
  preview && { ...preview.info, classes: previewClasses }
);

console.log(
  `assets built: ${classes.size} classes (${resolver.classHashByName.size} named, ${docs.size} documented), ${domains} domains, ${patches} patches` +
    (preview ? `, PBE ${preview.info.patch}.${preview.info.build} with ${previewClasses} classes` : ", no PBE preview") +
    ` -> ${outFile()}`
);
