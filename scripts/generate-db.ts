#!/usr/bin/env bun
/**
 * LoL Meta DB per-class JSON & MDX generator (Bun)
 *
 * Input:   db/database.py  (Python-like text format; NOT executable)
 * Output:  outDir/classes/<ClassName>.<sha12>.json
 *          outDir/index.json
 *          mdxDir/<ClassName>.mdx (Starlight docs)
 *
 * Usage:
 *   bun run scripts/generate.ts --in db/database.py --out site/public/db --mdx site/src/content/docs/classes
 *
 * Notes:
 * - We don't need the original class hash; filenames are content-addressed via SHA.
 * - ClassName may be a resolved identifier or a raw hex (0x....). Both are supported.
 * - Fields follow "FieldName: (ft, kt, vt, kh)" exactly as in the DB format.
 */

import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

type FieldTuple = {
  name: string; // resolved field name or raw hex
  ft: string; // field type (Bool, I32, List2, Pointer, Map, ...)
  kt: string; // aux type or 0x0 (size for containers, key type for Map)
  vt: string; // aux value type or 0x0 (value type for containers/Map)
  kh: string; // referenced class/type or 0x0
};

type ClassDoc = {
  name: string; // resolved type name or raw hex
  bases: string[]; // zero or more base names (resolved or hex)
  properties: FieldTuple[];
};

type ParsedDB = {
  classes: ClassDoc[];
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
const inFile = args.get("in") ?? "db/database.py";
const outDir = args.get("out") ?? "site/public/db";
const mdxDir = args.get("mdx") ?? "site/src/content/docs/classes";
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

// --- parser ---
/**
 * The db format (line oriented):
 *   #!python
 *   class TypeName(Base1, Base2):
 *       FieldName: (ft, kt, vt, kh)
 *       ...
 *       pass
 */
function parseDatabasePy(text: string): ParsedDB {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const classes: ClassDoc[] = [];
  let current: ClassDoc | null = null;

  // Regexes reflect the documented structure
  const classLine = /^class\s+([^\s(]+)\s*\(([^)]*)\)\s*:\s*$/; // class Foo(Bar, Baz):
  const fieldLine =
    /^\s{4}([A-Za-z0-9_]+|0x[0-9a-fA-F]+):\s*\(\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)\s*$/;
  const passLine = /^\s*pass\s*$/;

  for (const raw of lines) {
    const line = raw.trimEnd();

    const mClass = line.match(classLine);
    if (mClass) {
      // close previous
      if (current) classes.push(current);
      const name = mClass[1].trim();
      const basesRaw = mClass[2].trim();
      const bases = basesRaw.length
        ? basesRaw
            .split(",")
            .map((b) => b.trim())
            .filter(Boolean)
        : [];
      current = { name, bases, properties: [] };
      continue;
    }

    if (current) {
      const mField = line.match(fieldLine);
      if (mField) {
        const [, fname, ft, kt, vt, kh] = mField;
        current.properties.push({ name: fname, ft, kt, vt, kh });
        continue;
      }

      if (passLine.test(line)) {
        // close class
        classes.push(current);
        current = null;
        continue;
      }
    }
  }

  // If file didn't end with 'pass' for the last class (shouldn’t happen), finalize it defensively
  if (current) classes.push(current);

  return { classes };
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

  return `---
title: ${displayName}
description: Reference documentation for ${displayName} meta class
---

import ClassDetails from '../../../components/ClassDetails.astro';

# ${displayName}

${basesText}

<ClassDetails file="/db/classes/${fileName}" />
`;
}

// --- main ---
async function main() {
  const source = await readFile(inFile, "utf8");
  if (!source.startsWith("#!python")) {
    console.warn(
      `[warn] ${basename(
        inFile
      )} doesn't start with '#!python'. Continuing anyway…`
    );
  }

  const parsed = parseDatabasePy(source);

  // Build inheritance graph
  const classMap = new Map<string, ClassDoc>();
  const children = new Map<string, Set<string>>(); // reverse lookup: class -> classes that inherit from it

  for (const c of parsed.classes) {
    classMap.set(c.name, c);
    children.set(c.name, new Set());
  }

  // Build reverse lookup
  for (const c of parsed.classes) {
    for (const base of c.bases) {
      if (!children.has(base)) {
        children.set(base, new Set());
      }
      children.get(base)!.add(c.name);
    }
  }

  // Helper to get all ancestors recursively
  function getAncestors(
    className: string,
    visited = new Set<string>()
  ): string[] {
    if (visited.has(className)) return [];
    visited.add(className);

    const cls = classMap.get(className);
    if (!cls) return [];

    const ancestors: string[] = [];
    for (const base of cls.bases) {
      ancestors.push(base);
      ancestors.push(...getAncestors(base, visited));
    }
    return [...new Set(ancestors)]; // deduplicate
  }

  // Helper to get all descendants recursively
  function getDescendants(
    className: string,
    visited = new Set<string>()
  ): string[] {
    if (visited.has(className)) return [];
    visited.add(className);

    const childs = children.get(className) || new Set();
    const descendants: string[] = [];
    for (const child of childs) {
      descendants.push(child);
      descendants.push(...getDescendants(child, visited));
    }
    return [...new Set(descendants)]; // deduplicate
  }

  // Emit per-class JSON
  const classDir = join(outDir, "classes");
  const index: {
    name: string;
    file: string;
    bases: string[];
    propCount: number;
  }[] = [];

  let jsonChanged = 0;
  let mdxChanged = 0;
  const generatedMDX = new Set<string>();

  for (const c of parsed.classes) {
    const ancestors = getAncestors(c.name);
    const descendants = getDescendants(c.name);

    const json = JSON.stringify(
      {
        name: c.name,
        bases: c.bases,
        properties: c.properties,
        ancestors,
        descendants,
        directChildren: [...(children.get(c.name) || [])],
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
    });
  }

  // Clean up old MDX files that no longer exist
  let mdxDeleted = 0;
  try {
    const existingMDX = await readdir(mdxDir);
    for (const file of existingMDX) {
      if (file.endsWith(".mdx") && !generatedMDX.has(file)) {
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
        total: index.length,
        classes: index,
      },
      null,
      pretty ? 2 : 0
    )
  );

  // Emit classIndex.json for type auto-linking
  const classIndex: Record<string, string> = {};
  for (const c of parsed.classes) {
    const slug = safeName(c.name).toLowerCase();
    classIndex[c.name] = `/classes/${slug}`;
  }
  const classIndexPath = join(outDir, "classIndex.json");
  await writeIfChanged(
    classIndexPath,
    JSON.stringify(classIndex, null, pretty ? 2 : 0)
  );

  console.log(`[ok] Parsed ${parsed.classes.length} classes`);
  console.log(`     - JSON: ${jsonChanged} changed, wrote to ${outDir}`);
  console.log(
    `     - MDX:  ${mdxChanged} changed, ${mdxDeleted} deleted, wrote to ${mdxDir}`
  );
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
