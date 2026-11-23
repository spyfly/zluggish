<script lang="ts">
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

  const names = { android: 'Android', rooted: 'Android, rooted', ios: 'iPhone and iPad' } as const;

  let status = $state<TlsStatus | null>(null);
  let failure = $state('');

  const legacy = $derived(status?.mode === 'legacy');
  const address = $derived(status?.serverAddress ?? '<server-ip>');

  /** The name the server gives the certificate download, so the adb commands match the file. */
  const file = $derived(
    legacy
      ? 'zluggish-zwift-shared.crt'
      : `zluggish-zwift-${(status?.certificate?.thumbprint ?? '').slice(0, 8).toLowerCase()}.crt`,
  );

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
      `adb push ${file} ${data}/zluggish.crt`,
      `adb shell "cat ${data}/zluggish.crt >> ${data}/cacert.pem"`,
    ].join('\n'),
    etcHosts: `${address} us-or-rly101.zwift.com secure.zwift.com cdn.zwift.com`,
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
    if (platform === 'android' && status && status.mode !== 'disabled') {
      api(zwiftAndroidStatus, '/api/install/android')
        .then((body) => {
          zwift = body;
        })
        .catch((error: unknown) => {
          zwiftFailure = error instanceof Error ? error.message : 'Zwift for Android could not be loaded.';
        });
    }
  });

  onMount(async () => {
    try {
      status = await api(tlsStatus, '/api/tls');
    } catch (error) {
      failure = error instanceof Error ? error.message : 'The certificate could not be loaded.';
    }
  });
</script>

