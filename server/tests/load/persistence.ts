import { BackupService } from '#src/services/backup.service';
import { RideRecoveryService } from '#src/services/ride-recovery.service';
import { UploadsService } from '#src/services/uploads.service';
import { JobsService } from '#src/services/jobs.service';
import { DurabilityService } from '#src/services/durability.service';
import { ConnectionsService } from '#src/services/connections.service';
import { SettingsService } from '#src/services/settings.service';
// Repeatable persistence and riding-latency load test. Run with `pnpm test:load`.
// It drives the riding path in process, finishes a group of riders at once while
// others keep riding, and can add a slow disk, large media and a slow provider.
// Pass --backup-mb to stage that much data for a backup during the completion phase.
import { makeAppRuntime } from '#src/layers';
import { validateConfig } from '#src/config/index';
import { packageRoot } from '#src/config/load';
import { createGameApp } from '#src/http/app';
import {
  ActivityMediaSaveRequestSchema,
  ActivityMediaSaveResultSchema,
  ActivitySchema,
} from '#src/protocol/generated/activity_pb';
import { GhostSchema, PlayerStateSchema } from '#src/protocol/generated/udp-node-msgs_pb';
import type { PlayerState } from '#src/protocol/generated/udp-node-msgs_pb';
import { CheckpointRepository } from '#src/repositories/checkpoint.repository';
import { metrics } from '#src/repositories/metrics.repository';
import { AccountsService } from '#src/services/auth.service';
import { SessionsService } from '#src/services/browser-session.service';
import { Simulation } from '#src/world/simulation';
import { World, worldTime } from '#src/world/state';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Encoder, Profile } from '@garmin/fitsdk';
import type { RecordMesg } from '@garmin/fitsdk';
import fs, { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { mock } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { Schema } from 'effect';
import { NumberFromInput } from '#src/schema';

const { values } = parseArgs({
  options: {
    riders: { type: 'string', default: '40' },
    finishers: { type: 'string', default: '15' },
    'ghost-files': { type: 'string', default: '4' },
    'slow-disk-ms': { type: 'string', default: '0' },
    'provider-ms': { type: 'string', default: '2000' },
    'backup-mb': { type: 'string', default: '0' },
    'media-mb': { type: 'string', default: '32' },
    'phase-seconds': { type: 'string', default: '8' },
    'long-reader': { type: 'boolean', default: false },
    // macOS fsync() does not flush the drive cache; F_FULLFSYNC does. SQLite uses it
    // with this pragma, which makes each commit pay a real flush.
    'full-fsync': { type: 'boolean', default: false },
    storage: { type: 'string' },
    output: { type: 'string' },
  },
});

const count = (name: keyof typeof values) =>
  Schema.decodeUnknownSync(NumberFromInput.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)))(values[name]);

const riders = count('riders');
const finishers = Math.min(riders, count('finishers'));
const ghostFiles = count('ghost-files');
const slowDisk = count('slow-disk-ms');
const providerDelay = count('provider-ms');
const backupMiB = count('backup-mb');
const mediaBytes = count('media-mb') * 1024 * 1024;
const phaseSeconds = count('phase-seconds');
const sleep = (ms: number) =>
  new Promise<void>((done) => {
    setTimeout(done, ms);
  });

// A slow disk delays every flush. Synchronous flushes block the caller, just as a
// slow fsync does; asynchronous flushes wait off the main thread.
if (slowDisk > 0) {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const fsyncSync = fs.fsyncSync;
  const fsync = fs.fsync;
  fs.fsyncSync = (fd) => {
    Atomics.wait(wait, 0, 0, slowDisk);
    fsyncSync(fd);
  };

  // SAFETY: The load test replaces only the callback form; promisify is unused.
  fs.fsync = ((fd: number, callback: fs.NoParamCallback) => {
    setTimeout(() => fsync(fd, callback), slowDisk);
  }) as typeof fs.fsync;

  syncBuiltinESMExports();
  const handle = await fs.promises.open(resolve(tmpdir(), 'zluggish-load-probe'), 'w');
  const prototype = Object.getPrototypeOf(handle);
  const sync = prototype.sync;
  prototype.sync = async function (this: typeof handle) {
    await sleep(slowDisk);

    return sync.call(this);
  };

  await handle.close();
}

function fitActivity(seconds: number) {
  const encoder = new Encoder();
  const record = Schema.decodeUnknownSync(Schema.Finite)(Profile.MesgNum.RECORD);

  for (let index = 0; index < seconds; index++) {
    const mesg: RecordMesg = {
      timestamp: 1_100_000_000 + index,
      power: 150 + (index % 120),
      cadence: 85,
      heartRate: 130,
      distance: index * 8,
      speed: 8,
      altitude: 100,
      positionLat: 0,
      positionLong: 0,
    };

    encoder.onMesg(record, mesg);
  }

  return encoder.close();
}

