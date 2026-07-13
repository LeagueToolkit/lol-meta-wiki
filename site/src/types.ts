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
