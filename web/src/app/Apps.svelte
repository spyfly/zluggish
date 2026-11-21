<script lang="ts">
  import type { z } from 'zod';
  import { onMount } from 'svelte';
  import { companionStatus } from './companion';
  import type { CompanionStatus } from './companion';
  import { detect, isComputer, isPhone } from './device';
  import { tlsStatus } from './tls';
  import type { TlsStatus } from './tls';

  let {
    api,
    navigate,
    administrator,
  }: {
    api: <Schema extends z.ZodType>(schema: Schema, url: string) => Promise<z.output<Schema>>;
    navigate: (path: string) => Promise<void>;
    administrator: boolean;
  } = $props();

  type Row = { to: string; name: string; detail: string; tag?: string; unavailable?: boolean };

  const here = detect();
  const onComputer = isComputer(here);
  const onPhone = isPhone(here);

  let tls = $state<TlsStatus | null>(null);
  let companion = $state<CompanionStatus | null>(null);
  let tlsFailure = $state('');
  let companionFailure = $state('');
  let loaded = $state(false);

  const mark = (device: string, tag: string) => (here === device ? tag : undefined);

  const systems = $derived<Array<Row>>([
    {
      to: '/install/windows',
      name: 'Windows',
      detail: 'Zwift installed from zwift.com',
      tag: mark('windows', 'This computer'),
    },
    {
      to: '/install/macos',
      name: 'macOS',
      detail: 'Zwift installed from zwift.com',
      tag: mark('macos', 'This computer'),
    },
    {
      to: '/install/linux',
      name: 'Linux',
      detail: 'Zwift in Wine, Lutris, Bottles or Steam',
      tag: mark('linux', 'This computer'),
    },
    {
      to: '/install/android',
      name: 'Android',
      detail: 'Zwift from Google Play, with a patched expansion file',
      tag: mark('android', 'This device'),
      unavailable: tls?.mode === 'disabled',
    },
    { to: '/install/android-rooted', name: 'Android, rooted', detail: 'Certificate and hosts file added by hand' },
    {
      to: '/install/ios',
      name: 'iPhone and iPad',
      detail: 'Not supported',
      tag: mark('ios', 'This device'),
      unavailable: true,
    },
  ]);

  const phones = $derived<Array<Row>>([
    {
      to: '/companion/android',
      name: 'Android',
      detail: !companion?.app
        ? 'Not added to this server yet'
        : companion.app.current
          ? `Companion ${companion.app.versionName} for this server`
          : `Companion ${companion.app.versionName}, made for an old certificate`,
      tag: mark('android', 'This phone'),
    },
    {
      to: '/companion/ios',
      name: 'iPhone and iPad',
      detail: 'Not supported',
      tag: mark('ios', 'This phone'),
      unavailable: true,
    },
  ]);

  /** The system this browser runs on, when Zwift can be set up there: it gets the button, the rest fold away. */
  const featured = $derived(systems.find((row) => row.tag && !row.unavailable) ?? null);
  let others = $state(false);

  function go(event: MouseEvent, to: string) {
    event.preventDefault();
    void navigate(to);
  }

  const reason = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

  onMount(async () => {
    const [certificate, app] = await Promise.allSettled([
      api(tlsStatus, '/api/tls'),
      api(companionStatus, '/api/companion'),
    ]);

    if (certificate.status === 'fulfilled') {
      tls = certificate.value;
    } else {
      tlsFailure = reason(certificate.reason, 'The setup could not be loaded.');
    }

    if (app.status === 'fulfilled') {
      companion = app.value;
    } else {
      companionFailure = reason(app.reason, 'The Companion app could not be loaded.');
    }

    loaded = true;
  });
</script>

