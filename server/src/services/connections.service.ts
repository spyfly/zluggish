import { Context, Effect, Layer } from 'effect';
import { RuntimeContext } from '#src/context';
import { UnreadableCredentialsError } from '#src/errors';
import type { Connections } from '#src/repositories/connections.repository';
import { UploadsService } from '#src/services/uploads.service';

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;
  const uploadsService = yield* UploadsService;

  const has = Effect.fn('ConnectionsService.has')(function* (...args: Parameters<Connections['has']>) {
    return repositories.connectionsRepository.has(...args);
  });

  const read = Effect.fn('ConnectionsService.read')(function* (...args: Parameters<Connections['read']>) {
    return repositories.connectionsRepository.read(...args);
  });

  /** Saved credentials, or `unreadable` when the credentials key cannot decrypt them. */
  const inspect = Effect.fn('ConnectionsService.inspect')(function* (
    ...[player, service]: Parameters<Connections['read']>
  ) {
    try {
      return { credentials: repositories.connectionsRepository.read(player, service), unreadable: false };
    } catch (error) {
      if (!(error instanceof UnreadableCredentialsError)) {
        throw error;
      }
      context.world.lifecycle.log.warn('connections.unreadable', 'Saved credentials cannot be decrypted', {
        playerId: player,
        provider: service,
        error,
      });

      return { credentials: null, unreadable: true };
    }
  });

  const save = Effect.fn('ConnectionsService.save')(function* (...args: Parameters<Connections['save']>) {
    return repositories.connectionsRepository.save(...args);
  });

  const remove = Effect.fn('ConnectionsService.remove')(function* (...args: Parameters<Connections['remove']>) {
    repositories.connectionsRepository.remove(...args);
    yield* uploadsService.revoke(args[0]);
  });

  return { has, read, inspect, save, remove };
});

export class ConnectionsService extends Context.Service<ConnectionsService, Effect.Success<typeof make>>()(
  'zluggish/ConnectionsService',
) {
  static readonly layer = Layer.effect(ConnectionsService, make);
}
