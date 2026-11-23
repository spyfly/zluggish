import { ApplicationError } from '#src/errors';
import type { ApkSigner } from '#src/repositories/apk.repository';
import { ApkRepository, standaloneZwiftPackage } from '#src/repositories/apk.repository';
import { CertificateRepository } from '#src/repositories/certificate.repository';
import { ToolchainRepository } from '#src/repositories/toolchain.repository';
import { RuntimeContext } from '#src/context';
import { CryptoRepository } from '#src/repositories/crypto.repository';
import { AssetFiles } from '#src/repositories/files.repository';
import { Context, Effect, Layer } from 'effect';
import { resolve } from 'node:path';

export const zwiftAndroidUploadLimit = 10_000_000_000;
export const zwiftAndroidChunkSize = 16 * 1024 ** 2;
const zwiftObbLimit = 2 * 1024 ** 3;
const apkName = /^zwift-\d{1,12}-zluggish\.apk$/;
const xapkName = /^zwift-\d{1,12}-zluggish\.xapk$/;
const originalId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const obbName = /^main\.\d{1,12}\.com\.zwift\.zwiftgame\.obb$/;

interface Upload {
  id: string;
  owner: string;
  name: string;
  size: number;
  offset: number;
  workspace: string;
  standalone: boolean;
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
  const log = world.lifecycle.log;
  const apk = new ApkRepository();
  const files = new AssetFiles();
  const crypto = new CryptoRepository();
  const androidFolder = resolve(config.storageDir, 'zwift-android');
  const staging = resolve(androidFolder, 'staging');
  const originalsFolder = resolve(androidFolder, 'originals');
  const signerPath = resolve(androidFolder, 'signer.pem');
  const certificates = new CertificateRepository();
  const toolchain = new ToolchainRepository(resolve(androidFolder, 'tools'));
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

  async function keepOriginal(directory: string, id: string, name: string) {
    const retained = resolve(originalsFolder, id);
    await files.writeDurableAsync(resolve(directory, 'name'), name);
    await apk.retainUpload(directory, retained);
    await files.syncDirectoryAsync(originalsFolder);
    await files.syncDirectoryAsync(androidFolder);
    log.info('android.original_retained', 'Saved the original Zwift Android upload', { upload: name, id });

    return resolve(retained, 'upload');
  }

  async function readOriginal(id: string) {
    if (!originalId.test(id)) {
      return null;
    }

    const directory = resolve(originalsFolder, id);
    const name = await files.readAsync(resolve(directory, 'name'));
    const info = await files.statAsync(resolve(directory, 'upload'));

    if (!name || !info || info.directory) {
      return null;
    }

    return { id, name: name.toString('utf8'), bytes: info.bytes, uploadedAt: info.modified };
  }

