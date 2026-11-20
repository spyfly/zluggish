import { UploadsService } from '#src/services/uploads.service';
import { ActivitiesService } from '#src/services/activities.service';
import { JobsService } from '#src/services/jobs.service';
import { DurabilityService } from '#src/services/durability.service';
import { DocumentsService } from '#src/services/documents.service';
import { ActivitySchema } from '#src/protocol/generated/activity_pb';
import { DurabilityRepository } from '#src/repositories/durability.repository';
import { binary, mediumFixture } from '#tests/medium/support';
import { create } from '@bufbuild/protobuf';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Schema, Effect } from 'effect';

const fit = readFileSync(new URL('../fixtures/ride.fit', import.meta.url));

await test('the runtime connection commits without a flush only while the barrier runs', async (t) => {
  const f = await mediumFixture(t);
  const synchronous = () => f.accounts.db.prepare('PRAGMA synchronous').get()?.synchronous;
  assert.equal(synchronous(), 2, 'FULL without the barrier');
  f.effects.runSync(DurabilityService.use((service) => service.start()));
  assert.equal(synchronous(), 1, 'NORMAL with the barrier');
  await f.effects.runPromise(DurabilityService.use((service) => service.close()));
  assert.equal(synchronous(), 2);
});

await test('a request that saves waits for the flush before its response; a read does not', async (t) => {
  const f = await mediumFixture(t);
  const durability = f.effects.runSync(DurabilityService);
  f.effects.runSync(durability.start());
  // The fixture disposes the runtime first: the close runs on the service itself.
  t.after(() => Effect.runPromise(durability.close()));
  const gate = Promise.withResolvers<void>();
  const flushes = t.mock.method(DurabilityRepository.prototype, 'flush', () => gate.promise);

  const read = await f.request(`/api/profiles/${f.rider.player_id}/activities`);
  assert.equal(read.status, 200);
  assert.equal(flushes.mock.callCount(), 0);

  let answered = false;

  const save = Promise.resolve(
    f.request(`/api/profiles/${f.rider.player_id}/activities`, {
      method: 'POST',
      ...binary(ActivitySchema, {
        playerId: BigInt(f.rider.player_id),
        courseId: 6n,
        name: 'Durable',
        startDate: new Date().toISOString(),
      }),
    }),
  ).then((response) => {
    answered = true;

    return response;
  });

  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
  assert.equal(flushes.mock.callCount(), 1);
  assert.equal(answered, false, 'no acknowledgement before the flush');
  gate.resolve();
  const saved = await save;
  assert.equal(saved.status, 200);
});

await test('a delivery flushes its sending state before the provider request', async (t) => {
  const f = await mediumFixture(t);
  const durability = f.effects.runSync(DurabilityService);
  f.effects.runSync(durability.start());
  // The fixture disposes the runtime first: the close runs on the service itself.
  t.after(() => Effect.runPromise(durability.close()));
  f.effects.runSync(DocumentsService.use((service) => service.put(f.rider.player_id, 'runalyze_token.txt', 'token')));
  const order: Array<string> = [];
  const flush = DurabilityRepository.prototype.flush;

  t.mock.method(DurabilityRepository.prototype, 'flush', function (this: DurabilityRepository) {
    if (f.accounts.db.isOpen)
      order.push(
        `flush:${f.effects.runSync(UploadsService.use((service) => service.status(f.rider.player_id)))[0]?.state ?? 'none'}`,
      );

    return flush.call(this);
  });
  t.mock.method(globalThis, 'fetch', () => {
    order.push('send');

    return Promise.resolve(new Response(null, { status: 200 }));
  });

  const data = {
    playerId: BigInt(f.rider.player_id),
    courseId: 6n,
    name: 'Delivered',
    startDate: new Date().toISOString(),
    distanceInMeters: 3000,
    fitFilename: 'ride.fit',
    fit,
  };

  const response = await f.request(`/api/profiles/${f.rider.player_id}/activities`, {
    method: 'POST',
    ...binary(ActivitySchema, data),
  });

  const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.Finite }))(await response.json());
  f.effects.runSync(
    ActivitiesService.use((service) => service.finalize(create(ActivitySchema, { ...data, id: BigInt(id) }))),
  );
  order.length = 0;
  await f.effects.runPromise(JobsService.use((service) => service.drain()));
  assert.deepEqual(order.slice(0, 2), ['flush:sending', 'send']);
});

await test('concurrent flushes share the WAL flush and each covers earlier commits', async (t) => {
  const f = await mediumFixture(t);
  const barrier = new DurabilityRepository(f.accounts.db, resolve(f.config.storageDir, 'zluggish.db'));
  barrier.start();
  t.after(() => barrier.close());
  f.accounts.db.prepare("UPDATE user SET first_name='Flushed' WHERE player_id=?").run(f.rider.player_id);
  const flushes = [barrier.flush(), barrier.flush(), barrier.flush(), barrier.flush()];
  assert.equal(flushes[1], flushes[2], 'callers during a flush share the next one');
  await Promise.all(flushes);
  assert.ok(barrier.changes() > 0);
});
