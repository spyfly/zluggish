import { packageRoot } from '#src/config/load';
import { RiderPool } from '#src/world/riders';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

await test('synthetic rider profiles make their weight public', () => {
  const pool = new RiderPool(resolve(packageRoot(), '../assets'), '');
  const profile = pool.profile(8_000_001n);

  assert.ok(profile.weightInGrams > 0);
  assert.equal(profile.privacyBits & 4n, 4n);
});
