import { Effect } from 'effect';
import { FilesService } from '#src/services/files.service';
import type { Context } from 'hono';
import { Readable } from 'node:stream';

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

/**
Respond with a file on disk, streamed instead of read whole, honouring a single byte range.
Callers check that the file exists and may be served; headers are added to every response.
*/
export const fileResponse = Effect.fn('fileResponse')(function* (
  c: Context,
  path: string,
  headers: Record<string, string> = {},
) {
  const filesService = yield* FilesService;
  const size = yield* filesService.size(path);
  const range = byteRange(c.req.header('Range'), size);

  if (range === 'unsatisfiable')
    return c.body(null, 416, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${size}` });

  if (size === 0) return c.body(new Uint8Array(), 200, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': '0' });

  const { start, end } = range ?? { start: 0, end: size - 1 };

  // SAFETY: Node returns a WHATWG byte stream; Node and DOM stream declarations differ in their BYOB overloads.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const body = Readable.toWeb(yield* filesService.readStream(path, { start, end })) as ReadableStream<Uint8Array>;

  return c.body(body, range ? 206 : 200, {
    ...headers,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    ...(range && { 'Content-Range': `bytes ${start}-${end}/${size}` }),
  });
});
