import { UploadsService } from '#src/services/uploads.service';
import { ActivitiesService } from '#src/services/activities.service';
import { FitnessService } from '#src/services/fitness.service';
import { StorageService } from '#src/services/storage.service';
import { RecordsService } from '#src/services/records.service';
import { runtimeFixture } from '#tests/support/runtime';
import assert from 'node:assert/strict';
import type { SQLInputValue, StatementSync } from 'node:sqlite';
import { test } from 'node:test';
import { Effect, Schema } from 'effect';

const tables = new Set([
  'activity',
  'segment_result',
  'route_result',
  'power_curve',
  'playback',
  'zfile',
  'notification',
  'goal',
  'activity_upload',
  'activity_file',
  'activity_image',
  'activity_media',
  'job',
]);

/** Several years of history for five riders, and the main reads against it. Every main
query must search an index; a plain SCAN of a large table fails the test.
*/
await test('the main queries use an index on several years of history', async (t) => {
  const f = runtimeFixture(t);
  const db = f.accounts.db;
  const riders = [];

  for (let index = 0; index < 5; index++) riders.push(await f.accounts.create(`Rider ${index}`, 'test-password'));

  db.exec('BEGIN');
  const day = 86_400_000;
  const start = Date.UTC(2022, 0, 1);

  const activity = db.prepare(
    'INSERT INTO activity (player_id, name, start_date, end_date, date, distanceInMeters, sport) VALUES (?, ?, ?, ?, ?, ?, 0)',
  );

  const segment = db.prepare(
    'INSERT INTO segment_result (player_id, segment_id, world_time, elapsed_ms, sport, finish_time_str) VALUES (?, ?, ?, ?, 0, ?)',
  );

  const curve = db.prepare(
    'INSERT INTO power_curve (player_id, time, power, power_wkg, timestamp, activity_id) VALUES (?, ?, ?, 3, ?, ?)',
  );

  for (const rider of riders)
    for (let i = 0; i < 4 * 365; i++) {
      const date = new Date(start + i * day).toISOString();
      const id = Number(activity.run(rider.player_id, 'Ride', date, date, date, 20_000).lastInsertRowid);

      curve.run(rider.player_id, '300', 250, (start + i * day) / 1000, id);
      segment.run(rider.player_id, i % 50, start + i * day, 60_000 + i, date);
    }

  db.exec('COMMIT; ANALYZE;');

  const captured: Array<{ sql: string; args: Array<SQLInputValue> }> = [];
  const prepare = db.prepare.bind(db);

  t.mock.method(db, 'prepare', (sql: string) => {
    const statement: StatementSync = prepare(sql);

    for (const method of ['all', 'get'] as const) {
      const original = statement[method].bind(statement);

      t.mock.method(statement, method, (...args: Array<SQLInputValue>) => {
        captured.push({ sql, args });

        return original(...args);
      });
    }

    return statement;
  });

  const rider = riders[0];
  assert.ok(rider);
  f.effects.runSync(ActivitiesService.use((service) => service.recentActivities(rider.player_id, rider.player_id)));
  f.effects.runSync(ActivitiesService.use((service) => service.activityFeed(null, null, 0, rider.player_id, 50)));
  f.effects.runSync(
    ActivitiesService.use((service) => service.activityFeed(rider.player_id, '1000', 0, rider.player_id, 50)),
  );
  f.effects.runSync(ActivitiesService.use((service) => service.activityById('100')));
  f.effects.runSync(ActivitiesService.use((service) => service.findActivity(100n, rider.player_id)));
  f.effects.runSync(
    Effect.gen(function* () {
      const records = yield* RecordsService;
      yield* records.mine(rider.player_id, 'CYCLING', '7');
      yield* records.segmentLeaderboard(7n, BigInt(start + 1000 * day));
      yield* records.segmentLeaderboard(null, BigInt(start + 1400 * day));
      yield* records.listRouteResult(rider.player_id);
    }),
  );
  f.accounts.repositories.fitnessRepository.findPowerCurve(rider.player_id, '300', 0);
  f.effects.runSync(
    Effect.gen(function* () {
      const fitness = yield* FitnessService;
      yield* fitness.week(rider.player_id, start + 700 * day);
      yield* fitness.powerCurve(rider.player_id, 'all', 90);
    }),
  );
  f.effects.runSync(UploadsService.use((service) => service.status(rider.player_id)));
  f.accounts.repositories.uploadsRepository.waiting();
  f.accounts.repositories.jobsRepository.ready();
  f.effects.runSync(StorageService.use((storage) => storage.list(rider.player_id, 'customworkouts')));
  db.prepare('SELECT 1').get();

  const plans = new Map<string, Array<string>>();

  for (const { sql, args } of captured) {
    if (!/^select/i.test(sql) || plans.has(sql)) continue;
    const rows = prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args);
    plans.set(
      sql,
      rows.map((row) => Schema.decodeUnknownSync(Schema.String)(row.detail)),
    );
  }

  assert.ok(plans.size >= 12, `captured ${plans.size} queries`);

  for (const [sql, details] of plans)
    for (const detail of details) {
      const scan = /^SCAN (\w+)$/.exec(detail);
      assert.ok(!scan || !tables.has(scan[1] ?? ''), `${detail} in ${sql}`);
    }
});
