import { Schema } from 'effect';
import { ApkRepository } from '#src/repositories/apk.repository';
import { ManagementService } from '#src/services/management.service';
import { TlsService } from '#src/services/tls.service';
import { mediumWeb } from '#tests/medium/support';
import { binaryManifest, contents, zip } from '#tests/support/apk';
import { responseStatus } from '#tests/support/html';
import { runtimeFixture } from '#tests/support/runtime';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const legacyPem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

/** A Companion APK that an earlier patch already pointed at a certificate in res/raw. */
const patched = zip([
  ['AndroidManifest.xml', binaryManifest('com.zluggish.companion', '3.91.0', 2175, 28), true],
  ['classes.dex', Buffer.alloc(2000, 1), true],
  ['resources.arsc', Buffer.alloc(800, 2), false],
  ['res/raw/cert-zwift-com.pem', Buffer.from(legacyPem), true],
  ['lib/arm64-v8a/libapp.so', Buffer.alloc(20_000, 3), false],
]);

const oldPackage = zip([
  ['AndroidManifest.xml', binaryManifest('com.zwift.android.prod', '3.92.0', 2180, 28), true],
  ['classes.dex', Buffer.alloc(2000, 1), true],
  ['res/raw/cert-zwift-com.pem', Buffer.from(legacyPem), true],
]);

const otherApp = zip([['AndroidManifest.xml', binaryManifest('com.example.other', '1.0', 1, 28), true]]);

async function administrator(f: ReturnType<typeof runtimeFixture>) {
  const service = f.effects.runSync(ManagementService);

  return f.effects.runPromise(
    service.setup({
      mode: 'new',
      key: f.effects.runSync(service.issueSetupKey())!,
      username: 'owner',
      first_name: 'First',
      last_name: 'Rider',
      password: 'test-password',
    }),
  );
}

const app = Schema.NullOr(Schema.Struct({ versionName: Schema.String, current: Schema.Boolean }));
const companionStatus = Schema.decodeUnknownSync(Schema.Struct({ app }));
const companionAdminStatus = Schema.decodeUnknownSync(
  Schema.Struct({
    app,
    activity: Schema.NullOr(
      Schema.Struct({
        state: Schema.String,
        kind: Schema.String,
        steps: Schema.Array(Schema.String),
        message: Schema.NullOr(Schema.String),
      }),
    ),
    pending: Schema.Boolean,
  }),
);

async function json(request: Response | Promise<Response>) {
  const response = await request;

  const body: unknown = await response.json();

  return body;
}

async function settled(admin: ReturnType<typeof mediumWeb>, kind: 'patch' | 'rekey') {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = companionAdminStatus(await json(admin.request('/api/manage/companion')));

    if (status.activity?.kind === kind && status.activity.state !== 'running') {
      return status;
    }
    await sleep(25);
  }

  throw new Error('The Companion job did not finish');
}

