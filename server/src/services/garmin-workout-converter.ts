import { XMLBuilder } from 'fast-xml-parser';

export interface GarminStepType {
  stepTypeId?: number;
  stepTypeKey?: string;
}

export interface GarminCondition {
  conditionTypeId?: number;
  conditionTypeKey?: string;
}

export interface GarminTarget {
  workoutTargetTypeId?: number;
  workoutTargetTypeKey?: string;
}

export interface GarminExecutableStep {
  stepOrder: number;
  stepType?: GarminStepType;
  endCondition?: GarminCondition;
  endConditionValue?: number;
  targetType?: GarminTarget;
  zoneNumber?: number;
  targetValueOne?: number;
  targetValueTwo?: number;
}

export interface GarminRepeatGroup {
  stepOrder: number;
  stepType?: GarminStepType;
  numberOfIterations: number;
  workoutSteps: Array<GarminExecutableStep | GarminRepeatGroup>;
}

export interface GarminSegment {
  segmentOrder: number;
  sportTypeKey?: string;
  workoutSteps: Array<GarminExecutableStep | GarminRepeatGroup>;
}

export interface GarminWorkoutRecord {
  workoutName?: string;
  description?: string;
  sportTypeKey?: string;
  workoutSegments: Array<GarminSegment>;
}

/** Conversion stops after this many steps to keep the file within game limits. */
export const maxSteps = 200;

export const maxRepeats = 60;

/** Lower/upper power-zone bounds as fractions of FTP, keyed by Garmin's zone number. */
interface PowerZoneTable {
  [zone: number]: [number, number];
}

/** Garmin's default cycling power zones as fractions of FTP. They match the boundaries
Zluggish itself uses to split zone percentages, so a zone-targeted step lands in its zone.
Zone 1 is floored at 0.3 because Garmin leaves its lower bound open and a 0% target is meaningless.
*/
export const powerZones: PowerZoneTable = {
  1: [0.3, 0.55],
  2: [0.55, 0.75],
  3: [0.75, 0.9],
  4: [0.9, 1.05],
  5: [1.05, 1.2],
  6: [1.2, 1.5],
  7: [1.5, 2],
};

const stepKeys = new Set(['warmup', 'cooldown', 'interval', 'recovery', 'rest', 'other', 'main', 'repeat']);

/** A fast-xml-parser preserveOrder step node: the tag's children under the tag name, plus ':@' attributes.
'#text' leaves carry the text value directly; every real tag holds an array of child nodes. */
interface StepNode {
  [tag: string]: Array<StepNode> | string | XmlAttributes | undefined;
  ':@'?: XmlAttributes;
}

/** fast-xml-parser attribute bag: attribute names with their string values. */
interface XmlAttributes {
  [attribute: string]: string;
}

interface KeyRef {
  id?: number;
  key?: string;
}

/** The JSON values Garmin sends: null, booleans, numbers, strings, arrays and nested objects. */
type JsonValue = null | boolean | number | string | Array<JsonValue> | GarminObject;

/** A parsed Garmin JSON object: string keys with JSON values. */
interface GarminObject {
  [key: string]: JsonValue | undefined;
}

/** Garmin JSON objects as records; anything else is unusable. */
function isGarminObject(value: unknown): value is GarminObject {
  return typeof value === 'object' && value !== null;
}

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function keyRef(value: unknown, idKeys: Array<string>, keyKeys: Array<string>): KeyRef | undefined {
  if (!isGarminObject(value)) {
    return undefined;
  }
  const record = value;
  const id = idKeys.map((name) => finite(record[name])).find((candidate) => candidate !== undefined);
  const key = keyKeys.map((name) => text(record[name])).find((candidate) => candidate !== undefined);

  if (id === undefined && key === undefined) {
    return undefined;
  }
  const result: KeyRef = {};

  if (id !== undefined) {
    result.id = id;
  }
  if (key !== undefined) {
    result.key = key;
  }
  return result;
}

