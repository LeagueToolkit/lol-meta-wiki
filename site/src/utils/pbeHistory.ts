import type { MetaVersion } from "../../../scripts/meta-db";

/** Resolve inclusive revision intervals by timeline position, not patch strings. */
export function revisionAt<T extends { from: number; to?: number }>(
  revisions: T[], build: number, versions: MetaVersion[]
): T | undefined {
  const positions = new Map(versions.map((v, i) => [v.build, i]));
  const at = positions.get(build);
  if (at === undefined) return undefined;
  return revisions.find((r) => {
    const from = positions.get(r.from);
    const to = r.to === undefined ? versions.length - 1 : positions.get(r.to);
    return from !== undefined && to !== undefined && from <= at && at <= to;
  });
}

export function archivedType(type: string[], names: Record<string, string>): string {
  const [ft, kt, vt, kh] = type;
  const ref = names[kh] ?? kh;
  const value = (t: string) => kh !== "0x0" ? `${t}<${ref}>` : t;
  if (ft === "Map") return `Map<${kt}, ${value(vt)}>`;
  if (vt !== "0x0") return `${ft}<${value(vt)}>${kt !== "0x0" ? `[${Number(kt)}]` : ""}`;
  return value(ft);
}
