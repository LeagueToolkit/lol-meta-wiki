/**
 * The one place the CLI talks HTTP: base URL, conditional requests against
 * the API's ETags, and the error mapping for anything that is not JSON.
 */

import type { ApiError } from "./api-types";
import type { DiskCache } from "./cache";
import { CliError } from "./outcome";

export interface HttpResponse {
  status: number;
  /** Verbatim body. */
  text: string;
  etag: string | null;
}

/** The subset of `fetch` the client needs; what tests inject. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  cache: DiskCache | null;
  userAgent: string;
}

/** The canonical deployment; `--api` and `RITO_META_API` override it. */
export const DEFAULT_API = "https://meta-api.leaguetoolkit.dev";

/** Bodies above this are not worth caching (`/v1/db` is ~3.5 MB). */
const CACHE_LIMIT = 1024 * 1024;

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly cache: DiskCache | null;
  private readonly userAgent: string;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch;
    this.cache = opts.cache;
    this.userAgent = opts.userAgent;
  }

  url(path: string): string {
    return this.baseUrl + (path.startsWith("/") ? path : `/${path}`);
  }

  /** GET `path`, revalidating a cached copy with `If-None-Match` when one exists. */
  async get(path: string, { cache = true }: { cache?: boolean } = {}): Promise<HttpResponse> {
    const url = this.url(path);
    const cached = cache ? (this.cache?.get(url) ?? null) : null;
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": this.userAgent };
    if (cached) headers["If-None-Match"] = cached.etag;

    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers, redirect: "follow" });
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new CliError(`network error fetching ${url}: ${reason}`, "pass --db <path> to answer from a downloaded database");
    }

    if (res.status === 304 && cached) {
      return { status: 200, text: cached.text, etag: cached.etag };
    }
    const text = await res.text();
    const etag = res.headers.get("etag");
    if (res.status === 200 && etag && cache && this.cache && text.length <= CACHE_LIMIT) {
      this.cache.set({ url, etag, text, storedAt: new Date().toISOString() });
    }
    return { status: res.status, text, etag };
  }

  /**
   * GET and parse. A 404 is an answer (`body` is the API's error); any other
   * non-200 status is an error.
   */
  async getJson<T>(path: string): Promise<{ status: 200; body: T } | { status: 404; body: ApiError }> {
    const res = await this.get(path);
    if (res.status !== 200 && res.status !== 404) {
      throw new CliError(`${this.url(path)} answered ${res.status}`, res.text.slice(0, 200));
    }
    let body: unknown;
    try {
      body = JSON.parse(res.text);
    } catch {
      throw new CliError(`${this.url(path)} did not return JSON`, "is --api pointing at the meta API?");
    }
    return res.status === 200 ? { status: 200, body: body as T } : { status: 404, body: body as ApiError };
  }
}
