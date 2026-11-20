<script lang="ts">
  let {
    id,
    label,
    value = $bindable(''),
    password = false,
    type = 'text',
    autocomplete = 'off',
    required = false,
    maxlength = undefined,
    hint = undefined,
    errors = [],
  }: {
    id: string;
    label: string;
    value?: string;
    password?: boolean;
    type?: 'text' | 'date';
    autocomplete?: HTMLInputElement['autocomplete'];
    required?: boolean;
    maxlength?: number | undefined;
    hint?: string | undefined;
    errors?: Array<string> | undefined;
  } = $props();

  const described = $derived(
    [hint ? `${id}-hint` : '', errors.length ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined,
  );
</script>

<div class="field">
  <label for={id}>{label}</label>
  {#if password}<input
      {id}
      type="password"
      bind:value
      {autocomplete}
      {required}
      {maxlength}
      aria-invalid={errors.length > 0}
      aria-describedby={described}
    />{:else}<input
      {id}
      {type}
      bind:value
      {autocomplete}
      {required}
      {maxlength}
      aria-invalid={errors.length > 0}
      aria-describedby={described}
    />{/if}
  {#if hint}<p id={`${id}-hint`} class="hint">{hint}</p>{/if}
  {#if errors.length}<p id={`${id}-error`} class="field-error">{errors.join(' ')}</p>{/if}
</div>

<style>
  .field {
    margin-bottom: 0.25rem;
  }
  .hint {
    margin: 0.3rem 0 0;
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .field-error {
    margin: 0.35rem 0 0;
    color: var(--alarm);
    font-size: 0.875rem;
  }
  input[aria-invalid='true'] {
    border-color: #ff6b57;
  }
</style>
