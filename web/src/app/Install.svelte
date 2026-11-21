<script lang="ts">
  import { onMount } from 'svelte';
  import Fingerprint from '../components/Fingerprint.svelte';
  import { tlsStatus } from './tls';
  import type { TlsStatus } from './tls';
  import type { Api } from '../lib/api';

  let {
    api,
    path,
    navigate,
  }: {
    api: Api;
    /** `/install` sets up this browser's own system, or offers the choice; `/install/choose` always offers it;
    `/install/<system>` shows instructions for that system. */
    path: string;
    navigate: (path: string) => Promise<void>;
  } = $props();

  type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'android-rooted' | 'ios';

  const systems: Array<{ id: Platform; name: string; detail: string }> = [
    { id: 'windows', name: 'Windows', detail: 'Zwift installed from zwift.com' },
    { id: 'macos', name: 'macOS', detail: 'Zwift installed from zwift.com' },
    { id: 'linux', name: 'Linux', detail: 'Zwift in Wine, Lutris, Bottles or Steam' },
    { id: 'android', name: 'Android', detail: 'Requires the shared Zwift certificate' },
    { id: 'android-rooted', name: 'Android (Rooted)', detail: 'Install this server’s certificate' },
    { id: 'ios', name: 'iPhone/iPad', detail: 'Not supported' },
  ];

  /** The system this browser runs on. iPadOS reports itself as a Mac with a touch screen. */
  function detect() {
    const agent = navigator.userAgent;

    if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) {
      return 'ios';
    }

    if (/Android/.test(agent)) {
      return 'android';
    }

    if (/Windows/.test(agent)) {
      return 'windows';
    }

    if (/Macintosh|Mac OS X/.test(agent)) {
      return 'macos';
    }

    return /Linux|X11|CrOS/.test(agent) ? 'linux' : 'other';
  }

  const here = detect();

  const platform = $derived(
    systems.find((system) => path === `/install/${system.id}` || (path === '/install' && system.id === here)) ?? null,
  );

  let status = $state<TlsStatus | null>(null);
  let failure = $state('');
  let redirect = $state(true);

  /** On a server with the shared certificate, the rider confirms the risk before the download unlocks. */
  let accepted = $state(false);
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

  const legacy = $derived(status?.mode === 'legacy');
  const installable = $derived(status?.mode === 'managed' || status?.mode === 'custom' || legacy);
  const blocked = $derived(!!addressError || (legacy && !accepted));

  /** The file name the server gives the shell script, so the page can show the exact command to run. */
  const command = $derived.by(() => {
    const thumbprint = status?.certificate?.thumbprint ?? '';
    const file = legacy ? 'zluggish-zwift-shared.sh' : `zluggish-zwift-${thumbprint.slice(0, 8).toLowerCase()}.sh`;

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
{:else if status.mode === 'disabled'}
  <section class="panel" aria-labelledby="install-plain">
    <h2 id="install-plain">Nothing to install</h2>
    <p>This server talks to Zwift without a certificate. Ask the server administrator how to connect.</p>
  </section>
{:else if legacy && !platform}
  <section class="panel unsafe" aria-labelledby="install-legacy">
    <h2 id="install-legacy">This server uses an unsafe certificate</h2>
    <p>
      It still uses the shared Zwift certificate. Its private key is published on the internet, so others on your
      network could read and change your Zwift traffic, your password included.
    </p>
    <p>
      Ask the server administrator to generate a server certificate. Until then you can set up a computer with the
      shared certificate. After the switch, run the new setup from this page.
    </p>
  </section>
{/if}

{#snippet chooseAnother()}
  <a
    href="/install/choose"
    onclick={(event) => {
      event.preventDefault();
      void navigate('/install/choose');
    }}>Choose another system</a
  >
{/snippet}

{#if platform?.id === 'ios'}
  <section class="panel unsafe" aria-labelledby="install-ios">
    <p class="switch">{@render chooseAnother()}</p>
    <h2 id="install-ios">iPhone and iPad are not supported</h2>
    <p>
      Zwift uses its own certificate bundle to decide which servers to trust. Installing a certificate in iOS or iPadOS
      settings does not change that bundle. Replacing the bundle would require modifying the app, and Apple’s code
      signing prevents the modified App Store app from running.
    </p>
    <p>To ride on this server, set up Zwift on Windows, macOS, Linux or a compatible Android device.</p>
  </section>
{:else if status && installable && status.certificate}
  {#if !platform}
    <section class="panel" aria-labelledby="install-title">
      <h2 id="install-title">Set up a device for Zwift</h2>
      <p class="lead">
        Zwift only talks to a server it trusts. Setup tells Zwift to trust and connect to this server. Which device runs
        Zwift?
      </p>
      <div class="systems">
        {#each systems as system (system.id)}
          <button type="button" class="system" onclick={() => navigate(`/install/${system.id}`)}>
            <span class="name">{system.name}</span>
            <span class="detail">{system.detail}</span>
            {#if system.id === here}<span class="here">This device</span>{/if}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        {/each}
      </div>
    </section>
  {:else if platform.id === 'android'}
    <section class="panel" aria-labelledby="install-android">
      <p class="switch">{@render chooseAnother()}</p>
      <h2 id="install-android">Set up Android</h2>
      {#if legacy}
        <p class="risk">
          The shared Zwift certificate uses a private key published on the internet. Others on your network could read
          your Zwift traffic, including your password.
        </p>
        <ol>
          <li>Install Zwift from Google Play and leave it closed.</li>
          <li>
            Follow the Android guide to redirect Zwift using Virtual Hosts or DNS and patch the game data with
            ZofflineObb.
          </li>
          <li>
            Start Zwift and sign in with your Zluggish username and password. Repeat the patch after each Zwift update.
          </li>
        </ol>
      {:else}
        <p>
          ZofflineObb supports only the shared Zwift certificate. This server uses its own certificate, so you’ll need a
          rooted Android device or a supported computer to ride here.
        </p>
      {/if}
      <p><a href="https://docs.zluggish.com/install/clients/android/">Android setup guide</a></p>
    </section>
  {:else if platform.id === 'android-rooted'}
    <section class="panel" aria-labelledby="install-android-rooted">
      <p class="switch">{@render chooseAnother()}</p>
      <h2 id="install-android-rooted">Set up Android (rooted)</h2>
      {#if legacy}
        <p class="risk">
          The shared Zwift certificate uses a private key published on the internet. Others on your network could read
          your Zwift traffic, including your password.
        </p>
      {/if}
      <ol>
        <li>Install Zwift, open it once to download its game files, then close it.</li>
        <li>
          Download the <a href="/api/tls/certificate" download>server certificate (.crt)</a> and append it to
          <code>/data/data/com.zwift.zwiftgame/dataES/cacert.pem</code> using root access. Keep the file’s owner and permissions.
        </li>
        <li>
          Follow the rooted Android guide to point the Zwift hostnames at this server using the hosts file or DNS.
        </li>
        <li>Start Zwift and sign in with your Zluggish username and password.</li>
      </ol>
      <p><a href="https://docs.zluggish.com/install/clients/android-rooted/">Rooted Android setup guide</a></p>
    </section>
  {:else}
    <section class="panel" aria-label={`${platform.name} setup steps`}>
      <p class="switch">
        Setting up {platform.name}. {@render chooseAnother()}
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
              {addressError || 'The script adds this address to the hosts file for the Zwift server names.'}
            </p>
          {:else}
            <p class="hint">
              The script leaves the hosts file alone. Point Zwift at the server some other way, such as DNS.
            </p>
          {/if}

          {#if legacy}
            <div class="risk">
              <p>
                This server still uses the shared Zwift certificate, whose private key is public. Others on your network
                could read your Zwift traffic, your password included.
              </p>
              <label class="check"
                ><input type="checkbox" bind:checked={accepted} /> I understand that this connection is not private</label
              >
            </div>
          {/if}

          {#if blocked}
            <button class={legacy ? 'danger' : 'primary'} type="button" disabled
              >{legacy ? 'Download unsafe setup script' : 'Download setup script'}</button
            >
          {:else}
            <a class="download" class:danger={legacy} href={script} download
              >{legacy ? 'Download unsafe setup script' : 'Download setup script'}</a
            >
          {/if}
        </li>
        <li>
          <h2>Run it</h2>
          {#if platform.id === 'windows'}
            <p>Open the downloaded <strong>.bat</strong> file. Windows asks for administrator rights. Allow it.</p>
            <p class="hint">
              If Windows SmartScreen stops the file, select <strong>More info</strong>, then
              <strong>Run anyway</strong>.
            </p>
          {:else}
            <p>
              {platform.id === 'macos'
                ? 'Open Terminal and run the downloaded file:'
                : 'In a terminal, run the downloaded file:'}
            </p>
            <div class="command">
              <code>{command}</code>
              {#if canCopy}
                <button type="button" class="copy" onclick={copy} aria-live="polite"
                  >{copied ? 'Copied' : 'Copy'}</button
                >
              {/if}
            </div>
            <p class="hint">
              {platform.id === 'macos'
                ? 'It asks for your password through sudo, then macOS asks once more before it trusts the certificate. If the file was saved under another name, use that name.'
                : 'It asks for your password through sudo. If it does not find Zwift, run it again with the Zwift folder as the last argument.'}
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
          <p class="hint">
            {legacy
              ? 'Run the script again after a Zwift update. When the administrator switches to a server certificate, run the new setup: it removes the shared certificate from the computer.'
              : 'Run the script again after a Zwift update and after the administrator rotates the certificate. It also removes the old shared Zwift certificate from the computer.'}
          </p>
        </li>
      </ol>
    </section>

    <section class="panel" aria-labelledby="install-certificate">
      <h2 id="install-certificate">{legacy ? 'Check the shared certificate' : 'Check the certificate'}</h2>
      <p>
        The script prints the thumbprint it installs.{platform.id === 'windows'
          ? " Windows shows it as Thumbprint in the certificate's details."
          : platform.id === 'macos'
            ? ' Keychain Access shows it as the SHA-1 fingerprint.'
            : ''} It should match this one.
      </p>
      <div class="prints">
        <Fingerprint label="Thumbprint (SHA-1)" value={status.certificate.thumbprint} />
        <Fingerprint label="SHA-256 fingerprint" value={status.certificate.fingerprint256} />
      </div>
      <p class="muted">Valid until {day(status.certificate.notAfter)}.</p>
      <p class="manual">
        {#if platform.id === 'windows'}
          To install it by hand, download the certificate as <a href="/api/tls/certificate?format=der" download>.cer</a>
          for the Windows certificate store and as <a href="/api/tls/certificate" download>.crt</a> for Zwift's cacert.pem.
        {:else}
          To install it by hand, download the certificate as <a href="/api/tls/certificate" download>.crt (PEM)</a>.
        {/if}
      </p>
    </section>
  {/if}
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
  .unsafe {
    border-left: 4px solid #ff6b57;
  }
  .unsafe h2 {
    color: var(--alarm);
  }
  .lead {
    margin-top: 0;
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

  .systems {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.75rem;
    margin: 1.25rem 0 1rem;
  }
  button.system {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto 1fr;
    align-content: start;
    align-items: start;
    gap: 0.2rem 1rem;
    margin: 0;
    padding: 1.1rem 1.25rem;
    border: 2px solid var(--line);
    border-radius: 12px;
    background: var(--well);
    text-align: left;
    text-transform: none;
    letter-spacing: 0;
  }
  button.system:hover {
    border-color: var(--orange);
    background: var(--glass-raised);
  }
  .system .name {
    font-size: 1.375rem;
    font-weight: 800;
  }
  .system .detail {
    grid-column: 1 / -1;
    color: var(--muted);
    font-weight: 600;
  }
  .system .here {
    grid-column: 1;
    justify-self: start;
    margin-top: 0.5rem;
    padding: 0.1rem 0.55rem;
    border: 1px solid var(--orange);
    border-radius: 999px;
    color: var(--text);
    font-size: 0.75rem;
  }
  /* The chevron sits beside the name, so the detail below gets the card's full width in three columns. */
  .system svg {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
    width: 1.5rem;
    height: 1.5rem;
    fill: none;
    stroke: var(--text);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  button.system:hover svg {
    stroke: var(--orange);
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
  /* The unsafe download is never the celebrated orange action: it wears the alarm outline instead. */
  a.download.danger,
  button.danger {
    border: 2px solid rgb(255 179 166 / 0.75);
    background: none;
    box-shadow: none;
    color: var(--alarm);
  }
  a.download.danger {
    padding: 0.55rem 1.1rem;
  }
  a.download.danger:hover {
    background: rgb(255 90 70 / 0.14);
  }
  .risk {
    margin-top: 1.25rem;
    padding: 0.75rem 0.9rem;
    border-left: 3px solid #ff6b57;
    border-radius: 0 8px 8px 0;
    background: rgb(255 90 70 / 0.12);
  }
  .risk p {
    margin: 0;
    color: var(--alarm);
  }
  .risk label.check {
    margin-top: 0.6rem;
  }
  .risk input {
    accent-color: #ff6b57;
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
