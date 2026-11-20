import { UnreadableCredentialsError } from '#src/errors';
import { CryptoRepository } from '#src/repositories/crypto.repository';
import { pythonFixtures as fixtures } from '#tests/support/python';
import assert from 'node:assert/strict';
import { test } from 'node:test';

await test('credentials use Python CFB8 encoding, not CFB128', () => {
  const key = Buffer.from(fixtures.credentialKey, 'hex');
  const wire = Buffer.from(fixtures.credentials, 'hex');
  assert.deepEqual(new CryptoRepository().decryptCredentials(key, wire), ['example-user', 'example-password']);
  assert.equal(
    new CryptoRepository()
      .encryptCredentials(key, ['example-user', 'example-password'], wire.subarray(0, 16))
      .toString('hex'),
    fixtures.credentials,
  );
});

await test('credentials from another key or damaged bytes are unreadable, never garbage', () => {
  const crypto = new CryptoRepository();
  const key = crypto.randomBytes(32);
  const credentials = crypto.encryptCredentials(key, ['example-user', 'example-password']);

  // CFB8 is unauthenticated: only the strict UTF-8 check tells a wrong key from real credentials.
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.throws(() => crypto.decryptCredentials(crypto.randomBytes(32), credentials), UnreadableCredentialsError);
  }

  assert.throws(() => crypto.decryptCredentials(key, credentials.subarray(0, 10)), UnreadableCredentialsError);
  assert.throws(
    () => crypto.decryptCredentials(key, crypto.encryptCredentials(key, ['only-a-username', '']).subarray(0, 31)),
    UnreadableCredentialsError,
  );
});
