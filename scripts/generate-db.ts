#!/usr/bin/env bun
/**
 * LoL Meta DB per-class JSON & MDX generator (Bun)
 *
 * Input:   db/meta.db.json  (versioned database from LeagueToolkit/lol-meta-classes;
 *          see its docs/meta-db-format.md - refresh with `pnpm update-db`)
 *          db/meta.pbe.json (the PBE overlay of the same repository; optional)
 * Output:  classesOutDir/<ClassName>.<sha12>.json (build-time only, NOT in
 *          public/ - copying 5k+ files into dist every build was a major
 *          build-time cost)
 *          graphOutFile (build-time only: the inheritance graph + removed set,
 *          read once per build by the class pages)
 *          outDir/index.json (fetched client-side)
 *          outDir/classIndex.json (fetched client-side)
 *          outDir/classSidebar.json (fetched client-side, grouped sidebar view)
 *          outDir/categories.json (the ordered domain list, with counts)
 *          domainsOutDir/<id>.<sha12>.json + domainsMdxDir/<id>.mdx (one
 *          browse page per domain)
 *          outDir/classHashes.json (fetched client-side by the 404 resolver)
 *          mdxDir/<ClassName>.mdx (Starlight docs)
 *          previewOutDir/classes/<ClassName>.json (build-time only: the classes
 *          that differ in the database as of the PBE build, read by api/scripts)
 *          changelogOutDir/pbe.<sha12>.json + changelogMdxDir/pbe.mdx (the PBE
 *          preview page; the MDX exists with and without a preview)
 *
 * Usage:
 *   bun run scripts/generate-db.ts --in db/meta.db.json --out site/public/db --classes-out site/db-data/classes --mdx site/src/content/docs/classes
 *   --strict turns warnings from db/categories.yaml (a root or pin naming a
 *   class the db does not have) into errors; PR checks pass it, deploys don't.
 *
 * Notes:
 * - Everything in meta.db.json is keyed by FNV-1a hash; resolved names are
 *   attached as metadata. Display names (resolved name or raw hex) drive
 *   slugs and links, same as before.
 * - Each class/property carries a revision history. The page shows the
 *   latest definition; older revisions surface as "type history", and
 *   entities absent from the latest game build are marked removed.
 * - Live data is the content of every page. If the overlay holds a PBE build,
 *   the generator loads the merged database a second time (scripts/preview.ts)
 *   and adds what differs: a page per PBE-only class, a `preview` entry on
 *   each class that the PBE build changes or removes, and the PBE page of the
 *   changelog. Without a preview the live output is the same as without the
 *   overlay file.
 */

import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { parse as parseYAML } from "yaml";
// Output shapes are the generator↔consumer contract - defined once in the
// site package and imported here so the producer can't drift from the
// consumers (components and api/scripts). Types only, plus the two reserved
// domain ids - plain constants, so there is still no cross-package dep.
import {
  SHARED_DOMAIN,
  UNCATEGORIZED_DOMAIN,
  type CategoryVia,
  type ChangeTuple,
  type PropChange,
  type ClassChange,
  type ChangelogCounts,
  type ChangelogIndex,
  type ChangelogPatch,
  type ChangelogPreviewEntry,
  type ClassDocumentation,
  type ClassCategory,
  type ClassGraph,
  type ClassHashIndex,
  type ClassJson,
  type ClassKind,
  type ClassPreview,
  type ClassSidebar,
  type ClassSidebarDomain,
  type ClassSidebarEntry,
  type ClassSidebarGroup,
  type DescendantNode,
  type DomainClass,
  type DomainFamily,
  type DomainInfo,
  type DomainPageData,
  type PreviewInfo,
  type Property,
  type PropertyDocumentation,
  type SymbolClassEntry,
  type SymbolsIndex,
  type TypeHistoryEntry,
  type UsedByClass,
  type UsedByProp,
} from "../site/src/types";
// Raw meta.db.json shapes, shared with api/scripts.
import type { MetaDb, PropRevision } from "./meta-db";
import { mergePreview, type MetaOverlay } from "./preview";
import {
  categorize,
  parseCategoryConfig,
  type CategoryConfig,
  type UsageEdge,
} from "./categorize";

// --- intermediate build shape ---
// The generator's working shape before ancestors/descendants and docs are
// attached to form the emitted ClassJson.
type ClassDoc = {
  name: string; // resolved type name or raw hex
  hash: string; // canonical class hash (see canonHash)
  bases: string[]; // zero or more base names (resolved or hex)
  kind: ClassKind;
  properties: Property[];
  since?: string; // patch the class was added in
  removedIn?: string; // patch the class was removed in
};

// --- CLI args ---
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const val =
      process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
        ? process.argv[++i]
        : "true";
    args.set(key, val);
  }
}
const inFile = args.get("in") ?? "db/meta.db.json";
const previewFile = args.get("preview") ?? "db/meta.pbe.json";
const outDir = args.get("out") ?? "site/public/db";
const classesOutDir = args.get("classes-out") ?? "site/db-data/classes";
const graphOutFile = args.get("graph-out") ?? "site/db-data/classGraph.json";
const mdxDir = args.get("mdx") ?? "site/src/content/docs/classes";
const changelogOutDir =
  args.get("changelog-out") ?? "site/db-data/changelog";
const changelogMdxDir =
  args.get("changelog-mdx") ?? "site/src/content/docs/changelog";
const domainsOutDir = args.get("domains-out") ?? "site/db-data/domains";
const domainsMdxDir = args.get("domains-mdx") ?? "site/src/content/docs/domains";
const previewOutDir = args.get("preview-out") ?? "site/db-data/preview";
const docsDir = args.get("docs") ?? "db/docs";
const categoriesFile = args.get("categories") ?? "db/categories.yaml";
const strict = args.get("strict") === "true" || args.get("strict") === "1";
const pretty = args.get("pretty") === "true" || args.get("pretty") === "1";

// --- helpers ---
function sha12(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
// Content hash for hashed filenames. Always hashes the minified serialization
// so the hash (and the MDX stubs embedding it) is identical with and without
// --pretty - dev/prebuild pass --pretty 1 while the bare CLI doesn't, and the
// two must not churn each other's output.
function contentHash(value: unknown) {
  return sha12(JSON.stringify(value));
}
function safeName(name: string) {
  // Keep hex and identifiers; sanitize anything weird just in case
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}
// Class page slug - must match classIndex ("/classes/<slug>") in the wiki
function classSlug(name: string) {
  return safeName(name).toLowerCase();
}
// Canonical spelling of a hash: "0x" + 8 lowercase, zero-padded hex digits.
// meta.db.json stores unpadded hex ("0x6516a"), so the same class is spelled
// two ways across the project; the API canonicalizes the same way (see
// api/scripts/lib/resolver.ts) and classHashes.json is keyed by this form.
function canonHash(hash: string) {
  return "0x" + hash.slice(2).toLowerCase().padStart(8, "0");
}
// Heading anchor slug for a property, matching the ids rehype-slug assigns to
// the "## <name>" headings generateMDX emits (github-slugger semantics:
// lowercase, drop punctuation, spaces → hyphens). Property names are C++-style
// identifiers or raw hex, so this is almost always just a lowercase.
function anchorSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "");
}
async function writeIfChanged(path: string, contents: string) {
  try {
    const prev = await readFile(path, "utf8");
    if (prev === contents) return false;
  } catch {}
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return true;
}

/**
 * Load documentation for a class from unified YAML file
 */
