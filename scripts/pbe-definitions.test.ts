import { expect, test } from "bun:test";
import { revisionAt } from "../site/src/utils/pbeHistory";

test("archived definitions retain type changes and removals at exact builds", () => {
  const versions = [{ patch: "16.22", build: 300 }, { patch: "16.22", build: 310 },
    { patch: "16.23", build: 400 }];
  const revisions = [{ from: 300, to: 300, type: "U32" }, { from: 310, to: 310, type: "F32" }];
  expect(revisionAt(revisions, 300, versions)?.type).toBe("U32");
  expect(revisionAt(revisions, 310, versions)?.type).toBe("F32");
  expect(revisionAt(revisions, 400, versions)).toBeUndefined();
  expect(revisionAt(revisions, 999, versions)).toBeUndefined();
});
