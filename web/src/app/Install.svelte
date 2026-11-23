<script lang="ts">
  import { onMount } from 'svelte';
  import Fingerprint from '../components/Fingerprint.svelte';
  import { tlsStatus } from './tls';
  import type { TlsStatus } from './tls';
  import type { Api } from '../lib/api';
  import { detect } from './device';

  let {
    api,
    path,
    navigate,
  }: {
    api: Api;
    /** `/install` sets up this browser's own system; `/install/windows`, `/install/macos` and `/install/linux` set
    up that system. Any other path is the Apps page's to show. */
    path: string;
    navigate: (path: string) => Promise<void>;
  } = $props();

  type Platform = 'windows' | 'macos' | 'linux';

  const systems: Array<{ id: Platform; name: string }> = [
    { id: 'windows', name: 'Windows' },
    { id: 'macos', name: 'macOS' },
    { id: 'linux', name: 'Linux' },
  ];

  const here = detect();

  const platform = $derived(
    systems.find((system) => path === `/install/${system.id}` || (path === '/install' && system.id === here)) ?? null,
  );

  let status = $state<TlsStatus | null>(null);
  let failure = $state('');
  let redirect = $state(true);

  let address = $state('');

  const looksLikeIp = (value: string) =>
    /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || (value.includes(':') && /^[\da-f:.]+$/i.test(value));

  const addressError = $derived(
    !redirect
      ? ''
      : !address.trim()
        ? 'Enter the IP address of the server.'
        : looksLikeIp(address.trim())
          ? ''
          : 'Enter an IP address, such as 192.168.1.20.',
  );

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
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

  onMount(async () => {
    try {
      status = await api(tlsStatus, '/api/tls');
      // The advertised IP as the server is configured, even 127.0.0.1: the web app's own address may differ.
      address = status.serverAddress;
    } catch (error) {
      failure = error instanceof Error ? error.message : 'The certificate could not be loaded.';
    }
  });
</script>

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}
{#if status === null}
  {#if !failure}<p role="status">Loading…</p>{/if}
{:else if status.mode === 'legacy'}
  <section class="panel">
    <p>Ask the server administrator to replace the shared certificate first.</p>
  </section>
{/if}

{#if status && installable && status.certificate && platform}
  <section class="panel" aria-label={`${platform.name} setup steps`}>
    <p class="switch">
      {platform.name} ·
      <a
        href="/apps"
        onclick={(event) => {
          event.preventDefault();
          void navigate('/apps');
        }}>Other systems</a
      >
    </p>
    <ol class="walk">
      <li>
        <h2>Download the setup script</h2>
        <label class="check"><input type="checkbox" bind:checked={redirect} /> Send Zwift to this server</label>
        {#if redirect}
          <label for="install-address">Server IP address</label>
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
          <p id="install-address-hint" class="hint" class:failed={!!addressError}>
            {addressError || 'Added to the hosts file for the Zwift server names.'}
          </p>
        {:else}
          <p class="hint">The hosts file is left alone. Use DNS or similar instead.</p>
        {/if}

        {#if addressError}
          <button class="primary" type="button" disabled>Download setup script</button>
        {:else}
          <a class="download" href={script} download>Download setup script</a>
        {/if}
      </li>
      <li>
        <h2>Run the setup script</h2>
        {#if platform.id === 'windows'}
          <p>Open the downloaded <strong>.bat</strong> file and allow administrator rights.</p>
          <p class="hint">
            If SmartScreen blocks it, select <strong>More info</strong>, then <strong>Run anyway</strong>.
          </p>
        {:else}
          <p>
            {platform.id === 'macos' ? 'In Terminal, run:' : 'In a terminal, run:'}
          </p>
          <div class="command">
            <code>{command}</code>
            {#if canCopy}
              <button type="button" class="copy" onclick={copy} aria-live="polite">{copied ? 'Copied' : 'Copy'}</button>
            {/if}
          </div>
          <p class="hint">
            {platform.id === 'macos'
              ? 'Enter your password when asked, then approve the certificate.'
              : 'Enter your password when asked. If Zwift is not found, add the Zwift folder as the last argument.'}
          </p>
        {/if}
      </li>
      <li>
        <h2>Start Zwift</h2>
        <p>
          When the script says <strong>Done</strong>, {platform.id === 'linux'
            ? "close Zwift's Wine prefix, then "
            : platform.id === 'macos'
              ? 'quit Zwift if it is open, then '
              : ''}start Zwift and sign in.
        </p>
        <p class="hint">Run it again after a Zwift update or a certificate rotation.</p>
      </li>
    </ol>
  </section>

  <section class="panel" aria-labelledby="install-certificate">
    <h2 id="install-certificate">Check the certificate</h2>
    <p>The thumbprint the script prints should match.</p>
    <div class="prints">
      <Fingerprint label="Thumbprint (SHA-1)" value={status.certificate.thumbprint} />
      <Fingerprint label="Fingerprint (SHA-256)" value={status.certificate.fingerprint256} />
    </div>
    <p class="muted">Valid until {day(status.certificate.notAfter)}.</p>
    <p class="manual">
      {#if platform.id === 'windows'}
        Manual install: <a href="/api/tls/certificate?format=der" download>.cer</a> for the Windows certificate store,
        <a href="/api/tls/certificate" download>.crt</a> for Zwift's cacert.pem.
      {:else}
        Manual install: <a href="/api/tls/certificate" download>.crt (PEM)</a>.
      {/if}
    </p>
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
  .muted,
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
    margin: 1.25rem 0 0;
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
  .walk button {
    margin: 1.25rem 0 0;
  }
  /* The way out to the other systems stays quiet: most riders are on the system the page picked. */
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
    word-break: break-all;
    font:
      600 0.9375rem/1.5 ui-monospace,
      'Cascadia Mono',
      'DejaVu Sans Mono',
      monospace;
    user-select: all;
  }
  .walk button.copy {
    flex: none;
    margin: 0 0 0 auto;
    padding: 0.35rem 0.8rem;
    font-size: 0.75rem;
  }

  .prints {
    display: grid;
    gap: 1rem;
    margin: 1rem 0;
  }
  .manual {
    margin-bottom: 0;
  }
</style>
