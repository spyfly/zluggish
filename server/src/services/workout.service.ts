import { t } from '#src/i18n/index';
import { isIntervalsAthleteId } from '#src/dtos/intervals.dto';
import { uuid, metadataSchema, storedEntrySchema } from '#src/dtos/workout.dto';
import type { StoredEntry } from '#src/dtos/workout.dto';
import { RuntimeContext } from '#src/context';
import { DeliveryRefusedError, UnreadableCredentialsError } from '#src/errors';
import type { ScheduledGarminWorkout } from '#src/repositories/garmin.repository';
import { GarminWorkoutConverter } from '#src/services/garmin-workout-converter';
import { SettingsService } from '#src/services/settings.service';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { resolve } from 'node:path';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { decodeOwned, withDefault } from '#src/schema';

const isCollection = Schema.is(Schema.Struct({ workouts: Schema.Array(Schema.Json) }));

const decodeStoredEntry = Schema.decodeUnknownOption(storedEntrySchema);

const number = (value: typeof Schema.Json.Type | undefined, fallback = 0) => {
  const result = Number(value);

  return value !== undefined && Number.isFinite(result) && result >= 0 ? result : fallback;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
});

const documentSchema = Schema.Record(Schema.String, Schema.Json);

const stepSchema = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite, Schema.Json]));

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function parseXML(content: string) {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(content) ||
    Buffer.byteLength(content) > 16 * 1024 * 1024 ||
    XMLValidator.validate(content) !== true
  ) {
    throw new Error(t('invalid_workout_xml'));
  }

  return Schema.decodeUnknownSync(documentSchema)(parser.parse(content));
}

/** Name, description, duration and zone split of a cycling workout file; null when it is not one. */
function workoutDetails(content: string) {
  const document = parseXML(content);
  const root = Schema.decodeUnknownSync(documentSchema)(document.workout_file);
  const workout = Schema.decodeUnknownSync(documentSchema)(root.workout);

  if (!['bike', 'cycling'].includes(String(root.sportType ?? 'bike').toLowerCase())) {
    return null;
  }
  const zones = [0, 0, 0, 0, 0, 0];
  let duration = 0;
  let known = true;

  function add(seconds: number, low: number, high = low) {
    if (seconds <= 0) {
      return;
    }
    duration += seconds;

    if (low < 0 || high < 0) {
      known = false;

      return;
    }

    const cuts = [0, 1];

    if (low !== high) {
      for (const limit of [0.55, 0.75, 0.9, 1.05, 1.2]) {
        if (Math.min(low, high) < limit && limit < Math.max(low, high)) {
          cuts.push((limit - low) / (high - low));
        }
      }
    }
    cuts.sort((a, b) => a - b);

    for (let index = 1; index < cuts.length; index++) {
      const start = cuts[index - 1] ?? 0;
      const end = cuts[index] ?? 1;
      const power = low + ((high - low) * (start + end)) / 2;

      const zone = [0.55, 0.75, 0.9, 1.05, 1.2].findIndex((limit) => power <= limit);

      const target = zone === -1 ? 5 : zone;
      zones[target] = (zones[target] ?? 0) + seconds * (end - start);
    }
  }

  for (const [tag, value] of Object.entries(workout)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      const parsed = Schema.decodeUnknownOption(stepSchema)(entry);

      if (Option.isNone(parsed)) {
        continue;
      }
      const step = parsed.value;

      if (tag === 'IntervalsT') {
        const repeat = number(step['@_Repeat']);

        if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 604_800) {
          return null;
        }
        add(repeat * number(step['@_OnDuration']), number(step['@_OnPower'], -1));
        add(repeat * number(step['@_OffDuration']), number(step['@_OffPower'], -1));
      } else if ([t('warmup'), t('cooldown'), t('ramp')].includes(tag)) {
        add(number(step['@_Duration']), number(step['@_PowerLow'], -1), number(step['@_PowerHigh'], -1));
      } else {
        add(number(step['@_Duration']), number(step['@_Power'], -1));
      }
    }
  }

  if (duration <= 0 || duration > 604_800) {
    return null;
  }
  const exact = zones.map((value) => (100 * value) / duration);
  const percentages = known ? exact.map((element) => Math.floor(element)) : [0, 0, 0, 0, 0, 0];

  if (known) {
    const order = exact
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort((a, b) => b.fraction - a.fraction);

    const remaining = 100 - percentages.reduce((sum, value) => sum + value, 0);

    for (const item of order.slice(0, remaining)) {
      percentages[item.index] = (percentages[item.index] ?? 0) + 1;
    }
  }

  return {
    name: String(root.name ?? ''),
    description: String(root.description ?? ''),
    duration: Math.round(duration),
    zonePercentages: percentages,
    difficulty: Math.min(number(root.difficulty), 5),
  };
}

