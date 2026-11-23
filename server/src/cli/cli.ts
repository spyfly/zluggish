import { t } from '#src/i18n/index';
import { ConfigError, validateConfig } from '#src/config/index';
import type { ResolvedConfig } from '#src/config/index';
import type { LoadOptions } from '#src/config/load';
import { loadConfig, packageRoot, selectConfigPath } from '#src/config/load';
import { migrateConfig } from '#src/config/migrate';
import { openDatabase } from '#src/db/open';
import { archiveSuffix } from '#src/migrations/backup-archive';
import { backupStorage, backupStorageArchive, pauseUploads, restoreStorage } from '#src/migrations/backup';
import { legacyPlan, removeLegacy } from '#src/migrations/legacy';
import { migrateAccounts } from '#src/migrations/accounts';
import { SystemFlag } from '#src/repositories/system-flag.repository';
import { AssetFiles } from '#src/repositories/files.repository';
import { LockRepository } from '#src/repositories/lock.repository';
import type { Overrides } from '#src/dtos/settings.dto';
import { RiderRepository, SettingsStore } from '#src/repositories/settings.repository';
import { decodeOverrides, decodeSettingKey } from '#src/dtos/settings.dto';
import { AccountsService } from '#src/services/auth.service';
import { RetentionService } from '#src/services/retention.service';
import { SettingsService } from '#src/services/settings.service';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PositiveIntFromString } from '#src/schema';
import { Schema, Effect } from 'effect';

const decodeId = Schema.decodeUnknownSync(PositiveIntFromString);

export const HELP = t('cli.usage_zluggish_config_path_storage_dir_dir_config_init');

