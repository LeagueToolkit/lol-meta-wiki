/**
 * Client-side symbol search over symbols.json (emitted by
 * scripts/generate-db.ts), used by the Search modal override.
 *
 * Pagefind owns prose search; this covers identifiers, where Pagefind's
 * word/stem/prefix model falls short - it can't match the middle of a
 * compound name ("FollowMovement" → WallFollowMovement). Matching here is
 * case-insensitive substring plus camelCase awareness, ranked
 * exact > prefix > hump-boundary > substring > initials.
 */

import type { SymbolsIndex } from "../types";

export interface SymbolOwner {
  name: string;
  href: string;
}

export interface SymbolHit {
  kind: "class" | "prop";
  name: string;
  /** Class page href (classes only). */
  href: string | null;
  /** Owning classes (properties only). */
  owners: SymbolOwner[];
  /** Matched span in `name` for highlighting; start -1 = initials match. */
  start: number;
  len: number;
}

interface PreparedName {
  name: string;
  lower: string;
  /** First letter of each camelCase hump: "WallFollowMovement" → "wfm". */
  initials: string;
}

interface PreparedClass extends PreparedName {
  href: string;
}

interface PreparedProp extends PreparedName {
  owners: number[];
}

export interface PreparedIndex {
  classes: PreparedClass[];
  props: PreparedProp[];
  /** Raw class entries, for resolving property owner indices. */
  entries: SymbolsIndex["classes"];
}

/**
 * Heading anchor for a property on its class page. Must stay in sync with
 * anchorSlug() in scripts/generate-db.ts (github-slugger semantics; property
 * names are identifiers or raw hex, so this is almost always a lowercase).
 */
export function propAnchor(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "");
}

const isUpper = (ch: string) => ch >= "A" && ch <= "Z";

function initialsOf(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    if (i === 0 || isUpper(name[i]) || name[i - 1] === "_") out += name[i];
  }
  return out.toLowerCase();
}

function prepareName(name: string): PreparedName {
  return { name, lower: name.toLowerCase(), initials: initialsOf(name) };
}

export function prepareIndex(raw: SymbolsIndex): PreparedIndex {
  return {
    classes: raw.classes.map(([name, href]) => ({
      ...prepareName(name),
      href,
    })),
    props: raw.props.map(([name, owners]) => ({
      ...prepareName(name),
      owners,
    })),
    entries: raw.classes,
  };
}

/** True when the char at `i` starts a camelCase hump or snake_case segment. */
function isHumpStart(name: string, i: number): boolean {
  return isUpper(name[i]) || name[i - 1] === "_" || name[i - 1] === ".";
}

interface NameMatch {
  score: number;
  start: number;
  len: number;
}

function matchName(p: PreparedName, q: string): NameMatch | null {
  const idx = p.lower.indexOf(q);
  if (idx === -1) {
    // Fall back to hump initials ("wfm" → WallFollowMovement)
    if (p.initials.includes(q)) return { score: 15, start: -1, len: 0 };
    return null;
  }
  let score: number;
  if (p.lower.length === q.length) score = 100;
  else if (idx === 0) score = 80;
  else if (isHumpStart(p.name, idx)) score = 60 - Math.min(20, idx * 0.5);
  else score = 40 - Math.min(20, idx * 0.5);
  // Prefer shorter names when match quality ties
  score -= Math.min(10, (p.lower.length - q.length) * 0.15);
  return { score, start: idx, len: q.length };
}

interface ScoredHit extends NameMatch {
  kind: "class" | "prop";
  ref: PreparedClass | PreparedProp;
}

export interface SymbolSearchResult {
  hits: SymbolHit[];
  total: number;
}

export function searchSymbols(
  index: PreparedIndex,
  query: string,
  limit: number
): SymbolSearchResult {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { hits: [], total: 0 };
  const wantHash = q.startsWith("0x");

  const scored: ScoredHit[] = [];
  for (const c of index.classes) {
    const m = matchName(c, q);
    if (!m) continue;
    // Classes edge out equal-quality properties; unresolved 0x… names sink
    // unless the user is pasting a hash.
    let score = m.score + 8;
    if (!wantHash && c.lower.startsWith("0x")) score -= 100;
    scored.push({ ...m, score, kind: "class", ref: c });
  }
  for (const p of index.props) {
    const m = matchName(p, q);
    if (!m) continue;
    scored.push({ ...m, kind: "prop", ref: p });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.ref.name.length - b.ref.name.length ||
      (a.ref.name < b.ref.name ? -1 : 1)
  );

  const hits = scored.slice(0, limit).map((h): SymbolHit => {
    if (h.kind === "class") {
      const c = h.ref as PreparedClass;
      return {
        kind: "class",
        name: c.name,
        href: c.href,
        owners: [],
        start: h.start,
        len: h.len,
      };
    }
    const p = h.ref as PreparedProp;
    return {
      kind: "prop",
      name: p.name,
      href: null,
      owners: p.owners.map((i) => {
        const [name, href] = index.entries[i];
        return { name, href };
      }),
      start: h.start,
      len: h.len,
    };
  });

  return { hits, total: scored.length };
}
