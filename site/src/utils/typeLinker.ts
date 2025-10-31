/**
 * Utilities for linking types to their class documentation pages
 */

// Primitives that shouldn't be linked
const primitives = new Set([
  "Bool",
  "I8",
  "I16",
  "I32",
  "I64",
  "U8",
  "U16",
  "U32",
  "U64",
  "F32",
  "F64",
  "String",
  "Hash",
  "Link",
  "Embed",
  "Flag",
  "Vec2",
  "Vec3",
  "Vec4",
  "Color",
  "0x0",
]);

/**
 * Parse and link types recursively
 * Handles container types like List<Type>, Map<Key, Value>
 */
export function linkType(
  type: string,
  classIndex: Record<string, string>
): string {
  if (!type || type === "0x0") return "";

  // Handle container types: List<Type>, Map<Key, Value>, etc.
  const containerMatch = type.match(/^([A-Za-z0-9_]+)(?:<(.+)>)?$/);
  if (!containerMatch) return type;

  const [, baseType, innerTypes] = containerMatch;

  // Link the base type if it's a class
  let result =
    primitives.has(baseType) || !classIndex[baseType]
      ? baseType
      : `<a href="${classIndex[baseType]}" class="type-link">${baseType}</a>`;

  // Handle generic types
  if (innerTypes) {
    // Split by comma, but respect nested brackets
    const parts: string[] = [];
    let depth = 0;
    let current = "";

    for (const char of innerTypes) {
      if (char === "<") depth++;
      else if (char === ">") depth--;
      else if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    if (current) parts.push(current.trim());

    const linkedParts = parts
      .map((p) => linkType(p, classIndex))
      .join(", ");
    result += `&lt;${linkedParts}&gt;`;
  }

  return result;
}

/**
 * Create a type display with proper linking for field types
 */
export function typeDisplay(
  ft: string,
  vt: string,
  kt: string,
  classIndex: Record<string, string>
): string {
  let display = linkType(ft, classIndex);

  // For containers with value types
  if (vt !== "0x0") {
    // Check if the field type already has generic syntax
    if (!ft.includes("<")) {
      display += `&lt;${linkType(vt, classIndex)}&gt;`;
    }
  }

  return `<span class="type-chip">${display}</span>`;
}

/**
 * Create a link chip for class references
 */
export function refChip(
  refClass: string,
  classIndex: Record<string, string>
): string {
  if (classIndex[refClass]) {
    return `<a href="${classIndex[refClass]}" class="chip chip-link">${refClass}</a>`;
  }
  return `<span class="chip">${refClass}</span>`;
}

