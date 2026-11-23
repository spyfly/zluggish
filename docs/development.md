---
sidebar_position: 7
description: Build, check and test Zluggish from source.
---

# Development

## Set up

1. Install [mise](https://mise.jdx.dev/getting-started.html).
2. From the repository root, run:

   ```sh
   cd server
   mise install
   mise run install
   mise run check
   ```

`mise run check` builds, lints, typechecks and tests the server and its CLI. It also checks the formatting.

## Individual checks

From `server/`, run one of these commands:

| Command           | Result                |
| ----------------- | --------------------- |
| `pnpm lint`       | Lint the code.        |
| `pnpm typecheck`  | Typecheck the code.   |
| `pnpm test`       | Run the tests.        |
| `pnpm format`     | Check the formatting. |
| `pnpm lint:fix`   | Fix lint problems.    |
| `pnpm format:fix` | Fix the formatting.   |

Linting and formatting do not include the generated protobuf codecs, the bundled assets and the vendored lint rules.

## Web app

- Build the web app with `pnpm --dir web build`.
- Typecheck it with `pnpm --dir web check`.

## Screenshots

To make the screenshots in `media/screenshots/` again, run `pnpm --dir server screenshots`. The command uses fictional riders on a temporary server.

## Documentation

This site is in [`docs/`](https://github.com/zluggish/zluggish/tree/main/docs). The Docusaurus configuration is in [`sites/docs.zluggish.com/`](https://github.com/zluggish/zluggish/tree/main/sites/docs.zluggish.com).

1. Install the dependencies from the repository root:

   ```sh
   pnpm install --frozen-lockfile --filter @zluggish/docs...
   ```

2. Start the local site:

   ```sh
   pnpm --filter @zluggish/docs start
   ```

3. Build the site:

   ```sh
   pnpm --filter @zluggish/docs build
   ```

Write new text in [ASD-STE100](https://www.asd-ste100.org/) Simplified Technical English. Give one action in each step.

## Server architecture

The server uses [Effect](https://effect.website/):

- Each service in `server/src/services` is a `Context.Service` with a `layer`. `server/src/layers.ts` builds every layer from the runtime context, in tiers: a service can use only the services in the tiers below it.
- The runtime (`server/src/runtime.ts`) acquires its resources into an Effect scope. Closing the runtime releases them in reverse order.
- HTTP handlers are Effects. Register them with `effectRoutes` from `server/src/http/effect.ts`. A handler failure goes to the Hono error handler unchanged.
- Code that is not an Effect, such as socket callbacks and the world loop, runs effects with `runtime.effects.runSync` or `runtime.effects.runPromise`.
- Errors are `Schema.TaggedError` classes in `server/src/errors.ts`. Validation uses Effect Schema; the shared helpers are in `server/src/schema.ts`.
- Repositories and database transactions stay synchronous. See the [database notes](https://github.com/zluggish/zluggish/blob/main/server/src/db/README.md).

In tests, the fixture gives `f.effects`, the application runtime. Get a service with `f.effects.runSync(Service)`, or run one call with `f.effects.runSync(Service.use((service) => service.method()))`.

## Lint rules

ESLint uses TypeScript-aware correctness rules, import checks and Unicorn conventions. The first configuration came from the `server/eslint.config.mjs` file of `immich-app/immich`. The vendored Oxlint rules record their source revision in [UPSTREAM.md](https://github.com/zluggish/zluggish/blob/main/server/tools/oxlint/anti-slop/UPSTREAM.md).

The shared ESLint, Oxlint, Prettier and mise configuration is in `server/`.

### Translations

Runtime messages live in the root `i18n/en.json` catalog. There is one JSON
file per language, with `app`, `game`, `shared`, and `server` sections. English
is the only locale for now. Keep the existing message keys stable when editing copy.

Add a descriptive key to the appropriate section and call `t('key')` through
the existing translation helper. Use named placeholders for dynamic values, for
example `t('key', { value1: count })` with `"{value1} riders"` in the catalog.
TypeScript checks message keys; the translation check validates interpolation
arguments. Svelte escapes the result as ordinary text. Keep complete sentences
together where possible.

The shared workspace package `@zluggish/i18n` exposes the JSON directly to the
server and source rendering. Vite includes only app/shared or game/shared
messages in each browser bundle. Docker copies the catalog package into the
runtime image. No generated translation files need to be maintained.

To add a language, copy `i18n/en.json` to a new language file such as
`i18n/sv.json` and translate the values. The check requires matching keys and
placeholder names in every language. Locale selection is not implemented yet.

Run `mise run i18n:check` (or `pnpm i18n:check`) from the repository root before
committing. This validates missing and unused keys, duplicate JSON keys,
interpolation arguments, and untranslated UI text. `mise run i18n:test` tests
the checker and interpolation. GitHub Actions runs both tasks on pull requests
and pushes to main.

Protocol values, SQL, certificate identities, and executable setup-script syntax
must remain literal. The source checker excludes common technical contexts;
any other exception needs a specific file, exact value, and reason in
`scripts/i18n-exemptions.json`. Stale exceptions fail the check. Documentation
and the static marketing sites are maintained separately from runtime messages.
