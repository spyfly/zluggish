import { openDatabase, SCHEMA_VERSION } from '#src/db/open';
import { migrateAccounts } from '#src/migrations/accounts';
import { SettingsStore } from '#src/repositories/settings.repository';
import { legacyDatabase } from '#tests/support/legacy';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

for (const upgrade of ['startup', 'accounts migrate'] as const) {
  await test(`${upgrade} removes old account fields and preserves ghost preferences`, (t) => {
    const root = mkdtempSync(resolve(tmpdir(), 'zluggish-account-upgrade-'));
    const storage = resolve(root, 'storage');
    mkdirSync(storage);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const db = legacyDatabase(storage);
    db.exec(`ALTER TABLE user ADD COLUMN remember INTEGER DEFAULT 0;
      ALTER TABLE user ADD COLUMN enable_ghosts INTEGER DEFAULT 1;
      INSERT INTO user (player_id, username, first_name, last_name, is_admin, enable_ghosts)
      VALUES (1, 'first', 'First', 'Rider', 1, 0), (2, 'second', 'Second', 'Rider', 0, 1);
      UPDATE version SET version=4;`);
    db.close();
    const settings = SettingsStore.legacy(storage);
    settings.save(2, { 'ghosts.enabled': false });
    settings.close();

    if (upgrade === 'accounts migrate') {
      migrateAccounts(storage);
    }
    const reopened = openDatabase(storage);

    const columns = new Set(
      reopened
        .prepare('PRAGMA table_info(user)')
        .all()
        .map((row) => row.name),
    );

    assert.equal(columns.has('remember'), false);
    assert.equal(columns.has('enable_ghosts'), false);
    assert.equal(reopened.prepare('SELECT version FROM version').get()?.version, SCHEMA_VERSION);
    assert.equal(reopened.prepare('SELECT count(*) AS count FROM user').get()?.count, 2);
    const persisted = new SettingsStore(reopened);
    assert.equal(persisted.read(1)['ghosts.enabled'], false);
    assert.equal(persisted.read(2)['ghosts.enabled'], false);
    reopened.close();
  });
}

await test('a fresh database uses WAL, the current version and one settings store', (t) => {
  const storage = mkdtempSync(resolve(tmpdir(), 'zluggish-fresh-'));
  const db = openDatabase(storage);
  t.after(() => {
    db.close();
    rmSync(storage, { recursive: true, force: true });
  });
  assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA synchronous').get()?.synchronous, 2);
  assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  assert.equal(db.prepare('SELECT version FROM version').get()?.version, SCHEMA_VERSION);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='rider_settings'").get());
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='management_audit'").get(), undefined);
});
