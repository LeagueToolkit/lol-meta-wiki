/**
 * `db fetch <path>` downloads `/v1/db`; `db check <path>` compares a
 * downloaded copy against the published generation without downloading
 * the body again (only `/v1` is fetched).
 */

import fs from "node:fs";
import path from "node:path";
import { readMetaDb } from "../local";
import { CliError, UsageError } from "../outcome";
import { keyValues } from "../output";
import { VersionMap } from "../versions";
import { type Answer, type Command, type Context, atText } from "./shared";

export const db: Command = async (ctx, args) => {
  const [sub, ...rest] = args;
  if (sub === "fetch") return fetchDb(ctx, rest);
  if (sub === "check") return checkDb(ctx, rest);
  throw new UsageError(`db takes a subcommand: fetch <path> or check <path>`);
};

async function fetchDb(ctx: Context, args: string[]): Promise<Answer> {
  if (args.length !== 1) throw new UsageError("db fetch takes one argument: <path>");
  const target = args[0]!;
  const res = await ctx.client.get("/v1/db", { cache: false });
  if (res.status !== 200) throw new CliError(`${ctx.client.url("/v1/db")} answered ${res.status}`);
  const bytes = Buffer.byteLength(res.text);
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, res.text);
  const local = readMetaDb(target);
  const generation = local.hashSource?.fetchedAt ?? null;
  const latest = new VersionMap(local.versions).latest;
  return {
    outcome: "ok",
    payload: { path: target, bytes, etag: res.etag, generation, latest },
    text: (fmt) =>
      keyValues([
        ["wrote", fmt.bold(target)],
        ["bytes", String(bytes)],
        ["generation", generation ?? "unknown"],
        ["latest", atText(latest)],
        ["etag", res.etag ?? "-"],
      ]),
  };
}

async function checkDb(ctx: Context, args: string[]): Promise<Answer> {
  const target = args[0] ?? ctx.flags.db;
  if (args.length > 1 || target === undefined) throw new UsageError("db check takes one argument: <path>");
  const localDb = readMetaDb(target);
  const dataset = await ctx.online.dataset();
  const local = { generation: localDb.hashSource?.fetchedAt ?? null, latest: new VersionMap(localDb.versions).latest };
  const published = { generation: dataset.generation, latest: dataset.latest };
  const current = local.generation === published.generation && local.latest.build === published.latest.build;
  return {
    outcome: current ? "ok" : "stale",
    payload: { path: target, current, local, published },
    text: (fmt) =>
      `${fmt.bold(target)} is ${current ? "current" : "stale"}\n` +
      keyValues([
        ["local", `generation ${local.generation ?? "unknown"}, ${atText(local.latest)}`],
        ["published", `generation ${published.generation ?? "unknown"}, ${atText(published.latest)}`],
      ]).replace(/^/gm, "  "),
  };
}
