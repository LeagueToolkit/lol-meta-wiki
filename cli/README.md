<div align="center">
  <a href="https://github.com/LeagueToolkit">
    <img src="https://avatars.githubusercontent.com/u/28510182?s=200&v=4" alt="LeagueToolkit logo" width="96" height="96">
  </a>
  <h1>rito-meta</h1>
</div>

A command-line client for the [LoL Meta Wiki API](https://meta-wiki.leaguetoolkit.dev/api/),
published as `@leaguetoolkit/meta-cli`. It answers the questions every consumer of the API used to
answer by hand - what type a property has at a given build, which class a hash is, which properties
changed type between two patches - and it tells "the database says this is wrong" apart from "the
database says nothing" with distinct exit codes, so a script never reads silence as approval.

```sh
npx @leaguetoolkit/meta-cli property VfxEmitterDefinitionData.primitive --at 16.17
```

It runs on Node 22 or newer with no runtime dependencies, prints JSON on a pipe and a table on a
terminal, and can run fully offline from a downloaded database.

<div align="center">

**[Commands](#commands)** · **[Exit codes](#exit-codes)** · **[Output](#output)** · **[Offline runs](#offline-runs)** · **[Development](#development)**

</div>

## Install

```sh
npm install -g @leaguetoolkit/meta-cli   # rito-meta on your PATH
npx @leaguetoolkit/meta-cli --help       # or run it without installing
```

The package major tracks the API major: `1.x` speaks `/v1`.

## Commands

| Command                                | Answers                                               |
| -------------------------------------- | ----------------------------------------------------- |
| `rito-meta property <Class>.<field>`   | What type this property is, at `--at`                 |
| `rito-meta class <nameOrHash>`         | Hash, flags, bases, lifetime, properties              |
| `rito-meta hash <hashOrName>`          | Name to hash and back, plus the wiki URL              |
| `rito-meta search <pattern>`           | Find a class by substring or glob (`Vfx*Emitter*`)    |
| `rito-meta diff <from> <to>`           | Every property whose type changed in `(from, to]`     |
| `rito-meta changelog [patch]`          | The patch index, or one patch in full                 |
| `rito-meta versions`                   | The patch to build map, and the newest build covered  |
| `rito-meta docs <nameOrHash>\|all`     | The CC BY-SA prose for one class, or all of it        |
| `rito-meta db fetch\|check <path>`     | Download the raw database, or compare generations     |
| `rito-meta raw <path>`                 | Any endpoint, verbatim (`raw /v1/openapi`)            |

A class or a property can be given as a name or as a hash in any spelling, and `<Class>.<field>` is
one token so a finding can be pasted straight in: `0x9a4b299d.0x0329f1d7` works. `<from>`, `<to>`,
`[patch]` and `--at` all accept a build number (`8104348`) or a patch (`16.17`), and every answer
names both.

`property` looks the class up with inherited properties included, so a field defined on an ancestor
still answers, and the payload names the defining class when it differs.

### Flags

| Flag                 | Effect                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| `--at <build\|patch>` | Answer as of this build or patch (`property`, `class`); default: latest   |
| `--db <path>`        | Answer from a downloaded database instead of the network                  |
| `--json`             | Force JSON output (the default when stdout is not a terminal)             |
| `--no-color`         | Plain text, no ANSI colors (`NO_COLOR` is honored too)                    |
| `--cache-dir <dir>`  | Where to keep ETag-validated responses (or `RITO_META_CACHE_DIR`)         |
| `--no-cache`         | Skip the response cache for this run                                      |
| `--api <base-url>`   | API base URL (or `RITO_META_API`); default `https://meta-api.leaguetoolkit.dev` |
| `--inherited`        | `class`: the flattened view, each property stamped with its defining class |
| `--tree`             | `class`: include the descendant tree                                      |

## Exit codes

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 0    | Answered                                                                 |
| 1    | Error: network, bad arguments, unreadable `--db`                         |
| 2    | No such class (or hash)                                                  |
| 3    | Class known, property not described (`docs`: class known, no prose)      |
| 4    | Class or property known, but no revision covers `--at`                   |
| 5    | Build or patch outside the dataset's window (`db check`: local copy is stale) |

A non-zero code that is not 1 still prints a well-formed payload on stdout whose `outcome` names
the case (`no-such-class`, `no-such-property`, `not-documented`, `not-at-build`, `no-changelog`,
`outside-window`, `stale`), so a caller can branch on the code and log the detail:

```sh
rito-meta property SomeClass.someField --at 16.17 > answer.json
case $? in
  0) jq .type answer.json ;;
  3) echo "not described - do not treat as approval" ;;
  4) echo "not at that build - see .history in answer.json" ;;
esac
```

## Output

On a pipe the output is JSON; on a terminal it is an aligned table. Every JSON payload carries the
same envelope, so any captured output is attributable to a database state:

```json
{
  "outcome": "ok",
  "api": "v1",
  "generation": "2026-08-24T03:56:00Z",
  "source": "https://meta-api.leaguetoolkit.dev",
  "class": { "name": "0x13f50786", "hash": "0x13f50786" },
  "property": { "name": "imagePath", "hash": "0xf511a169" },
  "at": { "build": 8104348, "patch": "16.17" },
  "type": { "name": "File", "tag": 18 },
  "since": "16.17",
  "until": null,
  "defaultValue": "\"0x0\"",
  "history": [
    { "since": "15.24", "until": "16.16", "type": { "name": "String", "tag": 16 }, "defaultValue": "\"\"" },
    { "since": "16.17", "until": null, "type": { "name": "File", "tag": 18 }, "defaultValue": "\"0x0\"" }
  ]
}
```

- `generation` is the publisher's `dataset.fetchedAt`; `api` is the API version the data is shaped
  as.
- A type is always `{ name, tag, size?, key?, value?, keyHash? }`, whether it came from a class
  detail or a changelog: `name` is the API's own name, `tag` the number the bin format writes,
  `size` the fixed length of a sized `List`, `key`/`value` the aux types of a container or `Map`,
  and `keyHash` the linked class as `{ hash, name, kind }`. The tool carries no library's vocabulary
  for these tags; mapping tag 18 onto a crate's type name is the consumer's job.
- A build-dated answer always carries `{ build, patch }`. Asked with a patch, it answers as the
  patch ended (its last build); asked with a build the dataset never observed, it answers as of the
  nearest earlier one and adds `requestedBuild`.
- Answers are patch-granular, because the published history is: a build inside a multi-build patch
  answers as the patch does.

`raw` is the exception: it prints the endpoint body verbatim with no envelope, and its exit code
mirrors the status (0 for 2xx, 2 for 404, 1 otherwise).

## Offline runs

```sh
rito-meta db fetch pinned.json                          # ~3.5 MB, the raw /v1/db
rito-meta db check pinned.json                          # exit 5 when the published generation moved on
rito-meta property SomeClass.someField --db pinned.json # no network at all
```

With `--db`, every read command except `docs` answers from the file: the raw database is turned into
the API's shapes by the same resolver and transforms the Worker is built with, so an offline answer
and an online answer for the same database are identical (the test suite asserts it). `docs` needs
the network because the prose is not part of `/v1/db`.

`db check` fetches only `/v1` (about 1 KB) and compares its `dataset.fetchedAt` and latest build
against the file. A CI job can pin a database and refresh it only when it is stale:

```sh
rito-meta db check pinned.json || rito-meta db fetch pinned.json
```

## Caching

Responses are cached on disk and revalidated with `If-None-Match` against the API's ETags on every
run, so a repeated question costs one small conditional request. The cache lives in
`--cache-dir`, else `$RITO_META_CACHE_DIR`, else the platform's per-user cache directory
(`~/.cache/rito-meta`, `~/Library/Caches/rito-meta`, `%LOCALAPPDATA%\rito-meta\cache`).
`--no-cache` skips it; `/v1/db` is never cached.

## Licensing

Everything but `docs` serves factual data with no documentation-license obligations. `docs` is the
one command that serves the community-written prose, licensed CC BY-SA 4.0 with the League Toolkit
Developer Tooling Exception; its payload carries `"license": "CC BY-SA 4.0"`. See
[Licensing](https://meta-wiki.leaguetoolkit.dev/api/licensing/) before you redistribute it.

## Development

From `cli/`, or from the repository root via `pnpm cli:check`:

```sh
bun run generate    # api/openapi.json -> src/generated/api.ts (gitignored)
bun run typecheck   # generate, then tsc --noEmit
bun test            # the suite, against recorded fixtures; no network
bun run build       # dist/rito-meta.js, one shebanged file for Node 22+
bun run smoke       # run that bundle under Node against a fixture HTTP server
bun run check       # all of the above
```

Source and tests run under Bun; the shipped bundle runs under Node. The smoke test exists so a
Bun-only construct cannot pass green.

**What it is built from.** Request and response types are generated from `api/openapi.json`, so a
Worker change breaks this build rather than a user. Hash canonicalization and name resolution come
from `api/scripts/lib/resolver.ts`, and the offline path reuses `api/scripts/lib/transform.ts`. The
only knowledge the CLI carries on its own is the type tag table in `src/tags.ts` - review it if the
bin format ever grows a type - and the raw-database derivations in `src/derive.ts`, which mirror
`scripts/generate-db.ts` and are checked against recorded API responses.

**Tests.** One seam: `run(argv, io)` in `src/main.ts` takes an argv array and an injected fetch and
returns stdout, stderr and an exit code. Every test drives that; none hits the network. Fixtures are
recorded API responses under `test/fixtures/`, trimmed to the classes the tests name; re-record with
`bun scripts/record-fixtures.ts` when the dataset or the contract changes.

**Publishing.** `.github/workflows/cli-publish.yml` publishes on a `meta-cli-v<version>` tag after
checking that the tag matches `package.json` and that the package major matches the API major.
