import { RuntimeContext } from '#src/context';
import { ApplicationError } from '#src/errors';
import type { CertificateMaterial } from '#src/repositories/certificate.repository';
import { CertificateRepository } from '#src/repositories/certificate.repository';
import { CryptoRepository } from '#src/repositories/crypto.repository';
import { Context, Effect, Layer } from 'effect';
import { resolve } from 'node:path';

/** Where the API listener's certificate comes from.

- `managed`: the server generated its own key, kept in storage.
- `legacy`: the zwift.com certificate bundled with the server. Its private key is public.
- `custom`: the files named by `tls.certFile` and `tls.keyFile`.
- `disabled`: the API listener serves plain HTTP (`network.api.useCert` is false).
*/
export type TlsMode = 'managed' | 'legacy' | 'custom' | 'disabled';

/** The certificate in use, and where it came from. */
interface TlsState {
  readonly mode: TlsMode;
  readonly material: CertificateMaterial | null;
}

/** The certificate facts the web app shows. Dates are ISO strings. */
export interface CertificateStatus {
  readonly fingerprint256: string;
  readonly thumbprint: string;
  readonly subject: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly hosts: readonly string[];
  /** The key algorithm and size, such as `ECDSA P-256`. */
  readonly key: string;
}

export interface TlsStatus {
  readonly mode: TlsMode;
  readonly certificate: CertificateStatus | null;
  /** The address a client's hosts file points the Zwift names at, unless the rider picks another. */
  readonly serverAddress: string;
  readonly lifetimeYears: number;
}

/** Warn this long before the certificate expires. */
const expiryWarningMs = 90 * 86_400_000;

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const { config } = context;
  const log = context.world.lifecycle.log;
  const certificates = new CertificateRepository();
  const crypto = new CryptoRepository();
  const path = resolve(config.storageDir, 'tls', 'zwift-server.pem');
  const listeners = new Set<(material: CertificateMaterial) => void>();

  function initial(): TlsState {
    if (!config.network.api.useCert) return { mode: 'disabled', material: null };

    if (config.tls.certFile)
      return { mode: 'custom', material: certificates.readFiles(config.tls.certFile, config.tls.keyFile) };
    const managed = certificates.read(path);

    if (managed) return { mode: 'managed', material: managed };
    const legacy = certificates.legacyFiles(context.assets);

    return { mode: 'legacy', material: certificates.readFiles(legacy.cert, legacy.key) };
  }

  let { mode, material } = initial();
  let rotating: Promise<void> | null = null;
  let lastOperation: string | null = null;

  const facts = () => (material ? crypto.certificateFacts(material.cert) : null);

  /** The subject's server ID of the current managed certificate, so rotation keeps it. */
  function serverId() {
    const current = mode === 'managed' ? /OU=Zluggish server ([\da-f]+)/.exec(facts()?.subject ?? '')?.[1] : null;

    return current ?? crypto.randomBytes(6).toString('hex');
  }

  async function generate() {
    const created = await certificates.create({
      serverId: serverId(),
      years: config.tls.lifetimeYears,
      now: new Date(),
    });

    await certificates.write(path, created);
    const previous = mode === 'managed' ? facts()?.fingerprint256 : undefined;
    mode = 'managed';
    material = created;

    for (const listener of listeners) listener(created);

    return { previous, fingerprint: facts()!.fingerprint256 };
  }

  function status(): TlsStatus {
    const current = facts();

    return {
      mode,
      certificate: current && {
        fingerprint256: current.fingerprint256,
        thumbprint: current.thumbprint,
        subject: current.subject,
        notBefore: current.notBefore.toISOString(),
        notAfter: current.notAfter.toISOString(),
        hosts: current.hosts,
        key: current.key,
      },
      serverAddress: config.server.advertisedIp,
      lifetimeYears: config.tls.lifetimeYears,
    };
  }

  function warnLegacy() {
    log.warn(
      'tls.legacy_certificate',
      'The Zwift API uses the shared zwift.com certificate. Its private key is public, so anyone on the network can read and change Zwift traffic, passwords included. Generate a server certificate in the web app under Manage → Server, then install it on every client.',
    );
  }

  function checkExpiry() {
    const current = facts();

    if (!current) return;
    const left = current.notAfter.getTime() - Date.now();
    const fields = { mode, notAfter: current.notAfter.toISOString(), fingerprint: current.fingerprint256 };

    if (left <= 0) log.error('tls.certificate_expired', 'The Zwift API certificate has expired', fields);
    else if (left < expiryWarningMs)
      log.warn(
        'tls.certificate_expiring',
        'The Zwift API certificate expires soon. Rotate it and reinstall it on every client.',
        fields,
      );
  }

  return {
    /** The current key and certificate, or null when the API listener serves plain HTTP. */
    material: () => material,
    mode: () => mode,
    status: Effect.fn('TlsService.status')(function* () {
      return status();
    }),
    /** Calls `listener` with each new key and certificate. Returns the function that stops it. */
    subscribe: (listener: (material: CertificateMaterial) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    /** Startup: a server with no riders yet generates its own certificate; a legacy one only warns. */
    start: Effect.fn('TlsService.start')(function* () {
      if (mode === 'legacy' && context.accounts.list().length === 0) {
        const { fingerprint } = yield* Effect.promise(generate);
        log.info('tls.generated', 'Generated a server certificate for the Zwift API', { fingerprint, path });
      }

      if (mode === 'legacy') warnLegacy();
      checkExpiry();
    }),
    /** Replace the managed key and certificate, or move a legacy server to a managed one. */
    rotate: Effect.fn('TlsService.rotate')(function* (operation: string) {
      if (mode === 'custom' || mode === 'disabled')
        throw new ApplicationError({
          status: 409,
          message:
            mode === 'custom'
              ? 'This server uses the certificate files from its configuration. Replace those files to change it.'
              : 'The Zwift API serves plain HTTP on this server, so it has no certificate.',
        });

      // A retried request, or a second click while the key is generated, rotates once.
      if (operation !== lastOperation) {
        rotating ??= generate()
          .then(({ previous, fingerprint }) => {
            log.info(
              'tls.rotated',
              'Rotated the Zwift API certificate. Install it again on every client.',
              previous ? { fingerprint, previous } : { fingerprint },
            );
          })
          .finally(() => {
            rotating = null;
          });
        const pending = rotating;
        yield* Effect.promise(() => pending);
        lastOperation = operation;
      }

      return status();
    }),
  };
});

/** The API listener's TLS certificate: which one, its facts, and rotation. */
export class TlsService extends Context.Service<TlsService, Effect.Success<typeof make>>()('zluggish/TlsService') {
  static readonly layer = Layer.effect(TlsService, make);
}
