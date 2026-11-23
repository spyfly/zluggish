import { RuntimeContext } from '#src/context';
import { ApplicationError } from '#src/errors';
import type { ApkSigner, ApkUpload } from '#src/repositories/apk.repository';
import { ApkRepository, originalCompanionPackage, standaloneCompanionPackage } from '#src/repositories/apk.repository';
import type { CertificateMaterial } from '#src/repositories/certificate.repository';
import { CertificateRepository } from '#src/repositories/certificate.repository';
import { CryptoRepository } from '#src/repositories/crypto.repository';
import { AssetFiles } from '#src/repositories/files.repository';
import type { ToolchainState } from '#src/repositories/toolchain.repository';
import { ToolchainRepository } from '#src/repositories/toolchain.repository';
import { TlsService } from '#src/services/tls.service';
import { Context, Effect, Layer, Schema } from 'effect';
import { dirname, resolve } from 'node:path';

/** The raw resource a rebuilt app reads the server certificate from. */
const certificateResource = 'zluggish_server_cert';

/** The largest upload: Companion is about 180 MB, a bundle of splits a little more. */
export const companionUploadLimit = 1_000_000_000;

export type CompanionStep =
  | 'runtime'
  | 'editor'
  | 'inspect'
  | 'merge'
  | 'decode'
  | 'patch'
  | 'build'
  | 'sign'
  | 'publish';

export interface CompanionActivity {
  readonly kind: 'toolchain' | 'patch' | 'rekey';
  /** `waiting`: an upload needs the Java tools, and holds until the administrator downloads them or discards it. */
  readonly state: 'running' | 'waiting' | 'done' | 'failed';
  readonly steps: ReadonlyArray<CompanionStep>;
  readonly step: CompanionStep;
  readonly progress: number | null;
  readonly message: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** The patched app on this server, as companion.json in storage records it.

`packageName` identifies builds that can be installed alongside the Play Store app. Older builds need a new upload.
`certificate` is the SHA-256 fingerprint of the server certificate the app trusts. `method` is `rekey` when the
upload already trusted a certificate, which was swapped, and `rebuild` when its resources were rebuilt.
*/
const publishedSchema = Schema.Struct({
  packageName: Schema.Literal(standaloneCompanionPackage),
  versionName: Schema.String,
  versionCode: Schema.Finite,
  bytes: Schema.Finite,
  createdAt: Schema.String,
  certificate: Schema.String,
  method: Schema.Literals(['rekey', 'rebuild']),
});

type Published = typeof publishedSchema.Type;

/** What every rider sees: whether there is an app to download, and for which certificate. */
export interface CompanionStatus {
  readonly app: {
    readonly versionName: string;
    readonly versionCode: number;
    readonly bytes: number;
    readonly createdAt: string;
    /** False when the server certificate changed since, and the app no longer connects until it is patched again. */
    readonly current: boolean;
  } | null;
  readonly tlsMode: 'managed' | 'legacy' | 'custom' | 'disabled';
  readonly serverAddress: string;
}

export interface CompanionAdminStatus extends CompanionStatus {
  readonly toolchain: ToolchainState & { readonly folder: string };
  readonly activity: CompanionActivity | null;
  readonly pending: boolean;
  readonly uploadLimit: number;
}

/** What an upload needs: the certificate entries to swap, or none when its resources must be rebuilt. */
interface Plan {
  readonly upload: Exclude<ApkUpload, { kind: 'unknown' }>;
  readonly rekey: ReadonlyArray<string>;
}

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const tls = yield* TlsService;
  const log = context.world.lifecycle.log;
  const apk = new ApkRepository();
  const crypto = new CryptoRepository();
  const certificates = new CertificateRepository();
  const files = new AssetFiles();
  const folder = resolve(context.config.storageDir, 'companion');
  const appPath = resolve(folder, 'zwift-companion.apk');
  const metaPath = resolve(folder, 'companion.json');
  const signerPath = resolve(folder, 'signer.pem');
  // A cache beside storage, like backups: storage holds data only, and the tools can be downloaded again.
  const toolchain = new ToolchainRepository(resolve(dirname(context.config.storageDir), 'tools'));

