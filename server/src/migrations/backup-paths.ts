import { ConfigError } from '#src/config/index';
import { basename, dirname, resolve } from 'node:path';

export const backupManifest = 'backup-manifest.json';

export const legacyDatabases: ReadonlyArray<string> = ['zluggish.db', 'zwift-offline.db', 'settings.db'];

export function backupDirectory(storage: string) {
  const source = resolve(storage);
  const parent = dirname(source);
  const directory = resolve(parent, 'backups');

  if (source === parent || source === directory) {
    throw new ConfigError('Storage and backups must be separate directories');
  }

  return directory;
}

export function excludedStorageEntry(name: string) {
  return (
    [
      '.server.lock',
      '.restore-in-progress',
      '.config-migration.json',
      'storage-migration.json',
      backupManifest,
      'backups',
    ].includes(name) ||
    name.startsWith('zluggish.db.migrating') ||
    name.startsWith('zluggish.db.restoring') ||
    legacyDatabases.some((database) => ['-shm', '-wal', '-journal'].some((suffix) => name === database + suffix))
  );
}

export function nightlyBackupName(date: Date) {
  return `nightly-${date.toISOString().slice(0, 10)}`;
}

export function isNightlyBackup(name: string) {
  return /^nightly-\d{4}-\d{2}-\d{2}$/.test(name);
}

/** Backup names are also used as directory names. */
export function backupPath(directory: string, name: string) {
  if (name !== basename(name) || name === '' || name === '.' || name === '..') {
    throw new ConfigError('Invalid backup name');
  }

  return resolve(directory, name);
}
