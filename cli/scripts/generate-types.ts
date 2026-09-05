/**
 * Emits src/generated/api.ts from ../api/openapi.json via openapi-typescript,
 * so every request and response type the CLI uses is checked against the
 * Worker's contract at build time. The output is gitignored; run this before
 * typecheck, test and build (the package scripts already do).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const cliRoot = path.resolve(import.meta.dir, "..");
const spec = path.resolve(cliRoot, "..", "api", "openapi.json");
const out = path.join(cliRoot, "src", "generated", "api.ts");

const ast = await openapiTS(pathToFileURL(spec), {
  // The API spells "no value" as `null` in its schemas; keep that spelling.
  defaultNonNullable: false,
});
const header = "// Generated from api/openapi.json by scripts/generate-types.ts - do not edit.\n\n";
const next = header + astToString(ast);

fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out) && fs.readFileSync(out, "utf8") === next) {
  console.log(`up to date: ${path.relative(cliRoot, out)}`);
} else {
  fs.writeFileSync(out, next);
  console.log(`wrote ${path.relative(cliRoot, out)}`);
}
