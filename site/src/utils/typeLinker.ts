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
  "Mtx44": "4×4 transformation matrix",
  "File": "Reference to a game file",
  "Option": "Optional value - may be absent",
  "List": "Ordered collection of values",
  "List2": "Ordered collection of values",
  "Map": "Key → value dictionary",
  "Pointer": "Polymorphic reference - holds any subclass of the target type",
};

/**
 * Format a type-kind slot (ft/kt/vt). These are always BinType kind names
 * ("Map", "F32", …), never classes - a class named "Map" exists, so matching
 * these slots against the class index would link every Map<…> container to
 * that class's page. Kinds render as plain text, with a tooltip when known.
 */
function formatKind(type: string): string {
  if (!type || type === "0x0") return "";
  if (primitiveDescriptions[type]) {
    return `<span class="primitive-type" data-tooltip="${primitiveDescriptions[type]}">${type}</span>`;
  }
  return type;
}

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
 * Create a type display with proper linking for field types.
 *
 * Takes the field-type tuple as an object rather than four positional strings:
 * `ft`, `kt`, `vt`, `kh` are all strings and easy to transpose, and any
 * consumer already holds them together (Property, TypeHistoryEntry, ChangeTuple
 * all satisfy this shape).
 *
 * The tuple spells a container's element type in `kh` when it resolves to a
 * class (Embed/Link/Pointer targets) and in `vt` otherwise, so one slot fills
 * the single generic parameter of List/List2/Option/Link/Embed/Pointer. A Map
 * carries its key kind in `kt` on top of that, and renders both slots:
 * `Map<KeyKind, Value>`. `kt` is only a key for maps - on a `List` it is the
 * fixed element count, so it never reaches the display.
 */
export function typeDisplay(
  t: { ft: string; kt: string; vt: string; kh: string },
  classIndex: Record<string, string>
): string {
  const { ft, kt, vt, kh } = t;
  // ft is a kind, never a class - only kh can reference one (see formatKind)
  let display = formatKind(ft);

  // Element slot: the referenced class when the tuple names one, else the
  // value kind. Empty for a plain scalar field, where both slots are 0x0.
  const element = kh !== "0x0" ? linkType(kh, classIndex) : formatKind(vt);
  const params = (ft === "Map" ? [formatKind(kt), element] : [element]).filter(
    Boolean
  );
  if (params.length) display += `&lt;${params.join(", ")}&gt;`;

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

