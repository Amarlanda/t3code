import { assert, describe, it } from "@effect/vitest";

import { isExpiredUiActivityFile } from "./UiActivityJournal.ts";

describe("isExpiredUiActivityFile", () => {
  const now = Date.parse("2026-11-03T08:00:00Z");

  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ["2026-11-03.ndjson", false],
    ["2026-11-02.ndjson", false],
    ["2026-11-01.ndjson", false],
    ["2026-10-31.ndjson", true],
    ["2025-12-31.ndjson", true],
    ["notes.txt", false],
  ];

  it("keeps today and the two previous days", () => {
    for (const [fileName, expired] of cases) {
      assert.strictEqual(isExpiredUiActivityFile(fileName, now, 3), expired, fileName);
    }
  });
});