await test('the administrator patches the Companion app and every rider downloads it', async (t) => {
  const f = runtimeFixture(t);
  const owner = await administrator(f);
  const rider = await f.accounts.create('Regular Rider', 'test-password', 'rider');
  const admin = mediumWeb(f, owner);
  const web = mediumWeb(f, rider);
  const tls = f.effects.runSync(TlsService);

  const empty = companionStatus(await json(web.request('/api/companion')));
  assert.deepEqual(empty.app, null);
  assert.equal(await responseStatus(web.request('/api/companion/app')), 404);
  assert.equal(await responseStatus(web.request('/api/manage/companion')), 403);
  assert.equal(await responseStatus(web.request('/api/manage/companion/app', 'PUT', patched)), 403);

  await f.effects.runPromise(tls.start());
  const first = await f.effects.runPromise(tls.status());
  const companionFolder = resolve(f.config.storageDir, 'companion');
  const appPath = resolve(companionFolder, 'zwift-companion.apk');
  const previousMetadata = {
    versionName: '3.92.0',
    versionCode: 2180,
    bytes: oldPackage.length,
    createdAt: new Date().toISOString(),
    certificate: first.certificate?.fingerprint256,
    method: 'rekey',
  };
  mkdirSync(companionFolder, { recursive: true });
  writeFileSync(appPath, oldPackage);
  writeFileSync(resolve(companionFolder, 'companion.json'), JSON.stringify(previousMetadata));
  assert.equal(companionStatus(await json(web.request('/api/companion'))).app, null);
  assert.equal(await responseStatus(web.request('/api/companion/app')), 404);

  const wrong = await admin.request('/api/manage/companion/app', 'PUT', otherApp);
  assert.equal(wrong.status, 400);
  const wrongBody = await wrong.json();
  assert.match(wrongBody.message, /com\.example\.other, not Zwift Companion/);
  assert.equal(await responseStatus(admin.request('/api/manage/companion/app', 'PUT', Buffer.from('not an apk'))), 400);

  const started = await admin.request('/api/manage/companion/app', 'PUT', patched);
  assert.equal(started.status, 202);
  const done = await settled(admin, 'patch');
  assert.ok(done.activity);
  assert.equal(done.activity.state, 'done', done.activity.message ?? 'The Companion job did not complete');
  assert.deepEqual(done.activity.steps, ['inspect', 'sign', 'publish']);
  assert.ok(existsSync(resolve(f.config.storageDir, 'companion', 'signer.pem')));

  const status = companionStatus(await json(web.request('/api/companion')));
  assert.ok(status.app);
  assert.equal(status.app.versionName, '3.91.0');
  assert.equal(status.app.current, true);
  const download = await web.request('/api/companion/app');
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Content-Type'), 'application/vnd.android.package-archive');
  assert.match(download.headers.get('Content-Disposition')!, /filename="zwift-companion-3\.91\.0-zluggish\.apk"/);
  const apk = Buffer.from(await download.arrayBuffer());
  const trusted = new X509Certificate(contents(apk, 'res/raw/cert-zwift-com.pem'));
  assert.equal(trusted.fingerprint256, first.certificate?.fingerprint256);

  // A rotation updates the published app on its own, with no Java and no new upload.
  const second = await f.effects.runPromise(tls.rotate(crypto.randomUUID()));
  const after = await settled(admin, 'rekey');
  assert.ok(after.activity);
  assert.equal(after.activity.state, 'done', after.activity.message ?? 'The Companion rekey did not complete');
  const updated = companionStatus(await json(web.request('/api/companion')));
  assert.equal(updated.app?.current, true);
  const again = await web.request('/api/companion/app');
  const rekeyed = Buffer.from(await again.arrayBuffer());
  const manifest = await new ApkRepository().manifest(appPath);
  assert.equal(manifest.packageName, 'com.zluggish.companion');
  assert.equal(
    new X509Certificate(contents(rekeyed, 'res/raw/cert-zwift-com.pem')).fingerprint256,
    second.certificate?.fingerprint256,
  );

  // Prepatched apps with the old package still need rebuilding to make them install alongside the original.
  const held = companionAdminStatus(await json(admin.request('/api/manage/companion/app', 'PUT', oldPackage)));
  assert.ok(held.activity);
  assert.ok(held.app);
  assert.equal(held.activity.state, 'waiting');
  assert.equal(held.pending, true);
  assert.deepEqual(held.activity.steps, ['inspect', 'decode', 'patch', 'build', 'sign', 'publish']);
  assert.equal(held.app.versionName, '3.91.0', 'the published app stays');
  assert.equal(await responseStatus(web.request('/api/manage/companion/pending', 'DELETE', {})), 403);

  const discarded = companionAdminStatus(await json(admin.request('/api/manage/companion/pending', 'DELETE', {})));
  assert.equal(discarded.pending, false);
  assert.equal(discarded.activity, null);

  assert.equal(await responseStatus(admin.request('/api/manage/companion/app', 'DELETE', {})), 200);
  assert.equal(await responseStatus(web.request('/api/companion/app')), 404);
});