export async function run(argv: Array<string>, output: (message: string) => void = console.log): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: 'string' },
      'storage-dir': { type: 'string' },
      output: { type: 'string' },
      'dry-run': { type: 'boolean' },
      user: { type: 'string' },
      'solo-player': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      admin: { type: 'boolean' },
      'password-file': { type: 'string' },
      input: { type: 'string' },
      activity: { type: 'string' },
      provider: { type: 'string' },
      confirm: { type: 'boolean' },
    },
  });

  const [group, action, key, raw, ...extra] = positionals;

  if (values.help || !group) {
    output(HELP);

    return 0;
  }

  if (extra.length > 0) {
    throw new ConfigError(t('cli.unexpected_arguments'));
  }
  const containerStorage = process.env.ZLUGGISH_CONTAINER_STORAGE_DIR;

  const containerConfig = containerStorage
    ? resolve(values['storage-dir'] ?? process.env.ZLUGGISH_STORAGE_DIR ?? containerStorage, 'zluggish.config.ts')
    : undefined;

  const selected = selectConfigPath(
    values.config ??
      (process.env.ZLUGGISH_CONFIG === undefined && containerConfig && existsSync(containerConfig)
        ? containerConfig
        : undefined),
  );

  let storage = resolve(
    values['storage-dir'] ??
      process.env.ZLUGGISH_STORAGE_DIR ??
      containerStorage ??
      resolve(packageRoot(), '../storage'),
  );

  if (group === 'accounts') {
    if (values['storage-dir'] === undefined && !process.env.ZLUGGISH_STORAGE_DIR && existsSync(selected)) {
      const loaded = await loadConfig({ path: selected });
      storage = loaded.config.storageDir;
    } else if ((values.config !== undefined || process.env.ZLUGGISH_CONFIG !== undefined) && !existsSync(selected)) {
      throw new ConfigError(t('cli.missing', { value1: selected }));
    }

    const release = await new LockRepository().acquireStorageLock(storage);

    try {
      if (action === 'migrate') {
        const selected = values['solo-player'];
        migrateAccounts(storage, selected === undefined ? undefined : decodeId(selected));
        output(t('cli.accounts_migrated'));
      } else if (action === 'recover') {
        const playerId = decodeId(values.user);

        const passwordFile = values['password-file'];

        if (!passwordFile) {
          throw new ConfigError(t('cli.choose_password_file_path'));
        }
        const accounts = AccountsService.open(storage);

        try {
          if (!accounts.get(playerId)) {
            throw new ConfigError(t('cli.unknown_user'));
          }
          const password = readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '');

          if (password === '') {
            throw new ConfigError(t('cli.password_must_not_be_empty'));
          }

          await accounts.changePassword(playerId, password, values.admin ?? false);
          output(
            values.admin
              ? t('cli.password_set_account_enabled_as_administrator_and_signed_out')
              : t('cli.password_set_account_signed_out_everywhere'),
          );
        } finally {
          accounts.close();
        }
      } else {
        throw new ConfigError(t('cli.unknown_accounts_command'));
      }
    } finally {
      await release();
    }

    return 0;
  }

  if (group === 'storage' || group === 'uploads') {
    if (key !== undefined || raw !== undefined) {
      throw new ConfigError(t('cli.unexpected_arguments_2', { value1: group }));
    }
    const options: LoadOptions = { path: selected };

    if (values['storage-dir'] !== undefined) {
      options.storageDir = storage;
    }
    const loaded = existsSync(selected) ? await loadConfig(options) : null;
    const directory = loaded?.config.storageDir ?? storage;
    const release = await new LockRepository().acquireStorageLock(directory);

    try {
      if (group === 'storage') {
        return await storageCommand(
          action,
          directory,
          loaded?.path ?? null,
          loaded?.config.retention ?? validateConfig({ storageDir: directory }).retention,
          values,
          output,
        );
      }

      return uploadsCommand(action, directory, values, output);
    } finally {
      await release();
    }
  }

  if (group === 'config') {
    if (key !== undefined || raw !== undefined) {
      throw new ConfigError(t('cli.unexpected_config_arguments'));
    }

    switch (action) {
      case 'init': {
        new AssetFiles().writeDurable(
          selected,
          readFileSync(resolve(packageRoot(), '../examples/zluggish.config.ts'), 'utf8'),
        );
        output(t('cli.created', { value1: selected }));

        return 0;
      }

      case 'migrate': {
        const options = {
          storage,
          output: resolve(values.output ?? selected),
          dryRun: values['dry-run'] ?? false,
        };

        const solo = values['solo-player'];

        const result =
          solo === undefined
            ? await migrateConfig(options)
            : await migrateConfig({
                ...options,
                soloPlayer: decodeId(solo),
              });

        output(JSON.stringify(result, null, 2));

        return 0;
      }

      case 'typecheck': {
        // The runtime image includes TypeScript for offline operator config checks.
        const ts = await import('typescript');

        const program = ts.createProgram([selected], {
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          paths: {
            'zluggish/config': [
              resolve(
                packageRoot(),
                import.meta.url.endsWith('.ts') ? 'src/config/index.ts' : 'dist/src/config/index.d.ts',
              ),
            ],
          },
          typeRoots: [resolve(packageRoot(), 'node_modules/@types')],
          types: ['node'],
        });

        const diagnostics = ts.getPreEmitDiagnostics(program);

        for (const diagnostic of diagnostics) {
          // Do not print source snippets or operator-provided values in diagnostics.
          output(`${diagnostic.file?.fileName ?? selected}: TypeScript ${diagnostic.code}`);
        }

        return diagnostics.length > 0 ? 2 : 0;
      }

      case 'validate':
      case 'show': {
        const options: LoadOptions = { path: selected };

        if (values['storage-dir'] !== undefined) {
          options.storageDir = storage;
        }
        const loaded = await loadConfig(options);

        if (action === 'validate') {
          output(`Valid: ${loaded.path}`);
        } else {
          output(
            JSON.stringify(
              {
                path: loaded.path,
                storageDir: loaded.config.storageDir,
                network: loaded.config.network,
                accounts: loaded.config.accounts,
                bots: {
                  enabled: loaded.config.bots.enabled,
                  multiplier: loaded.config.bots.multiplier,
                },
                omitted: t('cli.paths_integration_values_rider_defaults_and_operator_strings_are'),
              },
              null,
              2,
            ),
          );
        }

        return 0;
      }

      default: {
        throw new ConfigError(t('cli.unknown_config_command'));
      }
    }
  }

  if (group !== 'settings' || !['show', 'set', 'reset'].includes(action ?? '')) {
    throw new ConfigError(t('cli.unknown_command'));
  }
  const playerId = decodeId(values.user);
  const options: LoadOptions = { path: selected };

  if (values['storage-dir'] !== undefined) {
    options.storageDir = storage;
  }
  const { config } = await loadConfig(options);
  new RiderRepository().checkRider(config.storageDir, playerId);

  if (action === 'show') {
    if (key !== undefined) {
      throw new ConfigError(t('cli.unexpected_settings_show_arguments'));
    }
    const store = SettingsStore.openReadOnly(config.storageDir);

    try {
      output(
        JSON.stringify(
          SettingsService.resolveRiderSettings(config.riderDefaults, store?.read(playerId) ?? {}),
          null,
          2,
        ),
      );
    } finally {
      store?.close();
    }

    return 0;
  }

  const setting = decodeSettingKey(key);

  if (action === 'set' && raw === undefined) {
    throw new ConfigError(t('cli.provide_a_json_setting_value'));
  }

  if (action === 'reset' && raw !== undefined) {
    throw new ConfigError(t('cli.unexpected_reset_value'));
  }
  const value: unknown = action === 'set' ? JSON.parse(raw ?? '') : null;

  const change = (overrides: Overrides) => {
    const candidate: Overrides = {
      ...decodeOverrides(action === 'set' ? { ...overrides, [setting]: value } : overrides),
    };

    if (action === 'reset') {
      delete candidate[setting];
    }

    return candidate;
  };

  if (values['dry-run']) {
    const store = SettingsStore.openReadOnly(config.storageDir);

    try {
      change(store?.read(playerId) ?? {});
    } finally {
      store?.close();
    }

    output(t('cli.valid_change_dry_run'));

    return 0;
  }

  const release = await new LockRepository().acquireStorageLock(config.storageDir);

  try {
    const store = SettingsStore.open(config.storageDir);

    try {
      store.save(playerId, change(store.read(playerId)));
    } finally {
      store.close();
    }

    output(t('cli.settings_saved'));
  } finally {
    await release();
  }

  return 0;
}

