<script lang="ts">
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
    upload: 'Uploading',
    extract: 'Unpacking the game files',
    certificate: 'Adding this server’s certificate',
    inspect: 'Checking the app',
    runtime: 'Downloading Java',
    editor: 'Downloading APKEditor',
    merge: 'Merging the split APKs',
    decode: 'Unpacking the app',
    rename: 'Renaming it Zwift for Zluggish',
    build: 'Rebuilding the app',
    sign: 'Packing and signing',
    publish: 'Publishing',
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
      return `Published Zwift ${admin?.app?.versionName ?? ''}`;
    }

    if (job.state === 'failed') {
      return 'The build stopped';
    }

    return upload ? `Uploading ${upload.name}` : 'Building Zwift for Zluggish';
  });

  const detail = $derived.by(() => {
    if (!job) {
      return '';
    }

    if (job.state === 'failed') {
      return 'The build failed.';
    }

    if (job.state === 'done') {
      return 'Riders can download it now.';
    }

    return upload ? 'Keep this page open until the upload finishes.' : `${labels[job.step]}…`;
  });

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  async function refresh() {
    try {
      admin = await api(zwiftAndroidAdminStatus, endpoint);
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Zwift for Android could not be loaded.';
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
      failure = error instanceof Error ? error.message : 'The request failed.';
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
          reject(new TypeError('The transfer was interrupted.'));
        } else {
          const response = z.object({ message: z.string() }).safeParse(xhr.response);
          reject(new Error(response.data?.message ?? `The upload failed (${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new TypeError('The transfer was interrupted.'));
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
      uploadError = 'Choose the Zwift .apkm bundle.';

      return;
    }

    if (admin && file.size > admin.uploadLimit) {
      uploadError = `The file is larger than ${megabytes(admin.uploadLimit)}.`;

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
        uploadError = error instanceof Error ? error.message : 'The upload failed.';
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
  {#if !failure}<p role="status">Loading…</p>{/if}
{:else}
  <section class="panel" aria-labelledby="zwift-android-app">
    <h2 id="zwift-android-app">Zwift for Android</h2>
    <p class="lead">
      Upload Zwift once and the server adds its certificate, then publishes
      <strong>Zwift for Zluggish</strong>, a copy that installs next to the original. Riders download it under
      <a href="/apps" onclick={(event) => go(event, '/apps')}>Apps</a>.
    </p>

    {#if !certificateReady}
      <p class="stale">
        {#if admin.tlsMode === 'legacy'}
          Replace the server certificate before building Zwift for Android.
        {:else}
          The Zwift API serves plain HTTP on this server, so there is no certificate for Zwift to trust.
        {/if}
      </p>
    {:else if admin.app && !admin.app.current && admin.activity?.state !== 'running'}
      <p class="stale">
        The server certificate changed after this app was built, so riders cannot download it until it is built again.
      </p>
    {/if}

    {#if admin.app}
      <dl class="facts">
        <div>
          <dt>Version</dt>
          <dd>{admin.app.versionName}</dd>
        </div>
        <div>
          <dt>Download</dt>
          <dd>{megabytes(admin.app.bytes)}</dd>
        </div>
        <div>
          <dt>Built</dt>
          <dd>{day(admin.app.createdAt)}</dd>
        </div>
        <div>
          <dt>Certificate</dt>
          <dd class:alarm={!admin.app.current}>{admin.app.current ? 'Current' : 'Outdated'}</dd>
        </div>
      </dl>
    {/if}

    {#if job}
      <JobProgress id="zwift-android-job" {job} {labels} {weights} {headline} {detail} {upload}>
        {#if upload}
          <button type="button" onclick={() => transfer?.abort()}>Stop upload</button>
        {:else if job.state === 'running'}
          <button
            type="button"
            disabled={working}
            onclick={() => act(() => api(zwiftAndroidAdminStatus, `${endpoint}/stop`, 'POST', {}))}>Stop build</button
          >
          <p class="hint">You can leave this page. The build continues on the server.</p>
        {/if}
      </JobProgress>
    {/if}

    {#if !busy}
      <ol class="fetch">
        <li>
          Open <a href={apkMirror} target="_blank" rel="noopener noreferrer">Zwift on APKMirror</a> and select the newest
          version.
        </li>
        <li>Download the variant marked <strong>BUNDLE 1 OBB</strong>: an .apkm file of about 4 GB.</li>
        <li>Drop it below.</li>
      </ol>
      {#if lowSpace && admin.disk.free !== null}
        <p class="stale" role="status">
          The server has {megabytes(admin.disk.free)} free. Building Zwift takes about
          {megabytes(admin.disk.recommended)}, so free up space on the server before you upload.
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
        <span class="title">{admin.app ? 'Upload a newer Zwift' : 'Upload Zwift'}</span>
        <span class="detail">Drop the .apkm file here or choose it, up to {megabytes(admin.uploadLimit)}.</span>
      </label>
      {#if !admin.tools.ready && admin.tools.supported}
        <p class="hint">
          The first build also downloads Java and APKEditor, about {megabytes(admin.tools.downloadBytes)}.
        </p>
      {/if}
      {#if !admin.tools.ready && !admin.tools.supported}
        <p class="stale">
          No Java runtime is published for this server’s system. Install Java 11 or later on the server before you
          upload.
        </p>
      {/if}
    {/if}
    {#if uploadError}<p class="notice failed" role="alert">{uploadError}</p>{/if}
  </section>

  {#if admin.original || admin.app}
    <section class="panel" aria-labelledby="zwift-android-saved">
      <h2 id="zwift-android-saved">Saved upload</h2>
      {#if admin.original}
        <p class="file">
          <span class="name">{admin.original.name}</span>
          <span class="meta">{megabytes(admin.original.bytes)}, uploaded {day(admin.original.uploadedAt)}</span>
        </p>
        <p class="hint">
          The server keeps the last upload, so it can build the app again after the certificate changes. It does that on
          its own when you rotate the certificate.
        </p>
      {:else}
        <p class="hint">No upload is saved. Upload Zwift again to build the app for a new certificate.</p>
      {/if}
      <div class="actions">
        {#if admin.original}
          <button
            type="button"
            class:primary={!!admin.app && !admin.app.current}
            disabled={working || busy || !certificateReady}
            onclick={() => act(() => api(zwiftAndroidAdminStatus, `${endpoint}/rebuild`, 'POST', {}))}
            >Build again</button
          >
        {/if}
        {#if admin.app}
          <button
            type="button"
            disabled={working || busy}
            onclick={() =>
              act(
                () => api(zwiftAndroidAdminStatus, `${endpoint}/app`, 'DELETE', {}),
                'Removed Zwift for Zluggish from this server.',
              )}>Remove the app</button
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
