/**
 * Raw `/v1/db` -> the site shapes the API's transforms consume.
 *
 * This is the offline half of `--db`: a downloaded database is turned into
 * the same per-class and per-patch shapes `scripts/generate-db.ts` emits, so
 * `api/scripts/lib/transform.ts` can turn them into API payloads and every
 * command runs unchanged. The rules here mirror the generator's `loadMetaDb`
 * and `buildChangelog` (lifetime, history collapsing, add/re-add/remove
 * classification); if either changes, this must follow, and the offline test
 * that compares `--db` answers against recorded API responses catches it.
 * The changelog's `family` grouping is site-only and not derived.
 */

import type {
  MetaDb,
  PropRevision,
  SiteChangelogPatch,
  SiteClass,
  SiteClassChange,
  SiteHistoryEntry,
  SitePropChange,
  SiteProperty,
  SiteTreeNode,
  SiteTypeTuple,
} from "../../api/scripts/lib/types";
import { comparePatches } from "./versions";

/** Wiki base for constructed page URLs; matches `site` in site/astro.config.mjs. */
export const SITE_URL = "https://meta-wiki.leaguetoolkit.dev";

const byName = <T extends { name: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Class page slug, as generate-db's `classSlug`: sanitized, lowercased site name. */
export function classSlug(siteName: string): string {
  return siteName.replace(/[^A-Za-z0-9._-]/g, "_").toLowerCase();
}

/** Property heading anchor, as generate-db's `anchorSlug` (github-slugger semantics). */
export function anchorSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "");
}

class Timeline {
  readonly builds: number[];
  readonly firstBuild: number;
  readonly lastBuild: number;
  private readonly patchByBuild: Map<number, string>;
  private readonly indexOf: Map<number, number>;

  constructor(db: MetaDb) {
    this.builds = db.versions.map((v) => v.build);
    this.firstBuild = this.builds[0]!;
    this.lastBuild = this.builds[this.builds.length - 1]!;
    this.patchByBuild = new Map(db.versions.map((v) => [v.build, v.patch]));
    this.indexOf = new Map(this.builds.map((b, i) => [b, i]));
  }

  patchOf(build: number): string {
    const p = this.patchByBuild.get(build);
    if (p === undefined) throw new Error(`build ${build} is not in the database's version map`);
    return p;
  }

  /** "Removed in" = the patch of the first build the entity is missing from. */
  patchAfter(build: number): string {
    const i = this.indexOf.get(build);
    if (i === undefined) throw new Error(`build ${build} is not in the database's version map`);
    return this.patchOf(this.builds[Math.min(i + 1, this.builds.length - 1)]!);
  }

  prev(build: number): number | undefined {
    const i = this.indexOf.get(build);
    return i === undefined ? undefined : this.builds[i - 1];
  }

  next(build: number): number | undefined {
    const i = this.indexOf.get(build);
    return i === undefined ? undefined : this.builds[i + 1];
  }
}

/** Display name for any type hash: dumped class name, external type name, or the raw hash. */
const namer = (db: MetaDb) => (hash: string) =>
  hash === "0x0" ? "0x0" : (db.classes[hash]?.name ?? db.externalTypeNames[hash] ?? hash);

const sameType = (a: PropRevision, b: PropRevision) => a.type.join("|") === b.type.join("|");

/** Collapse consecutive revisions whose type did not change (removed and re-added between builds). */
function collapse(revs: PropRevision[]): PropRevision[] {
  const merged: PropRevision[] = [];
  for (const rev of revs) {
    const prev = merged[merged.length - 1];
    if (prev && sameType(prev, rev)) {
      if (rev.to !== undefined) prev.to = rev.to;
      else delete prev.to;
      if ("default" in rev) prev.default = rev.default;
    } else {
      merged.push({ ...rev });
    }
  }
  return merged;
}

