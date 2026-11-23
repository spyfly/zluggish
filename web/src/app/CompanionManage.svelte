<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { onDestroy, onMount } from 'svelte';
  import { z } from 'zod';
  import type { CompanionAdminStatus, CompanionStep } from './companion';
  import { companionAdminStatus, megabytes } from './companion';
  import JobProgress from './JobProgress.svelte';

  let {
    api,
    navigate,
    csrf,
  }: {
    api: <Schema extends z.ZodType>(
      schema: Schema,
      url: string,
      method?: string,
      data?: Record<string, never>,
    ) => Promise<z.output<Schema>>;
    navigate: (path: string) => Promise<void>;
    /** The current CSRF token, for the upload that bypasses the JSON helper to report progress. */
    csrf: () => string;
  } = $props();

  let admin = $state<CompanionAdminStatus | null>(null);
  let failure = $state('');
  let notice = $state('');
  let working = $state(false);

  /** The upload, before the server's job takes over. Its bytes per second are a smoothed average. */
  let upload = $state<{
    name: string;
    size: number;
    sent: number;
    rate: number | null;
    startedAt: number;
  } | null>(null);
  let uploadError = $state('');
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let request: XMLHttpRequest | null = null;

  const accepted = '.apk,.apks,.xapk,.apkm';
  const failureMessage = z.object({ message: z.string() });
  const certificateReady = $derived(admin?.tlsMode === 'managed' || admin?.tlsMode === 'custom');
  const tools = $derived(admin ? !!admin.toolchain.java && admin.toolchain.editor : false);

  const labels: Record<CompanionStep, string> = {
    upload: t('CompanionManage.uploading'),
    runtime: t('CompanionManage.downloading_java'),
    editor: t('CompanionManage.downloading_apkeditor'),
    inspect: t('CompanionManage.checking_the_file'),
    merge: t('CompanionManage.merging_the_split_apks'),
    decode: t('CompanionManage.unpacking_the_resources'),
    patch: t('CompanionManage.pointing_the_app_at_this_server'),
    build: t('CompanionManage.rebuilding_the_app'),
    sign: t('CompanionManage.signing_the_app'),
    publish: t('CompanionManage.publishing'),
  };

  /** Rough shares of the whole job, for the width of each stretch of the bar. Rebuilding the app dominates. */
  const weights: Record<CompanionStep, number> = {
    upload: 4,
    runtime: 4,
    editor: 1,
    inspect: 1,
    merge: 2,
    decode: 3,
    patch: 1,
    build: 4,
    sign: 2,
    publish: 1,
  };

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  /** One job from the first uploaded byte to the published app: the upload in flight, or the server's job. */
  const job = $derived.by(() => {
    if (upload) {
      // The server picks the steps once it has the file. A full rebuild is the usual case.
      const bundle = !/\.apk$/i.test(upload.name);

      return {
        kind: 'patch' as const,
        state: 'running' as const,
        steps: [
          'upload',
          'inspect',
          ...(bundle ? (['merge'] as const) : []),
          'decode',
          'patch',
          'build',
          'sign',
          'publish',
        ] as Array<CompanionStep>,
        step: 'upload' as CompanionStep,
        progress: upload.size ? upload.sent / upload.size : 0,
        message: null,
        startedAt: upload.startedAt,
        finishedAt: null,
      };
    }

    const activity = admin?.activity;

    if (!activity) {
      return null;
    }

    return {
      ...activity,
      steps: activity.kind === 'patch' ? (['upload', ...activity.steps] as Array<CompanionStep>) : activity.steps,
      startedAt: Date.parse(activity.startedAt),
      finishedAt: activity.finishedAt ? Date.parse(activity.finishedAt) : null,
    };
  });

  const headline = $derived.by(() => {
    if (!job) {
      return '';
    }

    const tools = job.kind === 'toolchain';

    switch (job.state) {
      case 'waiting':
        return t('CompanionManage.waiting_for_the_java_tools');
      case 'done':
        return tools
          ? t('CompanionManage.the_java_tools_are_ready')
          : t('CompanionManage.published_companion', { value1: admin?.app?.versionName ?? '' });
      case 'failed':
        return tools ? t('CompanionManage.the_download_stopped') : t('CompanionManage.the_patch_stopped');
      default:
        if (upload) {
          return t('CompanionManage.uploading_2', { value1: upload.name });
        }

        return tools
          ? t('CompanionManage.downloading_the_java_tools')
          : job.kind === 'rekey'
            ? t('CompanionManage.adding_the_new_certificate')
            : t('CompanionManage.patching_companion_for_this_server');
    }
  });

  const detail = $derived.by(() => {
    if (!job) {
      return '';
    }

    const tools = job.kind === 'toolchain';

    switch (job.state) {
      case 'waiting':
        return t('CompanionManage.continues_once_the_java_tools_are_ready');
      case 'done':
        return tools ? t('CompanionManage.ready_to_rebuild_apps') : t('CompanionManage.riders_can_download_it_now');
      case 'failed':
        return tools ? t('CompanionManage.the_download_failed') : t('CompanionManage.the_patch_failed');
      default:
        return upload ? t('CompanionManage.keep_this_page_open_until_the_upload_finishes') : `${labels[job.step]}…`;
    }
  });

  async function refresh() {
    try {
      admin = await api(companionAdminStatus, '/api/manage/companion');
    } catch (error) {
      failure = error instanceof Error ? error.message : t('CompanionManage.the_companion_app_could_not_be_loaded');
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    const running = admin?.activity?.state === 'running';

    if (running && !timer) {
      timer = setInterval(() => void refresh(), 1000);
    } else if (!running && timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  async function act(work: () => Promise<CompanionAdminStatus>, done = '') {
    if (working) {
      return;
    }
    working = true;
    notice = '';
    failure = '';

    try {
      admin = await work();
      notice = done;
    } catch (error) {
      failure = error instanceof Error ? error.message : t('CompanionManage.the_request_failed');
    } finally {
      working = false;
    }
  }

  const installTools = () => act(() => api(companionAdminStatus, '/api/manage/companion/toolchain', 'POST', {}));

  let sample = { at: 0, bytes: 0 };

  function sent(bytes: number) {
    if (!upload) {
      return;
    }

    const at = performance.now();
    const seconds = (at - sample.at) / 1000;
    let { rate } = upload;

    if (seconds >= 0.5) {
      const measured = (bytes - sample.bytes) / seconds;
      rate = rate === null ? measured : rate * 0.8 + measured * 0.2;
      sample = { at, bytes };
    }

    upload = { ...upload, sent: Math.max(upload.sent, bytes), rate };
  }

  /** Send the file as raw bytes, so the server streams it to disk, with progress from the upload events. */
  function send(file: File) {
    uploadError = '';
    notice = '';

    if (!/\.(apk|apks|xapk|apkm)$/i.test(file.name)) {
      uploadError = t('CompanionManage.choose_an_apk_apks_xapk_or_apkm_file');

      return;
    }

    if (admin && file.size > admin.uploadLimit) {
      uploadError = t('CompanionManage.the_file_is_larger_than', { value1: megabytes(admin.uploadLimit) });

      return;
    }

    upload = { name: file.name, size: file.size, sent: 0, rate: null, startedAt: Date.now() };
    sample = { at: performance.now(), bytes: 0 };
    const xhr = new XMLHttpRequest();
    request = xhr;
    xhr.open('PUT', '/api/manage/companion/app');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-CSRF-Token', csrf());
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => sent(event.loaded);

    xhr.onload = () => {
      upload = null;
      request = null;

      // The job started, or waits for the Java tools: the next status shows which.
      if (xhr.status === 202) {
        void refresh();
      } else {
        uploadError =
          failureMessage.safeParse(xhr.response).data?.message ??
          t('CompanionManage.the_upload_failed', { value1: xhr.status });
      }
    };

    xhr.onerror = () => {
      upload = null;
      request = null;
      uploadError = t('CompanionManage.the_upload_stopped_check_the_connection_and_try_again');
    };

    xhr.onabort = () => {
      upload = null;
      request = null;
    };

    xhr.send(file);
  }

  const busy = $derived(!!upload || admin?.activity?.state === 'running');

  function dropped(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files[0];

    if (file && !busy) {
      send(file);
    }
  }

  function go(event: MouseEvent, to: string) {
    event.preventDefault();
    void navigate(to);
  }

  onMount(refresh);

  onDestroy(() => {
    if (timer) {
      clearInterval(timer);
    }
    request?.abort();
  });
</script>

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}

{#if admin === null}
  {#if !failure}<p role="status">{t('CompanionManage.loading')}</p>{/if}
{:else}
  <section class="panel" aria-labelledby="companion-app">
    <h2 id="companion-app">{t('CompanionManage.companion_for_android')}</h2>
    <p class="lead">
      {t('CompanionManage.upload_zwift_companion_and_the_server_patches_it_to')}
      <a href="/apps" onclick={(event) => go(event, '/apps')}>{t('CompanionManage.apps')}</a>.
    </p>

    {#if !certificateReady}
      <p class="stale">
        {#if admin.tlsMode === 'legacy'}
          {t('CompanionManage.replace_the_shared_certificate_before_building_companion_for_android')}
        {:else}
          {t('CompanionManage.this_server_has_no_certificate_for_companion_to_trust')}
        {/if}
      </p>
    {/if}

    {#if admin.app}
      <dl class="facts">
        <div>
          <dt>{t('CompanionManage.version')}</dt>
          <dd>{admin.app.versionName}</dd>
        </div>
        <div>
          <dt>{t('CompanionManage.size')}</dt>
          <dd>{megabytes(admin.app.bytes)}</dd>
        </div>
        <div>
          <dt>{t('CompanionManage.patched')}</dt>
          <dd>{day(admin.app.createdAt)}</dd>
        </div>
        <div>
          <dt>{t('CompanionManage.certificate')}</dt>
          <dd class:alarm={!admin.app.current}>
            {admin.app.current ? t('CompanionManage.current') : t('CompanionManage.outdated')}
          </dd>
        </div>
      </dl>
    {/if}

    {#if job}
      <JobProgress id="companion-job" {job} {labels} {weights} {headline} {detail} {upload}>
        {#if upload}
          <button type="button" onclick={() => request?.abort()}>{t('CompanionManage.stop_upload')}</button>
        {:else if job.state === 'running'}
          {#if job.kind === 'toolchain' && admin.pending}
            <p class="hint">{t('CompanionManage.your_upload_continues_once_they_are_ready')}</p>
          {/if}
          <button
            type="button"
            disabled={working}
            onclick={() => act(() => api(companionAdminStatus, '/api/manage/companion/cancel', 'POST', {}))}
            >{t('CompanionManage.stop')}</button
          >
          <p class="hint">{t('CompanionManage.the_job_continues_if_you_leave_this_page')}</p>
        {:else if admin.pending}
          {#if admin.toolchain.supported}
            <p class="ask">
              {t('CompanionManage.this_app_needs_a_rebuild_with_java_the_server', {
                value1: admin.toolchain.java ? 'APKEditor' : t('CompanionManage.java_and_apkeditor'),
                value2: megabytes(admin.toolchain.downloadBytes),
              })}
            </p>
            <button type="button" class="primary" disabled={working} onclick={installTools}
              >{t('CompanionManage.download_java_tools_and_continue')}</button
            >
          {:else}
            <p class="ask">{t('CompanionManage.this_app_needs_a_rebuild_with_java_install_java')}</p>
          {/if}
          <button
            type="button"
            disabled={working}
            onclick={() =>
              act(() => api(companionAdminStatus, '/api/manage/companion/pending', 'DELETE', {}), 'Upload discarded.')}
            >{t('CompanionManage.discard_upload')}</button
          >
        {/if}
      </JobProgress>
    {/if}

    {#if !busy && !admin.pending}
      <label
        class="drop"
        class:dragging
        class:disabled={!certificateReady}
        ondragover={(event) => {
          event.preventDefault();
          dragging = certificateReady;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={dropped}
      >
        <input
          bind:this={fileInput}
          type="file"
          accept={accepted}
          disabled={!certificateReady}
          onchange={() => {
            const file = fileInput?.files?.[0];

            if (file) send(file);

            if (fileInput) fileInput.value = '';
          }}
        />
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-5 5m5-5 5 5M5 20h14" /></svg>
        <span class="title"
          >{admin.app ? t('CompanionManage.upload_a_newer_companion') : t('CompanionManage.upload_companion')}</span
        >
        <span class="detail"
          >{t('CompanionManage.drop_or_choose_an_apk_apks_xapk_or_apkm', {
            value1: megabytes(admin.uploadLimit),
          })}</span
        >
      </label>
    {/if}
    {#if uploadError}<p class="notice failed" role="alert">{uploadError}</p>{/if}

    {#if admin.app}
      <button
        type="button"
        disabled={working || busy}
        onclick={() => act(() => api(companionAdminStatus, '/api/manage/companion/app', 'DELETE', {}), 'App removed.')}
        >{t('CompanionManage.remove_the_app')}</button
      >
    {/if}
    {#if notice}<p class="hint" role="status">{notice}</p>{/if}
  </section>

  <section class="panel" aria-labelledby="companion-tools">
    <h2 id="companion-tools">{t('CompanionManage.java_tools')}</h2>
    {#if tools && admin.toolchain.java}
      <p>
        {t('CompanionManage.ready_using', {
          value1:
            admin.toolchain.java.source === 'system'
              ? t('CompanionManage.the_server_s_java', { value1: admin.toolchain.java.version })
              : t('CompanionManage.java', { value1: admin.toolchain.java.version }),
        })}
      </p>
      <p class="hint">{t('CompanionManage.stored_in', { value1: admin.toolchain.folder })}</p>
      <button
        type="button"
        disabled={working || busy}
        onclick={() =>
          act(() => api(companionAdminStatus, '/api/manage/companion/toolchain', 'DELETE', {}), 'Java tools removed.')}
        >{t('CompanionManage.remove_java_tools')}</button
      >
    {:else if !admin.toolchain.supported}
      <p>{t('CompanionManage.install_java_11_or_later_on_the_server_to')}</p>
    {:else}
      <p>
        {t('CompanionManage.java_tools_installed_automatically', {
          size: megabytes(admin.toolchain.downloadBytes),
        })}
      </p>
      <p class="hint">{t('CompanionManage.stored_in_outside_backups', { value1: admin.toolchain.folder })}</p>
    {/if}
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
    margin: 0 0 1.25rem;
  }
  .lead a {
    color: inherit;
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

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.75rem 1rem;
    margin: 0 0 1.25rem;
  }
  .facts dt {
    color: var(--muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .facts dd {
    margin: 0.1rem 0 0;
    font-size: 1.125rem;
    font-weight: 800;
  }
  .facts dd.alarm {
    color: var(--alarm);
  }

  .drop {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    padding: 1.5rem 1rem;
    border: 2px dashed var(--line);
    border-radius: 12px;
    background: var(--well);
    text-align: center;
    cursor: pointer;
  }
  .drop input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .drop:hover,
  .drop.dragging,
  .drop:focus-within {
    border-color: var(--orange);
  }
  .drop:focus-within {
    outline: 2px solid var(--orange);
    outline-offset: 2px;
  }
  .drop.disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .drop.disabled input {
    cursor: not-allowed;
  }
  .drop svg {
    width: 2rem;
    height: 2rem;
    fill: none;
    stroke: var(--orange);
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .drop .title {
    color: var(--text);
    font-weight: 800;
    font-size: 1.0625rem;
  }
  .drop .detail {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .ask {
    margin: 1rem 0 0;
  }
</style>
