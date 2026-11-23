import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranslator } from '../web/src/lib/i18n/translate.ts';
import { candidates } from './i18n-source.mjs';

// Exercise the guards that make extraction safe for both UI text and wire values.
test('finds Svelte text, interpolation, accessibility labels, and script errors', () => {
  const source = `<script lang="ts">const error = 'Could not save.';</script>
    <button aria-label="Retry upload">Retry in {seconds}s</button>`;
  const messages = candidates(source, 'web/src/Test.svelte');
  assert.deepEqual(
    messages.map((m) => m.value),
    ['Could not save.', 'Retry upload', 'Retry in {value1}s'],
  );
  assert.deepEqual(messages[2].args, [['value1', 'seconds']]);
});

test('ignores protocol comparisons, SQL, imports, CSS selectors, and logs', () => {
  const source = `import thing from './My Module';
    const isSent = state === 'sent';
    const sql = 'SELECT name FROM user';
    document.querySelector('input[type=text]');
    console.error('Request failed.');`;
  assert.deepEqual(candidates(source, 'server/src/example.ts'), []);
});

test('checks nested translation arguments and conditional messages', () => {
  const source = `const message = ready && 'Upload complete.';
    const other = t('existing', { value1: ok ? 'Done.' : 'Try again.' });`;
  assert.deepEqual(
    candidates(source, 'web/src/example.ts').map((m) => m.value),
    ['Upload complete.', 'Done.', 'Try again.'],
  );
});

test('interpolation preserves dollar signs and treats markup as plain text', async () => {
  const catalog = { example: 'Value: {value1}; again: {value1}' };
  const t = createTranslator(catalog);
  assert.equal(t('example', { value1: '$& <script>' }), 'Value: $& <script>; again: $& <script>');
});
