/**
 * The one seam: argv plus an injected environment in, stdout/stderr/exit
 * code out. The bin (index.ts) wires it to the process; the tests drive it
 * directly with a fixture fetch. Nothing reaches past this function.
 */

import pkg from "../package.json";
import { type Flags, USAGE, parseArgs } from "./args";
import { DiskCache, defaultCacheDir } from "./cache";
import { changelog } from "./commands/changelog";
import { classCommand } from "./commands/class";
import { db } from "./commands/db";
import { diff } from "./commands/diff";
import { docs } from "./commands/docs";
import { hash } from "./commands/hash";
import { property } from "./commands/property";
import { raw } from "./commands/raw";
import { search } from "./commands/search";
import type { Command } from "./commands/shared";
import { versions } from "./commands/versions";
import { ApiClient, DEFAULT_API, type FetchLike } from "./http";
import { LocalSource } from "./local";
import { CliError, EXIT_CODE, EXIT_ERROR, UsageError } from "./outcome";
import { makeFmt } from "./output";
import { ApiSource, type Source } from "./source";

export const VERSION: string = pkg.version;
const USER_AGENT = `rito-meta/${VERSION} (+https://github.com/LeagueToolkit/lol-meta-wiki)`;

export interface RunIo {
  fetch: FetchLike;
  /** Whether stdout is a terminal: tables and color on, JSON off. */
  isTTY: boolean;
  env: Record<string, string | undefined>;
  platform: string;
  homedir: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

const COMMANDS: Readonly<Record<string, Command>> = {
  property,
  class: classCommand,
  hash,
  search,
  diff,
  changelog,
  versions,
  docs,
  db,
  raw,
};

/** Flags that only some commands understand; anywhere else they are a mistake, not noise. */
const FLAG_SCOPE: readonly { flag: string; isSet: (flags: Flags) => boolean; commands: readonly string[] }[] = [
  { flag: "at", isSet: (f) => f.at !== undefined, commands: ["property", "class"] },
  { flag: "inherited", isSet: (f) => f.inherited, commands: ["class"] },
  { flag: "tree", isSet: (f) => f.tree, commands: ["class"] },
];

function checkFlagScope(command: string, flags: Flags): void {
  for (const { flag, isSet, commands } of FLAG_SCOPE) {
    if (isSet(flags) && !commands.includes(command)) throw new UsageError(`--${flag} applies to ${commands.join(" and ")}, not ${command}`);
  }
}

export async function run(argv: readonly string[], io: RunIo): Promise<RunResult> {
  try {
    const { command, positionals, flags } = parseArgs(argv);
    if (flags.version) return { stdout: `rito-meta ${VERSION}\n`, stderr: "", code: 0 };
    if (flags.help) return { stdout: USAGE, stderr: "", code: 0 };
    if (command === undefined) return { stdout: "", stderr: USAGE, code: EXIT_ERROR };
    const handler = COMMANDS[command];
    if (!handler) throw new UsageError(`unknown command ${command}`);
    checkFlagScope(command, flags);

    const json = flags.json || !io.isTTY;
    const color = !json && (flags.color ?? (io.isTTY && !io.env["NO_COLOR"]));
    const cache = flags.cache ? new DiskCache(flags.cacheDir ?? defaultCacheDir(io)) : null;
    const client = new ApiClient({
      baseUrl: flags.api ?? io.env["RITO_META_API"] ?? DEFAULT_API,
      fetch: io.fetch,
      cache,
      userAgent: USER_AGENT,
    });
    const online = new ApiSource(client);
    const source: Source = flags.db !== undefined ? LocalSource.open(flags.db) : online;

    const answer = await handler({ source, online, client, flags }, positionals);
    const code = answer.code ?? EXIT_CODE[answer.outcome];
    if (answer.verbatim !== undefined) return { stdout: withNewline(answer.verbatim), stderr: "", code };

    const dataset = await source.dataset();
    if (json) {
      const envelope = { outcome: answer.outcome, api: dataset.api, generation: dataset.generation, source: source.label, ...answer.payload };
      return { stdout: JSON.stringify(envelope, null, 2) + "\n", stderr: "", code };
    }
    const fmt = makeFmt(color);
    const footer = fmt.dim(`generation ${dataset.generation ?? "unknown"}  api ${dataset.api}  ${source.label}`);
    return { stdout: `${answer.text(fmt)}\n${footer}\n`, stderr: "", code };
  } catch (err) {
    if (err instanceof CliError) {
      return { stdout: "", stderr: `rito-meta: ${err.message}\n${err.hint ? `  ${err.hint}\n` : ""}`, code: EXIT_ERROR };
    }
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return { stdout: "", stderr: `rito-meta: unexpected error\n${detail}\n`, code: EXIT_ERROR };
  }
}

const withNewline = (s: string) => (s.endsWith("\n") ? s : `${s}\n`);