  let activity: CompanionActivity | null = null;
  let abort: AbortController | null = null;
  let rekeyAfter = false;

  /** An upload that needs the Java tools, kept until they are downloaded or the administrator discards it. */
  let pending: { path: string; workspace: string; plan: Plan } | null = null;

  async function published(): Promise<Published | null> {
    const text = await files.readAsync(metaPath);

    if (!text || (await apk.size(appPath)) === null) {
      return null;
    }

    try {
      return Schema.decodeUnknownSync(publishedSchema)(JSON.parse(text.toString('utf8')));
    } catch {
      return null;
    }
  }

  /** The certificate a patched app should trust: the first certificate the API listener presents. */
  function serverCertificate() {
    const mode = tls.mode();
    const material = tls.material();

    if (mode === 'legacy') {
      throw new ApplicationError({
        status: 409,
        message: 'Replace the shared Zwift certificate before building the Companion app.',
      });
    }

    if (mode === 'disabled' || !material) {
      throw new ApplicationError({
        status: 409,
        message: 'The Zwift API serves plain HTTP on this server, so there is no certificate for the app to trust.',
      });
    }

    const pem = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(material.cert)?.[0];
    if (!pem) {
      throw new ApplicationError({ status: 409, message: 'The server certificate contains no PEM certificate.' });
    }

    return { pem: pem + '\n', fingerprint: crypto.certificateFacts(pem).fingerprint256 };
  }

  /** The key that signs every app this server builds, made on first use. Android updates an app only when the
  signature matches, so losing it means every rider uninstalls once. It lives in storage and in backups.
  */
  async function signer(): Promise<ApkSigner> {
    let material: CertificateMaterial | null = certificates.read(signerPath);

    if (!material) {
      material = await certificates.createApkSigner({
        serverId: crypto.randomBytes(6).toString('hex'),
        years: 50,
        now: new Date(),
      });
      await certificates.write(signerPath, material);
      log.info('companion.signer_created', 'Created the key that signs the Zwift Companion app', { path: signerPath });
    }

    return {
      key: material.key,
      certificate: Buffer.from(material.cert.replaceAll(/-----[A-Z ]+-----|\s/g, ''), 'base64'),
      publicKey: crypto.certificatePublicKey(material.cert),
    };
  }

  async function status(): Promise<CompanionStatus> {
    const app = await published();
    let fingerprint: string | null;

    try {
      fingerprint = serverCertificate().fingerprint;
    } catch {
      fingerprint = null;
    }

    return {
      app: app && {
        versionName: app.versionName,
        versionCode: app.versionCode,
        bytes: app.bytes,
        createdAt: app.createdAt,
        current: app.certificate === fingerprint,
      },
      tlsMode: tls.mode(),
      serverAddress: context.config.server.advertisedIp,
    };
  }

  async function adminStatus(): Promise<CompanionAdminStatus> {
    return {
      ...(await status()),
      toolchain: { ...(await toolchain.state()), folder: toolchain.folder },
      activity,
      pending: pending !== null,
      uploadLimit: companionUploadLimit,
    };
  }

