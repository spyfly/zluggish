import { Effect, Option, Predicate, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from 'effect';
import type { Types } from 'effect';

/** Decode options that reject undeclared keys at every level, for configuration files. */
export const strict = { onExcessProperty: 'error', errors: 'all' } as const;

/** A struct that rejects keys it does not declare, wherever it is decoded. */
const AnyObject = Schema.Record(Schema.String, Schema.Unknown);

export function Strict<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  const keys = new Set(Object.keys(fields));

  return AnyObject.check(
    Schema.makeFilter((input: typeof AnyObject.Type) => {
      const extra = Object.keys(input).filter((key) => !keys.has(key));

      return extra.length === 0 || extra.map((key) => ({ path: [key], issue: 'Expected no excess property' }));
    }),
  ).pipe(Schema.decodeTo(Schema.Struct(fields), SchemaTransformation.passthroughSupertype()));
}

/** A missing or undefined key decodes to `value`, which is then decoded by the schema. */
export function withDefault<S extends Schema.Constraint>(value: S['Encoded']) {
  return (schema: S) => Schema.withDecodingDefault<S>(Effect.succeed(value))(schema);
}

/** A missing or undefined key decodes to the value `make` returns at decode time. */
export function withLazyDefault<S extends Schema.Constraint>(make: () => S['Encoded']) {
  return (schema: S) => Schema.withDecodingDefault<S>(Effect.sync(make))(schema);
}

/** Any value that fails to decode decodes to `value` instead. */
export function orElse<S extends Schema.Constraint>(value: S['Type']) {
  return (schema: S) => Schema.catchDecoding<S>(() => Effect.succeed(Option.some(value)))(schema);
}

/** Reject values that do not satisfy `predicate`, with a readable message. */
export function satisfies<T>(predicate: (value: T) => boolean, message: string) {
  return Schema.makeFilter<T>((value) => predicate(value), { message, expected: message });
}

/** A string without NUL characters. */
export const Text = Schema.String.check(satisfies((value: string) => !value.includes('\0'), 'Invalid string'));

/** A string with visible content and no NUL characters. */
export const NonBlank = Schema.String.check(
  satisfies((value: string) => value.trim().length > 0 && !value.includes('\0'), 'Expected a non-empty string'),
);

/** An integer in `[minimum, maximum]`. */
export function IntBetween(minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return Schema.Int.check(Schema.isBetween({ minimum, maximum }));
}

/** A positive safe integer, such as a row or player ID. */
export const PositiveInt = IntBetween(1);

/** A safe integer of at least zero. */
export const NonNegativeInt = IntBetween(0);

/** A positive safe integer written in decimal, such as a command-line or route ID. */
export const PositiveIntFromString = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

/** A finite number greater than `minimum`. */
export function FiniteAbove(minimum: number) {
  return Schema.Finite.check(Schema.isGreaterThan(minimum));
}

/** A finite number of at least `minimum`. */
export function FiniteFrom(minimum: number) {
  return Schema.Finite.check(Schema.isGreaterThanOrEqualTo(minimum));
}

export interface SchemaProblem {
  /** Dotted path to the failing value; empty at the root. */
  readonly path: string;
  readonly message: string;
}

const standard = SchemaIssue.makeFormatterStandardSchemaV1();

/** Flatten a decoding failure into one problem per failing value. Inputs are never included. */
export function schemaProblems(error: Schema.SchemaError): SchemaProblem[] {
  return standard(error.issue).issues.map((issue) => ({
    path: (issue.path ?? []).map((key) => String(Predicate.isObject(key) && 'key' in key ? key.key : key)).join('.'),
    message: issue.message,
  }));
}

/** Form field errors keyed by the first path segment. */
export function fieldErrors(error: Schema.SchemaError) {
  const fields: Record<string, string[]> = {};

  for (const problem of schemaProblems(error))
    (fields[problem.path.split('.', 1)[0] || 'form'] ??= []).push(problem.message);

  return fields;
}

/** A parseable absolute URL. */
export const Url = Schema.String.check(satisfies((value: string) => URL.canParse(value), 'Expected a URL'));

/** An email address. */
export const Email = Schema.String.check(
  Schema.isPattern(/^(?!\.)(?!.*\.\.)([\w'+.-]*[\w+-])@([\da-z][\da-z-]*\.)+[a-z]{2,}$/i, {
    expected: 'an email address',
  }),
);

/** A string, lowercased when decoded. */
export const Lowercase = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.passthrough(),
  }),
);

/** A finite number, or a decimal string decoded to one, as in query strings and form fields. */
export const NumberFromInput = Schema.Union([Schema.Finite, Schema.NumberFromString.check(Schema.isFinite())]);

/** An ISO 8601 UTC date-time such as `2024-01-01T08:00:00Z`, with optional fractional seconds. */
export const IsoDateTime = Schema.String.check(
  satisfies(
    (value: string) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/.test(value) && !Number.isNaN(Date.parse(value)),
    'Expected an ISO date-time in UTC',
  ),
);

/** A calendar date such as `2024-02-29`. */
export const IsoDate = Schema.String.check(
  satisfies((value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Expected an ISO date'),
);

/** Decode a string through `normalize` before checking it with `schema`. */
export function normalized(normalize: (value: string) => string, schema: Schema.Codec<string, string>) {
  return Schema.String.pipe(
    Schema.decodeTo(schema, { decode: SchemaGetter.transform(normalize), encode: SchemaGetter.passthrough() }),
  );
}

/** Decode into a value the caller owns and may change. */
export function decodeOwned<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownSync(schema);

  // SAFETY: decoding builds new objects and arrays that nothing else references,
  // so the caller may change them.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (...input: Parameters<typeof decode>) => decode(...input) as Types.DeepMutable<S['Type']>;
}