function riderState(id: bigint, tick: number) {
  return create(PlayerStateSchema, {
    id,
    worldTime: worldTime(),
    roadTime: 5000 + tick * 3000,
    distance: tick * 8,
    f19: (6 << 16) | 4,
    aux3: 10 << 8,
    x: tick * 10,
    z: Number(id),
    sport: 0,
  });
}

const temporaryRoot = values.storage ? null : mkdtempSync(resolve(tmpdir(), 'zluggish-load-'));
const storage = values.storage ? resolve(values.storage) : resolve(temporaryRoot ?? tmpdir(), 'storage');

mkdirSync(storage, { recursive: true });

const accounts = AccountsService.open(storage);
const sessions = SessionsService.open(accounts);

const config = validateConfig({
  storageDir: storage,
  logging: { level: 'ERROR', rideProgressIntervalSeconds: 0 },
  // A short interval puts several ride recovery checkpoints in each phase.
  recovery: { checkpointSeconds: 5 },
});

const assets = resolve(packageRoot(), '../assets');

const tokens = Schema.decodeUnknownSync(
  Schema.Struct({ access: Schema.String, refresh: Schema.String, id: Schema.String }),
)(JSON.parse(readFileSync(resolve(assets, 'tokens.json'), 'utf8')));

const world = new World();

const context = {
  accounts,
  sessions,
  profiles: accounts.repositories.profileRepository,
  settings: accounts.repositories.settingsRepository,
  world,
  config,
  assets,
  tokens,
};

const effects = makeAppRuntime(context);
const runtime = Object.assign(context, { effects });
const app = createGameApp({ gameInfo: '{}', gameInfoHash: '0', variants: '{}' }, runtime);
const providerCalls = { started: 0, finished: 0 };

mock.method(globalThis, 'fetch', async () => {
  providerCalls.started++;
  await sleep(providerDelay);
  providerCalls.finished++;

  return Response.json({ id: 1 });
});

const fit = fitActivity(3600);

const ghost = toBinary(
  GhostSchema,
  create(GhostSchema, { playerId: 1, states: Array.from({ length: 1200 }, (_, tick) => riderState(1n, tick)) }),
);

type LoadRider = { id: bigint; activity: number; auth: string; tick: number; riding: boolean };

const fleet: LoadRider[] = [];

for (let index = 0; index < riders; index++) {
  const rider = await accounts.create(`Load Rider ${index}`, 'load-test-password');
  const id = BigInt(rider.player_id);
  runtime.effects.runSync(SettingsService.use((service) => service.save(rider.player_id, { 'ghosts.enabled': true })));
  runtime.effects.runSync(
    ConnectionsService.use((service) => service.save(rider.player_id, 'intervals', ['1', 'key'])),
  );

  for (let file = 0; file < ghostFiles; file++) {
    const folder = resolve(runtime.profiles.folder(rider.player_id), 'ghosts', '6', '10');
    mkdirSync(folder, { recursive: true });
    writeFileSync(resolve(folder, `activity-${file}.bin`), ghost);
  }

  const auth = `Bearer ${sessions.tokens(rider, tokens).access_token}`;

  const created = await app.request(`/api/profiles/${id}/activities`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-protobuf-lite' },
    body: toBinary(
      ActivitySchema,
      create(ActivitySchema, {
        playerId: id,
        courseId: 6n,
        name: 'Load ride',
        startDate: new Date().toISOString(),
        sport: 0,
      }),
    ),
  });

  const activity = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.Finite }))(await created.json()).id;
  fleet.push({ id, activity, auth, tick: 0, riding: false });
}

if (backupMiB > 0) {
  const chunk = accounts.repositories.cryptoRepository.randomBytes(1024 * 1024);
  const file = openSync(resolve(storage, 'load-backup-input.bin'), 'wx');

  try {
    for (let index = 0; index < backupMiB; index++) writeFileSync(file, chunk);
  } finally {
    closeSync(file);
  }
}

if (values['full-fsync']) accounts.db.exec('PRAGMA fullfsync=ON; PRAGMA checkpoint_fullfsync=ON;');

const simulation = new Simulation(runtime);

await simulation.ready;

simulation.start();

const checkpoints = new CheckpointRepository(accounts.db, resolve(storage, 'zluggish.db'), 1000);

checkpoints.start();

runtime.effects.runSync(DurabilityService.use((service) => service.start()));

runtime.effects.runSync(RideRecoveryService.use((service) => service.start()));

runtime.effects.runSync(UploadsService.use((service) => service.start()));

runtime.effects.runSync(JobsService.use((service) => service.start(250)));

metrics.monitorEventLoop();

// Each rider sends one state per second, spread across the second like real clients.
const driver = setInterval(() => {
  const slot = Math.floor(performance.now() / 50) % 20;

  for (const [index, rider] of fleet.entries()) {
    if (!rider.riding || index % 20 !== slot) continue;
    rider.tick++;
    const state: PlayerState = riderState(rider.id, rider.tick);
    world.receive(rider.id, state);
    world.responses(rider.id, state, worldTime());
  }
}, 50);

