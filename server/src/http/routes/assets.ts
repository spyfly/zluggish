import { Effect } from 'effect';
import { effectRoutes } from '#src/http/effect';
import { FilesService } from '#src/services/files.service';
import { packageRoot } from '#src/config/load';
import { gamePage } from '#src/http/game/render';
import type { HttpRuntime as Runtime, RuntimeEnv } from '#src/http/runtime';
import type { Hono } from 'hono';
import { extname, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

const types = new Map([
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.js', 'text/javascript'],
  ['.woff2', 'font/woff2'],
  ['.html', 'text/html; charset=utf-8'],
]);

function inside(root: string, path: string) {
  let target: string;

  try {
    target = resolve(root, `.${decodeURIComponent(path)}`);
  } catch {
    return null;
  }

  const within = relative(root, target);

  return within && !within.startsWith('..') && !within.includes('\0') ? target : null;
}

// A single `bytes=` range, as the game requests for large mochi files. Anything else is served in full.
export function byteRange(
  header: string | undefined,
  size: number,
): 'unsatisfiable' | null | { start: number; end: number } {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');

  if (!match) return null;

  const [, first = '', last = ''] = match;

  if (first === '') {
    if (last === '') return null;
    const length = Number(last);

    return length > 0 && size > 0 ? { start: Math.max(0, size - length), end: size - 1 } : 'unsatisfiable';
  }

  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);

  if (last !== '' && Number(last) < start) return null;

  return start < size ? { start, end } : 'unsatisfiable';
}

export function assetRoutes(app: Hono<RuntimeEnv>, runtime: Runtime) {
  const appRoutes = effectRoutes(app, runtime);

  const serve = (prefix: string, root: string) =>
    // Streams files instead of buffering them: mochi route videos are tens of megabytes each and the game
    // requests several at once, so reading them whole exhausted the container's memory.
    appRoutes.get(`${prefix}/*`, (c) =>
      Effect.gen(function* () {
        const filesService = yield* FilesService;

        const file = inside(root, c.req.path.slice(prefix.length));

        if (!file || !(yield* filesService.isFile(file))) return c.notFound();

        const size = yield* filesService.size(file);
        const type = types.get(extname(file)) ?? 'application/octet-stream';
        const range = byteRange(c.req.header('Range'), size);

        if (range === 'unsatisfiable')
          return c.body(null, 416, {
            'Content-Type': type,
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${size}`,
          });

        if (size === 0)
          return c.body(new Uint8Array(), 200, {
            'Content-Type': type,
            'Accept-Ranges': 'bytes',
            'Content-Length': '0',
          });

        const { start, end } = range ?? { start: 0, end: size - 1 };

        // SAFETY: Node returns a WHATWG byte stream; Node and DOM stream declarations differ in their BYOB overloads.
        const body = Readable.toWeb(yield* filesService.readStream(file, { start, end })) as ReadableStream<Uint8Array>;

        const headers = new Headers({
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        });

        if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);

        return c.body(body, range ? 206 : 200, Object.fromEntries(headers));
      }),
    );

  appRoutes.get('/static/launcher-ui/*', (c) =>
    Effect.gen(function* () {
      const filesService = yield* FilesService;

      const file = inside(
        resolve(packageRoot(), '../web/dist/game/client/assets'),
        c.req.path.slice('/static/launcher-ui/assets'.length),
      );

      if (!file || !c.req.path.startsWith('/static/launcher-ui/assets/') || !(yield* filesService.isFile(file)))
        return c.notFound();

      return c.body(yield* filesService.read(file), 200, {
        'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
    }),
  );

  app.get('/static/web/launcher/embed.html', (c) =>
    runtime.effects.runPromise(
      gamePage(c, {
        kind: 'message',
        title: 'Loading Zwift...',
        message: 'Enjoying Zluggish? Please star us on GitHub: zluggish.com',
        csrf: '',
        version: '',
        forms: [],
      }),
    ),
  );

  serve('/style', resolve(runtime.assets, 'cdn/style'));
  serve('/static', resolve(runtime.assets, 'cdn/static'));
  serve('/mochi', resolve(runtime.config.storageDir, 'mochi'));

  // Launcher 1.1.17 requests game assets over HTTPS; the CDN listener can proxy them.
  // eslint-disable-next-line unicorn/prefer-https -- HTTP reaches the separate CDN listener and avoids a redirect loop.
  app.get('/gameassets/*', (c) => c.redirect(`http://cdn.zwift.com${c.req.path}`));
}
