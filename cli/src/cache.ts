/**
 * On-disk cache of API responses, keyed by URL and validated with the API's
 * ETags. One JSON file per URL under the platform's cache directory.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface CacheEntry {
  url: string;
  etag: string;
  /** Verbatim response body. */
  text: string;
  storedAt: string;
}

export interface CacheLocation {
  env: Record<string, string | undefined>;
  platform: string;
  homedir: string;
}

/** `$RITO_META_CACHE_DIR`, else the platform's per-user cache directory. */
export function defaultCacheDir({ env, platform, homedir }: CacheLocation): string {
  const override = env["RITO_META_CACHE_DIR"];
  if (override) return override;
  if (platform === "win32") {
    return path.join(env["LOCALAPPDATA"] ?? path.join(homedir, "AppData", "Local"), "rito-meta", "cache");
  }
  if (platform === "darwin") return path.join(homedir, "Library", "Caches", "rito-meta");
  return path.join(env["XDG_CACHE_HOME"] ?? path.join(homedir, ".cache"), "rito-meta");
}

export class DiskCache {
  constructor(readonly dir: string) {}

  private file(url: string): string {
    return path.join(this.dir, createHash("sha256").update(url).digest("hex").slice(0, 32) + ".json");
  }

  get(url: string): CacheEntry | null {
    try {
      const entry = JSON.parse(fs.readFileSync(this.file(url), "utf8")) as Partial<CacheEntry>;
      if (entry.url !== url || typeof entry.etag !== "string" || typeof entry.text !== "string") return null;
      return entry as CacheEntry;
    } catch {
      return null; // missing or corrupt: a cache miss, never an error
    }
  }

  set(entry: CacheEntry): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const target = this.file(entry.url);
      // Write-then-rename so a concurrent reader never sees a torn file.
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entry));
      fs.renameSync(tmp, target);
    } catch {
      // A cache that cannot be written is a slower run, not a failed one.
    }
  }
}
