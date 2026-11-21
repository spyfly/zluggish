import { effectRoutes } from '#src/http/effect';
import { parseProtobuf } from '#src/http/protobuf';
import { Effect, Schema } from 'effect';
import { authenticated } from '#src/http/routes/accounts';
import type { HttpRuntime as Runtime, RuntimeEnv } from '#src/http/runtime';
import { GoalSchema, GoalsSchema } from '#src/protocol/generated/goal_pb';
import { goalInput, GoalService } from '#src/services/goals.service';
import { create, toBinary } from '@bufbuild/protobuf';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

export function goalRoutes(app: Hono<RuntimeEnv>, runtime: Runtime) {
  const appRoutes = effectRoutes(app, runtime);
  appRoutes.on(['GET', 'POST'], '/api/profiles/:id/goals', (c) =>
    Effect.gen(function* () {
      const goalsService = yield* GoalService;

      const user = authenticated(c);

      if (String(user.player_id) !== c.req.param('id')) {
        throw new HTTPException(401);
      }
      const json = c.req.header('Accept')?.includes('application/json');

      if (c.req.method === 'POST') {
        const goal = c.req.header('Content-Type')?.includes('application/x-protobuf-lite')
          ? parseProtobuf(GoalSchema, new Uint8Array(yield* Effect.promise(() => c.req.arrayBuffer())))
          : GoalService.parseGoal(Schema.decodeUnknownSync(goalInput)(yield* Effect.promise(() => c.req.json())));

        yield* goalsService.create(user.player_id, goal);

        return json ? c.json(GoalService.jsonGoal(goal)) : c.body(toBinary(GoalSchema, goal));
      }

      const goals = yield* goalsService.list(user.player_id);

      return json
        ? c.json(goals.map((goal) => GoalService.jsonGoal(goal)))
        : c.body(toBinary(GoalsSchema, create(GoalsSchema, { goals })));
    }),
  );
  appRoutes.on(['PUT', 'DELETE'], '/api/profiles/:id/goals/:goalId', (c) =>
    Effect.gen(function* () {
      const goalsService = yield* GoalService;

      const user = authenticated(c);

      if (String(user.player_id) !== c.req.param('id')) {
        throw new HTTPException(401);
      }
      const id = BigInt(c.req.param('goalId'));
      yield* goalsService.requireOwned(user.player_id, id);

      if (c.req.method === 'DELETE') {
        yield* goalsService.delete(user.player_id, id);

        return c.body(null, 200);
      }

      const body = Schema.decodeUnknownSync(goalInput)(yield* Effect.promise(() => c.req.json()));
      const goal = GoalService.parseGoal(body);
      yield* goalsService.update(user.player_id, id, goal);

      return c.json(body);
    }),
  );
}