function stepTypeRef(value: unknown): GarminStepType | undefined {
  const ref = keyRef(value, ['stepTypeId'], ['stepTypeKey']);

  if (!ref) {
    return undefined;
  }
  const result: GarminStepType = {};

  if (ref.id !== undefined) {
    result.stepTypeId = ref.id;
  }
  if (ref.key !== undefined) {
    result.stepTypeKey = ref.key;
  }
  return result;
}

function conditionRef(value: unknown): GarminCondition | undefined {
  const ref = keyRef(value, ['conditionTypeId'], ['conditionTypeKey']);

  if (!ref) {
    return undefined;
  }
  const result: GarminCondition = {};

  if (ref.id !== undefined) {
    result.conditionTypeId = ref.id;
  }
  if (ref.key !== undefined) {
    result.conditionTypeKey = ref.key;
  }
  return result;
}

function targetRef(value: unknown): GarminTarget | undefined {
  const ref = keyRef(value, ['workoutTargetTypeId'], ['workoutTargetTypeKey']);

  if (!ref) {
    return undefined;
  }
  const result: GarminTarget = {};

  if (ref.id !== undefined) {
    result.workoutTargetTypeId = ref.id;
  }
  if (ref.key !== undefined) {
    result.workoutTargetTypeKey = ref.key;
  }
  return result;
}

function isRepeat(value: GarminObject): boolean {
  return (
    value.numberOfIterations !== undefined ||
    value.type === 'RepeatGroupDTO' ||
    Array.isArray(value.workoutSteps)
  );
}

function normalizeStep(value: unknown): GarminExecutableStep | GarminRepeatGroup | null {
  if (!isGarminObject(value)) {
    return null;
  }
  const raw = value;
  const order = finite(raw.stepOrder) ?? 0;

  if (isRepeat(raw)) {
    const iterations = finite(raw.numberOfIterations);

    if (iterations === undefined) {
      // A TIME-based repeat ("repeat until time is…") has no fixed iteration count.
      return null;
    }
    const children = Array.isArray(raw.workoutSteps)
      ? raw.workoutSteps
          .map((child) => normalizeStep(child))
          .filter((step): step is GarminExecutableStep | GarminRepeatGroup => step !== null)
      : [];

    if (children.length === 0) {
      return null;
    }
    const group: GarminRepeatGroup = {
      stepOrder: order,
      numberOfIterations: Math.round(iterations),
      workoutSteps: children,
    };
    const ref = stepTypeRef(raw.stepType);

    if (ref) {
      group.stepType = ref;
    }
    return group;
  }

  const stepType = stepTypeRef(raw.stepType);
  const endCondition = conditionRef(raw.endCondition);
  const endConditionValue = finite(raw.endConditionValue);
  const targetType = targetRef(raw.targetType);
  const zoneNumber = finite(raw.zoneNumber);
  const targetValueOne = finite(raw.targetValueOne);
  const targetValueTwo = finite(raw.targetValueTwo);
  const step: GarminExecutableStep = { stepOrder: order };

  if (stepType) {
    step.stepType = stepType;
  }
  if (endCondition) {
    step.endCondition = endCondition;
  }
  if (endConditionValue !== undefined) {
    step.endConditionValue = endConditionValue;
  }
  if (targetType) {
    step.targetType = targetType;
  }
  if (zoneNumber !== undefined) {
    step.zoneNumber = zoneNumber;
  }
  if (targetValueOne !== undefined) {
    step.targetValueOne = targetValueOne;
  }
  if (targetValueTwo !== undefined) {
    step.targetValueTwo = targetValueTwo;
  }
  return step;
}

