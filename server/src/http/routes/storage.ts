import { effectRoutes } from '#src/http/effect';
import { fileResponse } from '#src/http/file-response';
import { StorageService } from '#src/services/storage.service';
import { fileUploadSchema } from '#src/dtos/storage.dto';
import { Effect, Schema } from 'effect';
import { parseProtobuf } from '#src/http/protobuf';
import { authenticated } from '#src/http/routes/accounts';
import type { HttpRuntime as Runtime, RuntimeEnv } from '#src/http/runtime';
import { AchievementsSchema } from '#src/protocol/generated/profile_pb';
import { UserStorageSchema } from '#src/protocol/generated/user_storage_pb';
import { ZFileProtoSchema, ZFilesProtoSchema } from '#src/protocol/generated/zfiles_pb';
import { create, toBinary } from '@bufbuild/protobuf';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

export function storageRoutes(app: Hono<RuntimeEnv>, runtime: Runtime) {
  const appRoutes = effectRoutes(app, runtime);
  appRoutes.get('/api/achievement/loadPlayerAchievements', (c) =>
    Effect.gen(function* () {
      const storageService = yield* StorageService;

      const user = authenticated(c);

      return c.body(toBinary(AchievementsSchema, yield* storageService.achievements(user.player_id)));
    }),
  );
  appRoutes.post('/api/achievement/unlock', (c) =>
    Effect.gen(function* () {
      const storageService = yield* StorageService;

      const user = authenticated(c);

      yield* storageService.unlock(
        user.player_id,
        parseProtobuf(AchievementsSchema, new Uint8Array(yield* Effect.promise(() => c.req.arrayBuffer()))),
      );

      return c.body(null, 202);
    }),
  );
  appRoutes.on(['GET', 'POST'], '/api/player-profile/user-game-storage/attributes', (c) =>
    Effect.gen(function* () {
      const storageService = yield* StorageService;

      const user = authenticated(c);

      if (c.req.method === 'POST') {
        yield* storageService.saveAttributes(
          user.player_id,
          parseProtobuf(UserStorageSchema, new Uint8Array(yield* Effect.promise(() => c.req.arrayBuffer()))),
        );

        return c.body(null, 202);
      }

      const response = yield* storageService.attributes(
        user.player_id,
        new Set((c.req.queries('n') ?? []).map(Number)),
      );

      return c.body(toBinary(UserStorageSchema, response));
    }),
  );
  appRoutes.post('/api/zfiles', (c) =>
    Effect.gen(function* () {
      const storageService = yield* StorageService;

      const user = authenticated(c);

      let upload;

      if (c.req.header('Source') === 'zwift-companion') {
        const input = Schema.decodeUnknownSync(fileUploadSchema)(
          yield* Effect.promise(() =>
            c.req.json().catch(() => {
              throw new HTTPException(400);
            }),
          ),
        );

        upload = { folder: input.folder, filename: input.name, file: Buffer.from(input.content, 'base64') };
      } else upload = parseProtobuf(ZFileProtoSchema, new Uint8Array(yield* Effect.promise(() => c.req.arrayBuffer())));

      const { id, folder, name, timestamp } = yield* storageService.upload(user.player_id, upload);

      if (c.req.header('Accept')?.includes('application/json'))
        return c.json({
          id,
          folder,
          name,
          content: null,
          lastModified: new Date(timestamp * 1000).toISOString().replace('Z', '+0000'),
        });

      return c.body(
        toBinary(
          ZFileProtoSchema,
          create(ZFileProtoSchema, {
            id: BigInt(id),
            folder,
            filename: name,
            timestamp: BigInt(timestamp),
          }),
        ),
      );
    }),
  );
  appRoutes.get('/api/zfiles/list', (c) =>
    Effect.gen(function* () {
      const storageService = yield* StorageService;

      const user = authenticated(c);

      const rows = yield* storageService.list(user.player_id, c.req.query('folder') ?? '');

      return c.body(
        toBinary(
          ZFilesProtoSchema,
          create(ZFilesProtoSchema, {
            zfiles: rows.map((row) => ({
              id: BigInt(row.id),
              folder: row.folder,
              filename: row.filename,
              timestamp: BigInt(row.timestamp),
            })),
          }),
        ),
      );
    }),
  );
  appRoutes.on(['GET', 'DELETE'], ['/api/zfiles/:id/download', '/api/zfiles/:id'], (c) =>
    Effect.gen(function* () {
      const storageService = yield* StorageService;

      const user = authenticated(c);

      if (c.req.method === 'DELETE') {
        yield* storageService.delete(user.player_id, c.req.param('id'));

        return c.body(null, 200);
      }

      return yield* fileResponse(c, yield* storageService.downloadPath(user.player_id, c.req.param('id')));
    }),
  );
}
