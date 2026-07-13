import { Marked } from "marked";

// Docs content comes from hand-written YAML files in db/docs and is rendered
// at build time, so no sanitization pass is needed.
const marked = new Marked({ gfm: true });

/** Render markdown to HTML (block-level: paragraphs, tables, lists, code fences). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  // Wrap tables in a scroll container so wide tables scroll horizontally
  // instead of overflowing their card. GFM tables never nest, so plain
  // string replacement is safe here.
  return html
    .replaceAll("<table>", '<div class="md-table-scroll"><table>')
    .replaceAll("</table>", "</table></div>");
}

/**
 * Render a markdown snippet for use inside an inline container such as <li>.
 * A lone wrapping paragraph is unwrapped; multi-block content is kept as-is.
 */
export function renderMarkdownSnippet(md: string): string {
  const html = renderMarkdown(md).trim();
  const single = /^<p>([\s\S]*)<\/p>$/.exec(html);
  return single && !single[1].includes("</p>") ? single[1] : html;
}
