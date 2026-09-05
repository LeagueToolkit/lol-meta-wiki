/**
 * argv -> command, positionals and flags. Hand-rolled so the bundle carries
 * no runtime dependency.
 */

import { DEFAULT_API } from "./http";
import { UsageError } from "./outcome";

export interface Flags {
  at?: string;
  db?: string;
  api?: string;
  cacheDir?: string;
  json: boolean;
  /** null = decide from the terminal. */
  color: boolean | null;
  cache: boolean;
  inherited: boolean;
  tree: boolean;
  help: boolean;
  version: boolean;
}

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Flags;
}

/** Flags that take a value: spelling on the command line -> field. */
const VALUE_FLAGS: Readonly<Record<string, "at" | "db" | "api" | "cacheDir">> = {
  at: "at",
  db: "db",
  api: "api",
  "cache-dir": "cacheDir",
};

/** Flags that take none: spelling -> what setting it means. */
const BOOL_FLAGS: Readonly<Record<string, (flags: Flags) => void>> = {
  json: (f) => (f.json = true),
  "no-color": (f) => (f.color = false),
  "no-cache": (f) => (f.cache = false),
  inherited: (f) => (f.inherited = true),
  tree: (f) => (f.tree = true),
  help: (f) => (f.help = true),
  version: (f) => (f.version = true),
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Flags = { json: false, color: null, cache: true, inherited: false, tree: false, help: false, version: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      flags.help = true;
    } else if (arg === "-V") {
      flags.version = true;
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const field = VALUE_FLAGS[name];
      const set = BOOL_FLAGS[name];
      if (field !== undefined) {
        const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (value === undefined) throw new UsageError(`--${name} needs a value`);
        flags[field] = value;
      } else if (set !== undefined) {
        if (eq !== -1) throw new UsageError(`--${name} takes no value`);
        set(flags);
      } else {
        throw new UsageError(`unknown flag ${arg}`);
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      throw new UsageError(`unknown flag ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

export const USAGE = `rito-meta - command-line client for the LoL Meta Wiki API

Usage: rito-meta <command> [args] [flags]

Commands
  property <Class>.<field>      What type this property is, at --at
  class <nameOrHash>            Hash, flags, bases, lifetime, properties
  hash <hashOrName>             Name to hash and back, plus the wiki URL
  search <pattern>              Find a class by substring or glob
  diff <from> <to>              Every property whose type changed across the span
  changelog [patch]             The patch index, or one patch in full
  versions                      The patch to build map, and the newest build covered
  docs <nameOrHash>|all         The CC BY-SA prose for one class, or all of it
  db fetch <path>               Download the raw database to <path>
  db check <path>               Compare <path> against the published generation
  raw <path>                    Any endpoint, verbatim (e.g. raw /v1/openapi)

A class or property may be given as a name or a hash (0x9a4b299d.0x0329f1d7);
<from>, <to>, [patch] and --at accept a build number (8104348) or a patch (16.17).

Flags
  --at <build|patch>    Answer as of this build or patch (property, class)
  --db <path>           Answer from a downloaded database instead of the network
  --json                Force JSON output (the default when stdout is not a terminal)
  --no-color            Plain text, no ANSI colors (NO_COLOR is honored too)
  --cache-dir <dir>     Where to keep ETag-validated responses (RITO_META_CACHE_DIR)
  --no-cache            Skip the response cache for this run
  --api <base-url>      API base URL (default ${DEFAULT_API})
  --inherited           class: include inherited properties, each stamped with its origin
  --tree                class: include the descendant tree
  -h, --help            Show this help
  -V, --version         Show the version

Exit codes
  0  answered                      3  class known, property not described
  1  error (network, arguments)    4  known, but no revision covers --at
  2  no such class                 5  build or patch outside the dataset's window
`;
