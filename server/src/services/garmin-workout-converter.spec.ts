import { GarminWorkoutConverter, maxRepeats, maxSteps } from '#src/services/garmin-workout-converter';

const { garminWorkoutToZwo, normalizeWorkoutRecord } = GarminWorkoutConverter;
import { WorkoutsService } from '#src/services/workout.service';
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Raw Garmin fixture JSON: only the fields the converter reads. */
interface FixtureStep {
  type?: string;
  stepOrder?: number;
  stepType?: { stepTypeId?: number; stepTypeKey?: string };
  endCondition?: { conditionTypeId?: number; conditionTypeKey?: string };
  endConditionValue?: number;
  targetType?: { workoutTargetTypeId?: number; workoutTargetTypeKey?: string };
  zoneNumber?: number | null;
  targetValueOne?: number;
  targetValueTwo?: number;
  numberOfIterations?: number | null;
  workoutSteps?: Array<FixtureStep>;
}

/** Garmin sends loose records: extra fields everywhere, nulls where values are missing. */
function workout(steps: Array<FixtureStep>, sportTypeKey = 'cycling') {
  return {
    workoutId: 1,
    workoutName: 'Test workout',
    description: 'Test description',
    sportType: { sportTypeId: 2, sportTypeKey },
    estimatedDurationInSecs: steps.length * 300,
    workoutSegments: [
      { segmentOrder: 1, sportType: { sportTypeId: 2, sportTypeKey }, workoutSteps: steps },
    ],
  };
}

