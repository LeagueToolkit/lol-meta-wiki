<div align="center">
  <a href="https://github.com/LeagueToolkit">
    <img src="https://avatars.githubusercontent.com/u/28510182?s=200&v=4" alt="LeagueToolkit logo" width="96" height="96">
  </a>
  <h1>lol-meta-wiki / site</h1>
</div>

The [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/) front end published
at [meta-wiki.leaguetoolkit.dev](https://meta-wiki.leaguetoolkit.dev/). It renders one page per meta
class - inheritance, properties, defaults, per-build history, and whatever documentation
contributors have written - from JSON generated at build time. **Components never read the raw meta
database; they consume the generated shape.** See the [repository README](../README.md) for the
project as a whole.

<div align="center">

**[Commands](#commands)** · **[How data gets here](#how-data-gets-here)** · **[Layout](#layout)** · **[Starlight overrides](#starlight-overrides)**

</div>

## Commands

Run these from the repository root (`pnpm dev` and `pnpm build` there proxy to this workspace), or
from `site/` directly:

```bash
pnpm dev       # dev server on http://localhost:4321
pnpm build     # production build into dist/
pnpm preview   # serve the built dist/ locally
```

You do not need to run the generator by hand: `integrations/generate-db.mjs` runs it for `dev`,
`build`, `sync` and `check` alike, before Astro reads the content collection, and `pnpm dev`
re-runs it whenever a source file changes (see below). Run `bun ../scripts/generate-db.ts`
yourself only when you want the output without an Astro command - before building the API worker,
for instance.

## How data gets here

```text
db/meta.db.json ─┐
db/docs/*.yaml ──┴─> scripts/generate-db.ts ─┬─> db-data/{classes,changelog}/*.json  (build-time reads)
                                             ├─> db-data/classGraph.json             (build-time reads)
                                             ├─> src/content/docs/{classes,changelog}/*.mdx  (pages)
                                             └─> public/db/*.json  (client-side reads)
```

**None of those three outputs is tracked in git** - not the JSON, and not the MDX pages either (the
hand-written `index.mdx` in each of the two directories is the only exception). They existed in the
repository once and only accumulated drift: nothing ever read them from git, while every DB bump
left them a patch behind. `integrations/generate-db.mjs` is what makes that safe - it runs the
generator from an awaited `astro:config:setup` hook, which fires for `dev`, `build`, `sync` and
`check`, so the pages are on disk before Astro globs the content collection, and a generator
failure takes the command down instead of quietly building a site of ~80 pages. There is no
`prebuild` script; one owner of generation beats two.

`scripts/generate-db.ts` at the repository root is the producer; everything in `site/` is a
consumer. The flow is one-way, and the shapes both sides agree on live in `src/types.ts` - the
generator imports them, so the producer cannot drift from the consumer.

The generator only rewrites files whose content changed, so re-running it does not churn Astro's
watcher. On top of the startup run, the dev server watches `db/meta.db.json` and `db/docs/*.yaml`
and re-runs it (debounced) on any change, so editing a documentation YAML refreshes the page you
are looking at.

Two placement rules matter, and both exist for build cost:

- **`db-data/` sits outside `public/`.** Components read it with `fs.readFileSync` at build time
  using `root` from `astro:config/server`. Copying 5,000+ JSON files into `dist/` on every build was
  a major cost. Only data the browser actually fetches belongs in `public/db/`.
- **Parse a shared index once at module scope**, as `utils/classIndex.ts` and `utils/classGraph.ts`
  do. Re-reading a large index per page multiplies across ~5,300 pages.

A shared index is also the answer to graph-wide facts. A class page shows its *siblings* - the other
subclasses of its bases - and marks every class in its tree that the game no longer ships; both are
facts about the whole graph, so they live in one `db-data/classGraph.json` instead of being copied
into 5,300 class files (~105k duplicated names, and one new subclass would rewrite every file in its
family).

## Layout

```text
src/components/           page-entry components (ClassDetails, PatchChangelog, ...)
src/components/changelog/ the changelog's section and card parts
src/components/icons/     extracted inline SVGs
src/components/starlight/ overrides of Starlight's own components
src/content/docs/         hand-written guides and API docs, plus the generated (untracked)
                          classes/ and changelog/ pages - see "How data gets here"
src/types.ts              the generator <-> component contract
src/utils/                type linking, markdown rendering, default formatting, mermaid
src/styles/               global.css (Tailwind v4 theme tokens) + custom.css (shared rule sets)
integrations/             the generate-db hook that every Astro command runs
db-data/                  generated, build-time only, not shipped
public/db/                generated, fetched by the browser
```

## Starlight overrides

The components in `src/components/starlight/` replace Starlight's own, configured in
`astro.config.mjs`. The ones worth knowing about:

- **`ResizableSidebar.astro`** - adds the drag-to-resize handle, and renders the Classes group
  **client-side** from `/db/classSidebar.json`. This is the important one: putting ~5,300 class links
  into the static sidebar meant every HTML file carried them, at roughly 850 KB per page and a 4.3 GB
  `dist/`. Do not move that group back into the `sidebar` config in `astro.config.mjs`.
- **`Search.astro`** - Starlight's search with `highlightParam` enabled, so results link with
  `?highlight=<term>` and the term is highlighted on arrival. The `/pagefind/` bundle only exists in
  production builds, so the highlight script is guarded and silently skipped in dev.
- **`PageTitle.astro`** - class page titles.
- **`EditLink.astro`** - "Edit page" would point at a generated stub that is not in the repository.
  Class routes link to `db/docs/<ClassName>.yaml` instead (the same edit-or-create flow as the "Add
  documentation" buttons); changelog patch routes are derived from `meta.db.json` alone and get no
  link at all. Every other route keeps Starlight's own `editUrl`.

## The 404 page

`src/content/docs/404.mdx` overrides Starlight's built-in 404 route, which is what GitHub Pages
serves for every unknown path. Besides the recovery links, `components/NotFound.astro` rescues class
lookups: a class page exists only under its display name, so `/classes/<x>` 404s whenever `<x>` is
another spelling of the same class - its hash once the name has been resolved from the hash tables,
a padded or unprefixed hash, or the name in the wrong case. The script canonicalizes the segment
(`utils/classHash.ts`), looks it up in `/db/classHashes.json`, and redirects to the real page,
carrying the query and anchor along. Anything it cannot resolve falls back to the plain 404 text.

## Conventions

Component architecture, prop typing, and styling rules are in [CLAUDE.md](../CLAUDE.md) at the
repository root. They apply to humans too. The short version:

- Page-entry component → section → per-item card. A component past ~150 lines of markup and logic
  wants splitting.
- Every component declares `interface Props`. Shared shapes go in `src/types.ts`, declared once.
- Scoped `<style>` by default. Share *values* through tokens in `global.css` / `custom.css`, and
  rule sets through a co-located feature stylesheet - not by copying hex or reaching for `:global`.
- Extract inline SVGs into `components/icons/`.
- 2-space indent, LF, per `.editorconfig`. No Prettier is wired up; match the file you are editing.

Before calling a change done, `pnpm build` must pass with no errors and the expected page count.

## Deployment

`.github/workflows/deploy.yml` builds this workspace and publishes `dist/` to GitHub Pages on every
push to `main`, in parallel with the API worker deploy. The custom domain comes from
`public/CNAME`, and `site` in `astro.config.mjs` must match it - `api/scripts/build-assets.ts` uses
the same URL to build absolute wiki links for `/v1/index`.
