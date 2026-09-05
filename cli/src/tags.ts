/**
 * The bin format's type tags, and the one type shape every answer renders.
 *
 * The API names types (`File`, `Map`) but never emits the tag number the bin
 * format writes, so this table is the CLI's own. It is format truth and has
 * been stable for years, but it is the one place outside the API that knows
 * something: review it if the format ever grows a type. Deliberately absent
 * is any library's vocabulary for these tags (what a Rust crate calls tag 18
 * is that crate's business).
 */

import type { ApiTypeFields } from "./api-types";

/** Type name as the API spells it -> bin format tag. Containers set bit 7. */
export const TYPE_TAGS: Readonly<Record<string, number>> = Object.freeze({
  None: 0,
  Bool: 1,
  I8: 2,
  U8: 3,
  I16: 4,
  U16: 5,
  I32: 6,
  U32: 7,
  I64: 8,
  U64: 9,
  F32: 10,
  Vec2: 11,
  Vec3: 12,
  Vec4: 13,
  Mtx44: 14,
  Color: 15,
  String: 16,
  Hash: 17,
  File: 18,
  List: 128,
  List2: 129,
  Pointer: 130,
  Embed: 131,
  Link: 132,
  Option: 133,
  Map: 134,
  Flag: 135,
});

export type LinkKind = "class" | "external" | "unknown";

/** A type name with its tag; `tag` is null for a name this table does not know. */
export interface TypeAtom {
  name: string;
  tag: number | null;
}

/** The class a property links (`kh`): what the hash is, and its name when resolved. */
export interface TypeLink {
  hash: string;
  name: string | null;
  kind: LinkKind;
}

/**
 * One shape for a type, whether it came from a class detail or a changelog.
 *
 * `key` is a Map's key type, `value` the element or value type of any
 * container, `size` the fixed element count of a sized List, and `keyHash`
 * the class a Pointer/Embed/Link (or a container of them) points at.
 */
export interface TypeShape extends TypeAtom {
  size?: number;
  key?: TypeAtom;
  value?: TypeAtom;
  keyHash?: TypeLink;
}

const SIZE_HINT = /^0x[0-9a-f]+$/;

const atom = (name: string): TypeAtom => ({ name, tag: TYPE_TAGS[name] ?? null });

/** Fold the API's `ft`/`kt`/`vt`/`kh` spelling into a [`TypeShape`]. */
export function typeShape(t: ApiTypeFields): TypeShape {
  const shape: TypeShape = atom(t.ft);
  if (t.kt !== null && t.kt !== undefined) {
    // A List's aux slot carries its fixed size as hex; a Map's carries the key type.
    if (SIZE_HINT.test(t.kt)) shape.size = Number.parseInt(t.kt, 16);
    else shape.key = atom(t.kt);
  }
  if (t.vt !== null && t.vt !== undefined) shape.value = atom(t.vt);
  if (t.kh !== null && t.kh !== undefined) {
    shape.keyHash = { hash: t.kh, name: t.khName ?? null, kind: t.khKind ?? "unknown" };
  }
  return shape;
}

/** Compact human spelling: `Map<Hash, Embed<GameModeConstants>>`, `List<F32>[7]`. */
export function formatType(t: TypeShape): string {
  const link = t.keyHash ? `<${t.keyHash.name ?? t.keyHash.hash}>` : "";
  const inner = t.value ? `${t.value.name}${link}` : "";
  let out = t.name;
  if (t.key && inner) out += `<${t.key.name}, ${inner}>`;
  else if (inner) out += `<${inner}>`;
  else out += link;
  if (t.size !== undefined) out += `[${t.size}]`;
  return out;
}
