import { Metric, metrics } from '#src/repositories/metrics.repository';
import type { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { Schema } from 'effect';

const report = Schema.Struct({ walBytes: Schema.Finite, durationMs: Schema.NullOr(Schema.Finite) });

/** Checkpoint ownership: while the runtime runs, a worker thread checkpoints the WAL
with its own connection and the main connection does not auto-checkpoint. At shutdown
the main connection truncates the WAL once.
*/
export class CheckpointRepository {
  private worker: Worker | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly path: string,
    private readonly intervalMs = 5000,
    private readonly thresholdBytes = 4 * 1024 * 1024,
  ) {}

  start() {
    if (this.worker) return;
    this.db.exec('PRAGMA wal_autocheckpoint=0; PRAGMA journal_size_limit=16777216;');
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

    const worker = new Worker(new URL(`checkpoint.worker.${extension}`, import.meta.url), {
      workerData: { path: this.path, intervalMs: this.intervalMs, thresholdBytes: this.thresholdBytes },
    });

    worker.unref();
    worker.on('message', (message) => {
      const parsed = Schema.decodeUnknownSync(report)(message);
      metrics.record(Metric.WalBytes, parsed.walBytes);

      if (parsed.durationMs !== null) metrics.record(Metric.Checkpoint, parsed.durationMs);
    });
    worker.on('error', () => {
      // Fall back to automatic checkpoints on the main connection.
      if (this.db.isOpen) this.db.exec('PRAGMA wal_autocheckpoint=1000');
      this.worker = null;
    });
    this.worker = worker;
  }

  async close() {
    const worker = this.worker;
    this.worker = null;

    if (worker) {
      const exited = new Promise<void>((resolve) => {
        worker.once('exit', () => resolve());
      });
      worker.ref();
      worker.postMessage('stop');
      await exited;
    }

    if (!this.db.isOpen) return;
    metrics.time(Metric.Checkpoint, () => this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'));
    this.db.exec('PRAGMA wal_autocheckpoint=1000');
  }
}
