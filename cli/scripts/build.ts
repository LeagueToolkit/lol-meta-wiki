/**
 * Bundles src/index.ts into dist/rito-meta.js: one shebanged ESM file that
 * runs on Node 22+ with no Bun and no runtime dependencies. The resolver and
 * transforms it shares with the api package are bundled in.
 */

import fs from "node:fs";
import path from "node:path";

const cliRoot = path.resolve(import.meta.dir, "..");
const outdir = path.join(cliRoot, "dist");
const outfile = path.join(outdir, "rito-meta.js");

fs.rmSync(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [path.join(cliRoot, "src", "index.ts")],
  outdir,
  naming: "rito-meta.js",
  target: "node",
  format: "esm",
  sourcemap: "none",
  banner: "#!/usr/bin/env node",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
if (process.platform !== "win32") fs.chmodSync(outfile, 0o755);
// The package ships under the repository's license; npm needs the file beside package.json.
fs.copyFileSync(path.join(cliRoot, "..", "LICENSE"), path.join(cliRoot, "LICENSE"));
const kb = (fs.statSync(outfile).size / 1024).toFixed(1);
console.log(`built ${path.relative(cliRoot, outfile)} (${kb} KB)`);
