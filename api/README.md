<div align="center">
  <a href="https://github.com/LeagueToolkit">
    <img src="https://avatars.githubusercontent.com/u/28510182?s=200&v=4" alt="LeagueToolkit logo" width="96" height="96">
  </a>
  <h1>lol-meta-wiki / api</h1>
</div>

The Cloudflare Worker behind [meta-api.leaguetoolkit.dev](https://meta-api.leaguetoolkit.dev/v1) -
the public, read-only JSON API over the wiki's dataset. **There is no runtime data layer: every
response is a static JSON asset built at deploy time**, and the Worker only maps clean `/v1/*` routes
onto that tree, resolves hashes to class names, and stamps CORS and caching headers. See the
[repository README](../README.md) for the project as a whole and
[the API docs](https://meta-wiki.leaguetoolkit.dev/api/) for the consumer-facing reference.

<div align="center">

**[Commands](#commands)** · **[How it is built](#how-it-is-built)** · **[Routing](#routing)** · **[Adding an endpoint](#adding-an-endpoint)**

</div>

## Commands

From `api/`, or from the repository root via the `api:` aliases:

```bash
pnpm build       # assemble dist/assets from the generated site data
pnpm dev         # build assets, then wrangler dev
pnpm deploy      # build assets, then wrangler deploy (needs a wrangler login)
pnpm typecheck   # tsc --noEmit
```

`bun ../scripts/generate-db.ts` must have run at the repository root first - this workspace only
repackages that output, and `build-assets.ts` exits with the missing input path if it has not.

Nothing here is committed: `dist/`, `.wrangler/`, and `src/generated/` are all generated and
gitignored. A fresh clone has no assets until you build.

## How it is built

`scripts/build-assets.ts` assembles `dist/assets/v1` from the site's generated data plus the raw
database:

```text
site/db-data/classes/*        ->  classes/, classes-inherited/, docs/   (prose split off)
site/db-data/changelog/*      ->  changelog/
site/public/db/classIndex.json ->  index.json                            (absolute wiki URLs)
site/public/db/categories.json ->  categories.json, classes-by-domain/   (one name list per domain)
db/meta.db.json               ->  db.json, hashes.json, versions.json
db/meta.pbe.json              ->  db-pbe.json
site/db-data/preview/classes/* ->  pbe/classes/, pbe/classes-inherited/  (only the files that differ)
openapi.json                  ->  openapi.json
(derived)                     ->  meta.json, src/generated/{hash-to-name,pbe-hash-to-name}.json
```

It is idempotent - re-running produces the same tree - and it wipes the output directory first, so a
stale class file cannot survive a rename.

The interesting work lives in `scripts/lib/`, and both files are pure:

- **`resolver.ts`** - canonicalization and name↔hash resolution. The database stores unpadded
  lowercase hex (`0x6516a`); the API always emits the canonical form, `0x` plus 8 zero-padded
  lowercase hex digits (`0x0006516a`).
- **`transform.ts`** - site shape → API shape: structured type references instead of display
  strings, `"0x0"` sentinels turned into `null`, site page anchors dropped, prose split out.

**Categories are repackaged, not recomputed.** The generator places every class in one domain
(`scripts/categorize.ts`, from `db/categories.yaml`) and writes the result into each class file and
into `categories.json`. The build copies `kind` and `category` onto the class, wraps the domain
list as `{ count, domains }`, and groups the class names by `category.domain` into
`classes-by-domain/{id}.json`. Every domain gets a list, empty or not, and a class whose domain is
missing from `categories.json` stops the build as stale site data.

**The PBE preview is a delta, not a second tree.** Every default response is live data. The
generator writes the merged-view class of each class that differs as of the PBE build
(`site/db-data/preview/classes/`), and the build writes a file under `pbe/` only if the API response
differs from the live one. The delta is a few hundred files per PBE build, which keeps the asset
count under the Workers limit of 20,000 files. Without a preview the
`pbe/` tree is empty and `preview` is `null` in `/v1`, `/v1/versions`, `/v1/hashes` and
`/v1/changelog`.

**Facts and prose are split on purpose.** Class endpoints carry unrestricted factual data; the
human-authored CC BY-SA prose is written only into the `docs/` tree, so a consumer that never calls
`/v1/docs*` never ingests licensed content. Keep that split when you touch `transform.ts` - see
[Licensing](https://meta-wiki.leaguetoolkit.dev/api/licensing/).

## Routing

`src/index.ts` is the whole router, and it is deliberately small.

- **Exact routes** come from the `EXACT` map (`/v1`, `/v1/openapi`, `/v1/classes`,
  `/v1/categories`, `/v1/hashes`, `/v1/index`, `/v1/versions`, `/v1/changelog`, `/v1/db`,
  `/v1/db/pbe`, `/v1/docs`). A trailing slash is tolerated on any route.
- **Parameterized routes** are `/v1/{classes,changelog,docs}/{segment}` and nothing else. The
  segment must match `[A-Za-z0-9._-]+`; rejecting anything else keeps traversal-shaped requests away
  from the asset binding.
- **Class routes are hash-first.** `/v1/classes/{x}` takes a resolved name (`AbilityObject`), a
  canonical hash (`0x0006516a`), or an unpadded or mixed-case one (`0x6516A`). Hex segments are
  canonicalized and mapped through `src/generated/hash-to-name.json`; unnamed classes stay under
  their hash. Names are exact and case-sensitive, which is what the 404 `hint` tells the caller.
- **`?inherited=1`** (or `true`) on a class route serves the precomputed flattened view from
  `classes-inherited/` instead, with each property stamped with the ancestor it came from.
- **`?domain={id}`** on `/v1/classes` serves that domain's name list from `classes-by-domain/`
  instead of the full one. It is a filter in the URL only: the list is precomputed like every other
  response. The id must pass the same `[A-Za-z0-9._-]+` check as a path segment, and an id with no
  list is a 404 whose `hint` points at `/v1/categories`.
- **`?channel=pbe`** on `/v1/classes` and `/v1/classes/{x}` serves the asset from the `pbe/` tree
  and falls back to the live asset if the tree has none, which is the case for every class that
  the PBE build leaves alone. It combines with `?inherited=1`. Hex segments are resolved through
  `src/generated/pbe-hash-to-name.json` first. `channel=live` is the default; any other value is a
  400. The parameter has no effect on the other routes.
- `OPTIONS` gets a 204 preflight; anything other than `GET`/`HEAD`/`OPTIONS` gets a 405 with an
  `Allow` header. Unroutable paths get a JSON 404 pointing back at `/v1`.

Every response carries `Access-Control-Allow-Origin: *` and
`Cache-Control: public, max-age=3600, stale-while-revalidate=86400`; errors are cached for 60
seconds instead. An hour of staleness is deliberate - the dataset only changes when a new patch is
deployed, and it keeps origin hits near zero.

## Adding an endpoint

Four places have to agree, or the API ships a route nobody can discover:

1. Emit the asset in `scripts/build-assets.ts` (and shape it in `scripts/lib/transform.ts`).
2. Map the route in `src/index.ts` - the `EXACT` table, or the parameterized branch.
3. Add it to `endpoints` in `writeMeta`, since `/v1` is the discovery surface.
4. Describe it in `openapi.json`, which is hand-maintained and copied verbatim to `/v1/openapi`.

Class names that would shadow a derived file (`index`, `all`) are reserved and throw at build time.

## Domains

Both hostnames are custom domains on the Worker and serve identical responses:

- `meta-api.leaguetoolkit.dev` - canonical, and what the OpenAPI document and docs advertise.
- `api.meta-wiki.leaguetoolkit.dev` - alias.

**The canonical name is kept one level under the zone on purpose.** Universal SSL only covers
`*.leaguetoolkit.dev`, and deeper names under `meta-wiki` inherit GitHub Pages' CAA policy through
the `meta-wiki` CNAME, which blocks Cloudflare's certificate issuance. Do not promote the deeper
alias to canonical.

## Deployment

`.github/workflows/deploy.yml` deploys this Worker on every push to `main`, in parallel with the
GitHub Pages build and from the same commit, so the API never serves a different dataset than the
site. It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

To deploy by hand: `bun ../scripts/generate-db.ts && pnpm deploy`.
