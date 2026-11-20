export const Metric = {
  EventLoopDelay: 'event_loop.delay_ms',
  SimulationTickDelay: 'simulation.tick_delay_ms',
  DatabaseTransaction: 'db.transaction_ms',
  DurableWrite: 'file.durable_write_ms',
  FitProcessing: 'fit.processing_ms',
  FitCopy: 'fit.copy_ms',
  WalBytes: 'db.wal_bytes',
  Checkpoint: 'db.checkpoint_ms',
  Flush: 'db.flush_ms',
  RecoveryAppend: 'recovery.append_ms',
  RecoveryBytes: 'recovery.file_bytes',
  QueueDepth: 'persistence.queue_depth',
  QueueWait: 'persistence.queue_wait_ms',
  QueueRejected: 'persistence.rejected',
} as const;

export type Metric = (typeof Metric)[keyof typeof Metric];

export type MetricSummary = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

const limit = 10_000;

function percentile(sorted: Array<number>, fraction: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

/** Bounded in-process samples. Values are durations or sizes only; never payloads or identities. */
export class MetricsRepository {
  private readonly samples = new Map<Metric, Array<number>>();

  private loop: NodeJS.Timeout | null = null;

  record(metric: Metric, value: number) {
    const values = this.samples.get(metric) ?? [];

    if (values.length >= limit) {
      values[Math.floor(Math.random() * limit)] = value;
    } else {
      values.push(value);
    }

    this.samples.set(metric, values);
  }

  time<T>(metric: Metric, operation: () => T): T {
    const start = performance.now();

    try {
      return operation();
    } finally {
      this.record(metric, performance.now() - start);
    }
  }

  async timeAsync<T>(metric: Metric, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();

    try {
      return await operation();
    } finally {
      this.record(metric, performance.now() - start);
    }
  }

  /** Samples lag every 10 ms with a monotonic clock. perf_hooks.monitorEventLoopDelay
  uses cached loop time and does not see synchronous file I/O inside one iteration.
  */
  monitorEventLoop() {
    if (this.loop) {
      return;
    }
    let expected = performance.now() + 10;

    this.loop = setInterval(() => {
      const now = performance.now();
      this.record(Metric.EventLoopDelay, Math.max(0, now - expected));
      expected = now + 10;
    }, 10);
    this.loop.unref();
  }

  stopEventLoop() {
    if (this.loop) {
      clearInterval(this.loop);
    }
    this.loop = null;
  }

  summary(): Partial<Record<Metric, MetricSummary>> {
    const result: Partial<Record<Metric, MetricSummary>> = {};

    for (const [metric, values] of this.samples) {
      if (values.length === 0) {
        continue;
      }
      const sorted = values.toSorted((a, b) => a - b);

      result[metric] = {
        count: values.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1) ?? 0,
      };
    }

    return result;
  }

  reset() {
    this.samples.clear();
  }
}

/** Process-wide collector: ad-hoc repositories and workers report into one summary. */
export const metrics = new MetricsRepository();
