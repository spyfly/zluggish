<script lang="ts">
  import ActivityChart from './ActivityChart.svelte';
  import type { Chart } from './ActivityChart.svelte';

  type Summary = {
    id: string;
    name: string;
    world: number;
    sport: 'cycling' | 'running';
    startDate: string | null;
    endDate: string | null;
    distanceInMeters: number;
    totalElevation: number;
    movingTimeInMs: number;
    calories: number;
    avgWatts: number;
    maxWatts: number;
    normalizedPower: number;
    tss: number;
    avgHeartRate: number;
    maxHeartRate: number;
    avgCadence: number;
    maxCadence: number;
    avgSpeed: number;
    maxSpeed: number;
    fit: boolean;
    images: number;
  };

  type Detail = Summary & { imageIds: Array<number>; chart: Chart | null; chartPending: boolean };

  type Provider = 'strava' | 'freeStrava' | 'garmin' | 'runalyze' | 'intervals' | 'zwift';

  type Upload = {
    provider: Provider;
    state: 'pending' | 'sending' | 'sent' | 'failed' | 'ambiguous' | 'cancelled' | null;
    error: string | null;
  };

  let {
    path,
    api,
    go,
  }: {
    path: string;
    api: <Body>(url: string, method?: string, data?: Record<string, string | boolean>) => Promise<Body>;
    go: (next: string) => void;
  } = $props();

  const worlds = new Map([
    [2, 'Richmond'],
    [6, 'Watopia'],
    [7, 'London'],
    [8, 'New York'],
    [9, 'Innsbruck'],
    [10, 'Bologna'],
    [11, 'Yorkshire'],
    [12, 'Crit City'],
    [13, 'Makuri Islands'],
    [14, 'France'],
    [15, 'Paris'],
    [16, 'Gravel Mountain'],
    [17, 'Scotland'],
  ]);

  let activities = $state<Array<Summary> | null>(null);
  let detail = $state<Detail | null>(null);
  let failure = $state('');
  let chartWaitExpired = $state(false);

  /** The open activity's deliveries, one per connected service. */
  let uploads = $state<{ id: string; list: Array<Upload> } | null>(null);
  let chooser = $state(false);
  let chosen = $state<Array<Provider>>([]);
  let sending = $state(false);
  let uploadFailure = $state('');

  let page = $state(0);
  let showList = $state(false);

  const ordered = $derived(
    [...(activities ?? [])].sort((a, b) => (started(b)?.getTime() ?? -Infinity) - (started(a)?.getTime() ?? -Infinity)),
  );

  const selectedId = $derived(/^\/activities\/(\d+)$/.exec(path)?.[1] ?? (showList ? null : (ordered[0]?.id ?? null)));

  /** The previous activity stays on screen until the next one arrives, so switching does not flicker. */
  const loading = $derived(selectedId !== null && detail?.id !== selectedId && !failure);

  let hasMore = $state(false);
  let requestVersion = 0;

  const started = (a: Summary) => {
    const time = Date.parse(a.startDate ?? '');

    return Number.isFinite(time) ? new Date(time) : null;
  };

  /** Newest first, grouped by the month the activity started, with that month's totals. */
  const months = $derived.by(() => {
    const groups: Array<{ key: string; label: string; activities: Array<Summary>; distance: number; time: number }> =
      [];

    for (const activity of ordered) {
      const date = started(activity);
      const key = date ? `${date.getFullYear()}-${date.getMonth()}` : 'undated';
      let group = groups.at(-1);

      if (group?.key !== key) {
        group = {
          key,
          label: date ? date.toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Without a start date',
          activities: [],
          distance: 0,
          time: 0,
        };
        groups.push(group);
      }

      group.activities.push(activity);
      group.distance += activity.distanceInMeters;
      group.time += activity.movingTimeInMs;
    }

    return groups;
  });

  const km = (m: number) =>
    `${(m / 1000).toLocaleString([], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;

  const clock = (ms: number) => {
    const s = Math.round(ms / 1000);

    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const hours = (ms: number) => {
    const minutes = Math.round(ms / 60_000);

    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  };

  /** Average speed as reported, else from distance over moving time. */
  const speed = (a: Summary) =>
    a.avgSpeed > 0 ? a.avgSpeed : a.movingTimeInMs > 0 ? a.distanceInMeters / (a.movingTimeInMs / 1000) : 0;

  const pace = (mps: number) => {
    const s = Math.round(1000 / mps);

    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
  };

  const pacing = (a: Summary, mps: number) =>
    mps <= 0 ? '' : a.sport === 'running' ? pace(mps) : `${(mps * 3.6).toFixed(1)} km/h`;

  const world = (a: Summary) => worlds.get(a.world) ?? (a.world ? `World ${a.world}` : '');
  const title = (a: Summary) => a.name.trim() || 'Untitled activity';

  /** Average and maximum side by side. A measure the activity did not record is left out. */
  const measures = (a: Detail) =>
    (
      [
        [
          'Power',
          a.sport === 'running' ? 0 : a.avgWatts,
          a.sport === 'running' ? 0 : a.maxWatts,
          (v: number) => `${Math.round(v)} W`,
        ],
        ['Heart rate', a.avgHeartRate, a.maxHeartRate, (v: number) => `${Math.round(v)} bpm`],
        [
          a.sport === 'running' ? 'Cadence' : 'Cadence',
          a.avgCadence,
          a.maxCadence,
          (v: number) => `${Math.round(v)} ${a.sport === 'running' ? 'spm' : 'rpm'}`,
        ],
        [a.sport === 'running' ? 'Pace' : 'Speed', speed(a), a.maxSpeed, (v: number) => pacing(a, v)],
      ] as const
    ).filter(([, avg, max]) => avg > 0 || max > 0);

  const extras = (a: Detail) =>
    (
      [
        ['Normalized power', a.normalizedPower, `${Math.round(a.normalizedPower)} W`],
        ['Training stress score', a.tss, `${Math.round(a.tss)}`],
        ['Calories', a.calories, `${Math.round(a.calories)} kcal`],
      ] as const
    ).filter(([, value]) => value > 0);

  const services: Record<Provider, string> = {
    strava: 'Strava',
    freeStrava: 'Strava',
    garmin: 'Garmin Connect',
    runalyze: 'Runalyze',
    intervals: 'Intervals.icu',
    zwift: 'Zwift',
  };

  /** Only the Strava session cookie can attach images; every other service takes the FIT file alone. */
  const contents = (provider: Provider, images: number) =>
    images === 0
      ? 'FIT file'
      : provider === 'freeStrava'
        ? `FIT file and ${images} ${images === 1 ? 'image' : 'images'}`
        : 'FIT file only, no images';

  const inFlight = (u: Upload) => u.state === 'pending' || u.state === 'sending';
  const uploaded = (u: Upload) => u.state === 'sent' || u.state === 'ambiguous';

  function progress(u: Upload) {
    switch (u.state) {
      case 'pending':
        return 'Waiting';
      case 'sending':
        return 'Uploading…';
      case 'sent':
        return 'Uploaded';
      case 'ambiguous':
        return 'Result unknown';
      case 'failed':
        return u.error?.startsWith('strava_session') ? 'Session expired' : 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Not uploaded';
    }
  }

  /** One sentence for the closed section, so the state is visible without opening the chooser. */
  function summary(list: Array<Upload>) {
    const names = (match: (u: Upload) => boolean) => {
      const found = [...new Set(list.flatMap((u) => (match(u) ? [services[u.provider]] : [])))];

      return found.length > 1 ? `${found.slice(0, -1).join(', ')} and ${found.at(-1)}` : found[0];
    };

    return [
      names((u) => u.state === 'sent') && `Uploaded to ${names((u) => u.state === 'sent')}.`,
      names(inFlight) && `Uploading to ${names(inFlight)}…`,
      names((u) => u.state === 'failed') && `Upload to ${names((u) => u.state === 'failed')} failed.`,
      names((u) => u.state === 'ambiguous') &&
        `${names((u) => u.state === 'ambiguous')} may already have it; the last upload ended without an answer.`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  async function loadUploads(id: string) {
    try {
      const body = await api<{ uploads: Array<Upload> }>(`/api/me/activities/${id}/uploads`);

      if (detail?.id === id) {
        uploads = { id, list: body.uploads };
      }
    } catch {
      /* The section stays as it was; the next open or poll tries again. */
    }
  }

  function toggleChooser(list: Array<Upload>) {
    chooser = !chooser;
    uploadFailure = '';

    // Services that do not have the activity yet start ticked; uploading again is a deliberate choice.
    if (chooser) {
      chosen = list.flatMap((u) => (uploaded(u) || inFlight(u) ? [] : [u.provider]));
    }
  }

  async function upload(id: string, list: Array<Upload>) {
    sending = true;
    uploadFailure = '';
    const failures: Array<string> = [];

    for (const provider of chosen) {
      const again = list.some((u) => u.provider === provider && uploaded(u));

      try {
        const body = await api<{ uploads: Array<Upload> }>(`/api/me/activities/${id}/uploads`, 'POST', {
          provider,
          again,
        });

        if (detail?.id === id) {
          uploads = { id, list: body.uploads };
        }
      } catch (error) {
        failures.push(
          `${services[provider]}: ${error instanceof Error ? error.message : 'the upload could not start.'}`,
        );
      }
    }

    sending = false;
    uploadFailure = failures.join(' ');

    // The chooser stays open, so each row shows its upload on the way.
    if (!failures.length) {
      chosen = [];
    }
  }

  async function loadList(currentPage: number) {
    const version = ++requestVersion;

    try {
      const body = await api<{ activities: Array<Summary>; hasMore: boolean }>(
        `/api/me/activities?page=${currentPage}`,
      );

      if (version !== requestVersion) {
        return;
      }
      activities = body.activities;
      hasMore = body.hasMore;
    } catch (error) {
      if (version === requestVersion) {
        failure = error instanceof Error ? error.message : 'Activities could not be loaded.';
      }
    }
  }

  /** The chart is made by a job after the activity is saved; ask again a few times while it runs. */
  async function loadDetail(id: string, attempt = 0) {
    try {
      const body = await api<Detail>(`/api/me/activities/${id}`);

      if (selectedId !== id) {
        return;
      }
      const retry = body.chartPending && attempt < 8;
      detail = body;
      chartWaitExpired = body.chartPending && !retry;

      if (retry) {
        setTimeout(() => void loadDetail(id, attempt + 1), 1500 * (attempt + 1));
      }
    } catch (error) {
      if (selectedId !== id) {
        return;
      }
      detail = null;
      failure = error instanceof Error ? error.message : 'The activity could not be loaded.';
    }
  }

  $effect(() => {
    void loadList(page);
  });

  /** Derived, so the chart polls that replace `detail` do not close the chooser. */
  const uploadable = $derived(detail?.fit ? detail.id : null);

  $effect(() => {
    const id = uploadable;
    chooser = false;
    uploadFailure = '';

    if (id) {
      void loadUploads(id);
    }
  });

  // Deliveries run in the background, so the section refreshes while any is still on its way.
  $effect(() => {
    const id = uploads?.id;

    if (!id || !uploads?.list.some(inFlight)) {
      return;
    }

    const timer = setInterval(() => {
      if (!document.hidden) {
        void loadUploads(id);
      }
    }, 3000);

    return () => clearInterval(timer);
  });

  $effect(() => {
    const id = selectedId;
    failure = '';

    if (id) {
      void loadDetail(id);
    }
  });

  function open(event: MouseEvent, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    showList = href === '/activities';
    go(href);
  }
</script>

{#snippet uploader(a: Detail)}
  <div class="inset upload">
    <h3>Upload</h3>
    {#if !a.endDate}
      <p class="muted">Finish the activity in the game to upload it.</p>
    {:else if uploads?.id !== a.id}
      <p class="muted">Checking your connected services…</p>
    {:else if uploads.list.length === 0}
      <p class="muted">
        Connect Strava, Garmin or Intervals.icu in <a href="/integrations" onclick={(e) => open(e, '/integrations')}
          >Integrations</a
        > to send activities there.
      </p>
    {:else}
      {@const list = uploads.list}
      <p class="muted" aria-live="polite">
        {summary(list) ||
          `Send this activity${a.imageIds.length ? ' and its images' : ''} to the services you have connected.`}
      </p>
      <button
        type="button"
        class="toggle"
        aria-expanded={chooser}
        aria-controls="upload-chooser"
        onclick={() => toggleChooser(list)}>{chooser ? 'Close' : 'Upload to integrations'}</button
      >
      {#if chooser}
        <form
          id="upload-chooser"
          class="chooser"
          onsubmit={(event) => {
            event.preventDefault();
            void upload(a.id, list);
          }}
        >
          <fieldset>
            <legend class="visually-hidden">Services to upload to</legend>
            <ul class="plain services">
              {#each list as u (u.provider)}
                <li class="service" class:sending={inFlight(u)} data-state={u.state ?? 'none'}>
                  <label>
                    <input type="checkbox" value={u.provider} bind:group={chosen} disabled={sending || inFlight(u)} />
                    <span class="name">
                      <strong>{services[u.provider]}</strong>
                      <small>{contents(u.provider, a.imageIds.length)}</small>
                    </span>
                    <span class="state">{progress(u)}</span>
                  </label>
                  {#if inFlight(u)}<span class="bar" aria-hidden="true"></span>{/if}
                </li>
              {/each}
            </ul>
          </fieldset>
          {#each list.filter((u) => chosen.includes(u.provider) && uploaded(u)) as u (u.provider)}
            <p class="caution">
              {services[u.provider]}
              {u.state === 'sent' ? 'already has this activity' : 'may already have this activity'}. Uploading again can
              create a duplicate there.
            </p>
          {/each}
          {#if list.some((u) => u.state === 'failed' && u.error?.startsWith('strava_session'))}
            <p class="caution">
              Strava did not accept the saved session. Replace the cookie in <a
                href="/integrations"
                onclick={(e) => open(e, '/integrations')}>Integrations</a
              >, then try again.
            </p>
          {/if}
          {#if uploadFailure}<p class="error" role="alert">{uploadFailure}</p>{/if}
          {#if chosen.length}
            <button class="primary" disabled={sending}
              >{sending
                ? 'Starting upload…'
                : chosen.length === 1
                  ? `Upload to ${services[chosen[0]!]}`
                  : `Upload to ${chosen.length} services`}</button
            >
          {/if}
          {#if a.imageIds.length && !list.some((u) => u.provider === 'freeStrava')}
            <p class="muted note">
              Images go only to Strava when it is connected with a session cookie. Other services get the FIT file.
            </p>
          {/if}
        </form>
      {/if}
    {/if}
  </div>
{/snippet}

{#if failure}<p class="notice failed" role="alert">{failure}</p>{/if}

{#if activities === null}
  {#if !failure}<p class="delayed" role="status">Loading activities…</p>{/if}
{:else if activities.length === 0 && page === 0}
  <section class="panel narrow">
    <p>No activities yet. Activities you finish in the game appear here, with their FIT files and images.</p>
  </section>
{:else}
  <div class="activities" class:open={selectedId !== null}>
    <div class="log">
      {#each months as month (month.key)}
        <section class="month" aria-labelledby="month-{month.key}">
          <div class="month-head">
            <h2 id="month-{month.key}">{month.label}</h2>
            <p class="totals">
              {month.activities.length}
              {month.activities.length === 1 ? 'activity' : 'activities'}, {km(month.distance)}, {hours(
                month.time,
              )}{#if page > 0 || hasMore}
                (on this page){/if}
            </p>
          </div>
          <ul class="plain">
            {#each month.activities as a (a.id)}
              {@const date = started(a)}
              <li>
                <a
                  class="activity"
                  href="/activities/{a.id}"
                  aria-current={selectedId === a.id ? 'page' : undefined}
                  onclick={(e) => open(e, `/activities/${a.id}`)}
                >
                  <span class="day" aria-hidden={date ? 'true' : undefined}
                    >{#if date}<small>{date.toLocaleDateString([], { weekday: 'short' })}</small
                      >{date.getDate()}{:else}<small>No date</small>{/if}</span
                  >
                  <span class="what">
                    <strong>{title(a)}</strong>
                    <small
                      >{#if date}<span class="visually-hidden"
                          >{date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })},
                        </span>{/if}{world(a)}{#if a.sport === 'running'}{world(a)
                          ? ', run'
                          : 'Run'}{/if}{#if !a.endDate}<span class="unfinished"
                          >{world(a) || a.sport === 'running' ? ', ' : ''}not finished</span
                        >{/if}{#if a.images}<span class="camera"
                          ><span class="visually-hidden">, </span>{a.images}
                          {a.images === 1 ? 'image' : 'images'}</span
                        >{/if}</small
                    >
                  </span>
                  <span class="how">
                    <strong>{km(a.distanceInMeters)}</strong>
                    <small>{clock(a.movingTimeInMs)}</small>
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
      {#if page > 0 || hasMore}
        <nav class="pagination" aria-label="Activity pages">
          <button type="button" disabled={page === 0} onclick={() => page--}>Previous</button>
          <span>Page {page + 1}</span>
          <button type="button" disabled={!hasMore} onclick={() => page++}>Next</button>
        </nav>
      {/if}
    </div>

    <div class="detail">
      <section
        class="panel"
        class:stale={loading && detail}
        id="activity-detail"
        tabindex="-1"
        aria-labelledby="activity-name"
        aria-busy={loading}
      >
        {#if selectedId}
          <a class="back" href="/activities" onclick={(e) => open(e, '/activities')}>All activities</a>
        {/if}
        {#if loading}
          <div class="loading delayed" role="status">
            <span class="bar" aria-hidden="true"></span>
            <p class="muted">Loading activity…</p>
          </div>
        {/if}
        {#if !selectedId}
          <p class="muted">Choose an activity to see its route, stats, FIT file and images.</p>
        {:else if detail}
          {@const date = started(detail)}
          <h2 id="activity-name">{title(detail)}</h2>
          <p class="when">
            {#if date}{date.toLocaleDateString([], {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}, {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{/if}{#if world(detail)}{date
                ? ' in '
                : ''}{world(detail)}{/if}
          </p>

          {#if detail.chart && detail.chart.timeInSec.length > 1}
            {#key detail.id}<ActivityChart chart={detail.chart} running={detail.sport === 'running'} />{/key}
          {:else if detail.chartPending}
            <p class="pending" role="status">
              {chartWaitExpired
                ? 'The route and elevation profile are taking longer than expected. Reopen this activity to try again.'
                : 'Preparing the route and elevation profile from the FIT file…'}
            </p>
          {/if}

          <dl class="headline">
            <div>
              <dt>Distance</dt>
              <dd>{km(detail.distanceInMeters)}</dd>
            </div>
            <div>
              <dt>Moving time</dt>
              <dd>{clock(detail.movingTimeInMs)}</dd>
            </div>
            <div>
              <dt>Elevation gain</dt>
              <dd>{Math.round(detail.totalElevation)} m</dd>
            </div>
          </dl>

          {#if measures(detail).length}
            <table class="measures">
              <caption class="visually-hidden">Averages and maximums</caption>
              <thead>
                <tr><td></td><th scope="col">Average</th><th scope="col">Max</th></tr>
              </thead>
              <tbody>
                {#each measures(detail) as [label, avg, max, format] (label)}
                  <tr>
                    <th scope="row">{label}</th>
                    <td>{avg > 0 ? format(avg) : '–'}</td>
                    <td>{max > 0 ? format(max) : '–'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          {#if extras(detail).length}
            <dl class="config">
              {#each extras(detail) as [label, , text] (label)}<div>
                  <dt>{label}</dt>
                  <dd class="num">{text}</dd>
                </div>{/each}
            </dl>
          {/if}

          <div class="inset">
            <h3>FIT file</h3>
            {#if detail.fit}
              <p class="muted">The recording from the game, for Strava, Garmin Connect or any training app.</p>
              <a class="button primary" href="/api/me/activities/{detail.id}/fit" download>Download FIT file</a>
            {:else}
              <p class="muted">The game saved no FIT file for this activity.</p>
            {/if}
          </div>

          {#if detail.imageIds.length}
            <div class="inset">
              <h3>Images</h3>
              <ul class="plain images">
                {#each detail.imageIds as image, index (image)}
                  <li>
                    <a href="/api/me/activities/{detail.id}/images/{image}" target="_blank" rel="noopener">
                      <img
                        src="/api/me/activities/{detail.id}/images/{image}"
                        alt="Image {index + 1} of {detail.imageIds.length} from {title(detail)}"
                        loading="lazy"
                      />
                    </a>
                    <a class="download" href="/api/me/activities/{detail.id}/images/{image}?download" download
                      >Download<span class="visually-hidden"> image {index + 1}</span></a
                    >
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if detail.fit}{@render uploader(detail)}{/if}
        {/if}
      </section>
    </div>
  </div>
{/if}

<style>
  .activities {
    display: grid;
    gap: 1rem;
    align-items: start;
  }
  @media (min-width: 62rem) {
    .activities {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    }
    .detail {
      position: sticky;
      top: 1rem;
    }
    .detail .back {
      display: none;
    }
    /* Beside the list, the previous activity fades back under the bar; the words are for screen readers. */
    .detail .stale > :not(.loading) {
      opacity: 0.45;
      transition: opacity 200ms 400ms;
    }
    .detail .stale .loading p {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
  /* On a phone, an open activity takes the screen; the list is one link away. */
  @media (max-width: 61.99rem) {
    .open .log,
    .activities:not(.open) .detail {
      display: none;
    }
    .stale > :not(.back, .loading) {
      display: none;
    }
  }

  /* Fast loads show nothing; a slow one says so after a moment. */
  .delayed {
    animation: reveal 150ms ease-out 400ms both;
  }
  @keyframes reveal {
    from {
      opacity: 0;
      visibility: hidden;
    }
  }

  .detail .panel {
    position: relative;
  }
  .detail .panel > * {
    transition: opacity 100ms;
  }
  .loading p {
    margin: 0;
  }
  .bar {
    position: absolute;
    top: 0;
    left: 12px;
    right: 12px;
    height: 3px;
    overflow: hidden;
    border-radius: 0 0 3px 3px;
  }
  .bar::after {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 35%;
    border-radius: inherit;
    background: var(--orange);
    animation: sweep 1.1s ease-in-out infinite;
  }
  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(290%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .delayed {
      animation-duration: 1ms;
    }
    .bar::after {
      width: 100%;
      opacity: 0.6;
      animation: none;
    }
  }

  .panel {
    background: var(--glass);
    border-radius: 12px;
    padding: 1.25rem;
    margin: 0 0 1rem;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .panel:focus {
    outline: none;
  }
  .narrow {
    max-width: 34rem;
  }
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .muted {
    color: var(--muted);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .notice.failed {
    color: var(--alarm);
    border-left: 3px solid #ff6b57;
  }

  .pagination {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .month + .month {
    margin-top: 1.5rem;
  }
  .month-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    margin: 0 0 0.5rem;
    padding: 0 0.25rem;
  }
  .month-head h2 {
    margin: 0;
    font-size: 1.125rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .totals {
    margin: 0;
    color: var(--muted);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  li + li {
    margin-top: 0.4rem;
  }
  .activity {
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.85rem 0.55rem 0.6rem;
    border: 2px solid transparent;
    border-radius: 12px;
    background: var(--glass);
    text-decoration: none;
  }
  .activity:hover {
    background: var(--glass-raised);
    border-color: var(--orange);
  }
  .activity[aria-current] {
    background: var(--glass-raised);
    border-color: var(--text);
  }
  .activity small {
    display: block;
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .day {
    display: grid;
    justify-items: center;
    font-size: 1.375rem;
    font-weight: 800;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .day small {
    font-size: 0.6875rem;
  }
  .what {
    min-width: 0;
  }
  .what strong {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .what small {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .camera {
    margin-left: 0.6rem;
  }
  .camera::before {
    content: '';
    display: inline-block;
    width: 0.85rem;
    height: 0.7rem;
    margin-right: 0.3rem;
    background: currentColor;
    vertical-align: -0.05rem;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 20'%3E%3Cpath d='M8 0 6 3H2a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4l-2-3zm4 6a5 5 0 1 1 0 10 5 5 0 0 1 0-10z'/%3E%3C/svg%3E")
      center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 20'%3E%3Cpath d='M8 0 6 3H2a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4l-2-3zm4 6a5 5 0 1 1 0 10 5 5 0 0 1 0-10z'/%3E%3C/svg%3E")
      center / contain no-repeat;
  }
  .how {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .back {
    display: inline-block;
    margin-bottom: 0.75rem;
    font-size: 0.8125rem;
    font-weight: 800;
  }
  .back::before {
    content: '‹ ';
  }
  .detail h2 {
    margin: 0 0 0.25rem;
    font-size: 1.375rem;
    text-transform: none;
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }
  .when {
    margin: 0 0 1rem;
    color: var(--muted);
  }
  .pending {
    padding: 0.75rem 0.9rem;
    border-radius: 10px;
    background: var(--well);
    color: var(--muted);
  }

  .headline {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 0 0 1rem;
  }
  .headline dt {
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .headline dd {
    margin: 0.1rem 0 0;
    font-size: 1.375rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .measures {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  .measures th,
  .measures td {
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
    text-align: right;
    font-weight: 600;
  }
  .measures thead th {
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .measures tbody th {
    text-align: left;
    color: var(--muted);
  }
  .measures tbody td {
    font-weight: 800;
  }

  .config {
    display: grid;
    gap: 0;
    margin: 0;
  }
  .config div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
  }
  .config dt {
    color: var(--muted);
  }
  .config dd {
    margin: 0;
    font-weight: 800;
  }

  .inset {
    padding: 1rem 0 0;
    margin: 1rem 0 0;
    border-top: 1px solid var(--line);
  }
  .config + .inset,
  .measures + .inset {
    border-top: 0;
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    font-weight: 800;
  }
  .inset p {
    margin: 0 0 0.75rem;
  }
  /* The download is a link, dressed as the page's one orange action. */
  a.button {
    display: inline-block;
    padding: 0.65rem 1.4rem;
    border-radius: 10px;
    background: var(--orange);
    box-shadow: 0 3px 0 var(--orange-deep);
    font-size: 0.875rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    text-decoration: none;
  }
  a.button:hover {
    background: #f06a1e;
  }
  a.button:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--orange-deep);
  }

  .images {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .images li + li {
    margin: 0;
  }
  .images img {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 8px;
    background: var(--well);
  }
  .images a:first-child:hover img {
    outline: 2px solid var(--orange);
    outline-offset: 2px;
  }
  .download {
    display: inline-block;
    margin-top: 0.3rem;
    font-size: 0.8125rem;
  }

  /* Upload: one quiet button; the chooser opens in place under it, one row per connected service. */
  .upload .toggle {
    margin-top: 0;
  }
  .upload .toggle[aria-expanded='true'] {
    border-color: var(--line);
  }
  .chooser {
    margin: 0.85rem 0 0;
    padding: 0;
    background: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .chooser fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  .services {
    border-radius: 10px;
    background: var(--well);
    overflow: hidden;
  }
  .services li + li {
    margin: 0;
    border-top: 1px solid var(--line);
  }
  .service {
    position: relative;
  }
  .service label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    margin: 0;
    padding: 0.7rem 0.9rem;
    color: var(--text);
    cursor: pointer;
  }
  .service label:has(:disabled) {
    cursor: default;
  }
  .service label:hover:not(:has(:disabled)) {
    background: rgb(255 255 255 / 0.06);
  }
  .service .name small {
    display: block;
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .service .state {
    color: var(--muted);
    font-size: 0.8125rem;
    white-space: nowrap;
  }
  .service[data-state='sent'] .state {
    color: #a7f3c1;
  }
  .service[data-state='sent'] .state::before {
    content: '✓ ';
  }
  .service[data-state='failed'] .state,
  .service[data-state='ambiguous'] .state {
    color: var(--alarm);
  }
  .service.sending .state {
    color: var(--text);
  }
  /* The page's loading sweep, along the foot of the row that is on its way. */
  .service .bar {
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    border-radius: 0;
  }
  .chooser .caution {
    margin: 0.75rem 0 0;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--orange);
    border-radius: 0 6px 6px 0;
    background: rgb(226 86 12 / 0.12);
    font-size: 0.875rem;
  }
  .chooser .error {
    margin: 0.75rem 0 0;
  }
  .chooser .note {
    margin: 0.75rem 0 0;
    font-size: 0.8125rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  @media (max-width: 500px) {
    .panel {
      padding: 0.9rem;
    }
    .service label {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .service .state {
      grid-column: 2;
    }
    .headline dd {
      font-size: 1.125rem;
    }
  }
</style>
