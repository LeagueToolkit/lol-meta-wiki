/**
 * Group the changelog's new/removed class entries by domain, the level above
 * the inheritance families (utils/classFamilies).
 *
 * A big patch touches several subject areas at once; split by domain first,
 * "what did this patch do to VFX" is one block instead of chips scattered
 * through an A→Z list.
 *
 * The domain is generated data (`ClassChange.domain`) - this only buckets and
 * orders what the generator already decided.
 */

import type { ClassChange, DomainInfo } from "../types";
import { domains } from "./domains";

export interface DomainGroup {
  /** Undefined for entries naming a domain the site no longer has. */
  domain: DomainInfo | undefined;
  entries: ClassChange[];
}

/** Buckets in the site's domain order; entries keep the generator's A→Z. */
export function groupByDomain(entries: ClassChange[]): DomainGroup[] {
  const buckets = new Map<string | undefined, ClassChange[]>();
  for (const e of entries) {
    let bucket = buckets.get(e.domain);
    if (!bucket) buckets.set(e.domain, (bucket = []));
    bucket.push(e);
  }

  const groups: DomainGroup[] = [];
  for (const domain of domains) {
    const bucket = buckets.get(domain.id);
    if (bucket) groups.push({ domain, entries: bucket });
    buckets.delete(domain.id);
  }
  const unknown = [...buckets.values()].flat();
  if (unknown.length > 0) groups.push({ domain: undefined, entries: unknown });
  return groups;
}