{#snippet code(key: keyof typeof blocks)}
  <div class="command">
    <code>{blocks[key]}</code>
    {#if canCopy}
      <button type="button" class="copy" onclick={() => copy(key)} aria-live="polite"
        >{copied === key ? 'Copied' : 'Copy'}</button
      >
    {/if}
  </div>
{/snippet}

{#snippet switcher()}
  <p class="switch">
    {platform === 'ios' ? names.ios : `Setting up ${names[platform]}`}.
    <a href="/apps" onclick={(event) => go(event, '/apps')}>Choose another system</a>
  </p>
{/snippet}

{#snippet manageLink()}
  <a href="/manage/zwift-android" onclick={(event) => go(event, '/manage/zwift-android')}>Manage → Zwift for Android</a>
{/snippet}

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}

{#if platform === 'ios'}
  <section class="panel" aria-labelledby="install-ios">
    {@render switcher()}
    <h2 id="install-ios">Zwift on iPhone and iPad cannot use this server</h2>
    <p class="lead">Zwift connects only to servers it trusts, and iOS gives no way to change that:</p>
    <ul class="reasons">
      <li>
        <strong>Zwift keeps its own list of trusted servers.</strong> On a computer or a rooted Android device the setup
        adds this server to that list. On iOS the list is sealed inside the app.
      </li>
      <li>
        <strong>App Store apps are locked.</strong> Each copy is encrypted for the Apple ID that downloaded it, so it cannot
        be changed to trust another server.
      </li>
      <li>
        <strong>iOS runs only apps that Apple signed.</strong> Installing a changed app takes an Apple developer account,
        and the free kind makes you reinstall it every 7 days.
      </li>
    </ul>
    <p class="hint">Ride from a Windows, macOS or Linux computer instead.</p>
  </section>
{:else if status === null}
  {#if !failure}<p role="status">Loading…</p>{/if}
{:else if status.mode === 'disabled'}
  <section class="panel" aria-labelledby="install-plain">
    {@render switcher()}
    <h2 id="install-plain">Nothing to install</h2>
    <p>This server talks to Zwift without a certificate. Ask the server administrator how to connect.</p>
  </section>
{:else if platform === 'android'}
  <section class="panel" aria-label="Android setup steps">
    {@render switcher()}
    {#if legacy}
      <p class="risk">
        This server uses the shared Zwift certificate, whose private key is public. Others on your network could read
        your Zwift traffic, your password included.
      </p>
    {/if}
    {#if zwift?.app && !zwift.app.current}
      <p class="risk" role="status">
        The server certificate changed after Zwift for Zluggish was built, so it cannot connect yet.
        {#if administrator}Build it again under {@render manageLink()}.{:else}Ask the server administrator to build it
          again.{/if}
      </p>
    {/if}

    <ol class="walk">
      <li>
        <h2>Download Zwift for Zluggish</h2>
        {#if zwiftFailure}
          <p class="notice failed" role="alert">{zwiftFailure}</p>
        {:else if zwift === null}
          <p role="status">Loading…</p>
        {:else if zwift.app?.current}
          <p>
            A copy of Zwift made for this server. It installs next to Zwift from Google Play, so you can keep both.
            {#if !onAndroid}Open this page on your Android phone or tablet.{/if}
          </p>
          <a class="download" href="/api/install/android/app" download>Download Zwift {zwift.app.versionName}</a>
          <p class="hint">
            {megabytes(zwift.app.bytes)}, built on {day(zwift.app.createdAt)}. Use Wi-Fi, and keep twice that space
            free.
          </p>
        {:else if !zwift.app}
          <p class="empty">
            There is no Zwift for Android on this server yet.
            {#if administrator}Upload it under {@render manageLink()}.{:else}Ask the server administrator to add it.{/if}
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
        <h2>Send Zwift to this server</h2>
        <p>
          Install <a
            href="https://github.com/x-falcon/Virtual-Hosts/releases/latest"
            target="_blank"
            rel="noopener noreferrer">Virtual Hosts</a
          >, save these lines as <strong>hosts.txt</strong> on the device, and select the file in Virtual Hosts:
        </p>
        {@render code('hosts')}
        <p class="hint">
          Turn off <strong>Private DNS</strong> in the Android settings. If the server runs its own DNS, set it as the Wi-Fi
          network’s DNS instead.
        </p>
      </li>
      <li>
        <h2>Ride</h2>
        <p>
          Turn on Virtual Hosts, open <strong>Zwift for Zluggish</strong> and sign in with your account on this server.
        </p>
        <p class="hint">
          The first start unpacks the game files, which takes a few minutes. Turn Virtual Hosts off before you open
          Zwift from Google Play.
        </p>
      </li>
    </ol>
  </section>
{:else if status.certificate}
  <section class="panel" aria-label="Rooted Android setup steps">
    {@render switcher()}
    <ol class="walk">
      <li>
        <h2>Start Zwift once</h2>
        <p>Install Zwift and start it once, so that it downloads its extra files. Then close it.</p>
        <p class="hint">The file Zwift trusts servers from, cacert.pem, exists only after this first start.</p>
      </li>
      <li>
        <h2>Add the certificate</h2>
        <p>
          Download the certificate and add it to the end of <strong class="path">{data}/cacert.pem</strong>. With
          <code class="inline">adb</code> as root:
        </p>
        <a class="download" class:danger={legacy} href="/api/tls/certificate" download
          >{legacy ? 'Download shared certificate' : 'Download certificate'}</a
        >
        {@render code('certificate')}
        <p class="hint">Keep the owner and permissions of cacert.pem as they are.</p>
      </li>
      <li>
        <h2>Send Zwift to this server</h2>
        <p>Add this line to the end of <strong>/etc/hosts</strong> on the device:</p>
        {@render code('etcHosts')}
        <p class="hint">
          Without an editor on the device, copy the file over with <code class="inline">adb pull /etc/hosts</code>, edit
          it, and put it back with <code class="inline">adb push hosts /etc/hosts</code>. A router that can change DNS
          records works too.
        </p>
      </li>
      <li>
        <h2>Ride</h2>
        <p>Start Zwift and sign in with your account on this server.</p>
      </li>
    </ol>
  </section>

  <section class="panel" aria-labelledby="install-rooted-certificate">
    <h2 id="install-rooted-certificate">{legacy ? 'Check the shared certificate' : 'Check the certificate'}</h2>
    <p>The downloaded file should have this fingerprint.</p>
    <div class="prints">
      <Fingerprint label="SHA-256 fingerprint" value={status.certificate.fingerprint256} />
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
  /* The shared certificate is never the celebrated orange action: it wears the alarm outline instead. */
  a.download.danger {
    padding: 0.55rem 1.1rem;
    border: 2px solid rgb(255 179 166 / 0.75);
    background: none;
    box-shadow: none;
    color: var(--alarm);
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
