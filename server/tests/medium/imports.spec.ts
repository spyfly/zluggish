import { DocumentsService } from '#src/services/documents.service';
import { createGameApp } from '#src/http/app';
import { LoginResponseSchema } from '#src/protocol/generated/login_pb';
import { AchievementsSchema, PlayerProfileSchema, StreaksSchema } from '#src/protocol/generated/profile_pb';
import { UserStorageSchema } from '#src/protocol/generated/user_storage_pb';
import { AssetFiles } from '#src/repositories/files.repository';
import { mediumFixture, mediumWeb } from '#tests/medium/support';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const cases = [
  {
    name: 'profile.bin',
    before: toBinary(
      PlayerProfileSchema,
      create(PlayerProfileSchema, { id: 1n, firstName: 'Medium', lastName: 'Rider', totalXp: 123 }),
    ),
    after: toBinary(
      PlayerProfileSchema,
      create(PlayerProfileSchema, { id: 999n, firstName: 'Imported', lastName: 'Source', totalXp: 987 }),
    ),
  },
  {
    name: 'achievements.bin',
    before: toBinary(AchievementsSchema, create(AchievementsSchema, { achievements: [{ id: 43 }] })),
    after: toBinary(AchievementsSchema, create(AchievementsSchema, { achievements: [{ id: 59 }] })),
  },
  {
    name: 'economy_config.txt',
    before: Buffer.from('{"f3":1,"f4":2,"f5":3}'),
    after: Buffer.from('{"f3":4,"f4":5,"f5":6}'),
  },
  {
    name: 'user_storage.bin',
    before: toBinary(
      UserStorageSchema,
      create(UserStorageSchema, { attributes: [{ gameSettings: { minimalLeaderboards: 0 } }] }),
    ),
    after: toBinary(
      UserStorageSchema,
      create(UserStorageSchema, { attributes: [{ gameSettings: { minimalLeaderboards: 1 } }] }),
    ),
  },
  {
    name: 'streaks.bin',
    before: toBinary(StreaksSchema, create(StreaksSchema, { curStreak: 1 })),
    after: toBinary(StreaksSchema, create(StreaksSchema, { curStreak: 3 })),
  },
] as const;

for (const item of cases) {
  await test(`F12 web restore stages, cancels and confirms ${item.name} with backup and rider isolation`, async (t) => {
    const f = await mediumFixture(t);
    const web = mediumWeb(f, f.rider);
    const other = mediumWeb(f, f.other);
    const folder = f.profiles.folder(f.rider.player_id);

    const stored = () =>
      Buffer.from(
        f.effects.runSync(DocumentsService.use((service) => service.get(f.rider.player_id, item.name))) ?? [],
      );

    f.effects.runSync(DocumentsService.use((service) => service.put(f.rider.player_id, item.name, item.before)));
    const account = f.accounts.get(f.rider.player_id);

    const upload = async () => {
      const files = new FormData();
      files.set(item.name, new File([Uint8Array.from(item.after)], item.name));
      const response = await web.request('/api/me/import', 'POST', files);
      assert.equal(response.status, 200);
      const { review } = await response.json();
      assert.deepEqual(stored(), Buffer.from(item.before));
      const pending = await web.request('/api/me/import');
      const { review: listed } = await pending.json();
      assert.equal(listed.stage, review.stage);

      return String(review.stage);
    };

    const first = await upload();
    const canceled = await web.request('/api/me/import/confirm', 'POST', { stage: first, cancel: true });
    assert.equal(canceled.status, 200);
    assert.deepEqual(stored(), Buffer.from(item.before));
    assert.equal(
      readdirSync(folder).some((name) => name.startsWith('.ts-import-')),
      false,
    );
    const stage = await upload();
    const foreignConfirm = await other.request('/api/me/import/confirm', 'POST', { stage, confirmSource: true });
    assert.equal(foreignConfirm.status, 409);
    assert.deepEqual(stored(), Buffer.from(item.before));
    const published = await web.request('/api/me/import/confirm', 'POST', { stage, confirmSource: true });
    assert.equal(published.status, 200);
    const downloaded = await web.request(`/api/me/export/${item.name}`);
    assert.equal(downloaded.status, 200);
    const bytes = new Uint8Array(await downloaded.arrayBuffer());

    if (item.name === 'profile.bin') {
      const profile = fromBinary(PlayerProfileSchema, bytes);
      assert.equal(profile.id, BigInt(f.rider.player_id));
      assert.equal(profile.firstName, 'Imported');
      assert.equal(profile.totalXp, 987);
      assert.equal(f.accounts.get(f.rider.player_id)?.official_player_id, '999');
    } else assert.deepEqual(bytes, Uint8Array.from(item.after));
    const backups = readdirSync(folder).filter((name) => name.startsWith(`${item.name}.`) && name.endsWith('.bak'));
    assert.equal(backups.length, 1);
    assert.deepEqual(readFileSync(resolve(folder, backups[0]!)), Buffer.from(item.before));
    assert.equal(f.accounts.get(f.rider.player_id)?.auth_version, account?.auth_version);
    assert.equal(f.accounts.get(f.rider.player_id)?.role, account?.role);
    assert.equal(
      f.effects.runSync(DocumentsService.use((service) => service.has(f.other.player_id, item.name))),
      false,
    );
    assert.equal(
      readdirSync(folder).some((name) => name.startsWith('.ts-import-')),
      false,
    );
  });
}

