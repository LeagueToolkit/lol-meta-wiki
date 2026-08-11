# Plan: Stop tracking generated MDX

`site/src/content/docs/{classes,changelog}/*.mdx` are emitted by
`scripts/generate-db.ts`, but unlike that script's other three outputs
(`site/db-data/`, `site/public/db/`, `api/src/generated/`) they are tracked in
git. Nothing reads them from git - `prebuild` regenerates before every build and
the dev integration regenerates on server start - so they only accumulate drift.

`update-db.yml` commits **only** `db/meta.db.json` and `deploy.yml` regenerates
in CI without committing back, so the tracked copies fall behind by one patch
per DB bump. The first local generator run after several bumps replays all of it
at once: commit `c5baebb3` carried 994 regenerated stubs (276 renames as hashes
resolved to names, 302 one-line content-hash changes, 74 property-anchor
changes, 58 changelog stubs) alongside 6 hand-edited files.

## Decisions (locked in)

- **Untrack the generated MDX.** `index.mdx` in both directories is hand-written
  and stays tracked; the generator already skips it when cleaning up.
- **Generation becomes part of the Astro pipeline, not a convention.** Today the
  tracked stubs are an accidental tripwire: with `db-data/` missing, the first
  class page throws `ENOENT` from `ClassDetails.astro` and the build dies.
  Untracked, that same skipped-generator scenario builds *successfully* with ~80
  pages. The integration must own generation so the failure cannot happen,
  rather than being caught by accident (see Risks).
- **The class page edit link moves to the docs YAML flow** instead of pointing
  at a stub that no longer exists in the repo. It is already wrong today: an
  edit made there is erased by the next generator run.
- **Rejected: regenerate and commit from `update-db.yml`.** It keeps the repo
  self-consistent, but pays with a ~1,000-file bot commit per patch, delete/modify
  conflicts for any branch carrying stub churn, and derived state in git that the
  repo otherwise refuses. It hides the churn rather than removing it.

## Phase 1 - Make generation a build prerequisite

- [x] `site/integrations/generate-db.mjs`: run the generator from an **awaited**
      `astro:config:setup` hook, which fires for `dev`, `build`, `sync`, and
      `check`, before the docs collection is globbed. Keep the watcher wiring in
      `astro:server:setup` (it should not re-run the initial generation).
- [x] Drop `prebuild` from `site/package.json` - the hook covers it, and one
      owner of generation beats two. `pnpm generate-db` at the repo root stays;
      the `deploy-api` job needs it to build the worker's assets.
- [x] Cost check: a no-op run is ~1.4s, so dev startup and build both absorb it.
- [x] Beyond the plan: the hook **throws** when the generator exits non-zero.
      Swallowing the failure (what the old dev-only hook did) would have
      reintroduced exactly the silent ~80-page build this phase exists to
      prevent. Watcher re-runs still only log.

Verified: with `db-data/`, `public/db/` and the stubs deleted,
`pnpm exec astro build` (no `prebuild`) produces 5,425 pages.

## Phase 2 - Untrack

- [x] `.gitignore`:
      ```gitignore
      # Generated Starlight pages (index.mdx in each dir is hand-written)
      site/src/content/docs/classes/*.mdx
      !site/src/content/docs/classes/index.mdx
      site/src/content/docs/changelog/*.mdx
      !site/src/content/docs/changelog/index.mdx
      ```
- [x] `git rm -r --cached site/src/content/docs/classes site/src/content/docs/changelog`,
      then re-add the two `index.mdx` files. One 5,412-file deletion commit.
- [ ] Land it when no open branch carries stub churn (see Risks: `enums`).
      **Still open**: `enums`, `api-v1`, `changelog` and `ci/notify-on-db-update`
      each carry ~5,964 stub diffs against `main`, not just `enums`. Only
      `class-canonical-redirects` is clean.

Verified: `git status` is clean immediately after a generator run, and
`git ls-files site/src/content/docs` is down to the 13 hand-written pages.

## Phase 3 - Edit link

