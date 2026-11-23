<script lang="ts">
  let { load }: { load: () => Promise<{ entries: Array<string> }> } = $props();

  let open = $state(false);
  let loading = $state(false);
  let errorMessage = $state('');
  let entries = $state<Array<string>>([]);

  async function refresh() {
    loading = true;
    errorMessage = '';

    try {
      entries = (await load()).entries;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Could not load server logs.';
    } finally {
      loading = false;
    }
  }

  function toggle() {
    open = !open;

    if (open && !loading) {
      void refresh();
    }
  }
</script>

<div class="actions">
  <button type="button" aria-expanded={open} aria-controls="server-log-output" onclick={toggle}>
    {open ? 'Hide logs' : 'View logs'}
  </button>
  {#if open}
    <button type="button" disabled={loading} onclick={refresh}>Refresh logs</button>
  {/if}
</div>
<div id="server-log-output" hidden={!open}>
  {#if open}
    <p>Newest first.</p>
    {#if loading}<p role="status">Loading logs…</p>{/if}
    {#if errorMessage}<p role="alert">{errorMessage}</p>{/if}
    {#if entries.length}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (the scroll region needs keyboard focus) -->
      <div class="output" role="region" tabindex="0" aria-label="Server log entries">
        <pre>{entries.join('\n')}</pre>
      </div>
    {:else if !loading && !errorMessage}
      <p>No server logs yet.</p>
    {/if}
  {/if}
</div>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  p {
    color: var(--muted);
  }
  p[role='alert'] {
    color: var(--alarm);
  }
  .output {
    max-height: 28rem;
    overflow: auto;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--well);
  }
  pre {
    margin: 0;
    font-size: 0.8125rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
