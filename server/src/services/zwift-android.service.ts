import { ApplicationError } from '#src/errors';
import { ApkRepository } from '#src/repositories/apk.repository';
import { RuntimeContext } from '#src/context';
import { CryptoRepository } from '#src/repositories/crypto.repository';
import { AssetFiles } from '#src/repositories/files.repository';
import { Context, Effect, Layer } from 'effect';
import { resolve } from 'node:path';

export const zwiftObbLimit = 2 * 1024 ** 3;
const obbName = /^main\.\d{1,12}\.com\.zwift\.zwiftgame\.obb$/;

const make = Effect.gen(function* () {
  const { config } = yield* RuntimeContext;
  const apk = new ApkRepository();
  const files = new AssetFiles();
  const crypto = new CryptoRepository();
  let busy = false;

  // Only offer files built for the active certificate.
  const folder = (pem: string) => resolve(config.storageDir, 'zwift-android', crypto.sha256(pem));
  const pathFor = (pem: string, name: string) => {
    if (!obbName.test(name)) {
      throw new ApplicationError({ status: 400, message: 'Choose the original main Zwift expansion filename.' });
    }

    return resolve(folder(pem), name);
  };

  return {
    async list(pem: string) {
      const entries = await files.entriesAsync(folder(pem));

      return entries
        .filter((entry) => entry.isFile() && obbName.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    },
    async download(pem: string, name: string) {
      const path = pathFor(pem, name);

      return (await apk.size(path)) === null ? null : path;
    },
    async publish(body: ReadableStream<Uint8Array>, pem: string, name: string, signal: AbortSignal) {
      const apkm = /\.apkm$/i.test(name);

      if (!apkm && !obbName.test(name)) {
        throw new ApplicationError({
          status: 400,
          message: 'Choose a Zwift .obb file or an .apkm bundle with an OBB.',
        });
      }

      if (busy) {
        throw new ApplicationError({
          status: 409,
          message: 'Another Android expansion file is being processed. Try again shortly.',
        });
      }

      busy = true;
      let workspace: string | undefined;

      try {
        workspace = await apk.workspace();
        const input = resolve(workspace, 'original.obb');
        const output = resolve(workspace, 'patched.obb');
        const upload = resolve(workspace, 'upload');
        await apk.receive(body, upload, zwiftObbLimit);
        const filename = apkm ? await apk.extractZwiftObb(upload, input, zwiftObbLimit, signal) : name;
        signal.throwIfAborted();
        await apk.patchZwiftObb(apkm ? input : upload, output, pem);
        signal.throwIfAborted();
        await apk.publish(output, pathFor(pem, filename));
      } catch (error) {
        throw new ApplicationError({
          status: 400,
          message: error instanceof Error ? error.message : 'The expansion file could not be patched.',
        });
      } finally {
        try {
          if (workspace) {
            await apk.removeTree(workspace);
          }
        } finally {
          busy = false;
        }
      }
    },
  };
});

export class ZwiftAndroidService extends Context.Service<ZwiftAndroidService, Effect.Success<typeof make>>()(
  'zluggish/ZwiftAndroidService',
) {
  static readonly layer = Layer.effect(ZwiftAndroidService, make);
}
