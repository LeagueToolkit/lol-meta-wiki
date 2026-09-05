/**
 * Dating a class or property to one point in time, on the API's shapes.
 *
 * The API dates lifetimes in patches (`since`, `removedIn`, history bounds),
 * so answers are patch-granular: a build is first mapped to its patch. That
 * is the resolution the published dataset has; a build inside a multi-build
 * patch answers as the patch does.
 */

import type { ApiClass, ApiProperty } from "./api-types";
import { type TypeShape, typeShape } from "./tags";
import { type At, type VersionMap, comparePatches } from "./versions";

/** The definition of a property that was in force at some point in time. */
export interface RevisionAt {
  type: TypeShape;
  /** First patch with this definition; null = present when tracking began. */
  since: string | null;
  /** Last patch with this definition; null = still current. */
  until: string | null;
  defaultValue?: string;
}

/** `since == null` means present when tracking began. */
const startedBy = (patch: string, since: string | null | undefined) => since == null || comparePatches(since, patch) <= 0;
/** `removedIn == null` means still present; `removedIn` itself is the first patch without it. */
const stillPresentAt = (patch: string, removedIn: string | null | undefined) => removedIn == null || comparePatches(patch, removedIn) < 0;
/** `until == null` means still current; `until` itself is the last patch with it. */
const notEndedBy = (patch: string, until: string | null) => until === null || comparePatches(patch, until) <= 0;

/** Whether the class existed in the dataset at `at`. */
export function classLiveAt(cls: ApiClass, at: At): boolean {
  return startedBy(at.patch, cls.since) && stillPresentAt(at.patch, cls.removedIn);
}

/**
 * Every definition the property ever had, in patch order. `owner` is the class
 * defining the property: the class itself, or the ancestor `from` names in an
 * inherited view, whose lifetime bounds a property that appeared with it.
 */
export function propertyHistory(owner: ApiClass, p: ApiProperty, vm: VersionMap): RevisionAt[] {
  if (p.history && p.history.length > 0) {
    return p.history.map((h) => ({
      type: typeShape(h),
      since: h.since,
      until: h.until,
      ...(h.defaultValue !== undefined && { defaultValue: h.defaultValue }),
    }));
  }
  const removedIn = p.removedIn ?? owner.removedIn ?? null;
  return [
    {
      type: typeShape(p),
      since: p.since ?? owner.since ?? null,
      until: removedIn === null ? null : vm.patchBefore(removedIn),
      ...(p.defaultValue !== undefined && { defaultValue: p.defaultValue }),
    },
  ];
}

/**
 * The property's definition at `at`, or null when no revision covers it.
 *
 * `cls` is the class asked about and `owner` the class defining the property
 * (the same class unless the view is inherited); both must exist at `at`.
 * The API's explicit `removedIn` wins over a history entry's `until`: a patch
 * answers as it ended, and `removedIn` is the first patch without the property.
 */
export function propertyAt(cls: ApiClass, owner: ApiClass, p: ApiProperty, at: At, vm: VersionMap): RevisionAt | null {
  if (!classLiveAt(cls, at) || !classLiveAt(owner, at)) return null;
  if (!stillPresentAt(at.patch, p.removedIn)) return null;
  for (const rev of propertyHistory(owner, p, vm)) {
    if (startedBy(at.patch, rev.since) && notEndedBy(at.patch, rev.until)) return rev;
  }
  return null;
}
