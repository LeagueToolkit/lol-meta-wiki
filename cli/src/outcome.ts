/**
 * The exit-code taxonomy: silence and disagreement get different codes, so a
 * script can tell "the database says this is wrong" from "the database says
 * nothing" without parsing prose.
 */

export type Outcome =
  | "ok"
  | "no-such-class"
  | "no-such-property"
  | "not-documented"
  | "not-at-build"
  | "no-changelog"
  | "outside-window"
  | "stale";

export const EXIT_CODE: Readonly<Record<Outcome, number>> = Object.freeze({
  ok: 0,
  /** The class name or hash is not in the dataset. */
  "no-such-class": 2,
  /** The class is known; the property is not described on it. */
  "no-such-property": 3,
  /** The class is known; nobody has written prose for it. */
  "not-documented": 3,
  /** The class or property is known; no revision covers the build asked for. */
  "not-at-build": 4,
  /** The patch is inside the window but has no changelog (the first tracked patch). */
  "no-changelog": 4,
  /** The build or patch is outside the dataset's observation window. */
  "outside-window": 5,
  /** `db check`: the local database's generation differs from the published one. */
  stale: 5,
});

/** Exit code for anything that is not an answer: network, arguments, unreadable input. */
export const EXIT_ERROR = 1;

/** An error the user can act on; rendered as one line on stderr, exit 1. */
export class CliError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "CliError";
    this.hint = hint;
  }
}

/** Bad arguments; additionally points the user at `--help`. */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, "run `rito-meta --help` for usage");
    this.name = "UsageError";
  }
}
