/**
 * Where answers come from: the API over HTTP, or a downloaded `/v1/db` on
 * disk. Every command reads through this interface and nothing else, so the
 * online and offline paths cannot answer differently by construction - the
 * offline source produces the same API shapes (see local.ts).
 */

import type {
  ApiAllDocs,
  ApiChangelogIndex,
  ApiChangelogPatch,
  ApiClass,
  ApiClassDocs,
  ApiHashIndex,
  ApiMeta,
  ApiNameList,
  ApiVersions,
  ApiWikiIndex,
} from "./api-types";
import type { ApiClient } from "./http";
import { CliError } from "./outcome";
import { type At, VersionMap } from "./versions";

/** What every payload is stamped with. */
export interface Dataset {
  /** The API version the data is shaped as (`v1`). */
  api: string;
  /** The publisher's `dataset.fetchedAt`; null when the database does not record it. */
  generation: string | null;
  /** The newest build the dataset covers. */
  latest: At;
}

export interface Source {
  /** Base URL or file path, for the payload's `source` field. */
  readonly label: string;
  readonly offline: boolean;
  dataset(): Promise<Dataset>;
  versions(): Promise<VersionMap>;
  /** null when the API has no such class. */
  class(nameOrHash: string, inherited: boolean): Promise<ApiClass | null>;
  hashes(): Promise<ApiHashIndex>;
  wikiIndex(): Promise<ApiWikiIndex>;
  changelogIndex(): Promise<ApiChangelogIndex>;
  /** null when no changelog exists for the slug. */
  changelog(slug: string): Promise<ApiChangelogPatch | null>;
  docsIndex(): Promise<ApiNameList>;
  /** null when no prose exists for the class (or the class does not exist). */
  docs(nameOrHash: string): Promise<ApiClassDocs | null>;
  docsAll(): Promise<ApiAllDocs>;
}

const segment = (s: string) => encodeURIComponent(s);

export class ApiSource implements Source {
  readonly label: string;
  readonly offline = false;
  private readonly memo = new Map<string, Promise<unknown>>();

  constructor(readonly client: ApiClient) {
    this.label = client.baseUrl;
  }

  /** One request per path per run, however many commands steps ask. */
  private once<T>(path: string, load: () => Promise<T>): Promise<T> {
    let p = this.memo.get(path) as Promise<T> | undefined;
    if (!p) {
      p = load();
      this.memo.set(path, p);
    }
    return p;
  }

  private required<T>(path: string): Promise<T> {
    return this.once(path, async () => {
      const res = await this.client.getJson<T>(path);
      if (res.status === 404) throw new CliError(`${this.client.url(path)} answered 404: ${res.body.error}`, "is --api pointing at the meta API?");
      return res.body;
    });
  }

  private optional<T>(path: string): Promise<T | null> {
    return this.once(path, async () => {
      const res = await this.client.getJson<T>(path);
      return res.status === 200 ? res.body : null;
    });
  }

  async dataset(): Promise<Dataset> {
    const meta = await this.required<ApiMeta>("/v1");
    return {
      api: meta.version,
      generation: meta.dataset.fetchedAt,
      latest: { build: meta.dataset.latestBuild, patch: meta.dataset.latestPatch },
    };
  }

  async versions(): Promise<VersionMap> {
    return VersionMap.fromApi(await this.required<ApiVersions>("/v1/versions"));
  }

  class(nameOrHash: string, inherited: boolean): Promise<ApiClass | null> {
    return this.optional<ApiClass>(`/v1/classes/${segment(nameOrHash)}${inherited ? "?inherited=1" : ""}`);
  }

  hashes(): Promise<ApiHashIndex> {
    return this.required<ApiHashIndex>("/v1/hashes");
  }

  wikiIndex(): Promise<ApiWikiIndex> {
    return this.required<ApiWikiIndex>("/v1/index");
  }

  changelogIndex(): Promise<ApiChangelogIndex> {
    return this.required<ApiChangelogIndex>("/v1/changelog");
  }

  changelog(slug: string): Promise<ApiChangelogPatch | null> {
    return this.optional<ApiChangelogPatch>(`/v1/changelog/${segment(slug)}`);
  }

  docsIndex(): Promise<ApiNameList> {
    return this.required<ApiNameList>("/v1/docs");
  }

  docs(nameOrHash: string): Promise<ApiClassDocs | null> {
    return this.optional<ApiClassDocs>(`/v1/docs/${segment(nameOrHash)}`);
  }

  docsAll(): Promise<ApiAllDocs> {
    // Routed deliberately: "all" is a reserved name, not a class.
    return this.required<ApiAllDocs>("/v1/docs/all");
  }
}
