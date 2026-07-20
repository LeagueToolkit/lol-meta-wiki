#!/usr/bin/env bun
/**
 * LoL Meta DB per-class JSON & MDX generator (Bun)
 *
 * Input:   db/meta.db.json  (versioned database from LeagueToolkit/lol-meta-classes;
 *          see its docs/meta-db-format.md - refresh with `pnpm update-db`)
 * Output:  classesOutDir/<ClassName>.<sha12>.json (build-time only, NOT in
 *          public/ - copying 5k+ files into dist every build was a major
 *          build-time cost)
 *          outDir/index.json (fetched client-side)
 *          outDir/classIndex.json (fetched client-side)
 *          outDir/classSidebar.json (fetched client-side, grouped sidebar view)
 *          mdxDir/<ClassName>.mdx (Starlight docs)
 *
 * Usage:
 *   bun run scripts/generate-db.ts --in db/meta.db.json --out site/public/db --classes-out site/db-data/classes --mdx site/src/content/docs/classes
 *
 * Notes:
 * - Everything in meta.db.json is keyed by FNV-1a hash; resolved names are
 *   attached as metadata. Display names (resolved name or raw hex) drive
 *   slugs and links, same as before.
 * - Each class/property carries a revision history. The page shows the
 *   latest definition; older revisions surface as "type history", and
 *   entities absent from the latest game build are marked removed.
 */

import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { parse as parseYAML } from "yaml";
// Output shapes are the generator↔consumer contract - defined once in the
// site package and imported here so the producer can't drift from the
// consumers (components and api/scripts). Type-only, so it's erased at
// runtime (no cross-package dep).
import type {
  ChangeTuple,
  PropChange,
  ClassChange,
  ChangelogBuildGroup,
  ChangelogCounts,
  ChangelogPatch,
  ClassDocumentation,
  ClassJson,
  ClassSidebar,
  ClassSidebarEntry,
  ClassSidebarGroup,
  DescendantNode,
  Property,
  PropertyDocumentation,
  TypeHistoryEntry,
} from "../site/src/types";
// Raw meta.db.json shapes, shared with api/scripts.
import type { MetaDb, PropRevision } from "./meta-db";

