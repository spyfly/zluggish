<script lang="ts">
  /** A certificate fingerprint in groups of four hex digits, easy to compare against another screen. */
  let { value, label }: { value: string; label: string } = $props();

  const groups = $derived(value.replaceAll(':', '').match(/.{1,4}/g) ?? []);
</script>

<figure class="fingerprint">
  <figcaption>{label}</figcaption>
  <p aria-label={`${label}: ${value}`}>
    {#each groups as group, index (index)}<span aria-hidden="true">{group}</span>{/each}
  </p>
</figure>

<style>
  .fingerprint {
    margin: 0;
  }
  figcaption {
    color: var(--muted);
    margin-bottom: 0.35rem;
  }
  p {
    display: grid;
    grid-template-columns: repeat(4, max-content);
    gap: 0.2rem 0.9rem;
    max-width: none;
    margin: 0;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    background: var(--well);
    font:
      600 1rem/1.5 ui-monospace,
      'Cascadia Mono',
      'DejaVu Sans Mono',
      monospace;
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
  }
  /* Eight groups a row on wide screens: the SHA-256 value fits in two rows. */
  @media (min-width: 40rem) {
    p {
      grid-template-columns: repeat(8, max-content);
    }
  }
</style>
