#!/usr/bin/env bun
/**
 * Refresh db/meta.db.json and db/meta.pbe.json from the
 * LeagueToolkit/lol-meta-classes repository.
 *
 * The two files are a pair: the PBE overlay applies to the live build that is
 * `latest` in the db of the same commit. Both are fetched from one commit, so
 * a push between the two downloads, or a CDN that still serves an older copy
 * of one file, cannot produce a pair from different commits.
 *
 * Usage:
 *   bun run scripts/update-db.ts [--out db/meta.db.json] [--preview-out db/meta.pbe.json]
 *
 * GITHUB_TOKEN, if set, authenticates the request that resolves the commit.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MetaDb } from "./meta-db";
import { mergePreview, type MetaOverlay } from "./preview";

const REPO = "LeagueToolkit/lol-meta-classes";
const BRANCH = "main";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const outFile = arg("--out", "db/meta.db.json");
const previewOutFile = arg("--preview-out", "db/meta.pbe.json");

/**
 * Resolves the head commit of the branch. Falls back to the branch name if
 * the GitHub API does not answer (rate limit, outage); the pairing check in
 * main() then still rejects two files from different commits.
 */
async function resolveRef(): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      headers: {
        Accept: "application/vnd.github.sha",
        "User-Agent": "lol-meta-wiki-update-db",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const sha = (await res.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("the response is not a commit SHA");
    return sha;
  } catch (err) {
    console.warn(`[warn] could not resolve the head commit of ${REPO} (${err}); fetching from ${BRANCH}`);
    return BRANCH;
  }
}

async function fetchText(ref: string, path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;
  console.log(`[..] fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function main() {
  const ref = await resolveRef();
  const [dbText, overlayText] = await Promise.all([
    fetchText(ref, "db/meta.db.json"),
    fetchText(ref, "db/meta.pbe.json"),
  ]);

  // Validate before overwriting anything
  const db: MetaDb = JSON.parse(dbText);
  if (db.formatVersion !== 1) {
    throw new Error(
      `Fetched db has formatVersion ${db.formatVersion}; this repo expects 1. ` +
      `scripts/generate-db.ts likely needs updating first.`
    );
  }
  const overlay: MetaOverlay = JSON.parse(overlayText);
  const merged = mergePreview(db, overlay);
  if (merged.status === "mismatch") {
    throw new Error(
      `Fetched meta.pbe.json was built on live build ${merged.base}, but the fetched ` +
      `meta.db.json is at build ${merged.latest}. The two files come from different ` +
      `commits. Nothing was written; run the update again.`
    );
  }
  const latest = db.versions[db.versions.length - 1];

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, dbText, "utf8");
  await mkdir(dirname(previewOutFile), { recursive: true });
  await writeFile(previewOutFile, overlayText, "utf8");
  console.log(
    `[ok] ${outFile}: ${Object.keys(db.classes).length} classes, ` +
    `latest patch ${latest.patch} (build ${latest.build})`
  );
  console.log(
    merged.status === "ok"
      ? `[ok] ${previewOutFile}: PBE ${merged.info.patch} (build ${merged.info.build}), ` +
        `${Object.keys(overlay.classes).length} classes differ`
      : `[ok] ${previewOutFile}: no PBE preview`
  );
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
