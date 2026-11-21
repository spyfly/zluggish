import { mediumWeb } from '#tests/medium/support';
import { contents, zip } from '#tests/support/apk';
import { runtimeFixture } from '#tests/support/runtime';
import assert from 'node:assert/strict';
import { test } from 'node:test';

await test('a signed-in rider can patch a Play Store expansion file', async (t) => {
  const fixture = runtimeFixture(t);
  const rider = await fixture.accounts.create('Android Rider', 'test-password', 'rider');
  const web = mediumWeb(fixture, rider);
  const endpoint = '/api/install/android/obb';
  const bundle = 'dataES/cacert.pem';
  const originalPem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const original = zip([[bundle, Buffer.from(originalPem + '# description\n'.repeat(256)), false]]);

  const invalidToken = await web.request(endpoint, 'PUT', original, 'bad-token');
  assert.equal(invalidToken.status, 403);
  const invalidArchive = await web.request(endpoint, 'PUT', Buffer.from('not an expansion file'));
  assert.equal(invalidArchive.status, 400);

  const certificate = await web.request('/api/tls/certificate');
  assert.equal(certificate.status, 200);

  const response = await web.request(endpoint, 'PUT', original);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), String(original.length));
  const patched = Buffer.from(await response.arrayBuffer());

  assert.equal(patched.length, original.length);
  assert.equal(contents(patched, bundle).toString(), originalPem + (await certificate.text()));
});