async function loadDocs(className: string, docsDir: string): Promise<{
  classDocs: ClassDocumentation | null;
  propertyDocs: Record<string, PropertyDocumentation>;
}> {
  try {
    const docPath = join(docsDir, `${className}.yaml`);
    const content = await readFile(docPath, "utf8");
    const parsed = parseYAML(content);

    // Extract class-level docs
    const classDocs = parsed?.class ? (parsed.class as ClassDocumentation) : null;

    // Extract property docs. Keys are lowercased so lookups are
    // case-insensitive: newer hashtables renamed many fields
    // PascalCase → camelCase, and docs written against the old casing
    // must keep applying.
    const propertyDocs: Record<string, PropertyDocumentation> = {};
    if (parsed?.properties && typeof parsed.properties === 'object') {
      for (const [key, value] of Object.entries(parsed.properties)) {
        if (typeof value === 'object' && value !== null) {
          propertyDocs[key.toLowerCase()] = value as PropertyDocumentation;
        }
      }
    }

    return { classDocs, propertyDocs };
  } catch {
    return { classDocs: null, propertyDocs: {} };
  }
}

// --- meta.db.json reader ---
function loadMetaDb(db: MetaDb): ClassDoc[] {
  if (db.formatVersion !== 1) {
    throw new Error(
      `Unsupported meta db formatVersion ${db.formatVersion} (expected 1). ` +
      `Update this script or fetch a compatible db with 'pnpm update-db'.`
    );
  }

  // Builds are the unit of time, ordered by their position in `versions`. Do
  // not compare build numbers: the PBE build of a merged db comes last and can
  // be lower than a live build (see scripts/preview.ts).
  const builds = db.versions.map((v) => v.build);
  const patchByBuild = new Map(db.versions.map((v) => [v.build, v.patch]));
  const firstBuild = builds[0];
  const patchOf = (build: number) => patchByBuild.get(build)!;
  // "removed in" = the patch of the first build the entity is missing from
  const patchAfter = (build: number) => {
    const i = builds.indexOf(build);
    return patchOf(builds[Math.min(i + 1, builds.length - 1)]);
  };

  // Display name for any type hash: dumped class name, known external type
  // name, or the raw hash itself.
  const nameOf = (hash: string) =>
    hash === "0x0"
      ? "0x0"
      : db.classes[hash]?.name ?? db.externalTypeNames[hash] ?? hash;

  const classes: ClassDoc[] = [];
  for (const [khash, klass] of Object.entries(db.classes)) {
    const classRevs = klass.revisions;
    const currentClass = classRevs[classRevs.length - 1];
    const classFrom = classRevs[0].from;
    const classRemoved = currentClass.to !== undefined;

    const doc: ClassDoc = {
      name: klass.name ?? khash,
      hash: canonHash(khash),
      bases: currentClass.bases.map(nameOf),
      kind: currentClass.interface ? "interface" : currentClass.value ? "value" : "class",
      properties: [],
    };
    if (classFrom !== firstBuild) doc.since = patchOf(classFrom);
    if (classRemoved) doc.removedIn = patchAfter(currentClass.to!);

    for (const [fhash, metaProp] of Object.entries(klass.properties)) {
      const revs = metaProp.revisions;
      const current = revs[revs.length - 1];
      const [ft, kt, vt, khRaw] = current.type;

      const prop: Property = {
        name: metaProp.name ?? fhash,
        ft,
        kt,
        vt,
        kh: nameOf(khRaw),
      };
      // "Added in" only when the property appeared after the class did
      // (and after tracking started, where the real origin is unknown)
      const propFrom = revs[0].from;
      if (propFrom !== firstBuild && propFrom !== classFrom) {
        prop.since = patchOf(propFrom);
      }
      // Removed property in a living class; a removed class covers its
      // properties with the class-level banner instead
      if (current.to !== undefined && !classRemoved) {
        prop.removedIn = patchAfter(current.to);
      }
      if ("default" in current) {
        prop.defaultValue = JSON.stringify(current.default);
      }
      // Collapse consecutive revisions whose type didn't change (a property
      // removed and re-added between builds); at patch granularity those
      // read as duplicate rows, so history only surfaces real type changes
      const merged: PropRevision[] = [];
      for (const rev of revs) {
        const prev = merged[merged.length - 1];
        if (prev && prev.type.join("|") === rev.type.join("|")) {
          if (rev.to !== undefined) prev.to = rev.to;
          else delete prev.to;
          if ("default" in rev) prev.default = rev.default;
        } else {
          merged.push({ ...rev });
        }
      }
      if (merged.length > 1) {
        prop.history = merged.map((rev) => {
          const [hft, hkt, hvt, hkh] = rev.type;
          const entry: TypeHistoryEntry = {
            since: patchOf(rev.from),
            until: rev.to !== undefined ? patchOf(rev.to) : null,
            ft: hft,
            kt: hkt,
            vt: hvt,
            kh: nameOf(hkh),
          };
          if ("default" in rev) entry.defaultValue = JSON.stringify(rev.default);
          return entry;
        });
      }
      doc.properties.push(prop);
    }
    doc.properties.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    classes.push(doc);
  }

  classes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return classes;
}

// --- categories ---
/**
 * Every "class A has a property typed as class B" pair, at each class's final
 * state: a property counts when it was still there at its class's last build.
 * For a class in the latest build that is exactly the "Referenced by" edge set;
 * a removed class contributes the references it had when it was last seen, so
 * removed families can still be placed by what used them.
 */
function usageEdges(db: MetaDb): UsageEdge[] {
  const edges: UsageEdge[] = [];
  for (const [khash, klass] of Object.entries(db.classes)) {
    const last = klass.revisions[klass.revisions.length - 1];
    for (const prop of Object.values(klass.properties)) {
      const rev = prop.revisions[prop.revisions.length - 1];
      if (rev.to !== last.to) continue;
      const target = db.classes[rev.type[3]];
      if (!target) continue;
      edges.push({
        user: klass.name ?? khash,
        used: target.name ?? rev.type[3],
        live: last.to === undefined,
      });
    }
  }
  return edges;
}

/**
 * Read db/categories.yaml. A mistake in the file always stops the run; a
 * reference to a class the db does not have only does under --strict (see
 * parseCategoryConfig for why).
 */
async function loadCategoryConfig(classes: ClassDoc[]): Promise<CategoryConfig> {
  const names = new Set(classes.map((c) => c.name));
  const nameByHash = new Map(classes.map((c) => [c.hash, c.name]));
  const resolve = (ref: string) =>
    names.has(ref)
      ? ref
      : /^0x[0-9a-f]+$/i.test(ref)
        ? nameByHash.get(canonHash(ref))
        : undefined;

  const raw = parseYAML(await readFile(categoriesFile, "utf8"));
  const { config, errors, warnings } = parseCategoryConfig(raw, resolve);
  for (const w of warnings) console.warn(`[warn] ${basename(categoriesFile)}: ${w}`);
  const fatal = strict ? [...errors, ...warnings] : errors;
  if (fatal.length > 0) {
    throw new Error(`${basename(categoriesFile)}:\n  - ${fatal.join("\n  - ")}`);
  }
  return config;
}

// Titles for the two domains no file defines.
const RESERVED_DOMAINS: Pick<DomainInfo, "id" | "title" | "description">[] = [
  {
    id: SHARED_DOMAIN,
    title: "Shared",
    description: "Building blocks used by more than one domain.",
  },
  {
    id: UNCATEGORIZED_DOMAIN,
    title: "Uncategorized",
    description: "Classes no domain claims yet.",
  },
];

