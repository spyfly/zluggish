<script lang="ts">
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
      failure = error instanceof Error ? error.message : 'The Companion app could not be loaded.';
    }
  });
</script>

{#snippet switcher(name: string)}
  <p class="switch">
    {name}.
    <a href="/apps" onclick={(event) => go(event, '/apps')}>Choose another phone</a>
  </p>
{/snippet}

{#snippet manageLink()}
  <a href="/manage/companion" onclick={(event) => go(event, '/manage/companion')}>Manage → Companion</a>
{/snippet}

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}

{#if status === null}
  {#if !failure}<p role="status">Loading…</p>{/if}
{:else if platform === 'ios'}
  <section class="panel" aria-labelledby="companion-ios">
    {@render switcher('iPhone and iPad')}
    <h2 id="companion-ios">Companion on iPhone and iPad cannot use this server</h2>
    <p class="lead">
      Companion connects only to servers it trusts. On Android this server hands out a copy of the app that trusts it.
      Apple does not allow that on iOS:
    </p>
    <ul class="reasons">
      <li>
        <strong>App Store apps are locked.</strong> Each copy is encrypted for the Apple ID that downloaded it, so it cannot
        be changed to trust another server.
      </li>
      <li>
        <strong>iOS runs only apps that Apple signed.</strong> Installing a changed app takes an Apple developer account,
        and the free kind makes you reinstall it every 7 days.
      </li>
      <li>
        <strong>An added certificate is not enough.</strong> iOS fully trusts only certificates that can vouch for other
        sites. This server's certificate deliberately cannot, so it is never a risk to the rest of your phone.
      </li>
    </ul>
    <p class="hint">Use Companion on an Android phone or tablet instead. Zwift itself rides fine from a computer.</p>
  </section>
{:else if platform === 'android'}
  <section class="panel" aria-label="Android setup steps">
    {@render switcher('Setting up Android')}

    {#if status.app && !status.app.current}
      <p class="stale" role="status">
        The server certificate changed after this app was made, so it cannot connect yet.
        {#if administrator}Upload the app again under {@render manageLink()}.{:else}Ask the server administrator to
          update it.{/if}
      </p>
    {/if}

    <ol class="walk">
      <li>
        <h2>Remove the Play Store version</h2>
        <p>
          Android updates an app only with one signed by the same key. If Zwift Companion came from the Play Store or
          another site, uninstall it first.
        </p>
        <p class="hint">Skip this when you update an app you installed from this page.</p>
      </li>
      <li>
        <h2>Download the app</h2>
        {#if status.app}
          <p>Open this page on the phone, then download Companion patched for this server.</p>
          <a class="download" class:muted-action={!status.app.current} href="/api/companion/app" download
            >Download Companion {status.app.versionName}</a
          >
          <p class="hint">{megabytes(status.app.bytes)}, patched on {day(status.app.createdAt)}.</p>
        {:else}
          <p class="empty">
            There is no app on this server yet.
            {#if administrator}Upload one under {@render manageLink()}.{:else}Ask the server administrator to add it.{/if}
          </p>
        {/if}
      </li>
      <li>
        <h2>Install it</h2>
        <p>
          Open the downloaded file. Android asks whether your browser may install apps: allow it, then select
          <strong>Install</strong>.
        </p>
        <p class="hint">Google Play Protect may warn about an unknown app. Select <strong>Install anyway</strong>.</p>
      </li>
      <li>
        <h2>Send Companion to this server</h2>
        <p>
          Install <a
            href="https://github.com/x-falcon/Virtual-Hosts/releases/latest"
            target="_blank"
            rel="noopener noreferrer">Virtual Hosts</a
          >, save these lines as <strong>hosts.txt</strong> on the phone, and select the file in Virtual Hosts:
        </p>
        <div class="command">
          <code>{hosts}</code>
          {#if canCopy}
            <button type="button" class="copy" onclick={copyHosts} aria-live="polite"
              >{copied ? 'Copied' : 'Copy'}</button
            >
          {/if}
        </div>
        <p class="hint">
          Turn off <strong>Private DNS</strong> in the Android settings. Leave cdn.zwift.com out: Companion loads its images
          from Zwift. If the server runs its own DNS, set it as the Wi-Fi network's DNS instead.
        </p>
      </li>
      <li>
        <h2>Sign in</h2>
        <p>Open Companion and sign in with your account on this server.</p>
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

  .reasons {
    margin: 0;
    padding-left: 1.2rem;
  }
  .reasons li {
    margin: 0 0 0.75rem;
  }
  .reasons li::marker {
    color: var(--muted);
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
