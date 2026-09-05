# Plan: meta CLI

A command-line client for `meta-api.leaguetoolkit.dev`, shipped from this repo as a third
workspace package beside `site` and `api`. It exists so consumers stop re-deriving the same
lookups by hand, and it is scoped to the **API** - it does not read, validate or reshape
`db/meta.db.json`, which stays the generator's business.

## Problem

Every consumer of the API repeats the same work, and repeats the same mistakes doing it.

- **Two keying schemes.** `/v1/classes/{nameOrHash}` dates a property's `history` in patch
  strings (`"16.16"`), `/v1/db` dates a revision in build numbers (`8104348`). A caller that
  wants "the type at build N" has to fetch `/v1/versions` and join, and a caller that guesses
  gets an off-by-one at a patch boundary.
- **Two payload shapes for one fact.** A class detail spells a type `ft`/`kt`/`vt`/`kh`, the raw
  database spells it as a positional array. Nothing tells a consumer they are the same thing.
- **Absence is ambiguous.** "No such class", "the class is known but has no such property", and
  "the property exists but no revision covers that build" are three different answers. Every
  consumer that flattens them into one will eventually read *I don't know* as *it is fine*.
- **Bulk when a byte would do.** `/v1/db` is ~3.5 MB. A consumer that only needs one property's
  type downloads all of it because that is the obvious entry point.

## Decisions (locked in)

- **A third workspace package, `cli/`.** Beside `site` and `api` in `pnpm-workspace.yaml`.
  Binary `rito-meta`, published as `@leaguetoolkit/meta-cli`.

- **It ships as a Node-runnable bundle.** Authored in TypeScript, developed with Bun like the
  rest of the repo, but built to a single shebanged JS file that runs on Node 22+ with no Bun
  and no runtime dependencies. The first real consumer is `ltk-manager`'s `scripts/*.mjs`, which
  is Node, and a tool that only runs under Bun is a tool that repo cannot call.

- **Request and response types are generated from `api/openapi.json`.** The contract already
  exists and lives in this repo, so the CLI is checked against it at build time and cannot drift
  from the Worker it talks to. Hand-written response interfaces are rejected.

- **Canonicalization reuses `api/scripts/lib/resolver.ts`.** That module already owns `0x` plus
  eight zero-padded lowercase hex digits, and name-to-hash resolution. The CLI imports it rather
  than reimplementing it. One home for the rule, or the two forms diverge.

