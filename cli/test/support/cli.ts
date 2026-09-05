/**
 * Drives the one seam (`run`) against the fixture API. Every test goes
 * through here: no subprocess, no network, no reaching into internals.
 */

import path from "node:path";
import { run, type RunResult } from "../../src/main";
import { FIXTURES, fixtureFetch } from "./fixture-api.mjs";

export const API = "http://fixture.test";
/** The trimmed raw database, for `--db`. */
export const DB = path.join(FIXTURES, "db.json");

export interface Request {
  url: string;
  headers: Record<string, string>;
}

export interface CliOptions {
  /** Pretend stdout is a terminal (tables, color). Default: a pipe. */
  tty?: boolean;
  env?: Record<string, string>;
  platform?: string;
  homedir?: string;
  /** Use this cache directory instead of `--no-cache`. */
  cacheDir?: string;
  /** Let the run pick its own cache directory (neither `--no-cache` nor `--cache-dir`). */
  defaultCache?: boolean;
  /** Receives every request the run made. */
  requests?: Request[];
  /** Replace the fixture fetch, e.g. to simulate a network failure. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface CliResult extends RunResult {
  /** The parsed stdout; throws if it is not JSON. */
  json: <T = Record<string, unknown>>() => T;
}

export async function cli(args: string[], opts: CliOptions = {}): Promise<CliResult> {
  const cacheArgs = opts.cacheDir ? ["--cache-dir", opts.cacheDir] : opts.defaultCache ? [] : ["--no-cache"];
  const result = await run([...args, "--api", API, ...cacheArgs], {
    fetch: opts.fetch ?? fixtureFetch((req: Request) => opts.requests?.push(req)),
    isTTY: opts.tty ?? false,
    env: opts.env ?? {},
    platform: opts.platform ?? "linux",
    homedir: opts.homedir ?? "/home/test",
  });
  return { ...result, json: <T>() => JSON.parse(result.stdout) as T };
}

/** Everything in a payload except the fields that legitimately differ between sources. */
export function comparable(payload: Record<string, unknown>): Record<string, unknown> {
  const { source: _source, ...rest } = payload;
  return rest;
}
