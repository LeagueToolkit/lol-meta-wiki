/**
 * What every command is given and what every command returns, plus the
 * answers several commands share (no such class, outside the window).
 */

import { HEX, canon } from "../../../api/scripts/lib/resolver";
import type { ApiClass, ApiProperty } from "../api-types";
import type { Flags } from "../args";
import type { RevisionAt } from "../at";
import type { ApiClient } from "../http";
import { type Outcome, UsageError } from "../outcome";
import type { Fmt } from "../output";
import type { ApiSource, Source } from "../source";
import { formatType } from "../tags";
import type { At, VersionMap } from "../versions";

export interface Context {
  /** Where this run answers from: the API, or the `--db` file. */
  source: Source;
  /** The API, even under `--db` (`db check` compares against it). */
  online: ApiSource;
  /** The network client behind `online`, for the verbatim and bulk paths. */
  client: ApiClient;
  flags: Flags;
}

export interface Answer {
  outcome: Outcome;
  /** JSON fields under the envelope. */
  payload: Record<string, unknown>;
  /** Terminal rendering. */
  text(fmt: Fmt): string;
  /** When set, printed as-is in both modes with no envelope (`raw`). */
  verbatim?: string;
  /** Overrides the outcome's exit code (`raw` mirrors HTTP status). */
  code?: number;
}

export type Command = (ctx: Context, args: string[]) => Promise<Answer>;

export function expectArgs(command: string, args: string[], min: number, max: number, usage: string): void {
  if (args.length < min || args.length > max) throw new UsageError(`${command} takes ${usage}`);
}

export const atText = (at: At): string =>
  `build ${at.build}, patch ${at.patch}` + (at.requestedBuild !== undefined ? ` (nearest observed build before ${at.requestedBuild})` : "");

/** The `{ name, hash }` pair every class-scoped payload names the class by. */
export const classRef = (cls: ApiClass) => ({ name: cls.name, hash: cls.hash });

export function noSuchClass(query: string): Answer {
  return {
    outcome: "no-such-class",
    payload: { class: query },
    text: (fmt) => `no such class: ${fmt.name(query)}`,
  };
}

/** The exit-5 answer: `input` (a build or patch) is outside the dataset's window. */
export function outsideWindow(vm: VersionMap, input: string, reason: "before-window" | "after-window"): Answer {
  return {
    outcome: "outside-window",
    payload: { at: input, reason, window: { first: vm.first, latest: vm.latest } },
    text: (fmt) =>
      `${fmt.bold(input)} is ${reason === "before-window" ? "before" : "after"} the dataset's window ` +
      `(${atText(vm.first)} .. ${atText(vm.latest)})`,
  };
}

/**
 * A build number or patch as a point in time, or the outside-window answer.
 * `what` names the argument in the usage error for nonsense input.
 */
export function resolvePoint(vm: VersionMap, input: string, what: string): { at: At } | { answer: Answer } {
  const res = vm.resolve(input);
  if (res.ok) return { at: res.at };
  if (res.reason === "invalid") {
    throw new UsageError(`${what} expects a build number or a patch inside the dataset (${vm.first.patch} .. ${vm.latest.patch}), got ${input}`);
  }
  return { answer: outsideWindow(vm, input, res.reason) };
}

/** `--at` as a point in time, the latest build when absent, or the outside-window answer. */
export function resolveAt(vm: VersionMap, input: string | undefined): { at: At } | { answer: Answer } {
  return input === undefined ? { at: vm.latest } : resolvePoint(vm, input, "--at");
}

/**
 * The classes that define a flattened view's inherited properties, by name,
 * so an inherited property is dated by the class it lives on rather than by
 * the class it was asked through.
 */
export async function definingClasses(source: Source, cls: ApiClass): Promise<Map<string, ApiClass>> {
  const owners = new Map<string, ApiClass>([[cls.name, cls]]);
  for (const p of cls.properties) {
    if (p.from === undefined || owners.has(p.from)) continue;
    owners.set(p.from, (await source.class(p.from, false)) ?? cls);
  }
  return owners;
}

/** A property by exact name, or by hash in any spelling. */
export function findProperty(cls: ApiClass, field: string): ApiProperty | undefined {
  if (HEX.test(field)) {
    const hash = canon(field);
    return cls.properties.find((p) => p.hash === hash);
  }
  return cls.properties.find((p) => p.name === field);
}

/** Rows for a history table: `since .. until  Type (tag)`. */
export function historyRows(history: readonly RevisionAt[]): string[][] {
  return history.map((h) => [`${h.since ?? "start"} .. ${h.until ?? "now"}`, typeText(h.type)]);
}

export const typeText = (t: RevisionAt["type"]): string => `${formatType(t)} (${t.tag ?? "?"})`;

export const historyPayload = (history: readonly RevisionAt[]) =>
  history.map((h) => ({ since: h.since, until: h.until, type: h.type, ...(h.defaultValue !== undefined && { defaultValue: h.defaultValue }) }));
