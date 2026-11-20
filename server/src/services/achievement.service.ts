import { RuntimeContext } from '#src/context';
import { AchievementEntrySchema, AchievementsSchema } from '#src/protocol/generated/profile_pb';
import { immediate } from '#src/db/transaction';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { resolve } from 'node:path';
import { Context, Effect, Layer, Schema } from 'effect';

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;

  const loadAchievements = Effect.fn('AchievementService.loadAchievements')(function* (id: number) {
    const stored = repositories.riderDocuments.get(id, 'achievements.bin');
    const exists = stored !== null;
    const achievements = stored ? fromBinary(AchievementsSchema, stored) : create(AchievementsSchema);

    let changed = !exists;

    if (!exists) {
      const saved = context.profiles.get(id).savedGame;

      if (saved.length > 0x1_50 && saved[0x1_08] === 2) {
        const bits = saved.subarray(0x1_10, 0x1_50);

        for (let badge = 0; badge < bits.length * 8; badge++) {
          if (((bits[Math.floor(badge / 8)] ?? 0) >> badge % 8) & 1) {
            achievements.achievements.push(create(AchievementEntrySchema, { id: badge }));
          }
        }
      }
    }

    const count = repositories.recordsRepository.routeBadgeCount(id);

    for (const [minimum, badge] of [
      [1, 211],
      [10, 212],
      [25, 213],
    ] as const) {
      if (!(count >= minimum && achievements.achievements.every((item) => item.id !== badge))) {
        continue;
      }

      achievements.achievements.push(create(AchievementEntrySchema, { id: badge }));
      changed = true;
    }

    if (changed) {
      repositories.riderDocuments.put(id, 'achievements.bin', toBinary(AchievementsSchema, achievements));
    }

    return achievements;
  });

  const backfillRoutes = Effect.fn('AchievementService.backfillRoutes')(function* (id: number) {
    const achievements = yield* loadAchievements(id);

    const dictionary = Schema.decodeUnknownSync(
      Schema.Struct({ achievements: Schema.Record(Schema.String, Schema.Int) }),
    )(
      JSON.parse(
        repositories.filesRepository.readFileSync(resolve(context.assets, 'data/game_dictionary.txt'), 'utf8'),
      ),
    );

    immediate(context.accounts.db, () => {
      for (const badge of achievements.achievements) {
        const hash = dictionary.achievements[String(badge.id)];

        if (hash !== undefined) {
          repositories.recordsRepository.ensureRoute(id, hash);
        }
      }
    });
  });

  return { loadAchievements, backfillRoutes };
});

/** Per rider, missing file bootstraps saved-game unlocks; membership only grows through
threshold/report events. Import replaces this state externally; reads may backfill routes.
*/
export class AchievementService extends Context.Service<AchievementService, Effect.Success<typeof make>>()(
  'zluggish/AchievementService',
) {
  static readonly layer = Layer.effect(AchievementService, make);
}
