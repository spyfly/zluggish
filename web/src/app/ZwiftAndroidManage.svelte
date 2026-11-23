<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { onDestroy, onMount } from 'svelte';
  import { z } from 'zod';
  import type { Api } from '../lib/api';
  import { ignored } from '../lib/api';
  import { megabytes } from './companion';
  import JobProgress from './JobProgress.svelte';
  import type { ZwiftAndroidAdminStatus, ZwiftAndroidStep } from './zwift-android';
  import { zwiftAndroidAdminStatus, zwiftAndroidUpload } from './zwift-android';

  let {
    api,
    navigate,
    csrf,
  }: {
    api: Api;
    navigate: (path: string) => Promise<void>;
    /** The current CSRF token, for the chunk uploads that bypass the JSON helper to report progress. */
    csrf: () => string;
  } = $props();

  type Step = 'upload' | ZwiftAndroidStep;

  const endpoint = '/api/manage/zwift-android';

  let admin = $state<ZwiftAndroidAdminStatus | null>(null);
  let failure = $state('');
  let notice = $state('');
  let working = $state(false);
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement>();

  /** The upload in flight. Its bytes per second come from a smoothed average, so the time left does not jump. */
  let upload = $state<{
    name: string;
    size: number;
    sent: number;
    rate: number | null;
    startedAt: number;
  } | null>(null);
  let uploadError = $state('');
  let transfer: AbortController | undefined;

  const labels: Record<Step, string> = {
    upload: t('ZwiftAndroidManage.uploading'),
    extract: t('ZwiftAndroidManage.unpacking_the_game_files'),
    certificate: t('ZwiftAndroidManage.adding_this_server_s_certificate'),
    inspect: t('ZwiftAndroidManage.checking_the_app'),
    runtime: t('ZwiftAndroidManage.downloading_java'),
    editor: t('ZwiftAndroidManage.downloading_apkeditor'),
    merge: t('ZwiftAndroidManage.merging_the_split_apks'),
    decode: t('ZwiftAndroidManage.unpacking_the_app'),
    rename: t('ZwiftAndroidManage.renaming_it_zwift_for_zluggish'),
    build: t('ZwiftAndroidManage.rebuilding_the_app'),
    sign: t('ZwiftAndroidManage.packing_and_signing'),
    publish: t('ZwiftAndroidManage.publishing'),
  };

  /** Rough shares of the whole job, for the width of each stretch of the bar. Copying gigabytes dominates. */
  const weights: Record<Step, number> = {
    upload: 8,
    extract: 3,
    certificate: 3,
    inspect: 1,
    runtime: 1,
    editor: 1,
    merge: 1,
    decode: 2,
    rename: 1,
    build: 2,
    sign: 5,
    publish: 1,
  };

  const certificateReady = $derived(admin?.tlsMode === 'managed' || admin?.tlsMode === 'custom');
  const apkMirror = 'https://www.apkmirror.com/apk/zwift-inc/zwift/';
  /** Short of the room a build needs. The upload still starts; the server refuses only one that cannot fit at all. */
  const lowSpace = $derived(!!admin && admin.disk.free !== null && admin.disk.free < admin.disk.recommended);

  /** The steps a build will take, before the server says: the tool downloads only when the tools are missing. */
  const predicted = $derived<Array<ZwiftAndroidStep>>([
    'extract',
    'certificate',
    'inspect',
    ...(admin?.tools.ready ? [] : (['runtime', 'editor'] as const)),
    'merge',
    'decode',
    'rename',
    'build',
    'sign',
    'publish',
  ]);

  /** One job from the first uploaded byte to the published app: the upload in flight, or the server's build. */
  const job = $derived.by(() => {
    if (upload) {
      return {
        state: 'running' as const,
        steps: ['upload', ...predicted] as Array<Step>,
        step: 'upload' as Step,
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
      steps: (activity.kind === 'upload' ? ['upload', ...activity.steps] : activity.steps) as Array<Step>,
      startedAt: Date.parse(activity.startedAt),
      finishedAt: activity.finishedAt ? Date.parse(activity.finishedAt) : null,
    };
  });

  const headline = $derived.by(() => {
    if (!job) {
      return '';
    }

    if (job.state === 'done') {
      return t('ZwiftAndroidManage.published_zwift', { value1: admin?.app?.versionName ?? '' });
    }

    if (job.state === 'failed') {
      return t('ZwiftAndroidManage.the_build_stopped');
    }

    return upload
      ? t('ZwiftAndroidManage.uploading_2', { value1: upload.name })
      : t('ZwiftAndroidManage.building_zwift_for_zluggish');
  });

  const detail = $derived.by(() => {
    if (!job) {
      return '';
    }

    if (job.state === 'failed') {
      return t('ZwiftAndroidManage.the_build_failed');
    }

    if (job.state === 'done') {
      return t('ZwiftAndroidManage.riders_can_download_it_now');
    }

    return upload ? t('ZwiftAndroidManage.keep_this_page_open_until_the_upload_finishes') : `${labels[job.step]}…`;
  });

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  async function refresh() {
    try {
      admin = await api(zwiftAndroidAdminStatus, endpoint);
    } catch (error) {
      failure = error instanceof Error ? error.message : t('ZwiftAndroidManage.zwift_for_android_could_not_be_loaded');
    }
  }

  let poll: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    const running = admin?.activity?.state === 'running';

    if (running && !poll) {
      poll = setInterval(() => void refresh(), 1000);
    } else if (!running && poll) {
      clearInterval(poll);
      poll = null;
    }
  });

  async function act(work: () => Promise<ZwiftAndroidAdminStatus>, done = '') {
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
      failure = error instanceof Error ? error.message : t('ZwiftAndroidManage.the_request_failed');
    } finally {
      working = false;
    }
  }

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  /** Send one chunk, reporting its bytes as they leave. A network error is a TypeError, which the caller retries. */
  function sendChunk(url: string, file: File, offset: number, size: number, signal: AbortSignal) {
    return new Promise<z.infer<typeof zwiftAndroidUpload>>((resolve, reject) => {
      signal.throwIfAborted();
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      signal.addEventListener('abort', abort, { once: true });
      xhr.open('PUT', `${url}?offset=${offset}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-CSRF-Token', csrf());
      xhr.responseType = 'json';
      xhr.upload.onprogress = (event) => sent(offset + event.loaded);
      xhr.onloadend = () => signal.removeEventListener('abort', abort);
      xhr.onload = () => {
        const result = zwiftAndroidUpload.safeParse(xhr.response);

        if (xhr.status === 200 && result.success) {
          sent(result.data.offset);
          resolve(result.data);
        } else if (xhr.status === 409 || xhr.status >= 500) {
          reject(new TypeError(t('ZwiftAndroidManage.the_transfer_was_interrupted')));
        } else {
          const response = z.object({ message: z.string() }).safeParse(xhr.response);
          reject(
            new Error(response.data?.message ?? t('ZwiftAndroidManage.the_upload_failed', { value1: xhr.status })),
          );
        }
      };
      xhr.onerror = () => reject(new TypeError(t('ZwiftAndroidManage.the_transfer_was_interrupted')));
      xhr.onabort = () => reject(signal.reason);
      xhr.send(file.slice(offset, offset + size));
    });
  }

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

  async function send(file: File) {
    uploadError = '';
    notice = '';

    if (!/\.apkm$/i.test(file.name)) {
      uploadError = t('ZwiftAndroidManage.choose_the_zwift_apkm_bundle');

      return;
    }

    if (admin && file.size > admin.uploadLimit) {
      uploadError = t('ZwiftAndroidManage.the_file_is_larger_than', { value1: megabytes(admin.uploadLimit) });

      return;
    }

    const chunkSize = admin?.chunkSize ?? 16 * 1024 ** 2;
    transfer = new AbortController();
    const { signal } = transfer;
    upload = { name: file.name, size: file.size, sent: 0, rate: null, startedAt: Date.now() };
    sample = { at: performance.now(), bytes: 0 };
    let url: string | undefined;
    let finished = false;

    try {
      let progress = await api(zwiftAndroidUpload, `${endpoint}/uploads`, 'POST', {
        name: file.name,
        size: file.size,
      });
      url = `${endpoint}/uploads/${progress.id}`;
      let retries = 0;

      while (progress.offset < file.size) {
        try {
          progress = await sendChunk(url, file, progress.offset, chunkSize, signal);
          retries = 0;
        } catch (error) {
          if (!(error instanceof TypeError) || signal.aborted || retries === 5) {
            throw error;
          }
          // Resending a chunk that did land is harmless: the server answers with how far it got.
          await pause(500 * 2 ** retries++);
        }
      }
      finished = true;
    } catch (error) {
      if (!signal.aborted) {
        uploadError = error instanceof Error ? error.message : t('ZwiftAndroidManage.the_upload_failed_2');
      }
    } finally {
      const cancel = url;

      if (cancel && !finished) {
        // An in-flight chunk may still hold the server's lock for a moment.
        await api(ignored, cancel, 'DELETE', {}).catch(async () => {
          await pause(1000);
          await api(ignored, cancel, 'DELETE', {}).catch(() => undefined);
        });
      }
      upload = null;
      transfer = undefined;
      await refresh();
    }
  }

  const busy = $derived(!!upload || admin?.activity?.state === 'running');

  function dropped(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files[0];

    if (file && !busy && certificateReady) {
      void send(file);
    }
  }

  function go(event: MouseEvent, to: string) {
    event.preventDefault();
    void navigate(to);
  }

  onMount(refresh);

  onDestroy(() => {
    if (poll) {
      clearInterval(poll);
    }
    transfer?.abort();
  });
</script>

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}

{#if admin === null}
  {#if !failure}<p role="status">{t('ZwiftAndroidManage.loading')}</p>{/if}
{:else}
  <section class="panel" aria-labelledby="zwift-android-app">
    <h2 id="zwift-android-app">{t('ZwiftAndroidManage.zwift_for_android')}</h2>
    <p class="lead">
      {t('ZwiftAndroidManage.upload_zwift_and_the_server_patches_it_to_trust')}
      <a href="/apps" onclick={(event) => go(event, '/apps')}>{t('ZwiftAndroidManage.apps')}</a>.
    </p>

    {#if !certificateReady}
      <p class="stale">
        {#if admin.tlsMode === 'legacy'}
          {t('ZwiftAndroidManage.replace_the_shared_certificate_before_building_zwift_for_android')}
        {:else}
          {t('ZwiftAndroidManage.this_server_has_no_certificate_for_zwift_to_trust')}
        {/if}
      </p>
    {:else if admin.app && !admin.app.current && admin.activity?.state !== 'running'}
      <p class="stale">{t('ZwiftAndroidManage.the_certificate_changed_since_this_build_build_again_so')}</p>
    {/if}

    {#if admin.app}
      <dl class="facts">
        <div>
          <dt>{t('ZwiftAndroidManage.version')}</dt>
          <dd>{admin.app.versionName}</dd>
        </div>
        <div>
          <dt>{t('ZwiftAndroidManage.download')}</dt>
          <dd>{megabytes(admin.app.bytes)}</dd>
        </div>
        <div>
          <dt>{t('ZwiftAndroidManage.built')}</dt>
          <dd>{day(admin.app.createdAt)}</dd>
        </div>
        <div>
          <dt>{t('ZwiftAndroidManage.certificate')}</dt>
          <dd class:alarm={!admin.app.current}>
            {admin.app.current ? t('ZwiftAndroidManage.current') : t('ZwiftAndroidManage.outdated')}
          </dd>
        </div>
      </dl>
    {/if}

    {#if job}
      <JobProgress id="zwift-android-job" {job} {labels} {weights} {headline} {detail} {upload}>
        {#if upload}
          <button type="button" onclick={() => transfer?.abort()}>{t('ZwiftAndroidManage.stop_upload')}</button>
        {:else if job.state === 'running'}
          <button
            type="button"
            disabled={working}
            onclick={() => act(() => api(zwiftAndroidAdminStatus, `${endpoint}/stop`, 'POST', {}))}
            >{t('ZwiftAndroidManage.stop_build')}</button
          >
          <p class="hint">{t('ZwiftAndroidManage.the_build_continues_if_you_leave_this_page')}</p>
        {/if}
      </JobProgress>
    {/if}

    {#if !busy}
      <ol class="fetch">
        <li>
          {t('ZwiftAndroidManage.open')}
          <a href={apkMirror} target="_blank" rel="noopener noreferrer">{t('ZwiftAndroidManage.zwift_on_apkmirror')}</a
          >.
        </li>
        <li>
          {t('ZwiftAndroidManage.download_the')} <strong>{t('ZwiftAndroidManage.bundle_1_obb')}</strong>
          {t('ZwiftAndroidManage.variant_a_large_apkm_file')}
        </li>
        <li>{t('ZwiftAndroidManage.drop_it_below')}</li>
      </ol>
      {#if lowSpace && admin.disk.free !== null}
        <p class="stale" role="status">
          {t('ZwiftAndroidManage.only_free_on_the_server_a_build_needs_about', {
            value1: megabytes(admin.disk.free),
            value2: megabytes(admin.disk.recommended),
          })}
        </p>
      {/if}
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
          accept=".apkm"
          disabled={!certificateReady}
          onchange={() => {
            const file = fileInput?.files?.[0];

            if (file) void send(file);

            if (fileInput) fileInput.value = '';
          }}
        />
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-5 5m5-5 5 5M5 20h14" /></svg>
        <span class="title"
          >{admin.app ? t('ZwiftAndroidManage.upload_a_newer_zwift') : t('ZwiftAndroidManage.upload_zwift')}</span
        >
        <span class="detail"
          >{t('ZwiftAndroidManage.drop_or_choose_the_apkm_file_up_to', { value1: megabytes(admin.uploadLimit) })}</span
        >
      </label>
      {#if !admin.tools.ready && admin.tools.supported}
        <p class="hint">
          {t('ZwiftAndroidManage.the_first_build_downloads_java_and_apkeditor', {
            value1: megabytes(admin.tools.downloadBytes),
          })}
        </p>
      {/if}
      {#if !admin.tools.ready && !admin.tools.supported}
        <p class="stale">{t('ZwiftAndroidManage.install_java_11_or_later_on_the_server_before')}</p>
      {/if}
    {/if}
    {#if uploadError}<p class="notice failed" role="alert">{uploadError}</p>{/if}
  </section>

  {#if admin.original || admin.app}
    <section class="panel" aria-labelledby="zwift-android-saved">
      <h2 id="zwift-android-saved">{t('ZwiftAndroidManage.saved_upload')}</h2>
      {#if admin.original}
        <p class="file">
          <span class="name">{admin.original.name}</span>
          <span class="meta"
            >{t('ZwiftAndroidManage.uploaded', {
              value1: megabytes(admin.original.bytes),
              value2: day(admin.original.uploadedAt),
            })}</span
          >
        </p>
        <p class="hint">{t('ZwiftAndroidManage.kept_to_rebuild_the_app_automatically_when_the_certificate')}</p>
      {:else}
        <p class="hint">{t('ZwiftAndroidManage.no_upload_saved_a_new_certificate_needs_a_fresh')}</p>
      {/if}
      <div class="actions">
        {#if admin.original}
          <button
            type="button"
            class:primary={!!admin.app && !admin.app.current}
            disabled={working || busy || !certificateReady}
            onclick={() => act(() => api(zwiftAndroidAdminStatus, `${endpoint}/rebuild`, 'POST', {}))}
            >{t('ZwiftAndroidManage.build_again')}</button
          >
        {/if}
        {#if admin.app}
          <button
            type="button"
            disabled={working || busy}
            onclick={() => act(() => api(zwiftAndroidAdminStatus, `${endpoint}/app`, 'DELETE', {}), 'App removed.')}
            >{t('ZwiftAndroidManage.remove_the_app')}</button
          >
        {/if}
      </div>
      {#if notice}<p class="hint" role="status">{notice}</p>{/if}
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
  .lead {
    margin: 0 0 1.25rem;
  }
  .lead a {
    color: inherit;
  }
  .hint {
    margin: 0.6rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }
  .notice.failed {
    margin: 0.75rem 0 0;
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

  .fetch {
    margin: 0 0 1rem;
    padding-left: 1.4rem;
  }
  .fetch li {
    margin: 0 0 0.3rem;
    padding-left: 0.2rem;
  }
  .fetch li::marker {
    color: var(--orange);
    font-weight: 800;
  }
  .fetch a {
    color: inherit;
  }

  .drop {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    margin: 0;
    padding: 1.75rem 1rem;
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

  .file {
    display: grid;
    gap: 0.1rem;
    margin: 0;
  }
  .file .name {
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .file .meta {
    color: var(--muted);
    font-size: 0.875rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
  }
</style>
