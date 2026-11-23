import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { z } from 'zod';

const messages = z.record(z.string(), z.string());
const catalogSchema = z.record(z.string(), z.string());

export default defineConfig(({ mode, isSsrBuild }) => {
  const game = mode === 'game';

  return {
    plugins: [
      {
        name: 'translation-catalog',
        enforce: 'pre',
        apply: 'build',
        // Source rendering and the server read this flat JSON catalog directly.
        resolveId(id) {
          if (id === '@zluggish/i18n/en.json') {
            return '\0translation-catalog';
          }
        },
        load(id) {
          if (id !== '\0translation-catalog') {
            return;
          }
          const file = fileURLToPath(new URL('../i18n/en.json', import.meta.url));
          this.addWatchFile(file);
          const catalog = catalogSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
          return `export default ${JSON.stringify(catalog)};`;
        },
      },
      svelte(),
    ],
    base: game ? '/static/launcher-ui/' : '/',
    ssr: { noExternal: true },
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': 'http://127.0.0.1:8080',
        '/health': 'http://127.0.0.1:8080',
      },
    },
    build: {
      target: 'es2022',
      cssTarget: 'chrome100',
      outDir: game ? (isSsrBuild ? 'dist/game/server' : 'dist/game/client') : 'dist/app',
      manifest: !isSsrBuild,
      rollupOptions: {
        input: game ? (isSsrBuild ? 'src/game/server.ts' : 'src/game/client.ts') : 'index.html',
        output: isSsrBuild ? { entryFileNames: 'entry.js' } : undefined,
      },
    },
  };
});
