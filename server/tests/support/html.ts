// Read input attributes independently of SSR attribute order.
export function inputValue(html: string, name: string) {
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = new Map(
      Array.from(input[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g), (match) => [
        match[1],
        match[2] ?? match[3] ?? match[4],
      ]),
    );

    if (attributes.get('name') === name) {
      return attributes.get('value');
    }
  }

  return;
}

export async function responseStatus(response: Promise<Response> | Response) {
  const result = await Promise.resolve(response);

  return result.status;
}
