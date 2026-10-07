/**
 * The PBE overlay (db/meta.pbe.json) and the merged database built from it.
 * Pure, and shared by scripts/generate-db.ts and api/scripts.
 *
 * The overlay holds the class entries that differ if the newest PBE build is
 * folded as one more build after the latest live build. Format spec:
 * "PBE preview (db/meta.pbe.json)" in docs/meta-db-format.md of
 * LeagueToolkit/lol-meta-classes.
 */

import type { PreviewInfo } from "../site/src/types";
import type { MetaClass, MetaDb } from "./meta-db";

export type MetaOverlay = {
  formatVersion: number;
  channel: string;
  /** null if the overlay holds no preview. */
  patch: string | null;
  build: number | null;
  /** The live build that the PBE build follows: `latest` of the paired meta.db.json. */
  base: number | null;
  externalTypeNames: Record<string, string>;
  classes: Record<string, MetaClass>;
};

export type PreviewMerge =
  /** The overlay holds no preview: PBE is not ahead of live. */
  | { status: "none" }
  /** The overlay was built on another live build than `latest` of the db. */
  | { status: "mismatch"; base: number; latest: number }
  | { status: "ok"; info: PreviewInfo; db: MetaDb };

/**
 * Builds the database as of the PBE build: the live database with the PBE
 * build appended to `versions` and the overlay entries spread over `classes`
 * and `externalTypeNames`. The live database is not modified.
 *
 * The PBE build is the last entry of `versions` whatever its number is. PBE
 * and live build numbers interleave, so a reader of the merged database must
 * order builds by their position in `versions`.
 *
 * Returns "none" if the overlay holds no preview. Returns "mismatch" if `base`
 * differs from `latest` of the db: the two files then come from different
 * commits, and the overlay entries do not apply to this db. Throws if the
 * overlay has another format version than 1.
 */
export function mergePreview(db: MetaDb, overlay: MetaOverlay): PreviewMerge {
  if (overlay.formatVersion !== 1) {
    throw new Error(
      `Unsupported meta.pbe.json formatVersion ${overlay.formatVersion} (expected 1).`
    );
  }
  const { patch, build, base } = overlay;
  if (patch === null || build === null || base === null) return { status: "none" };
  if (base !== db.latest) return { status: "mismatch", base, latest: db.latest };

  const basePatch = db.versions.find((v) => v.build === base)?.patch;
  if (basePatch === undefined) {
    throw new Error(`meta.db.json has no version entry for its latest build ${base}.`);
  }
  if (db.versions.some((v) => v.build === build)) {
    throw new Error(`PBE build ${build} is already a live build in meta.db.json.`);
  }

  return {
    status: "ok",
    info: { channel: "pbe", patch, build, base, basePatch },
    db: {
      ...db,
      latest: build,
      versions: [...db.versions, { patch, build }],
      externalTypeNames: { ...db.externalTypeNames, ...overlay.externalTypeNames },
      classes: { ...db.classes, ...overlay.classes },
    },
  };
}
