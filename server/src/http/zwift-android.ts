import { ApplicationError } from '#src/errors';
import { ApkRepository } from '#src/repositories/apk.repository';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

export const zwiftObbLimit = 2 * 1024 ** 3;

export function zwiftAndroidPatcher() {
  const apk = new ApkRepository();
  let busy = false;

  return async (body: ReadableStream<Uint8Array>, pem: string, signal: AbortSignal) => {
    if (busy) {
      throw new ApplicationError({
        status: 409,
        message: 'Another Android expansion file is being processed. Try again shortly.',
      });
    }

    busy = true;
    let workspace: string | undefined;
    const cleanup = async () => {
      try {
        if (workspace) {
          await apk.removeTree(workspace);
        }
      } finally {
        busy = false;
      }
    };

    try {
      workspace = await apk.workspace();
      const input = resolve(workspace, 'original.obb');
      const output = resolve(workspace, 'patched.obb');
      const bytes = await apk.receive(body, input, zwiftObbLimit);
      signal.throwIfAborted();
      await apk.patchZwiftObb(input, output, pem);
      signal.throwIfAborted();

      const file = createReadStream(output, { signal });
      file.once('close', () => void cleanup().catch(() => {}));

      // SAFETY: Node and DOM declare different overloads for the same WHATWG byte stream.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const stream = Readable.toWeb(file, {
        strategy: { size: (chunk: Buffer) => chunk.length },
      }) as ReadableStream<Uint8Array>;

      return { body: stream, bytes };
    } catch (error) {
      await cleanup();
      throw new ApplicationError({
        status: 400,
        message: error instanceof Error ? error.message : 'The expansion file could not be patched.',
      });
    }
  };
}
