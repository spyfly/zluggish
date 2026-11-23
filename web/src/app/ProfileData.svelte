<script lang="ts">
  import { t } from '../lib/i18n/index';
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

  const exportDetails = new Map<string, { title: string; description?: string }>(
    Object.entries({
      'profile.bin': {
        title: t('ProfileData.rider_profile_and_progress'),
        description: t('ProfileData.rider_details_avatar_gear_xp_drops_and_lifetime_totals'),
      },
      'achievements.bin': {
        title: t('ProfileData.achievements'),
      },
      'user_storage.bin': {
        title: t('ProfileData.game_settings_and_bike_upgrades'),
        description: t('ProfileData.in_game_preferences_garage_bike_customizations_and_upgrades'),
      },
      'streaks.bin': {
        title: t('ProfileData.riding_streaks'),
      },
      'economy_config.txt': {
        title: t('ProfileData.level_and_reward_rules'),
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
      message = error instanceof Error ? error.message : t('ProfileData.request_failed');
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
    if (path === '/profile-data') {
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

{#if path === '/profile-data'}
  <nav class="import-options" aria-label={t('ProfileData.import_source')}>
    <a
      href="/profile-data/local"
      onclick={(e) => {
        e.preventDefault();
        void navigate('/profile-data/local');
      }}
    >
      <span class="option-title">{t('ProfileData.import_from_local_files')}</span>
      <span class="option-description">{t('ProfileData.profile_files_from_your_computer')}</span>
    </a>
    <a
      href="/zwift"
      onclick={(e) => {
        e.preventDefault();
        void navigate('/zwift');
      }}
    >
      <span class="option-title">{t('ProfileData.import_from_zwift')}</span>
      <span class="option-description">{t('ProfileData.download_from_your_zwift_account')}</span>
    </a>
  </nav>
{:else if path === '/profile-data/local' || path === '/zwift'}
  <nav aria-label={t('ProfileData.profile_data')}>
    <a
      href="/profile-data"
      onclick={(e) => {
        e.preventDefault();
        void navigate('/profile-data');
      }}>{t('ProfileData.import_export')}</a
    >
  </nav>
{/if}
{#if message}<p class="notice" class:failed role={failed ? 'alert' : 'status'}>{message}</p>{/if}
{#if path === '/profile-data'}
  <section class="panel">
    <h2>{t('ProfileData.export_your_user_data')}</h2>
    <p>{t('ProfileData.download_every_file_to_back_up_your_data_or')}</p>
    {#each filenames as filename (filename)}
      <div class="export-file">
        <h3>{exportDetails.get(filename)?.title ?? filename}</h3>
        {#if exportDetails.get(filename)?.description}<p>{exportDetails.get(filename)?.description}</p>{/if}
        <a href={`/api/me/export/${encodeURIComponent(filename)}`} download={filename}
          >{t('ProfileData.download', { value1: filename })}</a
        >
      </div>
    {:else}
      {#if !busy && !failed}<p>{t('ProfileData.no_files_available_to_export')}</p>{/if}
    {/each}
  </section>
{/if}
{#if path !== '/profile-data' && review}
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
    <h2>{t('ProfileData.confirm_profile_import')}</h2>
    <p>{review.firstName} {review.lastName} ({review.sourceId ?? t('ProfileData.unknown_source')})</p>
    <p>{t('ProfileData.replace', { value1: review.files.join(', ') })}</p>
    {#if review.confirmSource}<label
        ><input type="checkbox" bind:checked={confirmSource} required />
        {t('ProfileData.confirm_this_source_may_differ_or_be_shared_with')}</label
      >{/if}
    <label><input type="checkbox" bind:checked={keepName} /> {t('ProfileData.keep_local_name')}</label>
    <button class="primary" disabled={busy}>{t('ProfileData.confirm_import')}</button>
    <button
      type="button"
      disabled={busy}
      onclick={() =>
        run(async () => {
          await request(ignored, '/api/me/import/confirm', 'POST', { stage: review!.stage, cancel: true });
          review = null;
          message = 'Import canceled. Your user data is unchanged.';
        })}>{t('ProfileData.cancel')}</button
    >
  </form>
{:else if path === '/profile-data/local'}
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
    <button class="primary" disabled={busy || !filenames.length}>{t('ProfileData.review_import')}</button>
  </form>
{:else if path === '/zwift' && connection}
  <p>
    {connection.connected
      ? t('ProfileData.credentials_saved_leave_username_and_password_blank_to_keep')
      : t('ProfileData.save_your_official_zwift_credentials_to_connect')}
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
    <label for="zwift-username">{t('ProfileData.username')}</label>
    <input id="zwift-username" autocomplete="username" bind:value={username} disabled={busy} />
    <label for="zwift-password">{t('ProfileData.password')}</label>
    <input id="zwift-password" type="password" autocomplete="new-password" bind:value={password} disabled={busy} />
    <label
      ><input type="checkbox" bind:checked={connection.upload} /> {t('ProfileData.upload_activities_to_zwift')}</label
    >
    <label
      ><input type="checkbox" bind:checked={connection.click} />
      {t('ProfileData.enable_zwift_click_authentication')}</label
    >
    <button class="primary" disabled={busy}>{t('ProfileData.save_connection')}</button>
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
      <h2>{t('ProfileData.download_user_data')}</h2>
      <label><input type="checkbox" bind:checked={profile} /> {t('ProfileData.download_profile_and_economy')}</label>
      <label><input type="checkbox" bind:checked={achievements} /> {t('ProfileData.download_achievements')}</label>
      <button class="primary" disabled={busy || (!profile && !achievements)}
        >{t('ProfileData.download_and_review_import')}</button
      >
    </form>
    <section class="panel">
      {#if removing}
        <p>{t('ProfileData.remove_zwift_credentials')}</p>
        <button
          disabled={busy}
          onclick={() =>
            run(async () => {
              connection = await request(connectionResponse, '/api/me/zwift', 'DELETE', {});
              removing = false;
              message = 'Credentials removed.';
            })}>{t('ProfileData.remove_credentials')}</button
        >
        <button disabled={busy} onclick={() => (removing = false)}>{t('ProfileData.cancel')}</button>
      {:else}<button disabled={busy} onclick={() => (removing = true)}>{t('ProfileData.remove_credentials')}</button
        >{/if}
    </section>
  {/if}
{/if}

<style>
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
