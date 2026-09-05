/**
 * The offline source: a downloaded `/v1/db` answering in the API's shapes.
 *
 * Name/hash resolution and canonicalization come from the API's own
 * resolver, and the API shapes from its transforms, so a `--db` run and an
 * online run are built by the same code from the same database. Prose is
 * not part of `/v1/db`, so the docs commands are the one thing this source
 * cannot serve.
 */

import fs from "node:fs";
import { HEX, Resolver, canon, canonName } from "../../api/scripts/lib/resolver";
import { flattenClass, transformChangelog, transformClass } from "../../api/scripts/lib/transform";
import type { ApiClass as TransformedClass, MetaDb } from "../../api/scripts/lib/types";
import type {
  ApiAllDocs,
  ApiChangelogIndex,
  ApiChangelogPatch,
  ApiClass,
  ApiClassDocs,
  ApiHashIndex,
  ApiNameList,
  ApiWikiIndex,
} from "./api-types";
import { SITE_URL, classSlug, deriveChangelog, deriveClasses } from "./derive";
import { CliError } from "./outcome";
import type { Dataset, Source } from "./source";
import { VersionMap } from "./versions";

const HASH_FORMAT = 'FNV-1a 32-bit, "0x" + 8 lowercase hex digits, zero-padded';

const sortedRecord = <T>(entries: [string, T][]): Record<string, T> =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Parse a `/v1/db` download. Throws a [`CliError`] naming what is wrong with the file. */
export function readMetaDb(path: string): MetaDb {
  let text: string;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (err) {
    throw new CliError(`cannot read --db ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let db: unknown;
  try {
    db = JSON.parse(text);
  } catch {
    throw new CliError(`--db ${path} is not valid JSON`, "download one with `rito-meta db fetch <path>`");
  }
  if (typeof db !== "object" || db === null || !("classes" in db) || !("versions" in db) || !("formatVersion" in db)) {
    throw new CliError(`--db ${path} is not a meta database`, "expected the shape served by /v1/db");
  }
  const meta = db as MetaDb;
  if (meta.formatVersion !== 1) {
    throw new CliError(`--db ${path} has formatVersion ${meta.formatVersion}; this CLI reads version 1`);
  }
  if (meta.versions.length === 0) throw new CliError(`--db ${path} has an empty version map`);
  return meta;
}

/** The per-class derivation, done once per database. */
interface DerivedClasses {
  /** API name -> API class. */
  byName: Map<string, TransformedClass>;
  /** API name -> the site's display name, which the wiki slugs are built from. */
  siteNames: Map<string, string>;
}

export class LocalSource implements Source {
  readonly offline = true;
  private dbMemo: MetaDb | undefined;
  private resolverMemo: Resolver | undefined;
  private classesMemo: DerivedClasses | undefined;
  private changelogMemo: ApiChangelogPatch[] | undefined;

  /** The file is read on first use, so a run that never needs it (`raw`) never parses 3.5 MB. */
  constructor(
    readonly label: string,
    private readonly load: () => MetaDb
  ) {}

  static open(path: string): LocalSource {
    return new LocalSource(path, () => readMetaDb(path));
  }

  private get db(): MetaDb {
    return (this.dbMemo ??= this.load());
  }

  private get resolver(): Resolver {
    return (this.resolverMemo ??= new Resolver(this.db));
  }

  private classes(): DerivedClasses {
    if (!this.classesMemo) {
      const site = deriveClasses(this.db);
      this.classesMemo = {
        byName: new Map(site.map((c) => [canonName(c.name), transformClass(this.resolver, c)])),
        siteNames: new Map(site.map((c) => [canonName(c.name), c.name])),
      };
    }
    return this.classesMemo;
  }

  private changelogs(): ApiChangelogPatch[] {
    // The transforms are typed with the api package's own (looser) output
    // types; the Worker serves exactly their output, so this is the same
    // trust the network path places in a response body.
    this.changelogMemo ??= deriveChangelog(this.db).map((p) => transformChangelog(this.resolver, p) as ApiChangelogPatch);
    return this.changelogMemo;
  }

  async dataset(): Promise<Dataset> {
    return { api: "v1", generation: this.db.hashSource?.fetchedAt ?? null, latest: new VersionMap(this.db.versions).latest };
  }

  async versions(): Promise<VersionMap> {
    return new VersionMap(this.db.versions);
  }

  async class(nameOrHash: string, inherited: boolean): Promise<ApiClass | null> {
    const { byName } = this.classes();
    const key = HEX.test(nameOrHash) ? (this.resolver.classByHash.get(canon(nameOrHash))?.name ?? canon(nameOrHash)) : nameOrHash;
    const cls = byName.get(key);
    if (!cls) return null;
    return inherited ? flattenClass(cls, byName) : cls;
  }

  async hashes(): Promise<ApiHashIndex> {
    return {
      format: HASH_FORMAT,
      count: this.resolver.classByHash.size,
      classes: sortedRecord([...this.resolver.classByHash.entries()].map(([h, c]) => [h, c.name])),
      externals: sortedRecord([...this.resolver.externalNameByHash.entries()]),
    };
  }

  async wikiIndex(): Promise<ApiWikiIndex> {
    const { siteNames } = this.classes();
    return sortedRecord([...siteNames.entries()].map(([api, site]) => [api, `${SITE_URL}/classes/${classSlug(site)}`]));
  }

  async changelogIndex(): Promise<ApiChangelogIndex> {
    const patches = this.changelogs();
    return {
      generatedAt: this.db.hashSource?.fetchedAt ?? "",
      latestPatch: this.db.versions[this.db.versions.length - 1]!.patch,
      patches: patches.map(({ patch, slug, builds, counts }) => ({ patch, slug, builds, counts })),
    };
  }

  async changelog(slug: string): Promise<ApiChangelogPatch | null> {
    return this.changelogs().find((p) => p.slug === slug) ?? null;
  }

  private noDocs(): never {
    throw new CliError("documentation prose is not part of /v1/db, so `docs` cannot run with --db", "run it without --db");
  }

  async docsIndex(): Promise<ApiNameList> {
    return this.noDocs();
  }

  async docs(): Promise<ApiClassDocs | null> {
    return this.noDocs();
  }

  async docsAll(): Promise<ApiAllDocs> {
    return this.noDocs();
  }
}
