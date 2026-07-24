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

You do not need to run the generator by hand. `pnpm dev` regenerates on server start and again
whenever a source file changes (see below), and `pnpm build` runs it through the `prebuild` script.
Run `bun ../scripts/generate-db.ts` yourself only when you want the output without a server - before
building the API worker, for instance.

## How data gets here

```text
db/meta.db.json ─┐
db/docs/*.yaml ──┴─> scripts/generate-db.ts ─┬─> db-data/{classes,changelog}/*.json  (build-time reads)
                                             ├─> src/content/docs/{classes,changelog}/*.mdx  (pages)
                                             └─> public/db/*.json  (client-side reads)
```

`scripts/generate-db.ts` at the repository root is the producer; everything in `site/` is a
consumer. The flow is one-way, and the shapes both sides agree on live in `src/types.ts` - the
generator imports them, so the producer cannot drift from the consumer.

The generator only rewrites files whose content changed, so re-running it does not churn Astro's
watcher. `integrations/generate-db.mjs` hooks that into the dev server: it runs the generator on
startup, then watches `db/meta.db.json` and `db/docs/*.yaml` and re-runs it (debounced) on any
change, so editing a documentation YAML refreshes the page you are looking at.

Two placement rules matter, and both exist for build cost:

- **`db-data/` sits outside `public/`.** Components read it with `fs.readFileSync` at build time
  using `root` from `astro:config/server`. Copying 5,000+ JSON files into `dist/` on every build was
  a major cost. Only data the browser actually fetches belongs in `public/db/`.
- **Parse a shared index once at module scope**, as `utils/classIndex.ts` does. Re-reading a large
  index per page multiplies across ~5,300 pages.

## Layout

```text
src/components/           page-entry components (ClassDetails, PatchChangelog, ...)
src/components/changelog/ the changelog's section and card parts
src/components/icons/     extracted inline SVGs
src/components/starlight/ overrides of Starlight's own components
src/content/docs/         generated class + changelog MDX, and hand-written guides and API docs
src/types.ts              the generator <-> component contract
src/utils/                type linking, markdown rendering, default formatting, mermaid
src/styles/               global.css (Tailwind v4 theme tokens) + custom.css (shared rule sets)
integrations/             the dev-server generate-db hook
db-data/                  generated, build-time only, not shipped
public/db/                generated, fetched by the browser
```

## Starlight overrides

Three components in `src/components/starlight/` replace Starlight's own, configured in
`astro.config.mjs`:

- **`ResizableSidebar.astro`** - adds the drag-to-resize handle, and renders the Classes group
  **client-side** from `/db/classIndex.json`. This is the important one: putting ~5,300 class links
  into the static sidebar meant every HTML file carried them, at roughly 850 KB per page and a 4.3 GB
  `dist/`. Do not move that group back into the `sidebar` config in `astro.config.mjs`.
- **`Search.astro`** - Starlight's search with `highlightParam` enabled, so results link with
  `?highlight=<term>` and the term is highlighted on arrival. The `/pagefind/` bundle only exists in
  production builds, so the highlight script is guarded and silently skipped in dev.
- **`PageTitle.astro`** - class page titles.

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