// --- changelog builder ---
/**
 * Derive a per-patch changelog from meta.db.json revision boundaries.
 *
 * Everything is reconstructed from the {from, to} ranges on class and property
 * revisions - no extra data is needed. For each build boundary B_prev → B_cur
 * (builds are the unit of time, already sorted in db.versions) we classify each
 * class as added / re-added / removed / changed, then group builds by patch and
 * drop the first tracked build (where everything "appears" - tracking-start
 * noise, same reason generate-db suppresses `since` for firstBuild).
 *
 * `domainOf` is the class's domain *today*: unlike `family` it is not resolved
 * at the build of the change, because categories.yaml has no history.
 *
 * A revision carries {from, to} with both bounds inclusive: the entity is
 * present from build `from` through build `to` (or through the latest build
 * when `to` is absent). db_build closes a revision at the last build with the
 * old shape and opens a new one at the next build whenever bases/interface/
 * value change, so a *consecutive* to/from split is a change, while a gap
 * (to << next from) is a real removal followed by a re-add.
 */
function buildChangelog(
  db: MetaDb,
  domainOf: (className: string) => string | undefined
): ChangelogPatch[] {
  const builds = db.versions.map((v) => v.build); // in timeline order
  const patchByBuild = new Map(db.versions.map((v) => [v.build, v.patch]));
  const buildIndex = new Map(builds.map((b, i) => [b, i]));
  const firstBuild = builds[0];
  const lastBuild = builds[builds.length - 1];
  const patchOf = (b: number) => patchByBuild.get(b)!;
  const prevBuild = (b: number) => builds[buildIndex.get(b)! - 1];
  const nextBuild = (b: number) => builds[buildIndex.get(b)! + 1];

  const nameOf = (hash: string) =>
    hash === "0x0"
      ? "0x0"
      : db.classes[hash]?.name ?? db.externalTypeNames[hash] ?? hash;
  const tupleOf = (t: [string, string, string, string]): ChangeTuple => ({
    ft: t[0],
    kt: t[1],
    vt: t[2],
    kh: nameOf(t[3]),
  });

  // A class's revision covering a given build, if it existed then. Compared
  // by position in `versions`, not by build number (see loadMetaDb).
  const revAt = (khash: string, build: number) => {
    const at = buildIndex.get(build)!;
    return db.classes[khash]?.revisions.find(
      (r) =>
        buildIndex.get(r.from)! <= at &&
        (r.to === undefined || at <= buildIndex.get(r.to)!)
    );
  };

  /**
   * Family = the topmost ancestor of a class's primary (first) base chain, the
   * key the changelog groups new/removed classes under. Resolved *at the build
   * of the change*, not from the current graph: ~17% of classes have been
   * re-parented since they were added, and filing them under today's root would
   * mis-group an old patch. A base outside db.classes (an external type) has no
   * revisions, so the walk stops there and names it; `seen` guards a cyclic db.
   */
  const familyAt = (khash: string, build: number): string => {
    let cur = khash;
    const seen = new Set([cur]);
    for (;;) {
      const base = revAt(cur, build)?.bases[0];
      if (!base || seen.has(base)) break;
      seen.add(base);
      cur = base;
    }
    return nameOf(cur);
  };

  // Inverted index: build → (classHash → accumulator). We record the class's
  // own change kind and any property changes separately, then reconcile: a new
  // or removed class is a single entry (its properties are not also listed),
  // mirroring the removedIn/since suppression in loadMetaDb.
  type Acc = {
    name: string;
    classKind?: "added" | "readded" | "removed" | "changed";
    family?: string;
    baseChange?: { old: string[]; new: string[] };
    propChanges: PropChange[];
  };
  const index = new Map<number, Map<string, Acc>>();
  const acc = (build: number, khash: string, name: string): Acc => {
    let byClass = index.get(build);
    if (!byClass) {
      byClass = new Map();
      index.set(build, byClass);
    }
    let e = byClass.get(khash);
    if (!e) {
      e = { name, propChanges: [] };
      byClass.set(khash, e);
    }
    return e;
  };

  for (const [khash, klass] of Object.entries(db.classes)) {
    const name = klass.name ?? khash;
    const revs = klass.revisions;

    // Class added / re-added / changed (keyed by the build a revision starts)
    for (let i = 0; i < revs.length; i++) {
      const rev = revs[i];
      if (i === 0) {
        // First-ever revision at firstBuild = tracking-start noise, skip
        if (rev.from !== firstBuild) {
          const e = acc(rev.from, khash, name);
          e.classKind = "added";
          e.family = familyAt(khash, rev.from);
        }
        continue;
      }
      const prev = revs[i - 1];
      const bcur = rev.from;
      if (prev.to === prevBuild(bcur)) {
        // Consecutive split → definition changed (bases/interface/value)
        const e = acc(bcur, khash, name);
        e.classKind = "changed";
        const oldBases = prev.bases.map(nameOf);
        const newBases = rev.bases.map(nameOf);
        if (oldBases.join("|") !== newBases.join("|")) {
          e.baseChange = { old: oldBases, new: newBases };
        }
      } else {
        // Gap before this revision → the class was re-added
        const e = acc(bcur, khash, name);
        e.classKind = "readded";
        e.family = familyAt(khash, bcur);
      }
    }

    // Class removed - a revision ends (to set) with no consecutive successor
    for (let i = 0; i < revs.length; i++) {
      const rev = revs[i];
      if (rev.to === undefined || rev.to === lastBuild) continue;
      const bnext = nextBuild(rev.to);
      const consecutiveNext =
        i + 1 < revs.length && revs[i + 1].from === bnext;
      if (!consecutiveNext) {
        const e = acc(bnext, khash, name);
        e.classKind = "removed";
        // The class is already gone at bnext; its family is the one it had at
        // rev.to, the last build it (and its ancestors) still existed in.
        e.family = familyAt(khash, rev.to);
      }
    }

    // Property-level changes within the class
    for (const [fhash, metaProp] of Object.entries(klass.properties)) {
      const pname = metaProp.name ?? fhash;
      const pslug = anchorSlug(pname);
      const prevs = metaProp.revisions;

      // added / re-added / type-changed (keyed by the build a revision starts)
      for (let i = 0; i < prevs.length; i++) {
        const rev = prevs[i];
        if (i === 0) {
          if (rev.from !== firstBuild) {
            acc(rev.from, khash, name).propChanges.push({
              name: pname,
              slug: pslug,
              kind: "added",
              newType: tupleOf(rev.type),
            });
          }
          continue;
        }
        const prev = prevs[i - 1];
        const bcur = rev.from;
        if (prev.to === prevBuild(bcur)) {
          // Consecutive split → type change (skip no-op splits just in case)
          if (prev.type.join("|") !== rev.type.join("|")) {
            acc(bcur, khash, name).propChanges.push({
              name: pname,
              slug: pslug,
              kind: "typechanged",
              oldType: tupleOf(prev.type),
              newType: tupleOf(rev.type),
            });
          }
        } else {
          acc(bcur, khash, name).propChanges.push({
            name: pname,
            slug: pslug,
            kind: "readded",
            newType: tupleOf(rev.type),
          });
        }
      }

      // removed property (living class; a removed class covers its props)
      for (let i = 0; i < prevs.length; i++) {
        const rev = prevs[i];
        if (rev.to === undefined || rev.to === lastBuild) continue;
        const bnext = nextBuild(rev.to);
        const consecutiveNext =
          i + 1 < prevs.length && prevs[i + 1].from === bnext;
        if (!consecutiveNext) {
          acc(bnext, khash, name).propChanges.push({
            name: pname,
            slug: pslug,
            kind: "removed",
            oldType: tupleOf(rev.type),
          });
        }
      }
    }
  }

  // Reconcile accumulators into ordered ClassChange lists per build
  const changesByBuild = new Map<number, ClassChange[]>();
  for (const [build, byClass] of index) {
    const list: ClassChange[] = [];
    for (const e of byClass.values()) {
      const slug = classSlug(e.name);
      if (
        e.classKind === "added" ||
        e.classKind === "readded" ||
        e.classKind === "removed"
      ) {
        // Single entry - do not also enumerate its property churn
        list.push({
          name: e.name,
          slug,
          kind: e.classKind,
          build,
          family: e.family,
          domain: domainOf(e.name),
          propChanges: [],
        });
      } else if (e.classKind === "changed" || e.propChanges.length > 0) {
        // Own definition changed and/or some properties changed
        const entry: ClassChange = {
          name: e.name,
          slug,
          kind: "changed",
          build,
          propChanges: e.propChanges.sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0
          ),
        };
        if (e.baseChange) entry.baseChange = e.baseChange;
        list.push(entry);
      }
    }
    if (list.length === 0) continue;
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    changesByBuild.set(build, list);
  }

  // Group builds by patch (dropping the first tracked build), newest first.
  // Iterating `builds` in order keeps each patch's buildGroups ascending even
  // when patches interleave (hotfix builds can land out of patch order).
  const patchKey = (p: string) => {
    const [maj, min] = p.split(".").map(Number);
    return maj * 1000 + min;
  };
  const byPatch = new Map<string, ChangelogPatch>();
  for (const build of builds) {
    if (build === firstBuild) continue;
    const list = changesByBuild.get(build);
    if (!list) continue;
    const patch = patchOf(build);
    let cp = byPatch.get(patch);
    if (!cp) {
      cp = {
        patch,
        slug: patch.replace(/\./g, "-"),
        builds: [],
        counts: { added: 0, readded: 0, removed: 0, changed: 0 },
        buildGroups: [],
      };
      byPatch.set(patch, cp);
    }
    cp.builds.push(build);
    cp.buildGroups.push({ build, entries: list });
    for (const c of list) cp.counts[c.kind]++;
  }

  return [...byPatch.values()].sort(
    (a, b) => patchKey(b.patch) - patchKey(a.patch)
  );
}