{#snippet rows(list: Array<Row>)}
  <ul class="rows">
    {#each list as row (row.to)}
      <li>
        <a
          class="row"
          class:here={!!row.tag}
          class:unavailable={row.unavailable}
          href={row.to}
          onclick={(event) => go(event, row.to)}
        >
          <span class="line">
            <span class="name">{row.name}</span>
            {#if row.tag}<span class="tag">{row.tag}</span>{/if}
          </span>
          <span class="detail">{row.detail}</span>
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

{#if !loaded}
  <p role="status">Loading…</p>
{:else}
  <div class="apps">
    <section class="product zwift" aria-labelledby="apps-zwift">
      <header>
        <svg class="device" class:lit={onComputer} viewBox="0 0 48 40" aria-hidden="true">
          <rect class="body" x="2" y="2" width="44" height="28" rx="4" />
          <rect class="screen" x="6" y="6" width="36" height="20" rx="1.5" />
          <path class="body" d="M24 30v6M16 37.5h16" />
        </svg>
        <div>
          <h2 id="apps-zwift">Zwift</h2>
          <p class="where">On the device you ride with</p>
        </div>
      </header>

      {#if tlsFailure}
        <p class="failed" role="alert">{tlsFailure}</p>
      {:else if tls?.mode === 'disabled'}
        <p class="lead">
          This server talks to Zwift without a certificate, so there is nothing to install. Ask the server administrator
          how to connect.
        </p>
      {:else if tls}
        <p class="lead">
          Zwift only talks to a server it trusts. The setup makes your device trust this server and sends Zwift here
          instead of to Zwift's own servers.
        </p>
        {#if tls.mode === 'legacy'}
          <p class="risk">
            This server still uses the shared Zwift certificate, whose private key is public. Others on your network
            could read your Zwift traffic, your password included.
          </p>
        {/if}
        {#if featured}
          <a class="setup" href={featured.to} onclick={(event) => go(event, featured.to)}>Set up {featured.name}</a>
          <p class="featured-detail">{featured.detail}</p>
          <button
            type="button"
            class="others"
            aria-expanded={others}
            aria-controls="apps-other-systems"
            onclick={() => (others = !others)}
          >
            Other systems
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div id="apps-other-systems" hidden={!others}>
            {@render rows(systems.filter((row) => row !== featured))}
          </div>
        {:else}
          {@render rows(systems)}
        {/if}
      {/if}
    </section>

    <section class="product companion" aria-labelledby="apps-companion">
      <header>
        <svg class="device" class:lit={onPhone} viewBox="0 0 48 40" aria-hidden="true">
          <rect class="body" x="13" y="1" width="22" height="38" rx="4.5" />
          <rect class="screen" x="16.5" y="5" width="15" height="27" rx="1.5" />
          <path class="body" d="M21.5 35.5h5" />
        </svg>
        <div>
          <h2 id="apps-companion">Zwift Companion</h2>
          <p class="where">On your phone, next to the bike</p>
        </div>
      </header>

      {#if companionFailure}
        <p class="failed" role="alert">{companionFailure}</p>
      {:else}
        <p class="lead">
          Companion only talks to a server it trusts. This server gives you a copy of the app that does.
        </p>
        {@render rows(phones)}
        {#if companion && !companion.app}
          <p class="hint">
            {#if administrator}
              Upload the app under <a href="/manage/companion" onclick={(event) => go(event, '/manage/companion')}
                >Manage → Companion</a
              >.
            {:else}
              Ask the server administrator to add it.
            {/if}
          </p>
        {/if}
      {/if}
    </section>
  </div>
{/if}

<style>
  /* Two panels side by side once the content area fits them, stacked otherwise. */
  .apps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    align-items: start;
    gap: 1rem;
    max-width: 64rem;
  }
  .product {
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    border-radius: 14px;
    background: var(--glass);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }

  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.5rem;
    text-transform: none;
    letter-spacing: -0.01em;
  }
  .where {
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  /* The device drawing lights its screen when the page is open on that kind of device. */
  .device {
    flex: none;
    width: 3.25rem;
    height: auto;
  }
  .device .body {
    fill: none;
    stroke: var(--text);
    stroke-width: 2.25;
    stroke-linecap: round;
  }
  .device .screen {
    fill: rgb(255 255 255 / 0.1);
  }
  .device.lit .screen {
    fill: var(--orange);
  }

  .lead {
    margin: 0 0 1.25rem;
  }
  /* The detected system is one confident action; the full list waits behind a quiet toggle. */
  a.setup {
    align-self: flex-start;
    padding: 0.75rem 1.6rem;
    border-radius: 10px;
    background: var(--orange);
    box-shadow: 0 3px 0 var(--orange-deep);
    color: var(--text);
    font-weight: 800;
    font-size: 0.9375rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    text-decoration: none;
  }
  a.setup:hover {
    background: #f06a1e;
  }
  a.setup:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--orange-deep);
  }
  a.setup:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 3px;
  }
  .featured-detail {
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }
  button.others {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 0.3rem;
    margin: 1rem 0 0;
    padding: 0;
    border: 0;
    background: none;
    box-shadow: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.875rem;
    text-transform: none;
    letter-spacing: 0;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  button.others:hover {
    background: none;
    color: var(--text);
  }
  button.others svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.15s ease;
  }
  button.others[aria-expanded='true'] svg {
    transform: rotate(180deg);
  }
  #apps-other-systems {
    margin-top: 0.75rem;
  }
  @media (prefers-reduced-motion: reduce) {
    button.others svg {
      transition: none;
    }
  }

  .hint {
    margin: 1rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }
  .hint a {
    color: inherit;
  }
  .failed {
    margin: 0;
    padding-left: 0.75rem;
    border-left: 3px solid #ff6b57;
    color: var(--alarm);
  }
  .risk {
    margin: 0 0 1.25rem;
    padding: 0.75rem 0.9rem;
    border-left: 3px solid #ff6b57;
    border-radius: 0 8px 8px 0;
    background: rgb(255 90 70 / 0.12);
    color: var(--alarm);
  }

  /* One grouped list per app: the systems read as choices of the same thing, not as separate tiles. */
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--well);
    overflow: hidden;
  }
  .rows li + li {
    border-top: 1px solid var(--line);
  }
  a.row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.2rem 1rem;
    padding: 0.85rem 1rem 0.85rem 1.1rem;
    color: var(--text);
    text-decoration: none;
    box-shadow: inset 3px 0 0 transparent;
  }
  a.row:hover {
    background: var(--glass-raised);
  }
  a.row:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: -2px;
  }
  .row .name {
    font-size: 1.125rem;
    font-weight: 800;
  }
  .row .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.6rem;
  }
  .row .tag {
    white-space: nowrap;
    padding: 0.05rem 0.5rem;
    border: 1px solid var(--orange);
    border-radius: 999px;
    font-size: 0.75rem;
  }
  .row .detail {
    grid-column: 1;
    color: var(--muted);
    font-size: 0.875rem;
  }
  .row .chevron {
    grid-column: 2;
    grid-row: 1 / 3;
    width: 1.25rem;
    height: 1.25rem;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  a.row:hover .chevron {
    stroke: var(--orange);
  }
  /* The system this browser runs on carries the orange edge: most riders want exactly that row. */
  a.row.here {
    box-shadow: inset 3px 0 0 var(--orange);
  }
  /* Not supported, but still a door: it opens the reason. Quiet, never orange. */
  a.row.unavailable .name {
    color: var(--muted);
  }
  a.row.unavailable.here {
    box-shadow: inset 3px 0 0 var(--muted);
  }
  a.row.unavailable .tag {
    border-color: var(--muted);
    color: var(--muted);
  }
  a.row.unavailable:hover {
    background: rgb(255 255 255 / 0.04);
  }
  a.row.unavailable:hover .chevron {
    stroke: var(--text);
  }
</style>