function step(overrides: FixtureStep = {}): FixtureStep {
  return {
    type: 'ExecutableStepDTO',
    stepOrder: 1,
    stepType: { stepTypeId: 8, stepTypeKey: 'other' },
    endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' },
    endConditionValue: 300,
    targetType: { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone' },
    zoneNumber: 2,
    ...overrides,
  };
}

function repeat(iterations: number, children: Array<FixtureStep>): FixtureStep {
  return {
    type: 'RepeatGroupDTO',
    stepOrder: 2,
    stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
    numberOfIterations: iterations,
    workoutSteps: children,
  };
}

function convert(steps: Array<FixtureStep>, sportTypeKey = 'cycling', ftp?: number) {
  const record = normalizeWorkoutRecord(workout(steps, sportTypeKey));

  return record ? garminWorkoutToZwo(record, 'test-identity', ftp) : null;
}

await test('a cycling workout becomes a .zwo the game accepts', () => {
  const xml = convert([
    step({ stepOrder: 1, stepType: { stepTypeId: 1, stepTypeKey: 'warmup' }, endConditionValue: 600, zoneNumber: 1 }),
    step({ stepOrder: 2, stepType: { stepTypeId: 8, stepTypeKey: 'main' }, zoneNumber: 3 }),
    step({ stepOrder: 3, stepType: { stepTypeId: 2, stepTypeKey: 'cooldown' }, endConditionValue: 120, zoneNumber: 1 }),
  ]);

  assert.ok(xml);
  const details = WorkoutsService.workoutDetails(xml);

  assert.ok(details);
  assert.equal(details.name, 'Test workout');
  assert.equal(details.description, 'Test description');
  assert.equal(details.duration, 600 + 300 + 120);
  assert.equal(xml.includes('sportType>bike<'), true);
  assert.equal(xml.includes('<Warmup Duration="600" PowerLow="0.3" PowerHigh="0.55"/>'), true);
  assert.equal(xml.includes('<SteadyState Duration="300" PowerLow="0.75" PowerHigh="0.9"/>'), true);
  assert.equal(xml.includes('<Cooldown Duration="120" PowerLow="0.3" PowerHigh="0.55"/>'), true);
  assert.equal(xml.includes('uniqueId>test-identity<'), true);
});

await test('a work/rest repeat becomes one IntervalsT', () => {
  const xml = convert([
    repeat(5, [
      step({ stepOrder: 1, zoneNumber: 4 }),
      step({ stepOrder: 2, stepType: { stepTypeId: 4, stepTypeKey: 'recovery' }, endConditionValue: 90, zoneNumber: 1 }),
    ]),
  ]);

  assert.ok(xml);
  assert.equal(
    xml.includes(
      '<IntervalsT Repeat="5" OnDuration="300" OffDuration="90" OnPower="0.975" OffPower="0.425"/>',
    ),
    true,
  );
  const details = WorkoutsService.workoutDetails(xml);

  assert.ok(details);
  assert.equal(details.duration, 5 * (300 + 90));
});

await test('a repeat with more than two steps is unrolled in order', () => {
  const xml = convert([
    repeat(2, [
      step({ stepOrder: 1, endConditionValue: 60, zoneNumber: 4 }),
      step({ stepOrder: 2, stepType: { stepTypeId: 4, stepTypeKey: 'recovery' }, endConditionValue: 30, zoneNumber: 1 }),
      step({ stepOrder: 3, endConditionValue: 60, zoneNumber: 5 }),
    ]),
  ]);

  assert.ok(xml);
  const details = WorkoutsService.workoutDetails(xml);

  assert.ok(details);
  assert.equal(details.duration, 2 * (60 + 30 + 60));
  assert.equal(xml.split('<SteadyState Duration="60" PowerLow="0.9" PowerHigh="1.05"/>').length, 3);
});

await test('steps without a power target import without invented power', () => {
  const xml = convert([step({ targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' } })]);

  assert.ok(xml);
  assert.equal(xml.includes('<SteadyState Duration="300"/>'), true);
  const details = WorkoutsService.workoutDetails(xml);

  assert.ok(details);
  assert.equal(details.zonePercentages.every((value) => value === 0), true);
});

await test('non-cycling workouts and unconvertible steps are refused', () => {
  assert.equal(convert([step()], 'running'), null);
  assert.equal(
    convert([step({ endCondition: { conditionTypeId: 3, conditionTypeKey: 'distance' }, endConditionValue: 5000 })]),
    null,
  );
  assert.equal(convert([step({ stepType: { stepTypeId: 99, stepTypeKey: 'unknown' } })]), null);
  assert.equal(convert([]), null);
});

await test('a time-based repeat has no fixed count and is refused', () => {
  assert.equal(
    convert([
      {
        type: 'RepeatGroupDTO',
        stepOrder: 1,
        stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
        numberOfIterations: null,
        endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' },
        endConditionValue: 1200,
        workoutSteps: [step(), step()],
      },
    ]),
    null,
  );
});

await test('repeats without iterations or beyond the cap are refused', () => {
  assert.equal(convert([repeat(maxRepeats + 1, [step(), step()])]), null);
  assert.equal(convert([repeat(0, [step(), step()])]), null);
});

await test('deeply nested unrolled repeats stop at the step cap', () => {
  const nested = repeat(3, [repeat(3, [step(), step()])]);

  // Each nested repeat unrolls to nine steps.
  assert.ok(convert([nested, nested, nested, nested, nested, nested, nested, nested, nested, nested]));
  assert.equal(convert(Array.from({ length: 67 }, () => nested)), null);
  assert.ok(convert(Array.from({ length: 66 }, () => nested)));
});

await test('the step cap keeps generated files bounded', () => {
  assert.equal(convert(Array.from({ length: maxSteps + 1 }, () => step())), null);
});

await test('absolute watt bands convert with the configured FTP (real Garmin Coach data)', () => {
  // Shaped like the rider's real "VO2max 8x2:00@300W" Coach workout: watt bands, no zoneNumber.
  const xml = convert(
    [
      step({
        stepOrder: 1,
        stepType: { stepTypeId: 1, stepTypeKey: 'warmup' },
        endConditionValue: 900,
        zoneNumber: null,
        targetValueOne: 145,
        targetValueTwo: 198,
      }),
      repeat(8, [
        step({
          stepOrder: 2,
          stepType: { stepTypeId: 3, stepTypeKey: 'interval' },
          endConditionValue: 120,
          zoneNumber: null,
          targetValueOne: 277,
          targetValueTwo: 316,
        }),
        step({
          stepOrder: 3,
          stepType: { stepTypeId: 4, stepTypeKey: 'recovery' },
          endConditionValue: 60,
          zoneNumber: null,
          targetValueOne: 119,
          targetValueTwo: 171,
        }),
      ]),
      step({
        stepOrder: 4,
        stepType: { stepTypeId: 2, stepTypeKey: 'cooldown' },
        endConditionValue: 900,
        zoneNumber: null,
        targetValueOne: 119,
        targetValueTwo: 171,
      }),
    ],
    'cycling',
    295,
  );

  assert.ok(xml);
  assert.equal(xml.includes('<Warmup Duration="900" PowerLow="0.492" PowerHigh="0.671"/>'), true);
  assert.equal(
    xml.includes('<IntervalsT Repeat="8" OnDuration="120" OffDuration="60" OnPower="1.005" OffPower="0.492"/>'),
    true,
  );
  assert.equal(xml.includes('<Cooldown Duration="900" PowerLow="0.403" PowerHigh="0.58"/>'), true);
  const details = WorkoutsService.workoutDetails(xml);

  assert.ok(details);
  assert.equal(details.duration, 900 + 8 * (120 + 60) + 900);
});

await test('watt bands without a configured FTP import powerless instead of guessing', () => {
  const xml = convert([step({ zoneNumber: null, targetValueOne: 277, targetValueTwo: 316 })]);

  assert.ok(xml);
  assert.equal(xml.includes('<SteadyState Duration="300"/>'), true);
});

await test('garbage records normalize to null', () => {
  assert.equal(normalizeWorkoutRecord(null), null);
  assert.equal(normalizeWorkoutRecord('nope'), null);
  assert.equal(normalizeWorkoutRecord({ workoutName: 'empty' }), null);
  assert.equal(normalizeWorkoutRecord({ workoutSegments: [{}] }), null);
});
