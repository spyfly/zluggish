<script lang="ts">
  import { onMount } from 'svelte';
  import { z } from 'zod';
  import { ignored } from '../lib/api';
  import type { Api } from '../lib/api';

  const reviewSchema = z.object({
    stage: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    sourceId: z.string().nullable(),
    files: z.array(z.string()),
    confirmSource: z.boolean(),
  });

  type Review = z.infer<typeof reviewSchema>;

  /** A staged import, ready for the rider to review. */
  const stagedResponse = z.object({ review: reviewSchema.nullable() });

  const connectionResponse = z.object({ connected: z.boolean(), upload: z.boolean(), click: z.boolean() });

  type Connection = z.infer<typeof connectionResponse>;

  let {
    path,
    request,
    navigate,
    onuser,
  }: {
    path: string;
    request: Api;
    navigate: (path: string) => Promise<void>;
    onuser: () => Promise<void>;
  } = $props();

  let filenames = $state<Array<string>>([]);

  const exportDetails = new Map(
    Object.entries({
      'profile.bin': {
        title: 'Rider profile and progress',
        description: 'Your rider details, avatar and equipped gear, XP, Drops, and lifetime activity totals.',
      },
      'achievements.bin': {
        title: 'Achievements',
        description: 'Your earned achievement badges and completion records.',
      },
      'user_storage.bin': {
        title: 'Game settings and bike upgrades',
        description: 'Your in-game preferences, garage selections, bike customizations, and bike upgrade progress.',
      },
      'streaks.bin': {
        title: 'Riding streaks',
        description: 'Your current and best riding streaks, with their distance, elevation, and calorie totals.',
      },
      'economy_config.txt': {
        title: 'Level and reward rules',
        description: 'The cycling and running level tables, including XP thresholds, Drops rewards, and unlocks.',
      },
    }),
  );

  let review = $state<Review | null>(null);
  let connection = $state<Connection | null>(null);
  let username = $state('');
  let password = $state('');
  let profile = $state(false);
  let achievements = $state(false);
  let keepName = $state(false);
  let confirmSource = $state(false);
  let removing = $state(false);
  let busy = $state(false);
  let message = $state('');
  let failed = $state(false);

  async function run(work: () => Promise<void>) {
    if (busy) {
      return;
    }
    busy = true;
    message = '';
    failed = false;

    try {
      await work();
    } catch (error) {
      failed = true;
      message = error instanceof Error ? error.message : 'Request failed.';
    } finally {
      busy = false;
    }
  }

  function staged(body: z.infer<typeof stagedResponse>) {
    review = body.review;
    keepName = false;
    confirmSource = false;
  }

  onMount(() => {
    if (path === '/import') {
      return;
    }

    if (path === '/export') {
      void run(async () => {
        filenames = (await request(z.object({ filenames: z.array(z.string()) }), '/api/me/export')).filenames;
      });

      return;
    }

    void run(async () => {
      const body = await request(
        z.object({ filenames: z.array(z.string()), review: reviewSchema.nullable() }),
        '/api/me/import',
      );
      filenames = body.filenames;
      review = body.review;
      connection = await request(connectionResponse, '/api/me/zwift');
    });
  });
</script>

