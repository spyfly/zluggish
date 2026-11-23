<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { onMount } from 'svelte';
  import Fingerprint from '../components/Fingerprint.svelte';
  import type { Api } from '../lib/api';
  import { megabytes } from './companion';
  import { detect } from './device';
  import { tlsStatus } from './tls';
  import type { TlsStatus } from './tls';
  import { zwiftAndroidStatus } from './zwift-android';
  import type { ZwiftAndroidStatus } from './zwift-android';

  let {
    api,
    path,
    navigate,
    administrator,
  }: {
    api: Api;
    /** `/install/android`, `/install/android-rooted` or `/install/ios`. */
    path: string;
    navigate: (path: string) => Promise<void>;
    administrator: boolean;
  } = $props();

  const platform = $derived(
    path === '/install/android-rooted' ? 'rooted' : path === '/install/ios' ? 'ios' : 'android',
  );

  let status = $state<TlsStatus | null>(null);
  let failure = $state('');

  const address = $derived(status?.serverAddress ?? '<server-ip>');

  /** The name the server gives the certificate download, so the adb commands match the file. */
  const file = $derived(`zluggish-zwift-${(status?.certificate?.thumbprint ?? '').slice(0, 8).toLowerCase()}.crt`);

  let zwift = $state<ZwiftAndroidStatus | null>(null);
  let zwiftFailure = $state('');
  const onAndroid = detect() === 'android';

  const data = '/data/data/com.zwift.zwiftgame/dataES';

  const blocks = $derived({
    hosts: [
      `${address} us-or-rly101.zwift.com`,
      `${address} secure.zwift.com`,
      `${address} cdn.zwift.com`,
      `${address} launcher.zwift.com`,
    ].join('\n'),
    certificate: [
      t('InstallPhone.adb_push_zluggish_crt', { value1: file, value2: data }),
      t('InstallPhone.adb_shell_cat_zluggish_crt_cacert_pem', { value1: data, value2: data }),
    ].join('\n'),
    etcHosts: t('InstallPhone.us_or_rly101_zwift_com_secure_zwift_com_cdn', { value1: address }),
  });

  /** Browsers allow the clipboard only on HTTPS or localhost; elsewhere the lines are there to select. */
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  let copied = $state('');

  async function copy(key: keyof typeof blocks) {
    await navigator.clipboard.writeText(blocks[key]);
    copied = key;
    setTimeout(() => (copied = ''), 2000);
  }

  function go(event: MouseEvent, to: string) {
    event.preventDefault();
    void navigate(to);
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  $effect(() => {
    if (platform === 'android' && status) {
      api(zwiftAndroidStatus, '/api/install/android')
        .then((body) => {
          zwift = body;
        })
        .catch((error: unknown) => {
          zwiftFailure =
            error instanceof Error ? error.message : t('InstallPhone.zwift_for_android_could_not_be_loaded');
        });
    }
  });

  onMount(async () => {
    try {
      status = await api(tlsStatus, '/api/tls');
    } catch (error) {
      failure = error instanceof Error ? error.message : t('InstallPhone.the_certificate_could_not_be_loaded');
    }
  });
</script>

{#snippet code(key: keyof typeof blocks)}
  <div class="command">
    <code>{blocks[key]}</code>
    {#if canCopy}
      <button type="button" class="copy" onclick={() => copy(key)} aria-live="polite"
        >{copied === key ? t('InstallPhone.copied') : t('InstallPhone.copy')}</button
      >
    {/if}
  </div>
{/snippet}

{#snippet manageLink()}
  <a href="/manage/zwift-android" onclick={(event) => go(event, '/manage/zwift-android')}
    >{t('InstallPhone.manage_zwift_for_android')}</a
  >
{/snippet}

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}

{#if platform === 'ios'}
  <section class="panel" aria-labelledby="install-ios">
    <h2 id="install-ios">{t('InstallPhone.not_supported_on_iphone_and_ipad')}</h2>
    <p class="lead">{t('InstallPhone.ios_does_not_allow_a_patched_zwift_ride_from')}</p>
  </section>
{:else if status === null}
  {#if !failure}<p role="status">{t('InstallPhone.loading')}</p>{/if}
{:else if status.mode === 'legacy'}
  <section class="panel">
    <p>{t('InstallPhone.ask_the_server_administrator_to_replace_the_shared_certificate')}</p>
  </section>
{:else if platform === 'android'}
  <section class="panel" aria-label={t('InstallPhone.android_setup_steps')}>
    {#if zwift?.app && !zwift.app.current}
      <p class="risk" role="status">
        {t('InstallPhone.this_app_was_built_for_an_old_certificate_and')}
        {#if administrator}{t('InstallPhone.build_it_again_under')} {@render manageLink()}.{:else}{t(
            'InstallPhone.ask_the_server_administrator_to_rebuild_it',
          )}{/if}
      </p>
    {/if}

    <ol class="walk">
      <li>
        <h2>{t('InstallPhone.download_zwift_for_zluggish')}</h2>
        {#if zwiftFailure}
          <p class="notice failed" role="alert">{zwiftFailure}</p>
        {:else if zwift === null}
          <p role="status">{t('InstallPhone.loading')}</p>
        {:else if zwift.app?.current}
          <p>
            {t('InstallPhone.installs_next_to_zwift_from_google_play')}
            {#if !onAndroid}{t('InstallPhone.download_it_on_the_android_device')}{/if}
          </p>
          <a class="download" href="/api/install/android/app" download
            >{t('InstallPhone.download_zwift', { value1: zwift.app.versionName })}</a
          >
          <p class="hint">
            {t('InstallPhone.built_needs_twice_that_space_free', {
              value1: megabytes(zwift.app.bytes),
              value2: day(zwift.app.createdAt),
            })}
          </p>
        {:else if !zwift.app}
          <p class="empty">
            {t('InstallPhone.this_server_does_not_have_zwift_for_android_yet')}
            {#if administrator}{t('InstallPhone.set_it_up_under')} {@render manageLink()}.{:else}{t(
                'InstallPhone.the_server_administrator_needs_to_set_it_up_first',
              )}{/if}
          </p>
        {/if}
      </li>
      <li>
        <h2>{t('InstallPhone.install_it')}</h2>
        <p>
          {t('InstallPhone.open_the_downloaded_file_allow_your_browser_to_install')}
          <strong>{t('InstallPhone.install')}</strong>.
        </p>
        <p class="hint">
          {t('InstallPhone.if_play_protect_warns_select')} <strong>{t('InstallPhone.install_anyway')}</strong>.
        </p>
      </li>
      <li>
        <h2>{t('InstallPhone.send_zwift_to_this_server')}</h2>
        <p>
          {t('InstallPhone.install')}
          <a href="https://github.com/x-falcon/Virtual-Hosts/releases/latest" target="_blank" rel="noopener noreferrer"
            >{t('InstallPhone.virtual_hosts')}</a
          >{t('InstallPhone.save_these_lines_as')} <strong>{t('InstallPhone.hosts_txt')}</strong>
          {t('InstallPhone.and_select_the_file_in_virtual_hosts')}
        </p>
        {@render code('hosts')}
        <p class="hint">
          {t('InstallPhone.turn_off')} <strong>{t('InstallPhone.private_dns')}</strong>
          {t('InstallPhone.in_android_settings')}
        </p>
      </li>
      <li>
        <h2>{t('InstallPhone.ride')}</h2>
        <p>
          {t('InstallPhone.turn_on_virtual_hosts_open')} <strong>{t('InstallPhone.zwift_for_zluggish')}</strong>
          {t('InstallPhone.and_sign_in_with_your_zluggish_account')}
        </p>
        <p class="hint">{t('InstallPhone.the_first_start_takes_a_few_minutes_turn_virtual')}</p>
      </li>
    </ol>
  </section>
{:else if status.certificate}
  <section class="panel" aria-label={t('InstallPhone.rooted_android_setup_steps')}>
    <ol class="walk">
      <li>
        <h2>{t('InstallPhone.start_zwift_once')}</h2>
        <p>{t('InstallPhone.install_zwift_start_it_once_so_it_creates_cacert')}</p>
      </li>
      <li>
        <h2>{t('InstallPhone.add_the_certificate')}</h2>
        <p>
          {t('InstallPhone.append_the_certificate_to')}
          <strong class="path">{t('InstallPhone.cacert_pem', { value1: data })}</strong>{t('InstallPhone.with')}
          <code class="inline">{t('InstallPhone.adb')}</code>
          {t('InstallPhone.as_root')}
        </p>
        <a class="download" href="/api/tls/certificate" download>{t('InstallPhone.download_certificate')}</a>
        {@render code('certificate')}
        <p class="hint">{t('InstallPhone.keep_the_file_s_owner_and_permissions')}</p>
      </li>
      <li>
        <h2>{t('InstallPhone.send_zwift_to_this_server')}</h2>
        <p>{t('InstallPhone.append_this_line_to')} <strong>{t('InstallPhone.etc_hosts')}</strong>:</p>
        {@render code('etcHosts')}
        <p class="hint">
          {t('InstallPhone.or_edit_it_on_a_computer_with')}
          <code class="inline">{t('InstallPhone.adb_pull_etc_hosts')}</code>
          {t('InstallPhone.and')} <code class="inline">{t('InstallPhone.adb_push_hosts_etc_hosts')}</code>.
        </p>
      </li>
      <li>
        <h2>{t('InstallPhone.ride')}</h2>
        <p>{t('InstallPhone.start_zwift_and_sign_in_with_your_zluggish_account')}</p>
      </li>
    </ol>
  </section>

  <section class="panel" aria-labelledby="install-rooted-certificate">
    <h2 id="install-rooted-certificate">{t('InstallPhone.check_the_certificate')}</h2>
    <div class="prints">
      <Fingerprint label={t('InstallPhone.fingerprint')} value={status.certificate.fingerprint256} />
    </div>
  </section>
{/if}

<style>
  .panel {
    background: var(--glass);
    border-radius: 12px;
    padding: 1.25rem;
    margin: 0 0 1rem;
    max-width: 44rem;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .lead {
    margin-top: 0;
  }
  .hint {
    margin: 0.4rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }
  .notice.failed {
    color: var(--alarm);
    border-left: 3px solid #ff6b57;
    padding-left: 0.75rem;
  }
  .empty {
    color: var(--muted);
  }
  .risk a {
    color: inherit;
  }
  .risk {
    margin: 0 0 1.25rem;
    padding: 0.75rem 0.9rem;
    border-left: 3px solid #ff6b57;
    border-radius: 0 8px 8px 0;
    background: rgb(255 90 70 / 0.12);
    color: var(--alarm);
  }

  .walk {
    counter-reset: step;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .walk > li {
    counter-increment: step;
    position: relative;
    padding: 0 0 1.5rem 3.25rem;
  }
  .walk > li:last-child {
    padding-bottom: 0;
  }
  .walk > li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: -0.2rem;
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    background: var(--orange);
    font-weight: 800;
  }
  .walk > li:not(:last-child)::after {
    content: '';
    position: absolute;
    left: calc(1.05rem - 1px);
    top: 2.2rem;
    bottom: 0.3rem;
    border-left: 2px solid var(--line);
  }
  .walk h2 {
    margin-bottom: 0.5rem;
    padding-top: 0.15rem;
  }
  .walk p {
    margin: 0 0 0.4rem;
  }

  a.download {
    display: inline-block;
    margin: 0.5rem 0 0.25rem;
    padding: 0.65rem 1.4rem;
    border-radius: 10px;
    background: var(--orange);
    box-shadow: 0 3px 0 var(--orange-deep);
    font-weight: 800;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    text-decoration: none;
  }
  a.download:hover {
    background: #f06a1e;
  }
  a.download:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--orange-deep);
  }
  .command {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 0.5rem 0;
    padding: 0.55rem 0.55rem 0.55rem 1rem;
    border-radius: 8px;
    background: var(--well);
  }
  .command code {
    flex: 1 1 16rem;
    min-width: 0;
    overflow-x: auto;
    white-space: pre;
    font:
      600 0.875rem/1.5 ui-monospace,
      'Cascadia Mono',
      'DejaVu Sans Mono',
      monospace;
    user-select: all;
  }
  .path {
    overflow-wrap: anywhere;
  }
  code.inline {
    font:
      600 0.875em ui-monospace,
      'Cascadia Mono',
      'DejaVu Sans Mono',
      monospace;
  }
  button.copy {
    flex: none;
    margin: 0 0 0 auto;
    padding: 0.35rem 0.8rem;
    font-size: 0.75rem;
  }

  .prints {
    display: grid;
    gap: 1rem;
    margin: 1rem 0 0;
  }
</style>
