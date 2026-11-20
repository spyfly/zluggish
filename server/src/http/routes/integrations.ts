import { ConnectionsService } from '#src/services/connections.service';
import { IntegrationsService } from '#src/services/integrations.service';
import { Effect } from 'effect';
import { effectRoutes } from '#src/http/effect';
import { SettingsService } from '#src/services/settings.service';
import { authenticated } from '#src/http/routes/accounts';
import type { HttpRuntime as Runtime, RuntimeEnv } from '#src/http/runtime';
import type { Hono } from 'hono';

export function integrationRoutes(app: Hono<RuntimeEnv>, runtime: Runtime) {
  const appRoutes = effectRoutes(app, runtime);
  appRoutes.post('/api/d-lock-service/device/authenticate', (c) =>
    Effect.gen(function* () {
      const connectionsService = yield* ConnectionsService;

      const integrationsService = yield* IntegrationsService;

      const settingsService = yield* SettingsService;

      const rider = authenticated(c);
      const { credentials } = yield* connectionsService.inspect(rider.player_id, 'zwift');

      const enabled = (yield* settingsService.resolveRiderSettings(
        runtime.config.riderDefaults,
        yield* settingsService.read(rider.player_id),
      )).devices.zwiftClick.enabled;

      if (!enabled || !credentials) {
        return c.body(null, 204);
      }

      // Any failure of the official service means "no device": the client carries on without it.
      return yield* Effect.gen(function* () {
        const token = yield* integrationsService.officialLogin(credentials[0], credentials[1]);
        const headers = yield* integrationsService.officialHeaders(token);
        const body = new Uint8Array(yield* Effect.promise(() => c.req.arrayBuffer()));

        const response = yield* integrationsService.request(
          `${integrationsService.officialRelay}/api/d-lock-service/device/authenticate`,
          {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': c.req.header('Content-Type') ?? 'application/octet-stream',
              Accept: c.req.header('Accept') ?? '*/*',
            },
            body,
            signal: AbortSignal.timeout(30_000),
          },
        );

        return new Response(yield* Effect.promise(() => response.arrayBuffer()), {
          status: response.status,
          headers: {
            'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
          },
        });
      }).pipe(Effect.catchCause(() => Effect.succeed(c.body(null, 204))));
    }),
  );
}
