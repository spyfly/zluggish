import { RuntimeContext } from '#src/context';
import { ActivitySport } from '#src/enum';
import { ApplicationError } from '#src/errors';
import type { Goal } from '#src/protocol/generated/goal_pb';
import { GoalSchema } from '#src/protocol/generated/goal_pb';
import { create } from '@bufbuild/protobuf';
import { Context, Effect, Layer, Schema } from 'effect';
import { withDefault } from '#src/schema';

export const goalInput = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(withDefault(0)),
  profileId: Schema.Int.check(Schema.isGreaterThan(0)),
  sport: Schema.Enum(ActivitySport),
  name: Schema.String,
  type: Schema.Union([Schema.Literal(0), Schema.Literal(1)]),
  periodicity: Schema.Union([Schema.Literal(0), Schema.Literal(1)]),
  targetDistanceInMeters: Schema.Finite,
  targetDurationInMinutes: Schema.Finite,
  actualDistanceInMeters: Schema.Finite.pipe(withDefault(0)),
  actualDurationInMinutes: Schema.Finite.pipe(withDefault(0)),
});

function jsonGoal(goal: Goal) {
  const timestamp = (time: bigint) => (time ? new Date(Number(time)).toISOString().replace('Z', '+0000') : null);

  return {
    id: Number(goal.id),
    profileId: Number(goal.playerId),
    sport: goal.sport === 1 ? 'RUNNING' : 'CYCLING',
    name: goal.name,
    type: goal.type,
    periodicity: goal.periodicity,
    targetDistanceInMeters: goal.targetDistance,
    targetDurationInMinutes: goal.targetDuration,
    actualDistanceInMeters: goal.actualDistance,
    actualDurationInMinutes: goal.actualDuration,
    createdOn: timestamp(goal.createdOn),
    periodEndDate: timestamp(goal.periodEndDate),
    status: goal.status,
    timezone: goal.timezone,
  };
}

function parseGoal(body: (typeof goalInput)['Type']) {
  return create(GoalSchema, {
    id: BigInt(body.id),
    playerId: BigInt(body.profileId),
    sport: body.sport === 'RUNNING' ? 1 : 0,
    name: body.name,
    type: body.type,
    periodicity: body.periodicity,
    status: 0,
    targetDistance: body.targetDistanceInMeters,
    targetDuration: body.targetDurationInMinutes,
    actualDistance: body.actualDistanceInMeters,
    actualDuration: body.actualDurationInMinutes,
  });
}

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;

  const create = Effect.fn('GoalService.create')(function* (playerId: number, goal: Goal) {
    goal.playerId = BigInt(playerId);
    goal.createdOn = BigInt(Date.now());
    progress(goal);
    goal.id = repositories.goalRepository.insert(goal);

    return goal;
  });

  const list = Effect.fn('GoalService.list')(function* (playerId: number) {
    const goals = repositories.goalRepository.list(playerId);

    for (const goal of goals) {
      progress(goal);
      repositories.goalRepository.save(goal);
    }

    return goals;
  });

  const update = Effect.fn('GoalService.update')(function* (playerId: number, id: bigint, goal: Goal) {
    yield* requireOwned(playerId, id);
    goal.id = id;
    goal.playerId = BigInt(playerId);
    repositories.goalRepository.save(goal);
  });

  const deleteEntry = Effect.fn('GoalService.delete')(function* (playerId: number, id: bigint) {
    yield* requireOwned(playerId, id);
    repositories.goalRepository.delete(playerId, id);
  });

  const requireOwned = Effect.fn('GoalService.requireOwned')(function* (playerId: number, id: bigint) {
    if (!repositories.goalRepository.exists(playerId, id)) {
      return yield* new ApplicationError({ status: 404 });
    }
  });

  function progress(goal: Goal) {
    const now = new Date();

    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    let end: Date;

    if (goal.periodicity === 0) {
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      end = new Date(start.getTime() + 7 * 86_400_000 - 1000);
    } else {
      start.setUTCDate(1);
      end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - 1000);
    }

    goal.periodEndDate = BigInt(end.getTime());

    const totals = repositories.goalRepository.activityTotals(goal.playerId, goal.sport, start, end);

    // Companion expects both fields to carry the selected goal metric.
    const actual = (goal.type === 0 ? totals.distance : totals.duration) ?? 0;
    goal.actualDistance = actual;
    goal.actualDuration = actual;
  }

  return { create, list, update, delete: deleteEntry, requireOwned };
});

export class GoalService extends Context.Service<GoalService, Effect.Success<typeof make>>()('zluggish/GoalService') {
  static readonly layer = Layer.effect(GoalService, make);

  static readonly jsonGoal = jsonGoal;

  static readonly parseGoal = parseGoal;
}
