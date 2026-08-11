/**
 * Shared shapes for class/property data consumed by the components,
 * as produced by scripts/generate-db.ts
 */

export interface PropertyDocumentation {
  description?: string;
  examples?: string[];
  notes?: string[];
}

// Class-level docs share the entry shape with property docs.
export type ClassDocumentation = PropertyDocumentation;

export interface TypeHistoryEntry {
  since: string;
  until: string | null;
  ft: string;
  vt: string;
  kh: string;
  kt: string;
  defaultValue?: string;
}

export interface Property {
  name: string;
  ft: string;
  vt: string;
  kh: string;
  kt: string;
  since?: string;
  removedIn?: string;
  history?: TypeHistoryEntry[];
  docs?: PropertyDocumentation | null;
  defaultValue?: string;
}

// --- per-class JSON ---
// The shape of site/db-data/classes/<Name>.<hash>.json, as emitted by
// scripts/generate-db.ts and read by ClassDetails.astro and api/scripts.

/** One node of the descendant tree; with multiple inheritance a class appears
 * only under the first parent encountered. */
export interface DescendantNode {
  name: string;
  children: DescendantNode[];
}

export interface ClassJson {
  name: string;
  bases: string[];
  /** Patch the class was added in; null = present when tracking began. */
  since: string | null;
  removedIn: string | null;
  properties: Property[];
  /** Full inheritance chain, nearest level first. */
  ancestorLevels: string[][];
  descendantTree: DescendantNode[];
  docs: ClassDocumentation | null;
  /** Classes whose live properties reference this class, A→Z. */
  usedBy: UsedByClass[];
}

// --- referenced-by shapes ---
// Reverse references computed by generate-db.ts: for each class, the classes
// whose properties use it as a type (through any slot of the type tuple).
// Rendered by ReferencedBySection.astro.

/** One property through which a class references the current class. */
export interface UsedByProp extends ChangeTuple {
  name: string;
  /** Heading anchor on the owning class page (anchorSlug semantics). */
  slug: string;
}

export interface UsedByClass {
  name: string;
  props: UsedByProp[];
}

// --- changelog shapes ---
// Single source of truth for the changelog contract: scripts/generate-db.ts
// (buildChangelog) imports these to guarantee it emits what the components read.
export interface ChangeTuple {
  ft: string;
  kt: string;
  vt: string;
  kh: string;
}

export interface PropChange {
  name: string;
  slug: string;
  kind: "added" | "readded" | "removed" | "typechanged";
  oldType?: ChangeTuple;
  newType?: ChangeTuple;
}

export interface ClassChange {
  name: string;
  slug: string;
  kind: "added" | "readded" | "removed" | "changed";
  build: number;
  baseChange?: { old: string[]; new: string[] };
  propChanges: PropChange[];
}

export interface ChangelogCounts {
  added: number;
  readded: number;
  removed: number;
  changed: number;
}

export interface ChangelogBuildGroup {
  build: number;
  entries: ClassChange[];
}

export interface ChangelogPatch {
  patch: string;
  slug: string;
  builds: number[];
  counts: ChangelogCounts;
  buildGroups: ChangelogBuildGroup[];
}

export interface ChangelogIndexEntry {
  patch: string;
  slug: string;
  builds: number[];
  counts: ChangelogCounts;
}

// --- class sidebar shapes ---
// Grouped class list for the client-rendered "Classes" sidebar group
// (ResizableSidebar.astro), emitted as classSidebar.json. Grouping is
// computed at generate time; the sidebar script is a dumb renderer.
export type ClassSidebarEntry = [name: string, href: string];

export interface ClassSidebarGroup {
  label: string;
  entries: ClassSidebarEntry[];
}

export interface ClassSidebar {
  /** First-word buckets large enough to be collapsible groups, A→Z. */
  groups: ClassSidebarGroup[];
  /** Named classes whose bucket was too small, flat, A→Z. */
  other: ClassSidebarEntry[];
  /** Unresolved 0x… names, sorted numerically — rendered last, collapsed. */
  hashed: ClassSidebarEntry[];
}

// --- class hash index ---
// Canonical class hash ("0x" + 8 lowercase, zero-padded hex digits) → the
// class page slug, emitted as classHashes.json. Consumed by the 404 resolver
// (components/NotFound.astro) to map any spelling of a class - hash or name -
// onto the one slug a page exists under.
export type ClassHashIndex = Record<string, string>;

// --- symbol search index ---
// Compact identifier index for the client-side symbol search in the search
// modal (Search.astro + utils/symbolSearch.ts), emitted as symbols.json.

export type SymbolClassEntry = [name: string, href: string];

/** Deduped property name; owners are indices into SymbolsIndex.classes. */
export type SymbolPropEntry = [name: string, owners: number[]];

export interface SymbolsIndex {
  /** All classes, A→Z (same order as the per-class emit loop). */
  classes: SymbolClassEntry[];
  props: SymbolPropEntry[];
}