type Values = {
  'dry-run'?: boolean | undefined;
  output?: string | undefined;
  input?: string | undefined;
  activity?: string | undefined;
  provider?: string | undefined;
  confirm?: boolean | undefined;
};

async function storageCommand(
  action: string | undefined,
  storage: string,
  config: string | null,
  retention: ResolvedConfig['retention'],
  values: Values,
  output: (message: string) => void,
) {
  if (action === 'usage' || action === 'cleanup') {
    const accounts = AccountsService.open(storage);

    try {
      const service = RetentionService.forScope({ repositories: accounts.repositories, retention, storage });

      if (action === 'usage') {
        output(JSON.stringify(await Effect.runPromise(service.usage()), null, 2));

        return 0;
      }

      const plan = await Effect.runPromise(service.plan());
      const bytes = plan.files.reduce((total, file) => total + file.bytes, 0);

      for (const file of plan.files) {
        output(`${file.reason}: ${file.path} (${file.bytes} bytes)`);
      }
      output(
        t('cli.files_bytes_finished_jobs_delivery_records_abandoned_uploads', {
          value1: plan.files.length,
          value2: bytes,
          value3: plan.jobs,
          value4: plan.deliveries,
          value5: plan.media.length,
        }),
      );

      if (values['dry-run']) {
        return 0;
      }
      await Effect.runPromise(service.apply(plan));
      output(t('cli.cleanup_complete'));

      return 0;
    } finally {
      accounts.close();
    }
  }

  if (action === 'clean-legacy') {
    const plan = legacyPlan(storage);

    for (const file of plan.removable) {
      output(`remove: ${file.path} (${file.bytes} bytes)`);
    }

    for (const file of plan.kept) {
      output(`keep: ${file.path} (${file.reason})`);
    }

    if (!values.confirm) {
      output(t('cli.legacy_files_can_be_removed_run_again_with_confirm', { value1: plan.removable.length }));

      return 0;
    }

    removeLegacy(storage, plan);
    output(t('cli.legacy_files_removed', { value1: plan.removable.length }));

    return 0;
  }

  if (action === 'backup') {
    if (!values.output) {
      throw new ConfigError(t('cli.choose_a_directory_or_tar_gz_file_with_output'));
    }
    // Opening the database applies pending migrations, so the backup has the current schema.
    openDatabase(storage).close();
    const path = resolve(values.output);
    const createBackup = path.endsWith(archiveSuffix) ? backupStorageArchive : backupStorage;
    const files = await createBackup(storage, path, config);
    output(t('cli.backup_complete_files', { value1: files }));

    return 0;
  }

  if (action === 'restore') {
    if (!values.input) {
      throw new ConfigError(t('cli.choose_a_directory_or_tar_gz_file_with_input'));
    }
    restoreStorage(storage, resolve(values.input), config);
    output(t('cli.restore_complete_uploads_stay_paused_review_them_with_uploads'));

    return 0;
  }

  throw new ConfigError(t('cli.unknown_storage_command'));
}

function uploadsCommand(
  action: string | undefined,
  storage: string,
  values: Values,
  output: (message: string) => void,
) {
  if (action === 'pause') {
    pauseUploads(storage, 'operator');
    output(t('cli.uploads_paused'));

    return 0;
  }

  const accounts = AccountsService.open(storage);

  try {
    const repositories = accounts.repositories;
    const flags = repositories.systemFlagsRepository;

    const list = () => {
      for (const delivery of repositories.uploadsRepository.waiting()) {
        output(t('cli.activity', { value1: delivery.activity_id, value2: delivery.provider, value3: delivery.state }));
      }
    };

    switch (action) {
      case 'list': {
        output(flags.get(SystemFlag.UploadPause) === null ? t('cli.uploads_are_running') : t('cli.uploads_are_paused'));
        list();

        return 0;
      }

      case 'resume': {
        if (!values.confirm) {
          list();
          throw new ConfigError(t('cli.cancel_unwanted_deliveries_first_then_run_uploads_resume_confirm'));
        }

        flags.clear(SystemFlag.UploadPause);
        output(t('cli.uploads_resumed'));

        return 0;
      }

      case 'cancel': {
        const activity = decodeId(values.activity);
        const provider = Schema.decodeUnknownSync(Schema.NonEmptyString)(values.provider);

        if (!repositories.uploadsRepository.cancel(activity, provider)) {
          throw new ConfigError(t('cli.no_pending_failed_or_ambiguous_delivery_matches'));
        }
        output(t('cli.delivery_cancelled'));

        return 0;
      }

      default: {
        throw new ConfigError(t('cli.unknown_uploads_command'));
      }
    }
  } finally {
    accounts.close();
  }
}
