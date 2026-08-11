// @ts-check
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const docsDir = path.join(repoRoot, "db", "docs");
const metaDb = path.join(repoRoot, "db", "meta.db.json");

/**
 * Owns every run of scripts/generate-db.ts.
 *
 * The class/changelog MDX pages and the db-data/ JSON they point at are
 * generated and NOT tracked in git, so generation is a build prerequisite,
 * not a convention: the `astro:config:setup` hook is awaited and fires for
 * `dev`, `build`, `sync` and `check`, which puts the pages on disk before
 * Astro globs the docs collection. There is deliberately no `prebuild`
 * script - one owner of generation beats two.
 *
 * On top of that, the dev server re-runs the generator whenever
 * db/docs/*.yaml or db/meta.db.json changes. The generator only rewrites
 * files whose content changed, so Astro's own watcher picks up the resulting
 * MDX/JSON updates without spurious reloads.
 *
 * @returns {import('astro').AstroIntegration}
 */
export default function generateDb() {
  /** @type {Promise<string | null> | null} */
  let running = null;
  let rerunQueued = false;

  /**
   * Runs the generator once, coalescing calls that arrive while one is in
   * flight into a single re-run. Resolves with an error message when the run
   * failed and null when it succeeded - the caller decides whether that is
   * fatal (it is at config:setup, it isn't for a watcher re-run).
   *
   * @param {import('astro').AstroIntegrationLogger} logger
   * @returns {Promise<string | null>}
   */
  function runGenerator(logger) {
    if (running) {
      rerunQueued = true;
      return running;
    }
    running = /** @type {Promise<string | null>} */ (new Promise((resolve) => {
      // Single command string + shell so Windows resolves bun's .cmd shim.
      const child = spawn("bun scripts/generate-db.ts --pretty 1", {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("error", (err) => {
        const message = `failed to run generate-db: ${err.message}`;
        logger.error(message);
        resolve(message);
      });
      child.on("close", (code) => {
        const summary = output.trim().split("\n").slice(-2).join(" ").trim();
        if (code === 0) {
          logger.info(summary || "db regenerated");
          resolve(null);
          return;
        }
        logger.error(`generate-db exited with ${code}:\n${output}`);
        resolve(`generate-db exited with ${code}`);
      });
    })).then((error) => {
      running = null;
      if (rerunQueued) {
        rerunQueued = false;
        return runGenerator(logger);
      }
      return error;
    });
    return running;
  }

  return {
    name: "generate-db",
    hooks: {
      // Awaited, and fires for dev/build/sync/check alike - the generated
      // pages must exist before Astro globs the docs collection. A failed run
      // leaves the docs collection missing thousands of routes, which would
      // otherwise build "successfully" as a handful of hand-written pages, so
      // it takes the command down with it.
      "astro:config:setup": async ({ logger }) => {
        const error = await runGenerator(logger);
        if (error) throw new Error(error);
      },

      // Initial generation already happened in astro:config:setup; this only
      // wires up the re-run on source changes.
      "astro:server:setup": ({ server, logger }) => {
        server.watcher.add([docsDir, metaDb]);

        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let debounce;
        const onFsEvent = (/** @type {string} */ file) => {
          const resolved = path.resolve(file);
          const isDocsYaml =
            resolved.startsWith(docsDir + path.sep) && resolved.endsWith(".yaml");
          if (!isDocsYaml && resolved !== metaDb) return;
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            logger.info(`${path.relative(repoRoot, file)} changed, regenerating db...`);
            runGenerator(logger);
          }, 150);
        };
        server.watcher.on("add", onFsEvent);
        server.watcher.on("change", onFsEvent);
        server.watcher.on("unlink", onFsEvent);
      },
    },
  };
}
