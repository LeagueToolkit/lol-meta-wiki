# CLAUDE.md - LoL Meta Wiki

Engineering conventions for the **code** in this repo (the Astro site and the
build script). For documentation-content rules (the `db/docs/*.yaml` files) see
`CONTRIBUTING.md` - different audience, different rules.

## Layout in one breath

- `scripts/generate-db.ts` - Bun script. Reads `db/meta.db.json` and emits
  per-class + per-patch JSON (`site/db-data/…`, outside `public/`) and MDX stubs
  (`site/src/content/docs/…`). This is the **producer** of the site's data.
- `site/` - Astro + Starlight wiki. Components are the **consumers**: they read
  the generated JSON at build time and render it.
- `site/src/types.ts` - the shared data shapes both sides agree on.

Data flows one way: `meta.db.json → generate-db.ts → JSON/MDX → components`.
Never fetch or transform the raw DB in a component; consume the generated shape.

---

## Component architecture

The reference hierarchy is `ClassDetails.astro → PropertiesSection.astro →
PropertyCard.astro`, mirrored by `PatchChangelog.astro → changelog/BuildGroup →
changelog/{ClassChipSection,ChangedClasses} → ChangedClassCard → PropChangeRow`.
Follow it:

1. **Page-entry components stay thin.** The component an MDX page imports should
   read its data, compute a little derived state, and delegate rendering to
   sub-components. If one is growing past ~150 lines of markup+logic, split it.
   (`PatchChangelog.astro` was 462 lines doing everything; that is the anti-pattern.)

2. **Split by responsibility: orchestrator → section → per-item card.** One
   component per meaningful unit (a section, a card, a row). A component that
   renders a list delegates each item to a dedicated child.

3. **Group a feature's leaf sub-components in a subdirectory**, like
   `components/changelog/`, `components/icons/`, `components/starlight/`. The
   page-entry component stays at `components/` root; its parts live in the subdir.

4. **One parameterized component beats near-duplicate ones.** `ClassChipSection`
   renders both the "New" and "Removed" sections via a `kind` prop instead of two
   copy-pasted components. If two blocks differ only by label/color/icon, unify them.

5. **Replace repeated conditional branches with a keyed lookup.** `PropChangeRow`
   picks its tag from a `{ added, readded, removed }` map rather than one JSX
   branch per kind. Reach for a lookup/config object when you see parallel `if`s.

6. **Extract inline SVGs to `components/icons/*.astro`.** Never leave a raw
   `<svg>` in component markup; import an icon component (`CirclePlusIcon`, etc.).

---

## Props & types

7. **Every component declares `interface Props`.** Don't destructure an untyped
   `Astro.props`. See `PropertiesSection.astro` for the shape.

8. **Shared data shapes live once, in `site/src/types.ts`.** That file is the
   generator↔component contract. `scripts/generate-db.ts` imports these types
   (type-only) so the producer can't drift from the consumer - do **not**
   redeclare a shape in both places. Add new generated fields to `types.ts` and
   import them where produced.

9. **Pass structured data as an object, not a positional argument list of
   same-typed values.** `typeDisplay(t, classIndex)` takes the tuple object;
   the old `typeDisplay(ft, vt, kt, kh, classIndex)` invited silent transposition
   (four strings, and the order didn't even match the field order). Any function
   taking 3+ same-typed args is a refactor target.

---

## Styling

10. **Scope styles per component by default.** Astro hashes each `<style>` block
    to its component, so scoped rules can't be shared. "Sharing" means either
    sharing *values* (tokens) or opting a rule out of scoping - pick by what
    you're actually sharing (next two rules).

11. **Share values with design tokens, never copied hex.** Foundational tokens
    live in `src/styles/global.css` (`@theme { --color-success, --color-error, … }`,
    Tailwind v4); Starlight's theme-aware palette (`--sl-color-*`) is also
    available. For a feature's semantic colors, alias them once and reference the
    alias from scoped styles - see the changelog's `--cl-added` / `--cl-changed` /
    `--cl-removed` (+ `-text` variants) in `src/styles/custom.css`. Don't repeat
    `var(--sl-color-green, #22c55e)` across components - that was the old smell.
    Same rule for any non-color value **repeated across a feature's components**
    (e.g. `--cl-border`, `--cl-summary-height`). But only lift *shared, semantic*
    values - leave incidental one-off sizings (`0.4rem`, `0.8125rem`) inline
    rather than minting a token per magic number, and don't snap off-scale values
    onto the `--spacing-*` / `--radius-*` scale in passing (that's a visual change,
    not a refactor).

12. **Share rule-sets through a global stylesheet, not `:global` by default.**
    Starlight already loads `src/styles/custom.css` + `global.css` (see
    `astro.config.mjs` → `customCss`); namespaced shared rules belong there, or
    in a co-located feature stylesheet imported by the components that need it
    (`import "./changelog.css"` - bundled once). Tailwind v4 utilities are also
    available for layout/color. Reserve `:global(.feature-root …)` in a parent
    for a *small* set of rules you deliberately want kept beside the orchestrator
    - it works (see `PatchChangelog.astro`), but it's the exception, not the rule.

13. **Indentation follows `.editorconfig`** (2-space, LF). No Prettier is wired
    up yet - match the file you're editing and the editorconfig.

---

## Build-time data reading

14. Components read generated JSON at build time via
    `fs.readFileSync(new URL("./db-data/…", root))` using `root` from
    `astro:config/server` (see `ClassDetails.astro` / `PatchChangelog.astro`).
    The `db-data/` tree lives **outside** `public/` on purpose - copying 5k+ JSON
    files into `dist/` every build was a major cost. Don't move generated JSON
    into `public/`, and don't re-read a large shared index per page: parse it once
    at module scope (see `utils/classIndex.ts`).

---

## Verify before you call it done

- `bun scripts/generate-db.ts` should be **idempotent** - a second run reports
  `0 changed, 0 deleted`. If it churns every file on a re-run, the output isn't
  deterministic; fix that before shipping.
- `pnpm --filter site build` must pass with no errors and the expected page count.
