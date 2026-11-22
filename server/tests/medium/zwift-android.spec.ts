import { ManagementService } from '#src/services/management.service';
import { zwiftAndroidChunkSize } from '#src/services/zwift-android.service';
import { TlsService } from '#src/services/tls.service';
import { mediumWeb } from '#tests/medium/support';
import { contents, zip } from '#tests/support/apk';
import { runtimeFixture } from '#tests/support/runtime';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

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
  const apkmUpload = `${endpoint}?name=zwift.apkm`;
  const noObb = await admin.request(apkmUpload, 'PUT', zip([['base.apk', Buffer.from('apk'), false]]));
  assert.equal(noObb.status, 400);
  const apkm = zip([
    ['base.apk', Buffer.alloc(zwiftAndroidChunkSize), false],
    [`Android/obb/com.zwift.zwiftgame/${secondFilename}`, original, true],
  ]);
  const sessions = '/api/manage/android-upload';
  const metadata = { name: 'zwift.apkm', size: apkm.length };
  const denied = await web.request(sessions, 'POST', metadata);
  assert.equal(denied.status, 403);
  const begin = await admin.request(sessions, 'POST', metadata);
  assert.equal(begin.status, 201);
  const { id } = await begin.json();
  const session = `${sessions}/${id}`;
  const otherAdmin = mediumWeb(fixture, owner);
  const hidden = await otherAdmin.request(session);
  assert.equal(hidden.status, 404);
  const firstChunk = apkm.subarray(0, zwiftAndroidChunkSize);
  const finalChunk = apkm.subarray(zwiftAndroidChunkSize);
  const missing = await admin.request(`${session}?offset=${zwiftAndroidChunkSize}`, 'PUT', finalChunk);
  assert.equal(missing.status, 409);
  const partial = await admin.request(`${session}?offset=0`, 'PUT', firstChunk.subarray(0, 100));
  assert.equal(partial.status, 400);
  const first = await admin.request(`${session}?offset=0`, 'PUT', firstChunk);
  assert.equal(first.status, 200);
  const firstStatus = await first.json();
  assert.equal(firstStatus.offset, zwiftAndroidChunkSize);
  const duplicate = await admin.request(`${session}?offset=0`, 'PUT', firstChunk);
  assert.equal(duplicate.status, 200);
  const duplicateStatus = await duplicate.json();
  assert.equal(duplicateStatus.offset, zwiftAndroidChunkSize);
  const final = await admin.request(`${session}?offset=${zwiftAndroidChunkSize}`, 'PUT', finalChunk);
  assert.equal(final.status, 200);
  const finalStatus = await final.json();
  assert.equal(finalStatus.state, 'patching');
  let state = 'patching';

  for (let attempt = 0; attempt < 100 && state === 'patching'; attempt++) {
    const progress = await admin.request(session);
    assert.equal(progress.status, 200);
    const result = await progress.json();
    state = result.state;
    if (state === 'patching') {
      await sleep(20);
    }
  }

  assert.equal(state, 'done');

  const available = await web.request(endpoint);
  assert.deepEqual(await available.json(), [filename, secondFilename]);

  const response = await web.request(`${endpoint}/${filename}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), String(original.length));
  assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="${filename}"`);
  const patched = Buffer.from(await response.arrayBuffer());
  assert.equal(contents(patched, bundle).toString(), originalPem + (await certificate.text()));

  const fromBundle = await web.request(`${endpoint}/${secondFilename}`);
  assert.equal(fromBundle.status, 200);
  const bundledObb = Buffer.from(await fromBundle.arrayBuffer());
  assert.equal(bundledObb.length, original.length);
  assert.deepEqual(contents(bundledObb, bundle), contents(patched, bundle));

  const pending = await admin.request(sessions, 'POST', metadata);
  assert.equal(pending.status, 201);
  const pendingStatus = await pending.json();
  const pendingUrl = `${sessions}/${pendingStatus.id}`;
  const cancelled = await admin.request(pendingUrl, 'DELETE', {});
  assert.equal(cancelled.status, 204);
  const expired = await admin.request(pendingUrl);
  assert.equal(expired.status, 404);

  const tls = fixture.effects.runSync(TlsService);
  await fixture.effects.runPromise(tls.rotate(crypto.randomUUID()));
  const afterRotation = await web.request(endpoint);
  assert.deepEqual(await afterRotation.json(), []);
  const stale = await web.request(`${endpoint}/${filename}`);
  assert.equal(stale.status, 404);
});
