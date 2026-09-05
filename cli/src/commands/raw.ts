/**
 * `raw <path>` - any endpoint, verbatim. The escape hatch so a missing
 * subcommand never forces a consumer back to hand-rolled fetches. The exit
 * code mirrors the status: 0 for 2xx, 2 for 404, 1 otherwise.
 */

import { UsageError } from "../outcome";
import { type Command, expectArgs } from "./shared";

export const raw: Command = async (ctx, args) => {
  expectArgs("raw", args, 1, 1, "one argument: an endpoint path such as /v1/versions");
  const path = args[0]!;
  if (!path.startsWith("/")) throw new UsageError(`expected a path starting with /, got ${path}`);
  const res = await ctx.client.get(path);
  const code = res.status >= 200 && res.status < 300 ? 0 : res.status === 404 ? 2 : 1;
  return {
    outcome: code === 2 ? "no-such-class" : "ok",
    code,
    payload: {},
    verbatim: res.text,
    text: () => res.text,
  };
};
