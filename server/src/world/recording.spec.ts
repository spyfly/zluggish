import { GhostSchema, PlayerStateSchema } from '#src/protocol/generated/udp-node-msgs_pb';
import { Recording } from '#src/world/recording';
import { course, forward, road } from '#src/world/state';
import { create, equals, toBinary } from '@bufbuild/protobuf';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const make = (roadTime: number, courseId: number, roadId: number, fwd: boolean, x = 0) =>
  create(PlayerStateSchema, {
    roadTime,
    x,
    z: x + 1,
    worldTime: BigInt(roadTime),
    f19: (courseId << 16) | (fwd ? 4 : 0),
    aux3: roadId << 8,
  });

const states = [
  make(1000, 6, 3, true, 1.5),
  make(5000, 6, 3, true, 2.5),
  make(3000, 6, 3, true, 3.5),
  make(3000, 6, 3, false),
  make(3000, 6, 4, true),
  make(3000, 7, 3, true),
  make(7000, 6, 3, true),
];

const recording = new Recording(toBinary(GhostSchema, create(GhostSchema, { playerId: 1, states })));

const oldNearest = (state: (typeof states)[number]) => {
  let index: number | null = null;
  let distance = Infinity;

  for (const [i, peer] of states.entries())
    if (course(state) === course(peer) && road(state) === road(peer) && forward(state) === forward(peer)) {
      const delta = Math.abs(state.roadTime - peer.roadTime);

      if (delta < distance) {
        index = i;
        distance = delta;
      }
    }

  return index;
};

await test('recording decodes states on demand as independent copies', () => {
  assert.equal(recording.length, states.length);

  for (const [i, original] of states.entries()) assert.ok(equals(PlayerStateSchema, recording.state(i), original));
  const copy = recording.state(0);
  copy.roadTime = 42;
  assert.equal(recording.state(0).roadTime, 1000);
  assert.throws(() => recording.state(99), RangeError);
});

await test('recording columns match the decoded states', () => {
  for (const [i, original] of states.entries()) {
    assert.equal(recording.roadTime(i), original.roadTime);
    assert.equal(recording.x(i), original.x);
    assert.equal(recording.z(i), original.z);
    assert.equal(recording.course(i), course(original));
  }
});

await test('recording nearest matches the decoded search, first minimum wins', () => {
  const queries = [
    make(4000, 6, 3, true), // tie between 3000 and 5000: the first one (index 1) wins
    make(3000, 6, 3, true),
    make(3000, 6, 3, false),
    make(100, 6, 4, true),
    make(3000, 8, 3, true),
    make(3000, 6, 9, true),
    make(3000, 7, 3, false),
  ];

  for (const query of queries) assert.equal(recording.nearest(query), oldNearest(query));
  assert.equal(recording.nearest(make(4000, 6, 3, true)), 1);
  assert.equal(recording.nearest(make(3000, 8, 3, true)), null);
});

await test('recording rejects invalid files and accepts empty ones', () => {
  assert.throws(() => new Recording(Uint8Array.of(0x12, 0x05, 1)));
  assert.equal(new Recording(new Uint8Array()).length, 0);
});
