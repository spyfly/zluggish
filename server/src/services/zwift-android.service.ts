import { ApplicationError } from '#src/errors';
import { ApkRepository } from '#src/repositories/apk.repository';
import { RuntimeContext } from '#src/context';
import { CryptoRepository } from '#src/repositories/crypto.repository';
import { AssetFiles } from '#src/repositories/files.repository';
import { Context, Effect, Layer } from 'effect';
import { resolve } from 'node:path';

export const zwiftAndroidUploadLimit = 10_000_000_000;
export const zwiftAndroidChunkSize = 16 * 1024 ** 2;
const zwiftObbLimit = 2 * 1024 ** 3;
const obbName = /^main\.\d{1,12}\.com\.zwift\.zwiftgame\.obb$/;

interface Upload {
  id: string;
  owner: string;
  name: string;
  size: number;
  offset: number;
  workspace: string;
  state: 'uploading' | 'patching' | 'done' | 'failed';
  message?: string;
}

function uploadLimit(name: string) {
  if (/\.apkm$/i.test(name)) {
    return zwiftAndroidUploadLimit;
  }
  if (obbName.test(name)) {
    return zwiftObbLimit;
  }
  throw new ApplicationError({ status: 400, message: 'Choose a Zwift .obb file or an .apkm bundle with an OBB.' });
}

function fail(error: unknown) {
  return error instanceof Error ? error.message : 'The expansion file could not be patched.';
}

const make = Effect.gen(function* () {
  const { config, world } = yield* RuntimeContext;
  const apk = new ApkRepository();
  const files = new AssetFiles();
  const crypto = new CryptoRepository();
  const staging = resolve(config.storageDir, 'zwift-android', 'staging');
  let busy = false;
  let upload: Upload | undefined;
  let writing = false;
  let stagingReady = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  async function workspace() {
    if (!stagingReady) {
      await apk.removeTree(staging);
      stagingReady = true;
    }

    return apk.workspace(staging);
  }

  function current(owner: string, id: string) {
    if (!upload || upload.owner !== owner || upload.id !== id) {
      throw new ApplicationError({ status: 404, message: 'The Android upload has expired or was cancelled.' });
    }

    return upload;
  }

  function status(session: Upload) {
    return { id: session.id, offset: session.offset, state: session.state, message: session.message };
  }

  function reportCleanupFailure(error: unknown) {
    world.lifecycle.log.warn('android.upload_cleanup_failed', 'Could not remove staged Android upload', {
      error: fail(error),
    });
  }

  function expire(session: Upload) {
    clearTimeout(expiry);
    expiry = setTimeout(
      () => {
        if (upload !== session) {
          return;
        }
        if (writing || session.state === 'patching') {
          expire(session);
          return;
        }
        upload = undefined;
        void apk.removeTree(session.workspace).catch(reportCleanupFailure);
      },
      30 * 60 * 1000,
    );
    expiry.unref();
  }

  // Only offer files built for the active certificate.
  const folder = (pem: string) => resolve(config.storageDir, 'zwift-android', crypto.sha256(pem));
  const pathFor = (pem: string, name: string) => {
    if (!obbName.test(name)) {
      throw new ApplicationError({ status: 400, message: 'Choose the original main Zwift expansion filename.' });
    }

    return resolve(folder(pem), name);
  };

  async function patch(workspace: string, pem: string, name: string, signal: AbortSignal) {
    const apkm = /\.apkm$/i.test(name);
    const input = resolve(workspace, 'original.obb');
    const output = resolve(workspace, 'patched.obb');
    const source = resolve(workspace, 'upload');
    const filename = apkm ? await apk.extractZwiftObb(source, input, zwiftObbLimit, signal) : name;

    if (apkm) {
      await files.removeAsync(source);
    }
    signal.throwIfAborted();
    await apk.patchZwiftObb(apkm ? input : source, output, pem);
    signal.throwIfAborted();
    await apk.publish(output, pathFor(pem, filename));
  }

  async function finish(session: Upload, pem: string) {
    try {
      await patch(session.workspace, pem, session.name, new AbortController().signal);
      session.state = 'done';
    } catch (error) {
      session.message = fail(error);
      session.state = 'failed';
    } finally {
      await apk.removeTree(session.workspace).catch(reportCleanupFailure);
      busy = false;
      expire(session);
    }
  }

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
    async begin(owner: string, name: string, size: number) {
      const limit = uploadLimit(name);
      if (!Number.isSafeInteger(size) || size < 1 || size > limit) {
        throw new ApplicationError({ status: 400, message: 'The expansion upload size is invalid.' });
      }
      if (busy || writing || upload?.state === 'uploading') {
        throw new ApplicationError({ status: 409, message: 'An Android upload or patch is already in progress.' });
      }

      writing = true;
      try {
        upload = {
          id: crypto.randomUUID(),
          owner,
          name,
          size,
          offset: 0,
          workspace: await workspace(),
          state: 'uploading',
        };
        expire(upload);

        return status(upload);
      } finally {
        writing = false;
      }
    },
    status(owner: string, id: string) {
      return status(current(owner, id));
    },
    async cancel(owner: string, id: string) {
      const session = current(owner, id);
      if (writing || session.state !== 'uploading') {
        throw new ApplicationError({ status: 409, message: 'The upload cannot be cancelled right now.' });
      }
      clearTimeout(expiry);
      upload = undefined;
      await apk.removeTree(session.workspace);
    },
    async chunk(owner: string, id: string, offset: number, body: ReadableStream<Uint8Array>, pem: string) {
      const session = current(owner, id);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > session.offset || writing) {
        throw new ApplicationError({ status: 409, message: 'The upload offset has changed. Retry the chunk.' });
      }
      if (offset < session.offset || session.state !== 'uploading') {
        return status(session);
      }

      writing = true;
      const file = resolve(session.workspace, 'chunk');
      try {
        const expected = Math.min(zwiftAndroidChunkSize, session.size - offset);
        const bytes = await apk.receive(body, file, expected);
        if (bytes !== expected) {
          throw new Error('The upload chunk is incomplete.');
        }
        await apk.appendUpload(resolve(session.workspace, 'upload'), file, offset);
        session.offset += bytes;
      } catch (error) {
        throw new ApplicationError({ status: 400, message: fail(error) });
      } finally {
        try {
          await files.removeAsync(file);
        } finally {
          writing = false;
          if (session.offset === session.size && session.state === 'uploading') {
            session.state = 'patching';
            busy = true;
            void finish(session, pem);
          } else {
            expire(session);
          }
        }
      }

      return status(session);
    },
    async publish(body: ReadableStream<Uint8Array>, pem: string, name: string, signal: AbortSignal) {
      const limit = uploadLimit(name);
      if (busy || writing || upload?.state === 'uploading') {
        throw new ApplicationError({
          status: 409,
          message: 'Another Android expansion file is being processed. Try again shortly.',
        });
      }

      busy = true;
      let directory: string | undefined;
      try {
        directory = await workspace();
        await apk.receive(body, resolve(directory, 'upload'), limit);
        await patch(directory, pem, name, signal);
      } catch (error) {
        throw new ApplicationError({ status: 400, message: fail(error) });
      } finally {
        try {
          if (directory) {
            await apk.removeTree(directory);
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
