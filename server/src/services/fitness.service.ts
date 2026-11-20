import { RuntimeContext } from '#src/context';
import { goalSchema } from '#src/dtos/fitness.dto';

import { BestEffortPointMsgSchema, PowerCurveAggregationMsgSchema } from '#src/protocol/generated/profile_pb';
import type { FitnessRepository } from '#src/repositories/fitness.repository';
import { StreakService } from '#src/services/streak.service';
import { create } from '@bufbuild/protobuf';
import { Context, Effect, Layer, Schema } from 'effect';

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;
  const streakService = yield* StreakService;

  const findActivity = Effect.fn('FitnessService.findActivity')(function* (
    ...values: Parameters<FitnessRepository['findActivity']>
  ) {
    return repositories.fitnessRepository.findActivity(...values);
  });

  function totals(id: number, start: number, end: number) {
    const row = Schema.decodeUnknownSync(
      Schema.Struct({
        distance: Schema.NullOr(Schema.Finite),
        elevation: Schema.NullOr(Schema.Finite),
        moving: Schema.NullOr(Schema.Finite),
        work: Schema.NullOr(Schema.Finite),
        calories: Schema.NullOr(Schema.Finite),
        tss: Schema.NullOr(Schema.Finite),
      }),
    )(repositories.fitnessRepository.findActivity(id, new Date(start).toISOString(), new Date(end).toISOString()));

    return {
      distance: row.distance ?? 0,
      elevation: Math.trunc(row.elevation ?? 0),
      movingTime: Math.round((row.moving ?? 0) / 10_000) * 10_000,
      work: Math.trunc(row.work ?? 0),
      calories: Math.trunc(row.calories ?? 0),
      tss: row.tss ?? 0,
      duration: row.moving ?? 0,
    };
  }

  function ewma(id: number, date: number, days: number) {
    let score = 0;

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(date - i * 86_400_000);
      day.setUTCHours(0, 0, 0, 0);
      score =
        score * Math.exp(-1 / days) +
        totals(id, day.getTime(), day.getTime() + 86_400_000 - 1).tss * (1 - Math.exp(-1 / days));
    }

    return score;
  }

  const week = Effect.fn('FitnessService.week')(function* (id: number, date: number) {
    const range = StreakService.weekRange(date);
    const sum = totals(id, range.start, range.end);
    const end = Math.min(range.end, Date.now());
    const score = ewma(id, end, 42);
    const delta = score - ewma(id, end, 7);

    const status =
      score === 0
        ? 'READY'
        : delta < -30
          ? 'OVERREACHING'
          : delta < 0
            ? 'PRODUCTIVE'
            : delta < 25
              ? 'FRESH'
              : 'DETRAINING';

    const days = [];

    for (let i = 0; i < 7; i++) {
      const start = range.start + i * 86_400_000;
      const sum = totals(id, start, start + 86_400_000 - 1);

      if (!sum.distance) {
        continue;
      }
      const zones = [0, 0, 0, 0, 0, 0, 0];

      for (const row of repositories.fitnessRepository.listActivity(
        id,
        new Date(start).toISOString(),
        new Date(start + 86_400_000 - 1).toISOString(),
      )) {
        if (!row.power_zones) {
          continue;
        }

        const incoming = Schema.decodeUnknownSync(Schema.Array(Schema.Finite))(
          JSON.parse(Schema.decodeUnknownSync(Schema.String)(row.power_zones)),
        );

        for (let zone = 0; zone < 7; zone++) {
          zones[zone] = (zones[zone] ?? 0) + (incoming[zone] ?? 0);
        }
      }

      const total = zones.reduce((sum, value) => sum + value, 0);
      days.push({
        ...sum,
        day: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][i] ?? 'mon',
        powerZones: total
          ? zones.map((value, index) => ({
              zone: index + 1,
              percentage: value / total,
            }))
          : [],
      });
    }

    return {
      ...sum,
      start: new Date(range.start).toISOString().slice(0, 10),
      fitnessScore: score,
      status,
      days,
    };
  });

  const streaks = Effect.fn('FitnessService.streaks')(function* (id: number) {
    return yield* streakService.streaksFor(id);
  });

  const metrics = Effect.fn('FitnessService.metrics')(function* (id: number, date: number, historical: boolean) {
    const weeks = [yield* week(id, date), yield* week(id, date - 604_800_000)];

    const row = repositories.fitnessRepository.findGoalMetrics(
      id,
      new Date(historical ? StreakService.weekRange(date).end : Date.now()).toISOString(),
    );

    const goals = Schema.decodeUnknownSync(goalSchema)(row ?? {});

    return {
      weeks,
      goals,
      streak: (yield* streaks(id)).curStreak,
      useMetric: repositories.profileRepository.get(id).useMetric,
    };
  });

  const saveGoals = Effect.fn('FitnessService.saveGoals')(function* (id: number, input: (typeof goalSchema)['Type']) {
    const goals = { ...Schema.decodeUnknownSync(goalSchema)(input), lastUpdated: new Date().toISOString() };
    repositories.fitnessRepository.insertGoalMetrics(
      id,
      goals.weekGoalTSS,
      goals.weekGoalCalories,
      goals.weekGoalKjs,
      goals.weekGoalDistanceKilometers,
      goals.weekGoalDistanceMiles,
      goals.weekGoalTimeMinutes,
      goals.lastUpdated,
      goals.currentGoalSetting,
      goals.currentGoalSource,
    );
  });

  const powerCurve = Effect.fn('FitnessService.powerCurve')(function* (id: number, option: string, days: number) {
    const cutoff = option === 'last' ? Math.floor(Date.now() / 1000) - days * 86_400 : 0;
    const response = create(PowerCurveAggregationMsgSchema);

    for (const time of ['5', '60', '300', '1200']) {
      const row = repositories.fitnessRepository.findPowerCurve(id, time, cutoff);

      if (row) {
        response.watts[time] = create(BestEffortPointMsgSchema, {
          power: Schema.decodeUnknownSync(Schema.Finite)(row.power),
        });
      }
    }

    return response;
  });

  return { findActivity, week, streaks, metrics, saveGoals, powerCurve };
});

export class FitnessService extends Context.Service<FitnessService, Effect.Success<typeof make>>()(
  'zluggish/FitnessService',
) {
  static readonly layer = Layer.effect(FitnessService, make);
}
