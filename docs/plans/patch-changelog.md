# Plan: Patch Changelog pages

A new "Changelog" section on the wiki: one page per patch showing every meta-schema
change in that patch (new/removed classes, inheritance changes, property
added/removed/type-changed), each entry linking to the class page. Everything is
derived from `db/meta.db.json` revision boundaries - no changes to
`lol-meta-classes` are needed for v1.

## Decisions (locked in)

- **Page unit = patch**, aggregating its builds. When a patch has more than one
  build (hotfix dumps), the page shows per-build subsections so intra-patch churn
  (added then removed in the same patch) is never hidden.
- **The first tracked build (13.15 / 5229820) gets no page** - everything
  "appears" there; that's tracking-start noise, same reason `generate-db.ts`
  suppresses `since` for `firstBuild`.
- **Structure-only in v1.** Default-value changes are not per-patch recoverable
  from `meta.db.json` (a default-only tweak updates the open revision in place,
  keyed on the type tuple). Deferred to v2, which needs an additive
  `db_build.py` change in `lol-meta-classes`.
- **Renames never appear as changes** - everything is hash-keyed; a cracked hash
  improving a display name is not a diff. (Free, but worth stating.)

## Diff semantics (from revision boundaries)

For each consecutive build pair `B_prev → B_cur` (order taken from
`db.versions`, already sorted by build):

| Change | Detection |
|---|---|
| Class added | first revision has `from == B_cur` |
| Class re-added | a later revision has `from == B_cur` after a gap (previous revision's `to < B_prev`) |
| Class removed | revision covering `B_prev` has `to == B_prev` and no revision starts at `B_cur` |
| Class changed | one revision ends at `B_prev`, the next starts at `B_cur` → diff `bases` / `interface` / `value` |
| Property added / re-added / removed / type changed | same logic on property revisions; a type change renders old tuple → new tuple |

Presentation rules:

- A **new class** is one entry - do not also list all its properties as "added".
- A **removed class** is one entry - do not list its properties as "removed"
  (mirrors the existing `removedIn` suppression in `generate-db.ts`).
- A class appears under "Changed" if its own definition changed **or** any of its
  properties did.
- Hash-only names render as the raw hex (class pages exist for those, so links
  still work).

## Phase 1 - Data extraction (`scripts/generate-db.ts`)  ✅

- [x] Add output types: `ChangelogPatch { patch, builds[], summary counts, entries }`,
      `ClassChange { name, slug, kind: added|readded|removed|changed, build, baseChange?, propChanges[] }`,
      `PropChange { name, kind, build, oldType?, newType? }`. Types rendered with
      the same `(ft, kt, vt, kh)` display logic already used for `FieldTuple`
      (resolve `kh` via `nameOf`). - `buildGroups` carries entries grouped by build.
- [x] New function `buildChangelog(db: MetaDb): ChangelogPatch[]` - single pass
      over `db.classes`, filling an inverted index `build → changes` from
      revision boundaries per the table above, then grouping builds by patch
      (via `db.versions`) and dropping the first build. Newest-first ordering.
- [x] Emit per-patch JSON to `site/db-data/changelog/<slug>.<sha12>.json`
      (build-time only, outside `public/` - same pattern and reasoning as
      `site/db-data/classes/`). Slug: patch with dots → dashes (`16.13` → `16-13`).
- [x] Emit `site/db-data/changelog/index.json`: ordered list of
      `{ patch, slug, builds, counts }` for the index page.
- [x] Emit MDX stubs to `site/src/content/docs/changelog/<slug>.mdx` pointing at
      the JSON (mirror `generateMDX`). Frontmatter: `title: Patch 16.13`,
      `sidebar: { order: n }` with newest first (index page at 0, patches 1..N).
- [x] Extend the existing stale-file cleanup (MDX + hashed JSON deletion loops)
      to cover the changelog directories. New `--changelog-out` / `--changelog-mdx`
      CLI args (defaults match the dev integration); `site` prebuild passes them.

## Phase 2 - Components (wiki `site/`)  ✅

- [x] `src/components/PatchChangelog.astro` - reads its JSON at build time the
      same way `ClassDetails.astro` does (`astro:config/server` `root` +
      `fs.readFileSync`). Renders: summary line, "New classes", "Removed classes",
      "Changed classes" sections; per-build subheadings only when the patch has
      >1 build.
- [x] Links: class entries → `/classes/<slug>` via the existing `classIndex`
      util (with a `/classes/<slug>` fallback); property entries → the
      `#propertyname` anchors the class MDX generates (matched via a github-slug
      helper `anchorSlug` in generate-db).
- [x] `src/content/docs/changelog/index.mdx` + `ChangelogIndex.astro` reading
      `db-data/changelog/index.json`: table of all patches with change counts +
      a churn bar, newest first.
- [x] Changelog page bodies carry `data-pagefind-ignore` (the h1/title still
      indexes, so a patch is findable by name, but class/property names inside
      don't pollute search).

## Phase 3 - Navigation & cross-links  ✅

- [x] `astro.config.mjs`: added a `Changelog` sidebar group
      (`autogenerate: { directory: "changelog" }`) below Reference. Ordering is
      driven by `sidebar.order` (overview 0, patches newest-first).
- [x] `src/components/starlight/PageTitle.astro`: `since` / `removedIn` pills now
      link to `/changelog/<slug>/`. Verified all 774 `removedIn` and every
      `since` value map to an existing changelog page (no 404s).
- [~] Optional: link `PropertyCard.astro` type-history rows - **skipped on
      purpose.** A history row's `until` patch is where that type version *ended*,
      but the change is recorded on the *next* build's patch, so linking `until`
      would risk 404s. The class-title pills are the guaranteed-valid cross-link.

## Phase 4 - Verification  ✅

- [x] `bun scripts/generate-db.ts` - 69 patch pages; a no-op re-run wrote 0
      files (idempotent), confirming no dev reload loops.
- [x] Spot-checked the format-doc example: property `0xf0a363e3`
      (`ColorblindTexturePath`) `Option<String>` → `String` at build 6478644
      appears on the 15.1 page and nowhere else.
- [x] Spot-checked a removed class (`0x100b46be`, removed 16.5) and its title
      pill link; multi-build patch 16.9 (builds 7695709 + 7718383) renders
      per-build subheadings; `LoopBlock` base change `IScriptBlock` →
      `ILoopScriptBlock` at 14.1 renders with its `Sequence` prop removal.
- [x] `pnpm build` (run inside `site/`, the root workspace filter matches
      nothing) - 5355 pages (+70), no errors, and the changelog JSON stays out of
      `dist/` (`db-data/` is outside `public/`).

## Phase 5 - v2: default-value changes (in `lol-meta-classes`, later)

- [ ] Extend `scripts/db_build.py` additively: record default history inside a
      property revision (e.g. `defaults: [{ "from": build, "value": ... }]`).
      The format doc explicitly allows additive fields without a
      `formatVersion` bump; consumers ignore unknown keys.
- [ ] Regenerate `db/meta.db.json`, `pnpm update-db` in the wiki, surface
      "default changed X → Y" entries in the changelog.

## Ideas parked for later

- Atom/RSS feed generated from the same changelog data so modders can subscribe.
- Churn sparkline on the changelog index.
