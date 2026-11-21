import { RuntimeContext } from '#src/context';
import { ApplicationError } from '#src/errors';
import type { Achievements } from '#src/protocol/generated/profile_pb';
import { AchievementsSchema } from '#src/protocol/generated/profile_pb';
import type { UserStorage } from '#src/protocol/generated/user_storage_pb';
import { AttributesSchema, UserStorageSchema } from '#src/protocol/generated/user_storage_pb';
import { AchievementService } from '#src/services/achievement.service';
import { clone, create, fromBinary, isFieldSet, toBinary } from '@bufbuild/protobuf';
import { reflect } from '@bufbuild/protobuf/reflect';
import { resolve } from 'node:path';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { withDefault } from '#src/schema';

const fileRow = Schema.Struct({
  id: Schema.Finite,
  player_id: Schema.Finite,
  folder: Schema.String,
  filename: Schema.String,
  timestamp: Schema.Finite,
});

function safeName(value: string) {
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) {
    throw new ApplicationError({ status: 400 });
  }

  return value;
}

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;
  const achievementService = yield* AchievementService;

  const achievements = Effect.fn('StorageService.achievements')(function* (id: number) {
    return yield* achievementService.loadAchievements(id);
  });

  /** Repeated unlocks are idempotent membership additions, not progression increments. */
  const unlock = Effect.fn('StorageService.unlock')(function* (id: number, incoming: Achievements) {
    const stored = repositories.riderDocuments.get(id, 'achievements.bin');
    const achievements = stored ? fromBinary(AchievementsSchema, stored) : create(AchievementsSchema);

    for (const achievement of incoming.achievements) {
      if (achievements.achievements.every((item) => item.id !== achievement.id)) {
        achievements.achievements.push(achievement);
      }
    }
    repositories.riderDocuments.put(id, 'achievements.bin', toBinary(AchievementsSchema, achievements));
  });

  const attributes = Effect.fn('StorageService.attributes')(function* (id: number, requested: Set<number>) {
    const storage = userStorage(id);

    const unlockBikes = requested.has(24) && context.config.equipment.unlockBikeUpgrades;

    const attributes = storage.attributes.filter((attribute) =>
      AttributesSchema.fields.some(
        (field) => requested.has(field.number) && !(unlockBikes && field.number === 24) && isFieldSet(attribute, field),
      ),
    );

    if (unlockBikes) {
      // A stored attribute can contain both progress and unrelated settings.
      for (const [index, stored] of attributes.entries()) {
        const attribute = clone(AttributesSchema, stored);
        delete attribute.bikeProgress;
        attributes[index] = attribute;
      }

      const dictionary = Schema.decodeUnknownSync(
        Schema.Struct({
          bikeframes: Schema.Record(Schema.String, Schema.String),
          bikeframesextra: Schema.Record(Schema.String, Schema.String).pipe(withDefault({})),
        }),
      )(
        JSON.parse(
          repositories.filesRepository.readFileSync(resolve(context.assets, 'data/game_dictionary.txt'), 'utf8'),
        ),
      );

      const now = BigInt(Date.now());

      for (const signature of new Set([
        ...Object.keys(dictionary.bikeframes),
        ...Object.keys(dictionary.bikeframesextra),
      ])) {
        attributes.push(
          create(AttributesSchema, {
            bikeProgress: { signature, level: 5, percentage: 1, lastUpgrade: now, time: now },
          }),
        );
      }
    }

    return create(UserStorageSchema, { attributes });
  });

  const saveAttributes = Effect.fn('StorageService.saveAttributes')(function* (id: number, incoming: UserStorage) {
    const storage = userStorage(id);

    for (const attribute of incoming.attributes) {
      const incomingFields = reflect(AttributesSchema, attribute);

      storage.attributes = storage.attributes.filter((old) => {
        const existing = reflect(AttributesSchema, old);

        for (const field of AttributesSchema.fields) {
          if (field.fieldKind !== 'message' || !incomingFields.isSet(field) || !existing.isSet(field)) {
            continue;
          }
          const signature = field.message.fields.find((nested) => nested.name === 'signature');

          if (!signature || existing.get(field).get(signature) === incomingFields.get(field).get(signature)) {
            existing.clear(field);
          }
        }

        return AttributesSchema.fields.some((field) => existing.isSet(field)) || !!existing.getUnknown()?.length;
      });
      storage.attributes.push(attribute);
    }

    repositories.riderDocuments.put(id, 'user_storage.bin', toBinary(UserStorageSchema, storage));
  });

  function userStorage(id: number) {
    const stored = repositories.riderDocuments.get(id, 'user_storage.bin');

    return stored ? fromBinary(UserStorageSchema, stored) : create(UserStorageSchema);
  }

  const upload = Effect.fn('StorageService.upload')(function* (
    id: number,
    upload: { folder: string; filename: string; file: Uint8Array },
  ) {
    const folder = safeName(upload.folder);

    if (folder.startsWith('.')) {
      return yield* new ApplicationError({ status: 400 });
    }
    const name = safeName(upload.filename);
    repositories.filesRepository.write(resolve(context.profiles.folder(id), folder, name), upload.file);
    const existing = repositories.storageRepository.findZfile(id, folder, name);
    const timestamp = Math.floor(Date.now() / 1000);

    if (existing) {
      repositories.storageRepository.updateZfileTimestamp(timestamp, Schema.decodeUnknownSync(fileRow)(existing).id);
    }

    const fileId = existing
      ? Schema.decodeUnknownSync(fileRow)(existing).id
      : Number(repositories.storageRepository.insertZfile(id, folder, name, timestamp).lastInsertRowid);

    return { id: fileId, folder, name, timestamp };
  });

  const list = Effect.fn('StorageService.list')(function* (id: number, folder: string) {
    return repositories.storageRepository.listZfile(id, folder).map((row) => Schema.decodeUnknownSync(fileRow)(row));
  });

  function owned(id: number, fileId: string) {
    const parsed = Schema.decodeUnknownOption(fileRow)(repositories.storageRepository.findZfileRow(fileId, id));

    if (Option.isNone(parsed)) {
      throw new ApplicationError({ status: 404 });
    }

    return parsed.value;
  }

  const deleteEntry = Effect.fn('StorageService.delete')(function* (id: number, fileId: string) {
    const row = owned(id, fileId);
    repositories.filesRepository.remove(
      resolve(context.profiles.folder(id), safeName(row.folder), safeName(row.filename)),
    );
    repositories.storageRepository.deleteZfile(row.id);
  });

  const downloadPath = Effect.fn('StorageService.downloadPath')(function* (id: number, fileId: string) {
    const row = owned(id, fileId);

    const path = resolve(context.profiles.folder(id), safeName(row.folder), safeName(row.filename));

    if (!repositories.filesRepository.existsSync(path) || !repositories.filesRepository.statSync(path).isFile()) {
      return yield* new ApplicationError({ status: 404 });
    }

    return path;
  });

  return { achievements, unlock, attributes, saveAttributes, upload, list, delete: deleteEntry, downloadPath };
});

export class StorageService extends Context.Service<StorageService, Effect.Success<typeof make>>()(
  'zluggish/StorageService',
) {
  static readonly layer = Layer.effect(StorageService, make);
}
