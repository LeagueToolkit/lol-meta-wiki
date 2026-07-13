/**
 * Formatting and highlighting of property default values (stored as JSON)
 */

import { codeToHtml } from "shiki";

// Width-aware JSON formatter: values that fit within INLINE_WIDTH render on
// one line ("[0, 0, 0]", "{ \"Blocks\": [] }"); only larger values expand,
// and short nested values stay inline within the expanded form.
const INLINE_WIDTH = 60;

function stringifyCompact(value: unknown, indent: string = ""): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const isArray = Array.isArray(value);
  const childIndent = indent + "  ";
  const items = isArray
    ? (value as unknown[]).map((v) => stringifyCompact(v, childIndent))
    : Object.entries(value as Record<string, unknown>).map(
        ([k, v]) => `${JSON.stringify(k)}: ${stringifyCompact(v, childIndent)}`
      );
  if (items.length === 0) return isArray ? "[]" : "{}";
  const inline = isArray ? `[${items.join(", ")}]` : `{ ${items.join(", ")} }`;
  if (!inline.includes("\n") && indent.length + inline.length <= INLINE_WIDTH) {
    return inline;
  }
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  return `${open}\n${items.map((i) => childIndent + i).join(",\n")}\n${indent}${close}`;
}

export function formatDefaultValue(defaultValue: string, ft: string): string {
  if (!defaultValue) return defaultValue;

  try {
    const parsed = JSON.parse(defaultValue);
    // Matrices read best as one row per line, even though they'd fit inline
    if (
      ft === "Mtx44" &&
      Array.isArray(parsed) &&
      parsed.every((row) => Array.isArray(row))
    ) {
      return `[${parsed.map((row) => `[${row.join(", ")}]`).join(",\n ")}]`;
    }
    return stringifyCompact(parsed);
  } catch {
    // Not valid JSON, return as-is
    return defaultValue;
  }
}

export async function highlightDefaultValue(
  formattedValue: string
): Promise<string> {
  try {
    return await codeToHtml(formattedValue, {
      lang: "json",
      theme: "github-dark",
    });
  } catch {
    // Fallback to plain text if highlighting fails
    return `<pre><code>${formattedValue}</code></pre>`;
  }
}
