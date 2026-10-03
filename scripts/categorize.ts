/**
 * Class categoriser: places every class in exactly one domain.
 *
 * Domains are authored in db/categories.yaml; everything else is derived. A
 * class takes its domain from the first rule that applies:
 *
 *   1. pin     - `pins:` names the class
 *   2. seed    - the nearest ancestor (or the class itself) is a domain root
 *   3. prefix  - the family root's name starts with a domain prefix
 *   4. usage   - every class using its family has a domain, and they agree
 *   5. shared  - the classes using its family span two or more domains
 *   6. none    - uncategorized
 *
 * A *family* is the topmost ancestor on a class's primary (first known) base
 * chain plus everything deriving from it. Rules 3-6 are decided once per
 * family, for the members rules 1-2 left unplaced.
 *
 * Pure: no file access, so it is testable (categorize.test.ts) and the same
 * answer comes out for the same input in any order.
 */

import {
  SHARED_DOMAIN,
  UNCATEGORIZED_DOMAIN,
  type ClassCategory,
} from "../site/src/types";

// --- config ---

export interface DomainConfig {
  id: string;
  title: string;
  description: string;
  unreleased: boolean;
  /** Seed classes, already resolved to display names. */
  roots: string[];
  prefixes: string[];
}

export interface CategoryConfig {
  /** Display order: file order, with unreleased domains moved to the end. */
  domains: DomainConfig[];
  /** Class display name → domain id. */
  pins: Map<string, string>;
}

export interface ParsedCategoryConfig {
  config: CategoryConfig;
  /** Mistakes in the file itself - always fatal. */
  errors: string[];
  /** References to classes the db does not have - fatal only under --strict. */
  warnings: string[];
}

