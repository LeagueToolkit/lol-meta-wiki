/**
 * A stand-in for the Worker over the recorded fixtures: the same routes,
 * hash canonicalization, 404 body and ETag/304 behavior. Plain JS so the
 * Node smoke test (test/smoke) can serve it over HTTP and the Bun tests can
 * call it in-process as an injected fetch.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const EXACT = {
  "/v1": "api/v1.json",
  "/v1/versions": "api/v1/versions.json",
  "/v1/classes": "api/v1/classes.json",
  "/v1/hashes": "api/v1/hashes.json",
  "/v1/index": "api/v1/index.json",
  "/v1/changelog": "api/v1/changelog.json",
  "/v1/docs": "api/v1/docs.json",
  "/v1/db": "db.json",
};
const HEX = /^0x[0-9a-fA-F]{1,8}$/;
const canon = (h) => "0x" + h.slice(2).toLowerCase().padStart(8, "0");

const NOT_FOUND = JSON.stringify(
  { error: "not found", hint: "names are exact and case-sensitive; look them up via /v1/classes, /v1/hashes, or /v1/changelog", meta: "/v1" },
  null,
  2
);

let hashToName;
function nameOf(hash) {
  hashToName ??= Object.fromEntries(
    Object.entries(JSON.parse(fs.readFileSync(path.join(FIXTURES, "api/v1/hashes.json"), "utf8")).classes).map(([h, n]) => [h, n ?? h])
  );
  return hashToName[hash] ?? hash;
}

function fileFor(pathname, params) {
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (clean in EXACT) return EXACT[clean];
  const m = /^\/v1\/(classes|changelog|docs)\/([A-Za-z0-9._-]+)$/.exec(clean);
  if (!m) return null;
  let segment = m[2];
  if (m[1] !== "changelog" && HEX.test(segment)) segment = nameOf(canon(segment));
  const inherited = params.get("inherited");
  const dir = m[1] === "classes" && (inherited === "1" || inherited === "true") ? "classes-inherited" : m[1];
  return `api/v1/${dir}/${segment}.json`;
}

/** Resolve one request to `{ status, body, etag }`; honors If-None-Match with a 304. */
export function respond(url, headers = {}) {
  const u = new URL(url);
  const rel = fileFor(u.pathname, u.searchParams);
  const file = rel && path.join(FIXTURES, rel);
  if (!file || !fs.existsSync(file)) return { status: 404, body: NOT_FOUND, etag: null };
  const body = fs.readFileSync(file, "utf8");
  const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
  const ifNoneMatch = headers["if-none-match"] ?? headers["If-None-Match"];
  if (ifNoneMatch === etag) return { status: 304, body: "", etag };
  return { status: 200, body, etag };
}

/** A `fetch` over the fixtures. `log` receives every request (url, headers). */
export function fixtureFetch(log) {
  return async (url, init = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    log?.({ url, headers });
    const { status, body, etag } = respond(url, headers);
    return new Response(status === 304 ? null : body, {
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...(etag && { etag }) },
    });
  };
}
