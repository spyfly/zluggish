import { ManagementService } from '#src/services/management.service';
import { TlsService } from '#src/services/tls.service';
import { mediumWeb } from '#tests/medium/support';
import { contents, zip } from '#tests/support/apk';
import { runtimeFixture } from '#tests/support/runtime';
import assert from 'node:assert/strict';
import { test } from 'node:test';

await test('an administrator publishes expansion files for riders on matching Zwift versions', async (t) => {
  const fixture = runtimeFixture(t);
  const management = fixture.effects.runSync(ManagementService);
  const owner = await fixture.effects.runPromise(
    management.setup({
      mode: 'new',
      key: fixture.effects.runSync(management.issueSetupKey())!,
      username: 'owner',
      first_name: 'First',
      last_name: 'Rider',
      password: 'test-password',
    }),
  );
  const rider = await fixture.accounts.create('Android Rider', 'test-password', 'rider');
  const admin = mediumWeb(fixture, owner);
  const web = mediumWeb(fixture, rider);
  const endpoint = '/api/install/android/obb';
  const filename = 'main.123.com.zwift.zwiftgame.obb';
  const secondFilename = 'main.124.com.zwift.zwiftgame.obb';
  const upload = `${endpoint}?name=${filename}`;
  const bundle = 'dataES/cacert.pem';
  const originalPem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const original = zip([[bundle, Buffer.from(originalPem + '# description\n'.repeat(256)), false]]);

  const riderUpload = await web.request(upload, 'PUT', original);
  assert.equal(riderUpload.status, 403);
  const invalidToken = await admin.request(upload, 'PUT', original, 'bad-token');
  assert.equal(invalidToken.status, 403);
  const invalidArchive = await admin.request(upload, 'PUT', Buffer.from('not an expansion file'));
  assert.equal(invalidArchive.status, 400);
  const invalidName = await admin.request(`${endpoint}?name=zwift.apk`, 'PUT', original);
  assert.equal(invalidName.status, 400);

  const certificate = await web.request('/api/tls/certificate');
  assert.equal(certificate.status, 200);
  const published = await admin.request(upload, 'PUT', original);
  assert.equal(published.status, 204);
  const second = await admin.request(`${endpoint}?name=${secondFilename}`, 'PUT', original);
  assert.equal(second.status, 204);

  const available = await web.request(endpoint);
  assert.deepEqual(await available.json(), [filename, secondFilename]);

  const response = await web.request(`${endpoint}/${filename}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), String(original.length));
  assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="${filename}"`);
  const patched = Buffer.from(await response.arrayBuffer());
  assert.equal(contents(patched, bundle).toString(), originalPem + (await certificate.text()));

  const tls = fixture.effects.runSync(TlsService);
  await fixture.effects.runPromise(tls.rotate(crypto.randomUUID()));
  const afterRotation = await web.request(endpoint);
  assert.deepEqual(await afterRotation.json(), []);
  const stale = await web.request(`${endpoint}/${filename}`);
  assert.equal(stale.status, 404);
});
