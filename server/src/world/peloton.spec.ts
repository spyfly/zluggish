import type { ResolvedConfig } from '#src/config/index';
import { PlayerProfileSchema } from '#src/protocol/generated/profile_pb';
import { GhostSchema, PlayerStateSchema } from '#src/protocol/generated/udp-node-msgs_pb';
import { Peloton } from '#src/world/peloton';
import { Recording } from '#src/world/recording';
import { RiderPool } from '#src/world/riders';
import { create, equals, toBinary } from '@bufbuild/protobuf';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const config: ResolvedConfig['pelotons'][number] = {
  bots: 12,
  columns: 0,
  rowGap: 2.2,
  lateralSpacing: 65_000,
  besidePacer: 2,
  dynamics: 1,
  shuffleInterval: 30,
  draft: 0.7,
  climbStretch: 1,
  maxDrop: 40,
  pacer: 1,
  enabled: true,
  riders: [],
  id: 'test',
};

// Peloton only calls pool.profile(id, spec); skip the constructor, which reads asset files.
const pool: RiderPool = Object.assign(Object.create(RiderPool.prototype), {
  profile: (id: bigint) => create(PlayerProfileSchema, { id, isMale: true }),
});

const states = Array.from({ length: 40 }, (_, i) =>
  create(PlayerStateSchema, {
    roadTime: i * 1000,
    x: i * 10,
    z: i,
    speed: 30_000_000,
    power: 150 + i,
    worldTime: BigInt(i * 1000),
    roadPosition: 10_000_000,
  }),
);

const build = (onState: () => void) => {
  const recording = new Recording(toBinary(GhostSchema, create(GhostSchema, { playerId: 1, states })));
  const decode = recording.state.bind(recording);
  recording.state = (index) => {
    onState();

    return decode(index);
  };

  return new Peloton(
    0,
    { profile: create(PlayerProfileSchema, { id: 1n }), recording, position: 5, folder: '', pacer: true },
    config,
    pool,
  );
};

await test('peloton tick output is independent of the per-tick decode cache', () => {
  let cachedDecodes = 0;
  const cached = build(() => cachedDecodes++);
  const reference = build(() => {});

  for (let tick = 0; tick < 3; tick++) {
    cached.pacer.position = reference.pacer.position = 5 + tick;
    const left = cached.tick(tick, 1000n);
    // Mutating output must not leak into the next tick through the cache.

    for (const state of left) {
      state.x = -1;
    }

    const right = reference.tick(tick, 1000n);

    for (const state of right) {
      state.x = -1;
    }
    assert.equal(left.length, 12);
  }

  cached.pacer.position = reference.pacer.position = 9;
  const left = cached.tick(10, 1000n);
  const right = reference.tick(10, 1000n);
  assert.equal(left.length, right.length);

  for (const [i, state] of left.entries()) {
    assert.ok(equals(PlayerStateSchema, state, right[i] ?? state));
  }
});

await test('peloton decodes each pacer state once in the constructor and few per tick', () => {
  let decodes = 0;
  const peloton = build(() => decodes++);
  assert.equal(decodes, states.length);
  decodes = 0;
  peloton.tick(0, 1000n);
  assert.ok(decodes <= 12 + 1, `decoded ${decodes}`);
});
