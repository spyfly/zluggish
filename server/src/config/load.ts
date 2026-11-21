import type { ResolvedConfig } from '#src/config/index';
import { ConfigError, decodeConfigInput, validateConfig } from '#src/config/index';
import { createJiti } from 'jiti';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { createSecureContext } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { Predicate, Schema } from 'effect';

export const CONFIG_NAME = 'zluggish.config.ts';

const isPackageManifest = Schema.is(Schema.Struct({ name: Schema.Literal('zluggish') }));

export function packageRoot(): string {
  let current = import.meta.dirname;

  while (dirname(current) !== current) {
    const manifest = resolve(current, 'package.json');

    if (existsSync(manifest) && isPackageManifest(JSON.parse(readFileSync(manifest, 'utf8')))) {
      return current;
    }
    current = dirname(current);
  }

  throw new ConfigError('Cannot locate server package');
}

let version: string | undefined;

/** The server's own release version from package.json, shown in the launcher and on /health. */
export function packageVersion(): string {
  version ??= Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(
    readFileSync(resolve(packageRoot(), 'package.json'), 'utf8'),
  ).version;

  return version;
}

/** Supported client release from the bundled update manifest. */
export function supportedZwiftVersion(): string {
  const manifest = readFileSync(
    resolve(packageRoot(), '../assets/cdn/gameassets/Zwift_Updates_Root/Zwift_ver_cur.xml'),
    'utf8',
  );

  return /sversion="([^"]+)"/.exec(manifest)?.[1] ?? 'Unknown';
}

export function selectConfigPath(path?: string, env = process.env): string {
  const selected = resolve(path ?? env.ZLUGGISH_CONFIG ?? resolve(packageRoot(), CONFIG_NAME));

  if (basename(selected) !== CONFIG_NAME) {
    throw new ConfigError(`Configuration must be named ${CONFIG_NAME}`);
  }

  return selected;
}

export interface LoadedConfig {
  path: string;
  config: ResolvedConfig;
}

export interface LoadOptions {
  path?: string;
  storageDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function prepareContainerConfig(options: LoadOptions): LoadOptions {
  const env = options.env ?? process.env;
  const defaultStorage = env.ZLUGGISH_CONTAINER_STORAGE_DIR;

  if (!defaultStorage || options.path !== undefined || env.ZLUGGISH_CONFIG !== undefined) {
    return options;
  }
  const storage = resolve(options.storageDir ?? env.ZLUGGISH_STORAGE_DIR ?? defaultStorage);
  const path = resolve(storage, CONFIG_NAME);
  mkdirSync(storage, { recursive: true });

  try {
    copyFileSync(resolve(packageRoot(), '../examples/container/zluggish.config.ts'), path, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }

  return { ...options, path };
}

interface LoadError {
  name: string;
  code?: string | undefined;
  message: string;
  stack: string;
}

/** The string fields of whatever a configuration module threw. */
function loadError(cause: unknown): LoadError {
  const field = (key: string) =>
    Predicate.hasProperty(cause, key) && Predicate.isString(cause[key]) ? cause[key] : undefined;

  return {
    name: field('name') ?? 'Error',
    code: field('code'),
    message: field('message') ?? '',
    stack: field('stack') ?? '',
  };
}

/** Report the runtime message and first operator source location without dependency stacks. */
function describeLoadError({ name, code, message, stack }: LoadError, path: string) {
  const normalizedPath = path.replaceAll('\\', '/');
  const normalizedMessage = message.replaceAll('\\', '/');
  const normalizedStack = stack.replaceAll('\\', '/');
  const escaped = normalizedPath.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const position = new RegExp(String.raw`${escaped}:(\d+):(\d+)`).exec(`${normalizedMessage}\n${normalizedStack}`);
  const where = position ? ` at line ${position[1]}, column ${position[2]}` : '';
  const missing = /Cannot find (?:module|package) '([^']+)'/.exec(message)?.[1];

  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return `cannot find the import ${missing ? `'${missing}'` : 'it names'}${where}`;
  }
  const parse = /^ParseError: (?:[A-Z]:[\\/]: )?([^\n]+)/.exec(message)?.[1]?.trim();

  if (parse) {
    return `syntax error${where}: ${parse}`;
  }
  const undefinedName = name === 'ReferenceError' ? /^(\S+) is not defined$/.exec(message)?.[1] : undefined;

  if (undefinedName) {
    return `'${undefinedName}' is not defined${where}`;
  }

  const frame = stack
    .split('\n')
    .find(
      (line) =>
        /^\s+at /.test(line) &&
        line.replaceAll('\\', '/').includes(`${dirname(path).replaceAll('\\', '/')}/`) &&
        !line.includes('/node_modules/'),
    );

  return `${name}${where}${message ? `: ${message}` : ''}${frame ? `\n${frame.trim().replaceAll('/', () => sep)}` : ''}`;
}

