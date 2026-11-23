import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalog, compareCatalogs } from './i18n-catalog.mjs';
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

test('JSON catalogs reject duplicate message and section keys', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zluggish-i18n-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'en.json');
  writeFileSync(file, '{"app":{"label":"First","label":"Second"},"app":{},"game":{},"shared":{},"server":{}}');
  const result = readCatalog(file);
  assert.equal(result.catalog, undefined);
  assert.ok(result.errors.some((error) => error.includes('duplicate key app.label')));
  assert.ok(result.errors.some((error) => error.endsWith('duplicate key app')));
});

test('JSON catalogs reject invalid JSON and non-string values', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zluggish-i18n-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'en.json');
  writeFileSync(file, '{"app":{},}');
  assert.equal(readCatalog(file).catalog, undefined);
  writeFileSync(file, JSON.stringify({ app: { label: 42 }, game: {}, shared: {}, server: {} }));
  assert.ok(readCatalog(file).errors.some((error) => error.includes('app.label must be a nonempty string')));
});

test('languages must match English keys and placeholder names', () => {
  const english = { app: { greeting: 'Hello {name}' }, game: {}, shared: {}, server: {} };
  const valid = { ...english, app: { greeting: 'Hej {name}' } };
  assert.deepEqual(compareCatalogs(english, valid, 'sv.json'), []);
  const invalid = { ...english, app: { greeting: 'Hej {person}', extra: 'Extra' } };
  const errors = compareCatalogs(english, invalid, 'sv.json');
  assert.ok(errors.some((error) => error.includes('interpolation values differ')));
  assert.ok(errors.some((error) => error.includes('unused message app.extra')));
  assert.ok(
    compareCatalogs(english, { ...english, app: {} }, 'sv.json').some((error) =>
      error.includes('missing message app.greeting'),
    ),
  );
});
