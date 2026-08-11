<div align="center">
  <a href="https://github.com/LeagueToolkit">
    <img src="https://avatars.githubusercontent.com/u/28510182?s=200&v=4" alt="LeagueToolkit logo" width="96" height="96">
  </a>
  <h1>lol-meta-wiki</h1>
</div>

[![Deploy](https://github.com/LeagueToolkit/lol-meta-wiki/actions/workflows/deploy.yml/badge.svg)](https://github.com/LeagueToolkit/lol-meta-wiki/actions/workflows/deploy.yml)
[![Update Meta DB](https://github.com/LeagueToolkit/lol-meta-wiki/actions/workflows/update-db.yml/badge.svg)](https://github.com/LeagueToolkit/lol-meta-wiki/actions/workflows/update-db.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Browsable documentation for the League of Legends meta (`.bin`) classes and properties, live at
[meta-wiki.leaguetoolkit.dev](https://meta-wiki.leaguetoolkit.dev/). The structure - 5,000+ classes,
their inheritance, property types and defaults, and what changed each patch - is generated from
[lol-meta-classes](https://github.com/LeagueToolkit/lol-meta-classes) and refreshes itself when a new
patch is dumped. **What each class and property actually means is written by hand, by contributors,
in YAML files in this repo.** The same dataset is served as a public JSON API.

<div align="center">

**[Contributing documentation](#contributing-documentation)** · **[Public API](#public-api)** · **[Development](#development)** · **[How it stays current](#how-it-stays-current)**

</div>

## Features

- **Class reference**: inheritance trees, own and inherited properties, types, defaults, and the
  builds each one existed in.
- **Patch changelog**: what was added, removed, or changed type per build.
- **Community documentation**: prose, examples, and notes contributed as YAML and rendered as
  Markdown on the class pages.
- **Public JSON API**: the same data behind `/v1/*`, no key, permissive CORS.

## Contributing documentation

The structural data is dumped from the game and cannot be edited here. What you contribute is the
meaning: what a class represents, what a property does, what values are typical.

**From the site**: hit "Add documentation" on any class or property page. It opens GitHub's editor
on the right file, prefilled with a skeleton when none exists yet, and GitHub handles the
fork-and-PR flow for you.

**Locally**: create or edit `db/docs/<ClassName>.yaml`.

```yaml
# Turret Documentation

class:
  description: |
    Represents defensive **turret structures** on Summoner's Rift and other maps.
  examples:
    - "Outer turrets with plating in early game"
  notes:
    - "Turrets gain armor and magic resist based on nearby enemy champions"

properties:
  mMaxHealth:
    description: |
      The **maximum health points** of the turret.
```

The filename must match the class name exactly - that is how the file is found. Property keys are
matched case-insensitively, so docs written against an older PascalCase field name keep applying
after a hashtable rename. Every `description` supports Markdown, including links and lists; delete
any section you do not fill in.

Preview your change before opening the PR - the dev server watches `db/docs/` and regenerates on
save:

```bash
pnpm dev
```

- [CONTRIBUTING.md](CONTRIBUTING.md) - the full format, review process, and commit conventions.
- [db/docs/MARKDOWN_GUIDE.md](db/docs/MARKDOWN_GUIDE.md) - Markdown inside YAML, and the block
  scalar pitfalls.
- [db/docs/CONTENT_GUIDELINES.md](db/docs/CONTENT_GUIDELINES.md) - what is worth documenting and
  what to leave out.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`docs: add Turret
documentation`); commitlint runs on a Husky hook and rejects anything else.

## Public API

Read-only, no authentication, all `GET`, permissive CORS.

**Base URL**: `https://meta-api.leaguetoolkit.dev` (`https://api.meta-wiki.leaguetoolkit.dev` is an
alias serving identical responses).

```sh
# Dataset window, class and patch counts, and a map of every endpoint
curl https://meta-api.leaguetoolkit.dev/v1

# One class: bases, lifetime, ancestors/descendants, own properties
curl https://meta-api.leaguetoolkit.dev/v1/classes/VfxEmitterDefinitionData

# The same class flattened, with inherited properties stamped with their origin
curl "https://meta-api.leaguetoolkit.dev/v1/classes/VfxEmitterDefinitionData?inherited=1"

# Community-written prose for one class
curl https://meta-api.leaguetoolkit.dev/v1/docs/VfxEmitterDefinitionData
```

Classes resolve by exact name or by FNV-1a hash. `/v1/openapi` serves an OpenAPI 3.1 description of
every route and schema. Full reference: [the API docs](https://meta-wiki.leaguetoolkit.dev/api/).

**The license split is structural.** The facts endpoints (`/v1/classes*`, `/v1/changelog*`,
`/v1/hashes`, `/v1/index`, `/v1/versions`, `/v1/db`) serve factual metadata and carry no
documentation-license obligations. `/v1/docs*` is the only surface serving human-written prose, and
it is CC BY-SA 4.0 with a developer tooling exception - see
[Licensing](https://meta-wiki.leaguetoolkit.dev/api/licensing/) before you embed it.

## Repository layout

```text
db/meta.db.json    vendored dataset from lol-meta-classes; refreshed by CI, never edited by hand
db/docs/           the community documentation, one YAML file per class
scripts/           generate-db.ts (dataset -> site data + MDX), update-db.ts (pull upstream)
site/              the Astro + Starlight wiki, and the consumer of the generated data
api/               Cloudflare Worker serving the generated data under /v1/*
```

Data flows one way: `db/meta.db.json` → `generate-db.ts` → JSON and MDX under `site/` → components.
Nothing reads the raw database at request time.

## Development

You need [pnpm](https://pnpm.io/) and [Bun](https://bun.sh/).

```bash
git clone https://github.com/LeagueToolkit/lol-meta-wiki.git
cd lol-meta-wiki

pnpm install
bun install

pnpm dev           # http://localhost:4321
```

Every Astro command generates the site's data before it reads the content collection - the class and
changelog pages are generated, not tracked in git - and the dev server additionally re-runs the
generator whenever `db/meta.db.json` or a `db/docs/*.yaml` changes, so editing a documentation file
refreshes the page you are looking at.

```bash
pnpm generate-db   # run the generator on its own (the API build needs its output)
pnpm update-db     # pull the newest meta.db.json from lol-meta-classes
pnpm build         # production build into site/dist/
pnpm api:dev       # run the Worker locally (wrangler)
pnpm api:deploy    # deploy the Worker (needs a wrangler login)
```

Before calling a change done:

- `bun scripts/generate-db.ts` must be idempotent. A second run reports `0 changed, 0 deleted`; if it
  churns every file, the output is not deterministic and that is the bug.
- `pnpm --filter site build` must pass with no errors and the expected page count.

Engineering conventions for the site components - the orchestrator → section → card hierarchy,
typed props, design tokens - are in [CLAUDE.md](CLAUDE.md). They apply to humans too.

## How it stays current

Two workflows, no manual step between a new patch and a published page:

- **Update Meta DB** (`update-db.yml`) - runs on a `meta-db-updated` repository dispatch from
  `lol-meta-classes`, so a new patch lands within minutes of being dumped. It re-fetches
  `db/meta.db.json`, commits it if it moved, and explicitly starts a deploy. A weekly Sunday cron
  covers a missed or unauthenticated dispatch.
- **Deploy** (`deploy.yml`) - builds the Astro site to GitHub Pages and deploys the Worker in
  parallel, both from the same commit, so the site and the API never serve different data. Deploys
  are serialized so two quick merges cannot land an older dataset last.

## Contributing

Documentation contributions are the point of this repo - see
[Contributing documentation](#contributing-documentation) above. For code changes, the org-wide
[contributing guide](https://github.com/LeagueToolkit/.github/blob/main/CONTRIBUTING.md) applies.
Open an issue first for anything structural.

## License

The code in this repository is licensed under the AGPL-3.0 - see [LICENSE](LICENSE).

The community-written documentation under `db/docs/` is licensed separately, under CC BY-SA 4.0 with
the League Toolkit Developer Tooling Exception: developer tooling may embed the prose with
attribution alone, while republishing it as documentation stays under full BY-SA terms. Attribution
is "LoL Meta Wiki" with a link to [meta-wiki.leaguetoolkit.dev](https://meta-wiki.leaguetoolkit.dev).

## Acknowledgments

The class data comes from
[lol-meta-classes](https://github.com/LeagueToolkit/lol-meta-classes), which builds on the original
meta dumper by [moonshadow](https://github.com/moonshadow565):

- [lolmetadumper3](https://github.com/moonshadow565/lolmetadumper3)
- [lolmetadumper2](https://github.com/moonshadow565/lolmetadumper2)
- [LeagueToolkit/LeagueHashes](https://github.com/LeagueToolkit/LeagueHashes)

- [CommunityDragon](https://communitydragon.org/) for maintaining the hashtables that give these
  classes and properties their names.
- Everyone who has written a `db/docs/*.yaml` file. The structure is dumped; the meaning is not.

---

*The LoL Meta Wiki is an unofficial fan project and is not affiliated with, endorsed by, or
sponsored by Riot Games. League of Legends and its game data are the property of Riot Games, Inc.*