/** Loose Garmin JSON becomes the record the converter reads; null when nothing usable is there. */
function normalizeWorkoutRecord(raw: unknown): GarminWorkoutRecord | null {
  if (!isGarminObject(raw)) {
    return null;
  }
  const record = raw;
  const sportType = isGarminObject(record.sportType) ? record.sportType : null;
  const segments = Array.isArray(record.workoutSegments)
    ? record.workoutSegments
        .map((segment) => {
          if (!isGarminObject(segment)) {
            return null;
          }
          const entry = segment;
          const segmentSport = isGarminObject(entry.sportType) ? entry.sportType : null;
          const sportTypeKey = text(segmentSport?.sportTypeKey);
          const rawSteps: Array<unknown> = Array.isArray(entry.workoutSteps) ? entry.workoutSteps : [];
          const steps = rawSteps.flatMap((child) => {
            const step = normalizeStep(child);

            return step === null ? [] : [step];
          });

          if (steps.length === 0) {
            return null;
          }
          const result: GarminSegment = { segmentOrder: finite(entry.segmentOrder) ?? 0, workoutSteps: steps };

          if (sportTypeKey !== undefined) {
            result.sportTypeKey = sportTypeKey;
          }
          return result;
        })
        .filter((segment): segment is GarminSegment => segment !== null)
    : [];

  if (segments.length === 0) {
    return null;
  }

  const workoutName = text(record.workoutName);
  const description = text(record.description);
  const sportTypeKey = text(sportType?.sportTypeKey);
  const result: GarminWorkoutRecord = { workoutSegments: segments };

  if (workoutName !== undefined) {
    result.workoutName = workoutName;
  }
  if (description !== undefined) {
    result.description = description;
  }
  if (sportTypeKey !== undefined) {
    result.sportTypeKey = sportTypeKey;
  }
  return result;
}

function stepKey(step: GarminExecutableStep | GarminRepeatGroup): string | null {
  const key = step.stepType?.stepTypeKey?.toLowerCase();

  return key && stepKeys.has(key) ? key : null;
}

function zoneRange(step: GarminExecutableStep, ftp: number | undefined): [number, number] | null {
  if (step.targetType?.workoutTargetTypeKey?.toLowerCase() !== 'power.zone') {
    return null;
  }
  const zone = step.zoneNumber;

  if (zone !== undefined) {
    return powerZones[zone] ?? null;
  }

  // Garmin Coach plans carry absolute watt bands (targetValueOne/Two) instead of a zone
  // number. With the rider's FTP configured they become exact %FTP values; without one
  // the step imports powerless rather than guessing a conversion base.
  if (ftp === undefined || ftp <= 0) {
    return null;
  }
  const watts = step.targetValueOne;

  if (watts === undefined || watts <= 0) {
    return null;
  }
  const wattsHigh = step.targetValueTwo ?? watts;

  if (wattsHigh <= 0) {
    return null;
  }
  const scale = (value: number) => Math.round((value / ftp) * 1000) / 1000;
  const low = scale(Math.min(watts, wattsHigh));
  const high = scale(Math.max(watts, wattsHigh));

  return [low, high];
}

/** Time-conditioned steps become duration steps; anything else cannot be expressed in a .zwo. */
function durationOf(step: GarminExecutableStep): number | null {
  const seconds = step.endCondition?.conditionTypeKey?.toLowerCase() === 'time' ? step.endConditionValue : undefined;

  return seconds !== undefined && seconds > 0 ? Math.round(seconds) : null;
}

/** One Garmin step becomes one Zwift step; ranges stay ranges so the zone split stays exact. */
function simpleStep(step: GarminExecutableStep, ftp: number | undefined): StepNode | null {
  const duration = durationOf(step);

  if (duration === null) {
    return null;
  }
  const key = stepKey(step);
  const range = zoneRange(step, ftp);
  const attributes: XmlAttributes = { '@_Duration': String(duration) };

  if (range) {
    const [low, high] = range;

    if (low === high) {
      attributes['@_Power'] = String(low);
    } else {
      attributes['@_PowerLow'] = String(low);
      attributes['@_PowerHigh'] = String(high);
    }
  }

  if (key === 'warmup' || key === 'cooldown') {
    // Ramps need both ends; without a zone they stay plain duration ramps.
    const node: StepNode = { ':@': attributes };

    node[key === 'warmup' ? 'Warmup' : 'Cooldown'] = [];
    return node;
  }

  // Steps without a usable power target import without a power attribute: the ride shows
  // unknown difficulty rather than an invented number.
  return { SteadyState: [], ':@': attributes };
}

/** Normalized repeat groups are the only nodes that carry an iteration count. */
function isRepeatGroup(step: GarminExecutableStep | GarminRepeatGroup): step is GarminRepeatGroup {
  return 'numberOfIterations' in step;
}

