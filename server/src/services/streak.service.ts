import { Context, Effect, Layer } from 'effect';
import { RuntimeContext } from '#src/context';
import type { Activity } from '#src/protocol/generated/activity_pb';
import { StreaksSchema } from '#src/protocol/generated/profile_pb';
import type { PlayerProfile, Streaks } from '#src/protocol/generated/profile_pb';
import { clone, create } from '@bufbuild/protobuf';

function weekRange(time: number) {
  const start = new Date(time);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  return { start: start.getTime(), end: start.getTime() + 604_800_000 - 1000 };
}

/** Streaks before streaks.bin existed live in the profile. */
function fromProfile(profile: PlayerProfile | null) {
  if (!profile) {
    return create(StreaksSchema);
  }

  return create(StreaksSchema, {
    curStreak: profile.curStreak,
    curStreakDistance: Math.trunc(profile.curStreakDistance),
    curStreakElevation: Math.trunc(profile.curStreakElevation),
    curStreakCalories: Math.trunc(profile.curStreakCalories),
    maxStreak: profile.maxStreak,
    maxStreakDistance: Math.trunc(profile.maxStreakDistance),
    maxStreakElevation: Math.trunc(profile.maxStreakElevation),
    maxStreakCalories: Math.trunc(profile.maxStreakCalories),
    weekEnd: BigInt(weekRange(Number(profile.curStreakRide) * 1000).end),
    curStreakRide: profile.curStreakRide * 1000n,
  });
}

/** Invalid dates are ignored; older dates retain the existing same-week behavior. */
function period(start: number, boundary: number) {
  if (!Number.isFinite(start)) {
    return 'invalid';
  }

  if (start > boundary + 604_800_000) {
    return 'gap';
  }

  return start > boundary ? 'next-week' : 'same-week';
}

function advancedStreak(previous: Streaks, activity: Activity) {
  const streaks = clone(StreaksSchema, previous);
  const start = Date.parse(activity.startDate);

  const kind = period(start, Number(streaks.weekEnd));

  if (kind === 'invalid') {
    return streaks;
  }

  if (kind === 'gap') {
    streaks.curStreak = 1;
    streaks.curStreakRide = BigInt(start);
    streaks.curStreakDistance = 0;
    streaks.curStreakElevation = 0;
    streaks.curStreakCalories = 0;
  } else if (kind === 'next-week') {
    streaks.curStreak++;
    streaks.curStreakRide = BigInt(start);
  }

  streaks.curStreakDistance += Math.trunc(activity.distanceInMeters);
  streaks.curStreakElevation += Math.trunc(activity.totalElevation);
  streaks.curStreakCalories += Math.trunc(activity.calories);
  streaks.maxStreak = Math.max(streaks.maxStreak, streaks.curStreak);
  streaks.maxStreakDistance = Math.max(streaks.maxStreakDistance, streaks.curStreakDistance);
  streaks.maxStreakElevation = Math.max(streaks.maxStreakElevation, streaks.curStreakElevation);
  streaks.maxStreakCalories = Math.max(streaks.maxStreakCalories, streaks.curStreakCalories);
  streaks.weekEnd = BigInt(weekRange(start).end);

  return streaks;
}

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;

  const streaksFor = Effect.fn('StreakService.streaksFor')(function* (id: number) {
    return repositories.streakRepository.readStreaks(id) ?? fromProfile(repositories.profileRepository.get(id));
  });

  const updateStreaks = Effect.fn('StreakService.updateStreaks')(function* (id: number, activity: Activity) {
    const streaks = advancedStreak(yield* streaksFor(id), activity);
    repositories.streakRepository.saveStreaks(id, streaks);
  });

  return { streaksFor, updateStreaks };
});

export class StreakService extends Context.Service<StreakService, Effect.Success<typeof make>>()(
  'zluggish/StreakService',
) {
  static readonly layer = Layer.effect(StreakService, make);

  static readonly weekRange = weekRange;

  static readonly fromProfile = fromProfile;

  static readonly period = period;

  static readonly advancedStreak = advancedStreak;
}