// --- MDX generator ---
/**
 * Generate MDX content for a class documentation page
 */
function generateMDX(
  c: ClassDoc,
  fileName: string,
  category: ClassCategory,
  preview?: ClassPreview
): string {
  const displayName = c.name.startsWith("0x") ? `Class ${c.name}` : c.name;

  // Generate invisible heading anchors for TOC
  // These will be hidden but picked up by Starlight's TOC
  // MUST use Markdown syntax (##), not HTML <h2> tags
  const propertyAnchors = c.properties
    .map((prop) => `## ${prop.name}`)
    .join("\n\n");

  const headerFrontmatter =
    // The `since` of a PBE-only class is the PBE patch, which has no changelog
    // page of its own. The preview pill shows it instead.
    (c.since && preview?.kind !== "only" ? `\nsince: "${c.since}"` : "") +
    (c.removedIn ? `\nremovedIn: "${c.removedIn}"` : "") +
    `\nhash: "${c.hash}"` +
    `\nkind: ${c.kind}` +
    `\ndomain: ${category.domain}` +
    `\nvia: ${category.via}` +
    // The root of a family is its own family; the breadcrumb has nothing to add
    (category.family !== c.name ? `\nfamily: "${category.family}"` : "") +
    (preview ? `\npreview: "${preview.patch}"\npreviewKind: ${preview.kind}` : "");

  // Hash-named classes stay searchable (by hash and by property name), but
  // their property headings are heavily down-weighted in Pagefind so classes
  // with real names always rank above "Class 0x..." pages.
  const searchWeight = c.name.startsWith("0x")
    ? ` data-pagefind-weight="0.25"`
    : "";

  return `---
title: ${displayName}
description: Reference documentation for ${displayName} meta class${headerFrontmatter}
---

import ClassDetails from '../../../components/ClassDetails.astro';

<ClassDetails file="/db/classes/${fileName}" />

<div style="position: absolute; visibility: hidden; pointer-events: none;" aria-hidden="true"${searchWeight}>

${propertyAnchors}

</div>
`;
}

/**
 * Generate the MDX stub for a patch changelog page. Starlight autogenerate
 * sorts a sidebar group by slug, and patch strings ("16.13" vs "16.9") don't
 * sort lexicographically - so an explicit `sidebar.order` (newest first, index
 * 1..N below the index page at 0) is required.
 */
function generateChangelogMDX(cp: ChangelogPatch, fileName: string, order: number): string {
  return `---
title: Patch ${cp.patch}
description: Meta schema changes in League of Legends patch ${cp.patch} - new, removed, and changed classes.
sidebar:
  order: ${order}
---

import PatchChangelog from '../../../components/PatchChangelog.astro';

<PatchChangelog file="/db/changelog/${fileName}" />
`;
}

/**
 * Generates the MDX stub for the PBE page of the changelog. The page exists
 * with and without a preview, so its URL is stable between PBE cycles. It
 * sits between the overview (order 0) and the newest patch (order 1).
 */
function generatePreviewChangelogMDX(info: PreviewInfo | null, fileName: string | null): string {
  if (!info || !fileName) {
    return `---
title: PBE preview
description: Meta schema changes on the PBE build, compared with the latest live build.
sidebar:
  order: 0.5
  label: PBE
---

PBE and live are on the same patch, so there is no preview. If PBE moves to a
patch that live has not reached, this page lists the classes that the newest PBE
build adds, removes or changes.
`;
  }
  return `---
title: PBE ${info.patch}
description: Meta schema changes on PBE ${info.patch}, compared with live patch ${info.basePatch} - new, removed, and changed classes.
sidebar:
  order: 0.5
  label: PBE
  badge:
    text: "${info.patch}"
    variant: caution
---

import PatchChangelog from '../../../components/PatchChangelog.astro';

<PatchChangelog file="/db/changelog/${fileName}" />
`;
}

/** MDX stub for a domain's browse page, same pattern as the changelog. */
function generateDomainMDX(d: DomainInfo, fileName: string): string {
  return `---
title: ${JSON.stringify(d.title)}
description: ${JSON.stringify(`${d.title} - meta classes in this domain. ${d.description}`)}
domain: ${d.id}
---

import DomainPage from '../../../components/DomainPage.astro';

<DomainPage file="/db/domains/${fileName}" />
`;
}

// --- class view ---
/**
 * The graph facts derived from one class list: inheritance, reverse
 * references and categories. The live classes get one view; the merged
 * database of a PBE preview gets a second one.
 */
type ClassView = {
  classes: ClassDoc[];
  classMap: Map<string, ClassDoc>;
  /** Reverse lookup: class -> the classes that inherit from it. */
  children: Map<string, Set<string>>;
  /** Reverse references: class -> user class -> the properties that use it. */
  usedByMap: Map<string, Map<string, UsedByProp[]>>;
  categories: Map<string, ClassCategory>;
  usedByOf(name: string): UsedByClass[];
  ancestorLevels(name: string): string[][];
  descendantTree(name: string): DescendantNode[];
};

/**
 * Builds the view of `classes`, which `loadMetaDb` read from `db`. A class in
 * `pinned` keeps the category that it has there: the merged view passes the
 * live categories, so a class is in the same domain on both channels.
 */
