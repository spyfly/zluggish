import { GhostSchema, PlayerStateSchema } from '#src/protocol/generated/udp-node-msgs_pb';
import { StateHistory } from '#src/world/state-history';
import { create, equals, fromBinary, toBinary } from '@bufbuild/protobuf';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const state = (time: number) =>
  create(PlayerStateSchema, { id: 7n, worldTime: BigInt(time), roadTime: time, x: time / 2, power: 200 });

await test('a history keeps the newest samples and returns independent copies', () => {
  const history = new StateHistory(3);

  for (const time of [1000, 2000, 3000, 4000]) {
    history.push(state(time));
  }

  assert.equal(history.length, 3);
  assert.equal(history.worldTime(0), 2000n);
  assert.equal(history.worldTime(-1), 4000n);
  assert.ok(equals(PlayerStateSchema, history.state(-1) ?? state(0), state(4000)));

  const copy = history.state(0);
  assert.ok(copy);
  copy.x = -1;
  assert.equal(history.state(0)?.x, 1000);
  assert.equal(history.state(5), undefined);
});

await test('earlier states go in front and the limit keeps the newest', () => {
  const history = new StateHistory(3);
  history.push(state(3000));
  history.push(state(4000));
  history.prepend([state(1000), state(2000)]);

  assert.deepEqual(
    history.states().map((s) => s.worldTime),
    [2000n, 3000n, 4000n],
  );
});

await test('samples since a time are encoded states', () => {
  const history = new StateHistory();

  for (const time of [1000, 2000, 3000]) {
    history.push(state(time));
  }

  assert.deepEqual(
    history.since(1000n).map((bytes) => fromBinary(PlayerStateSchema, bytes).worldTime),
    [2000n, 3000n],
  );
  assert.deepEqual(history.since(3000n), []);
});

await test('the ghost encoding matches encoding the decoded states', () => {
  const history = new StateHistory();

  for (const time of [1000, 2000]) {
    history.push(state(time));
  }

  const expected = toBinary(GhostSchema, create(GhostSchema, { playerId: 42, states: [state(1000), state(2000)] }));
  assert.deepEqual(history.ghost(42), expected);
  assert.deepEqual(new StateHistory().ghost(42), toBinary(GhostSchema, create(GhostSchema, { playerId: 42 })));
});
