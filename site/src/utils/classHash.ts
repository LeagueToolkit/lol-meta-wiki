/**
 * Reading a class hash out of a URL segment.
 *
 * The project spells the same FNV-1a 32-bit hash three ways: meta.db.json
 * stores it unpadded ("0x6516a"), the API canonicalizes it ("0x0006516a"),
 * and CommunityDragon's hash tables print it bare ("0006516a"). A page only
 * exists under one of those - whichever the DB happened to store - so a
 * lookup has to accept all of them and canonicalize before consulting
 * classHashes.json, which is keyed by the canonical form.
 *
 * Canonicalization matches canonHash() in scripts/generate-db.ts and canon()
 * in api/scripts/lib/resolver.ts.
 */

/** Hash in any spelling: optional "0x", 1-8 hex digits, either case throughout. */
const HASH_SEGMENT = /^(?:0[xX])?([0-9a-fA-F]{1,8})$/;

/**
 * Canonical hash for a URL segment that spells one, else null.
 * Bare hex is accepted: this only runs after an exact lookup already missed,
 * so a class actually named like hex would never reach it.
 */
export function parseClassHash(segment: string): string | null {
  const match = HASH_SEGMENT.exec(segment.trim());
  return match ? "0x" + match[1].toLowerCase().padStart(8, "0") : null;
}
