/**
 * Pure transforms from the site-generated JSON to the API v1 shapes:
 * canonical hashes everywhere, structured type references, "0x0" sentinels
 * turned into nulls, site page anchors dropped, prose split off.
 */

import { canonName, type ClassInfo, type Resolver } from "./resolver";
import type {
  ApiClass,
  ApiClassChange,
  ApiProperty,
  ApiTreeNode,
  ApiTypeFields,
  ClassDocs,
  SiteClass,
  SiteClassChange,
  SiteChangelogPatch,
  SiteProperty,
  SiteTreeNode,
  SiteTypeTuple,
} from "./types";

// "0x0" means "no aux type" in the raw tuple; null is the API's spelling.
const auxType = (t: string) => (t === "0x0" ? null : t);

const typeFields = (r: Resolver, t: SiteTypeTuple): ApiTypeFields => ({
  ft: t.ft,
  kt: auxType(t.kt),
  vt: auxType(t.vt),
  ...r.typeRef(t.kh),
});

function transformProperty(r: Resolver, p: SiteProperty, cls: ClassInfo, className: string): ApiProperty {
  const hash = cls.propHashByName.get(p.name);
  if (!hash) {
    throw new Error(
      `property ${className}.${p.name} not found in meta.db.json - site data is stale, re-run generate-db`
    );
  }
  return {
    name: canonName(p.name),
    hash,
    ...typeFields(r, p),
    ...(p.since !== undefined && { since: p.since }),
    ...(p.removedIn !== undefined && { removedIn: p.removedIn }),
    ...(p.defaultValue !== undefined && { defaultValue: p.defaultValue }),
    ...(p.history && {
      history: p.history.map((h) => ({
        since: h.since,
        until: h.until,
        ...typeFields(r, h),
        ...(h.defaultValue !== undefined && { defaultValue: h.defaultValue }),
      })),
    }),
  };
}

const transformTree = (nodes: SiteTreeNode[]): ApiTreeNode[] =>
  nodes.map((n) => ({ name: canonName(n.name), children: transformTree(n.children) }));

export function transformClass(r: Resolver, site: SiteClass): ApiClass {
  const { hash, info } = r.classInfo(site.name);
  return {
    name: canonName(site.name),
    hash,
    ...info.flags,
    bases: site.bases.map(canonName),
    since: site.since,
    removedIn: site.removedIn,
    properties: site.properties.map((p) => transformProperty(r, p, info, site.name)),
    ancestorLevels: site.ancestorLevels.map((level) => level.map(canonName)),
    descendantTree: transformTree(site.descendantTree),
  };
}

/** Peel the CC BY-SA prose off a site class; null when it has none. */
export function extractDocs(site: SiteClass): ClassDocs | null {
  const properties: Record<string, unknown> = {};
  for (const p of site.properties) {
    if (p.docs != null) properties[canonName(p.name)] = p.docs;
  }
  const cls = site.docs ?? null;
  if (cls === null && Object.keys(properties).length === 0) return null;
  return { name: canonName(site.name), class: cls, properties };
}

/**
 * The inherited-properties view: walk ancestorLevels (nearest level first)
 * merging each ancestor's own properties in; the nearest definition wins on
 * a name conflict, and every property is stamped with its defining class.
 */
export function flattenClass(cls: ApiClass, byName: Map<string, ApiClass>): ApiClass {
  const seen = new Set(cls.properties.map((p) => p.name));
  const properties = cls.properties.map((p) => ({ ...p, from: cls.name }));
  for (const level of cls.ancestorLevels) {
    for (const name of level) {
      const ancestor = byName.get(name);
      if (!ancestor) continue; // base outside the dumped class set
      for (const p of ancestor.properties) {
        if (seen.has(p.name)) continue;
        seen.add(p.name);
        properties.push({ ...p, from: name });
      }
    }
  }
  return { ...cls, flattened: true, properties };
}

function transformChangelogEntry(r: Resolver, e: SiteClassChange): ApiClassChange {
  return {
    name: canonName(e.name),
    kind: e.kind,
    build: e.build,
    ...(e.baseChange && {
      baseChange: { old: e.baseChange.old.map(canonName), new: e.baseChange.new.map(canonName) },
    }),
    propChanges: e.propChanges.map((p) => ({
      name: canonName(p.name),
      kind: p.kind,
      ...(p.oldType && { oldType: typeFields(r, p.oldType) }),
      ...(p.newType && { newType: typeFields(r, p.newType) }),
    })),
  };
}

export function transformChangelog(r: Resolver, patch: SiteChangelogPatch) {
  return {
    ...patch,
    buildGroups: patch.buildGroups.map((g) => ({
      build: g.build,
      entries: g.entries.map((e) => transformChangelogEntry(r, e)),
    })),
  };
}
