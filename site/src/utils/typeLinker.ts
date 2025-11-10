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

// Descriptions for primitive types (for tooltips)
const primitiveDescriptions: Record<string, string> = {
  "Bool": "Boolean value - true or false",
  "I8": "8-bit signed integer (-128 to 127)",
  "I16": "16-bit signed integer (-32,768 to 32,767)",
  "I32": "32-bit signed integer (-2,147,483,648 to 2,147,483,647)",
  "I64": "64-bit signed integer",
  "U8": "8-bit unsigned integer (0 to 255)",
  "U16": "16-bit unsigned integer (0 to 65,535)",
  "U32": "32-bit unsigned integer (0 to 4,294,967,295)",
  "U64": "64-bit unsigned integer",
  "F32": "32-bit floating point number (single precision)",
  "F64": "64-bit floating point number (double precision)",
  "String": "Text string value",
  "Hash": "Hash identifier (typically references a class type)",
  "Link": "Reference to another object instance",
  "Embed": "Embedded object data stored inline",
  "Flag": "Boolean flag value",
  "Vec2": "2-dimensional vector (x, y)",
  "Vec3": "3-dimensional vector (x, y, z)",
  "Vec4": "4-dimensional vector (x, y, z, w)",
  "Color": "RGBA color value",
};

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

  // Link the base type if it's a class or wrap primitives with tooltips
  let result: string;
  if (primitives.has(baseType)) {
    // Wrap primitive with tooltip if it has a description
    if (primitiveDescriptions[baseType]) {
      result = `<span class="primitive-type" data-tooltip="${primitiveDescriptions[baseType]}">${baseType}</span>`;
    } else {
      result = baseType;
    }
  } else if (classIndex[baseType]) {
    result = `<a href="${classIndex[baseType]}" class="type-link">${baseType}</a>`;
  } else {
    result = baseType;
  }

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
  kh: string,
  classIndex: Record<string, string>
): string {
  let display = linkType(ft, classIndex);

  // Types that should show hash reference as generic parameter
  const genericTypes = new Set(["Link", "Embed", "List", "Map", "Pointer"]);
  
  // For Link, Embed, List, Map, Pointer with hash reference, show as generic
  if (genericTypes.has(ft) && kh !== "0x0") {
    const khLinked = linkType(kh, classIndex);
    
    if (ft === "Map" && kt !== "0x0") {
      // Map<KeyType, ValueType>
      const ktLinked = linkType(kt, classIndex);
      display += `&lt;${ktLinked}, ${khLinked}&gt;`;
    } else {
      // Link<Type>, Embed<Type>, List<Type>, Pointer<Type>
      display += `&lt;${khLinked}&gt;`;
    }
  } 
  // For other types with hash reference, show as Container<Link<Type>>
  else if (kh !== "0x0") {
    const khLinked = linkType(kh, classIndex);
    // Check if the field type already has generic syntax
    if (!ft.includes("<")) {
      display += `&lt;Link&lt;${khLinked}&gt;&gt;`;
    }
  }
  // For containers with value types (fallback for other types)
  else if (vt !== "0x0") {
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

