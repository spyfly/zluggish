import cloudflare from '@cloudflare/oxlint-config';
import { defineConfig } from 'oxlint';

const migrationRules = {
  '@nkzw/no-instanceof': 'off', // Temporary during migration
  curly: 'off', // Temporary during migration
  'import/consistent-type-specifier-style': 'off', // Temporary during migration
  'no-promise-executor-return': 'off', // Temporary during migration
  'react-hooks/rules-of-hooks': 'off', // Temporary during migration
  'typescript/array-type': 'off', // Temporary during migration
  'typescript/consistent-type-imports': 'off', // Temporary during migration
  'typescript/no-non-null-assertion': 'off', // Temporary during migration
  'typescript/no-unnecessary-type-assertion': 'off', // Temporary during migration
  'typescript/no-unsafe-argument': 'off', // Temporary during migration
  'typescript/no-unsafe-assignment': 'off', // Temporary during migration
  'typescript/no-unsafe-call': 'off', // Temporary during migration
  'typescript/no-unsafe-member-access': 'off', // Temporary during migration
  'typescript/no-unsafe-return': 'off', // Temporary during migration
  'typescript/no-unsafe-type-assertion': 'off', // Temporary during migration
  'typescript/unbound-method': 'off', // Temporary during migration
  'unicorn/consistent-function-scoping': 'off', // Temporary during migration
} as const;

export default defineConfig({
  ...cloudflare,
  ignorePatterns: [
    ...(cloudflare.ignorePatterns ?? []),
    '**/dist/**',
    'src/protocol/generated/**',
    '.agents/**',
    '.codex/**',
  ],
  options: {
    ...cloudflare.options,
    reportUnusedDisableDirectives: 'off', // Temporary during migration
  },
  rules: {
    ...cloudflare.rules,
    // Effect.fn and Effect.gen bodies are generators even when a step has nothing to yield.
    'require-yield': 'off',
    'oxc/no-accumulating-spread': 'error',
    // Profile privacy flags are bigint bitmasks set with |=, which this heuristic reports as a typo for ||=.
    'oxc/bad-bitwise-operator': 'off',
    // Syntax-only: it also flags Readable#push and StateHistory#push, where its autofix changes argument meaning.
    'unicorn/prefer-single-call': 'off',
    ...migrationRules,
  },
  overrides: [
    ...(cloudflare.overrides ?? []),
    {
      // Entry points print startup and CLI output; the logging repository is the console sink.
      files: ['src/main.ts', 'src/cli/**', 'src/repositories/logging.repository.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      // Svelte compiles runes away, so they are not imported.
      files: ['**/*.svelte'],
      globals: {
        $bindable: 'readonly',
        $derived: 'readonly',
        $effect: 'readonly',
        $host: 'readonly',
        $inspect: 'readonly',
        $props: 'readonly',
        $state: 'readonly',
      },
    },
    // Inherited overrides re-enable some migration rules for TypeScript and test files.
    { files: ['**/*'], rules: migrationRules },
  ],
});
