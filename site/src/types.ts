/**
 * Shared shapes for class/property data consumed by the components,
 * as produced by scripts/generate-db.ts
 */

export interface PropertyDocumentation {
  description?: string;
  examples?: string[];
  notes?: string[];
}

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
