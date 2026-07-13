/**
 * Build-time access to the class name → URL index.
 *
 * Parsed once per build process at module scope and shared across all page
 * renders — ClassDetails renders ~5,300 pages, so re-reading the ~260KB JSON
 * per page adds minutes to the build.
 */

import fs from "node:fs";
import { publicDir } from "astro:config/server";

export const classIndex: Record<string, string> = JSON.parse(
  fs.readFileSync(new URL("./db/classIndex.json", publicDir), "utf8")
);
