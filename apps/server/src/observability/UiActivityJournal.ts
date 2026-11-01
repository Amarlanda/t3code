import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

const UI_ACTIVITY_RETENTION_DAYS = 3;
const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UiActivityEvent = Readonly<Record<string, unknown>>;

export class UiActivityJournal extends Context.Service<
  UiActivityJournal,
  {
    readonly append: (events: ReadonlyArray<UiActivityEvent>) => Effect.Effect<void>;
  }
>()("t3/observability/UiActivityJournal") {}

const utcDay = (unixMs: number) => DateTime.formatIso(DateTime.makeUnsafe(unixMs)).slice(0, 10);

/** Days kept: today plus the previous `retentionDays - 1`, so older files are deleted. */
export const isExpiredUiActivityFile = (fileName: string, nowMs: number, retentionDays: number) => {
  const day = FILE_PATTERN.exec(fileName)?.[1];
  return day !== undefined && day < utcDay(nowMs - (retentionDays - 1) * DAY_MS);
};

const make = Effect.fn("UiActivityJournal.make")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const writeLock = yield* Semaphore.make(1);
  const lastPrunedDay = yield* Ref.make<string | null>(null);

  const prune = Effect.fn("UiActivityJournal.prune")(function* (nowMs: number) {
    const entries = yield* fs.readDirectory(directory);
    yield* Effect.forEach(
      entries.filter((entry) => isExpiredUiActivityFile(entry, nowMs, UI_ACTIVITY_RETENTION_DAYS)),
      (entry) => fs.remove(path.join(directory, entry)),
      { discard: true },
    );
  });

  const append = Effect.fn("UiActivityJournal.append")(
    function* (events: ReadonlyArray<UiActivityEvent>) {
      if (events.length === 0) return;
      const now = yield* DateTime.now;
      const nowMs = DateTime.toEpochMillis(now);
      const day = utcDay(nowMs);
      const receivedAt = DateTime.formatIso(now);
      const body =
        events.map((event) => JSON.stringify({ receivedAt, ...event })).join("\n") + "\n";
      yield* writeLock.withPermits(1)(
        Effect.gen(function* () {
          yield* fs.makeDirectory(directory, { recursive: true });
          yield* fs.writeFileString(path.join(directory, `${day}.ndjson`), body, { flag: "a" });
          if ((yield* Ref.get(lastPrunedDay)) !== day) {
            yield* prune(nowMs);
            yield* Ref.set(lastPrunedDay, day);
          }
        }),
      );
    },
    Effect.catch((cause) => Effect.logWarning("ui activity journal write failed", { cause })),
  );

  return UiActivityJournal.of({ append });
});

export const layer = Layer.effect(
  UiActivityJournal,
  Effect.gen(function* () {
    const { serverTracePath } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return yield* make(path.join(path.dirname(serverTracePath), "ui-activity"));
  }),
);