- **Silence and disagreement get different exit codes.** See [Exit codes](#exit-codes). This is
  the decision the tool exists for: a script must be able to tell "the database says this is
  wrong" from "the database says nothing", without parsing prose.

- **Output is JSON on a pipe, a table on a TTY.** `--json` forces JSON, `--no-color` forces
  plain. One binary serves a person, an agent and a generator without a second mode to maintain.

- **`--at` accepts a build number or a patch string, and every answer names both.** The join
  through `/v1/versions` happens once, inside the tool. No caller converts.

- **`diff` is a projection over `/v1/changelog/{slug}`, not a walk over classes.** That endpoint
  already carries `propChanges` with `kind: "typechanged"`, `oldType` and `newType`, grouped by
  build. One request per patch replaces 5458.

- **Type tags are in scope, library vocabularies are not.** A type answer carries the API's own
  name (`File`) and the bin format's tag number (`18`), because the tag is what the format
  writes and is neutral between consumers. It does **not** carry any one library's identifiers
  for that type - `ltk_meta` calling tag 18 `WadChunkLink` is that crate's naming, and mapping
  from the tag is the consumer's job. Putting a Rust crate's vocabulary in this repo couples the
  API to a downstream release cycle.

- **A `raw` escape hatch.** `rito-meta raw /v1/anything` prints the endpoint verbatim, so a
  missing subcommand never blocks a consumer and never forces one back to hand-rolled fetches.

- **Rejected: an MCP server, for now.** The API is already agent-shaped - `/v1/classes/{name}` is
  ~1 KB and carries `history`. The value is in the derived layer, not the transport, and the
  tool surface should be learned from a CLI in use before it is frozen into MCP tool schemas.
  Wrapping this CLI later is a thin layer.

- **Rejected: a local mirror of the database.** `db fetch` writes `/v1/db` where a caller asks,
  and `--db <path>` reads it back. The CLI does not manage a database of its own.

## The surface

| Command                                | Answers                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `rito-meta property <Class>.<field>`   | What type this property is, at `--at`                |
| `rito-meta class <nameOrHash>`         | Hash, flags, bases, lifetime, properties             |
| `rito-meta hash <hashOrName>`          | Name to hash and back, plus the wiki URL             |
| `rito-meta search <pattern>`           | Find a class out of 5458 by substring or glob        |
| `rito-meta diff <fromPatch> <toPatch>` | Every property whose type changed across the span    |
| `rito-meta changelog [patch]`          | The patch index, or one patch in full                |
| `rito-meta versions`                   | The patch to build map, and the newest build covered |
| `rito-meta docs <nameOrHash>`          | The CC BY-SA prose for one class                     |
| `rito-meta db fetch\|check`            | Download the raw database, or compare generations    |
| `rito-meta raw <path>`                 | Any endpoint, verbatim                               |

`<Class>.<field>` is one token so a finding can be pasted straight in, and a hash is accepted on
either side: `0x9a4b299d.0x0329f1d7`.

Global flags: `--at <build|patch>`, `--db <path>` for offline and pinned runs, `--json`,
`--no-color`, `--cache-dir`, `--no-cache`, `--api <base-url>`.

`class` takes `--inherited` (the `?inherited=1` form) and `--tree` (descendants).

## Exit codes

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| 0    | Answered                                         |
| 2    | No such class                                    |
| 3    | Class known, property not described              |
| 4    | Property known, no revision covers that build    |
| 5    | Build or patch past the dataset's window         |
| 1    | Error: network, bad arguments, unreadable `--db` |

A non-zero code that is not 1 still prints a well-formed payload on stdout naming which case it
was, so a caller can branch on the code and log the detail.

## Output contract

- Every payload carries `generation` (the publisher's `dataset.fetchedAt`) and the API version,
  so any captured output is attributable to a database state.
- A type is always rendered as `{ name, tag, key?, value?, keyHash? }`. One shape, whether it
  came from a class detail or the changelog.
- A build-dated answer always carries `{ build, patch }`, never one of the two.

## User stories

1. As an agent editing bin-handling code, I want the expected type of one property at one build,
   so that I stop guessing from a 3.5 MB download.
2. As an agent, I want a hash resolved to a class name, so that I can read a finding that only
   carries `0x13f50786`.
3. As an agent, I want the reverse, so that I can key a lookup the way the format does.
4. As a script, I want a distinct exit code for "not described", so that I never treat absence as
   approval.
5. As a script, I want JSON on a pipe without passing a flag, so that piping is the default path.
6. As a person at a terminal, I want an aligned table, so that I can read the answer without `jq`.
7. As a generator author, I want every property whose type changed between two patches, so that I
   can emit a migration table instead of hand-authoring one.
8. As a generator author, I want the tool to omit any repair vocabulary, so that my own
   conversion rules stay mine.
9. As a CI job, I want to pin a downloaded database and run fully offline, so that a publisher
   outage cannot fail an unrelated build.
10. As a CI job, I want to compare the published generation against a pinned copy, so that I can
    detect a stale snapshot without downloading the body.
11. As a consumer of a new endpoint, I want a raw passthrough, so that a missing subcommand does
    not block me.
12. As a wiki reader, I want the page URL for a class, so that I can cite the documentation.
13. As a maintainer, I want the CLI's types generated from `openapi.json`, so that a Worker change
    breaks the build rather than a user.

## Phase 1 - Package and transport

- [x] `cli/` workspace package, `tsconfig.json`, build to a single shebanged bundle.
- [x] Types generated from `api/openapi.json` as a build step.
- [x] HTTP layer: base URL flag, conditional requests against the API's ETags, a cache directory
      under the platform cache location, `--no-cache`.
- [x] Output layer: TTY detection, table and JSON renderers, `generation` stamping.
- [x] `raw` and `versions`, which exercise the whole path with no derived logic.

## Phase 2 - Lookups

- [x] `class`, `hash`, `search`, `docs`, reusing `resolver.ts`.
- [x] `property`, including the `/v1/versions` join and the `history` walk.
- [x] The exit-code taxonomy, wired at the one place a lookup resolves.

## Phase 3 - Change queries

- [x] `changelog`.
- [x] `diff`, as a projection over one or more changelog payloads, filtered to `typechanged`.
- [x] Verify against a known row: `0x13f50786.imagePath` is `String` to `File` at build 8104348.

## Phase 4 - Offline

- [x] `db fetch` and `db check`.
- [x] `--db <path>`, serving every read command from a local database instead of the network.

## Phase 5 - Publish

- [x] npm publish workflow, version pinned to the API's major.
- [x] `cli/README.md`, and a page under the site's `/api/` docs.

## Testing

The repo has no tests today, so this introduces the first ones. `bun test` is the runner: Bun is
already a dependency and already runs the scripts, and a second toolchain would cost more than it
returns.

**One seam.** A single exported entry point takes an argv array and an injected fetch, and
returns stdout, stderr and an exit code. Every test drives that. No subprocess, no HTTP, no
mocking of internals - a test that reaches past this seam is testing an implementation detail and
should be deleted.

What gets covered:

- Each exit code, including all three shades of absence.
- The build and patch duality: the same question asked both ways returns the same answer.
- Output mode selection, and that a piped run is parseable JSON.
- `diff` against a recorded changelog fixture, asserting the known `imagePath` row.
- Canonicalization through `resolver.ts`, including unpadded input.

Fixtures are recorded API responses checked into `cli/test/fixtures/`, trimmed to the classes a
test names. No test hits the network.

**Risk carried by this choice:** tests run under Bun, the artifact runs under Node. A smoke test
in CI executes the built bundle with Node against a fixture server, so a Node-only break cannot
pass green.

## Out of scope

- Reading, validating or reshaping `db/meta.db.json`. That is `scripts/generate-db.ts`.
- Any write path. The API is read-only and so is this.
- Repair or conversion semantics. Naming how a `String` becomes a `File` is a consumer's domain,
  not the schema's.
- Mapping type names into any specific library's vocabulary.
- An MCP server. Revisit once the command surface has settled.
- Authentication, rate limiting, quotas. The API is public and unauthenticated.

## Risks

- **The tag table is the CLI's own.** The API does not emit tag numbers, so the CLI carries a
  static map of 27 entries. It is format truth and stable, but it is a second place that knows
  something, and it must be reviewed if the format ever adds a type.
- **`/v1/docs/all` and `/v1/docs/{nameOrHash}` collide on the literal name `all`.** The CLI must
  route `docs all` deliberately rather than by falling through.
- **Changelog payloads are large** - 16.17 is ~289 KB. `diff` across a wide span must stream or
  fetch per patch rather than holding every payload at once.
- **Generated types couple the CLI to a local `openapi.json`.** A published CLI can be newer than
  the deployed Worker. Pinning the package version to the API major is the mitigation, and
  `rito-meta raw /v1` reports what the live deployment actually is.
