/**
 * Raw meta.db.json shapes, shared by every consumer of the DB
 * (scripts/generate-db.ts and api/scripts) so the readers can't drift from
 * each other. Hashes are unpadded lowercase hex ("0x6516a"); builds are the
 * game's build numbers (translate via `versions`).
 */

export type MetaVersion = { patch: string; build: number };

export type ClassRevision = {
  from: number;
  to?: number;
  bases: string[];
  interface: boolean;
  value: boolean;
};

export type PropRevision = {
  from: number;
  to?: number;
  type: [string, string, string, string]; // (ft, kt, vt, kh) - kh is a raw hash
  default?: unknown;
};

export type MetaProperty = { name?: string; revisions: PropRevision[] };

export type MetaClass = {
  name?: string;
  revisions: ClassRevision[];
  properties: Record<string, MetaProperty>;
};

export type MetaDb = {
  formatVersion: number;
  hashSource?: { fetchedAt?: string };
  latest: number;
  versions: MetaVersion[];
  externalTypeNames: Record<string, string>;
  classes: Record<string, MetaClass>;
};
