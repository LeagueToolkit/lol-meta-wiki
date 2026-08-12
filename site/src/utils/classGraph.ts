/**
 * Build-time access to the inheritance graph (db-data/classGraph.json).
 *
 * Parsed once per build process at module scope and shared across all page
 * renders, like utils/classIndex.ts - ClassDetails renders ~5,300 pages, and
 * the graph answers two questions the per-class JSON deliberately doesn't:
 *
 * - who else derives from my bases (siblings), and
 * - is any class in my tree gone from the game.
 *
 * Both are graph-wide facts; see the ClassGraph comment in types.ts for why
 * they aren't baked into every class file.
 */

import fs from "node:fs";
import { root } from "astro:config/server";
import type { ClassGraph, ClassJson, DescendantNode } from "../types";

const graph: ClassGraph = JSON.parse(
  fs.readFileSync(new URL("./db-data/classGraph.json", root), "utf8")
);

/** Removed class name → the patch it disappeared in. */
export const removedIn: Record<string, string> = graph.removedIn;

/** Direct subclasses of a class, A→Z. */
export function childrenOf(name: string): string[] {
  return graph.children[name] ?? [];
}

/** Another class deriving from one of the current class's bases. */
export interface Sibling {
  name: string;
  /** Size of its own subtree, matching the counts on descendant chips. */
  descendants: number;
}

// Descendant sets are memoised: a page asks for one per sibling, and popular
// bases have hundreds of them. Seeding the map before the walk also keeps a
// malformed (cyclic) graph from recursing forever.
const descendantCache = new Map<string, Set<string>>();

function descendantsOf(name: string): Set<string> {
  const cached = descendantCache.get(name);
  if (cached) return cached;
  const out = new Set<string>();
  descendantCache.set(name, out);
  for (const child of childrenOf(name)) {
    out.add(child);
    for (const deeper of descendantsOf(child)) out.add(deeper);
  }
  return out;
}

/**
 * The other subclasses of a class's bases, A→Z.
 *
 * Anything the inheritance tree already draws is left out: with multiple
 * inheritance a class can be both a sibling and an ancestor or descendant,
 * and listing it twice reads as two different classes.
 */
export function siblingsOf(
  cls: Pick<ClassJson, "name" | "bases" | "ancestorLevels" | "descendantTree">
): Sibling[] {
  const shown = new Set<string>([cls.name]);
  for (const level of cls.ancestorLevels) {
    for (const name of level) shown.add(name);
  }
  const walk = (nodes: DescendantNode[]) => {
    for (const node of nodes) {
      shown.add(node.name);
      walk(node.children);
    }
  };
  walk(cls.descendantTree);

  const names = new Set<string>();
  for (const base of cls.bases) {
    for (const name of childrenOf(base)) {
      if (!shown.has(name)) names.add(name);
    }
  }
  return [...names]
    .sort()
    .map((name) => ({ name, descendants: descendantsOf(name).size }));
}