async function finish(rider: LoadRider) {
  rider.riding = false;

  const activity = create(ActivitySchema, {
    id: BigInt(rider.activity),
    playerId: rider.id,
    courseId: 6n,
    name: 'Load ride',
    sport: 0,
    distanceInMeters: 28_800,
    startDate: new Date(Date.now() - 3_600_000).toISOString(),
    endDate: new Date().toISOString(),
    fit,
    fitFilename: 'load.fit',
  });

  const response = await app.request(`/api/profiles/${rider.id}/activities/${rider.activity}?upload-to-strava=true`, {
    method: 'PUT',
    headers: { Authorization: rider.auth, 'Content-Type': 'application/x-protobuf-lite' },
    body: toBinary(ActivitySchema, activity),
  });

  if (response.status !== 200) throw new Error(`Completion failed with HTTP ${response.status}`);
}

const phases: Record<string, ReturnType<typeof metrics.summary>> = {};

async function phase(name: string, action: () => Promise<void>) {
  metrics.reset();
  await Promise.all([action(), sleep(phaseSeconds * 1000)]);
  phases[name] = metrics.summary();
}

await phase('join', async () => {
  for (const rider of fleet) {
    world.login(rider.id, new Uint8Array(16));
    rider.riding = true;
    await sleep((phaseSeconds * 500) / Math.max(1, riders));
  }
});

await phase('riding', () => Promise.resolve());

let backupDurationMs: number | null = null;

async function runBackup() {
  if (backupMiB === 0) return;
  const backup = effects.runSync(BackupService);
  const operation = crypto.randomUUID();
  const start = performance.now();
  effects.runSync(backup.request(operation));

  for (;;) {
    const status = effects.runSync(backup.status(operation))?.state;

    if (status === 'done') {
      backupDurationMs = Math.round(performance.now() - start);

      return;
    }

    if (status === 'failed' || performance.now() - start > 120_000) throw new Error('Load-test backup did not finish');
    await sleep(50);
  }
}

await phase('completion', async () => {
  const group = fleet.slice(0, finishers);

  const media = async () => {
    if (mediaBytes === 0) return;
    const rider = fleet.at(-1);

    if (!rider) return;

    const issued = await app.request(`/api/profiles/${rider.id}/activities/${rider.activity}/medias`, {
      method: 'POST',
      headers: { Authorization: rider.auth, 'Content-Type': 'application/x-protobuf-lite' },
      body: toBinary(
        ActivityMediaSaveRequestSchema,
        create(ActivityMediaSaveRequestSchema, { contentType: 'video/mp4' }),
      ),
    });

    const url = new URL(
      fromBinary(ActivityMediaSaveResultSchema, new Uint8Array(await issued.arrayBuffer())).uploadUrl,
    );

    await app.request(url.pathname + url.search, { method: 'PUT', body: new Uint8Array(mediaBytes) });
  };

  // A long reader keeps a snapshot open across the burst; checkpoints cannot pass it.
  const reader = values['long-reader'] ? new DatabaseSync(resolve(storage, 'zluggish.db'), { readOnly: true }) : null;
  reader?.exec('BEGIN');
  reader?.prepare('SELECT count(*) FROM activity').get();
  await Promise.all([runBackup(), media(), ...group.map((rider) => finish(rider))]);
  await sleep(phaseSeconds * 500);
  reader?.exec('COMMIT');
  reader?.close();
});

// Post-commit work (power curves, exports, charts, deliveries) runs while riders ride.
await phase('jobs', async () => {
  while (runtime.effects.runSync(JobsService.use((jobs) => jobs.busy()))) await sleep(100);
});

clearInterval(driver);

await simulation.close();

await runtime.effects.runPromise(JobsService.use((service) => service.close()));

await runtime.effects.runPromise(RideRecoveryService.use((service) => service.close()));

await runtime.effects.runPromise(DurabilityService.use((service) => service.close()));

await checkpoints.close();

metrics.stopEventLoop();

const result = {
  date: new Date().toISOString(),
  hardware: {
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
    platform: `${platform()} ${release()}`,
    node: process.version,
    storage: values.storage ? resolve(values.storage) : `temporary directory under ${tmpdir()}`,
  },
  parameters: {
    riders,
    finishers,
    ghostFiles,
    slowDisk,
    providerDelay,
    mediaBytes,
    backupMiB,
    phaseSeconds,
    fitBytes: fit.length,
    longReader: values['long-reader'],
    fullFsync: values['full-fsync'],
  },
  pendingJobs: accounts.repositories.jobsRepository.list().filter((job) => job.state !== 'done').length,
  providerCalls,
  backupDurationMs,
  phases,
};

accounts.close();

runtime.settings.close();

if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });

const text = JSON.stringify(result, null, 2);

if (values.output) writeFileSync(values.output, `${text}\n`);

process.stdout.write(`${text}\n`);
