import { SettingsStore } from '#src/repositories/settings.repository';
import type { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';

export function removeLegacyAccountFields(db: DatabaseSync, storage: string) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(user)')
      .all()
      .map((row) => row.name),
  );

  if (columns.has('enable_ghosts')) {
    const settings = SettingsStore.legacy(storage);

    try {
      for (const row of db.prepare('SELECT player_id, enable_ghosts FROM user').all()) {
        const rider = Schema.decodeUnknownSync(
          Schema.Struct({ player_id: Schema.Finite, enable_ghosts: Schema.Finite }),
        )(row);

        const overrides = settings.read(rider.player_id);

        if (overrides['ghosts.enabled'] === undefined) {
          settings.save(rider.player_id, { ...overrides, 'ghosts.enabled': rider.enable_ghosts !== 0 });
        }
      }
    } finally {
      settings.close();
    }
  }

  for (const column of ['remember', 'enable_ghosts']) {
    if (columns.has(column)) {
      db.exec(`ALTER TABLE user DROP COLUMN ${column}`);
    }
  }
}
