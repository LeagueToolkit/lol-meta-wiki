/**
 * LoL Meta Wiki API — a thin router over the static asset tree built by
 * scripts/build-assets.ts. All data is generated at deploy time; this Worker
 * only maps clean routes onto .json assets and stamps every response with
 * CORS and caching headers.
 *
 * Class routes are hash-first: /v1/classes/{x} accepts a resolved name
 * ("AbilityObject"), a canonical hash ("0x0006516a"), or an unpadded hash
 * ("0x6516a"). Hex segments are canonicalized and mapped to the owning class
 * through generated/hash-to-name.json, which build-assets writes.
 *
 * Every response is live data unless the request says `?channel=pbe`. That
 * parameter applies to the class routes: the Worker serves the class from the
 * pbe/ asset tree, which holds only the classes that differ on the PBE build,
 * and falls back to the live asset for every other class.
 *
 * Licensing is documented in the repo, not transmitted per response: /v1/docs*
 * is the only surface serving human-authored CC BY-SA prose; every other
 * endpoint is unrestricted Factual Data. See DOCUMENTATION_LICENSE.md and the
 * site's API reference page.
 */

// canonical hash -> class name, for named classes (unnamed classes are stored
// under their canonical hash). Written by scripts/build-assets.ts.
import hashToName from "./generated/hash-to-name.json";
// The same map for the named classes that exist on PBE only.
import pbeHashToName from "./generated/pbe-hash-to-name.json";

export interface Env {
  ASSETS: Fetcher;
}

const COMMON_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "ETag",
};

// Dataset refreshes only when a new patch is deployed; an hour of edge/client
// staleness is fine and keeps origin hits near zero.
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

// route path -> asset path (exact matches; parameterized routes handled below)
const EXACT: Record<string, string> = {
  "/v1": "/v1/meta.json",
  "/v1/openapi": "/v1/openapi.json",
  "/v1/classes": "/v1/classes/index.json",
  "/v1/categories": "/v1/categories.json",
  "/v1/hashes": "/v1/hashes.json",
  "/v1/index": "/v1/index.json",
  "/v1/versions": "/v1/versions.json",
  "/v1/changelog": "/v1/changelog/index.json",
  "/v1/db": "/v1/db.json",
  "/v1/db/pbe": "/v1/db-pbe.json",
  "/v1/docs": "/v1/docs/index.json",
  // "/v1/docs/all" resolves through the parameterized route to docs/all.json;
  // build-assets reserves "all" (and "index") as class names.
};

// Class names ("AbilityObject"), hashes ("0x1003c990"), patch slugs ("16-13"),
// and domain ids ("vfx"). Rejecting everything else keeps traversal-shaped
// requests away from ASSETS. (The URL parser resolves "." / ".." segments
// before we see them, so allowing "." here cannot re-open traversal; a domain
// id arrives in the query instead, but always gains a ".json" suffix.)
const SEGMENT = /^[A-Za-z0-9._-]+$/;
// FNV-1a 32-bit hash in any spelling; canonicalized before lookup.
const HEX_SEGMENT = /^0x[0-9a-fA-F]{1,8}$/;
const canon = (h: string) => "0x" + h.slice(2).toLowerCase().padStart(8, "0");

const CHANNELS = ["live", "pbe"];

/**
 * The asset of a route. `fallback` is the live asset behind a pbe/ asset: the
 * pbe/ tree holds a file only if the class differs on the PBE build.
 */
interface Asset {
  path: string;
  fallback?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status >= 400 ? "public, max-age=60" : CACHE_CONTROL,
      ...(status === 405 && { Allow: "GET, HEAD, OPTIONS" }),
    },
  });
}

function resolveAsset(url: URL): Asset | null {
  const pathname = url.pathname;
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const pbe = url.searchParams.get("channel") === "pbe";
  if (clean === "/v1/classes") {
    // ?domain={id} narrows the list to one domain's precomputed name list.
    // The domain lists are live only, so `channel` does not apply to them.
    const domain = url.searchParams.get("domain");
    if (domain !== null) return SEGMENT.test(domain) ? { path: `/v1/classes-by-domain/${domain}.json` } : null;
    if (pbe) return { path: "/v1/pbe/classes/index.json", fallback: EXACT[clean] };
  }
  if (clean in EXACT) return { path: EXACT[clean] };
  const param = /^\/v1\/(classes|changelog|docs)\/([^/]+)$/.exec(clean);
  if (!param || !SEGMENT.test(param[2])) return null;
  const preview = pbe && param[1] === "classes";
  let segment = param[2];
  if (param[1] !== "changelog" && HEX_SEGMENT.test(segment)) {
    const hash = canon(segment);
    segment =
      (preview ? (pbeHashToName as Record<string, string>)[hash] : undefined) ??
      (hashToName as Record<string, string>)[hash] ??
      hash;
  }
  let dir = param[1];
  if (param[1] === "classes") {
    const inherited = url.searchParams.get("inherited");
    if (inherited === "1" || inherited === "true") dir = "classes-inherited";
  }
  const live = `/v1/${dir}/${segment}.json`;
  return preview ? { path: `/v1/pbe/${dir}/${segment}.json`, fallback: live } : { path: live };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...COMMON_HEADERS, "Access-Control-Max-Age": "86400" },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(405, { error: "method not allowed", allow: "GET, HEAD, OPTIONS" });
    }

    const url = new URL(request.url);
    if (url.pathname === "/") {
      return json(200, { name: "LoL Meta Wiki API", meta: "/v1" });
    }

    const channel = url.searchParams.get("channel");
    if (channel !== null && !CHANNELS.includes(channel)) {
      return json(400, { error: "unknown channel", hint: "channel is live or pbe", meta: "/v1" });
    }

    const asset = resolveAsset(url);
    if (asset === null) {
      return json(404, { error: "not found", meta: "/v1" });
    }

    const fetchAsset = (path: string) =>
      env.ASSETS.fetch(new URL(path, url.origin), {
        method: request.method,
        headers: request.headers, // preserves conditional/range/encoding negotiation
      });
    let res = await fetchAsset(asset.path);
    if (res.status === 404 && asset.fallback) res = await fetchAsset(asset.fallback);
    if (res.status === 404) {
      // Class names are case-sensitive; hashes are the stable spelling.
      return json(404, {
        error: "not found",
        hint: "names and domain ids are exact and case-sensitive; look them up via /v1/classes, /v1/hashes, /v1/categories, or /v1/changelog",
        meta: "/v1",
      });
    }

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(COMMON_HEADERS)) headers.set(k, v);
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(res.body, { status: res.status, headers });
  },
} satisfies ExportedHandler<Env>;