  function begin(kind: CompanionActivity['kind'], steps: ReadonlyArray<CompanionStep>) {
    if (activity?.state === 'running') {
      throw new ApplicationError({ status: 409, message: 'Wait for the current Companion job to finish.' });
    }
    const step = steps[0];
    if (!step) {
      throw new Error('A Companion job needs at least one step.');
    }
    abort = new AbortController();
    activity = {
      kind,
      state: 'running',
      steps,
      step,
      progress: null,
      message: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    return abort.signal;
  }

  function advance(step: CompanionStep, progress: number | null = null) {
    if (activity) {
      activity = { ...activity, step, progress };
    }
  }

  function finish(failure?: string) {
    if (!activity) {
      return;
    }

    activity = {
      ...activity,
      state: failure === undefined ? 'done' : 'failed',
      progress: null,
      message: failure ?? null,
      finishedAt: new Date().toISOString(),
    };
    abort = null;

    if (!rekeyAfter) {
      return;
    }

    rekeyAfter = false;
    void rekeyPublished();
  }

  /** Sign `input` into place as the published app, with the certificate entries replaced. */
  async function sign(input: string, certificatesIn: ReadonlyArray<string>, pem: string, workspace: string) {
    const output = resolve(workspace, 'signed.apk');
    const replace = new Map(certificatesIn.map((name) => [name, Buffer.from(pem, 'utf8')]));

    await apk.rewrite(input, output, await signer(), { replace });

    const trusted = await apk.trustedCertificates(output);

    if (trusted.length === 0) {
      throw new Error('The rebuilt app does not hold the server certificate.');
    }

    return output;
  }

  async function publish(output: string, fingerprint: string, method: Published['method']) {
    const manifest = await apk.manifest(output);
    if (manifest.packageName !== standaloneCompanionPackage) {
      throw new Error(`Expected the patched Companion app to use ${standaloneCompanionPackage}.`);
    }

    advance('publish');
    await apk.publish(output, appPath);

    const record: Published = {
      packageName: manifest.packageName,
      versionName: manifest.versionName,
      versionCode: manifest.versionCode,
      bytes: (await apk.size(appPath)) ?? 0,
      createdAt: new Date().toISOString(),
      certificate: fingerprint,
      method,
    };

    await files.writeDurableAsync(metaPath, JSON.stringify(record, null, 2), true);
    log.info('companion.published', 'Published a Zwift Companion app for this server', {
      version: record.versionName,
      method,
      fingerprint,
    });
  }

  /** Check what was uploaded before the job starts, so the administrator hears about a wrong file at once. */
  async function inspect(path: string): Promise<Plan> {
    const upload = await apk.inspect(path);

    if (upload.kind === 'unknown') {
      throw new ApplicationError({ status: 400, message: 'This is not an APK, APKS, XAPK or APKM file.' });
    }

    if (upload.kind === 'bundle') {
      return { upload, rekey: [] };
    }
    const manifest = await apk.manifest(path);

    if (manifest.packageName !== originalCompanionPackage && manifest.packageName !== standaloneCompanionPackage) {
      throw new ApplicationError({
        status: 400,
        message: `This APK is ${manifest.packageName || 'an unknown app'}, not Zwift Companion.`,
      });
    }

    if (manifest.minSdk < 24) {
      throw new ApplicationError({ status: 400, message: 'This Companion version is too old. Upload a newer one.' });
    }

    if (manifest.packageName === originalCompanionPackage) {
      return { upload, rekey: [] };
    }
    const rekey = await apk.trustedCertificates(path);

    if (rekey.length === 0) {
      throw new ApplicationError({ status: 400, message: 'This patched Companion APK is missing its certificate.' });
    }

    return { upload, rekey };
  }

  function stepsFor(plan: Plan): Array<CompanionStep> {
    if (plan.rekey.length > 0) {
      return ['inspect', 'sign', 'publish'];
    }

    return [
      'inspect',
      ...(plan.upload.kind === 'bundle' ? (['merge'] as const) : []),
      'decode',
      'patch',
      'build',
      'sign',
      'publish',
    ];
  }

  function start(job: { path: string; workspace: string; plan: Plan }) {
    const signal = begin('patch', stepsFor(job.plan));
    void patch(job.path, job.workspace, job.plan, signal);
  }

  async function discardPending() {
    const held = pending;
    pending = null;

    if (activity?.state === 'waiting') {
      activity = null;
    }

    if (held) {
      await apk.removeTree(held.workspace);
    }
  }

  async function patch(path: string, workspace: string, plan: Plan, signal: AbortSignal) {
    try {
      const { pem, fingerprint } = serverCertificate();

      if (plan.rekey.length > 0) {
        advance('sign');
        const output = await sign(path, plan.rekey, pem, workspace);
        await publish(output, fingerprint, 'rekey');
        finish();

        return;
      }

      const tools = await toolchain.state();

      if (!tools.java || !tools.editor) {
        throw new Error('The Java tools are no longer installed. Upload the app again.');
      }

      let source = path;

      if (plan.upload.kind === 'bundle') {
        advance('merge');
        const splits = resolve(workspace, 'splits');
        await apk.extractApks(path, splits);
        source = resolve(workspace, 'merged.apk');
        await toolchain.editor(['m', '-i', splits, '-o', source, '-f'], { cwd: workspace, signal });
        const merged = await apk.manifest(source);

        if (merged.packageName !== originalCompanionPackage) {
          throw new Error(`The bundle holds ${merged.packageName || 'an unknown app'}, not Zwift Companion.`);
        }

        if (merged.minSdk < 24) {
          throw new Error('This Companion version is too old. Upload a newer one.');
        }
      }

      advance('decode');
      const decoded = resolve(workspace, 'decoded');
      await toolchain.editor(['d', '-i', source, '-o', decoded, '-f'], { cwd: workspace, signal });
      advance('patch');
      await apk.patchDecoded(decoded, pem, certificateResource);
      advance('build');
      const built = resolve(workspace, 'built.apk');
      await toolchain.editor(['b', '-i', decoded, '-o', built, '-f'], { cwd: workspace, signal });
      advance('sign');
      const output = await sign(built, [], pem, workspace);
      await publish(output, fingerprint, 'rebuild');
      finish();
    } catch (error) {
      log.warn('companion.patch_failed', 'Patching the Zwift Companion app failed', {
        error: error instanceof Error ? error : String(error),
      });
      finish(error instanceof Error ? error.message : String(error));
    } finally {
      await apk.removeTree(workspace);
    }
  }

  /** Swap the certificate in the published app for the current one, as after a rotation. Needs no Java. */
  async function rekeyPublished() {
    const app = await published();

    if (!app) {
      return;
    }

    if (activity?.state === 'running') {
      rekeyAfter = true;

      return;
    }

    let current: { pem: string; fingerprint: string };

    try {
      current = serverCertificate();
    } catch {
      return;
    }

    if (app.certificate === current.fingerprint) {
      return;
    }
    begin('rekey', ['sign', 'publish']);
    const workspace = await apk.workspace();

    try {
      const inside = await apk.trustedCertificates(appPath);
      const output = await sign(appPath, inside, current.pem, workspace);
      await publish(output, current.fingerprint, app.method);
      finish();
    } catch (error) {
      log.warn('companion.rekey_failed', 'Updating the certificate in the Zwift Companion app failed', {
        error: error instanceof Error ? error : String(error),
      });
      finish(error instanceof Error ? error.message : String(error));
    } finally {
      await apk.removeTree(workspace);
    }
  }

  tls.subscribe(() => {
    void rekeyPublished();
  });

  return {
    status: Effect.fn('CompanionService.status')(function* () {
      return yield* Effect.promise(status);
    }),
    adminStatus: Effect.fn('CompanionService.adminStatus')(function* () {
      return yield* Effect.promise(adminStatus);
    }),
    download: Effect.fn('CompanionService.download')(function* () {
      const app = yield* Effect.promise(published);

      return app
        ? { path: appPath, filename: `zwift-companion-${app.versionName.replaceAll(/[^\w.-]/g, '')}-zluggish.apk` }
        : null;
    }),
    /** Receive an upload and start patching it. Resolves once the file is checked; the job runs on. An upload that
    needs the Java tools waits for them instead: the server never downloads them unasked.
    */
    upload: Effect.fn('CompanionService.upload')(function* (body: ReadableStream<Uint8Array>) {
      if (activity?.state === 'running') {
        throw new ApplicationError({ status: 409, message: 'Wait for the current Companion job to finish.' });
      }
      serverCertificate();
      yield* Effect.promise(discardPending);

      const workspace = yield* Effect.promise(() => apk.workspace());
      const path = resolve(workspace, 'upload');

      const plan = yield* Effect.promise(async () => {
        try {
          await apk.receive(body, path, companionUploadLimit);

          return await inspect(path);
        } catch (error) {
          await apk.removeTree(workspace);

          throw error instanceof ApplicationError
            ? error
            : new ApplicationError({
                status: 400,
                message: error instanceof Error ? error.message : 'The upload failed.',
              });
        }
      });

      const tools = yield* Effect.promise(() => toolchain.state());

      if (plan.rekey.length === 0 && (!tools.java || !tools.editor)) {
        pending = { path, workspace, plan };
        activity = {
          kind: 'patch',
          state: 'waiting',
          steps: stepsFor(plan),
          step: 'decode',
          progress: null,
          message: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        };
      } else {
        start({ path, workspace, plan });
      }

      return yield* Effect.promise(adminStatus);
    }),
    remove: Effect.fn('CompanionService.remove')(function* () {
      if (activity?.state === 'running') {
        throw new ApplicationError({ status: 409, message: 'Wait for the current Companion job to finish.' });
      }
      yield* Effect.promise(async () => {
        await files.removeAsync(appPath);
        await files.removeAsync(metaPath);
      });
      log.info('companion.removed', 'Removed the Zwift Companion app from this server');

      return yield* Effect.promise(adminStatus);
    }),
    installToolchain: Effect.fn('CompanionService.installToolchain')(function* () {
      const signal = begin('toolchain', ['runtime', 'editor']);

      void (async () => {
        try {
          await toolchain.install(signal, (step, fraction) => advance(step, fraction));
          log.info('companion.toolchain_installed', 'Downloaded the Java tools for the Zwift Companion app', {
            folder: toolchain.folder,
          });
          finish();

          // The upload that asked for the tools continues on its own.
          const held = pending;
          pending = null;

          if (held) {
            start(held);
          }
        } catch (error) {
          log.warn('companion.toolchain_failed', 'Downloading the Java tools failed', {
            error: error instanceof Error ? error : String(error),
          });
          finish(error instanceof Error ? error.message : String(error));
        }
      })();

      return yield* Effect.promise(adminStatus);
    }),
    discard: Effect.fn('CompanionService.discard')(function* () {
      if (activity?.state === 'running' && activity.kind !== 'toolchain') {
        throw new ApplicationError({ status: 409, message: 'Wait for the current Companion job to finish.' });
      }
      yield* Effect.promise(discardPending);

      return yield* Effect.promise(adminStatus);
    }),
    removeToolchain: Effect.fn('CompanionService.removeToolchain')(function* () {
      if (activity?.state === 'running') {
        throw new ApplicationError({ status: 409, message: 'Wait for the current Companion job to finish.' });
      }
      yield* Effect.promise(() => toolchain.remove());
      activity = null;
      log.info('companion.toolchain_removed', 'Removed the Java tools', { folder: toolchain.folder });

      return yield* Effect.promise(adminStatus);
    }),
    cancel: Effect.fn('CompanionService.cancel')(function* () {
      abort?.abort(new Error('Stopped by the administrator.'));

      return yield* Effect.promise(adminStatus);
    }),
  };
});

export class CompanionService extends Context.Service<CompanionService, Effect.Success<typeof make>>()(
  'zluggish/CompanionService',
) {
  static readonly layer = Layer.effect(CompanionService, make);
}