  function requireIdle() {
    if (busy || writing || upload?.state === 'uploading') {
      throw new ApplicationError({ status: 409, message: 'An Android upload or patch is already in progress.' });
    }
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
    log.warn('android.upload_cleanup_failed', 'Could not remove staged Android upload', {
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
    if (!obbName.test(name) && !xapkName.test(name) && !apkName.test(name)) {
      throw new ApplicationError({ status: 400, message: 'The Zwift download filename is invalid.' });
    }

    return resolve(folder(pem), name);
  };

  async function signingKey(): Promise<ApkSigner> {
    let material = certificates.read(signerPath);
    if (!material) {
      material = await certificates.createApkSigner({
        serverId: crypto.randomBytes(6).toString('hex'),
        years: 50,
        now: new Date(),
      });
      await certificates.write(signerPath, material);
    }

    return {
      key: material.key,
      certificate: Buffer.from(material.cert.replaceAll(/-----[A-Z ]+-----|\s/g, ''), 'base64'),
      publicKey: crypto.certificatePublicKey(material.cert),
    };
  }

  async function standaloneApk(
    source: string,
    expansion: string,
    filename: string,
    directory: string,
    signal: AbortSignal,
  ) {
    const versionCode = Number(filename.split('.', 2)[1]);
    const splits = resolve(directory, 'splits');
    const parts = await apk.extractZwiftApks(source, splits, versionCode, signal);
    const [base] = parts;
    if (!base) {
      throw new Error('The APKM is missing the Zwift base APK.');
    }

    const tools = await toolchain.state();
    if (!tools.java || !tools.editor) {
      log.info('android.installing_tools', 'Installing the Java tools for the Zwift APK build');
      await toolchain.install(signal, (step, fraction) => {
        if (fraction === null) {
          log.info('android.toolchain_progress', 'Preparing Android build tools', { step });
        }
      });
    }

    const options = { cwd: directory, signal };
    let original = base;
    if (parts.length > 1) {
      original = resolve(directory, 'merged.apk');
      await toolchain.editor(['m', '-i', splits, '-o', original, '-f'], options);
    }
    const manifest = await apk.manifest(original);
    if (manifest.minSdk < 26) {
      throw new Error('The standalone APK needs a Zwift build for Android 8.0 or later.');
    }

    const decoded = resolve(directory, 'decoded');
    await toolchain.editor(['d', '-comment-level', 'off', '-i', original, '-o', decoded, '-f'], options);
    await apk.configureDecodedZwift(decoded, versionCode);
    await apk.configureZwiftPackageLookups(decoded);
    const rebuilt = resolve(directory, 'renamed.apk');
    await toolchain.editor(['b', '-i', decoded, '-o', rebuilt, '-f'], options);
    const renamed = await apk.manifest(rebuilt);
    if (renamed.packageName !== standaloneZwiftPackage || renamed.versionCode !== versionCode) {
      throw new Error('The rebuilt APK has an unexpected application ID or version.');
    }

    const output = resolve(directory, 'patched.apk');
    await apk.signStandaloneZwift(rebuilt, output, expansion, await signingKey());

    return { output, name: `zwift-${versionCode}-zluggish.apk` };
  }

  async function patch(
    workspace: string,
    source: string,
    pem: string,
    name: string,
    signal: AbortSignal,
    standalone = false,
  ) {
    const apkm = /\.apkm$/i.test(name);
    const input = resolve(workspace, 'original.obb');
    const output = resolve(workspace, 'patched.obb');
    const startedAt = performance.now();
    let filename = name;
    const steps = apkm ? 4 : 2;

    if (apkm) {
      log.info('android.extracting', 'Extracting the Zwift expansion from the APKM', {
        upload: name,
        step: 1,
        steps,
      });
      filename = await apk.extractZwiftObb(source, input, zwiftObbLimit, signal);
    }
    signal.throwIfAborted();

    const expansion = apkm ? input : source;
    const bytes = await apk.size(expansion);
    log.info('android.patching', 'Patching the Zwift expansion certificate', {
      filename,
      bytes,
      step: apkm ? 2 : 1,
      steps,
    });
    await apk.patchZwiftObb(expansion, output, pem);
    signal.throwIfAborted();

    let bundle: { output: string; name: string } | undefined;

    if (apkm) {
      await files.removeAsync(input);
      log.info(
        'android.bundling',
        standalone ? 'Building the standalone Zwift APK' : 'Building the Zwift Android install bundle',
        { filename, step: 3, steps },
      );
      if (standalone) {
        bundle = await standaloneApk(source, output, filename, workspace, signal);
      } else {
        const bundlePath = resolve(workspace, 'patched.xapk');
        const bundleName = await apk.bundleZwift(source, output, filename, bundlePath, signal);
        bundle = { output: bundlePath, name: bundleName };
      }
    }
    signal.throwIfAborted();
    log.info('android.publishing', 'Publishing the patched Zwift Android downloads', {
      filename,
      bundle: bundle?.name,
      step: steps,
      steps,
    });
    await apk.publish(output, pathFor(pem, filename));
    if (bundle) {
      await apk.publish(bundle.output, pathFor(pem, bundle.name));
    }
    log.info('android.published', 'Published the patched Zwift expansion', {
      filename,
      bundle: bundle?.name,
      bytes,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  async function finish(session: Upload, pem: string, retained?: string) {
    let directory = session.workspace;

    try {
      const source = retained ?? (await keepOriginal(directory, session.id, session.name));
      if (!retained) {
        directory = await workspace();
      }
      await patch(directory, source, pem, session.name, new AbortController().signal, session.standalone);
      session.state = 'done';
    } catch (error) {
      session.message = fail(error);
      log.warn('android.patch_failed', 'Could not patch the Zwift expansion', {
        upload: session.name,
        error: session.message,
      });
      session.state = 'failed';
    } finally {
      await apk.removeTree(directory).catch(reportCleanupFailure);
      busy = false;
      expire(session);
    }
  }

  return {
    async list(pem: string) {
      const entries = await files.entriesAsync(folder(pem));

      const names = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();

      return {
        files: names.filter((name) => obbName.test(name)),
        bundles: names.filter((name) => xapkName.test(name)),
        apks: names.filter((name) => apkName.test(name)),
      };
    },
    async download(pem: string, name: string) {
      const path = pathFor(pem, name);

      return (await apk.size(path)) === null ? null : path;
    },
    async originals() {
      const entries = await files.entriesAsync(originalsFolder);
      const saved = await Promise.all(
        entries
          .values()
          .filter((entry) => entry.isDirectory())
          .map((entry) => readOriginal(entry.name)),
      );

      return saved
        .values()
        .filter((entry) => entry !== null)
        .toArray()
        .sort((a, b) => b.uploadedAt - a.uploadedAt);
    },
    async rebuild(owner: string, id: string, pem: string, standalone: boolean) {
      requireIdle();
      busy = true;

      try {
        const original = await readOriginal(id);
        if (!original) {
          throw new ApplicationError({ status: 404, message: 'The original Zwift upload was not found.' });
        }
        uploadLimit(original.name);
        const session: Upload = {
          id: crypto.randomUUID(),
          owner,
          name: original.name,
          size: original.bytes,
          offset: original.bytes,
          workspace: await workspace(),
          standalone,
          state: 'patching',
        };
        upload = session;
        log.info('android.rebuild_started', 'Rebuilding Zwift from a saved original', { upload: original.name, id });
        void finish(session, pem, resolve(originalsFolder, original.id, 'upload'));

        return status(session);
      } catch (error) {
        busy = false;
        throw error;
      }
    },
    async begin(owner: string, name: string, size: number, standalone: boolean) {
      const limit = uploadLimit(name);
      if (!Number.isSafeInteger(size) || size < 1 || size > limit) {
        throw new ApplicationError({ status: 400, message: 'The expansion upload size is invalid.' });
      }
      requireIdle();

      writing = true;
      try {
        upload = {
          id: crypto.randomUUID(),
          owner,
          name,
          size,
          offset: 0,
          workspace: await workspace(),
          standalone,
          state: 'uploading',
        };
        expire(upload);
        log.info('android.upload_started', 'Receiving a Zwift Android upload', { upload: name, bytes: size });

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
        const percent = Math.floor((session.offset / session.size) * 100);

        if (Math.floor(percent / 10) > Math.floor((offset / session.size) * 10)) {
          log.info('android.upload_progress', 'Receiving a Zwift Android upload', {
            upload: session.name,
            receivedBytes: session.offset,
            totalBytes: session.size,
            percent,
          });
        }
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
      requireIdle();

      busy = true;
      let directory: string | undefined;
      try {
        directory = await workspace();
        const bytes = await apk.receive(body, resolve(directory, 'upload'), limit);
        log.info('android.upload_received', 'Received the Zwift Android upload', { upload: name, bytes });
        const source = await keepOriginal(directory, crypto.randomUUID(), name);
        directory = await workspace();
        await patch(directory, source, pem, name, signal);
      } catch (error) {
        log.warn('android.patch_failed', 'Could not process the Zwift Android upload', {
          upload: name,
          error: fail(error),
        });
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