function deriveProperties(db: MetaDb, t: Timeline, khash: string): SiteProperty[] {
  const klass = db.classes[khash]!;
  const nameOf = namer(db);
  const classFrom = klass.revisions[0]!.from;
  const classRemoved = klass.revisions[klass.revisions.length - 1]!.to !== undefined;
  const out: SiteProperty[] = [];
  for (const [fhash, metaProp] of Object.entries(klass.properties)) {
    const revs = metaProp.revisions;
    const current = revs[revs.length - 1]!;
    const [ft, kt, vt, khRaw] = current.type;
    const prop: SiteProperty = { name: metaProp.name ?? fhash, ft, kt, vt, kh: nameOf(khRaw) };
    const propFrom = revs[0]!.from;
    // "Added in" only when the property appeared after the class did, and after tracking began.
    if (propFrom > t.firstBuild && propFrom !== classFrom) prop.since = t.patchOf(propFrom);
    // A removed class covers its properties; only a living class flags a removed property.
    if (current.to !== undefined && !classRemoved) prop.removedIn = t.patchAfter(current.to);
    if ("default" in current) prop.defaultValue = JSON.stringify(current.default);
    const merged = collapse(revs);
    if (merged.length > 1) {
      prop.history = merged.map((rev) => {
        const [hft, hkt, hvt, hkh] = rev.type;
        const entry: SiteHistoryEntry = {
          since: t.patchOf(rev.from),
          until: rev.to !== undefined ? t.patchOf(rev.to) : null,
          ft: hft,
          kt: hkt,
          vt: hvt,
          kh: nameOf(hkh),
        };
        if ("default" in rev) entry.defaultValue = JSON.stringify(rev.default);
        return entry;
      });
    }
    out.push(prop);
  }
  return out.sort(byName);
}

/** Every class in the site's per-class shape, sorted by name, with ancestry filled in. */
export function deriveClasses(db: MetaDb): SiteClass[] {
  const t = new Timeline(db);
  const nameOf = namer(db);

  const classes: SiteClass[] = [];
  for (const [khash, klass] of Object.entries(db.classes)) {
    const first = klass.revisions[0]!;
    const current = klass.revisions[klass.revisions.length - 1]!;
    classes.push({
      name: klass.name ?? khash,
      bases: current.bases.map(nameOf),
      since: first.from > t.firstBuild ? t.patchOf(first.from) : null,
      removedIn: current.to !== undefined ? t.patchAfter(current.to) : null,
      properties: deriveProperties(db, t, khash),
      ancestorLevels: [],
      descendantTree: [],
      docs: null,
      usedBy: [],
    });
  }
  classes.sort(byName);

  const bases = new Map(classes.map((c) => [c.name, c.bases]));
  const children = new Map<string, Set<string>>();
  for (const c of classes) {
    for (const base of c.bases) {
      let set = children.get(base);
      if (!set) children.set(base, (set = new Set()));
      set.add(c.name);
    }
  }
  // Ancestors as BFS levels going up; each class once, at its shallowest depth.
  const ancestorLevels = (name: string): string[][] => {
    const levels: string[][] = [];
    const seen = new Set([name]);
    let frontier = bases.get(name) ?? [];
    while (frontier.length > 0) {
      const level = [...new Set(frontier)].filter((n) => !seen.has(n));
      if (level.length === 0) break;
      for (const n of level) seen.add(n);
      levels.push(level);
      frontier = level.flatMap((n) => bases.get(n) ?? []);
    }
    return levels;
  };
  // Full descendant tree; with multiple inheritance a subtree renders once, under the first parent met.
  const descendantTree = (name: string, visited: Set<string>): SiteTreeNode[] => {
    const nodes: SiteTreeNode[] = [];
    for (const child of [...(children.get(name) ?? [])].sort()) {
      if (visited.has(child)) continue;
      visited.add(child);
      nodes.push({ name: child, children: descendantTree(child, visited) });
    }
    return nodes;
  };
  for (const c of classes) {
    c.ancestorLevels = ancestorLevels(c.name);
    c.descendantTree = descendantTree(c.name, new Set([c.name]));
  }
  return classes;
}

type ClassKind = SiteClassChange["kind"];

/** What one class accumulated at one build, before reconciliation into an entry. */
interface ChangeAccumulator {
  name: string;
  classKind?: ClassKind;
  baseChange?: { old: string[]; new: string[] };
  propChanges: SitePropChange[];
}

