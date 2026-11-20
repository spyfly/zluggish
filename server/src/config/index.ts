import { configSchema, riderSettingsSchema } from '#src/config/schema';
import { schemaProblems, strict } from '#src/schema';
import { Predicate, Schema } from 'effect';

export type { ConfigInput, ResolvedConfig, RiderSettings } from '#src/config/schema';

import type { ConfigInput, ResolvedConfig, RiderSettings } from '#src/config/schema';

export interface ConfigContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly configDir: string;
}

export type ConfigDefinition = ConfigInput | ((context: ConfigContext) => ConfigInput);

export function defineConfig<T extends ConfigDefinition>(config: T): T {
  return config;
}

export class ConfigError extends Error {}

const decodeConfig = Schema.decodeUnknownSync(configSchema, strict);

const decodeRiderSettings = Schema.decodeUnknownSync(riderSettingsSchema, strict);

/** A ConfigError naming each invalid field. */
export function validationError(error: Schema.SchemaError): ConfigError {
  return new ConfigError(
    schemaProblems(error)
      .map((problem) => `${problem.path || '<root>'}: ${problem.message}`)
      .join('; '),
  );
}

/** Freeze a decoded configuration and everything it contains: the runtime shares it. */
function freezeDeep<T extends object>(value: T): T {
  for (const item of Object.values(value)) {
    if (Predicate.isObject(item)) {
      freezeDeep(item);
    }
  }

  return Object.freeze(value);
}

/** Run `decode`, reporting schema failures as a ConfigError. */
function decoding<A>(decode: () => A): A {
  try {
    return decode();
  } catch (error) {
    throw Schema.isSchemaError(error) ? validationError(error) : error;
  }
}

/** Decode an unvalidated configuration object, or throw a ConfigError naming each invalid field. */
export const decodeConfigInput = (...input: Parameters<typeof decodeConfig>): ResolvedConfig =>
  decoding(() => decodeConfig(...input));

export function validateConfig(value: ConfigInput): ResolvedConfig {
  const config = decodeConfigInput(value);
  const ids = config.pelotons.map((p) => p.id);

  if (new Set(ids).size !== ids.length) {
    throw new ConfigError('pelotons: duplicate group ID');
  }

  if (config.integrations.discord.enabled && !config.integrations.discord.credentialsFile) {
    throw new ConfigError('integrations.discord.credentialsFile: required when enabled');
  }

  if (config.integrations.matrix.enabled) {
    for (const field of ['credentialsFile', 'homeserver', 'user', 'room'] as const) {
      if (!config.integrations.matrix[field]) {
        throw new ConfigError(`integrations.matrix.${field}: required when enabled`);
      }
    }
  }

  if (Boolean(config.tls.certFile) !== Boolean(config.tls.keyFile)) {
    throw new ConfigError('tls.certFile and tls.keyFile: both required when configuring custom TLS');
  }

  return freezeDeep(config);
}

export function validateRiderSettings(value: typeof riderSettingsSchema.Encoded): RiderSettings {
  return freezeDeep(decoding(() => decodeRiderSettings(value)));
}

export function envBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value !== 'true' && value !== 'false') {
    throw new ConfigError('Expected true or false environment value');
  }

  return value === 'true';
}

export function envInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ConfigError('Expected integer environment value');
  }

  return Number(value);
}
