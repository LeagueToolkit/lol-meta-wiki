#!/usr/bin/env bun
/**
 * LoL Meta DB per-class JSON & MDX generator (Bun)
 *
 * Input:   db/meta.db.json  (versioned database from LeagueToolkit/lol-meta-classes;
 *          see its docs/meta-db-format.md — refresh with `pnpm update-db`)
 * Output:  outDir/classes/<ClassName>.<sha12>.json
 *          outDir/index.json
 *          mdxDir/<ClassName>.mdx (Starlight docs)
 *
 * Usage:
 *   bun run scripts/generate-db.ts --in db/meta.db.json --out site/public/db --mdx site/src/content/docs/classes
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

// --- meta.db.json types ---
type MetaVersion = { patch: string; build: number };

type ClassRevision = {
  from: number;
  to?: number;
  bases: string[];
  interface: boolean;
  value: boolean;
};

type PropRevision = {
  from: number;
  to?: number;
  type: [string, string, string, string]; // (ft, kt, vt, kh) — kh is a raw hash
  default?: unknown;
};

type MetaProperty = { name?: string; revisions: PropRevision[] };
type MetaClass = {
  name?: string;
  revisions: ClassRevision[];
  properties: Record<string, MetaProperty>;
};

type MetaDb = {
  formatVersion: number;
  latest: number;
  versions: MetaVersion[];
  externalTypeNames: Record<string, string>;
  classes: Record<string, MetaClass>;
};

// --- output types ---
type TypeHistoryEntry = {
  since: string; // patch of first build with this definition
  until: string | null; // patch of last build seen, null = current
  ft: string;
  kt: string;
  vt: string;
  kh: string;
  defaultValue?: string;
};

type FieldTuple = {
  name: string; // resolved field name or raw hex
  ft: string; // field type (Bool, I32, List2, Pointer, Map, ...)
  kt: string; // aux type or 0x0 (size for containers, key type for Map)
  vt: string; // aux value type or 0x0 (value type for containers/Map)
  kh: string; // referenced class/type or 0x0
  since?: string; // patch the property was added in (omitted when it appeared with the class)
  removedIn?: string; // patch the property was removed in (omitted when the whole class is removed)
  defaultValue?: string; // optional default value as JSON string
  history?: TypeHistoryEntry[]; // present when the definition changed over time
};

type PropertyDocumentation = {
  description?: string;
  examples?: string[];
  notes?: string[];
};

type ClassDocumentation = {
  description?: string;
  examples?: string[];
  notes?: string[];
};

type ClassDoc = {
  name: string; // resolved type name or raw hex
  bases: string[]; // zero or more base names (resolved or hex)
  properties: FieldTuple[];
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
const mdxDir = args.get("mdx") ?? "site/src/content/docs/classes";
const docsDir = args.get("docs") ?? "db/docs";
const pretty = args.get("pretty") === "true" || args.get("pretty") === "1";

// --- helpers ---
function sha12(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
function safeName(name: string) {
  // Keep hex and identifiers; sanitize anything weird just in case
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
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

      const prop: FieldTuple = {
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

// --- MDX generator ---
/**
 * Generate MDX content for a class documentation page
 */
function generateMDX(c: ClassDoc, fileName: string): string {
  const displayName = c.name.startsWith("0x") ? `Class ${c.name}` : c.name;

  // Create clickable links for base classes
  const basesLinks = c.bases.map((base) => {
    const slug = safeName(base).toLowerCase();
    return `[${base}](/classes/${slug})`;
  });
  const basesText =
    basesLinks.length > 0 ? `**Inherits from:** ${basesLinks.join(", ")}` : "";

  // Generate invisible heading anchors for TOC
  // These will be hidden but picked up by Starlight's TOC
  // MUST use Markdown syntax (##), not HTML <h2> tags
  const propertyAnchors = c.properties
    .map((prop) => `## ${prop.name}`)
    .join("\n\n");

  return `---
title: ${displayName}
description: Reference documentation for ${displayName} meta class
---

import ClassDetails from '../../../components/ClassDetails.astro';

${basesText}

<ClassDetails file="/db/classes/${fileName}" />

<div style="position: absolute; visibility: hidden; pointer-events: none;" aria-hidden="true">

${propertyAnchors}

</div>
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
  type DescendantNode = { name: string; children: DescendantNode[] };
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

  // Emit per-class JSON
  const classDir = join(outDir, "classes");
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

    const json = JSON.stringify(
      {
        name: c.name,
        bases: c.bases,
        since: c.since ?? null,
        removedIn: c.removedIn ?? null,
        properties: propertiesWithDocs,
        ancestorLevels,
        descendantTree,
        docs: classDocs || null,
      },
      null,
      pretty ? 2 : 0
    );
    const hash = sha12(json);
    const fileName = `${safeName(c.name)}.${hash}.json`;
    const filePath = join(classDir, fileName);
    const didJson = await writeIfChanged(filePath, json);
    if (didJson) jsonChanged++;

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

  const removedCount = classes.filter((c) => c.removedIn).length;
  console.log(
    `[ok] Loaded ${classes.length} classes (${removedCount} removed) from patch ${latestPatch} db`
  );
  console.log(`     - JSON: ${jsonChanged} changed, wrote to ${outDir}`);
  console.log(
    `     - MDX:  ${mdxChanged} changed, ${mdxDeleted} deleted, wrote to ${mdxDir}`
  );
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
