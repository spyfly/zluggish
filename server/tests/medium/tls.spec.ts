import { ManagementService } from '#src/services/management.service';
import { TlsService } from '#src/services/tls.service';
import { createWebApp } from '#src/http/web-app';
import { mediumWeb } from '#tests/medium/support';
import { runtimeFixture } from '#tests/support/runtime';
import { responseStatus } from '#tests/support/html';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

async function json(request: Response | Promise<Response>) {
  const response = await request;

  return response.json();
}

async function text(request: Response | Promise<Response>) {
  const response = await request;

  return response.text();
}

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

await test('a server without riders generates its own certificate on first start', async (t) => {
  const f = runtimeFixture(t);
  const tls = f.effects.runSync(TlsService);
  const warnings = t.mock.method(f.world.lifecycle.log, 'warn');

  assert.equal(tls.mode(), 'legacy');
  await f.effects.runPromise(tls.start());

  assert.equal(tls.mode(), 'managed');
  assert.ok(existsSync(resolve(f.config.storageDir, 'tls', 'zwift-server.pem')));
  const status = await f.effects.runPromise(tls.status());
  assert.equal(status.certificate?.key, 'ECDSA P-256');
  assert.deepEqual(status.certificate?.hosts, ['*.zwift.com', 'zwift.com']);
  assert.equal(new Date(status.certificate.notAfter).getUTCFullYear(), new Date().getUTCFullYear() + 5);
  assert.equal(warnings.mock.callCount(), 0);
});

await test('a server with riders keeps the shared certificate and warns in the log and the launcher', async (t) => {
  const f = runtimeFixture(t);
  await f.accounts.create('Existing Rider', 'test-password', 'existing');
  const tls = f.effects.runSync(TlsService);
  const warnings = t.mock.method(f.world.lifecycle.log, 'warn');

  await f.effects.runPromise(tls.start());

  assert.equal(tls.mode(), 'legacy');
  assert.deepEqual(
    warnings.mock.calls.map((call) => call.arguments[0]),
    ['tls.legacy_certificate'],
  );
  assert.match(await text(f.app.request('/login/')), /shared Zwift certificate, whose private key is public/);

  await f.effects.runPromise(tls.rotate(crypto.randomUUID()));
  assert.doesNotMatch(await text(f.app.request('/login/')), /shared Zwift certificate/);
});

await test('riders download the certificate and setup scripts, and only administrators rotate it', async (t) => {
  const f = runtimeFixture(t);
  const owner = await administrator(f);
  const rider = await f.accounts.create('Regular Rider', 'test-password', 'rider');
  const admin = mediumWeb(f, owner);
  const web = mediumWeb(f, rider);
  const tls = f.effects.runSync(TlsService);
  const applied: string[] = [];
  tls.subscribe((material) => {
    applied.push(material.cert);
  });

  assert.equal(await responseStatus(createWebApp(f).request('http://local:8080/api/tls')), 401);
  const before = await json(web.request('/api/tls'));
  assert.equal(before.mode, 'legacy');
  // Until the administrator switches, riders can still set up the shared certificate: never its key, and with
  // a warning in the script and in the server log.
  const warnings = t.mock.method(f.world.lifecycle.log, 'warn');
  const shared = await text(web.request('/api/tls/certificate'));
  assert.equal(new X509Certificate(shared).fingerprint256, before.certificate.fingerprint256);
  assert.doesNotMatch(shared, /PRIVATE KEY/);
  const legacyScript = await web.request('/api/tls/setup/windows?address=192.168.1.20');
  assert.match(legacyScript.headers.get('Content-Disposition')!, /filename="zluggish-zwift-shared\.bat"/);
  const legacyBat = await legacyScript.text();
  assert.doesNotMatch(legacyBat, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/);
  assert.match(legacyBat, /WARNING: This server still uses the shared Zwift certificate/);
  assert.deepEqual(
    warnings.mock.calls.map((call) => call.arguments[0]),
    ['tls.legacy_setup_download', 'tls.legacy_setup_download'],
  );

  const operation = crypto.randomUUID();
  assert.equal(await responseStatus(web.request('/api/manage/server/certificate', 'POST', { operation })), 403);
  const rotated = await json(admin.request('/api/manage/server/certificate', 'POST', { operation }));
  assert.equal(rotated.mode, 'managed');
  // A retried request does not rotate again; a new one does.
  const retried = await json(admin.request('/api/manage/server/certificate', 'POST', { operation }));
  assert.equal(retried.certificate.fingerprint256, rotated.certificate.fingerprint256);

  const next = await json(admin.request('/api/manage/server/certificate', 'POST', { operation: crypto.randomUUID() }));

  assert.notEqual(next.certificate.fingerprint256, rotated.certificate.fingerprint256);
  assert.equal(applied.length, 2);
  // Rotation keeps the server's name, so setup scripts find what they installed before.
  assert.equal(next.certificate.subject, rotated.certificate.subject);

  const pem = await web.request('/api/tls/certificate');
  assert.equal(pem.status, 200);
  assert.match(pem.headers.get('Content-Disposition')!, /attachment; filename="zluggish-zwift-[\da-f]{8}\.crt"/);
  const pemText = await pem.text();
  assert.equal(new X509Certificate(pemText).fingerprint256, next.certificate.fingerprint256);
  const der = await web.request('/api/tls/certificate?format=der');
  assert.equal(der.headers.get('Content-Type'), 'application/pkix-cert');
  assert.equal(
    new X509Certificate(Buffer.from(await der.arrayBuffer())).fingerprint256,
    next.certificate.fingerprint256,
  );

  const windows = await web.request('/api/tls/setup/windows?address=192.168.1.20');
  assert.equal(windows.status, 200);
  assert.match(windows.headers.get('Content-Disposition')!, /\.bat"$/);
  const bat = await windows.text();
  assert.ok(bat.includes(`$Thumbprint = '${next.certificate.thumbprint}'`));
  assert.ok(bat.includes("$ServerAddress = '192.168.1.20'"));
  assert.doesNotMatch(bat, /WARNING/);
  // Downloads of the server's own certificate are not warnings.
  assert.equal(warnings.mock.callCount(), 2);

  const linux = await text(web.request('/api/tls/setup/linux?address=fd00::20'));
  assert.ok(linux.startsWith('#!/bin/sh'));
  assert.ok(linux.includes("SERVER_ADDRESS='fd00::20'"));
  assert.equal(await responseStatus(web.request("/api/tls/setup/linux?address=1.2.3.4'; rm -rf /")), 400);
  const macos = await web.request('/api/tls/setup/macos?address=192.168.1.20');
  assert.match(macos.headers.get('Content-Disposition')!, /filename="zluggish-zwift-[\da-f]{8}\.sh"/);
  const mac = await macos.text();
  assert.ok(mac.includes('# Zluggish client setup for macOS'));
  assert.ok(mac.includes(`THUMBPRINT='${next.certificate.thumbprint}'`));
  assert.equal(await responseStatus(web.request('/api/tls/setup/android')), 400);
});
