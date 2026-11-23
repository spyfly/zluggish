<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { onMount } from 'svelte';
  import Fingerprint from '../components/Fingerprint.svelte';
  import { tlsStatus } from './tls';
  import type { TlsStatus } from './tls';
  import type { Api } from '../lib/api';
  import { detect } from './device';

  type Confirmation = {
    title: string;
    detail: string;
    label: string;
    destructive: boolean;
    confirm: () => Promise<void>;
  };

  let {
    api,
    path,
    navigate,
    confirm,
  }: {
    api: Api;
    /** `/install` sets up this browser's own system; `/install/windows`, `/install/macos` and `/install/linux` set
    up that system, and `/install/manual` shows the certificate and hosts line for any system. Any other path is the
    Apps page's to show. */
    path: string;
    navigate: (path: string) => Promise<void>;
    confirm: (confirmation: Confirmation) => void;
  } = $props();

  type Platform = 'windows' | 'macos' | 'linux';

  const systems: Array<{ id: Platform; name: string }> = [
    { id: 'windows', name: t('Install.windows') },
    { id: 'macos', name: t('Install.macos') },
    { id: 'linux', name: t('Install.linux') },
  ];

  const here = detect();

  const platform = $derived(
    systems.find((system) => path === `/install/${system.id}` || (path === '/install' && system.id === here)) ?? null,
  );

  const manual = $derived(path === '/install/manual');

  let status = $state<TlsStatus | null>(null);
  let failure = $state('');
  let redirect = $state(true);
  let advanced = $state(false);

  let address = $state('');

  const looksLikeIp = (value: string) =>
    /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || (value.includes(':') && /^[\da-f:.]+$/i.test(value));

  const addressError = $derived(
    !redirect
      ? ''
      : !address.trim()
        ? t('Install.enter_the_ip_address_of_the_server')
        : looksLikeIp(address.trim())
          ? ''
          : t('Install.enter_an_ip_address_such_as_192_168_1'),
  );

  /** The rider typed over the address the server advertises, so offer it back. */
  const changed = $derived(!!status?.serverAddress && address.trim() !== status.serverAddress);

  function reset() {
    const server = status?.serverAddress ?? '';

    confirm({
      title: t('Install.reset_the_server_ip_address'),
      detail: t('Install.the_setup_script_will_use_the_address_this', { value1: server }),
      label: t('Install.reset'),
      destructive: false,
      confirm: async () => {
        address = server;
      },
    });
  }

  /** The names the setup script points at the server; keep in step with `zwiftHostNames` in the server. */
  const zwiftHosts = ['us-or-rly101.zwift.com', 'secure.zwift.com', 'cdn.zwift.com', 'launcher.zwift.com'];

  const target = $derived(looksLikeIp(address.trim()) ? address.trim() : (status?.serverAddress ?? ''));
  const hostsLine = $derived(`${target} ${zwiftHosts.join(' ')}`);

  const script = $derived(
    `/api/tls/setup/${platform?.id ?? 'windows'}?${new URLSearchParams({ address: redirect ? address.trim() : '' })}`,
  );

  const installable = $derived(status?.mode === 'managed' || status?.mode === 'custom');

  /** The file name the server gives the shell script, so the page can show the exact command to run. */
  const command = $derived.by(() => {
    const thumbprint = status?.certificate?.thumbprint ?? '';
    const file = `zluggish-zwift-${thumbprint.slice(0, 8).toLowerCase()}.sh`;

    return `sh ~/Downloads/${file}`;
  });

  /** Browsers allow the clipboard only on HTTPS or localhost; elsewhere the command is there to select. */
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  let copied = $state('');

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    copied = text;
    setTimeout(() => (copied = ''), 2000);
  }

  function go(event: MouseEvent, to: string) {
    event.preventDefault();
    void navigate(to);
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  onMount(async () => {
    try {
      status = await api(tlsStatus, '/api/tls');
      // The advertised IP as the server is configured, even 127.0.0.1: the web app's own address may differ.
      address = status.serverAddress;
    } catch (error) {
      failure = error instanceof Error ? error.message : t('Install.the_certificate_could_not_be_loaded');
    }
  });
</script>

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}
{#if status === null}
  {#if !failure}<p role="status">{t('Install.loading')}</p>{/if}
{:else if status.mode === 'legacy'}
  <section class="panel">
    <p>{t('Install.ask_the_server_administrator_to_replace_the_shared_certificate')}</p>
  </section>
{/if}

{#if status && installable && status.certificate && manual}
  <section class="panel" aria-label={t('Install.manual_setup')}>
    <p class="lede">{t('Install.install_the_certificate_and_point_zwift_at_this')}</p>

    <h2>{t('Install.certificate')}</h2>
    <ul class="files">
      <li>
        <a class="file" href="/api/tls/certificate" download>{t('Install.download_crt')}</a>
        <span class="hint">{t('Install.pem_for_macos_linux_and_zwift_s_cacert_pem')}</span>
      </li>
      <li>
        <a class="file" href="/api/tls/certificate?format=der" download>{t('Install.download_cer')}</a>
        <span class="hint">{t('Install.for_the_windows_certificate_store')}</span>
      </li>
    </ul>
    <p class="hint">{t('Install.check_that_the_certificate_you_install_shows')}</p>
    <div class="prints">
      <Fingerprint label={t('Install.thumbprint_sha_1')} value={status.certificate.thumbprint} />
      <Fingerprint label={t('Install.fingerprint_sha_256')} value={status.certificate.fingerprint256} />
    </div>
    <p class="hint">{t('Install.valid_until', { value1: day(status.certificate.notAfter) })}</p>

    {#if target}
      <h2>{t('Install.hosts_file')}</h2>
      <p>{t('Install.add_this_line_to_the_hosts_file')}</p>
      {@render line(hostsLine)}
      <p class="hint">{t('Install.it_is_etc_hosts_on_macos_and_linux')}</p>
    {/if}
  </section>
{:else if status && installable && status.certificate && platform}
  <section class="panel" aria-label={`${platform.name} setup steps`}>
    <ol class="walk">
      <li>
        <h2>{t('Install.download_the_setup_script')}</h2>
        <div class="setup-actions">
          {#if addressError}
            <button class="primary" type="button" disabled>{t('Install.download_setup_script')}</button>
          {:else}
            <a class="download" href={script} download>{t('Install.download_setup_script')}</a>
          {/if}
          <button
            class="advanced-toggle"
            type="button"
            aria-expanded={advanced}
            aria-controls="install-advanced"
            onclick={() => (advanced = !advanced)}
            >{advanced ? t('Install.hide_advanced_settings') : t('Install.advanced_settings')}</button
          >
        </div>
        {#if addressError && !advanced}
          <p class="hint failed" role="alert">{addressError}</p>
        {/if}
        <div id="install-advanced" class="advanced-settings" hidden={!advanced}>
          <label class="check"><input type="checkbox" bind:checked={redirect} /> {t('Install.patch_hosts_file')}</label>
          {#if redirect}
            <label for="install-address">{t('Install.server_ip_address')}</label>
            <div class="address">
              <input
                id="install-address"
                bind:value={address}
                inputmode="decimal"
                autocomplete="off"
                spellcheck="false"
                maxlength={45}
                aria-invalid={!!addressError}
                aria-describedby="install-address-hint"
              />
              {#if changed}
                <button type="button" class="reset" aria-haspopup="dialog" onclick={reset}>{t('Install.reset')}</button>
              {/if}
            </div>
            <p id="install-address-hint" class="hint" class:failed={!!addressError}>
              {addressError || t('Install.zwift_s_server_names_point_to_this_address')}
            </p>
          {:else}
            <p class="hint">{t('Install.point_the_zwift_server_names_at_this_server')}</p>
          {/if}
        </div>
      </li>
      <li>
        <h2>{t('Install.run_the_setup_script')}</h2>
        {#if platform.id === 'windows'}
          <p>
            {t('Install.open_the_downloaded')} <strong>{t('Install.bat')}</strong>
            {t('Install.file_and_allow_administrator_rights')}
          </p>
          <p class="hint">
            {t('Install.if_smartscreen_blocks_it_select')} <strong>{t('Install.more_info')}</strong>{t('Install.then')}
            <strong>{t('Install.run_anyway')}</strong>.
          </p>
        {:else}
          <p>
            {platform.id === 'macos' ? t('Install.in_terminal_run') : t('Install.in_a_terminal_run')}
          </p>
          {@render line(command)}
          <p class="hint">
            {platform.id === 'macos'
              ? t('Install.enter_your_password_when_asked_then_approve_the_certificate')
              : t('Install.enter_your_password_when_asked_if_zwift_is_not')}
          </p>
        {/if}
      </li>
      <li>
        <h2>{t('Install.start_zwift')}</h2>
        <p>
          {t('Install.when_the_script_says')} <strong>{t('Install.done')}</strong>{t(
            'Install.start_zwift_and_sign_in',
            {
              value1:
                platform.id === 'linux'
                  ? t('Install.close_zwift_s_wine_prefix_then')
                  : platform.id === 'macos'
                    ? t('Install.quit_zwift_if_it_is_open_then')
                    : '',
            },
          )}
        </p>
      </li>
    </ol>
    <p class="elsewhere">
      {t('Install.prefer_to_install_the_certificate_yourself')}
      <a href="/install/manual" onclick={(event) => go(event, '/install/manual')}>{t('Install.manual_setup')}</a>
    </p>
  </section>
{/if}

{#snippet line(text: string)}
  <div class="command">
    <code>{text}</code>
    {#if canCopy}
      <button type="button" class="copy" onclick={() => copy(text)} aria-live="polite"
        >{copied === text ? t('Install.copied') : t('Install.copy')}</button
      >
    {/if}
  </div>
{/snippet}

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
  .hint {
    color: var(--muted);
  }
  .hint {
    margin: 0.4rem 0 0;
    font-size: 0.875rem;
  }
  .hint.failed {
    color: var(--alarm);
  }
  .notice.failed {
    color: var(--alarm);
    border-left: 3px solid #ff6b57;
  }

  label.check {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 1rem;
    color: var(--text);
  }
  input[aria-invalid='true'] {
    border-color: #ff6b57;
  }

  a.download {
    display: inline-block;
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
  .setup-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    margin: 0.75rem 0 0.25rem;
  }
  .setup-actions button {
    margin: 0;
  }
  .setup-actions .advanced-toggle {
    padding: 0.5rem 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--muted);
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: none;
    letter-spacing: normal;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .advanced-toggle:hover {
    color: var(--text);
  }
  .advanced-settings {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
  }
  .address {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 28rem;
  }
  .address input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .address button.reset {
    flex: none;
    margin: 0;
    padding: 0.45rem 0.9rem;
    font-size: 0.75rem;
  }
  /* The way to do it by hand closes the steps, out of the way of riders who just run the script. */
  .elsewhere {
    margin: 1.5rem 0 0;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.875rem;
  }
  .elsewhere a {
    color: var(--muted);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .elsewhere a:hover {
    color: var(--text);
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
  .walk label.check:first-of-type {
    margin-top: 0;
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
    overflow-wrap: anywhere;
    font:
      600 0.9375rem/1.5 ui-monospace,
      'Cascadia Mono',
      'DejaVu Sans Mono',
      monospace;
    user-select: all;
  }
  button.copy {
    flex: none;
    margin: 0 0 0 auto;
    padding: 0.35rem 0.8rem;
    font-size: 0.75rem;
  }

  .lede {
    margin: 0 0 1.5rem;
    color: var(--muted);
  }
  .prints + .hint {
    margin-bottom: 1.75rem;
  }
  .files {
    display: grid;
    gap: 0.6rem;
    margin: 0 0 1rem;
    padding: 0;
    list-style: none;
  }
  .files li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 0.9rem;
  }
  .files .hint {
    margin: 0;
  }
  a.file {
    padding: 0.45rem 0.9rem;
    border: 2px solid rgb(255 255 255 / 0.7);
    border-radius: 10px;
    font-weight: 800;
    font-size: 0.8125rem;
    text-decoration: none;
  }
  a.file:hover {
    background: rgb(255 255 255 / 0.12);
  }
  .prints {
    display: grid;
    gap: 1rem;
    margin: 1rem 0 0.5rem;
  }
</style>