export async function loadConfig(options: LoadOptions = {}): Promise<LoadedConfig> {
  const env = options.env ?? process.env;
  const path = selectConfigPath(options.path, env);

  if (!existsSync(path)) {
    throw new ConfigError(`Missing ${path}; run config init or config migrate`);
  }
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

  const jiti = createJiti(import.meta.url, {
    alias: {
      'zluggish/config': fileURLToPath(new URL(`index.${extension}`, import.meta.url)),
    },
    moduleCache: false,
    fsCache: false,
    tryNative: false,
  });

  let config: ResolvedConfig;

  try {
    const module = Schema.decodeUnknownSync(Schema.Struct({ default: Schema.Unknown }))(await jiti.import(path));

    const value = module.default;

    const evaluated: unknown = Predicate.isFunction(value)
      ? // oxlint-disable-next-line typescript/no-unsafe-call
        value({ env: { ...env }, configDir: dirname(path) })
      : value;

    if (Predicate.isPromise(evaluated)) {
      throw new ConfigError('Async configuration is not supported');
    }
    const parsed = decodeConfigInput(evaluated);

    config = validateConfig({
      ...parsed,
      storageDir: options.storageDir ?? env.ZLUGGISH_STORAGE_DIR ?? parsed.storageDir,
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    throw new ConfigError(`Cannot evaluate ${path}: ${describeLoadError(loadError(error), path)}`);
  }

  const relative = (p: string) => (p && !isAbsolute(p) ? resolve(dirname(path), p) : p);

  const resolved = validateConfig({
    ...config,
    storageDir: resolve(options.storageDir ?? env.ZLUGGISH_STORAGE_DIR ?? relative(config.storageDir)),
    ghosts: {
      ...config.ghosts,
      profileFile: relative(config.ghosts.profileFile),
    },
    bots: { ...config.bots, ridersFile: relative(config.bots.ridersFile) },
    integrations: {
      ...config.integrations,
      discord: {
        ...config.integrations.discord,
        credentialsFile: relative(config.integrations.discord.credentialsFile),
      },
      matrix: {
        ...config.integrations.matrix,
        credentialsFile: relative(config.integrations.matrix.credentialsFile),
      },
    },
    tls: {
      ...config.tls,
      certFile: relative(config.tls.certFile),
      keyFile: relative(config.tls.keyFile),
    },
    riderDefaults: {
      ...config.riderDefaults,
      workouts: {
        trainingpeaks: {
          bridgeFolder: relative(config.riderDefaults.workouts.trainingpeaks.bridgeFolder),
        },
      },
    },
  });

  for (const [field, resource] of [
    ['ghosts.profileFile', resolved.ghosts.profileFile],
    ['bots.ridersFile', resolved.bots.ridersFile],
    ['integrations.discord.credentialsFile', resolved.integrations.discord.credentialsFile],
    ['integrations.matrix.credentialsFile', resolved.integrations.matrix.credentialsFile],
    ['tls.certFile', resolved.tls.certFile],
    ['tls.keyFile', resolved.tls.keyFile],
  ]) {
    if (!resource) {
      continue;
    }

    try {
      if (!statSync(resource).isFile()) {
        throw new ConfigError(`${field}: expected a readable regular file`);
      }
      accessSync(resource, constants.R_OK);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }

      throw new ConfigError(`${field}: referenced file missing or unreadable`);
    }
  }

  if (existsSync(resolved.storageDir) && !statSync(resolved.storageDir).isDirectory()) {
    throw new ConfigError('storageDir: expected a directory');
  }

  if (resolved.tls.certFile && resolved.tls.keyFile) {
    try {
      createSecureContext({
        cert: readFileSync(resolved.tls.certFile),
        key: readFileSync(resolved.tls.keyFile),
      });
    } catch {
      throw new ConfigError('tls: invalid certificate or private key');
    }
  }

  return { path, config: resolved };
}