{#if path === '/export'}
  <section class="panel">
    <h2>Export your user data</h2>
    <p>Download individual files to back up your data or transfer it to another Zluggish server using Import.</p>
    <p class="export-help">
      For all available profile data, download every file. The .bin files are binary data; economy_config.txt contains
      JSON.
    </p>
    {#each filenames as filename (filename)}
      <div class="export-file">
        <h3>{exportDetails.get(filename)?.title ?? filename}</h3>
        {#if exportDetails.get(filename)}<p>{exportDetails.get(filename)?.description}</p>{/if}
        <a href={`/api/me/export/${encodeURIComponent(filename)}`} download={filename}>Download {filename}</a>
      </div>
    {:else}
      <p>No files available to export.</p>
    {/each}
  </section>
{:else if path === '/import'}
  <p>Choose how to import your profile data.</p>
  <nav class="import-options" aria-label="Import source">
    <a
      href="/import/local"
      onclick={(e) => {
        e.preventDefault();
        void navigate('/import/local');
      }}
    >
      <span class="option-title">Local files</span>
      <span class="option-description">Upload user data from files on your computer.</span>
    </a>
    <a
      href="/zwift"
      onclick={(e) => {
        e.preventDefault();
        void navigate('/zwift');
      }}
    >
      <span class="option-title">Zwift connection</span>
      <span class="option-description">Connect to Zwift and download your user data.</span>
    </a>
  </nav>
{:else if path === '/import/local' || path === '/zwift'}
  <nav aria-label="Profile data">
    <a
      href="/import"
      onclick={(e) => {
        e.preventDefault();
        void navigate('/import');
      }}>← Import options</a
    >
  </nav>
{/if}
{#if message}<p class="notice" class:failed role={failed ? 'alert' : 'status'}>{message}</p>{/if}
{#if path !== '/import' && path !== '/export' && review}
  <form
    class="panel"
    onsubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        await request(ignored, '/api/me/import/confirm', 'POST', { stage: review!.stage, keepName, confirmSource });
        review = null;
        await onuser();
        message = 'Profile data imported.';
      });
    }}
  >
    <h2>Confirm profile import</h2>
    <p>{review.firstName} {review.lastName} ({review.sourceId ?? 'unknown source'})</p>
    <p>Replace: {review.files.join(', ')}</p>
    {#if review.confirmSource}<label
        ><input type="checkbox" bind:checked={confirmSource} required /> Confirm this source may differ or be shared with
        another user</label
      >{/if}
    <label><input type="checkbox" bind:checked={keepName} /> Keep local name</label>
    <button class="primary" disabled={busy}>Confirm import</button>
    <button
      type="button"
      disabled={busy}
      onclick={() =>
        run(async () => {
          await request(ignored, '/api/me/import/confirm', 'POST', { stage: review!.stage, cancel: true });
          review = null;
          message = 'Import canceled. Your user data is unchanged.';
        })}>Cancel</button
    >
  </form>
{:else if path === '/import/local'}
  <form
    class="panel"
    enctype="multipart/form-data"
    onsubmit={(e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      void run(async () => staged(await request(stagedResponse, '/api/me/import', 'POST', data)));
    }}
  >
    {#each filenames as filename (filename)}
      <label for={filename}>{filename}</label>
      <input id={filename} name={filename} type="file" disabled={busy} />
    {/each}
    <button class="primary" disabled={busy || !filenames.length}>Review import</button>
  </form>
{:else if path === '/zwift' && connection}
  <p>
    {connection.connected
      ? 'Credentials saved. Leave username and password blank to keep them.'
      : 'Save your official Zwift credentials to connect.'}
  </p>
  <form
    class="panel"
    onsubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        connection = await request(connectionResponse, '/api/me/zwift', 'PUT', {
          username,
          password,
          upload: connection!.upload,
          click: connection!.click,
        });
        username = '';
        password = '';
        message = 'Connection settings saved.';
      });
    }}
  >
    <label for="zwift-username">Username</label>
    <input id="zwift-username" autocomplete="username" bind:value={username} disabled={busy} />
    <label for="zwift-password">Password</label>
    <input id="zwift-password" type="password" autocomplete="new-password" bind:value={password} disabled={busy} />
    <label><input type="checkbox" bind:checked={connection.upload} /> Upload activities to Zwift</label>
    <label><input type="checkbox" bind:checked={connection.click} /> Enable Zwift Click authentication</label>
    <button class="primary" disabled={busy}>Save connection</button>
  </form>
  {#if connection.connected}
    <form
      class="panel"
      onsubmit={(e) => {
        e.preventDefault();
        void run(async () =>
          staged(await request(stagedResponse, '/api/me/zwift/import', 'POST', { profile, achievements })),
        );
      }}
    >
      <h2>Download user data</h2>
      <label><input type="checkbox" bind:checked={profile} /> Download profile and economy</label>
      <label><input type="checkbox" bind:checked={achievements} /> Download achievements</label>
      <button class="primary" disabled={busy || (!profile && !achievements)}>Download and review import</button>
    </form>
    <section class="panel">
      {#if removing}
        <p>Remove Zwift credentials?</p>
        <button
          disabled={busy}
          onclick={() =>
            run(async () => {
              connection = await request(connectionResponse, '/api/me/zwift', 'DELETE', {});
              removing = false;
              message = 'Credentials removed.';
            })}>Remove credentials</button
        >
        <button disabled={busy} onclick={() => (removing = false)}>Cancel</button>
      {:else}<button disabled={busy} onclick={() => (removing = true)}>Remove credentials</button>{/if}
    </section>
  {/if}
{/if}

<style>
  .export-help {
    color: var(--muted);
  }
  .export-file {
    padding: 1rem 0;
    border-top: 1px solid var(--line);
  }
  .export-file h3 {
    margin: 0;
    font-size: 1rem;
  }
  .export-file p {
    margin: 0.5rem 0;
    color: var(--muted);
  }
  .export-file a {
    overflow-wrap: anywhere;
  }
  .import-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    gap: 1rem;
    max-width: 50rem;
    margin-top: 1.5rem;
  }
  .import-options a {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.75rem;
    min-height: 10rem;
    box-sizing: border-box;
    padding: 1.75rem;
    border: 2px solid var(--line);
    border-radius: 12px;
    background: var(--glass);
    text-decoration: none;
  }
  .import-options a:hover,
  .import-options a:focus-visible {
    border-color: var(--orange);
    background: var(--glass-raised);
  }
  .option-title {
    font-size: 1.25rem;
  }
  .option-description {
    color: var(--muted);
    font-weight: 600;
    font-size: 0.9375rem;
    text-transform: none;
    letter-spacing: normal;
  }

  .panel {
    max-width: 38rem;
    padding: 1.25rem;
    margin: 1rem 0;
    border-radius: 12px;
    background: var(--glass);
  }
  input[type='checkbox'] {
    width: auto;
    margin-right: 0.5rem;
  }
  input[type='file'] {
    width: 100%;
  }
  .failed {
    color: var(--alarm);
  }
</style>
