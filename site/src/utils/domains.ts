/**
 * Build-time access to the domain list (public/db/categories.json).
 *
 * Parsed once per build process at module scope, like utils/classIndex.ts:
 * the page title of every class page asks for its domain's title.
 */

import fs from "node:fs";
import { publicDir } from "astro:config/server";
import {
  SHARED_DOMAIN,
  UNCATEGORIZED_DOMAIN,
  type CategoryVia,
  type DomainInfo,
} from "../types";

/** Every domain in display order; the two reserved ones come last. */
export const domains: DomainInfo[] = JSON.parse(
  fs.readFileSync(new URL("./db/categories.json", publicDir), "utf8")
);

const byId = new Map(domains.map((d) => [d.id, d]));

export function domainOf(id: string): DomainInfo | undefined {
  return byId.get(id);
}

export function domainHref(id: string): string {
  return `/domains/${id}/`;
}

/** True for the domains a contributor authored, false for the two leftovers. */
export function isAuthoredDomain(id: string): boolean {
  return id !== SHARED_DOMAIN && id !== UNCATEGORIZED_DOMAIN;
}

/** One sentence on why a class sits in its domain, for tooltips. */
export const VIA_REASON: Record<CategoryVia, string> = {
  pin: "Pinned to this domain in db/categories.yaml",
  seed: "Derives from one of this domain's root classes",
  prefix: "Its family's name carries this domain's prefix",
  usage: "Only classes of this domain use it",
  shared: "Used by classes of more than one domain",
  none: "No domain claims this class yet",
};