await test('F12 multipart restore accepts selected empty protobuf files and requires CSRF before staging', async (t) => {
  const f = await mediumFixture(t);
  const web = mediumWeb(f, f.rider);
  const names = ['achievements.bin', 'user_storage.bin', 'streaks.bin'];
  const missingCsrf = new FormData();
  missingCsrf.set('streaks.bin', new File([], 'streaks.bin'));
  const rejected = await web.request('/api/me/import', 'POST', missingCsrf, '');
  assert.equal(rejected.status, 403);
  const files = new FormData();

  for (const name of names) files.set(name, new File([], name));
  const staged = await web.request('/api/me/import', 'POST', files);
  assert.equal(staged.status, 200);

  const {
    review: { stage },
  } = await staged.json();

  const unconfirmed = await web.request('/api/me/import/confirm', 'POST', { stage });
  assert.equal(unconfirmed.status, 400);
  const published = await web.request('/api/me/import/confirm', 'POST', { stage, confirmSource: true });
  assert.equal(published.status, 200);

  for (const name of names) {
    const response = await web.request(`/api/me/export/${name}`);
    assert.equal(response.status, 200);
    const bytes = await response.arrayBuffer();
    assert.equal(bytes.byteLength, 0);
  }
});

await test('F12 app reconstruction removes a stage whose restore already committed', async (t) => {
  const f = await mediumFixture(t);
  const web = mediumWeb(f, f.rider);
  const folder = f.profiles.folder(f.rider.player_id);
  const original = toBinary(StreaksSchema, create(StreaksSchema, { curStreak: 2 }));
  const incoming = toBinary(StreaksSchema, create(StreaksSchema, { curStreak: 99 }));
  f.effects.runSync(DocumentsService.use((service) => service.put(f.rider.player_id, 'streaks.bin', original)));
  const files = new FormData();
  files.set('streaks.bin', new File([incoming], 'streaks.bin'));
  const staged = await web.request('/api/me/import', 'POST', files);
  assert.equal(staged.status, 200);
  const stage = readdirSync(folder).find((name) => name.startsWith('.ts-import-'));
  assert.ok(stage);
  // Simulate a process stopping after the publication transaction, before the stage removal.
  f.accounts.db.exec('BEGIN');
  f.effects.runSync(DocumentsService.use((service) => service.put(f.rider.player_id, 'streaks.bin', incoming)));
  f.accounts.db.prepare('INSERT INTO rider_import (stage, player_id) VALUES (?, ?)').run(stage, f.rider.player_id);
  f.accounts.db.exec('COMMIT');
  const restarted = createGameApp({ gameInfo: '{}', gameInfoHash: '0', variants: '{}' }, f);
  const response = await restarted.request('/api/fitness/streaks', { headers: f.headers() });
  assert.equal(response.status, 200);
  assert.equal(fromBinary(StreaksSchema, new Uint8Array(await response.arrayBuffer())).curStreak, 99);
  assert.equal(existsSync(resolve(folder, stage)), false);
});

