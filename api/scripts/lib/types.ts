/**
 * Shapes the asset build moves between. Both inputs are imported from their
 * owning packages so producer drift is a compile error, not a runtime throw:
 *
 *  - raw meta.db.json shapes come from scripts/meta-db.ts (shared with
 *    scripts/generate-db.ts)
 *  - site-generated JSON shapes come from site/src/types.ts (the generator's
 *    output contract), aliased to Site* for the transforms
 *
 * Only the API v1 output shapes (Api*) are declared here - that contract is
 * owned by this package. Type-only imports, erased at runtime.
 */

export type { ClassRevision, MetaClass, MetaDb, PropRevision } from "../../../scripts/meta-db";

import type {
  ChangeTuple,
  ClassChange,
  ClassJson,
  ChangelogPatch,
  DescendantNode,
  PropChange,
  Property,
  TypeHistoryEntry,
} from "../../../site/src/types";

export type SiteTypeTuple = ChangeTuple;
export type SiteHistoryEntry = TypeHistoryEntry;
export type SiteProperty = Property;
export type SiteTreeNode = DescendantNode;
export type SiteClass = ClassJson;
export type SitePropChange = PropChange;
export type SiteClassChange = ClassChange;
export type SiteChangelogPatch = ChangelogPatch;

// --- API v1 output (canonical hashes, prose split off) ---

export type KhKind = "class" | "external" | "unknown";

/** A resolved type reference: canonical hash + name + what the hash is. */
export interface TypeRef {
  kh: string | null;
  khName: string | null;
  khKind: KhKind | null;
}

export interface ApiTypeFields extends TypeRef {
  ft: string;
  kt: string | null;
  vt: string | null;
}

export interface ApiHistoryEntry extends ApiTypeFields {
  since: string;
  until: string | null;
  defaultValue?: string;
}

export interface ApiProperty extends ApiTypeFields {
  name: string;
  hash: string;
  since?: string;
  removedIn?: string;
  defaultValue?: string;
  history?: ApiHistoryEntry[];
  /** only in the flattened (inherited) view: the class defining this property */
  from?: string;
}

export interface ApiTreeNode {
  name: string;
  children: ApiTreeNode[];
}

export interface ApiClass {
  name: string;
  hash: string;
  interface: boolean;
  value: boolean;
  bases: string[];
  since: string | null;
  removedIn: string | null;
  properties: ApiProperty[];
  ancestorLevels: string[][];
  descendantTree: ApiTreeNode[];
  flattened?: true;
}

export interface ApiPropChange {
  name: string;
  kind: string;
  oldType?: ApiTypeFields;
  newType?: ApiTypeFields;
}

export interface ApiClassChange {
  name: string;
  kind: string;
  build: number;
  baseChange?: { old: string[]; new: string[] };
  propChanges: ApiPropChange[];
}

export interface ClassDocs {
  name: string;
  class: unknown;
  properties: Record<string, unknown>;
}
