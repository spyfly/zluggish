<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { z } from 'zod';
  import type { CompanionActivity, CompanionAdminStatus, CompanionStep } from './companion';
  import { companionAdminStatus, megabytes } from './companion';

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

  /** The upload, before the server's job takes over: its own first step on the tracker. */
  let upload = $state<{ name: string; progress: number } | null>(null);
  let uploadError = $state('');
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let request: XMLHttpRequest | null = null;

  const accepted = '.apk,.apks,.xapk,.apkm';
  const failureMessage = z.object({ message: z.string() });
  const certificateReady = $derived(admin?.tlsMode === 'managed' || admin?.tlsMode === 'custom');
  const tools = $derived(admin ? !!admin.toolchain.java && admin.toolchain.editor : false);

  const labels: Record<CompanionStep, string> = {
    upload: 'Uploading the file',
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

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  /** What the tracker shows: the upload in flight, or the server's job with the upload done before it. */
  const tracker = $derived.by((): (CompanionActivity & { upload?: boolean }) | null => {
    if (upload) {
      return {
        kind: 'patch',
        state: 'running',
        steps: ['upload', 'inspect'],
        step: 'upload',
        progress: upload.progress,
        message: null,
        startedAt: '',
        finishedAt: null,
        upload: true,
      };
    }

    const activity = admin?.activity;

    if (!activity) {
      return null;
    }

    return activity.kind === 'patch' ? { ...activity, steps: ['upload', ...activity.steps] } : activity;
  });

  const summary = $derived.by(() => {
    const activity = tracker;

    if (!activity) {
      return '';
    }

    if (activity.state === 'failed') {
      return activity.message ?? 'The job failed.';
    }

    if (activity.state === 'waiting') {
      return 'Waiting for the Java tools';
    }

    if (activity.state === 'done') {
      return activity.kind === 'toolchain'
        ? 'The Java tools are ready.'
        : `Published Companion ${admin?.app?.versionName ?? ''}. Riders can download it now.`;
    }

    return `${labels[activity.step]}…`;
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

    upload = { name: file.name, progress: 0 };
    const xhr = new XMLHttpRequest();
    request = xhr;
    xhr.open('PUT', '/api/manage/companion/app');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-CSRF-Token', csrf());
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (upload && event.lengthComputable) {
        upload = { ...upload, progress: event.loaded / event.total };
      }
    };

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
          This server still uses the shared Zwift certificate. Generate a server certificate on the
          <a
            href="/manage/server"
            onclick={(event) => {
              event.preventDefault();
              void navigate('/manage/server');
            }}>Server</a
          > page first: the app is patched to trust it.
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
      <p class="lead">No app yet. Riders see the download under <strong>Apps → Companion</strong> once you upload one.</p>
    {/if}

    <label
      class="drop"
      class:dragging
      class:disabled={busy || !certificateReady}
      ondragover={(event) => {
        event.preventDefault();
        dragging = !busy && certificateReady;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={dropped}
    >
      <input
        bind:this={fileInput}
        type="file"
        accept={accepted}
        disabled={busy || !certificateReady}
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
      An app already patched for zoffline, such as a zoffline-companion release, gets this server's certificate in
      seconds. An app from the Play Store is rebuilt with Java, which the server asks before it downloads.
    </p>
    {#if uploadError}<p class="notice failed" role="alert">{uploadError}</p>{/if}

    {#if tracker}
      <div class="tracker" class:failed={tracker.state === 'failed'} aria-live="polite">
        <ol class="segments" aria-label="Progress">
          {#each tracker.steps as step, index (step)}
            {@const at = tracker.steps.indexOf(tracker.step)}
            {@const state =
              tracker.state === 'done' || index < at
                ? 'done'
                : index === at
                  ? tracker.state === 'failed'
                    ? 'failed'
                    : tracker.state === 'waiting'
                      ? 'pending'
                      : 'current'
                  : 'pending'}
            <li class={state} title={labels[step]}>
              <span
                class="fill"
                class:indeterminate={state === 'current' && tracker.progress === null}
                style:width={state === 'current' && tracker.progress !== null
                  ? `${Math.round(tracker.progress * 100)}%`
                  : undefined}
              ></span>
              <span class="visually-hidden">{labels[step]}: {state}</span>
            </li>
          {/each}
        </ol>
        <p class="now">
          <span>{summary}</span>
          {#if tracker.state === 'running'}
            <span class="count">Step {tracker.steps.indexOf(tracker.step) + 1} of {tracker.steps.length}</span>
          {/if}
        </p>
        {#if tracker.kind === 'toolchain' && tracker.state === 'running' && admin.pending}
          <p class="hint">Your upload continues once they are ready.</p>
        {/if}
        {#if tracker.upload}
          <button type="button" onclick={() => request?.abort()}>Stop upload</button>
        {:else if tracker.state === 'running'}
          <button
            type="button"
            disabled={working}
            onclick={() => act(() => api(companionAdminStatus, '/api/manage/companion/cancel', 'POST', {}))}
            >Stop</button
          >
        {/if}
      </div>
    {/if}

    {#if admin.pending && admin.activity?.state !== 'running'}
      <div class="ask" role="group" aria-labelledby="companion-ask">
        <h3 id="companion-ask">This app needs the Java tools</h3>
        {#if admin.toolchain.supported}
          <p>
            It comes straight from the Play Store, so the server rebuilds it with Java. The server downloads
            {admin.toolchain.java ? 'APKEditor' : 'a Java runtime from Eclipse Temurin and APKEditor'}, about
            {megabytes(admin.toolchain.downloadBytes)}, and checks each file against a pinned checksum.
          </p>
          <button type="button" class="primary" disabled={working} onclick={installTools}
            >Download Java tools and continue</button
          >
        {:else}
          <p>
            It comes straight from the Play Store, so the server rebuilds it with Java. No Java runtime is published for
            this server's system: install Java 11 or later on the server, then upload the app again.
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
      </div>
    {/if}

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
        from the Play Store.
      </p>
    {:else}
      <p>
        Only needed for an app straight from the Play Store. The server downloads
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
  .stale a {
    color: inherit;
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

  .tracker {
    margin: 1.25rem 0 0;
  }
  .segments {
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .segments li {
    position: relative;
    flex: 1;
    height: 0.5rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--line);
  }
  .segments .fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0;
    background: var(--orange);
    transition: width 0.4s ease-out;
  }
  .segments .done .fill {
    width: 100%;
  }
  .segments .failed {
    background: #ff6b57;
  }
  .segments .current .fill.indeterminate {
    width: 40%;
    animation: sweep 1.4s ease-in-out infinite;
  }
  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }
  .now {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    margin: 0.6rem 0 0;
    font-weight: 700;
  }
  .tracker.failed .now {
    color: var(--alarm);
  }
  .now .count {
    color: var(--muted);
    font-weight: 600;
    font-size: 0.875rem;
  }

  .ask {
    margin: 1rem 0 0;
    padding: 1rem 1.1rem;
    border: 2px solid var(--orange);
    border-radius: 12px;
    background: var(--well);
  }
  .ask h3 {
    margin: 0 0 0.4rem;
    font-size: 1rem;
  }
  .ask p {
    margin: 0;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .segments .fill {
      transition: none;
    }
    .segments .current .fill.indeterminate {
      width: 50%;
      animation: none;
    }
  }
</style>
