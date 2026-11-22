import { ApplicationError } from '#src/errors';
import { ApkRepository } from '#src/repositories/apk.repository';
import { resolve } from 'node:path';
import { Context, Layer } from 'effect';

export const zwiftObbLimit = 2 * 1024 ** 3;

class ZwiftAndroidPatcher {
  private readonly apk = new ApkRepository();
  private busy = false;

  async patch(body: ReadableStream<Uint8Array>, pem: string, signal: AbortSignal) {
    if (this.busy) {
      throw new ApplicationError({
        status: 409,
        message: 'Another Android expansion file is being processed. Try again shortly.',
      });
    }

    this.busy = true;
    let workspace: string | undefined;
    const cleanup = async () => {
      try {
        if (workspace) {
          await this.apk.removeTree(workspace);
        }
      } finally {
        this.busy = false;
      }
    };

    try {
      workspace = await this.apk.workspace();
      const input = resolve(workspace, 'original.obb');
      const output = resolve(workspace, 'patched.obb');
      const bytes = await this.apk.receive(body, input, zwiftObbLimit);
      signal.throwIfAborted();
      await this.apk.patchZwiftObb(input, output, pem);
      signal.throwIfAborted();

      const stream = this.apk.readStream(output, signal, () => void cleanup().catch(() => {}));

      return { body: stream, bytes };
    } catch (error) {
      await cleanup();
      throw new ApplicationError({
        status: 400,
        message: error instanceof Error ? error.message : 'The expansion file could not be patched.',
      });
    }
  }
}

export class ZwiftAndroidService extends Context.Service<ZwiftAndroidService, ZwiftAndroidPatcher>()(
  'zluggish/ZwiftAndroidService',
) {
  static readonly layer = Layer.sync(ZwiftAndroidService, () => new ZwiftAndroidPatcher());
}
