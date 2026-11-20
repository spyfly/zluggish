import { Context, Effect, Layer } from 'effect';
import { RuntimeContext } from '#src/context';
import { immediate } from '#src/db/transaction';
import { ApplicationError } from '#src/errors';

interface ActiveRide {
  activity: bigint;
  token: string;
  generation: number;
  key: Buffer;
}

interface Permission extends ActiveRide {
  deadline: number;
  lastSeen: number;
}

interface Receipt {
  token: string;
  activity: bigint;
  body: string;
  until: number;
  result: string;
}

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;

  const active = new Map<number, ActiveRide>();

  const permissions = new Map<number, Permission>();

  const receipts = new Map<number, Receipt>();

  function persistRelay(player: number, key: Uint8Array, version: number) {
    immediate(context.accounts.db, () => {
      const rider = context.accounts.get(player);

      if (!rider?.enabled || rider.auth_version !== version)
        throw new ApplicationError({ status: 401, message: 'Relay revoked.' });
      repositories.riderDocuments.put(player, 'encryption_key.bin', key);
      repositories.riderDocuments.put(player, 'relay-auth-version', String(version));
    });
  }

  function register(player: number, activity: bigint, bearer: string) {
    const relay = context.world.relays.get(BigInt(player));

    if (!relay || !bearer) return;
    active.set(player, {
      activity,
      token: repositories.cryptoRepository.sha256(bearer),
      generation: context.world.generation(BigInt(player)),
      key: Buffer.from(relay.key),
    });
  }

  function capture(player: number) {
    const ride = active.get(player);

    if (!ride || context.world.generation(BigInt(player)) !== ride.generation) return null;

    return { ...ride, deadline: Date.now() + 4 * 60 * 60_000, lastSeen: Date.now() };
  }

  function grant(player: number, permission: Permission | null) {
    cancel(player, false);

    if (permission) permissions.set(player, permission);
    else context.world.logout(BigInt(player));
  }

  function cancel(player: number, close = true) {
    active.delete(player);
    permissions.delete(player);
    receipts.delete(player);

    if (close) context.world.logout(BigInt(player));
  }

  function permissionNow(player: number) {
    const permission = permissions.get(player);

    if (!permission) return null;

    if (
      Date.now() >= permission.deadline ||
      Date.now() >= permission.lastSeen + context.config.recovery.resumeMinutes * 60_000 ||
      context.world.generation(BigInt(player)) !== permission.generation
    ) {
      cancel(player);

      return null;
    }

    return permission;
  }

  function relayNow(player: number) {
    const permission = permissionNow(player);
    const current = context.world.relays.get(BigInt(player));

    return !!(permission && current && permission.key.equals(current.key));
  }

  function touch(player: number) {
    const permission = permissionNow(player);

    if (permission) permission.lastSeen = Date.now();
  }

  function authorize(player: number, activity: bigint, bearer: string, bytes: Uint8Array) {
    const digest = repositories.cryptoRepository.sha256(bearer);
    const receipt = receipts.get(player);
    const body = repositories.cryptoRepository.sha256(bytes);

    if (receipt && receipt.until > Date.now() && receipt.token === digest && receipt.activity === activity) {
      if (receipt.body !== body) throw new ApplicationError({ status: 409, message: 'Final save data changed.' });

      return { receipt: receipt.result };
    }

    const permission = permissionNow(player);

    if (!permission || permission.token !== digest || permission.activity !== activity)
      throw new ApplicationError({ status: 401, message: 'Ride completion permission expired.' });

    return { receipt: null };
  }

  function finish(player: number, activity: bigint, bearer: string, bytes: Uint8Array, result: string) {
    const token = repositories.cryptoRepository.sha256(bearer);
    const body = repositories.cryptoRepository.sha256(bytes);
    cancel(player);
    receipts.set(player, { token, activity, body, result, until: Date.now() + 300_000 });
  }

  function sweep() {
    for (const player of permissions.keys()) permissionNow(player);

    for (const [player, receipt] of receipts) if (receipt.until <= Date.now()) receipts.delete(player);
  }

  context.accounts.onRevoke = (id) => cancel(id);

  return {
    persistRelay: Effect.fn('RideCompletionService.persistRelay')(function* (
      player: number,
      key: Uint8Array,
      version: number,
    ) {
      return persistRelay(player, key, version);
    }),

    register: Effect.fn('RideCompletionService.register')(function* (player: number, activity: bigint, bearer: string) {
      return register(player, activity, bearer);
    }),

    capture: Effect.fn('RideCompletionService.capture')(function* (player: number) {
      return capture(player);
    }),

    grant: Effect.fn('RideCompletionService.grant')(function* (player: number, permission: Permission | null) {
      return grant(player, permission);
    }),

    cancel: Effect.fn('RideCompletionService.cancel')(function* (player: number, close: boolean = true) {
      return cancel(player, close);
    }),

    permission: Effect.fn('RideCompletionService.permission')(function* (player: number) {
      return permissionNow(player);
    }),

    relay: Effect.fn('RideCompletionService.relay')(function* (player: number) {
      return relayNow(player);
    }),

    touch: Effect.fn('RideCompletionService.touch')(function* (player: number) {
      return touch(player);
    }),

    authorize: Effect.fn('RideCompletionService.authorize')(function* (
      player: number,
      activity: bigint,
      bearer: string,
      bytes: Uint8Array,
    ) {
      return authorize(player, activity, bearer, bytes);
    }),

    finish: Effect.fn('RideCompletionService.finish')(function* (
      player: number,
      activity: bigint,
      bearer: string,
      bytes: Uint8Array,
      result: string,
    ) {
      return finish(player, activity, bearer, bytes, result);
    }),

    sweep: Effect.fn('RideCompletionService.sweep')(function* () {
      return sweep();
    }),
  };
});

/** A disabled rider's completion permission is deliberately not a normal identity. */
export class RideCompletionService extends Context.Service<RideCompletionService, Effect.Success<typeof make>>()(
  'zluggish/RideCompletionService',
) {
  static readonly layer = Layer.effect(RideCompletionService, make);
}