/** A normalized step as its Zwift nodes, or null when it cannot be expressed. */
function childSteps(step: GarminExecutableStep | GarminRepeatGroup, ftp: number | undefined): Array<StepNode> | null {
  if (!isRepeatGroup(step)) {
    const single = simpleStep(step, ftp);

    return single === null ? null : [single];
  }
  return repeatStep(step, ftp);
}

/** A repeat of exactly a work/rest pair becomes one IntervalsT; anything else is unrolled. */
function repeatStep(group: GarminRepeatGroup, ftp: number | undefined): Array<StepNode> | null {
  const iterations = group.numberOfIterations;

  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > maxRepeats) {
    return null;
  }
  const children = group.workoutSteps.filter((child) => stepKey(child) !== null);
  const [work, rest] = children;

  if (
    children.length === 2 &&
    work !== undefined &&
    rest !== undefined &&
    !isRepeatGroup(work) &&
    !isRepeatGroup(rest)
  ) {
    const on = durationOf(work);
    const off = durationOf(rest);
    const onRange = zoneRange(work, ftp);
    const offRange = zoneRange(rest, ftp);

    if (on !== null && off !== null && onRange && offRange) {
      const mid = ([low, high]: [number, number]) => Math.round(((low + high) / 2) * 1000) / 1000;
      const onPower = onRange[0] === onRange[1] ? onRange[0] : mid(onRange);
      const offPower = offRange[0] === offRange[1] ? offRange[0] : mid(offRange);

      return [
        {
          IntervalsT: [],
          ':@': {
            '@_Repeat': String(iterations),
            '@_OnDuration': String(on),
            '@_OffDuration': String(off),
            '@_OnPower': String(onPower),
            '@_OffPower': String(offPower),
          },
        },
      ];
    }
  }

  const unrolled: Array<StepNode> = [];

  for (let index = 0; index < iterations; index++) {
    for (const child of children) {
      const steps = childSteps(child, ftp);

      if (steps === null) {
        return null;
      }
      unrolled.push(...steps);

      if (unrolled.length > maxSteps) {
        return null;
      }
    }
  }

  return unrolled;
}

/** Zwift workout XML as an ordered document, matching how Zluggish reparses provider files. */
function garminWorkoutToZwoDocument(record: GarminWorkoutRecord, identity: string, ftp: number | undefined) {
  if (record.sportTypeKey?.toLowerCase() !== 'cycling') {
    return null;
  }
  const steps: Array<StepNode> = [];

  for (const segment of record.workoutSegments) {
    for (const step of segment.workoutSteps) {
      if (steps.length > maxSteps) {
        return null;
      }
      const key = stepKey(step);

      if (key === null) {
        continue;
      }
      const converted = childSteps(step, ftp);

      if (converted === null) {
        return null;
      }
      steps.push(...converted);

      if (steps.length > maxSteps) {
        return null;
      }
    }
  }

  if (steps.length === 0) {
    return null;
  }

  return [
    {
      workout_file: [
        { name: [{ '#text': record.workoutName ?? '' }] },
        { description: [{ '#text': record.description ?? '' }] },
        { sportType: [{ '#text': 'bike' }] },
        { author: [{ '#text': 'Garmin' }] },
        { workout: steps },
        { uniqueId: [{ '#text': identity }] },
      ],
    },
  ];
}

const builder = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, format: true, suppressEmptyNode: true });

/** A Garmin workout as Zwift .zwo XML, or null when it cannot be expressed as one.
The rider's FTP (integrations.garmin.ftp) turns Garmin Coach absolute watt bands into %FTP. */
function garminWorkoutToZwo(record: GarminWorkoutRecord, identity: string, ftp?: number): string | null {
  const document = garminWorkoutToZwoDocument(record, identity, ftp);

  return document ? builder.build(document) : null;
}

/** Entry point for the Garmin → .zwo conversion pipeline. */
export const GarminWorkoutConverter = {
  normalizeWorkoutRecord,
  garminWorkoutToZwoDocument,
  garminWorkoutToZwo,
};
