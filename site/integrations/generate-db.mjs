// @ts-check
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const docsDir = path.join(repoRoot, "db", "docs");
const metaDb = path.join(repoRoot, "db", "meta.db.json");

/**
 * Runs scripts/generate-db.ts on dev-server start and re-runs it whenever
 * db/docs/*.yaml or db/meta.db.json changes. The generator only rewrites
 * files whose content changed, so Astro's own watcher picks up the resulting
 * MDX/JSON updates without spurious reloads. Production builds are covered
 * by the `prebuild` script instead.
 *
 * @returns {import('astro').AstroIntegration}
 */
export default function generateDb() {
  /** @type {Promise<void> | null} */
  let running = null;
  let rerunQueued = false;

  /**
   * @param {import('astro').AstroIntegrationLogger} logger
   * @returns {Promise<void>}
   */
  function runGenerator(logger) {
    if (running) {
      rerunQueued = true;
      return running;
    }
    running = /** @type {Promise<void>} */ (new Promise((resolve) => {
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
        logger.error(`failed to run generate-db: ${err.message}`);
        resolve(undefined);
      });
      child.on("close", (code) => {
        const summary = output.trim().split("\n").slice(-2).join(" ").trim();
        if (code === 0) logger.info(summary || "db regenerated");
        else logger.error(`generate-db exited with ${code}:\n${output}`);
        resolve(undefined);
      });
    })).then(() => {
      running = null;
      if (rerunQueued) {
        rerunQueued = false;
        return runGenerator(logger);
      }
    });
    return running;
  }

  return {
    name: "generate-db",
    hooks: {
      "astro:server:setup": ({ server, logger }) => {
        runGenerator(logger);

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
