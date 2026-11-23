<script lang="ts">
  import { t } from '../lib/i18n/index';
  import type { z } from 'zod';
  import { onMount } from 'svelte';
  import type { CompanionStatus } from './companion';
  import { companionStatus, megabytes } from './companion';
  import { detect } from './device';

  let {
    api,
    path,
    navigate,
    administrator,
  }: {
    api: <Schema extends z.ZodType>(schema: Schema, url: string) => Promise<z.output<Schema>>;
    /** `/companion` opens this phone's own system; `/companion/android` and `/companion/ios` open that system. Any
    other path is the Apps page's to show. */
    path: string;
    navigate: (path: string) => Promise<void>;
    administrator: boolean;
  } = $props();

  type Platform = 'android' | 'ios';

  const here = detect();

  const platform = $derived<Platform | null>(
    path === '/companion/android'
      ? 'android'
      : path === '/companion/ios'
        ? 'ios'
        : path === '/companion' && (here === 'android' || here === 'ios')
          ? here
          : null,
  );

  let status = $state<CompanionStatus | null>(null);
  let failure = $state('');

  const day = (iso: string) => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  const hosts = $derived(
    status
      ? [`${status.serverAddress} us-or-rly101.zwift.com`, `${status.serverAddress} secure.zwift.com`].join('\n')
      : '',
  );

  /** Browsers allow the clipboard only on HTTPS or localhost; elsewhere the lines are there to select. */
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  let copied = $state(false);

  async function copyHosts() {
    await navigator.clipboard.writeText(hosts);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function go(event: MouseEvent, to: string) {
    event.preventDefault();
    void navigate(to);
  }

  onMount(async () => {
    try {
      status = await api(companionStatus, '/api/companion');
    } catch (error) {
      failure = error instanceof Error ? error.message : t('Companion.the_companion_app_could_not_be_loaded');
    }
  });
</script>

{#snippet switcher(name: string)}
  <p class="switch">
    {name} ·
    <a href="/apps" onclick={(event) => go(event, '/apps')}>{t('Companion.other_systems')}</a>
  </p>
{/snippet}

{#snippet manageLink()}
  <a href="/manage/companion" onclick={(event) => go(event, '/manage/companion')}>{t('Companion.manage_companion')}</a>
{/snippet}

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}

{#if status === null}
  {#if !failure}<p role="status">{t('Companion.loading')}</p>{/if}
{:else if platform === 'ios'}
  <section class="panel" aria-labelledby="companion-ios">
    {@render switcher('iPhone and iPad')}
    <h2 id="companion-ios">{t('Companion.not_supported_on_iphone_and_ipad')}</h2>
    <p class="lead">{t('Companion.ios_does_not_allow_a_patched_companion_use_an')}</p>
  </section>
{:else if platform === 'android'}
  <section class="panel" aria-label={t('Companion.android_setup_steps')}>
    {@render switcher('Android')}

    {#if status.app && !status.app.current}
      <p class="stale" role="status">
        {t('Companion.this_app_was_made_for_an_old_certificate_and')}
        {#if administrator}{t('Companion.update_it_under')} {@render manageLink()}.{:else}{t(
            'Companion.ask_the_server_administrator_to_update_it',
          )}{/if}
      </p>
    {/if}

    <ol class="walk">
      <li>
        <h2>{t('Companion.remove_the_play_store_version')}</h2>
        <p>{t('Companion.uninstall_zwift_companion_if_it_came_from_the_play')}</p>
        <p class="hint">{t('Companion.skip_this_when_updating_an_app_downloaded_here')}</p>
      </li>
      <li>
        <h2>{t('Companion.download_the_app')}</h2>
        {#if status.app}
          <p>{t('Companion.download_it_on_the_phone')}</p>
          <a class="download" class:muted-action={!status.app.current} href="/api/companion/app" download
            >{t('Companion.download_companion', { value1: status.app.versionName })}</a
          >
          <p class="hint">
            {t('Companion.patched_on', { value1: megabytes(status.app.bytes), value2: day(status.app.createdAt) })}
          </p>
        {:else}
          <p class="empty">
            {t('Companion.not_added_yet')}
            {#if administrator}{t('Companion.upload_it_under')} {@render manageLink()}.{:else}{t(
                'Companion.ask_the_server_administrator_to_add_it',
              )}{/if}
          </p>
        {/if}
      </li>
      <li>
        <h2>{t('Companion.install_it')}</h2>
        <p>
          {t('Companion.open_the_downloaded_file_allow_your_browser_to_install')}
          <strong>{t('Companion.install')}</strong>.
        </p>
        <p class="hint">
          {t('Companion.if_play_protect_warns_select')} <strong>{t('Companion.install_anyway')}</strong>.
        </p>
      </li>
      <li>
        <h2>{t('Companion.send_companion_to_this_server')}</h2>
        <p>
          {t('Companion.install')}
          <a href="https://github.com/x-falcon/Virtual-Hosts/releases/latest" target="_blank" rel="noopener noreferrer"
            >{t('Companion.virtual_hosts')}</a
          >{t('Companion.save_these_lines_as')} <strong>{t('Companion.hosts_txt')}</strong>
          {t('Companion.and_select_the_file_in_virtual_hosts')}
        </p>
        <div class="command">
          <code>{hosts}</code>
          {#if canCopy}
            <button type="button" class="copy" onclick={copyHosts} aria-live="polite"
              >{copied ? t('Companion.copied') : t('Companion.copy')}</button
            >
          {/if}
        </div>
        <p class="hint">
          {t('Companion.turn_off')} <strong>{t('Companion.private_dns')}</strong>
          {t('Companion.in_android_settings_while_virtual_hosts_is_on_every')}
        </p>
      </li>
      <li>
        <h2>{t('Companion.sign_in')}</h2>
        <p>{t('Companion.open_companion_and_sign_in_with_your_zluggish_account')}</p>
      </li>
    </ol>
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
  .stale {
    margin: 0 0 1.25rem;
    padding: 0.75rem 0.9rem;
    border-left: 3px solid #ff6b57;
    border-radius: 0 8px 8px 0;
    background: rgb(255 90 70 / 0.12);
    color: var(--alarm);
  }
  .stale a {
    color: inherit;
  }
  .empty {
    color: var(--muted);
  }

  .switch {
    margin: -0.25rem 0 1.25rem;
    color: var(--muted);
    font-size: 0.875rem;
  }
  .switch a {
    color: var(--muted);
    text-decoration-thickness: 1px;
  }
  .switch a:hover {
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

  a.download {
    display: inline-block;
    margin: 0.75rem 0 0.25rem;
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
  /* An app for an old certificate still downloads, but it is not the celebrated action. */
  a.download.muted-action {
    border: 2px solid rgb(255 255 255 / 0.7);
    background: none;
    box-shadow: none;
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
</style>