for (const choice of ['profile', 'achievements', 'both']) {
  await test(`F12 official ${choice} download uses saved encrypted credentials and requires web confirmation`, async (t) => {
    const f = await mediumFixture(t);
    const web = mediumWeb(f, f.rider);

    const saved = await web.request('/api/me/zwift', 'PUT', {
      username: 'official@example.test',
      password: 'medium-secret',
      upload: true,
      click: true,
    });

    assert.equal(saved.status, 200);
    assert.doesNotMatch(await saved.text(), /medium-secret|official@example.test/);
    const connections = f.accounts.repositories.connectionsRepository;
    assert.deepEqual(connections.read(f.rider.player_id, 'zwift'), ['official@example.test', 'medium-secret']);
    assert.equal(
      Buffer.from(
        f.effects.runSync(DocumentsService.use((service) => service.get(f.rider.player_id, 'zwift_credentials.bin'))) ??
          [],
      ).includes(Buffer.from('medium-secret')),
      false,
    );
    assert.equal(connections.read(f.other.player_id, 'zwift'), null);
    assert.equal(f.settings.read(f.rider.player_id)['uploads.zwift.enabled'], true);
    assert.equal(f.settings.read(f.rider.player_id)['devices.zwiftClick.enabled'], true);
    const calls: Array<string> = [];
    t.mock.method(globalThis, 'fetch', async (input: URL | string, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      await Promise.resolve();

      if (path.endsWith('/access/codes')) {
        assert.ok(init?.body instanceof URLSearchParams);
        assert.equal(init.body.get('username'), 'official@example.test');
        assert.equal(init.body.get('password'), 'medium-secret');

        return Response.json({ access_token: 'official-token', refresh_token: 'official-refresh' });
      }

      if (path.endsWith('/tokens/logout')) return new Response(null, { status: 204 });
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer official-token');
      assert.equal(new Headers(init?.headers).get('Accept'), 'application/x-protobuf-lite');

      if (path === '/api/profiles/me')
        return new Response(
          toBinary(PlayerProfileSchema, create(PlayerProfileSchema, { id: 999n, firstName: 'Official', totalXp: 500 })),
        );

      if (path === '/api/users/login')
        return new Response(
          toBinary(
            LoginResponseSchema,
            create(LoginResponseSchema, {
              sessionState: 'test',
              info: { relayUrl: 'https://relay.test' },
              economyConfig: { f3: 0, f4: 0, f5: 0 },
            }),
          ),
        );

      if (path === '/api/achievement/loadPlayerAchievements')
        return new Response(toBinary(AchievementsSchema, create(AchievementsSchema, { achievements: [{ id: 59 }] })));
      throw new Error(`Unexpected official request ${path}`);
    });

    const downloaded = await web.request('/api/me/zwift/import', 'POST', {
      profile: choice !== 'achievements',
      achievements: choice !== 'profile',
    });

    assert.equal(downloaded.status, 200);

    const {
      review: { stage },
    } = await downloaded.json();

    assert.equal(f.profiles.get(f.rider.player_id).firstName, 'Medium');
    assert.equal(f.accounts.get(f.rider.player_id)?.official_player_id, null);

    const published = await web.request('/api/me/import/confirm', 'POST', {
      stage,
      confirmSource: true,
      keepName: true,
    });

    assert.equal(published.status, 200);
    assert.equal(f.profiles.get(f.rider.player_id).id, BigInt(f.rider.player_id));
    assert.equal(f.profiles.get(f.rider.player_id).firstName, 'Medium');
    assert.equal(
      f.effects.runSync(DocumentsService.use((service) => service.has(f.rider.player_id, 'economy_config.txt'))),
      choice !== 'achievements',
    );
    assert.equal(
      f.effects.runSync(DocumentsService.use((service) => service.has(f.rider.player_id, 'achievements.bin'))),
      choice !== 'profile',
    );
    assert.equal(calls.includes('/api/profiles/me'), choice !== 'achievements');
    assert.equal(calls.includes('/api/achievement/loadPlayerAchievements'), choice !== 'profile');
    assert.equal(calls.at(-1), '/auth/realms/zwift/tokens/logout');

    if (choice !== 'achievements') {
      assert.equal(f.profiles.get(f.rider.player_id).totalXp, 500);
      assert.equal(f.accounts.get(f.rider.player_id)?.official_player_id, '999');
    }

    const disabled = await web.request('/api/me/zwift', 'PUT', {
      username: '',
      password: '',
      upload: false,
      click: true,
    });

    assert.equal(disabled.status, 200);
    assert.equal(f.settings.read(f.rider.player_id)['uploads.zwift.enabled'], false);
    assert.equal(f.settings.read(f.rider.player_id)['devices.zwiftClick.enabled'], true);
    assert.deepEqual(f.accounts.repositories.connectionsRepository.read(f.rider.player_id, 'zwift'), [
      'official@example.test',
      'medium-secret',
    ]);

    const invalidCsrf = await web.request(
      '/api/me/zwift',
      'PUT',
      { username: 'rejected', password: 'rejected', upload: false, click: false },
      'wrong',
    );

    assert.equal(invalidCsrf.status, 403);
    const removed = await web.request('/api/me/zwift', 'DELETE');
    assert.equal(removed.status, 200);
    assert.equal(f.accounts.repositories.connectionsRepository.read(f.rider.player_id, 'zwift'), null);
  });
}