// --- intermediate build shape ---
// The generator's working shape before ancestors/descendants and docs are
// attached to form the emitted ClassJson.
type ClassDoc = {
  name: string; // resolved type name or raw hex
  bases: string[]; // zero or more base names (resolved or hex)
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
const outDir = args.get("out") ?? "site/public/db";
const classesOutDir = args.get("classes-out") ?? "site/db-data/classes";
const mdxDir = args.get("mdx") ?? "site/src/content/docs/classes";
const changelogOutDir =
  args.get("changelog-out") ?? "site/db-data/changelog";
const changelogMdxDir =
  args.get("changelog-mdx") ?? "site/src/content/docs/changelog";
const docsDir = args.get("docs") ?? "db/docs";
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

    // Extract property docs
    const propertyDocs: Record<string, PropertyDocumentation> = {};
    if (parsed?.properties && typeof parsed.properties === 'object') {
      for (const [key, value] of Object.entries(parsed.properties)) {
        if (typeof value === 'object' && value !== null) {
          propertyDocs[key] = value as PropertyDocumentation;
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

  // versions are ordered by build number; builds are the unit of time
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
      bases: currentClass.bases.map(nameOf),
      properties: [],
    };
    if (classFrom > firstBuild) doc.since = patchOf(classFrom);
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
      if (propFrom > firstBuild && propFrom !== classFrom) {
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
 * A revision carries {from, to} with both bounds inclusive: the entity is
 * present from build `from` through build `to` (or through the latest build
 * when `to` is absent). db_build closes a revision at the last build with the
 * old shape and opens a new one at the next build whenever bases/interface/
 * value change, so a *consecutive* to/from split is a change, while a gap
 * (to << next from) is a real removal followed by a re-add.
 */
function buildChangelog(db: MetaDb): ChangelogPatch[] {
  const builds = db.versions.map((v) => v.build); // sorted by build
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

  // Inverted index: build → (classHash → accumulator). We record the class's
  // own change kind and any property changes separately, then reconcile: a new
  // or removed class is a single entry (its properties are not also listed),
  // mirroring the removedIn/since suppression in loadMetaDb.
  type Acc = {
    name: string;
    classKind?: "added" | "readded" | "removed" | "changed";
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
        if (rev.from !== firstBuild) acc(rev.from, khash, name).classKind = "added";
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
        acc(bcur, khash, name).classKind = "readded";
      }
    }

    // Class removed - a revision ends (to set) with no consecutive successor
    for (let i = 0; i < revs.length; i++) {
      const rev = revs[i];
      if (rev.to === undefined || rev.to === lastBuild) continue;
      const bnext = nextBuild(rev.to);
      const consecutiveNext =
        i + 1 < revs.length && revs[i + 1].from === bnext;
      if (!consecutiveNext) acc(bnext, khash, name).classKind = "removed";
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
        list.push({ name: e.name, slug, kind: e.classKind, build, propChanges: [] });
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
function generateMDX(c: ClassDoc, fileName: string): string {
  const displayName = c.name.startsWith("0x") ? `Class ${c.name}` : c.name;

  // Generate invisible heading anchors for TOC
  // These will be hidden but picked up by Starlight's TOC
  // MUST use Markdown syntax (##), not HTML <h2> tags
  const propertyAnchors = c.properties
    .map((prop) => `## ${prop.name}`)
    .join("\n\n");

  const patchFrontmatter =
    (c.since ? `\nsince: "${c.since}"` : "") +
    (c.removedIn ? `\nremovedIn: "${c.removedIn}"` : "");

  // Hash-named classes stay searchable (by hash and by property name), but
  // their property headings are heavily down-weighted in Pagefind so classes
  // with real names always rank above "Class 0x..." pages.
  const searchWeight = c.name.startsWith("0x")
    ? ` data-pagefind-weight="0.25"`
    : "";

  return `---
title: ${displayName}
description: Reference documentation for ${displayName} meta class${patchFrontmatter}
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

  // Ancestors as BFS levels going up: [direct bases, their bases, ...].
  // Multiple inheritance puts several classes on one level; each class
  // appears only once, at its shallowest depth.
  function getAncestorLevels(className: string): string[][] {
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
  function getDescendantTree(
    className: string,
    visited: Set<string>
  ): DescendantNode[] {
    const nodes: DescendantNode[] = [];
    const childs = [...(children.get(className) ?? [])].sort();
    for (const child of childs) {
      if (visited.has(child)) continue;
      visited.add(child);
      nodes.push({ name: child, children: getDescendantTree(child, visited) });
    }
    return nodes;
  }

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
  }[] = [];

  let jsonChanged = 0;
  let mdxChanged = 0;
  const generatedMDX = new Set<string>();
  const generatedJSON = new Set<string>();

  for (const c of classes) {
    const ancestorLevels = getAncestorLevels(c.name);
    const descendantTree = getDescendantTree(c.name, new Set([c.name]));

    // Load documentation from unified YAML file
    const { classDocs, propertyDocs } = await loadDocs(c.name, docsDir);

    // Merge property documentation
    const propertiesWithDocs = c.properties.map(prop => ({
      ...prop,
      docs: propertyDocs[prop.name] || null,
    }));

    const classJson: ClassJson = {
      name: c.name,
      bases: c.bases,
      since: c.since ?? null,
      removedIn: c.removedIn ?? null,
      properties: propertiesWithDocs,
      ancestorLevels,
      descendantTree,
      docs: classDocs || null,
    };
    const json = JSON.stringify(classJson, null, pretty ? 2 : 0);
    const hash = contentHash(classJson);
    const fileName = `${safeName(c.name)}.${hash}.json`;
    const filePath = join(classDir, fileName);
    const didJson = await writeIfChanged(filePath, json);
    if (didJson) jsonChanged++;
    generatedJSON.add(fileName);

    // Generate MDX file (lowercase for Starlight URL compatibility)
    const mdxFileName = `${safeName(c.name).toLowerCase()}.mdx`;
    const mdxFilePath = join(mdxDir, mdxFileName);
    const mdxContent = generateMDX(c, fileName);
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
    });
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

  // Emit a tiny index for navigation
  const indexPath = join(outDir, "index.json");
  await writeIfChanged(
    indexPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        latestPatch,
        total: index.length,
        classes: index,
      },
      null,
      pretty ? 2 : 0
    )
  );

  // Emit classIndex.json for type auto-linking
  const classIndex: Record<string, string> = {};
  for (const c of classes) {
    const slug = safeName(c.name).toLowerCase();
    classIndex[c.name] = `/classes/${slug}`;
  }
  const classIndexPath = join(outDir, "classIndex.json");
  await writeIfChanged(
    classIndexPath,
    JSON.stringify(classIndex, null, pretty ? 2 : 0)
  );

  // Emit classSidebar.json - the grouped view the client-rendered "Classes"
  // sidebar group consumes (ResizableSidebar.astro). Named classes bucket by
  // first PascalCase word; buckets of MIN_GROUP_SIZE+ become collapsible
  // groups, stragglers stay flat, and unresolved 0x… names sort last so they
  // stop burying the readable classes (issue #6).
  const MIN_GROUP_SIZE = 5;
  const isHashName = (n: string) => /^0x[0-9a-fA-F]+$/.test(n);
  const firstWord = (n: string) =>
    n.match(/^(?:[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+)/)?.[0] ?? n;
  const byName = (a: ClassSidebarEntry, b: ClassSidebarEntry) =>
    a[0].localeCompare(b[0], "en", { sensitivity: "base" });

  const buckets = new Map<string, ClassSidebarEntry[]>();
  const hashed: ClassSidebarEntry[] = [];
  for (const [name, href] of Object.entries(classIndex)) {
    if (isHashName(name)) {
      hashed.push([name, href]);
    } else {
      const word = firstWord(name);
      let bucket = buckets.get(word);
      if (!bucket) buckets.set(word, (bucket = []));
      bucket.push([name, href]);
    }
  }
  hashed.sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16));

  const sidebarGroups: ClassSidebarGroup[] = [];
  const sidebarOther: ClassSidebarEntry[] = [];
  for (const [label, entries] of buckets) {
    if (entries.length >= MIN_GROUP_SIZE) {
      sidebarGroups.push({ label, entries: entries.sort(byName) });
    } else {
      sidebarOther.push(...entries);
    }
  }
  sidebarGroups.sort((a, b) =>
    a.label.localeCompare(b.label, "en", { sensitivity: "base" })
  );
  sidebarOther.sort(byName);

  const classSidebar: ClassSidebar = {
    groups: sidebarGroups,
    other: sidebarOther,
    hashed,
  };
  await writeIfChanged(
    join(outDir, "classSidebar.json"),
    JSON.stringify(classSidebar, null, pretty ? 2 : 0)
  );

  // --- changelog: per-patch JSON (build-time only, outside public/ like the
  // class JSON) + MDX stubs + an index.json for the overview page ---
  const changelog = buildChangelog(metaDb);
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

  await writeIfChanged(
    join(changelogOutDir, "index.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), latestPatch, patches: changelogIndex },
      null,
      pretty ? 2 : 0
    )
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
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
