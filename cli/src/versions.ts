/**
 * The patch <-> build join, done once so no caller converts.
 *
 * The API dates a property's history in patch strings and a changelog entry
 * in build numbers. `--at` accepts either; every answer names both. Patches
 * are compared numerically (major, minor) rather than by list position
 * because hotfix builds can interleave patches in build order.
 */

import type { ApiVersions } from "./api-types";

/**
 * A point in time named both ways.
 *
 * `requestedBuild` is set when the caller's build was not itself observed and
 * the answer is as of the nearest earlier build that was.
 */
export interface At {
  build: number;
  patch: string;
  requestedBuild?: number;
}

export type AtResolution =
  | { ok: true; at: At }
  | { ok: false; reason: "before-window" | "after-window" | "invalid" };

const BUILD = /^\d+$/;
const PATCH = /^\d+\.\d+$/;

export function comparePatches(a: string, b: string): number {
  const [amaj = 0, amin = 0] = a.split(".").map(Number);
  const [bmaj = 0, bmin = 0] = b.split(".").map(Number);
  return amaj - bmaj || amin - bmin;
}

export class VersionMap {
  /** Ascending by build. */
  readonly versions: readonly { patch: string; build: number }[];
  /** Every patch once, ascending numerically. */
  readonly patches: readonly string[];
  private readonly patchByBuild: Map<number, string>;

  constructor(versions: readonly { patch: string; build: number }[]) {
    if (versions.length === 0) throw new Error("version map is empty");
    this.versions = [...versions].sort((a, b) => a.build - b.build);
    this.patchByBuild = new Map(this.versions.map((v) => [v.build, v.patch]));
    this.patches = [...new Set(this.versions.map((v) => v.patch))].sort(comparePatches);
  }

  static fromApi(v: ApiVersions): VersionMap {
    return new VersionMap(v.versions);
  }

  get first(): At {
    const v = this.versions[0]!;
    return { build: v.build, patch: v.patch };
  }

  get latest(): At {
    const v = this.versions[this.versions.length - 1]!;
    return { build: v.build, patch: v.patch };
  }

  patchOf(build: number): string | undefined {
    return this.patchByBuild.get(build);
  }

  buildsOf(patch: string): number[] {
    return this.versions.filter((v) => v.patch === patch).map((v) => v.build);
  }

  /** The patch before `patch` in numeric order, or null at the start. */
  patchBefore(patch: string): string | null {
    const i = this.patches.indexOf(patch);
    return i > 0 ? this.patches[i - 1]! : null;
  }

  /** Patches touched by builds in the half-open span (fromBuild, toBuild], ascending. */
  patchesBetween(fromBuild: number, toBuild: number): string[] {
    const hit = new Set<string>();
    for (const v of this.versions) if (v.build > fromBuild && v.build <= toBuild) hit.add(v.patch);
    return [...hit].sort(comparePatches);
  }

  /** Name a point in time from a build number or a patch string. */
  resolve(input: string): AtResolution {
    if (BUILD.test(input)) return this.resolveBuild(Number(input));
    if (PATCH.test(input)) return this.resolvePatch(input);
    return { ok: false, reason: "invalid" };
  }

  private resolveBuild(build: number): AtResolution {
    if (build < this.first.build) return { ok: false, reason: "before-window" };
    if (build > this.latest.build) return { ok: false, reason: "after-window" };
    const exact = this.patchOf(build);
    if (exact !== undefined) return { ok: true, at: { build, patch: exact } };
    // Not an observed build: answer as of the last build seen before it.
    let floor = this.versions[0]!;
    for (const v of this.versions) if (v.build <= build) floor = v;
    return { ok: true, at: { build: floor.build, patch: floor.patch, requestedBuild: build } };
  }

  private resolvePatch(patch: string): AtResolution {
    const builds = this.buildsOf(patch);
    if (builds.length > 0) {
      // A patch's state is the state it ended with.
      return { ok: true, at: { build: Math.max(...builds), patch } };
    }
    if (comparePatches(patch, this.first.patch) < 0) return { ok: false, reason: "before-window" };
    if (comparePatches(patch, this.latest.patch) > 0) return { ok: false, reason: "after-window" };
    return { ok: false, reason: "invalid" };
  }
}