- [x] Add `src/components/starlight/EditLink.astro`, registered in
      `astro.config.mjs` alongside the existing five overrides. For routes under
      `classes/`, resolve the slug back to the class display name (reverse map of
      `utils/classIndex.ts`, built once at module scope), check
      `db/docs/<Name>.yaml` with `fs.existsSync` the way `ClassDetails.astro`
      does, and link to `getDocUrl(name, docExists)` from `config/repo.ts` - the
      same edit-or-create flow the "Add documentation" button uses. Every other
      route falls through to `starlightRoute.editUrl`.
- [x] Label it for what it does ("Improve this page's docs"), since it now leads
      to the YAML rather than the page source.
- [x] Beyond the plan: **changelog patch pages have the same broken link** - they
      are generated stubs too, and there is no source behind them at all (they
      derive from `meta.db.json`). They now render no edit link. The generated-vs-
      hand-written test is `entry.filePath` (`src/content/docs/{classes,changelog}/
      <slug>.mdx`, `index.mdx` excepted), which is the exact string Starlight
      appends to `editLink.baseUrl`.

Verified in `dist/`: `classes/turret` → `/edit/main/db/docs/Turret.yaml`,
`classes/0x1003c990` → `/new/main/db/docs?filename=0x1003c990.yaml&…`,
`changelog/16-15` → no link, `changelog/` and `classes/` index pages → their own
`index.mdx`, `guides/example` → unchanged.

## Phase 4 - Guard the lost tripwire

- [x] `scripts/generate-db.ts`: assert the emitted page count equals
      `Object.keys(db.classes).length` and fail loudly otherwise. Cheap, and it
      catches a generator bug rather than a skipped run. Placed *before* the
      cleanup passes, which would otherwise delete the pages a partial run
      failed to claim.
- [x] `deploy.yml`: after the site build, fail if the count of
      `dist/classes/*/index.html` does not match `total` in
      `site/public/db/index.json`. This is the check that replaces the accidental
      `ENOENT`, and it is strictly better: it catches a *partial* generation too.

Verified locally: `find dist/classes -mindepth 2 -maxdepth 2 -name index.html`
counts 5,340, matching `total` in `public/db/index.json`.

## Phase 5 - Docs

- [x] `site/README.md`: the data-flow diagram and the `Layout` block both imply
      the MDX is part of the repo; mark it generated-not-tracked, and note that
      the Astro integration guarantees it exists. Also documents the new
      `EditLink` override.
- [x] `CLAUDE.md`: "Verify before you call it done" should point at the page-count
      guard rather than at eyeballing the build output.
- [x] `CONTRIBUTING.md` line 153 documents `pnpm generate-db` for contributors -
      confirm it still reads correctly once the hook makes it optional. It read
      as a required step, so the step is gone and `pnpm dev` says it generates.
- [x] The root `README.md` also credited `prebuild` for build-time generation.

## Risks

- **The tripwire, quantified.** Verified: with `site/db-data/classes` moved
  aside, the build fails at `/classes/0x1003c990` with `ENOENT` from
  `ClassDetails.astro`'s `readFileSync`. After untracking, a skipped generator
  yields a green build of the ~80 hand-written pages. Phases 1 and 4 are what
  make untracking safe; do not land Phase 2 without them.
- **Four branches carry stub churn, not one.** Measured against the current
  `main`: `enums`, `api-v1`, `changelog` and `ci/notify-on-db-update` each differ
  in ~5,964 stub files; only `class-canonical-redirects` is clean. Rebasing any of
  them across the untrack commit produces that many delete/modify conflicts.
  Either merge them first, or resolve in one step:
  `git diff --name-only --diff-filter=U | xargs git rm` followed by a generator
  run.
- **Pulling the untrack commit deletes those files from every working tree**
  (they were tracked, so checkout removes them). The next `pnpm dev` or build
  writes them back; a cold write of 5,340 files is slow on Windows.
- **Rollback** is a plain revert of the Phase 2 commit - the files return from
  history, and a generator run brings them up to date.
