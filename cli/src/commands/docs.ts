/**
 * `docs <nameOrHash>` / `docs all` - the human-authored prose for a class.
 *
 * This is the one command that serves CC BY-SA 4.0 content; the payload says
 * so. `all` is routed deliberately, since the API reserves it as a name.
 */

import type { ApiClassDocs, ApiDocEntry } from "../api-types";
import { indent } from "../output";
import { type Answer, type Command, classRef, expectArgs, noSuchClass } from "./shared";

const LICENSE = "CC BY-SA 4.0";

export const docs: Command = async (ctx, args) => {
  expectArgs("docs", args, 1, 1, "one argument: <nameOrHash>, or all");
  const query = args[0]!;
  if (query === "all") {
    const all = await ctx.source.docsAll();
    const names = Object.keys(all).sort();
    return {
      outcome: "ok",
      payload: { license: LICENSE, count: names.length, docs: all },
      text: (fmt) => names.map((n) => renderDocs(all[n]!, fmt)).join("\n\n"),
    };
  }

  const doc = await ctx.source.docs(query);
  if (!doc) {
    const cls = await ctx.source.class(query, false);
    if (!cls) return noSuchClass(query);
    const answer: Answer = {
      outcome: "not-documented",
      payload: { class: classRef(cls) },
      text: (fmt) => `${fmt.name(cls.name)} has no written documentation yet`,
    };
    return answer;
  }
  return {
    outcome: "ok",
    payload: { license: LICENSE, docs: doc },
    text: (fmt) => renderDocs(doc, fmt),
  };
};

function renderEntry(e: ApiDocEntry): string {
  const lines: string[] = [];
  if (e.description) lines.push(e.description);
  for (const n of e.notes ?? []) lines.push(`note: ${n}`);
  for (const x of e.examples ?? []) lines.push(`example: ${x}`);
  return lines.join("\n");
}

function renderDocs(doc: ApiClassDocs, fmt: Parameters<Answer["text"]>[0]): string {
  let out = fmt.bold(fmt.name(doc.name));
  if (doc.class) out += "\n" + indent(renderEntry(doc.class));
  for (const [name, entry] of Object.entries(doc.properties).sort(([a], [b]) => a.localeCompare(b))) {
    out += `\n\n${indent(fmt.name(name))}\n${indent(renderEntry(entry), 4)}`;
  }
  return out;
}