const RESERVED_IDS = new Set([SHARED_DOMAIN, UNCATEGORIZED_DOMAIN]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const stringList = (v: unknown): string[] | null =>
  v === undefined
    ? []
    : Array.isArray(v) && v.every((x) => typeof x === "string")
      ? (v as string[])
      : null;

/**
 * Validate the parsed YAML and resolve its class references.
 *
 * `resolve` maps a reference (a class name or a `0x` hash) to the class's
 * display name, or undefined when the db has no such class. An unresolved
 * reference is only a warning: the db refreshes on its own schedule, and a
 * class renamed upstream must not take the deploy down with it.
 */
export function parseCategoryConfig(
  raw: unknown,
  resolve: (ref: string) => string | undefined
): ParsedCategoryConfig {
  const errors: string[] = [];
  const warnings: string[] = [];
  const domains: DomainConfig[] = [];
  const pins = new Map<string, string>();

  const root = isRecord(raw) ? raw : {};
  if (!isRecord(root.domains)) {
    errors.push("`domains` must be a mapping of domain id to its definition");
    return { config: { domains, pins }, errors, warnings };
  }

  const rootOwner = new Map<string, string>();
  const prefixOwner = new Map<string, string>();
  for (const [id, def] of Object.entries(root.domains)) {
    if (RESERVED_IDS.has(id)) {
      errors.push(`domain id "${id}" is reserved`);
      continue;
    }
    if (!isRecord(def) || typeof def.title !== "string" || !def.title) {
      errors.push(`domain "${id}" needs a title`);
      continue;
    }
    const rootRefs = stringList(def.roots);
    const prefixes = stringList(def.prefixes);
    if (!rootRefs || !prefixes) {
      errors.push(`domain "${id}": roots and prefixes must be lists of strings`);
      continue;
    }

    const roots: string[] = [];
    for (const ref of rootRefs) {
      const name = resolve(ref);
      if (!name) {
        warnings.push(`domain "${id}": root "${ref}" is not a class in the db`);
        continue;
      }
      const owner = rootOwner.get(name);
      if (owner) {
        errors.push(`"${ref}" is a root of both "${owner}" and "${id}"`);
        continue;
      }
      rootOwner.set(name, id);
      roots.push(name);
    }
    for (const prefix of prefixes) {
      const owner = prefixOwner.get(prefix);
      if (owner) errors.push(`prefix "${prefix}" is listed under both "${owner}" and "${id}"`);
      prefixOwner.set(prefix, id);
    }

    domains.push({
      id,
      title: def.title,
      description: typeof def.description === "string" ? def.description : "",
      unreleased: def.unreleased === true,
      roots,
      prefixes,
    });
  }

  if (root.pins !== undefined && !isRecord(root.pins)) {
    errors.push("`pins` must be a mapping of class to domain id");
  } else {
    const known = new Set(domains.map((d) => d.id));
    for (const [ref, id] of Object.entries(root.pins ?? {})) {
      if (typeof id !== "string" || !known.has(id)) {
        errors.push(`pin "${ref}" names an unknown domain "${id}"`);
        continue;
      }
      const name = resolve(ref);
      if (!name) {
        warnings.push(`pin "${ref}" is not a class in the db`);
        continue;
      }
      pins.set(name, id);
    }
  }

  // Stable: file order survives within each half.
  domains.sort((a, b) => Number(a.unreleased) - Number(b.unreleased));
  return { config: { domains, pins }, errors, warnings };
}

// --- categoriser ---

export interface CategorizeClass {
  name: string;
  /** Primary base: the first of the class's bases that is itself a class. */
  base?: string;
  removed: boolean;
}

/** `user` has a property whose type names `used`. */
export interface UsageEdge {
  user: string;
  used: string;
  /** Both the using class and the property are in the latest game build. */
  live: boolean;
}

const isHashName = (name: string) => /^0x[0-9a-f]+$/i.test(name);

export function categorize(
  classes: CategorizeClass[],
  edges: UsageEdge[],
  config: CategoryConfig
): Map<string, ClassCategory> {
  const byName = new Map(classes.map((c) => [c.name, c]));
  const domainOrder = new Map(config.domains.map((d, i) => [d.id, i]));

  const seedDomain = new Map<string, string>();
  const prefixes: [prefix: string, domain: string][] = [];
  for (const d of config.domains) {
    for (const r of d.roots) seedDomain.set(r, d.id);
    for (const p of d.prefixes) prefixes.push([p, d.id]);
  }
  // Longest first, so the first match is the most specific one.
  prefixes.sort((a, b) => b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));

  // One walk up the primary base chain answers both "which family" and "which
  // seed is nearest". `seen` guards a cyclic db.
  const familyOf = new Map<string, string>();
  const seededOf = new Map<string, string>();
  for (const c of classes) {
    let cur = c;
    let seed = seedDomain.get(cur.name);
    const seen = new Set([cur.name]);
    for (;;) {
      const base = cur.base !== undefined ? byName.get(cur.base) : undefined;
      if (!base || seen.has(base.name)) break;
      seen.add(base.name);
      cur = base;
      seed ??= seedDomain.get(cur.name);
    }
    familyOf.set(c.name, cur.name);
    if (seed) seededOf.set(c.name, seed);
  }

  const result = new Map<string, ClassCategory>();
  const place = (name: string, domain: string, via: ClassCategory["via"]) =>
    result.set(name, { domain, via, family: familyOf.get(name)! });

  // Rules 1-2 are per class; whatever they leave is decided per family.
  const liveFamilies = new Set<string>();
  const rest = new Map<string, string[]>();
  for (const c of classes) {
    const family = familyOf.get(c.name)!;
    if (!c.removed) liveFamilies.add(family);
    const pin = config.pins.get(c.name);
    const seed = seededOf.get(c.name);
    if (pin) place(c.name, pin, "pin");
    else if (seed) place(c.name, seed, "seed");
    else {
      let members = rest.get(family);
      if (!members) rest.set(family, (members = []));
      members.push(c.name);
    }
  }

  // Who uses the unplaced part of each family, from outside the family. A
  // family still in the game is judged by its live users; one that is gone
  // has none, so it falls back to the users it had when it was last seen.
  const users = new Map<string, Set<string>>();
  for (const e of edges) {
    if (result.has(e.used)) continue;
    const family = familyOf.get(e.used);
    if (family === undefined || !familyOf.has(e.user)) continue;
    if (familyOf.get(e.user) === family) continue;
    if (liveFamilies.has(family) && !e.live) continue;
    let set = users.get(family);
    if (!set) users.set(family, (set = new Set()));
    set.add(e.user);
  }

  const pending = [...rest.keys()].sort();
  const placeFamily = (family: string, domain: string, via: ClassCategory["via"]) => {
    for (const name of rest.get(family)!) place(name, domain, via);
  };

  // Rule 3
  const afterPrefix: string[] = [];
  for (const family of pending) {
    const hit = isHashName(family)
      ? undefined
      : prefixes.find(([prefix]) => family.startsWith(prefix));
    if (hit) placeFamily(family, hit[1], "prefix");
    else afterPrefix.push(family);
  }

  // Rule 4, to a fixed point: placing one family can settle the ones it uses.
  // A family is only placed once *all* its users are, so the outcome does not
  // depend on the order families are visited in.
  let open = afterPrefix;
  for (let changed = true; changed; ) {
    changed = false;
    const still: string[] = [];
    for (const family of open) {
      const set = users.get(family);
      const domains = new Set<string | undefined>();
      for (const user of set ?? []) domains.add(result.get(user)?.domain);
      const [only] = domains;
      if (set && domains.size === 1 && only !== undefined) {
        placeFamily(family, only, "usage");
        changed = true;
      } else {
        still.push(family);
      }
    }
    open = still;
  }

  // Rules 5-6. Decided for every remaining family before any is written:
  // "shared" and "uncategorized" are not domains a user can vouch for.
  const leftovers = open.map((family) => {
    const domains = new Set<string>();
    for (const user of users.get(family) ?? []) {
      const domain = result.get(user)?.domain;
      if (domain !== undefined) domains.add(domain);
    }
    return { family, domains };
  });
  for (const { family, domains } of leftovers) {
    if (domains.size < 2) {
      placeFamily(family, UNCATEGORIZED_DOMAIN, "none");
      continue;
    }
    const usedByDomains = [...domains].sort(
      (a, b) => domainOrder.get(a)! - domainOrder.get(b)!
    );
    for (const name of rest.get(family)!) {
      result.set(name, { domain: SHARED_DOMAIN, via: "shared", family, usedByDomains });
    }
  }

  return result;
}
