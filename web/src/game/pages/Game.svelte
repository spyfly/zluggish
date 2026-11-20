<script lang="ts">
  import { untrack } from 'svelte';
  import { request } from '../../lib/connection';
  import Layout from '../../components/Layout.svelte';
  import Form from '../../components/Form.svelte';
  import type { GamePageModel } from '../../lib/game-app.dto';

  let { page }: { page: GamePageModel } = $props();
  let current = $state(untrack(() => page));
  let locked = $state(false);

  // Counts failures handed up from the user list, so the same message twice is shown and announced again.
  let failures = $state(0);

  function expire() {
    locked = true;
  }

  $effect(() => {
    // The launcher's public loading screen has no rider session to monitor.
    if (!current.csrf) return;

    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('zluggish-session-change') : undefined;
    let controller: AbortController | undefined;
    let alive = true;
    channel?.addEventListener('message', expire);

    async function check() {
      if (document.hidden || locked) return;
      controller?.abort();
      controller = new AbortController();

      try {
        const response = await request('/ui/status/session', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'X-Game-Context': current.csrf },
          signal: controller.signal,
        });

        if (alive && [401, 409].includes(response.status)) expire();
      } catch {
        /* A network error is not proof that the session expired. */
      }
    }

    const focus = () => {
      void check();
    };

    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);

    return () => {
      alive = false;
      controller?.abort();
      channel?.close();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  });
</script>

<Layout
  title={current.title}
  page={current.kind}
  back={current.back}
  version={current.version}
  zwiftVersion={current.zwiftVersion}
>
  {#if current.warning}<p class="security" role="alert">
      <strong>Unsafe connection.</strong>
      {current.warning}
    </p>{/if}
  {#key failures}{#if current.message}<p class="notice" role={current.failed ? 'alert' : 'status'}>
        {current.message}
      </p>{/if}{/key}
  {#if locked}<p class="error" role="alert">
      Your session or user changed. <a href="/login/">Sign in</a> or
      <button type="button" onclick={() => location.reload()}>Reload this page</button>.
    </p>{/if}
  {#each current.forms as model (model.id)}
    <div hidden={current.kind === 'dashboard' && model.id === 'switch'}>
      <Form
        {model}
        csrf={current.csrf}
        {locked}
        onpage={(value) => {
          if (value.kind !== 'message') current = value;
        }}
        onexpire={expire}
        onfail={model.user
          ? (message) => {
              current = { ...current, message, failed: true };
              failures++;
            }
          : undefined}
      >
        {#snippet actions()}
          {#if current.kind === 'dashboard' && model.id === 'launch'}
            <button type="submit" form="game-form-switch" disabled={locked}>Switch rider</button>
          {/if}
        {/snippet}
      </Form>
    </div>
  {/each}
  {#if current.kind === 'dashboard'}
    <p class="settings-note">Use the separate webapp to change settings.</p>
  {/if}
</Layout>

<style>
  /* Sized for the small launcher window: one compact strip above the page. */
  .security {
    max-width: none;
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid #ff6b57;
    border-radius: 0 8px 8px 0;
    background: rgb(255 90 70 / 0.16);
    color: var(--alarm);
    font-size: 0.8125rem;
    line-height: 1.35;
  }
  .security strong {
    color: var(--text);
    font-weight: 800;
  }
  .settings-note {
    color: var(--muted);
  }
</style>
