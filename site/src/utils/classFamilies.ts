/**
 * Group the changelog's new/removed class entries by inheritance family.
 *
 * A patch can add 100+ classes at once, and most of that bulk is one base
 * class arriving with its subclasses (16.7: 91 of 134 new classes derive from
 * BaseParams). Flat, the section reads as noise; grouped by the root of each
 * class's base chain, the same list reads as "one new family, plus a handful
 * of one-offs".
 *
 * The root itself is generated data (`ClassChange.family`, resolved at the
 * build of the change) - this only buckets and orders what the generator
 * already decided.
 */

import type { ClassChange } from "../types";

export interface ClassFamily {
  /** The root class the members share; also the name of a member when the
   * root was added/removed in the same patch. */
  name: string;
  entries: ClassChange[];
}

export interface FamilyGrouping {
  /** Families with two or more members, biggest first then A→Z. */
  families: ClassFamily[];
  /** Entries whose family has no other member in this section - grouping them
   * one-per-header would be noisier than the flat list it replaced. */
  loners: ClassChange[];
}

export function groupByFamily(entries: ClassChange[]): FamilyGrouping {
  // Entries predating the `family` field (and root classes, which are their
  // own family) key on their own name, so a base and its subclasses meet in
  // the same bucket.
  const buckets = new Map<string, ClassChange[]>();
  for (const e of entries) {
    const key = e.family ?? e.name;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(e);
  }

  const families: ClassFamily[] = [];
  const loners: ClassChange[] = [];
  for (const [name, bucket] of buckets) {
    if (bucket.length < 2) {
      loners.push(...bucket);
      continue;
    }
    // The root leads its own family when it changed too; the rest keep the
    // generator's A→Z order (hash names would otherwise sort ahead of it).
    const root = bucket.findIndex((e) => e.name === name);
    if (root > 0) bucket.unshift(...bucket.splice(root, 1));
    families.push({ name, entries: bucket });
  }

  families.sort(
    (a, b) =>
      b.entries.length - a.entries.length ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
  // A single-entry bucket is inserted at its entry's position, so the loners
  // come out in the generator's A→Z order.
  return { families, loners };
}
