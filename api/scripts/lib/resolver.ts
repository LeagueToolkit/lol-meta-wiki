/**
 * Hash canonicalization and name<->hash resolution over the raw meta DB.
 *
 * The DB stores unpadded lowercase hex ("0x6516a"); the API always emits the
 * canonical form: "0x" + 8 lowercase hex digits, zero-padded. The site
 * generator emits type references as display strings (resolved name, raw
 * hash, or the "0x0" none-sentinel); the resolver turns those back into
 * structured, canonical references.
 */

import type { ClassRevision, MetaDb, TypeRef } from "./types";

export const HEX = /^0x[0-9a-fA-F]{1,8}$/;
export const canon = (h: string) => "0x" + h.slice(2).toLowerCase().padStart(8, "0");
/** Class/property display names: real names kept, hex names canonicalized. */
export const canonName = (n: string) => (HEX.test(n) ? canon(n) : n);

export interface ClassInfo {
  name: string | null;
  flags: Pick<ClassRevision, "interface" | "value">;
  /** site display name (metaProp.name ?? raw hash) -> canonical property hash */
  propHashByName: Map<string, string>;
}

export class Resolver {
  /** canonical class hash -> info */
  readonly classByHash = new Map<string, ClassInfo>();
  /** resolved class name -> canonical hash */
  readonly classHashByName = new Map<string, string>();
  readonly externalNameByHash = new Map<string, string>();
  readonly externalHashByName = new Map<string, string>();

  constructor(db: MetaDb) {
    for (const [khash, klass] of Object.entries(db.classes)) {
      const latest = klass.revisions[klass.revisions.length - 1];
      this.classByHash.set(canon(khash), {
        name: klass.name ?? null,
        flags: { interface: latest.interface, value: latest.value },
        propHashByName: new Map(
          Object.entries(klass.properties).map(([fhash, p]) => [p.name ?? fhash, canon(fhash)])
        ),
      });
      if (klass.name) {
        // Reverse (name -> hash) resolution relies on names being unambiguous.
        if (HEX.test(klass.name)) throw new Error(`class name looks like a hash: ${klass.name}`);
        if (this.classHashByName.has(klass.name)) throw new Error(`duplicate class name in DB: ${klass.name}`);
        this.classHashByName.set(klass.name, canon(khash));
      }
    }
    for (const [h, name] of Object.entries(db.externalTypeNames)) {
      this.externalNameByHash.set(canon(h), name);
      this.externalHashByName.set(name, canon(h));
    }
  }

  /** Look up a class by its site display name (resolved name or raw hash). */
  classInfo(siteName: string): { hash: string; info: ClassInfo } {
    const hash = this.classHashByName.get(siteName) ?? (HEX.test(siteName) ? canon(siteName) : null);
    const info = hash !== null ? this.classByHash.get(hash) : undefined;
    if (!info || hash === null) throw new Error(`class ${siteName} not found in meta.db.json`);
    return { hash, info };
  }

  /**
   * Rebuild a `kh` display string into the API shape: kh always a canonical
   * hash (or null), khName the resolved name (or null), khKind whether kh is
   * fetchable via /v1/classes ("class"), a known engine type ("external"),
   * or an unresolved hash ("unknown").
   */
  typeRef(display: string): TypeRef {
    if (display === "0x0") return { kh: null, khName: null, khKind: null };
    if (HEX.test(display)) {
      const kh = canon(display);
      const cls = this.classByHash.get(kh);
      if (cls) return { kh, khName: cls.name, khKind: "class" };
      const ext = this.externalNameByHash.get(kh);
      if (ext) return { kh, khName: ext, khKind: "external" };
      return { kh, khName: null, khKind: "unknown" };
    }
    const classHash = this.classHashByName.get(display);
    if (classHash) return { kh: classHash, khName: display, khKind: "class" };
    const externalHash = this.externalHashByName.get(display);
    if (externalHash) return { kh: externalHash, khName: display, khKind: "external" };
    throw new Error(`unresolvable type reference: ${display}`);
  }
}