function buildClassView(
  db: MetaDb,
  classes: ClassDoc[],
  categoryConfig: CategoryConfig,
  pinned?: Map<string, ClassCategory>
): ClassView {
  // Build inheritance graph
  const classMap = new Map<string, ClassDoc>();
  const children = new Map<string, Set<string>>(); // reverse lookup: class -> classes that inherit from it

  for (const c of classes) {
    classMap.set(c.name, c);
    children.set(c.name, new Set());
  }

  // Build reverse lookup
  for (const c of classes) {
    for (const base of c.bases) {
      if (!children.has(base)) {
        children.set(base, new Set());
      }
      children.get(base)!.add(c.name);
    }
  }

  // Reverse references: class → classes whose properties use it as a type.
  // Only the kh slot can hold a class: ft/kt/vt are always BinType kind names
  // ("Map", "F32", …), and a class named "Map" exists - matching those slots
  // against class names would hand it every Map<…> property in the db.
  // Removed classes and removed properties are skipped: the section answers
  // "who uses this type in the current game build". Inheritance is *not*
  // a reference here - the inheritance tree already covers it.
  const usedByMap = new Map<string, Map<string, UsedByProp[]>>();
  for (const c of classes) {
    if (c.removedIn) continue;
    for (const p of c.properties) {
      if (p.removedIn) continue;
      if (!classMap.has(p.kh)) continue;
      let byClass = usedByMap.get(p.kh);
      if (!byClass) usedByMap.set(p.kh, (byClass = new Map()));
      let props = byClass.get(c.name);
      if (!props) byClass.set(c.name, (props = []));
      props.push({
        name: p.name,
        slug: anchorSlug(p.name),
        ft: p.ft,
        kt: p.kt,
        vt: p.vt,
        kh: p.kh,
      });
    }
  }
  // Classes iterate A→Z and their properties are pre-sorted, so entries land
  // in order; only the per-class grouping needs an explicit sort.
  const usedByOf = (name: string): UsedByClass[] =>
    [...(usedByMap.get(name) ?? [])]
      .map(([n, props]) => ({ name: n, props }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Categories: every class gets one domain (see categorize.ts). The primary
  // base is the first base that is itself a class - a base naming an external
  // type ends the chain there.
  const categories = categorize(
    classes.map((c) => ({
      name: c.name,
      base: c.bases.find((b) => classMap.has(b)),
      removed: c.removedIn !== undefined,
    })),
    usageEdges(db),
    categoryConfig
  );
  for (const [name, category] of pinned ?? []) {
    if (categories.has(name)) categories.set(name, category);
  }

  // Ancestors as BFS levels going up: [direct bases, their bases, ...].
  // Multiple inheritance puts several classes on one level; each class
  // appears only once, at its shallowest depth.
  function ancestorLevels(className: string): string[][] {
    const levels: string[][] = [];
    const seen = new Set<string>([className]);
    let frontier = classMap.get(className)?.bases ?? [];
    while (frontier.length > 0) {
      const level = [...new Set(frontier)].filter((n) => !seen.has(n));
      if (level.length === 0) break;
      for (const n of level) seen.add(n);
      levels.push(level);
      frontier = level.flatMap((n) => classMap.get(n)?.bases ?? []);
    }
    return levels;
  }

  // Full descendant tree. With multiple inheritance a class could appear
  // under several parents; the visited set keeps each subtree rendered once
  // (under the first parent encountered).
  function descendantsFrom(
    className: string,
    visited: Set<string>
  ): DescendantNode[] {
    const nodes: DescendantNode[] = [];
    const childs = [...(children.get(className) ?? [])].sort();
    for (const child of childs) {
      if (visited.has(child)) continue;
      visited.add(child);
      nodes.push({ name: child, children: descendantsFrom(child, visited) });
    }
    return nodes;
  }

  return {
    classes,
    classMap,
    children,
    usedByMap,
    categories,
    usedByOf,
    ancestorLevels,
    descendantTree: (name) => descendantsFrom(name, new Set([name])),
  };
}

type LoadedDocs = Awaited<ReturnType<typeof loadDocs>>;

/** Builds the class JSON of `c` in `view`, without the `preview` entry. */
function classJsonOf(c: ClassDoc, view: ClassView, docs: LoadedDocs): ClassJson {
  return {
    name: c.name,
    bases: c.bases,
    since: c.since ?? null,
    removedIn: c.removedIn ?? null,
    // Merge property documentation
    properties: c.properties.map((prop) => ({
      ...prop,
      docs: docs.propertyDocs[prop.name.toLowerCase()] || null,
    })),
    ancestorLevels: view.ancestorLevels(c.name),
    descendantTree: view.descendantTree(c.name),
    docs: docs.classDocs || null,
    usedBy: view.usedByOf(c.name),
    kind: c.kind,
    category: view.categories.get(c.name)!,
  };
}

// --- PBE preview ---
// Slug of the PBE page of the changelog. A patch slug is "<major>-<minor>",
// so the two cannot collide.
const PREVIEW_SLUG = "pbe";

/** The merged database of the preview and everything derived from it. */
type Preview = {
  info: PreviewInfo;
  db: MetaDb;
  view: ClassView;
  /** The changelog of the PBE build: what it changes against the live build. */
  changes: ChangelogPatch;
  /** Class name -> its entry in `changes`. */
  changeOf: Map<string, ClassChange>;
};

/**
 * Reads the overlay and merges it with the live database. Returns null if
 * the file is missing or holds no preview. An overlay that was built on
 * another live build than the db is treated as no preview, with a warning:
 * the two files come from different commits. Under --strict that is an error.
 */
async function readPreview(metaDb: MetaDb): Promise<{ info: PreviewInfo; db: MetaDb } | null> {
  let source: string;
  try {
    source = await readFile(previewFile, "utf8");
  } catch {
    return null;
  }
  let overlay: MetaOverlay;
  try {
    overlay = JSON.parse(source);
  } catch (err) {
    throw new Error(`${basename(previewFile)} is not valid JSON: ${err}`);
  }

  const merged = mergePreview(metaDb, overlay);
  if (merged.status === "none") return null;
  if (merged.status === "mismatch") {
    const message =
      `${basename(previewFile)} was built on live build ${merged.base}, but ` +
      `${basename(inFile)} is at build ${merged.latest}. The PBE preview is left out. ` +
      "Fetch both files again with `pnpm update-db`.";
    if (strict) throw new Error(message);
    console.warn(`[warn] ${message}`);
    return null;
  }
  return { info: merged.info, db: merged.db };
}

/**
 * Derives the merged view and the changelog of the PBE build. `classes` is
 * the result of `loadMetaDb` on the merged database.
 */
function buildPreview(
  { info, db }: { info: PreviewInfo; db: MetaDb },
  classes: ClassDoc[],
  live: ClassView,
  categoryConfig: CategoryConfig
): Preview {
  const view = buildClassView(db, classes, categoryConfig, live.categories);
  // The PBE patch has no live build, so its changelog entry holds the PBE
  // build alone. A PBE build that changes defaults only has no entry at all.
  const entry = buildChangelog(db, (name) => view.categories.get(name)?.domain).find(
    (cp) => cp.builds.includes(info.build)
  );
  const changes: ChangelogPatch = {
    patch: info.patch,
    slug: PREVIEW_SLUG,
    builds: [info.build],
    counts: entry?.counts ?? { added: 0, readded: 0, removed: 0, changed: 0 },
    buildGroups: entry?.buildGroups ?? [],
    preview: info,
  };
  const changeOf = new Map(
    changes.buildGroups.flatMap((g) => g.entries).map((e) => [e.name, e])
  );
  return { info, db, view, changes, changeOf };
}

// --- main ---
async function main() {
  const source = await readFile(inFile, "utf8");
  let metaDb: MetaDb;
  try {
    metaDb = JSON.parse(source);
  } catch (err) {
    throw new Error(`${basename(inFile)} is not valid JSON: ${err}`);
  }

  const classes = loadMetaDb(metaDb);
  const latestPatch = metaDb.versions[metaDb.versions.length - 1].patch;

  // The merged database of the PBE preview, if the overlay holds one. It is
  // loaded before the category config, which is resolved against the classes
  // of both channels: a root or pin can name a class that exists on PBE only.
  const merged = await readPreview(metaDb);
  const mergedClasses = merged ? loadMetaDb(merged.db) : [];
  const categoryConfig = await loadCategoryConfig(merged ? mergedClasses : classes);
  const live = buildClassView(metaDb, classes, categoryConfig);
  const { classMap, children, usedByMap, categories } = live;
  const categoryOf = (name: string) => categories.get(name)!;
  const preview = merged && buildPreview(merged, mergedClasses, live, categoryConfig);

  // Classes that exist on PBE and in no live build. Each gets a page built
  // from the merged view; the live indexes, sidebar and domain pages do not
  // list them.
  const previewOnly = mergedClasses.filter((c) => !classMap.has(c.name));
  // One page per entry: the live classes plus the PBE-only ones, A→Z.
  const pages = [...classes, ...previewOnly].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  const previewOf = (c: ClassDoc): ClassPreview | undefined => {
    if (!preview) return undefined;
    const { patch, build } = preview.info;
    if (!classMap.has(c.name)) return { patch, build, kind: "only" };
    const change = preview.changeOf.get(c.name);
    // "added" cannot occur here: a class that the PBE build adds is not live.
    if (!change || change.kind === "added") return undefined;
    return { patch, build, kind: change.kind, change };
  };

  // Emit per-class JSON (read only at build time by ClassDetails.astro, so
  // they live outside public/ - the "/db/classes/..." paths in MDX and
  // index.json are stable identifiers mapped to classesOutDir at build time)
  const classDir = classesOutDir;
  const index: {
    name: string;
    file: string;
    bases: string[];
    propCount: number;
    since?: string;
    removed?: boolean;
    /** The class exists on PBE only. */
    preview?: boolean;
  }[] = [];

  let jsonChanged = 0;
  let mdxChanged = 0;
  const generatedMDX = new Set<string>();
  const generatedJSON = new Set<string>();
  // Classes with a db/docs YAML that says something
  const documented = new Set<string>();

  // The class JSON of every class that differs in the merged view, for
  // api/scripts (the `?channel=pbe` responses). File name -> contents.
  const previewClassJson = new Map<string, string>();

  for (const c of pages) {
    const onlyOnPbe = !classMap.has(c.name);

    // Load documentation from unified YAML file
    const docs = await loadDocs(c.name, docsDir);
    if (docs.classDocs || Object.keys(docs.propertyDocs).length > 0) documented.add(c.name);

    // A page shows live data. A PBE-only class has none, so its page shows
    // the merged view.
    const base = classJsonOf(c, onlyOnPbe ? preview!.view : live, docs);
    const classPreview = previewOf(c);
    const classJson: ClassJson = classPreview ? { ...base, preview: classPreview } : base;
    const json = JSON.stringify(classJson, null, pretty ? 2 : 0);
    const hash = contentHash(classJson);
    const fileName = `${safeName(c.name)}.${hash}.json`;
    const filePath = join(classDir, fileName);
    const didJson = await writeIfChanged(filePath, json);
    if (didJson) jsonChanged++;
    generatedJSON.add(fileName);

    if (preview) {
      const mergedJson = onlyOnPbe
        ? base
        : classJsonOf(preview.view.classMap.get(c.name)!, preview.view, docs);
      if (onlyOnPbe || JSON.stringify(mergedJson) !== JSON.stringify(base)) {
        previewClassJson.set(
          `${safeName(c.name)}.json`,
          JSON.stringify(mergedJson, null, pretty ? 2 : 0)
        );
      }
    }

    // Generate MDX file (lowercase for Starlight URL compatibility)
    const mdxFileName = `${safeName(c.name).toLowerCase()}.mdx`;
    const mdxFilePath = join(mdxDir, mdxFileName);
    const mdxContent = generateMDX(c, fileName, classJson.category, classPreview);
    const didMdx = await writeIfChanged(mdxFilePath, mdxContent);
    if (didMdx) mdxChanged++;
    generatedMDX.add(mdxFileName);

    index.push({
      name: c.name,
      file: `/db/classes/${fileName}`,
      bases: c.bases,
      propCount: c.properties.length,
      ...(c.since ? { since: c.since } : {}),
      ...(c.removedIn ? { removed: true } : {}),
      ...(onlyOnPbe ? { preview: true } : {}),
    });
  }

  // One page and one JSON payload per class in the db, no exceptions. The
  // generated MDX is not tracked in git, so nothing downstream would notice a
  // class silently going missing - a slug collision (two names differing only
  // in case both map to `<name>.mdx`) or a dropped class would just build a
  // smaller site. Assert before the cleanup passes below, which would happily
  // delete pages a partial run failed to claim.
  const expectedClasses = Object.keys((preview?.db ?? metaDb).classes).length;
  if (
    pages.length !== expectedClasses ||
    generatedMDX.size !== expectedClasses ||
    generatedJSON.size !== expectedClasses
  ) {
    throw new Error(
      `Emitted ${generatedMDX.size} MDX pages and ${generatedJSON.size} JSON files ` +
      `for ${pages.length} loaded classes, but ${basename(inFile)} has ` +
      `${expectedClasses}` +
      (preview ? ` with the classes of ${basename(previewFile)}` : "") +
      ` - a class was dropped or two share a file name.`
    );
  }

  // Clean up old MDX files that no longer exist
  let mdxDeleted = 0;
  try {
    const existingMDX = await readdir(mdxDir);
    for (const file of existingMDX) {
      if (file.endsWith(".mdx") && !generatedMDX.has(file) && file !== "index.mdx") {
        await unlink(join(mdxDir, file));
        mdxDeleted++;
      }
    }
  } catch {
    // Directory might not exist yet, that's fine
  }

  // Clean up stale class JSON files (content hash changes rename the file,
  // leaving the old one behind - and it would get deployed)
  let jsonDeleted = 0;
  try {
    const existingJSON = await readdir(classDir);
    for (const file of existingJSON) {
      if (file.endsWith(".json") && !generatedJSON.has(file)) {
        await unlink(join(classDir, file));
        jsonDeleted++;
      }
    }
  } catch {
    // Directory might not exist yet, that's fine
  }

  // Emit the merged-view class JSON and drop the files of an earlier preview.
  // Without a preview the directory ends up empty.
  const previewClassDir = join(previewOutDir, "classes");
  let previewChanged = 0;
  let previewDeleted = 0;
  for (const [fileName, json] of previewClassJson) {
    if (await writeIfChanged(join(previewClassDir, fileName), json)) previewChanged++;
  }
  try {
    for (const file of await readdir(previewClassDir)) {
      if (file.endsWith(".json") && !previewClassJson.has(file)) {
        await unlink(join(previewClassDir, file));
        previewDeleted++;
      }
    }
  } catch {
    // Directory might not exist yet, that's fine
  }

  // Emit a tiny index for navigation
  const indexPath = join(outDir, "index.json");
  await writeIfChanged(
    indexPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        latestPatch,
        // Every class page, the PBE-only ones included (deploy.yml compares
        // this with the pages that were built).
        total: index.length,
        preview: preview?.info ?? null,
        classes: index,
      },
      null,
      pretty ? 2 : 0
    )
  );

  // Emit classIndex.json for type auto-linking. It covers every page, so a
  // type that names a PBE-only class links to its page.
  const classIndex: Record<string, string> = {};
  for (const c of pages) {
    classIndex[c.name] = `/classes/${classSlug(c.name)}`;
  }
  const classIndexPath = join(outDir, "classIndex.json");
  await writeIfChanged(
    classIndexPath,
    JSON.stringify(classIndex, null, pretty ? 2 : 0)
  );

  // Removed classes, name → the patch they disappeared in. Shared by the
  // graph file, the sidebar and the symbol index: all three mark a removed
  // class so it can be recognised without opening its page.
  const removedByName: Record<string, string> = {};
  for (const c of classes) {
    if (c.removedIn) removedByName[c.name] = c.removedIn;
  }

  // Emit classGraph.json - the inheritance graph as one build-time file (it
  // lives beside the per-class JSON, outside public/: only the class pages
  // read it, and only at build time). A class page needs its *siblings* (the
  // other subclasses of its bases) and the removed flag for every class in
  // its tree; both are graph-wide facts, so baking them into each class JSON
  // would duplicate ~105k names and make one new subclass rewrite every file
  // in its family. Keys sorted so the file is stable and diffable.
  const graphChildren: Record<string, string[]> = {};
  for (const base of [...children.keys()].sort()) {
    const kids = children.get(base)!;
    if (kids.size > 0) graphChildren[base] = [...kids].sort();
  }
  const classGraph: ClassGraph = {
    children: graphChildren,
    removedIn: removedByName,
  };
  await writeIfChanged(
    graphOutFile,
    JSON.stringify(classGraph, null, pretty ? 2 : 0)
  );

  // Emit classHashes.json - canonical hash → page slug for every class, the
  // lookup table behind the 404 resolver (components/NotFound.astro). A page
  // only exists under its display name, so every other spelling of the same
  // class (its hash once the name was resolved, a padded/unprefixed hash, the
  // name in the wrong case) 404s without it. Sorted by hash so the diff is
  // stable when a name resolves. Always minified regardless of --pretty: it's
  // only ever fetched by the browser; /v1/hashes is the readable form.
  const classHashes: ClassHashIndex = {};
  for (const c of [...pages].sort((a, b) => (a.hash < b.hash ? -1 : 1))) {
    classHashes[c.hash] = classSlug(c.name);
  }
  await writeIfChanged(
    join(outDir, "classHashes.json"),
    JSON.stringify(classHashes)
  );

  // Emit symbols.json - the flat identifier index the search modal's symbol
  // search fetches (Search.astro + utils/symbolSearch.ts). Property names are
  // deduped; owners are indices into `classes`. Always minified regardless of
  // --pretty: it's only ever fetched by the browser, and pretty-printing the
  // owner arrays (one number per line) would triple the file.
  const classPos = new Map(classes.map((c, i) => [c.name, i]));
  const propOwners = new Map<string, number[]>();
  for (const c of classes) {
    for (const p of c.properties) {
      let owners = propOwners.get(p.name);
      if (!owners) propOwners.set(p.name, (owners = []));
      owners.push(classPos.get(c.name)!);
    }
  }
  const symbolClass = (name: string): SymbolClassEntry =>
    removedByName[name]
      ? [name, classIndex[name], removedByName[name]]
      : [name, classIndex[name]];
  const symbols: SymbolsIndex = {
    classes: classes.map((c) => symbolClass(c.name)),
    props: [...propOwners.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    ),
  };
  await writeIfChanged(join(outDir, "symbols.json"), JSON.stringify(symbols));

  // --- categories: the domain list, the sidebar and one page per domain ---
  // All three are the same partition of `classes` (domain → family → class),
  // so it is built once and projected three ways.
  const isHashName = (n: string) => /^0x[0-9a-fA-F]+$/.test(n);
  // Named classes A→Z, then unresolved hashes numerically: an unnamed class is
  // the least useful row in any list, so it never sits above a readable one.
  const byClassName = (a: string, b: string) => {
    const ha = isHashName(a);
    const hb = isHashName(b);
    if (ha !== hb) return ha ? 1 : -1;
    return ha
      ? parseInt(a, 16) - parseInt(b, 16)
      : a.localeCompare(b, "en", { sensitivity: "base" });
  };
  // The root leads its own family (same as the changelog's family groups).
  const rootFirst = (family: string, names: string[]) => {
    const sorted = names.sort(byClassName);
    const at = sorted.indexOf(family);
    if (at > 0) sorted.unshift(...sorted.splice(at, 1));
    return sorted;
  };

  const domainDefs = [
    ...categoryConfig.domains.map(({ id, title, description, unreleased }) => ({
      id,
      title,
      description,
      unreleased,
    })),
    ...RESERVED_DOMAINS.map((d) => ({ ...d, unreleased: false })),
  ];
  // domain id → family root → member names
  const partition = new Map<string, Map<string, string[]>>(
    domainDefs.map((d) => [d.id, new Map()])
  );
  for (const c of classes) {
    const { domain, family } = categoryOf(c.name);
    const families = partition.get(domain)!;
    let members = families.get(family);
    if (!members) families.set(family, (members = []));
    members.push(c.name);
  }

  const domains: DomainInfo[] = domainDefs.map((d) => {
    const names = [...partition.get(d.id)!.values()].flat();
    return {
      ...d,
      counts: {
        classes: names.length,
        live: names.filter((n) => !removedByName[n]).length,
        unnamed: names.filter(isHashName).length,
        documented: names.filter((n) => documented.has(n)).length,
      },
    };
  });
  await writeIfChanged(
    join(outDir, "categories.json"),
    JSON.stringify(domains, null, pretty ? 2 : 0)
  );

  // Emit classSidebar.json - the grouped view the client-rendered "Classes"
  // sidebar group consumes (sidebar/ClassesGroup.astro): domain → family →
  // class. Families of MIN_GROUP_SIZE+ become collapsible groups; smaller ones
  // would be more headers than rows, so their classes stay flat in the domain.
  const MIN_GROUP_SIZE = 5;
  const sidebarEntry = (name: string): ClassSidebarEntry =>
    removedByName[name]
      ? [name, classIndex[name], removedByName[name]]
      : [name, classIndex[name]];

  const classSidebar: ClassSidebar = {
    domains: domains.map((d): ClassSidebarDomain => {
      const groups: ClassSidebarGroup[] = [];
      const flat: string[] = [];
      for (const [family, members] of partition.get(d.id)!) {
        if (members.length >= MIN_GROUP_SIZE) {
          groups.push({
            label: family,
            entries: rootFirst(family, [...members]).map(sidebarEntry),
          });
        } else {
          flat.push(...members);
        }
      }
      groups.sort((a, b) => byClassName(a.label, b.label));
      flat.sort(byClassName);
      return {
        id: d.id,
        title: d.title,
        ...(d.unreleased ? { unreleased: true as const } : {}),
        groups,
        loose: flat.filter((n) => !isHashName(n)).map(sidebarEntry),
        unnamed: flat.filter(isHashName).map(sidebarEntry),
      };
    }),
  };
  await writeIfChanged(
    join(outDir, "classSidebar.json"),
    JSON.stringify(classSidebar, null, pretty ? 2 : 0)
  );

  // Emit one browse page per domain: build-time JSON (outside public/, like
  // the class JSON) plus an MDX stub. Here a family is a section from two
  // members up - the page has room the sidebar does not.
  const kindByName = new Map(classes.map((c) => [c.name, c.kind]));
  const domainClass = (name: string): DomainClass => ({
    name,
    href: classIndex[name],
    kind: kindByName.get(name)!,
    ...(removedByName[name] ? { removedIn: removedByName[name] } : {}),
    ...(documented.has(name) ? { documented: true as const } : {}),
  });
  let domainsChanged = 0;
  const generatedDomainJSON = new Set<string>();
  const generatedDomainMDX = new Set<string>();
  for (const d of domains) {
    // Only the domains nothing claimed say who uses each family: that is the
    // evidence a contributor needs to decide where it belongs.
    const explainUsers = d.id === SHARED_DOMAIN || d.id === UNCATEGORIZED_DOMAIN;
    const families: DomainFamily[] = [];
    const loose: string[] = [];
    for (const [family, members] of partition.get(d.id)!) {
      if (members.length < 2) {
        loose.push(...members);
        continue;
      }
      const users = new Set<string>();
      if (explainUsers) {
        for (const m of members) {
          for (const user of usedByMap.get(m)?.keys() ?? []) {
            if (!members.includes(user)) users.add(user);
          }
        }
      }
      families.push({
        name: family,
        entries: rootFirst(family, [...members]).map(domainClass),
        ...(users.size > 0 ? { usedBy: [...users].sort(byClassName) } : {}),
      });
    }
    families.sort(
      (a, b) => b.entries.length - a.entries.length || byClassName(a.name, b.name)
    );
    const page: DomainPageData = {
      ...d,
      families,
      loose: loose.sort(byClassName).map(domainClass),
    };
    const fileName = `${d.id}.${contentHash(page)}.json`;
    if (
      await writeIfChanged(
        join(domainsOutDir, fileName),
        JSON.stringify(page, null, pretty ? 2 : 0)
      )
    ) {
      domainsChanged++;
    }
    generatedDomainJSON.add(fileName);
    const mdxFileName = `${d.id}.mdx`;
    await writeIfChanged(join(domainsMdxDir, mdxFileName), generateDomainMDX(d, fileName));
    generatedDomainMDX.add(mdxFileName);
  }
  // Stale domain files: a content hash renames the JSON, a deleted domain
  // leaves its MDX behind. index.mdx is hand-written, keep it.
  let domainsDeleted = 0;
  try {
    for (const file of await readdir(domainsOutDir)) {
      if (file.endsWith(".json") && !generatedDomainJSON.has(file)) {
        await unlink(join(domainsOutDir, file));
        domainsDeleted++;
      }
    }
    for (const file of await readdir(domainsMdxDir)) {
      if (file.endsWith(".mdx") && file !== "index.mdx" && !generatedDomainMDX.has(file)) {
        await unlink(join(domainsMdxDir, file));
        domainsDeleted++;
      }
    }
  } catch {
    // Directory might not exist yet, that's fine
  }

  // --- changelog: per-patch JSON (build-time only, outside public/ like the
  // class JSON) + MDX stubs + an index.json for the overview page ---
  const changelog = buildChangelog(metaDb, (name) => categories.get(name)?.domain);
  let clJsonChanged = 0;
  let clMdxChanged = 0;
  const generatedChangelogJSON = new Set<string>(["index.json"]);
  const generatedChangelogMDX = new Set<string>();
  const changelogIndex: {
    patch: string;
    slug: string;
    builds: number[];
    counts: ChangelogCounts;
  }[] = [];

  for (let i = 0; i < changelog.length; i++) {
    const cp = changelog[i];
    const json = JSON.stringify(cp, null, pretty ? 2 : 0);
    const hash = contentHash(cp);
    const fileName = `${cp.slug}.${hash}.json`;
    if (await writeIfChanged(join(changelogOutDir, fileName), json)) clJsonChanged++;
    generatedChangelogJSON.add(fileName);

    // Newest patch is index 0 in `changelog`; the index page owns order 0, so
    // patch pages start at order 1 (newest first).
    const mdxFileName = `${cp.slug}.mdx`;
    const mdxContent = generateChangelogMDX(cp, fileName, i + 1);
    if (await writeIfChanged(join(changelogMdxDir, mdxFileName), mdxContent)) clMdxChanged++;
    generatedChangelogMDX.add(mdxFileName);

    changelogIndex.push({
      patch: cp.patch,
      slug: cp.slug,
      builds: cp.builds,
      counts: cp.counts,
    });
  }

  // The PBE page of the changelog. Its JSON exists only with a preview.
  let previewEntry: ChangelogPreviewEntry | null = null;
  let previewChangelogFile: string | null = null;
  if (preview) {
    const cp = preview.changes;
    previewChangelogFile = `${cp.slug}.${contentHash(cp)}.json`;
    const json = JSON.stringify(cp, null, pretty ? 2 : 0);
    if (await writeIfChanged(join(changelogOutDir, previewChangelogFile), json)) clJsonChanged++;
    generatedChangelogJSON.add(previewChangelogFile);
    previewEntry = { ...preview.info, slug: cp.slug, counts: cp.counts };
  }
  const previewMdxFile = `${PREVIEW_SLUG}.mdx`;
  const previewMdx = generatePreviewChangelogMDX(preview?.info ?? null, previewChangelogFile);
  if (await writeIfChanged(join(changelogMdxDir, previewMdxFile), previewMdx)) clMdxChanged++;
  generatedChangelogMDX.add(previewMdxFile);

  const changelogIndexFile: ChangelogIndex = {
    generatedAt: new Date().toISOString(),
    latestPatch,
    patches: changelogIndex,
    preview: previewEntry,
  };
  await writeIfChanged(
    join(changelogOutDir, "index.json"),
    JSON.stringify(changelogIndexFile, null, pretty ? 2 : 0)
  );

  // Clean up stale changelog files (a patch's content hash renames its JSON;
  // a dropped patch leaves a stale MDX). index.mdx is hand-written, keep it.
  let clJsonDeleted = 0;
  let clMdxDeleted = 0;
  try {
    for (const file of await readdir(changelogOutDir)) {
      if (file.endsWith(".json") && !generatedChangelogJSON.has(file)) {
        await unlink(join(changelogOutDir, file));
        clJsonDeleted++;
      }
    }
  } catch {
    // Directory might not exist yet, that's fine
  }
  try {
    for (const file of await readdir(changelogMdxDir)) {
      if (
        file.endsWith(".mdx") &&
        file !== "index.mdx" &&
        !generatedChangelogMDX.has(file)
      ) {
        await unlink(join(changelogMdxDir, file));
        clMdxDeleted++;
      }
    }
  } catch {
    // Directory might not exist yet, that's fine
  }

  const removedCount = classes.filter((c) => c.removedIn).length;
  console.log(
    `[ok] Loaded ${classes.length} classes (${removedCount} removed) from patch ${latestPatch} db`
  );
  console.log(
    `     - JSON: ${jsonChanged} changed, ${jsonDeleted} deleted, wrote to ${outDir}`
  );
  console.log(
    `     - MDX:  ${mdxChanged} changed, ${mdxDeleted} deleted, wrote to ${mdxDir}`
  );
  console.log(
    `     - Changelog: ${changelog.length} patches, JSON ${clJsonChanged} changed / ${clJsonDeleted} deleted, MDX ${clMdxChanged} changed / ${clMdxDeleted} deleted`
  );
  if (preview) {
    const { info, changes } = preview;
    console.log(
      `     - PBE preview: ${info.patch}.${info.build} on ${info.basePatch}.${info.base}, ` +
        `${previewOnly.length} PBE-only pages, ${changes.counts.changed} changed, ` +
        `${changes.counts.removed} removed, ${changes.counts.readded} re-added; ` +
        `merged class JSON ${previewClassJson.size} files, ${previewChanged} changed / ${previewDeleted} deleted`
    );
  } else {
    console.log(`     - PBE preview: none (${previewDeleted} merged class JSON deleted)`);
  }

  // Category coverage: how each class was placed, and what is left to seed.
  // Printed on every run - this table is where a stale or missing seed shows.
  const viaCounts = new Map<CategoryVia, number>();
  for (const { via } of categories.values()) viaCounts.set(via, (viaCounts.get(via) ?? 0) + 1);
  const share = (n: number) => `${n} (${((100 * n) / classes.length).toFixed(1)}%)`;
  console.log(
    `     - Categories: ${domains.length} domains, ${domainsChanged} changed / ${domainsDeleted} deleted; ` +
      (["pin", "seed", "prefix", "usage", "shared", "none"] as const)
        .map((via) => `${via} ${share(viaCounts.get(via) ?? 0)}`)
        .join(", ")
  );
  console.log(
    `       ${domains.map((d) => `${d.id} ${d.counts.classes}`).join(", ")}`
  );
  const unplaced = [...partition.get(UNCATEGORIZED_DOMAIN)!]
    .sort(([a, am], [b, bm]) => bm.length - am.length || byClassName(a, b))
    .slice(0, 10)
    .map(([family, members]) => `${family} ${members.length}`);
  if (unplaced.length > 0) {
    console.log(`       largest uncategorized families: ${unplaced.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
