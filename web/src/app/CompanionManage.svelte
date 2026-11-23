<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { z } from 'zod';
  import type { CompanionAdminStatus, CompanionStep } from './companion';
  import { companionAdminStatus, megabytes } from './companion';
  import JobProgress from './JobProgress.svelte';

  let {
    api,
    csrf,
  }: {
    api: <Schema extends z.ZodType>(
      schema: Schema,
      url: string,
      method?: string,
      data?: Record<string, never>,
    ) => Promise<z.output<Schema>>;
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
    upload: 'Uploading',
    runtime: 'Downloading Java',
    editor: 'Downloading APKEditor',
    inspect: 'Checking the file',
    merge: 'Merging the split APKs',
    decode: 'Unpacking the resources',
    patch: 'Pointing the app at this server',
    build: 'Rebuilding the app',
    sign: 'Signing the app',
    publish: 'Publishing',
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
        return 'Waiting for the Java tools';
      case 'done':
        return tools ? 'The Java tools are ready' : `Published Companion ${admin?.app?.versionName ?? ''}`;
      case 'failed':
        return tools ? 'The download stopped' : 'The patch stopped';
      default:
        if (upload) {
          return `Uploading ${upload.name}`;
        }

        return tools
          ? 'Downloading the Java tools'
          : job.kind === 'rekey'
            ? 'Adding the new certificate'
            : 'Patching Companion for this server';
    }
  });

  const detail = $derived.by(() => {
    if (!job) {
      return '';
    }

    const tools = job.kind === 'toolchain';

    switch (job.state) {
      case 'waiting':
        return 'The upload is saved. It continues once the server has the Java tools.';
      case 'done':
        return tools ? 'The server can rebuild apps from the Play Store or zoffline.' : 'Riders can download it now.';
      case 'failed':
        return tools ? 'The download failed.' : 'The patch failed.';
      default:
        return upload ? 'Keep this page open until the upload finishes.' : `${labels[job.step]}…`;
    }
  });

  async function refresh() {
    try {
      admin = await api(companionAdminStatus, '/api/manage/companion');
    } catch (error) {
      failure = error instanceof Error ? error.message : 'The Companion app could not be loaded.';
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
      failure = error instanceof Error ? error.message : 'The request failed.';
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
      uploadError = 'Choose an APK, APKS, XAPK or APKM file.';

      return;
    }

    if (admin && file.size > admin.uploadLimit) {
      uploadError = `The file is larger than ${megabytes(admin.uploadLimit)}.`;

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
        uploadError = failureMessage.safeParse(xhr.response).data?.message ?? `The upload failed (${xhr.status}).`;
      }
    };

    xhr.onerror = () => {
      upload = null;
      request = null;
      uploadError = 'The upload stopped. Check the connection to the server and try again.';
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
  {#if !failure}<p role="status">Loading…</p>{/if}
{:else}
  <section class="panel" aria-labelledby="companion-app">
    <h2 id="companion-app">The app on this server</h2>

    {#if !certificateReady}
      <p class="stale">
        {#if admin.tlsMode === 'legacy'}
          Replace the server certificate before building the Companion app.
        {:else}
          The Zwift API serves plain HTTP on this server, so there is no certificate for the app to trust.
        {/if}
      </p>
    {/if}

    {#if admin.app}
      <dl class="facts">
        <div>
          <dt>Version</dt>
          <dd>{admin.app.versionName}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{megabytes(admin.app.bytes)}</dd>
        </div>
        <div>
          <dt>Patched</dt>
          <dd>{day(admin.app.createdAt)}</dd>
        </div>
        <div>
          <dt>Certificate</dt>
          <dd class:alarm={!admin.app.current}>{admin.app.current ? 'Current' : 'Outdated'}</dd>
        </div>
      </dl>
    {:else}
      <p class="lead">No app yet. Riders see the download under <strong>Apps</strong> once you upload one.</p>
    {/if}

    {#if job}
      <JobProgress id="companion-job" {job} {labels} {weights} {headline} {detail} {upload}>
        {#if upload}
          <button type="button" onclick={() => request?.abort()}>Stop upload</button>
        {:else if job.state === 'running'}
          {#if job.kind === 'toolchain' && admin.pending}
            <p class="hint">Your upload continues once they are ready.</p>
          {/if}
          <button
            type="button"
            disabled={working}
            onclick={() => act(() => api(companionAdminStatus, '/api/manage/companion/cancel', 'POST', {}))}
            >Stop</button
          >
          <p class="hint">You can leave this page. The job continues on the server.</p>
        {:else if admin.pending}
          {#if admin.toolchain.supported}
            <p class="ask">
              The server needs Java to give this app the Zluggish app ID and icon. It downloads
              {admin.toolchain.java ? 'APKEditor' : 'a Java runtime from Eclipse Temurin and APKEditor'}, about
              {megabytes(admin.toolchain.downloadBytes)}, and checks each file against a pinned checksum.
            </p>
            <button type="button" class="primary" disabled={working} onclick={installTools}
              >Download Java tools and continue</button
            >
          {:else}
            <p class="ask">
              The server needs Java to give this app the Zluggish app ID and icon. No Java runtime is published for this
              server's system: install Java 11 or later on the server, then upload the app again.
            </p>
          {/if}
          <button
            type="button"
            disabled={working}
            onclick={() =>
              act(
                () => api(companionAdminStatus, '/api/manage/companion/pending', 'DELETE', {}),
                'Discarded the upload.',
              )}>Discard upload</button
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
        <span class="title">{admin.app ? 'Upload a newer version' : 'Upload Zwift Companion'}</span>
        <span class="detail"
          >Drop the file here or choose it. APK, APKS, XAPK or APKM, up to {megabytes(admin.uploadLimit)}.</span
        >
      </label>
      <p class="hint">
        Play Store and zoffline builds need the Java tools to get the Zluggish app ID and icon. A Companion APK
        previously built with the Zluggish app ID only needs a certificate swap.
      </p>
    {/if}
    {#if uploadError}<p class="notice failed" role="alert">{uploadError}</p>{/if}

    {#if admin.app}
      <button
        type="button"
        disabled={working || busy}
        onclick={() =>
          act(
            () => api(companionAdminStatus, '/api/manage/companion/app', 'DELETE', {}),
            'Removed the app from this server.',
          )}>Remove the app</button
      >
    {/if}
    {#if notice}<p class="hint" role="status">{notice}</p>{/if}
  </section>

  <section class="panel" aria-labelledby="companion-tools">
    <h2 id="companion-tools">Java tools</h2>
    {#if tools && admin.toolchain.java}
      <p>
        Ready to rebuild apps from the Play Store, with
        {admin.toolchain.java.source === 'system'
          ? `the Java ${admin.toolchain.java.version} installed on the server`
          : `Java ${admin.toolchain.java.version}`}.
      </p>
      <p class="hint">Downloaded files are in {admin.toolchain.folder}.</p>
      <button
        type="button"
        disabled={working || busy}
        onclick={() =>
          act(
            () => api(companionAdminStatus, '/api/manage/companion/toolchain', 'DELETE', {}),
            'Removed the Java tools.',
          )}>Remove Java tools</button
      >
    {:else if !admin.toolchain.supported}
      <p>
        No Java runtime is published for this server's system. Install Java 11 or later on the server to rebuild apps
        from the Play Store or zoffline.
      </p>
    {:else}
      <p>
        Needed to rebuild Play Store and zoffline apps. The server downloads
        {admin.toolchain.java ? 'APKEditor' : 'a Java runtime from Eclipse Temurin and APKEditor'}, about
        {megabytes(admin.toolchain.downloadBytes)}, and checks each file against a pinned checksum.
      </p>
      <p class="hint">They are kept in {admin.toolchain.folder}, outside storage and backups.</p>
      <button type="button" disabled={working || busy} onclick={installTools}>Download Java tools</button>
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
