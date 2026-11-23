import { en } from '#src/i18n/en';

export type MessageKey = keyof typeof en;
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;
type InterpolationValue = string | number | boolean | bigint | null | undefined;
type Arguments<K extends MessageKey> = [Placeholders<(typeof en)[K]>] extends [never]
  ? []
  : [values: Record<Placeholders<(typeof en)[K]>, InterpolationValue>];

/** English for now; interpolate values as text, never as HTML. */
export function t<K extends MessageKey>(key: K, ...args: Arguments<K>): string {
  const values = args[0] as Record<string, InterpolationValue> | undefined;
  return en[key].replaceAll(/\{(\w+)\}/g, (placeholder, name: string) =>
    values && Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
