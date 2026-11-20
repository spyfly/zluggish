import { Context, Duration, Effect, Fiber, Layer, Schedule } from 'effect';
import { metrics } from '#src/repositories/metrics.repository';

const make = Effect.gen(function* () {
  const report = Effect.fn('MetricsService.report')(function* () {
    metrics.reset();
  });

  /** Report every `intervalSeconds` until the returned function stops it. 0 disables reports. */
  const start = Effect.fn('MetricsService.start')(function* (intervalSeconds: number) {
    if (intervalSeconds === 0) {
      return () => {};
    }

    metrics.monitorEventLoop();
    const interval = Duration.seconds(intervalSeconds);

    const reporter = yield* report().pipe(
      Effect.delay(interval),
      Effect.repeat(Schedule.spaced(interval)),
      Effect.forkDetach,
    );

    return () => {
      Effect.runFork(Fiber.interrupt(reporter));
      metrics.stopEventLoop();
    };
  });

  const summary = Effect.fn('MetricsService.summary')(function* () {
    return metrics.summary();
  });

  return { start, report, summary };
});

/** Periodic telemetry: durations, sizes and counts only. Each report resets the window. */
export class MetricsService extends Context.Service<MetricsService, Effect.Success<typeof make>>()(
  'zluggish/MetricsService',
) {
  static readonly layer = Layer.effect(MetricsService, make);
}