const make = Effect.gen(function* () {
  const runtime = yield* RuntimeContext;
  const repositories = runtime.accounts.repositories;

  function scheduleID(identity: string) {
    const digest = repositories.cryptoRepository
      .sha1(Buffer.concat([Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex'), Buffer.from(identity)]))
      .subarray(0, 16);

    digest[6] = ((digest[6] ?? 0) & 15) | 80;
    digest[8] = ((digest[8] ?? 0) & 63) | 128;
    const hex = digest.toString('hex');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function providerOf(id: number) {
    const settings = SettingsService.resolveRiderSettings(runtime.config.riderDefaults, runtime.settings.read(id));

    const available = [];

    if (repositories.connectionsRepository.has(id, 'intervals')) {
      available.push('intervals-icu');
    }

    if (settings.workouts.trainingpeaks.bridgeFolder) {
      available.push('trainingpeaks');
    }

    if (repositories.riderDocuments.has(id, 'garth/oauth1_token.json')) {
      available.push('garmin');
    }

    const file = resolve(runtime.profiles.folder(id), 'active_workout_provider.txt');

    const saved = repositories.filesRepository.existsSync(file)
      ? repositories.filesRepository.readFileSync(file, 'utf8').trim()
      : '';

    return available.includes(saved) ? saved : (available[0] ?? null);
  }

  function entriesOf(id: number) {
    const file = metadataFileOf(id);

    if (!repositories.filesRepository.existsSync(file)) {
      return [];
    }

    const raw = Schema.decodeUnknownSync(documentSchema)(
      JSON.parse(repositories.filesRepository.readFileSync(file, 'utf8')),
    );

    return Schema.decodeUnknownSync(Schema.Array(metadataSchema))(Array.isArray(raw.workouts) ? raw.workouts : [raw]);
  }

  function metadataFileOf(id: number) {
    return resolve(runtime.profiles.folder(id), providerOf(id) === 'garmin' ? 'garmin_workout.json' : 'intervals_icu_workout.json');
  }

  function garminMetadataFileOf(id: number) {
    return resolve(runtime.profiles.folder(id), 'garmin_workout.json');
  }

  /** Unmodified stored entries, including fields the schema does not read. */
  function storedOf(id: number) {
    const none: Array<StoredEntry> = [];
    const file = metadataFileOf(id);

    if (!repositories.filesRepository.existsSync(file)) {
      return { collection: false, entries: none };
    }

    const raw: unknown = JSON.parse(repositories.filesRepository.readFileSync(file, 'utf8'));

    return isCollection(raw)
      ? {
          collection: true,
          entries: raw.workouts.flatMap((entry) => Option.toArray(decodeStoredEntry(entry))),
        }
      : { collection: false, entries: [Schema.decodeUnknownSync(storedEntrySchema)(raw)] };
  }

  function dropEvent(id: number, eventId: string | number) {
    const { entries } = storedOf(id);

    const removed = entries.filter((entry) => String(entry.event_id) === String(eventId));

    if (removed.length === 0) {
      return;
    }

    for (const entry of removed) {
      const file = fileOf(entry.workout_id ?? '');

      if (file && repositories.filesRepository.existsSync(file)) {
        repositories.filesRepository.rmSync(file);
      }
    }

    const remaining = entries.filter((entry) => !removed.includes(entry));

    repositories.filesRepository.writeDurable(
      metadataFileOf(id),
      JSON.stringify({
        ...(remaining[0] ?? { provider: providerOf(id) ?? 'intervals-icu' }),
        workouts: remaining,
      }),
      true,
    );
  }

  /** Builds the game schedule for one day from a provider's stored entries. */
  function scheduledFor(id: number, now: Date, provider: string, entries: ReturnType<typeof entriesOf>) {
    const day = localDay(now);
    const label = provider === 'garmin' ? 'garmin' : 'intervalsicu';
    const seen = new Set<string>();

    return entries.flatMap((metadata) => {
      const identity = Schema.decodeUnknownOption(uuid)(metadata.workout_id);

      if (Option.isNone(identity) || seen.has(identity.value)) {
        return [];
      }

      const planned =
        metadata.start_date_local?.slice(0, 10) ?? (metadata.start_date ? localDay(new Date(metadata.start_date)) : '');

      if (planned !== day || metadata.provider !== provider) {
        return [];
      }
      const file = fileOf(identity.value);

      if (
        !file ||
        !repositories.filesRepository.existsSync(file) ||
        [file, resolve(file, '..'), resolve(file, '../..')].some((path) =>
          repositories.filesRepository.lstatSync(path).isSymbolicLink(),
        )
      ) {
        return [];
      }
      const details = workoutDetails(repositories.filesRepository.readFileSync(file, 'utf8'));

      if (!details) {
        return [];
      }
      seen.add(identity.value);

      const scheduleId = scheduleID(`zoffline:schedule:${id}:${provider}:${metadata.event_id}:${day}`);

      const uri = `https://cdn.zwift.com/tp-workouts/${label}/${identity.value}.zwo`;
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const tomorrow = new Date(midnight);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const summary = {
        ...details,
        description: metadata.description || details.description,
        name: metadata.name || details.name,
        workoutAssetUrl: uri,
        workoutId: identity.value,
        legacyId: 0,
        sport: 'CYCLING',
        lastCompletion: null,
        stressPoints: metadata.icu_training_load ?? 0,
        primaryTrainingFocus: null,
        secondaryTrainingFocus: null,
      };

      return {
        id: identity.value,
        schedule: {
          scheduleId,
          workoutId: identity.value,
          workoutUri: uri,
          trainingProviderId: label,
          availableAfter: Math.floor(midnight.getTime() / 1000),
          notAvailableAfter: Math.floor(tomorrow.getTime() / 1000) - 1,
          workoutSummary: summary,
        },
        home: {
          nextUp: {
            selected: {
              entityId: identity.value,
              entityType: 'WORKOUT',
              recommendedDurationMinutes: null,
              tags: [],
              token: 'Component.Card.Activity',
            },
            recommendation: null,
            source: 'SCHEDULED',
            sourceId: scheduleId,
            explanation: null,
            expires: null,
            title: 'LOC_TODAY_LOWER',
            provider: label,
            providerProperties: null,
            metadata: [],
          },
        },
      };
    });
  }

  function scheduled(id: number, now = new Date()) {
    const provider = providerOf(id);

    if (provider === 'garmin') {
      return scheduledFor(id, now, 'garmin', entriesOf(id));
    }

    if (provider !== 'intervals-icu') {
      return [];
    }

    return scheduledFor(id, now, 'intervals-icu', entriesOf(id));
  }

  /** Serves either provider's files: the intervals directory first, then Garmin's. */
  function fileOf(id: string) {
    if (!Schema.is(uuid)(id)) {
      return null;
    }
    const intervals = resolve(runtime.config.storageDir, 'tp-workouts/intervalsicu', `${id}.zwo`);

    return repositories.filesRepository.existsSync(intervals)
      ? intervals
      : resolve(runtime.config.storageDir, 'tp-workouts/garmin', `${id}.zwo`);
  }

  function garminFileOf(id: string) {
    return Schema.is(uuid)(id) ? resolve(runtime.config.storageDir, 'tp-workouts/garmin', `${id}.zwo`) : null;
  }

  async function syncNow(id: number, signal: AbortSignal, requested?: string) {
    signal.throwIfAborted();
    // An explicit request wins over the saved provider: the rider picked this provider on purpose.
    const provider = requested ?? providerOf(id);

    if (provider === 'trainingpeaks') {
      return importBridge(id, signal);
    }

    if (provider === 'garmin') {
      return syncGarmin(id, signal);
    }

    if (provider !== 'intervals-icu') {
      return t('workout_provider_required');
    }

    let credentials: readonly [string, string] | null;

    try {
      credentials = repositories.connectionsRepository.read(id, 'intervals');
    } catch (error) {
      if (!(error instanceof UnreadableCredentialsError)) {
        throw error;
      }
      runtime.world.lifecycle.log.warn('connections.unreadable', 'Saved credentials cannot be decrypted', {
        playerId: id,
        provider: 'intervals',
        error,
      });

      return t('workout_intervals_credentials_unreadable');
    }

    if (!credentials) {
      return t('workout_intervals_credentials_missing');
    }
    const [athlete, key] = credentials;

    if (!isIntervalsAthleteId(athlete)) {
      throw new Error(t('invalid_athlete_id'));
    }

    const headers = {
      Authorization: t('basic', { value1: Buffer.from(`API_KEY:${key}`).toString('base64') }),
    };

    const base = `https://intervals.icu/api/v1/athlete/${athlete}`;
    const today = localDay(new Date());

    const response = await fetch(
      `${base}/events?${new URLSearchParams({ oldest: today, newest: today, category: 'WORKOUT' })}`,
      { headers, signal },
    );

    if (!response.ok) {
      throw new Error(t('intervals_icu_sync_failed'));
    }

    const events = Schema.decodeUnknownSync(
      Schema.Array(
        Schema.Struct({
          id: Schema.Union([Schema.Int.check(Schema.isGreaterThan(0)), Schema.String.check(Schema.isPattern(/^\d+$/))]),
          name: Schema.optional(Schema.NullOr(Schema.String)),
          start_date_local: Schema.optional(Schema.String),
          start_date: Schema.optional(Schema.String),
          category: Schema.String.pipe(withDefault('WORKOUT')),
          description: Schema.optional(Schema.NullOr(Schema.String)),
          icu_training_load: Schema.optional(Schema.NullOr(Schema.Finite)),
        }),
      ),
    )(await response.json());

    const selected = events.filter(
      (event) =>
        event.category === 'WORKOUT' &&
        (event.start_date_local?.slice(0, 10) ?? localDay(new Date(event.start_date ?? ''))) === today,
    );

    const downloads = [];

    for (const event of selected) {
      const response = await fetch(`${base}/events/${event.id}/download.zwo`, {
        headers,
        signal,
      });

      if (!response.ok) {
        throw new Error(t('intervals_icu_download_failed'));
      }
      const text = await response.text();

      if (!workoutDetails(text)) {
        throw new Error(t('invalid_cycling_workout'));
      }
      downloads.push({ event, text });
    }

    const previous = entriesOf(id);

    const pendingFiles = new Map<string, string>();

    const entries = downloads.map(({ event, text }) => {
      const old = previous.find((item) => String(item.event_id) === String(event.id));

      const identity = Schema.is(uuid)(old?.workout_id)
        ? Schema.decodeUnknownSync(Schema.String)(old?.workout_id)
        : repositories.cryptoRepository.randomUUID();

      // Preserve interleaved exercise and text-event order while replacing only the root ID.
      const ordered = decodeOwned(Schema.Array(documentSchema))(
        new XMLParser({
          preserveOrder: true,
          ignoreAttributes: false,
          processEntities: true,
          parseTagValue: false,
          parseAttributeValue: false,
        }).parse(text),
      );

      const root = ordered.find((node) => 'workout_file' in node);

      if (!root) {
        throw new Error(t('missing_workout_root'));
      }
      const children = Schema.decodeUnknownSync(Schema.Array(documentSchema))(root.workout_file);
      root.workout_file = [...children.filter((node) => !('uniqueId' in node)), { uniqueId: [{ '#text': identity }] }];
      const content = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false }).build(ordered);

      const file = fileOf(identity);

      if (!file) {
        throw new Error(t('invalid_workout_identity'));
      }
      pendingFiles.set(file, Schema.decodeUnknownSync(Schema.String)(content));

      return {
        ...event,
        provider: 'intervals-icu',
        event_id: event.id,
        workout_id: identity,
        filename: `${identity}.zwo`,
        synced_at: new Date().toISOString(),
      };
    });

    pendingFiles.set(
      metadataFileOf(id),
      JSON.stringify({
        ...(entries[0] ?? { provider: 'intervals-icu' }),
        workouts: entries,
      }),
    );
    pendingFiles.set(resolve(runtime.profiles.folder(id), 'active_workout_provider.txt'), 'intervals-icu');
    signal.throwIfAborted();
    // Publication is synchronous: no request can observe new metadata before all files exist.
    repositories.workoutPublication.publish(pendingFiles);

    return t('synced_intervals_icu_workouts', { value1: entries.length });
  }

  /** Fetches the rider's scheduled Garmin cycling workouts and publishes today's-window entries. */
  async function syncGarmin(id: number, signal: AbortSignal) {
    signal.throwIfAborted();

    if (!repositories.riderDocuments.has(id, 'garth/oauth1_token.json')) {
      return t('workout_garmin_credentials_missing');
    }

    const today = localDay(new Date());
    const horizon = localDay(new Date(Date.now() + 14 * 86_400_000));
    let scheduled: Array<ScheduledGarminWorkout>;

    try {
      scheduled = await repositories.garminRepository.scheduledWorkouts(
        repositories.garminRepository.tokenStore(repositories.riderDocuments, id),
        runtime.config.integrations.garmin.domain,
        today,
        horizon,
      );
    } catch (error) {
      if (error instanceof DeliveryRefusedError && error.code === 'garmin_unauthorized') {
        return t('workout_garmin_unauthorized');
      }

      if (error instanceof DeliveryRefusedError) {
        throw error;
      }
      throw new Error(t('workout_garmin_sync_failed'), { cause: error });
    }
    signal.throwIfAborted();

    const previous = entriesOf(id);
    const pendingFiles = new Map<string, string>();
    const entries = [];

    for (const item of scheduled) {
      const record = GarminWorkoutConverter.normalizeWorkoutRecord(item.record);

      if (!record) {
        continue;
      }
      const old = previous.find((entry) => String(entry.event_id) === item.event_id);

      const identity = Schema.is(uuid)(old?.workout_id)
        ? Schema.decodeUnknownSync(Schema.String)(old?.workout_id)
        : repositories.cryptoRepository.randomUUID();

      const xml = GarminWorkoutConverter.garminWorkoutToZwo(record, identity, runtime.config.integrations.garmin.ftp);

      if (!xml || !workoutDetails(xml)) {
        continue;
      }
      const file = garminFileOf(identity);

      if (!file) {
        continue;
      }
      const planned = item.schedule_date_local ?? today;

      pendingFiles.set(file, xml);
      entries.push({
        provider: 'garmin',
        event_id: item.event_id,
        workout_id: identity,
        name: item.name ?? '',
        description: record.description ?? '',
        start_date_local: planned,
        start_date: `${planned}T00:00:00`,
        synced_at: new Date().toISOString(),
      });
    }

    pendingFiles.set(
      garminMetadataFileOf(id),
      JSON.stringify({
        ...(entries[0] ?? { provider: 'garmin' }),
        workouts: entries,
      }),
    );
    pendingFiles.set(resolve(runtime.profiles.folder(id), 'active_workout_provider.txt'), 'garmin');
    signal.throwIfAborted();
    // Publication is synchronous: no request can observe new metadata before all files exist.
    repositories.workoutPublication.publish(pendingFiles);

    return t('synced_garmin_workouts', { value1: entries.length });
  }

  function importBridge(id: number, signal = AbortSignal.timeout(30_000)) {
    const settings = SettingsService.resolveRiderSettings(runtime.config.riderDefaults, runtime.settings.read(id));

    const folder = settings.workouts.trainingpeaks.bridgeFolder;

    if (!folder || !repositories.filesRepository.existsSync(folder)) {
      return t('workout_trainingpeaks_folder_missing');
    }
    const imports: Array<{ filename: string; content: Buffer }> = [];

    for (const name of repositories.filesRepository.readdirSync(folder).sort()) {
      if (
        !name.toLowerCase().endsWith('.zwo') ||
        !repositories.filesRepository.lstatSync(resolve(folder, name)).isFile()
      ) {
        continue;
      }
      signal.throwIfAborted();
      const content = repositories.filesRepository.readFileSync(resolve(folder, name));
      parseXML(content.toString('utf8'));

      const filename = `trainingpeaks-${
        name
          .slice(0, -4)
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, '-')
          .replaceAll(/^-|-$/g, '') || 'workout'
      }.zwo`;

      if (imports.some((item) => item.filename === filename)) {
        throw new Error(t('workout_filenames_collide', { value1: filename }));
      }
      imports.push({ filename, content });
    }

    const pendingFiles = new Map<string, string | Uint8Array>();

    for (const item of imports) {
      pendingFiles.set(resolve(runtime.profiles.folder(id), 'customworkouts', item.filename), item.content);
    }
    pendingFiles.set(resolve(runtime.profiles.folder(id), 'active_workout_provider.txt'), 'trainingpeaks');
    signal.throwIfAborted();
    const timestamp = Math.floor(Date.now() / 1000);
    repositories.workoutPublication.publish(pendingFiles, () => {
      for (const { filename } of imports) {
        const repository = repositories.storageRepository;
        const old = repository.findZfile(id, 'customworkouts', filename);

        if (old) {
          repository.updateZfileTimestamp(timestamp, old.id);
        } else {
          repository.insertZfile(id, 'customworkouts', filename, timestamp);
        }
      }
    });

    return t('imported_trainingpeaks_workouts', { value1: imports.length });
  }

  const requests = new Map<string, Promise<void>>();

  /** Sync the rider's workouts from their provider once at a time; failures keep the cached workouts. */
  function automatic(id: number, android: boolean) {
    let current: string | null;

    try {
      current = providerOf(id);
    } catch {
      runtime.world.lifecycle.log.warn('workout.provider_unavailable', 'Automatic workout provider unavailable', {
        playerId: id,
      });

      return Promise.resolve();
    }

    if (!current || (android && current !== 'intervals-icu')) {
      return Promise.resolve();
    }
    const key = `${id}:${current}`;
    const previous = requests.get(key);

    if (previous) {
      return previous;
    }

    const request = syncNow(id, AbortSignal.timeout(5000))
      .then(() => {})
      .catch((error: unknown) => {
        runtime.world.lifecycle.log.warn(
          'workout.sync_failed',
          'Automatic workout sync failed; retaining cached workouts',
          { playerId: id, error: error instanceof Error ? error : String(error) },
        );
      })
      .finally(() => {
        if (requests.get(key) === request) {
          requests.delete(key);
        }
      });

    requests.set(key, request);

    return request;
  }

  return {
    provider: Effect.fn('WorkoutsService.provider')(function* (id: number) {
      return providerOf(id);
    }),
    entries: Effect.fn('WorkoutsService.entries')(function* (id: number) {
      return entriesOf(id);
    }),
    metadataFile: Effect.fn('WorkoutsService.metadataFile')(function* (id: number) {
      return metadataFileOf(id);
    }),
    /** Unmodified stored entries, including fields the schema does not read. */
    stored: Effect.fn('WorkoutsService.stored')(function* (id: number) {
      return storedOf(id);
    }),
    removeEvent: Effect.fn('WorkoutsService.removeEvent')(function* (id: number, eventId: string | number) {
      dropEvent(id, eventId);
    }),
    list: Effect.fn('WorkoutsService.list')(function* (id: number, now: Date = new Date()) {
      return scheduled(id, now);
    }),
    file: Effect.fn('WorkoutsService.file')(function* (id: string) {
      return fileOf(id);
    }),
    /** Fetch today's workouts from the rider's provider and publish them. A failure is a defect. */
    sync: Effect.fn('WorkoutsService.sync')(function* (
      id: number,
      requested?: string,
      signal: AbortSignal = AbortSignal.timeout(30_000),
    ) {
      return yield* Effect.promise(() => syncNow(id, signal, requested));
    }),
    /** Sync in the background of a request: failures are logged, and concurrent requests share one sync. */
    syncWorkoutsAutomatically: Effect.fn('WorkoutsService.syncWorkoutsAutomatically')(function* (
      id: number,
      android: boolean = false,
    ) {
      yield* Effect.promise(() => automatic(id, android));
    }),
  };
});

export class WorkoutsService extends Context.Service<WorkoutsService, Effect.Success<typeof make>>()(
  'zluggish/WorkoutsService',
) {
  static readonly layer = Layer.effect(WorkoutsService, make);

  static readonly workoutDetails = workoutDetails;
}