for (const failure of ['login', 'profile', 'invalid profile']) {
  await test(`F12 failed official import preserves rider data and creates no pending stage: ${failure}`, async (t) => {
    const f = await mediumFixture(t);
    const web = mediumWeb(f, f.rider);
    await web.request('/api/me/zwift', 'PUT', {
      username: 'official@example.test',
      password: 'medium-secret',
      upload: false,
      click: false,
    });
    const profilePath = resolve(f.profiles.folder(f.rider.player_id), 'profile.bin');
    const before = toBinary(PlayerProfileSchema, f.profiles.get(f.rider.player_id));
    new AssetFiles().writeDurable(profilePath, before);
    let loggedOut = false;
    const calls: Array<string> = [];
    t.mock.method(globalThis, 'fetch', (input: URL | string) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);

      if (path.endsWith('/tokens/logout')) {
        loggedOut = true;

        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (path.endsWith('/access/codes'))
        return Promise.resolve(
          failure === 'login'
            ? new Response(null, { status: 401 })
            : Response.json({ access_token: 'official-token', refresh_token: 'refresh' }),
        );

      if (path === '/api/profiles/me')
        return Promise.resolve(
          failure === 'profile' ? new Response(null, { status: 503 }) : new Response(new Uint8Array([255])),
        );

      if (path === '/api/users/login')
        return Promise.resolve(
          new Response(
            toBinary(
              LoginResponseSchema,
              create(LoginResponseSchema, { sessionState: 'test', info: { relayUrl: 'https://relay.test' } }),
            ),
          ),
        );
      throw new Error(`Unexpected official request ${path}`);
    });
    const response = await web.request('/api/me/zwift/import', 'POST', { profile: true, achievements: false });
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.match(body, failure === 'invalid profile' ? /Could not import these files/ : /Download failed/);
    assert.doesNotMatch(body, /medium-secret|official-token/);
    assert.deepEqual(readFileSync(profilePath), Buffer.from(before));
    assert.equal(
      readdirSync(f.profiles.folder(f.rider.player_id)).some((name) => name.startsWith('.ts-import-')),
      false,
    );
    assert.equal(loggedOut, failure !== 'login');
    assert.deepEqual(calls, [
      '/auth/realms/zwift/tokens/access/codes',
      ...(failure === 'login'
        ? []
        : [
            '/api/profiles/me',
            ...(failure === 'invalid profile' ? ['/api/users/login'] : []),
            '/auth/realms/zwift/tokens/logout',
          ]),
    ]);
    const pending = await web.request('/api/me/import');
    const { review } = await pending.json();
    assert.equal(review, null);
  });
}
