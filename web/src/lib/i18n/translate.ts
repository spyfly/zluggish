type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;
type InterpolationValue = string | number | boolean | bigint | null | undefined;
type Arguments<S extends string> = [Placeholders<S>] extends [never]
  ? []
  : [values: Record<Placeholders<S>, InterpolationValue>];

/** Interpolate as plain text. Each entry point supplies only its own English catalog. */
export function createTranslator<Catalog extends Record<string, string>>(catalog: Catalog) {
  return function t<K extends keyof Catalog>(key: K, ...args: Arguments<Catalog[K]>): string {
    const values = args[0] as Record<string, InterpolationValue> | undefined;
    return catalog[key].replaceAll(/\{(\w+)\}/g, (placeholder, name: string) =>
      values && Object.hasOwn(values, name) ? String(values[name]) : placeholder,
    );
  };
}