/** Per-patch changelogs reconstructed from revision boundaries, newest first. */
export function deriveChangelog(db: MetaDb): SiteChangelogPatch[] {
  const t = new Timeline(db);
  const nameOf = namer(db);
  const tupleOf = (type: PropRevision["type"]): SiteTypeTuple => ({
    ft: type[0],
    kt: type[1],
    vt: type[2],
    kh: nameOf(type[3]),
  });

  const index = new Map<number, Map<string, ChangeAccumulator>>();
  const acc = (build: number, khash: string, name: string): ChangeAccumulator => {
    let byClass = index.get(build);
    if (!byClass) index.set(build, (byClass = new Map()));
    let entry = byClass.get(khash);
    if (!entry) byClass.set(khash, (entry = { name, propChanges: [] }));
    return entry;
  };

  for (const [khash, klass] of Object.entries(db.classes)) {
    const name = klass.name ?? khash;
    const revs = klass.revisions;
    // Class added / re-added / changed, keyed by the build a revision starts.
    revs.forEach((rev, i) => {
      if (i === 0) {
        if (rev.from !== t.firstBuild) acc(rev.from, khash, name).classKind = "added";
        return;
      }
      const prev = revs[i - 1]!;
      const entry = acc(rev.from, khash, name);
      if (prev.to === t.prev(rev.from)) {
        entry.classKind = "changed";
        const oldBases = prev.bases.map(nameOf);
        const newBases = rev.bases.map(nameOf);
        if (oldBases.join("|") !== newBases.join("|")) entry.baseChange = { old: oldBases, new: newBases };
      } else {
        entry.classKind = "readded";
      }
    });
    // Class removed: a revision ends with no consecutive successor.
    revs.forEach((rev, i) => {
      if (rev.to === undefined || rev.to === t.lastBuild) return;
      const nextBuild = t.next(rev.to)!;
      if (!(i + 1 < revs.length && revs[i + 1]!.from === nextBuild)) acc(nextBuild, khash, name).classKind = "removed";
    });

    for (const [fhash, metaProp] of Object.entries(klass.properties)) {
      const pname = metaProp.name ?? fhash;
      const slug = anchorSlug(pname);
      const prevs = metaProp.revisions;
      prevs.forEach((rev, i) => {
        if (i === 0) {
          if (rev.from !== t.firstBuild) {
            acc(rev.from, khash, name).propChanges.push({ name: pname, slug, kind: "added", newType: tupleOf(rev.type) });
          }
          return;
        }
        const prev = prevs[i - 1]!;
        if (prev.to === t.prev(rev.from)) {
          if (!sameType(prev, rev)) {
            acc(rev.from, khash, name).propChanges.push({
              name: pname,
              slug,
              kind: "typechanged",
              oldType: tupleOf(prev.type),
              newType: tupleOf(rev.type),
            });
          }
        } else {
          acc(rev.from, khash, name).propChanges.push({ name: pname, slug, kind: "readded", newType: tupleOf(rev.type) });
        }
      });
      prevs.forEach((rev, i) => {
        if (rev.to === undefined || rev.to === t.lastBuild) return;
        const nextBuild = t.next(rev.to)!;
        if (!(i + 1 < prevs.length && prevs[i + 1]!.from === nextBuild)) {
          acc(nextBuild, khash, name).propChanges.push({ name: pname, slug, kind: "removed", oldType: tupleOf(rev.type) });
        }
      });
    }
  }

  // Reconcile: a new or removed class is one entry, its property churn not also listed.
  const changesByBuild = new Map<number, SiteClassChange[]>();
  for (const [build, byClass] of index) {
    const list: SiteClassChange[] = [];
    for (const change of byClass.values()) {
      const slug = classSlug(change.name);
      if (change.classKind === "added" || change.classKind === "readded" || change.classKind === "removed") {
        list.push({ name: change.name, slug, kind: change.classKind, build, propChanges: [] });
      } else if (change.classKind === "changed" || change.propChanges.length > 0) {
        const entry: SiteClassChange = { name: change.name, slug, kind: "changed", build, propChanges: change.propChanges.sort(byName) };
        if (change.baseChange) entry.baseChange = change.baseChange;
        list.push(entry);
      }
    }
    if (list.length > 0) changesByBuild.set(build, list.sort(byName));
  }

  // Group builds by patch, dropping the first tracked build; iterating builds
  // in order keeps each patch's groups ascending even when patches interleave.
  const byPatch = new Map<string, SiteChangelogPatch>();
  for (const build of t.builds) {
    if (build === t.firstBuild) continue;
    const list = changesByBuild.get(build);
    if (!list) continue;
    const patch = t.patchOf(build);
    let patchLog = byPatch.get(patch);
    if (!patchLog) {
      patchLog = {
        patch,
        slug: patch.replace(/\./g, "-"),
        builds: [],
        counts: { added: 0, readded: 0, removed: 0, changed: 0 },
        buildGroups: [],
      };
      byPatch.set(patch, patchLog);
    }
    patchLog.builds.push(build);
    patchLog.buildGroups.push({ build, entries: list });
    for (const c of list) patchLog.counts[c.kind]++;
  }
  return [...byPatch.values()].sort((a, b) => comparePatches(b.patch, a.patch));
}
