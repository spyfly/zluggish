<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { onMount } from 'svelte';
  import Fingerprint from '../components/Fingerprint.svelte';
  import { tlsStatus } from './tls';
  import type { TlsStatus } from './tls';
  import type { Api } from '../lib/api';

  type Confirmation = {
    title: string;
    detail: string;
    label: string;
    destructive: boolean;
    confirm: () => Promise<void>;
  };

  let {
    api,
    busy,
    confirm,
    done,
    onstatus,
  }: {
    api: Api;
    busy: boolean;
    confirm: (confirmation: Confirmation) => void;
    done: (message: string) => void;
    onstatus?: ((status: TlsStatus) => void) | undefined;
  } = $props();

  let status = $state<TlsStatus | null>(null);
  let failure = $state('');

  const sources = {
    managed: t('ServerCertificate.generated_by_this_server'),
    legacy: t('ServerCertificate.shared_zwift_certificate'),
    custom: t('ServerCertificate.certificate_files_from_the_configuration'),
  };

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  function relative(iso: string) {
    const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
    const format = new Intl.RelativeTimeFormat([], { numeric: 'auto' });

    if (Math.abs(days) >= 365) {
      return format.format(Math.trunc(days / 365), 'year');
    }

    if (Math.abs(days) >= 60) {
      return format.format(Math.trunc(days / 30), 'month');
    }

    return format.format(days, 'day');
  }

  const expiresSoon = $derived(
    !!status?.certificate && Date.parse(status.certificate.notAfter) - Date.now() < 90 * 86_400_000,
  );

  onMount(async () => {
    try {
      status = await api(tlsStatus, '/api/tls');
      onstatus?.(status);
    } catch (error) {
      failure = error instanceof Error ? error.message : t('ServerCertificate.the_certificate_could_not_be_loaded');
    }
  });

  function rotate() {
    const operation = crypto.randomUUID();

    confirm({
      title: t('ServerCertificate.rotate_the_server_certificate'),
      detail: t('ServerCertificate.the_new_certificate_takes_effect_at_once_zwift_stops'),
      label: t('ServerCertificate.rotate_certificate'),
      destructive: true,
      confirm: async () => {
        status = await api(tlsStatus, '/api/manage/server/certificate', 'POST', { operation });
        onstatus?.(status);
        done(t('ServerCertificate.certificate_rotated_every_device_needs_setup_again'));
      },
    });
  }
</script>

<section class="panel" aria-labelledby="certificate-title">
  <h2 id="certificate-title">{t('ServerCertificate.game_certificate')}</h2>
  {#if failure}<p class="failed" role="alert">{failure}</p>{/if}
  {#if status}
    <dl class="facts">
      <div>
        <dt>{t('ServerCertificate.source')}</dt>
        <dd>{sources[status.mode]}</dd>
      </div>
      {#if status.certificate}
        <div>
          <dt>{t('ServerCertificate.created')}</dt>
          <dd>
            <time datetime={status.certificate.notBefore}>{day(status.certificate.notBefore)}</time>
            <span class="muted">({relative(status.certificate.notBefore)})</span>
          </dd>
        </div>
        <div>
          <dt>{t('ServerCertificate.expires')}</dt>
          <dd class:failed={expiresSoon}>
            <time datetime={status.certificate.notAfter}>{day(status.certificate.notAfter)}</time>
            <span class:muted={!expiresSoon}>({relative(status.certificate.notAfter)})</span>
          </dd>
        </div>
      {/if}
    </dl>

    {#if status.certificate}
      <Fingerprint label={t('ServerCertificate.fingerprint')} value={status.certificate.fingerprint256} />
    {/if}

    {#if status.canRotate}
      <p class="muted">{t('ServerCertificate.rotate_if_the_key_may_have_leaked_or_before')}</p>
      <button class="danger" disabled={busy} onclick={rotate}>{t('ServerCertificate.rotate_certificate')}</button>
    {:else}
      <p class="muted">{t('ServerCertificate.to_change_it_replace_the_tls_certfile_and_tls')}</p>
    {/if}
  {:else if !failure}
    <p role="status">{t('ServerCertificate.loading')}</p>
  {/if}
</section>

<style>
  .panel {
    background: var(--glass);
    border-radius: 12px;
    padding: 1.25rem;
    margin: 0 0 1rem;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .muted {
    color: var(--muted);
  }
  .failed {
    color: var(--alarm);
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem 1.5rem;
    margin: 0 0 1rem;
  }
  dt {
    color: var(--muted);
    font-size: 0.8125rem;
  }
  dd {
    margin: 0.1rem 0 0;
  }
  button.danger {
    border-color: rgb(255 179 166 / 0.75);
    color: var(--alarm);
  }
  button.danger:hover {
    background: rgb(255 90 70 / 0.14);
  }
</style>
