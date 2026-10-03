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
  CategoryVia,
  ChangeTuple,
  ClassChange,
  ClassJson,
  ClassKind,
  ChangelogPatch,
  DescendantNode,
  DomainInfo,
  PropChange,
  Property,
  TypeHistoryEntry,
} from "../../../site/src/types";

export type SiteTypeTuple = ChangeTuple;
export type SiteHistoryEntry = TypeHistoryEntry;
export type SiteProperty = Property;
export type SiteTreeNode = DescendantNode;
/**
 * `category` is optional because the CLI's --db run derives its site classes
 * from a bare /v1/db, and the placement rules (db/categories.yaml) are not in
 * it. Generated site data always carries one; build-assets insists on it.
 */
export type SiteClass = Omit<ClassJson, "category"> & Partial<Pick<ClassJson, "category">>;
export type SiteDomain = DomainInfo;
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

/** Where a class sits in the wiki's domain list, and the rule that put it there. */
export interface ApiClassCategory {
  /** a domain id from /v1/categories */
  domain: string;
  via: CategoryVia;
  /** root of the class's primary base chain; the class itself when it has none */
  family: string;
  /** shared classes only: the domains of the classes using it */
  usedByDomains?: string[];
}

export interface ApiClass {
  name: string;
  hash: string;
  interface: boolean;
  value: boolean;
  kind: ClassKind;
  /** absent only when the source was a bare /v1/db (see SiteClass) */
  category?: ApiClassCategory;
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
