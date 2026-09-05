/**
 * Bin entry: wire the process to `run` and nothing more. Built into
 * dist/rito-meta.js with a `#!/usr/bin/env node` banner by scripts/build.ts.
 */

import os from "node:os";
import { run } from "./main";

// `rito-meta ... | head` closes stdout early; that is not an error worth a stack trace.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const result = await run(process.argv.slice(2), {
  fetch: (input, init) => globalThis.fetch(input, init),
  isTTY: process.stdout.isTTY === true,
  env: process.env,
  platform: process.platform,
  homedir: os.homedir(),
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code;
