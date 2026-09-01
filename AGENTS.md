# Repository Guidelines

> **Always read `AGENTS.md` at the start of any task** and follow it for all project rules. If `AGENTS.override.md` is also present in the checkout, read it as well — it takes precedence over `AGENTS.md` wherever the two conflict. Treat `AGENTS.override.md` as a layer applied on top of `AGENTS.md`, not a full replacement.

## Definition of Done (read this first)

Every change, however small, is done only when ALL of these hold:

1. It is on a feature branch — never commit to `main`.
2. `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test` all pass, run in that order.
3. Every document the change makes stale is updated in the same PR (see **Documentation Maintenance**).
4. If a migration was added/edited/removed, BOTH schema dumps are regenerated (see **Database Backends & Local Setup**; CI fails on SQLite-dump drift).
5. The commit subject and PR title carry the correct conventional prefix, and `package.json` `version` is untouched (see **Commit & Pull Request Guidelines**).
6. UI changes are verified in a real browser (see **Local Manual / Browser Testing**) with screenshots in the PR.

For the most common task shapes, follow the step-by-step **Task Recipes** section below instead of improvising.

## Project Structure & Module Organization

- `app/` contains the Next.js App Router UI and API routes (see `app/api/` and route groups like `app/(nosidebar)/`).
- `lib/` hosts core domain logic, database access, services, jobs, and shared utilities.
- `migrations/` holds Knex migration files used for SQL backends.
- `public/` serves static assets; `uploads/` and `data/` are used for local storage in some deployments.
- `docs/` includes setup and database-specific guides; `scripts/` includes repo utilities; `lint/` holds the local Oxlint JS plugin (`agentsRules.mjs`) that carries the AGENTS.md conventions Oxlint cannot express natively, plus its guard test.
  - **`docs/` is for durable, general-purpose reference documentation only** (setup, architecture, environment variables, feature guides). **Do NOT add** implementation plans, design docs, task/PR-specific writeups, gap analyses, before/after screenshots, or any other artifact tied to a single change or pull request. Those belong in the PR description or issue tracker, not the repo. Do not create `docs/plans/`, `docs/specs/`, `docs/pr-screenshots/`, or similar scratch directories.
  - `scripts/` is organized as `mock/`, `maintenance/`, `fitness/`, and `backup/`. Every script runs through the `scripts/run.cjs` bootstrap (`node scripts/run.cjs <script>.ts`), which is also wired into each script's shebang; `yarn search:reindex` is the packaged entry point for `scripts/maintenance/rebuildSearchIndex.ts`. `scripts/` is neither linted nor prettier-checked in CI (see below) — verify scripts by running them.
- **`AGENTS.md` is canonical; `CLAUDE.md` is a symlink to `AGENTS.md`.** `CLAUDE.md` exists as a symbolic link pointing to `AGENTS.md` so that tools looking for either file read the exact same instructions without duplication or drift. Per-tool variants are deliberately not kept here — `.cursor/rules/agents.mdc`, `GEMINI.md` and `.github/copilot-instructions.md` each existed and were removed. Do not add another: point tools or symlinks at `AGENTS.md`.
- `proxy.ts` at the repo root is the Next.js middleware entrypoint (Next 16's rename of `middleware.ts`) — do **not** add a `middleware.ts`. It runs in the Edge runtime: import helpers via direct sub-paths (e.g. `@/lib/utils/http-headers/csp`), never barrels that transitively pull Node-only dependencies such as `@/lib/config`. It owns the ActivityPub content-negotiation rewrites and CSP header injection.
- Configuration files live at the repo root (for example `.env.example`, `knexfile.js`, and framework/tooling configs).
- `.gitignore` intentionally ignores several files agents commonly create: `docker-compose.yml`, `scripts/*.js`, `plans/`, `PR_DESCRIPTION.md`, `VERIFICATION_SUMMARY.md`, `AGENTS.override.md`, all `*.sql` (except the two `!migrations/schema*.sql` negations), `*.sqlite3`/`*.sqlite`, and `.env*` variants. If a file you added is missing from `git status`, check `git status --ignored` before assuming the add failed.

## Build, Test, and Development Commands

- **Agents:** MUST use Node.js version 24 for running any node commands in this project.
- **Always use `yarn` for all package management.** Never use `npm install`, `npm ci`, or any other `npm` commands to install or manage packages.
- `yarn dev` runs the local Next.js development server. The package script binds Next.js to `0.0.0.0`, so the dev server is reachable from the local network — only run it on trusted networks.
- `yarn build` builds the production app; `yarn start` serves it.
- `yarn lint` runs **Oxlint** over the app and lib code, then a **second** pass, `oxlint -c .oxlintrc.scripts.json scripts`. `.oxlintrc.json` ignores `scripts/**`, `migrations/**`, `plans/**`, and `*.config.*` files; the second pass exists because exactly one rule has to reach the otherwise-unlinted scripts tree (see **A stored path is confined to the storage root**), and keeping it to one rule is what avoids putting the whole rule set onto files that have never satisfied it. Several AGENTS.md conventions are **lint-enforced**: no `console.*`, no `../` imports, no `Response.json()`/`NextResponse.json()` or Zod `.parse()` in `app/api` routes (`agents/api-response-helpers`, `agents/zod-safe-parse`), no direct `fetch()` in component files (`agents/no-component-fetch`, whose `allowFiles` option in `.oxlintrc.json` is a frozen legacy-offender list — never add a file to it; shrink it by migrating callers to `lib/client.ts`), no `path.resolve`/`path.join` in a local storage driver (`agents/no-storage-path-builder`), and no `startsWith` against a resolved path anywhere (`agents/no-resolved-path-prefix-check`). Those five `agents/*` rules are a local Oxlint JS plugin, `lint/agentsRules.mjs`, because Oxlint has no `no-restricted-syntax`; `lint/agentsRules.test.ts` runs the linter against fixtures so an Oxlint upgrade that stopped loading the plugin fails `yarn test` instead of silently un-enforcing them, and also runs the repo's own configs over fixtures so a rule that stopped being pointed at anything fails too. Reach for a rule there rather than a raw-text Vitest scan whenever the convention depends on what a NAME refers to — aliases, destructuring, renamed imports — which a text scan decides wrongly in both directions. Suppress one line with `// oxlint-disable-next-line <rule>` (the `eslint-disable-next-line` spelling still works), but note Oxlint does **not** honor `/* global … */` block directives — declare globals in `.oxlintrc.json` instead, as the `public/sw.js` override does. That override carries more weight than it looks: the service worker is a static asset in **no** tsconfig and imported by nothing, so lint is the only thing that reads it at all — and `no-undef` is its only check for an undeclared global, which is what a typo there looks like. The no-env-reads-outside-`lib/config/` rule is enforced by `lib/config/envAccess.test.ts`; every `ACTIVITIES_*`/`OTEL_*` variable read in `lib/config/` must have a row in `docs/environment-variables.md` (`lib/config/envDocumentation.test.ts` fails otherwise); and server-only trees must not import a runtime value from a `'use client'` module (`lib/clientModuleBoundary.test.ts` — see **Server/Client Module Boundary**). Three more repo-wide guards live as tests: `next.config.test.ts` (the build config must not consume runtime deployment values), `app/globals.contrast.test.ts` (the WCAG contrast floor), and `lib/components/tailwindCssVariableSyntax.test.ts` (see **Tailwind CSS variables** below). The remaining conventions in this file are review-enforced.
- `yarn test` runs the full Vitest suite (all tests run in parallel with SQLite in-memory databases).
- **`yarn typecheck` type-checks the whole project; `yarn build` type-checks everything except tests.** TypeScript 7 has no compiler API, so `next build` type-checks by running the `tsc` CLI (`experimental.useTypeScriptCli`), which checks every file its tsconfig includes rather than only the app's module graph — the build therefore reads `tsconfig.build.json` (inherits `tsconfig.json`, drops `*.test.ts(x)`) and now catches type errors in `scripts/` and in unimported `lib/` modules, which the old checker missed. `*.test.ts(x)` files are covered by `yarn typecheck` (`tsconfig.typecheck.json`, the CI **Type Check** job) instead, whose `exclude` list ends in a **ratchet**: test files carrying type errors that predate the gate. Remove a file from that list in the PR that makes it type-clean; **never add one** — a new or edited test file must pass. Do not read "not in the ratchet" as "type-checked", though — three other things sit outside that program. A non-test file whose _only_ importer is a ratcheted test drops out with it (today, 4 `migrations/*.js`), which resolves itself as the list empties and which nothing in CI checked before this gate existed. The base `exclude` drops `vitest.setup.ts` and `vitest-shims/`. And **silently**, TypeScript resolves a wildcard `include` to one extension per basename, so a `foo.test.tsx` sitting beside a `foo.test.ts` is dropped from every program while Vitest still runs it — a live test file no compiler reads, which is what `lib/utils/text/cleanClassName.test.tsx` was until it was renamed. `lib/testFileTypeCoverage.test.ts` guards that last one. A bare `yarn tsc --noEmit` checks `tsconfig.json` without the ratchet, so it still reports the whole backlog and is not a signal about your change. `incremental` is `false` in every tsconfig on purpose: TypeScript 7.0's `tsc` serves stale diagnostics from `.tsbuildinfo` after a global `.d.ts` changes (the microsoft/typescript-go#4664 class of bug), and a full check takes ~2s.
- **TypeScript is on the `7.x` line — the native compiler, which ships a CLI and _no_ JavaScript compiler API** (`require('typescript')` exposes only `{ version }`; a new, different API is expected in 7.1). Nothing in the repo may depend on that API, which is why lint is **Oxlint** rather than ESLint + typescript-eslint (peer `<6.1.0`, and it throws on load under 7.x — [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)), `scripts/run.cjs` boots with **tsx** rather than `@swc-node/register` (peer `<7`), `lib/clientModuleBoundary.test.ts` parses with **`@swc/core`**, and `next build` type-checks through the **`tsc` CLI** (see the `yarn typecheck` bullet above). Two traps worth knowing before changing any of this: Next resolves the CLI from the package named `typescript` and needs its `bin.tsc`, so aliasing that package for a side-by-side TypeScript 6 install (`typescript: npm:@typescript/typescript6`) makes `next build` run `yarn add --dev typescript` itself and rewrite `package.json` mid-build; and TypeScript 7.0's `tsc` serves **stale diagnostics** from `.tsbuildinfo` after a global `.d.ts` changes (the microsoft/typescript-go#4664 class of bug), so `incremental` stays `false` everywhere. Type-aware lint rules were never enabled here; if they are ever wanted, the TypeScript 7-native route is `oxlint --type-aware` (tsgolint), not a return to typescript-eslint.
- `yarn migrate` applies Knex migrations; `yarn migrate:make <name>` creates a new migration. Migrations are ESM `.js` files with named `up`/`down` exports generated from `migration.stub` — always create them with `yarn migrate:make`; do not hand-write `.ts` or CommonJS migrations.
- **Local database is local-only.** For development and tests, use either **SQLite** on `localhost` (`ACTIVITIES_DATABASE_CLIENT=better-sqlite3` with a local `*.sqlite3` file, or the `ACTIVITIES_DATABASE` JSON equivalent) or the **PostgreSQL in the docker-compose stack at `activities.local`**. **Never run the dev server, migrations, or tests against a remote/shared/production database** (e.g. a non-local `ACTIVITIES_DATABASE_PG_HOST` such as `34.79.77.243`). Verify the resolved database target is local before migrating or starting the app. When working in a git worktree, do not copy a main-checkout `.env.local` that points at a remote DB; create a worktree-local SQLite config instead.
- **Creating test/mock users is allowed** for local verification (for example, to log in and check UI changes), but only against a local database as defined above — never against a remote/shared/production database.

## Runtime Configuration Guidelines

- Deployment and instance configuration must be read at runtime, not at build time. Treat `ACTIVITIES_*`, `OTEL_EXPORTER_*`, secrets, database settings, storage settings, host settings, and auth settings as runtime-only inputs.
- Do not read runtime deployment config in `next.config.ts`, static Next headers, `images.remotePatterns`, `allowedDevOrigins`, webpack config, `generateBuildId`, or other build-time/module-level Next configuration. Production/Docker builds must succeed when `ACTIVITIES_*` variables are missing or contain invalid placeholder values.
- `next.config.ts` may read build-only flags such as `NODE_ENV`, `BUILD_STANDALONE`, and `NEXT_TELEMETRY_DISABLED`, but it must not derive app behavior from runtime deployment config.
- Keep `next.config.ts` as a thin Next configuration entrypoint. Do not define reusable utility functions, parsing helpers, or shared constants there; move helper logic into an appropriate `lib/` module and import it.
- If runtime config affects browser-visible behavior such as CSP, security headers, host redirects, or storage upload origins, implement it in request-time server code (for example `proxy.ts`, route handlers, or server services), not as static Next config.
- Do not inject runtime app config through `nextConfig.env` or `NEXT_PUBLIC_*` variables unless the value is intentionally public, non-secret, and stable at build time.
- Do not read `ACTIVITIES_*` or `OTEL_EXPORTER_*` variables directly, and do not define environment variable name constants, outside `lib/config/`. Add or reuse a config utility and import that instead.
- When changing runtime config behavior, add a regression test that loads `next.config.ts` with missing or invalid `ACTIVITIES_*` values and verifies the build config does not consume them.

## Coding Style & Naming Conventions

- TypeScript + React with 2-space indentation.
- Prettier enforces no semicolons, single quotes, and import sorting (`.prettierrc.yml`).
- Use absolute imports (for example `@/lib/...`) for anything outside the current directory.
- Relative imports are allowed only for files in the same directory (for example `./helper`), and `../` imports are not allowed.
- Apply the same import-path rule to `vi.mock(...)` module paths.
- Oxlint (with its `typescript` and `nextjs` rule sets) runs via `yarn lint`; unused vars should be prefixed with `_`.
- Tests are co-located with code and named `*.test.ts`/`*.test.tsx`.

### Tailwind CSS variables

- **This project is on Tailwind v4. To use a bare CSS variable as an arbitrary value, use the parenthesis form — `w-(--radix-dropdown-menu-trigger-width)` — never the v3 bracket form `w-[--radix-…]`.** v3 wrapped the bracket form in `var()` for you; v4 removed that shorthand and now compiles it literally, to `width: --radix-…`, which is not a valid declaration. The browser drops it, the utility does nothing, and there is **no error and no build warning** — the element just silently falls back to its default sizing.
- This is not hypothetical: the stale class shipped in both section-nav dropdowns at once, so each menu rendered narrower than its own trigger, sized to its content, until someone looked at the rendered page. `lib/components/tailwindCssVariableSyntax.test.ts` now fails on any occurrence in `app/` or `lib/` and names the replacement.
- `[var(--x)]` is still valid in v4 and is not flagged, as are arbitrary variants (`[&_svg]`) and arbitrary values that merely contain a variable (`[calc(var(--x)-1px)]`).

## Logging Guidelines

- **NEVER** use `console.log`, `console.warn`, `console.error`, or any `console.*` methods in committed code.
- Migration files in `migrations/` and script files in `scripts/` are exceptions and may use `console.*` for CLI output.
- For server-side code (API routes, services, jobs, models, lib utilities), use the logger from `@/lib/utils/logger`:

  ```typescript
  import { logger } from '@/lib/utils/logger'

  logger.info({ message: 'Something happened' })
  logger.warn({ message: 'Warning message' })
  logger.error({ message: 'Error occurred' })
  ```

- **Do NOT** use logger in React components or client-side code—logging is for server-side only.
- **When logging a caught error, pass the error object as `err`**, not only its message. The logger's formatter reads `err.stack` and emits it as `stack_trace`, which is what Cloud Error Reporting groups and displays; `error: someError.message` alone reports nothing actionable. Anything can be thrown, so normalize with `toLoggableError` from `@/lib/utils/toLoggableError`. Keep a human-readable `error: <message>` alongside it when the same string is also persisted.
- **A failure that degrades a feature must not be logged as a `warn` and forgotten** — but record it in a signal scoped to what actually broke. If the user can see the degradation (a missing route map, an unrendered attachment), persist it wherever that feature's state lives so it is visible and retryable; a `logger.warn` with no persisted trace is how a permanent outage becomes invisible. Do **not** reach for a coarser flag that already means something bigger: `fitness_files.processingStatus: 'failed'` means "this activity is not usable" and gates the status detail dashboard, the post's stat grid, the fitness overview, the profile's Fitness tab and every stats/heatmap rollup, so a missing route map gets its own `mapError` column instead of hiding a good activity everywhere. Before reusing a status flag, grep for what reads it.

## API Response Guidelines

- Always use `apiResponse` and `apiErrorResponse` from `@/lib/utils/response` for API route responses.
- **Do NOT** use `Response.json()` directly in API routes.
- **Error responses use Mastodon's `{ error: "message" }` shape, never `{ status: ... }`.** `apiErrorResponse`, `apiCorsError`, and the shared `codeMap`/`ERROR_4xx` constants all emit `{ error }` (the HTTP reason phrase for the response `statusText` lives separately in `REASON_PHRASE`), matching the [Mastodon `Error` entity](https://docs.joinmastodon.org/entities/Error/). Mastodon-API clients read the human-readable message from the `error` field — masto.js, for one, leaves an error's `message` empty for any other shape and drops the body into `additionalProperties` — so a `{ status: ... }` error body breaks them (this is what surfaced Phanpy's Settings 404 toast). When you write an inline error body, use `data: { error: '…' }`. Only success acknowledgements (`DEFAULT_200`/`DEFAULT_202`) keep the `{ status: 'OK' }`/`{ status: 'Accepted' }` shape, because they are not errors.
- On CORS-enabled endpoints (those that export `OPTIONS`), always use `apiResponse` — even for error responses — so CORS headers are included. Reserve `apiErrorResponse` for non-CORS routes or middleware.
- Example usage:

  ```typescript
  import {
    HTTP_STATUS,
    apiErrorResponse,
    apiResponse
  } from '@/lib/utils/response'

  // Success response
  return apiResponse({ req, allowedMethods: ['GET'], data: result })

  // Error response (non-CORS route)
  return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

  // Error response (CORS-enabled route — include req and allowedMethods)
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error: 'Bad Request' },
    responseStatusCode: 400
  })
  ```

## Client-Facing Entity IDs

- **An id that leaves the server is the `publicId`, and it is produced by `getClientStatusId` / `getClientActorId` (`@/lib/utils/publicId`) — never by `urlToId(status.id)`.** Statuses and actors are addressed internally by their ActivityPub URI, but the Mastodon API and the web status path emit the row's UUIDv7 `publicId`; the two helpers wrap the "publicId, else the legacy encoding" fallback that pre-backfill rows and unstored remote actors still need. A new serializer that reaches for `urlToId` regresses that one field to the legacy shape while every sibling field emits a UUID — the kind of bug no single response looks wrong enough to reveal.
- **Emission is narrow, acceptance is permanent.** Every id form the instance ever handed out still resolves on input, and for status and actor ids there are exactly two boundaries that do it: `lib/services/mastodon/resolveClientId.ts` for the API (`resolveStatusIdParam`/`resolveActorIdParam` and their batch `…Params` forms — `publicId`, colon-encoded, `apurl_`, raw ActivityPub URI) and `app/(timeline)/[actor]/[status]/resolveStatusFromPath.ts` for the web status page (`publicId`, sha256 URL hash, percent-encoded remote URI, bare local status-id tail). A new id-accepting route goes through them instead of calling `idToUrl` itself, and the legacy branches are never pruned — cached client ids and old links depend on them indefinitely.
- **A media attachment has TWO client-visible ids, and the status edit route accepts both.** `POST /api/v2/media` answers with the numeric `medias` row id; a status's `media_attachments[].id` is the attachment row's own UUID. Mastodon has one id where this instance has two, so a client that only ever saw the status — a focal-point drag in Elk or Ivory — can only send the UUID, which `toMediaRowId` rejects outright, and `PUT /api/v1/statuses/:id` answered 422 for every third-party media edit. `resolveStatusAttachmentMediaIds` (`lib/services/statuses/mediaIds.ts`) is that third acceptance boundary, mapping the UUID through the status's own attachments before either `media_ids` or `media_attributes[][id]` reaches a media path; an id that is already a media id passes through untouched. It lives beside the other media-id helpers rather than in `resolveClientId.ts` because it resolves a different id space against one status. **The UUID branch is permanent** — it is what every already-published status hands back. Only this route can do it: `POST /api/v1/statuses` (delete-and-redraft) has no status left to resolve against, which is why redraft still needs the upload id. Note this is the one place a media id legitimately arrives non-numeric; every comparison against `medias.id` still goes through `toMediaRowId` (see **Database Compatibility Guidelines**).
- **An attachment the Mastodon serializer cannot describe is `type: "unknown"`, never `null` — a `null` took the entire status off the API.** `getMastodonAttachment` covers image and video; an `audio/mp4` upload (an accepted type) has no stored duration for Mastodon's `Audio` shape and a remote GIF no `gifv` metadata. Returning `null` was not a degraded entry, it was a fatal one: `media_attachments` is `MediaAttachment.array()`, so `getMastodonStatus`'s closing `Mastodon.Status.parse` threw, `getMastodonStatuses` caught it and dropped the status from the page as "un-hydratable", and a single-status GET errored — one audio clip made a post invisible to every Mastodon client while the web UI still showed it. `unknown` carries the id, url, description and blurhash without claiming dimensions the row does not have. The id matters too: an attachment a client cannot name is one an edit cannot preserve.
- **`lib/client.ts` never re-encodes an id — it sends back exactly what it was handed.** Because the accept side takes all three forms, encoding on the way out buys nothing for a legacy id or a raw URI and actively corrupts a `publicId`: `urlToId` parses a bare UUIDv7 as a URL host and returns it with a trailing colon, a value `isPublicId` rejects and `idToUrl` mangles, so no resolver can reach the row. (That is how the "Follow back" button on a follow notification broke the moment Account ids flipped.) Ids in a query param or a JSON body go out verbatim; the only transformation left is `toIdPathSegment` (`@/lib/utils/urlToId`) for an id going into a URL **path** segment, and it fires solely for a raw AP URI, whose slashes would otherwise split the route.
- **A pagination cursor is an entity id, so it flips with the entity.** A `max_id`/`min_id`/`since_id` value the client sends back must be the value it was shown, which is why status cursors go through `getClientStatusCursors` (`lib/services/mastodon/clientCursor.ts` — it resolves off-page boundary statuses in one batched query) and admin account cursors through `getClientActorId`.
- **Never join two serialized payloads on an id; join on the ActivityPub URI.** The URI is stable and encoding-independent, while an id's shape depends on whether that row has a `publicId`. `serializeAdminReports` keys its status map on `status.uri` for exactly this reason.
- **Resolving a batch of ids is one query, not one per id.** Use the `…Params`/`getActorPublicIds`/`getStatusPublicIds` batch forms when serializing or accepting a whole page; a `map` of point lookups fired at a pool of 10 is what these replaced.
- Background: [Architecture → Public Identifiers](docs/architecture.md#public-identifiers) and the [Public ID Backfill](docs/maintenance.md#public-id-backfill) runbook.

## Zod Validation in API Routes

- **Always use `safeParse`**, never `.parse()`, in API route handlers. `.parse()` throws an unhandled `ZodError` that propagates as a 500; `safeParse` lets you return a proper 4xx response.
- For string columns with a database size limit (e.g. `varchar(255)`), add a matching `.max(255)` constraint in the Zod schema to prevent runtime DB errors.
- When a text column is nullable, use `.transform((v) => v || null)` to convert empty/whitespace-only strings to `null`. Keep this normalization consistent between create and update paths.

  ```typescript
  const UpdateNameRequest = z.object({
    name: z
      .string()
      .trim()
      .max(255)
      .transform((v) => v || null)
  })

  const parsed = UpdateNameRequest.safeParse(json)
  if (!parsed.success) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'Invalid input' },
      responseStatusCode: 422
    })
  }
  ```

## ActivityPub & JSON-LD

ActivityPub objects are **JSON-LD**, so the same logical object can arrive in many shapes (`type` as a string, array, CURIE, or full IRI; recipients as a single value or an array; id references inline or as nested objects; varied `@context` orderings and extension vocabularies). Do **not** lock the wire format to a single shape with strict schemas — be liberal in what you accept and canonical in what you emit.

- **Canonicalise every inbound ActivityPub document with `compactActivityPub` from `@/lib/activities/jsonld` before validating or processing it.** It runs the real `jsonld` processor, compacting against one canonical context so downstream code (and the Zod schemas) can rely on a predictable shape: bare `type` terms, id references as strings, and `to`/`cc`/`tag`/`attachment` always arrays. **Any new entry point that parses an untrusted remote AP note/activity/actor MUST compact first.** Already wired: the shared inbox (`app/api/inbox/route.ts`), the per-user inbox (`app/api/users/[username]/inbox/route.ts`), `getActorPerson`, `getActorPosts`, and `getNote` (so `getRemoteStatus` and boosted-note resolution inherit it). `compactActivityPub` is generic (`<T>(input: T) => Promise<T>`), preserves the document's logical shape, and falls back to the raw input on any processing error.
- **The processor must never dereference remote `@context` URLs at runtime** (SSRF/DoS vector). Contexts are bundled as committed offline assets under `lib/activities/jsonld/contexts/` and served by `offlineDocumentLoader`; unknown context URLs resolve to an empty context (their terms simply drop). Add new contexts as bundled assets, never as network fetches. `jsonld` (via `rdf-canonize`) is a heavy, Node-only dependency that breaks under jsdom, so it is imported **lazily** inside `compactActivityPub` — keep it that way so it never enters component/jsdom test module graphs.
- **Extension `type`s that are not defined in the bundled ActivityStreams context must be aliased in `CANONICAL_CONTEXT`**, otherwise compaction emits a CURIE (e.g. `toot:Emoji`, `as:Hashtag`, `schema:PropertyValue`) that the strict `type` validators then drop. `Emoji`, `Hashtag`, `PropertyValue`, `QuoteRequest`, `QuoteAuthorization`, and `EmojiReact` are the currently-aliased ones (all other matched AS2 types are already in the bundled context). If you start matching on a new non-AS2 `type`, add its alias **and a regression test** asserting it survives compaction as a bare term.
- **A term this instance WRITES onto a Note must be declared in the context it sends, not only aliased inbound.** `CANONICAL_CONTEXT` governs what we accept; `NOTE_ACTIVITY_CONTEXT` (`lib/activities/noteContext.ts`) is what we emit. This is the outbound mirror of the aliasing rule above and it fails the same silent way: JSON-LD is context-driven, so a term the document never defines expands to a blank node and `stripJsonLdArtifacts` deletes it. The note keeps its content and quietly loses the rest — no error, no build warning, and no test failure, because every result-based assertion still passes. Mastodon reads the JSON without processing it, which is why this survived so long; a conformant receiver — GoToSocial, or another activities.next, whose inbox runs `compactActivityPub` — silently lost the terms. **Seven surfaces carry a Note and all seven send `NOTE_ACTIVITY_CONTEXT`:** `sendNote`'s Create, `sendUpdateNote`'s Update, `sendQuoteRequest`'s `instrument`, the AP status GET, the `/replies` collection, the user outbox page, and the `outbox.json` writer in `scripts/backup/actorArchive.ts`. It supersets `QUOTE_ACTIVITY_CONTEXT`, so a surface on it also satisfies the quote vocabulary's own requirement; the other quote activities (Accept/Reject/Delete) echo ids rather than Notes and keep the narrower one. The archive's likes/bookmarks collections share the outbox writer but hold bare ids, so the extra definitions are inert there. **Both emitters build these fields through `lib/activities/quoteNoteFields.ts` and emit `interactionPolicy` and the quote aliases unconditionally** — `getNoteFromStatus` for delivery, `toActivityPubObject` for fetch — so the rule binds every note-carrying surface, quote post or not. The same module's `addQuoteFallbackToContent` prepends Mastodon's legacy quote fallback — `<p class="quote-inline">RE: <a href="…">…</a></p>` — to both emitters' `content` on a live (pending/accepted) edge, skipped when the content already carries the quoted url; it is plain HTML rather than a JSON-LD term, so no context entry is involved, and `post.tsx` hides the `quote-inline` marker whenever it renders a quote card (see **Link Preview Cards** for the sanitizer/extractor half). `interactionPolicy` arrives through a spread (`getInteractionPolicyFields`), so grepping for the literal key finds nothing: check the spreads. The only asymmetry left is `votersCount`, which `toActivityPubObject` emits on a poll Question while `getNoteFromStatus` returns null for Polls entirely. Both also carry an attachment's `blurhash`/`focalPoint` and the `Hashtag`/`Emoji` tag TYPES, none of which the bundled ActivityStreams context defines. `focalPoint` needs `"@container": "@list"` or a processor is free to reorder the `[x, y]` pair. One caveat on the outbox page: its context sits on the `OrderedCollectionPage`, so embedded Notes inherit it only from a receiver that processes the page as one document — and OUR reader does not, `getActorPosts` compacting each `orderedItems` entry on its own. That is a pre-existing limitation of the reader, not of the emitted page. Each surface is pinned by a `@context` assertion (`lib/activities/index.test.ts`, `sendUpdateNoteJob.test.ts`, the three route tests, and `scripts/backup/actorArchive.test.ts`) because a revert is invisible in results; `lib/activities/quoteNoteFields.test.ts` and `lib/activities/jsonld/index.test.ts` prove the round trip. The tag TYPES are the exception a round trip cannot cover — `stripJsonLdArtifacts` recovers a blank-node `type`, so our own reader keeps them either way; they are pinned by asserting the context declares each under the IRI we accept it as.
- **An alias in `CANONICAL_CONTEXT` only helps when the _sender_ defines the term too.** `CANONICAL_CONTEXT` is the context compaction targets; expansion still uses the document's own `@context`, and the bundled ActivityStreams context sets `"@vocab": "_:"`, so a term the sender never defines expands to a blank node — which `stripJsonLdArtifacts` recovers for `type` values but **deletes** for property keys. For terms peers commonly emit undefined (Misskey's `_misskey_reaction`) or declare in a vocabulary the offline loader cannot resolve (litepub's `EmojiReact`), also add them to `EXTENSION_TERM_FALLBACK_CONTEXT`, which `normalizeInputContext` prepends to every inbound document as the lowest-precedence entry — so a sender that does define the term still wins. This is the same trick that keeps litepub actors' `publicKey` readable via the `security/v1` fallback.
- **Keep the Zod schemas liberal, not strict.** Model only the fields you consume; never `.strict()`; tolerate unknown tag/attachment kinds via the `z.looseObject({})` fallback in the `Tag`/`Attachment` unions (`z.looseObject` is valid Zod v4 — see `lib/types/activitypub/actor.ts`); never Zod-validate `@context`. Narrow loose values back to fully-valid known shapes at the consumption boundary with `safeParse` (e.g. `getTags`/`getAttachments` return only valid `KnownTag`/`Document` via `KnownTag.safeParse`/`Document.safeParse`).
- **Do not change `http://schema.org#` to `https`.** Mastodon maps the `schema` prefix to the non-standard `http://schema.org#` base in actor `@context`; the canonical context must use the same IRI so profile fields (`PropertyValue`/`value`) compact correctly.
- Compaction emits the public collection as the compact alias `as:Public`; `toRecipientArray` canonicalises it back to the full ActivityStreams Public IRI when coercing recipients for persistence so stored recipients have one canonical form. JSON-LD blank-node ids (`_:b0`) are document-local artifacts and are rejected by `extractActivityPubId`/`normalizeActivityPubUri` — they are never valid resolvable ActivityPub ids.
- **Forwarded ActivityPub deliveries (ActivityPub §7.1.2 inbox forwarding) pass the signature guard with `forwarded: true` instead of 403 `sender_actor_mismatch`.** Because the payload is signed by the forwarding server rather than the document's author, it cannot be trusted directly. Forwarded `Create`, `Update`, and `Delete` activities route to `ProcessForwardedActivityJob` (`names.ts:PROCESS_FORWARDED_ACTIVITY_JOB_NAME`) to verify and re-fetch the object from the author's origin server before executing side effects; all other forwarded activity types (`Follow`, `Accept`, `Reject`, `Like`, `Undo`) lack an origin verification path and are acknowledged with `202 Accepted` and dropped without side effects.

## A Fetched Document's Own `id` Is Not Evidence

`getNote` and `getActorPerson` fetch a URL and return whatever the body says; neither checks that the document's `id` is the id that was asked for. So a fetched `id` is a **claim by whoever answered the request**, exactly as much as its `content` is — and the moment that claim resolves a database row, a remote server is choosing which of our rows a write lands on. Three sites got that wrong at once, and the sink was the same in each: `updatePoll` and `createAnnounce` resolve by a bare `where('id', ?)` with no ownership, locality or type filter.

**There are two different questions here and they take two different guards. Do not unify them.**

- **"Did I get back the document I asked for?" — exact id, normalized.** `lib/services/polls/syncRemotePoll.ts` fetches `status.id`, which is the origin's OWN canonical id, stored from its own earlier document. There is no third party and no aliasing: ask an origin for its canonical id and it answers with that id. A different id means it is describing a different object, so the sync is refused through the existing `failedPollSyncsAt` cooldown. `normalizeActivityPubUri` on both sides absorbs the serialization noise the URL parser itself removes: scheme/host case, an explicit default port, dot segments, IDNA host mapping, a backslash in the path, an empty path gaining its `/`, and characters the parser must percent-ENCODE (a non-ASCII username in a path). Do not read that as a closed list — state the rule, not the inventory, and check the parser before relying on a specific fold. Two it does **not** do: it never percent-DECODEs (`%7E` and `~` still differ), and it does not fold a trailing slash on a non-empty path (only the bare-origin case gains one). The write additionally uses `statusId: status.id`, never `question.id` — that is what actually closes the vulnerability, so the guard's tightness is defence in depth and refusing too much only costs stale tallies plus a warn.
- **"Is this document allowed to name that id?" — same ORIGIN, via `isSameActivityPubOrigin`.** `lib/jobs/createAnnounceJob.ts` compares the fetched note's `id` against the Announce's own `object`, and `object` was chosen by a **third party** — the announcer — who may legitimately name a same-origin alias. **An exact match here is a real interop regression, not merely a stricter rule:** a server may canonicalise a URL within its own origin, and this instance's own `proxy.ts` does exactly that, answering `/@user/<id>` under an ActivityPub `Accept` header with a document whose `id` is `/users/<user>/statuses/<n>`. Mastodon behaves the same way, and `safeRemoteFetch` follows redirects. Cross-origin is the entire attack, because a server can already serve whatever it likes at any id it owns.
- **`isSameActivityPubOrigin` (`lib/utils/activitypub.ts`) fails CLOSED and is the shared spelling of a check five modules still carry inline** as `sameHost`/`sameAuthority` (`processForwardedActivityJob`, `verifyRemoteQuote`, `persistInboundQuoteEdge`, `handleQuoteRequest`, `handleQuoteResponse`); those copies should collapse onto it in the dedup pass. Failing closed matters more than it looks: a blank node, an empty string, an unparseable id **and a host-less URI** all match nothing, including themselves, so no pair of degenerate ids can ever compare equal the way two `normalizeActivityPubUri(null)` results would. The host-less case is the one a bare `.host` comparison gets wrong rather than throwing on — `urn:`, `did:`, `tag:` and `mailto:` ids all parse and report `host === ''` — so the helper is deliberately **stricter than the five inline copies on that input and no other**, which is what makes migrating them onto it safe rather than merely tidy.
- **In `createAnnounceJob` the guard sits BEFORE the `createNoteJob`/`createPollJob` dispatch, not merely before the fallback lookup.** Placed after it, a document claiming an id we were never pointed at is still _persisted_ — a status planted on another server's id space, attributed to whatever `attributedTo` claims. Pinned by `stores nothing when the fetched object claims an unstored id on another host`, which is the only test that moves when the guard is relocated.
- **The second `getStatus` arm in `createAnnounceJob` stays.** `getStatus` does not normalize and the child jobs persist under the FETCHED spelling, so when the Announce named an alias the `object` lookup misses a row that was just written; that arm is what PR #1694 added and the origin guard is what keeps it from reaching another host.
- **Where the id resolves a row someone else owns, an id match is not enough — check ownership.** `updatePollJob` had no author check at all, the poll twin of the one `updateNoteJob` carries and documents. The inbox only proves `attributedTo` matches the _signer_ (`getJobMessage`'s `createObjectActorMismatch`), which an attacker satisfies by attributing the Update to themselves while pointing `id` at someone else's poll — so any federated actor could rewrite any stored poll's text, spoiler and tallies, `status_history` revision included, and the defacement read as a genuine edit by the victim. Both jobs compare `normalizeActorId(attributedTo)` against the stored status's `actorId`.
- **Every guard here is bracketed by tests on BOTH sides** — one that fails when it is loosened and one when it is tightened. That is not belt-and-braces, it is the only way to record that a guard has a correct _width_: `accepts an announce naming a same-origin permalink for the boosted status` is what fails if someone "hardens" the origin check into an id check, and it is the regression that shipped in an earlier draft of this very change.
- **This guard does not make an Announce's target safe, and the distinction is easy to misread.** A boost of an ALREADY-STORED status never reaches the guard at all — `getStatus({ statusId: object })` resolves it and skips the whole branch — and `createAnnounce` checks only that the original _exists_, with no audience check, while `mainTimelineRule` gates the Announce on the viewer accept-following the **announcer** and applies no audience check to the boosted status either. So a remote actor can still boost a local followers-only or direct status by naming its id directly and surface it to any local account that follows them. Reproduced end to end during review of this change. `createRelayAnnounceJob` gates exactly this with `isPublicStatus` (`:133`); `createAnnounceJob` has no equivalent. It is **pre-existing and open**, not something the origin guard was ever positioned to close — do not read the guard's presence as coverage.
- **Two related holes are deliberately still open and are NOT covered by the above.** `createAnnounceJob` does not bind the fetched note's `attributedTo` to anything, and `actorMatchesVerifiedSender` fails open on a direct (non-queue) call because such a message carries no `verifiedSenderActorId` — so an announcer can still store a status at an id on its own origin attributed to another actor. That is forged _attribution_, a different class from id substitution, and it needs its own decision about the correct binding. `recordActorIfNeeded` likewise takes a row's `id` from the requested actor id while taking its `domain` from the fetched `person.id`, unchecked. `createRelayAnnounceJob` and `processForwardedActivityJob` also key downstream writes on a fetched `note.id`. Each carries a control, but over a **different question** — a public/local-echo gate in front of the federated-timeline write, and an attribution match on `attributedTo` — and **neither constrains `note.id`**, so both can still persist a note at an id on a third-party host. Do not read either as the origin guard's equivalent; `createNoteJob`'s already-stored early return is all that bounds them, to ids nothing occupies yet.

## Actor Usernames Are Case-Insensitive

A local actor's username is not a label on its identity, it **is** its identity: `getLocalActorId` builds `https://<domain>/users/<username>` and every ActivityPub id downstream is derived from that string (`getLocalStatusId` is literally `${actorId}/statuses/${n}`). So casing is a correctness question on two separate axes, and both are handled.

- **Every local username this instance MINTS is lowercased** — trim then lowercase, deliberately as minimal as `normalizeEmail`. It is layered the same way email normalization is: `localUsernameSchema` (both creation routes), `registerAccount` (so a direct service call cannot bypass the schema), and `createAccount`/`createActorForAccount`. The last two normalize into a local variable that feeds BOTH the `username` column and `getLocalActorId`, so the column and the id are derived from one value and cannot drift. **There are TWO spellings of the rule, not one**: `normalizeUsername` (`lib/utils/normalizeUsername.ts`) and the schema's own Zod `.trim().toLowerCase()` chain — exactly the relationship the email schemas have with `normalizeEmail`. Nothing makes them agree by construction, so `localUsername.test.ts` asserts `localUsernameSchema.parse(x) === normalizeUsername(x)` over a table; teach one to strip a trailing dot and that test is what catches the other not following. And `createAccount`/`createActorForAccount` are the two ACCOUNT-facing mint paths, **not** the only places a local actor row is written: `getFederationSigningActor` (`lib/database/sql/actor.ts`) inserts its own row with a non-empty `privateKey`, touching neither method. It is safe because it derives its `username` and its `getFederationSigningActorId` from one variable too — the same argument, made separately.
- **Folding in `localUsernameSchema` runs BEFORE the reserved-name refine, and that ordering is load-bearing.** `isFederationSigningActorUsername` is a case-sensitive `startsWith('__instance__')`, so `__INSTANCE__` passed the check and minted a confusable neighbour of the instance actor at a _different_ id. Sitting before `.max()` is defensive only, NOT load-bearing: the one lengthening mapping is `İ` -> `i` + U+0307, and U+0307 is not in `LOCAL_USERNAME_PATTERN`, so the regex refuses such input wherever `.max()` sits. `LOCAL_USERNAME_PATTERN` still names `A-Z` on purpose: it describes what a caller may SEND, and by the time it runs there is none left.
- **Username lookups fold through `findActorRowByUsername`** (`lib/database/sql/utils/usernameMatch.ts`), which backs `getActorFromUsername`, `getMastodonActorFromUsername` and `isUsernameExists` — covering `/@user`, the whole ActivityPub surface behind `OnlyLocalUserGuard`, WebFinger, mentions (which go through WebFinger), `/api/v1/accounts/lookup`, `authorize_interaction`, the actor archive, and the `resolve=true` branch of both search routes. **It is not yet universal, so do not read the rule as one:** `getExactAccountIds` (`lib/database/sql/search/account.ts`) resolves an exact handle with a lone `LOWER(username) = ?` **and** a `LOWER(domain) = ?` — no exact arm, no precedence ordering — and it runs on EVERY `searchAccountIds` call, not only the resolve branch. So search and lookup disagree on `alice@Example.COM`, and the SQLite ASCII-fold gap below is live in that one path. Pre-existing; unifying it is its own change. `isUsernameExists` folding is what stops a second `Alice` from being minted beside an existing `alice`.
- **It is exact-match-first, then folded — NOT a single `lower(username) = ?`, for two independent reasons.** (1) SQL `lower()` and JS `toLowerCase()` are not the same function: SQLite's builtin folds ASCII only, so a remote actor named `Фёдор` has its stored value fold to `Фёдор` while the JS side folds the identical input to `фёдор`, and a fold-only query stops finding a row that resolves today. Trying exact first means no lookup that works now can break, on any backend, for any charset. (2) Local actors minted before normalization keep their casing — their ids are already federated, so they are deliberately NOT migrated — which means an instance can hold both `Alice` and `alice`, and `/@Alice` must not start resolving to `alice`. "Exact wins" says that without a tiebreak clause. The folded arm orders by `createdAt` then `id` so an unmatched casing resolves to whoever claimed the name first, rather than to whatever the index yields. It folds with a bare `toLowerCase()`, **not** `normalizeUsername` — that also trims, and a trim here is not a fold at all: it compares a TRIMMED input against an UNTRIMMED `lower(username)`, so `' alice '` found `alice` while `alice` could never find a stored `'alice '`. An asymmetric match can only ever ADD rows, which is how `/users/%20alice%20` came to serve alice's whole ActivityPub surface. (Shared-cache keys are NOT the reason — case folding creates URL variants regardless.)
- **`20260826120000_add_actors_lower_username_index.js` adds the functional index the folded arm reads** — `(lower(username), domain)`, raw SQL because knex's schema builder has no functional-index form, identical on both backends. Without it the folded arm sequentially scans `actors` on exactly the requests least able to afford it: an unknown handle (404 traffic), the first lookup of a remote actor, account search — on a table that grows with every remote account this instance has ever seen. Verified an index scan with both columns as index conditions on PostgreSQL 17 (50k rows) and SQLite. It is **not unique**: an instance may already hold a case-colliding pair, and a unique index would refuse to build there; collision is refused at the application layer by `isUsernameExists`. **MySQL is skipped rather than translated, and `findActorRowByUsername` skips the folded arm there to match.** Its default collations (`utf8mb4_0900_ai_ci` and friends) are already case-insensitive, so the exact arm folds on its own — and so does `actors_username_domain_unique`, meaning a case-colliding pair cannot exist on MySQL at all. A second query would find nothing the first did not and would find it by scanning `actors`, since the statement is the least portable of the three (`((lower(username)), domain)`, no `IF NOT EXISTS` on `CREATE INDEX`, backtick quoting, functional indexes only from 8.0.13, and never in MariaDB, which the `mysql2` client also reaches). An operator who puts a `_bin`/`_cs` collation on `actors` gets case-sensitive usernames on MySQL — the behaviour that backend had before this change, not a new regression. `actorsLowerUsernameIndexMigration.test.ts` reads the index definition out of `sqlite_master` because a revert is invisible in results — every functional test passes against a table with no index at all, and `PRAGMA index_info` reports a null column name for an expression.
- **A reserved username is reserved case-INSENSITIVELY, and `OnlyLocalUserGuard` enforces that at the URI.** Resolving by username is what made this necessary: `__INSTANCE__` was registerable before the refine folded casing, and the folded arm answers a request for `__instance__` with that account's actor — a user-owned Person document, inbox, outbox and followers served at `getFederationSigningActorId(domain)` itself, past the `actor.account` check and without `allowFederationSigningActor`, until `getFederationSigningActor()` first runs on that domain. The guard therefore 404s a request whose segment folds to a username this instance could itself MINT a signer on — `isFederationSigningActorIdUsername`, `/^__instance__([1-9]\d*)?$/` — unless the resolved actor IS the genuine signing actor, gated on the REQUESTED segment rather than the resolved row. **That is deliberately narrower than the `isFederationSigningActorUsername` prefix the mint refine reserves, and the two must not be unified.** The prefix form de-federates a legacy `__instance__archive` or `__instance__0` account — 404ing an actor document and inbox that work on `main` — while the precise form is not "every id that can ever be a signer" either: `getExistingHeadlessActor` ADOPTS any headless `__instance__%` Service row and validates it with the loose form, so an instance can legitimately sign as `__instance__archive`. Narrowing `isValidFederationSigningSQLActor`/`isFederationSigningActor` onto the precise form would silently end federation signing there. The guard survives the split because an adopted signer's name falls outside the precise predicate, so the reserved-name test never fires for it. Serving the genuine signer needs BOTH of the guard's checks — `isAllowedActor`'s `allowFederationSigningActor` disjunct (an accountless signer reaches the handler only through it, on the 9 of 14 invocations that opt in) and the `!isFederationSigningActor(actor)` conjunct (which covers a signer whose name the minter CAN emit). Neither is redundant with the other.
- **`OnlyLocalUserGuard` resolves by username, not by rebuilding the actor id from the path segment.** It fronts the entire ActivityPub surface — actor document, inbox, outbox, followers, following, statuses, collections — and the rebuilt id could only ever match one spelling, so it answered `/api/users/Alice` and 404'd `/api/users/alice` while every human-facing surface folded. The host binding is unchanged: matching `domain` against `headerHost` is the same constraint as requiring the id to have been minted on this host, because both are written from one value at mint time.
- **`domain` matching inside the lookup stays case-sensitive**, which is what it already was — folding it is a separate change with its own index implications. Do NOT justify that by saying callers normalize it first: `parseAccountHandle` does, but `app/api/v1/accounts/lookup/route.ts` has its own locally-shadowed `parseAccountHandle` that does not, and `resolveStatusFromPath.ts` splits the segment inline with no normalization at all. `getWebFingerResponse` carries its own exact-then-lowercased domain fallback precisely because that is not a guarantee.
- **Remote usernames are stored verbatim.** A remote server mints its own ids and chooses its own casing; we fold when _matching_ them, never when persisting. WebFinger answers with the STORED casing too (`subject` and the profile-page alias are built from `actor.username`), so a client that echoes the subject back gets the canonical handle rather than the casing it asked with.

## Server/Client Module Boundary

- **Server-only code must never import a runtime value from a `'use client'` module.** Under the App Router such a module resolves to a _client reference_ on the server: components still render, but a plain value read out of it (a constant object, a lookup table) is empty. Types are erased, so `import type` is fine, and a Server Component rendering a Client Component is the normal composition pattern — this is specifically about reading values.
- The failure is invisible to the test suite: Vitest has no RSC boundary, so the import returns the real module there and tests pass while production silently gets nothing. It cost a complete outage of poll creation — `app/api/v1/accounts/outbox/types.ts` validated `durationInSeconds` against `SecondsToDurationText` exported from the `'use client'` poll editor, `Object.keys(...)` came back empty, and every poll was rejected with a 400 that no test could see.
- `lib/clientModuleBoundary.test.ts` enforces this across `app/api/`, `lib/services/`, `lib/actions/`, `lib/jobs/`, `lib/database/`, and `lib/config/`. When both sides need a constant, put it in a dependency-free module both can import — `lib/services/statuses/pollDurations.ts` and `lib/services/mastodon/constants.ts` are the existing examples — not in the component that happens to render it.

## Instance Limits in Client Components

- **Client authoring UI must size itself to the admin-configured server settings, never to a hardcoded constant.** Read them from `useInstanceLimits()` (`@/lib/components/instance-limits`), which the `(timeline)` layout publishes once from `getResolvedServerSettings()`. Current consumers: the composer's character counter and the inline reply box (`posts.maxCharacters`), the poll editor (`polls.*`), the composer's media picker and the avatar/header picker (`media.maxFileSize`), and the media picker's attachment count — both the composer and the inline reply box — plus the `addAttachment` reducer guard behind it (`posts.maxMediaAttachments`).
- Add a field to `InstanceLimits` and publish it from the layout rather than threading a prop: the composer renders inline under posts across the whole route group, so prop-threading touches ~30 files. Keep the context to values the browser genuinely needs; it is not a mirror of `ResolvedServerSettings`.
- **Do not import `lib/config/serverSettings` into a Client Component** for its value exports — it carries `process.env`-reading closures. Defaults belong in a dependency-free module (see **Server/Client Module Boundary**).
- The context is UX only. Every limit is enforced server-side too (`validateStatusContentLimits` on the status create/edit routes, `exceedsMaxMediaUploadSize` on every upload path); a client that is out of date can only be optimistic, never permissive. `posts.maxMediaAttachments` is the exception: **no** route enforces the resolved value. All three create/edit paths — `POST`/`PUT /api/v1/statuses[/:id]` and `POST /api/v1/accounts/outbox`, the route both the composer and the inline reply box actually post through — fall back to the fixed `MAX_STORED_MEDIA_ATTACHMENTS` ceiling instead, answering `422` above it, so on that field a stale or missing provider lets media through up to the ceiling rather than up to the configured number. See **Database-backed server settings** in `docs/environment-variables.md` for the full explanation. When a new surface can author or upload, put it under the provider and read the limit from it.

## Date Serialization in Server Components

- **Never pass `new Date()` as a prop from a Server Component to a Client Component.** `Date` objects are not safely serializable across the server/client boundary and can cause hydration mismatches.
- Always pass timestamps as `number` (e.g. `Date.now()`) from Server Components.
- Client Components should accept `currentTime: number` and construct `new Date(currentTime)` internally before use.
- This pattern is already used throughout the codebase (e.g. `HashtagTimeline` accepts `currentTime: number` and forwards the number unchanged to `<Posts>`, which also takes `currentTime: number`; only leaf components construct `Date` objects from it).

## Client-Side API Calls

- **Never call `fetch()` directly inside React components.** All API calls from client components must go through `lib/client.ts`.
- Add a named, exported function to `lib/client.ts` for every new API endpoint the UI needs to call. The function should encapsulate the `fetch` call, method, headers, body serialization, and return a typed result.
- Import those functions in components: `import { myApiCall } from '@/lib/client'`.
- This keeps all network logic in one place, makes it easy to find every client→server call, and lets components stay focused on UI state.

## Outbound Server-Side HTTP Requests

- **All server-side outbound HTTP requests MUST go through `safeRemoteFetch` (`@/lib/utils/safeRemoteFetch`).**
- Never call raw `fetch()` directly in server-side services or utilities.
- `safeRemoteFetch` is backed by `got` and applies standard SSRF protection (requiring HTTPS, blocking private IP ranges such as loopback and RFC 1918 subnets), streaming response-size limits, timeout bounds, DNS pinning, and redirect handling.
- External cloud integrations (e.g. translation providers like DeepL, OpenAI, or Gemini, and alt-text vision generation) must target public HTTPS endpoints. Internal or self-hosted HTTP services running on private IP addresses are not supported.

## Link prefetching in feeds

- **A `<Link>` rendered once per row of a feed or list MUST pass `prefetch={false}`.** Next's App Router `<Link>` defaults to prefetching every link that enters the viewport, and this app's feeds are infinite-scroll, so a repeated link is not one request — it is one request per row, fired continuously as the user scrolls. This is the bug that flooded production: `Posts` renders two author links per post (the avatar and the display name), so scrolling the home timeline issued a stream of `GET /@user@domain?_rsc=…` prefetches.
- The cost is not just a page render. Every one of those targets is a fully dynamic route — `/@user@domain` runs a session lookup plus six actor queries — and for a remote actor this instance has not persisted yet, `getProfileData` additionally performs a **WebFinger lookup and a signed actor fetch against the remote server**. Viewport prefetching therefore turns idle scrolling into outbound federation traffic aimed at other people's instances.
- There is no global switch: Next 16's `prefetch` prop (`boolean | 'auto' | null`) is per-`Link` and has no `next.config.ts` counterpart, so the opt-out is written at each call site. `prefetch={false}` disables prefetching on **both** viewport entry and hover — accept the hover loss; a profile open is a deliberate navigation and does not need to be instant.
- Current opt-outs: the shared post author links (`lib/components/posts/actor.tsx`), the booster link on the boosted-by line (`BoostStatus` in `lib/components/posts/post.tsx`), notification rows (`NotificationItem`, `StatusNotification`, `ActivityImportNotification`), follower/following rows (`FollowList`), search account and hashtag rows, the likes list and chips (`StatusLikes`), collection member rows, and trending hashtag rows. Regression-tested in `lib/components/posts/actor.test.tsx` and `lib/components/posts/boost-status.test.tsx`, which mock `next/link` because the real one does not reflect `prefetch` into the DOM.
- Navigation **chrome** keeps prefetching and should: the sidebar, mobile nav, section sub-nav, pagination, and one-off page links render a bounded handful of links, so prefetch is a straight latency win there. The rule is about links whose count scales with the number of rows on screen. **The one exception inside chrome** is the mobile bar's synthesized Profile entry (`lib/components/layout/mobile-nav.tsx`): unlike every other mobile-nav item, which is a fixed registry route, Profile's href is the viewer's own per-user `/@user@domain` — the same fully-dynamic `[actor]` route the post-author links above opt out of (a per-user session lookup plus six actor queries on every render; for a REMOTE actor, which the self-profile is not, that same route also drives a WebFinger lookup and a signed actor fetch) — so it alone carries `prefetch={false}` while the registry items and the overflow (More) menu links around it keep default prefetching. Regression-tested in `lib/components/layout/mobile-nav.test.tsx`, which mocks `next/link` the same way.

## Navigation Customization

- **The nav item registry is the single source of truth, and adding an item is two lines.** Its id goes in `NAV_ITEM_IDS` (`lib/services/navigation/navPreferences.ts`) and its presentation — icon, label, `shortLabel`, `blurb` — goes in `NAV_ITEM_DEFINITIONS` (`lib/components/layout/nav-items.ts`). Every surface derives from those: the full sidebar, the collapsed rail, the mobile bar and its More sheet, and the Settings → Navigation manager. Never hardcode a nav list in a component (the mobile bar used to keep its own `mobileDirectHrefs` allowlist, which is exactly the drift this replaced).
- **`lib/services/navigation/navPreferences.ts` must stay dependency-free** — no React, no lucide, no env. Both sides import it: the `'use client'` surfaces render from it, and `app/api/v1/accounts/navigation-preferences/route.ts` validates writes against it. It owns which ids are pinned (`LOCKED_NAV_IDS`), which belong to an optional instance feature (`NAV_FEATURE_BY_ID`), and the order/split/move algebra. See **Server/Client Module Boundary**.
- **Every nav surface reads `useNavPreferences()`; none of them keeps its own copy.** `NavPreferencesProvider` is rendered once by the `(timeline)` layout, seeded from `getActorSettings`, and wraps the nav chrome **and** `{children}` — the settings manager edits the very sidebar rendered beside it on wide viewports, and a soft navigation never re-runs the layout to re-seed two separate stores.
- **Saves carry the whole preference, not a delta**, so concurrent edits resolve to last-write-wins; the store keeps one request in flight with a single trailing save, and a drag persists once on drop rather than once per row it crosses. Dedupe is keyed on the **payload** (what goes over the wire), not on what the navigation looks like: Reset deliberately stores empty lists — that is what keeps the account following the shipped navigation as it changes — and keying on the visible state made Reset a no-op whenever the visible order already matched the defaults.
- **Two reorder semantics, and the difference is deliberate.** The sidebar's `⋯` menu swaps with the nearest _visible_ neighbour (`moveNavItem`), because hidden items are not on screen there to move past. The settings manager lists hidden rows inline, so all three of its reorder paths — dragging a row, the grip's arrow keys, and the per-row Move up/down buttons — splice within the displayed list (`moveNavItemTo`). The keyboard and the buttons share `moveRow`, which is also what reports the move (and the ends of the list) to a screen reader; a drag calls `moveTo` per row crossed and `commit` on drop, because it is the pointer that reports it. Whatever a surface offers via drag it must also offer via the keyboard, and the buttons are what make it work on a touch device, where a pointer that cannot hover cannot drag and there is no keyboard either.
- **A hidden item is tucked away, never taken away**: it stays reachable under More on every surface, `LOCKED_NAV_IDS` can never be hidden (the server strips them from `navHidden` as well, so a hand-edited preference cannot strand someone), and an item that is unavailable — admin for a non-admin, or a feature the instance turned off — keeps its slot in the stored order so re-enabling restores the account's layout.
- **Instance feature switches (`features.*` server settings) only remove items from navigation.** They do not gate routes, APIs, or the composer: an existing link keeps working. If that ever changes, it is a separate, deliberate decision — do not add a `notFound()` guard as a side effect of a nav change.

## Page Header & Sub-Navigation

The **design system is the source of truth** for page chrome. There are two
section-navigation patterns; pick by section type.

- Use `PageHeader` from `@/lib/components/page-header` for every page title in the `(timeline)` route group. By default it renders the sticky, full-width chrome (translucent background + backdrop blur + bottom border) and centers the title above the content column. Pages always call `<PageHeader title="…" description="…" actions={…} />`; they don't need to know which sub-nav pattern (if any) wraps them.
- **Unified desktop content width.** Every top-level page in the `(timeline)` group shares **one** content width on desktop so the column stays aligned as you switch tabs. The `(timeline)` layout wrapper centers content at `max-w-content` (a single `--container-content: 940px` token defined in `app/globals.css`'s `@theme`), and `PageHeader` centers its title row at the same `max-w-content`. There is **no** per-page width tier any more: do **not** reintroduce the old two-tier `max-w-2xl` (timeline) / `max-w-4xl` (sections) split, a `contentWidth` prop on `PageHeader`, or the `data-layout-width="wide"` opt-in CSS rule. Section layouts (settings, fitness, admin) and Messages all inherit the unified `max-w-content` from the wrapper — they don't set their own width.

### Dropdown sub-nav (settings-style sections — the design-system default)

- Settings-style sections (settings, fitness, admin) use a **dropdown sub-navigation on every breakpoint, including desktop** — there is **no vertical nav rail**. The earlier desktop "vertical icon rail" is gone: do **not** reintroduce a `lg:block` rail beside the content. The same dropdown that tablet/mobile used now drives desktop too, so the content always gets the full width.
- **Reuse the shared `SectionNavDropdown` component** from `@/lib/components/section-nav-dropdown` — do **not** re-inline the dropdown markup in each layout. Pass it a `label` (the `<nav>` accessible name) and a `tabs: SectionNavTab[]` array (`{ name, url, icon }`). It owns the active-tab resolution and renders the trigger + menu described below; `app/(timeline)/settings/layout.tsx`, `app/(timeline)/fitness/layout.tsx`, and `app/(timeline)/admin/layout.tsx` all consume it.
- Under the hood, `SectionNavDropdown` renders a single `<nav aria-label="…">` wrapping a Radix `DropdownMenu`. The trigger is an outline `Button` showing the active tab's Lucide icon (`text-primary`) + **sentence-case** label ("Blocked accounts", not "Blocked Accounts") + a `ChevronDown`; it is `w-full` on mobile and a contained `sm:w-64` from `sm` up. Each menu item is a `<Link>` (with `aria-current="page"` on the active one) inside a `DropdownMenuItem`, and `DropdownMenuContent` uses `align="start"` + `w-(--radix-dropdown-menu-trigger-width)` so the menu lines up with and matches the trigger width.
- The section layout renders **two tiers of header**, matching the design system:
  1. A **shared section header** at the very top (e.g. `Settings` / "Manage your account and preferences") that uses the same full-width sticky chrome as the other top-level routes, so the section reads like every other page. Render a `PageHeader` **outside** `PageHeaderSectionProvider` so it keeps the sticky breakout chrome; like every other route its centered title row aligns to the unified `max-w-content` column.
  2. The **per-page title** ("General", "Account Settings", …) below it, rendered by each page's own `<PageHeader>` in **section mode**.
- Wrap the dropdown + content in `PageHeaderSectionProvider` from `@/lib/components/page-header`. That switches every descendant `PageHeader` into **section mode**: a plain, non-sticky, non-breakout in-panel title block that sits at the top of the content column. Render the dropdown directly in the layout (do **not** use `PageSubnavProvider` here). The wrapper is a plain `w-full` div — it inherits the unified `max-w-content` from the `(timeline)` layout, so it needs no width class of its own.

  ```tsx
  // app/(timeline)/<section>/layout.tsx
  'use client'
  import {
    PageHeader,
    PageHeaderSectionProvider
  } from '@/lib/components/page-header'
  import {
    SectionNavDropdown,
    type SectionNavTab
  } from '@/lib/components/section-nav-dropdown'

  const tabs: SectionNavTab[] = [
    { name: 'General', url: '/settings', icon: SettingsIcon }
    // …
  ]

  export default function Layout({ children }) {
    return (
      <>
        {/* Shared section header — sticky chrome, outside the section provider. */}
        <PageHeader
          title="Settings"
          description="Manage your account and preferences"
        />
        <PageHeaderSectionProvider>
          {/* Plain wrapper — inherits the unified max-w-content from the
              (timeline) layout, so no width class of its own. */}
          <div className="w-full pt-4">
            {/* Dropdown sub-nav on every breakpoint — no vertical rail. */}
            <SectionNavDropdown label="Settings" tabs={tabs} />
            <div className="min-w-0">{children}</div>
          </div>
        </PageHeaderSectionProvider>
      </>
    )
  }
  ```

- A **nested sub-nav that navigates** — one whose entries are other routes inside the section — renders as a small **in-content segmented control**, not a second dropdown or rail. Hand it to the closest section-mode `PageHeader` via `PageSubnavProvider` so it sits directly **below the per-page title** (header-first, like the non-nested pages) rather than above it. (The settings, fitness, and admin layouts themselves use the dropdown sub-nav above, not this nested pattern.)
- A nested sub-nav that switches a **view of the page you are already on** is a dropdown instead — the shared `SectionNavSelect` (`@/lib/components/section-nav-select`), described below. That is the design system's own call rather than a carve-out invented here: `ui_kits/web/GearKit.jsx` puts a `GKViewDropdown` on a gear's page below the stat tiles it re-renders, with the section's own "Gear ▾" dropdown still above it, and the fitness activity detail switches its Overview / Analysis / Comments sections the same way. The distinction is what the control does, not where it sits: a segmented control reads as "more of this page", which is wrong for something that replaces the page's whole body, and it carries no per-entry icon, which both of these designs do.

### Section sub-nav in local state (`SectionNavSelect`)

- **`SectionNavSelect` is the state-driven twin of `SectionNavDropdown`**, and there is one implementation of each — do not re-inline either. Both render the same chrome: an outline trigger carrying the active tab's Lucide icon in `text-primary`, a sentence-case label and a muted `ChevronDown`, over a `rounded-xl` menu sized with `w-(--radix-dropdown-menu-trigger-width)`. They differ only in what a row does. `SectionNavDropdown`'s rows are `<Link>`s, its active row is resolved from `usePathname()` and marked `aria-current="page"`; `SectionNavSelect` takes `{ tabs, active, onChange }`, its rows are `DropdownMenuItem`s calling `onChange`, and the current one is marked with the **boolean** `aria-current` — nothing here is a page.
- Its two consumers are the fitness activity detail (Overview / Analysis / Heart rate zones / …) and a bike's gear page (Components / Activities). A third copy of that markup is exactly what extracting it removed.
- **Both** active rows take `text-primary-text`, not `text-primary` — see the orange-text rule under **Fitness Gear**. That is the one place the pairing is load-bearing rather than cosmetic: the two dropdowns now appear on one screen (a bike's page carries the fitness section's nav above its own view switcher), so a mismatch reads as a mistake, and `--primary` as a foreground is under the AA floor either way. Each keeps its wash on `focus:` and therefore also carries `focus:ring-2`, or a keyboard user watching the highlight move down the list would see it vanish on precisely the current row.

### Sticky-header sub-nav (`PageSubnavProvider`)

- `PageSubnavProvider` remains available for sections that need horizontal tabs **inside** the sticky header: wrap the layout's `{children}` in it and pass the rendered tabs as `subnav`. The closest `PageHeader` renders the tabs directly under the title row, inside the sticky chrome. Do **not** render the sub-nav directly in the layout JSX above the header. No settings-style section layout uses this any more (admin moved to the dropdown sub-nav above to match the design system), but the top-level Notifications page (`app/(timeline)/notifications/page.tsx`) uses it for its sticky-header filter tabs, and the primitive also backs the nested in-content segmented-control pattern.

  ```tsx
  import { PageSubnavProvider } from '@/lib/components/page-header'

  // const subnav = (/* tabs strip — desktop tabs + mobile dropdown */)
  // return <PageSubnavProvider subnav={subnav}>{children}</PageSubnavProvider>
  ```

## Settings Forms (Client Components)

- Settings forms that update user data (name, email, password, etc.) **must be client components** that submit JSON to the API — not plain HTML `<form method="post">` with server-side redirects.
- Client component forms should:
  - Call a named function exported from `lib/client.ts` (which encapsulates the `fetch` call, method, headers, and body serialization), per the Client-Side API Calls section — do **not** call `fetch()` directly in the component
  - Show inline success and error messages (not raw error pages)
  - Manage loading state with `useState`
- A dozen legacy components still call `fetch()` directly (the `Change*Form`s under `app/(timeline)/account/`, `StravaSettingsForm`, the OAuth/password-reset forms, and several `lib/components` settings/actor-switcher dialogs). They are frozen in the `allowFiles` list of `agents/no-component-fetch` in `.oxlintrc.json`; the lint rule blocks any new offender. Migrate them to `lib/client.ts` when touched and remove them from the list — never add to it.
- The corresponding API route should return JSON via `apiResponse()`, not `Response.redirect()`.

## Transactional & Notification Emails

Every email the server sends goes through one shared skeleton, so a design or
copy change lands in one place instead of eleven. All eleven templates are on
it; there is no legacy shape left to copy.

- **One module per email** in `lib/services/email/templates/`, exporting a single
  `build<Name>Email(params): RenderedEmail` (`{ subject, text, html }`). **Never
  inline a subject or an HTML/text body at a call site** — three of the four
  account emails used to, which is exactly why they could not be restyled
  together. (`actorDeleted` was already a module; its problem was hand-written
  raw markup.) The caller supplies `from`/`to` and spreads the result into
  `sendMail`.
- **Templates never write markup.** They compose blocks from
  `@/lib/services/email/layout/blocks` and hand them to `renderEmail`
  (`@/lib/services/email/layout/renderEmail`), which owns the 600px table
  skeleton, the `<head>`, the header, and both footer variants. Colours and sizes
  come from `@/lib/services/email/layout/theme` — email has no stylesheet, so
  nothing may reference a CSS variable or a Tailwind class.
- **Escaping lives in the block builders, not the templates.** A builder takes
  plain strings and escapes them itself, so a template cannot forget one. Nothing
  in the layout emits an unescaped value today. When the notification templates
  land they will need to pass an already-sanitized post body through; that must
  go through the existing `convertMarkdownText`/`sanitizeText` pipeline and be
  the single, explicitly-typed exception — never markup assembled by hand.
- **Every `href`/`src` is absolute and built from `getBaseURL()`.** A
  root-relative URL is unresolvable in a mail client (note `convertMarkdownText`
  emits `/tags/x` for hashtags), and a hardcoded `https://${config.host}` is
  wrong under `ACTIVITIES_INSECURE_AUTH=true`. URLs are protocol-checked to
  http/https/mailto; anything else degrades to plain text rather than shipping a
  dead or dangerous link, since remote actors control `status.url`.
- **The plain-text alternative is derived from the same block list**, never
  hand-written beside the HTML. Both used to be maintained by hand and had
  already drifted apart.
- **A local `vi.mock('@/lib/config', …)` in a test MUST include `getBaseURL`.**
  It shadows the global mock from `vitest.setup.ts`, and because most email call
  sites deliberately catch delivery errors, omitting it does **not** fail loudly:
  the template throws, the catch swallows it, and the test keeps passing while
  the email silently stops sending. This has already happened twice
  (`deleteActorJob.test.ts` and the password-reset route test), in both cases
  hiding that `sendMail` was never reached at all.
- **Verify a template change by rendering it**:
  `./scripts/mock/renderEmailPreviews.ts` writes every template to HTML with
  fixture data, plus an index showing each one beside its plain-text twin (see
  `docs/maintenance.md`). Emails are not pages, so this is the real-browser check
  Definition of Done item 6 asks for. **A new template must be added to
  `buildPreviews()` in the same PR**, or the change ships unpreviewable. Keep the
  fixture values production-shaped — the codes are 43-char base64url, and a short
  placeholder hides the link-wrapping problems a real one exposes — and leave out
  a fixture the preview cannot represent honestly: the fitness card passes no map
  URL because the generated maps are 4:3 and any stand-in image renders the card
  a third taller than it ever will be.
- **An email must never point an `<img src>` at a stored image path directly.**
  The media storages write WebP unless the caller asks for another format
  (`_saveImageBuffer` / `_uploadImageBufferToS3`), and Outlook desktop (Word
  rendering engine) and Windows Mail have no WebP decoder — those recipients get
  the `alt` text. So an email image needs a stored JPEG copy
  (`saveMediaImageRendition(database, actor, file, 'jpeg')`) plus a column to
  remember it; the route map's lives in `fitness_files.mapImageEmailPath`. Keep
  the WebP as a **live** fallback for whenever the copy is missing — no media
  storage configured, over quota, a failed encode — not merely for rows written
  before the column existed. A stored file with no `medias` row is invisible to
  every generic media path, so whoever writes one owns its whole lifecycle:
  delete it wherever the reference is dropped — `deleteEmailMapImage` is the one
  helper for that, and every site that drops a reference must call it (activity
  delete, `delete_media` status delete, reprocess, re-import, map regeneration,
  the Strava repair script) — teach
  `scripts/maintenance/cleanupMediaStorage.ts` that it is referenced, and add it
  to `scripts/backup/productionArchive.ts`. An on-demand transcode off
  `/api/v1/files/:path` is **not** an option: with object storage behind a public
  hostname that route answers `Response.redirect(url, 308)`, so there are no
  bytes to convert.
- A browser is a lower bar than a mail client. For a change to the shared layout,
  also send one to a real inbox and check Gmail, Apple Mail and Outlook —
  Outlook's Word engine is the one that needs `mso-` properties and the ghost
  table, and none of that is observable in a browser.

## Fitness Stat Strips

- **Three stat strips render through `FitnessStatGrid`**
  (`@/lib/components/fitness/FitnessStatGrid`): the activity detail page's
  header strip (distance / moving time / avg pace / elev gain), the strip under
  its route map, and the inline fitness chip in a timeline post. Do not
  hand-roll a `grid-cols-*` strip beside them, and put a new fitness stat strip
  on this component rather than on a fourth threshold of its own.
- **Two strips are NOT on it yet**, so do not read the rule as describing the
  whole tree: the gear detail page's strip
  (`app/(timeline)/fitness/gear/[id]/GearDetailView.tsx` — still on a
  `sm:grid-cols-3`/`sm:grid-cols-2` **viewport** query, which is the same defect
  described below) and the fitness overview's totals
  (`app/(timeline)/fitness/ActorFitnessDashboard.tsx` — container-queried, but
  hand-rolled on its own `@2xl/fitness` threshold). Migrating them is a
  worthwhile follow-up; until then this section describes three strips, not
  every one.
- **The column rule is a CONTAINER query, never a viewport breakpoint.** The
  design system's `FitnessKit.StatGrid` and `FitnessChip` grids measure their
  own width with a `ResizeObserver` for the same reason `useCompactActionBar`
  does on the post action row: a strip can sit in a narrow column on a wide
  window. The old `sm:grid-cols-4` looked at the viewport, so on a tablet the
  detail page kept four `text-[28px]` tiles side by side in a 565px column and
  wrapped "31.1 km/h" onto two lines, while a chip in a wide column stayed
  needlessly 2-up at any window under 640px.
- The two variants differ, and it is the type size that separates them.
  `detail` is 1-up, 2-up from **420px** and 4-up from **780px** (values are
  21–28px, so a cell needs ~200px). `chip` is 2-up and 4-up from **424px**
  (`text-sm` values fit four cells in 4×100px + 3×8px of gap) and never drops to
  one column — a 4-row chip in a feed is a worse trade than a slightly tight
  cell.
- The detail page's two strips measure **separately** — the header one sits
  inside the card's `p-5` and is 42px narrower than the one under the map — so
  they can legitimately differ by one step in a narrow band of window widths.
  That is the rule working on real available width, not drift.
- `@container` goes on a **wrapper**, never on the grid itself: a container
  query styles a container's descendants, not the container, so a grid cannot
  both establish the container and read it. Guarded by
  `lib/components/fitness/FitnessStatGrid.test.tsx`.

## Apple Maps Basemap

- **Every Apple-rendered map draws the `mutedStandard` basemap, interactive and
  static alike.** The four MapKit components (`ActivityRouteMapKit`,
  `RouteHeatmapMapKit`, `RegionMapKit`, `PrivacyZoneMapKit`) pass
  `mapType: mutedStandardMapType(mapkit)` to `new mapkit.Map(...)`, and the Web
  Snapshot URL that renders stored route images carries the same basemap as
  `t=mutedStandard` (`lib/services/fitness-files/appleMapsSnapshot.ts`). It is
  the standard road map with its land, water and POI colours de-saturated, which
  is the same reason the GL providers render heatmaps on `light-v11` /
  `positron`: the route lines, heat runs and privacy circles drawn on top have to
  stay the most prominent thing on the map. Do not give one surface its own map
  type, and do not re-enable `showsMapTypeControl` — a reader switching to
  satellite loses that contrast.
- **`mutedStandardMapType` falls back to the literal on purpose.**
  `mapkit.Map.MapTypes` is a static of the `map` library rather than of
  `mapkit.core.js`, and every component builds its map inside a `try` that drops
  the whole map to the static/OSM fallback renderer on throw — so reading
  straight through an absent `MapTypes` would trade a purely visual option for no
  Apple map at all. The enum member is defined as exactly
  `MAPKIT_MUTED_STANDARD_MAP_TYPE`, so the fallback renders identically. The test
  double carries the real static, so the components exercise the enum read.
- The snapshot module keeps its own copy of the literal rather than importing the
  component one: it is server-only (`lib/services/**`) and must not reach into
  the client component tree — see **Server/Client Module Boundary**.
- Changing the basemap does **not** restyle already-stored route images. They are
  re-rendered only by **Regenerate maps for old statuses** (`/fitness/privacy`,
  `POST /api/v1/fitness/general/regenerate-maps`).

## Fitness Activity Dates

- **A fitness post's `createdAt` is NOT the activity's start time — read
  `fitness_files.activityStartTime`.** A post created through
  `importFitnessFiles` was backdated to the earliest target activity's start —
  or, with no parsed start time, to the fitness file row's own `createdAt` —
  until the Strava webhook opted into `postAtImportTime`
  (`lib/jobs/importFitnessFilesJob.ts`), which stamps the status when the import
  publishes it so a just-finished ride is not filed hours down the timeline
  behind everything posted while it was still being ridden. It does that for
  ANY activity the webhook delivers, however old — Strava fires `create` for a
  late device sync and a back-dated manual entry too. Every other caller still
  backdates, because each replays history. Do not read any of that as "the two
  used to be equal" and derive one from the other for old rows: they already
  diverged for a merged multi-device activity whose primary file is not its
  earliest (`createdAt` follows the earliest start, `status.fitness` follows
  `isPrimary`, and the primary is the LONGEST outdoor file), for a file whose
  parse yielded no start time at all, and for the streamless Strava fallback
  note, which never reaches `importFitnessFiles` and has always been stamped at
  import time. Anything rendering, sorting or grouping by "when the activity
  happened" therefore has to read the file, not
  the post: `FitnessStatusDetail`'s date, the import email
  (`fitness?.activityStartTime ?? status.createdAt`) and
  `getActivityImportGroupKey` all do. The status payload carries
  `StatusFitnessFile.activityStartTime` precisely so a surface holding only a
  status has it — the detail page's placeholder used `status.createdAt` as a
  stand-in and silently started dating rides wrongly the moment those two
  diverged. The post's own `createdAt` remains correct for what it means: when
  the post was published, which is what the timeline, the relative timestamp and
  the ActivityPub `published` should show.

## Fitness Route Heatmap Pyramid

- **Tile visit counts ACCUMULATE, so an activity must be folded into a build
  exactly once.** Folding one twice inflates its heat permanently, and unlike a
  missing tile nothing downstream can detect it — the number is wrong, not
  absent, and if the build's `version` never moved then completion's stale sweep
  can never clear it either. Every rule below exists for that one hazard.
- **The fold gate is POSITIONAL, never a counter.** A build folds an activity
  only when its own `(createdAt, id)` cursor says it has not already, with the
  scan running descending. Counting scanned files cannot tell honest progress
  from a page already seen — a redelivered page after a crash, an offset shifted
  because an activity was uploaded between two passes, a lost progress write all
  look identical to a counter. It guards the double-fold direction only: the
  scan is still the legacy integer paging, so an activity DELETED from the part
  already scanned shifts every later row up an offset and the file between is
  never presented to the gate at all. That hole is inherited (the legacy blob
  skips the same activity in the same run) and heals on the next full generate;
  closing it means resuming on the build's own keyset cursor.
- **The cursor advances for every file the pass finished with, GPS or not, and
  it advances WITH the fold.** With, rather than after, because a flush can fire
  part-way through an activity and writes its tiles and cursor in one statement.
  For every file, including one whose download or parse threw, because a build
  with no cursor cannot be resumed — so a pass whose files all threw would hand
  its own continuation a token the claim then refuses, releasing the build, and
  every later pass in the chain carries a non-zero offset and can start nothing
  either. That is why the advance lives in a `finally`, not at the end of the
  `try`.
- **Resuming a build requires presenting its token, not declaring an intent.**
  Keeping a build's `version` means adding to its tiles, which is safe only for
  a pass carrying on from where that build left off. `resume: true` on a job is
  NOT that: the heatmap API sets it for any retry of a failed or partial region
  row, carrying that row's offset and no pyramid token.
- **A pass that provably cannot own a build must not CLAIM one.** Only a pass
  scanning from the beginning or carrying the build's token can cover what a
  build promises, and both are knowable from the job data before the claim —
  which matters because the claim is destructive: its compare-and-swap bumps
  `version`, stamps `generating`, and clears the counters, the cursor and
  `completedAt`. Deciding afterwards is too late; a routine region-row retry
  took a healthy completed pyramid to a failed, empty one over tiles it no
  longer described, and rebuilt nothing. A claimer at offset zero with no token
  still gets a fresh version — a full rebuild that sweeps the old build away,
  which is merely wasteful where the alternative is silently wrong.
- **Every fence names the pyramid ROW as well as `claimSeq`.** The sequence
  counts from zero per row and clearing an actor's heatmaps deletes the row, so
  token 1 before a clear and token 1 after it are different builds — the
  likeliest collision there is. This applies to the claim, the tile flush, the
  progress/status write and the completion sweep alike — the sweep especially,
  since it is the write that DELETES: unfenced, a build sweeping at version 2
  whose call landed after a clear deleted the replacement build's version-1
  tiles, and that build then stamped itself `completed` over tiles that were
  gone.
- **Tile work never fails the run.** Every map now renders the pyramid, but only
  after its first batch of tiles resolves — until then, and whenever a fetch
  fails, it draws the untiled blob. So losing a build costs zoom detail while
  failing the run costs the user the heatmap they can actually see. Every tile-path error — the tiler, a flush, the
  completion — abandons the build, records why on the pyramid row, and lets the
  legacy path finish. Two writes have nothing to record on and are only logged:
  the CLAIM, because its compare-and-swap and the read confirming it share one
  transaction, so it either happens and is reported or does not happen; and the
  completion SWEEP, which runs after the build is already `completed`, so its
  failure leaves stale tiles for the next build's sweep and nothing else. The
  claim's exception is a transaction that commits and loses its
  acknowledgement, where the row is claimed and the caller never learns it: that
  build waits out the staleness window like any other whose worker died. The
  same shape applies to the completion write, whose caller treats a lost
  response as a failure and releases a build that is in fact finished; both are
  what an at-least-once queue and a non-idempotent write cost, not something a
  guard here removes.
- **A build this pass was CARRYING rather than holding is released from one
  place, the handler's `finally`.** Four separate guards drop a continuation,
  and a per-guard release was missed on one of them twice; no per-guard release
  covers a throw between reading the token and making the claim either. The
  release is unconditional because it is fenced on the carried token and every
  claim moves the token: once this pass adopted the build, or anyone else took
  it over, it matches nothing. (A build the pass went on to CLAIM is a different
  thing, and is released at each of the exits that can abandon one.) A dropped
  continuation is the case that matters most — it holds the only copy of its
  build's token, so walking away strands the build AND refuses the Generate that
  displaced it, for the whole staleness window.
- **A build only completes over a history it actually scanned, counted again at
  the moment of the decision.** It catches an activity ADDED during the build,
  where the recount rises above what the scan reached — but only while that rise
  survives to the decision: the recount runs AFTER the scan, so a deletion
  landing between the final page read and it cancels the shortfall exactly, and
  the build completes having re-presented a file. That window is why the fold's
  `foldedThisFile` guard is not redundant with this check. It does NOT catch an
  activity DELETED from the already-scanned part either: that shift skips a file
  AND lowers the recount by the same one, so the pass looks exactly as covered
  as it would have been, and the build completes missing an activity until the
  next full generate. `completedAt` is what makes the next claim
  answer `already-fresh`, so certifying a scan that fell short does not merely
  lose tiles — it refuses the regenerate that would have picked them up, turning
  a transient hole permanent. An activity uploaded while the build runs sorts
  first and lands before the offset a continuation resumes at, so it is never
  presented to the fold gate at all; the pass hands the build back rather than
  stamping it. The count comes from a fresh `countFitnessFilesByActor`, because
  the snapshot taken before the scan is blind to exactly the upload in question.
- **A build that could not READ every file it walked past still completes, and
  says so on the row.** The cursor advances for a file whose download or parse
  threw — it must, or the build is unresumable — so "reached the end" and "read
  what it reached" are different facts, and the second one is a degradation the
  row records in `error` rather than a reason to withhold the build. That count
  is carried across continuations with the build's token, because the pass that
  finishes a long history is rarely the one that hit the outage and a per-pass
  count reads `error: null` over a build that lost activities. Refusing to
  complete would wedge any actor with one permanently unreadable object, which
  the legacy blob simply skips.
  Withholding the SWEEP does not protect the missing geometry, which was tried
  first and reverted: tiles are one row per `(actorId, tileKey)` and
  `mergeTileDelta` REPLACES a tile whose stored version is older, so a readable
  activity destroys an unreadable one's contribution to every tile they share —
  measured, a partial outage kept 66 of 224 tiles and still lost 37% of the
  points, while a permanently unreadable file blocked the sweep forever so
  deleted activities never left the pyramid.
- **Completing a build and sweeping the previous one's tiles are separate
  steps.** The sweep runs after the guarded completion write has already stamped
  the row, and the release that a completion failure triggers is fenced on a
  token completion does not move — so a sweep inside the same `try` rewrote a
  finished, correct pyramid to `failed` over the very tiles it had just
  certified. A failed sweep costs some tiles at an older version, which the next
  build's own sweep removes.
- **Tiles are stored UNCLIPPED and a region is applied when they are served.**
  The pyramid is per-ACTOR and covers every activity over all time, so whichever
  region row wins the claim builds the same tiles — which is also why only the
  all-activities/all-time heatmap gets a `tileSource`. A row filtered to one
  sport or one year is not something the pyramid can answer however complete it
  is, and `isPyramidVariantHeatmap` is the single place that decides it (it
  mirrors `isPyramidVariant` in the job, which decides whether a run builds
  tiles at all).
- **The public token route refuses any share the pyramid cannot answer, using
  the SAME predicate that decides whether a heatmap advertises a `tileSource`.**
  A share scoped to one sport or one year is not something a per-actor,
  all-time pyramid can answer, and serving it from there publishes every sport
  and every year — a leak that region clipping cannot catch, because such a
  share is usually world-wide. Deriving the route's go/no-go from
  `buildHeatmapTileSource` rather than re-deriving the conditions is what stops
  the serving path and the advertising path drifting apart, which is exactly
  how the gate came to be on the pages and missing on the route. The predicate
  therefore tests `activityType` for null rather than for falsiness: the job's
  own gate is `activityType === null`, and reading an empty string as "no
  filter" here while the job read it as a filter matching nothing would serve a
  whole history behind a row showing none of it.
  The OWNER route has no such gate and needs none: its request names a region
  and nothing else, so there is no variant to disagree with.
- **On the public token route, clipping to the SHARED ROW's region is the
  security boundary — not a view option.** The caller sends tile indices and
  nothing else; the region comes from the row the token resolved to. Without
  that, a share cut to one rectangle is a lookup oracle for the actor's whole
  history. Out-of-region tiles are settled from their coordinates BEFORE any
  read, boundary tiles are clipped vertex by vertex through the untiled
  heatmap's own `splitSegmentByBounds`, and the classification is allowed to be
  pessimistic (a union covering a tile reads `partial` and clips to the same
  geometry) but never optimistic.
- **The region resolver FAILS CLOSED.** `getRegionBounds` answers `[]` both for
  the whole world and for a region string it could not parse a rectangle out of,
  and `[]` means "clip nothing" everywhere downstream — so a rect share whose
  stored token failed to parse would serve the world. Only the empty string, the
  world sentinel `serializeRegions` emits, reaches the unclipped path; anything
  else that resolves to no bounds is refused — a case a writer really could
  produce, since `serializeRegions` used to emit a rectangle that rounding had
  collapsed, and rows written then still hold one. **All four PUBLIC surfaces
  apply that rule**, through the one `resolveSharedHeatmapRegionBounds`: for
  such a row the generation job baked the whole world into the untiled
  `segments` too, so the share page, the embed page and the embed image refuse
  it exactly as the embed tile route does. The OWNER tile route is deliberately
  not among them — it clips to the region its own authenticated caller sent.
  Over-refusing now costs the whole share, not just its zoom detail. Anything that PRODUCES a rectangle gates on
  `isSerializableRect`, the same predicate `serializeRegions` applies, so a
  producer and the serializer cannot drift — a box thinner than the 0.01°
  serialization step is well formed and still has no canonical key of its own,
  and saving one takes the WORLD's key. It runs before the conditional-request
  check, so no response — 200 or 304 — is produced without it. The three
  route-heatmap surfaces that take a region from a client normalize it with the
  one shared `normalizeRegionParam`; the region-names route keeps its own
  variant, which answers null rather than `''` for the world sentinel because a
  world scope is not a nameable region.
- **The public tile route reads the share row WITHOUT its geometry**
  (`getFitnessRouteHeatmapSummaryByShareToken`). It answers from the pyramid
  and needs the row only for its actor, status, scope and variant, while
  `segments` holds the entire untiled heatmap — which a panning viewport would
  otherwise drag off disk and through `JSON.parse` once per tile batch, and
  before the conditional-request short-circuit at that.
- **The public route re-encodes every byte it returns.** The owner path may
  forward a stored payload verbatim for a tile that needed neither clipping nor
  stripping; the public one always goes through `decodeTile` (which validates
  ranges) and back out through `encodeTile`. `flattenTilePrivacyForPublic` lives
  beside `flattenPrivacySegmentsForPublic` so both public surfaces answer to one
  doctrine — the privacy FLAG goes, the geometry stays.
- **Only a `completed` pyramid serves tiles, and only at its own `version`.** A
  build in flight has two versions in the table at once, and drawing them
  together shows heat no build ever produced. The version filter is not
  belt-and-braces: completion's stale sweep runs in its own `try/catch`, so a
  build that completes after the sweep throws leaves exactly those leftovers.
  The response reports the version it actually served (0 for none) and its keys
  are the ones the REQUEST named, never the ones the read returned.
- **Every read of the pyramid from a surface that is not about tiles is
  best-effort.** The owner's heatmap GET and both public pages read it only to
  publish a `tileSource`, so each wraps the call in `.catch(() => null)`:
  letting it throw would trade the whole untiled response — the map the user can
  actually see — for a table nothing renders yet, which is the trade the rule
  above exists to forbid.
- **The `v` request parameter is a cache-buster, never a tile filter.** A
  well-formed version that has since moved is answered with the current tiles
  and the current version; refusing it would blank a map the instant a rebuild
  finished underneath a client still holding the previous `tileSource`. A
  MALFORMED one is a 400 on both routes — a client that thinks it is busting a
  cache with a value the server cannot read should be told, not quietly served
  from the entry it meant to bypass.
- **Both tile routes parse their query through one `parseTileBatchQuery`.** Two
  parsers had already drifted: `?z=4&z=16` resolved to 16 through
  `Object.fromEntries` and to 4 through `searchParams.get`, and a malformed `v`
  was a 400 on one route and ignored on the other. Neither was a leak, but a
  divergence between two routes that must agree is how one becomes a leak the
  next time either grows a scope-bearing parameter.
- **The client picks its rung by rounding UP, and two unit conversions guard
  that.** GL reports zoom on a 512px tile grid while the pyramid is built on
  256px tiles, so `map.getZoom() + 1` is the pyramid's zoom; MapKit has no zoom
  at all and derives a FRACTIONAL one from its region and element width, never
  `getZoomLevelForBounds`, which returns the floor and would undo the rounding.
  A view needing more than `MAX_TILES_PER_VIEW` is COARSENED down the ladder,
  not refused; the ceiling is sized ABOVE what real viewports ask for (273 tiles
  at 1280x720, 558 at 1920x1080, 984 at 2560x1440) because coarsening costs a
  whole rung of detail. The tile cache must hold more than one view or a view
  evicts its own fetched batches — and it is bounded by VERTICES as well as tile
  count, since a decoded vertex is a ~82-byte object and the format has no
  per-tile point ceiling. Eviction never touches the current view's tiles.
- **Tiles REPLACE the untiled geometry, never draw beside it.** The two describe
  the same roads at different fidelities, so together every line renders at
  twice its opacity. The swap waits for a batch to resolve, so a pan never
  blanks the map, and a failed fetch leaves the previous view standing.
- **The STATIC share image reads the pyramid too, and enforces the same two
  boundaries the tile routes do.** `buildHeatmapSegmentsFromTiles` takes the
  heatmap ROW, not a bare actor id — pairing a scope with the wrong actor's
  history is the mistake the signature exists to prevent — gates on
  `buildHeatmapTileSource` BEFORE the read, and clips every tile to the shared
  row's region. Clipping cannot substitute for the variant gate: it bounds
  geography and nothing else, so a share scoped to one sport or one year drawn
  from the whole-history pyramid publishes every sport and every year. The rung
  comes from the IMAGE's own size along whichever axis the renderer fits by
  (`min(width / spanX, height / spanY)`, in projected units — a degree of
  latitude is not a fixed number of pixels in Mercator), and geometry is placed
  with each ROW's own `z`/`x`/`y`, never the rung the view computed.
- **Each static renderer is offered the tiles FIRST and the stored blob SECOND,
  and the blob is why the dual-write still exists.** Tile geometry is one run
  per way per tile where the blob is roughly one polyline per activity, so a
  street-level view is hundreds of overlays rather than tens — a shape neither
  basemap renderer can draw. Apple refuses outright past
  `MAX_SNAPSHOT_OVERLAYS` (24), which dropped those instances to the keyless SVG
  and cost them their basemap; Mapbox silently truncates at
  `MAPBOX_STATIC_URL_BUDGET` (7000 chars) and then frames the image with
  `/auto/` on only the overlays that survived, which — since tile runs arrive in
  tile order — is one contiguous corner of the view blown up to fill the frame.
  `requireAllOverlays` makes the tiled candidate refuse rather than truncate. Do
  NOT remove the fallback, and do NOT make pyramid rows store `segments = null`,
  until the raster path can stand alone (coarsening down the ladder until the
  geometry fits a renderer's ceiling is the open design). Only the keyless SVG
  renderer has neither limit — and it is the only one that shades strokes by
  visit count; Apple and Mapbox draw every stroke at a flat 0.9.
- **The share page's link-preview card points at that same image route, and
  `format=png` is what makes it work.** `/u/heatmaps/<token>` publishes
  OpenGraph and Twitter tags through `generateMetadata`; its `og:image` is the
  existing `/embed/heatmap/<token>/image`, deliberately NOT a fifth public
  surface, so the share guards that route already enforces are the ones that
  apply. That route answers SVG whenever it falls through to the keyless
  renderer — which is what every instance without a Mapbox token or Apple key
  serves, llun.social included — and no card crawler (X, Facebook, Mastodon,
  Slack, Discord) renders SVG, so the raster parameter is load-bearing rather
  than a nicety. It is opt-in because the SVG scales and the embed snippet the
  share dialog hands out already points at that URL, and anything but the exact
  string `png` collapses onto the default, so the parameter cannot widen the
  cache variants `DIMENSION_STEP` exists to bound. Both callers build that URL
  through the one `buildHeatmapEmbedImageUrl` — the share dialog in the browser
  and the card on the server — so the route's query shape has a single owner. A rasterization failure
  degrades to the SVG rather than 500ing, on the same reasoning every other
  tile-path failure follows. The declared `1200x600` is what the route will
  actually serve — 630 snaps to 600, and only the Apple path differs (1280x640,
  same ratio).
- **The card's facts come from the SAME view the page renders, and a share that
  will not render gets NO card.** One `cache()`-memoized `loadSharedHeatmap`
  feeds both `generateMetadata` and the page body, so a card cannot describe a
  share the page refuses — the alternative is a second lookup path free to
  drift from the first. A revoked token, a share re-queued for generation and
  an unresolvable region all 404, and each returns the bare metadata: an
  `og:title` for one publishes the region name, the owner's handle and a
  thumbnail that the refusal exists to withhold. The page stays `noindex`
  because the token is the secret, which costs the card nothing — crawlers read
  OpenGraph without consulting robots, this instance's own
  `parseOpenGraph` included.
- Full design and rationale: `docs/fitness-file-storage.md` → Route heatmap tile
  pyramid.

## Fitness Gear

- **A gear total is derived, never stored.** `fitness_gears` and
  `fitness_gear_components` carry no distance column: a gear's lifetime distance
  is `SUM(fitness_files.totalDistanceMeters) WHERE gearId = ?`, and a
  component's is the same sum restricted to activities whose `activityStartTime`
  falls in one of its install periods (see below). Do not add a cached total
  "for performance" — it would have to be reconciled on every back-dated upload,
  archive re-import, edit and delete, and the whole point of the model is that
  totals always agree with the calendar.
- **A component's install history is a LIST of periods, not one window.**
  `fitness_gear_component_periods` holds a row per stretch the part was fitted
  (`installSequence`, `addedAt`, `removedAt`), and `fitness_gear_components` has
  no `addedAt`/`removedAt` columns at all. The component's own `addedAt` and
  `removedAt` are DERIVED — the first period's start and the LAST period's end —
  so they still mean what they always did ("when it first went on", "when it
  last came off", null while fitted) and every existing reader is unaffected,
  including `evaluateGearServiceReminders`' "is it fitted now" and
  `diffGearComponents`' `(type, brand, model, addedAt)` identity. One window
  could not describe a part that comes off and goes back on: clearing
  `removedAt` reopened the ORIGINAL window, so a part unretired months later was
  credited every activity ridden while it sat off the bike, and re-retiring did
  not take that back — it only closed the window again at the new today. Do not
  reintroduce the columns as a denormalised copy of the latest period, for the
  reason the totals are derived: a second source of truth for the same fact
  drifts and nothing downstream can tell.
- **Retiring closes the open period; refitting opens the NEXT one at today.**
  `POST /api/v1/fitness/gear/:id/components/:componentId/refit` is its own
  endpoint precisely because it is NOT the mirror of `/retire` — reopening the
  closed period is the retroactive credit above. A new period costs at most the
  gap between the retirement and the refit: seconds for a misclick (so the
  card's one-click, unarmed Refit still reads as an undo), and the truth for a
  wheelset that really did spend a winter on the shelf. `PATCH { removedAt:
null }` remains the precise "this retirement never happened" — it reopens the
  LAST period — and PATCH's `addedAt`/`removedAt` reach only the outermost
  bounds (first period's start, last period's end), which is what keeps an edit
  from making two periods OVERLAP. It does not on its own keep a period from
  being INVERTED, and the route has to check each bound against the other end
  of the period it lands on to do that: the component's own `addedAt` and
  `removedAt` are derived from two DIFFERENT periods once a part has been
  refitted, so validating the request against that derived pair compares bounds
  that do not belong together and lets `[May 1, Feb 15)` through — a period no
  activity can fall inside, which drops its distance silently and for good. The
  bug reads as correct because for a single-period component the first and last
  period are the same row and the two formulations coincide.
  **The route's check is not sufficient on its own, and the write guards its
  own ordering too.** The route validates the periods it READ;
  `updateFitnessGearComponent` resolves which period is first or last when it
  WRITES, and a refit landing between the two appends one — so a bound lands on
  a row the check never saw. Once a further refit buries that period in the
  middle, nothing re-examines it, because only the first and last are ever
  checked. How the write guards it depends on where the bounds land, and the
  split is the whole subtlety: when they land on DIFFERENT rows each carries an
  SQL predicate against the other end that row keeps, but when they land on the
  SAME row — one period, which is every component never refitted — they are
  written together and the ordering is settled in JS. Per-bound predicates
  there would compare the new `addedAt` against the OLD `removedAt` the same
  statement is about to replace, so a wholesale window move applied one half
  and silently dropped the other behind a 200.
- **Periods must never overlap, and `UNIQUE (componentId, installSequence)` is
  what enforces it against a race.** The rollup joins the periods and sums over
  them, so an activity inside two of them is counted twice — a permanently wrong
  number nothing downstream can detect. Two concurrent refits both read the
  highest sequence and both try to claim the next one; the unique index lets
  exactly one win, and the loser reports "already fitted". The loser identifies
  itself from the ERROR, through the shared `isUniqueConstraintError` — never by
  re-reading the component and suppressing when it happens to look fitted, which
  cannot tell that transaction's unique violation from a dropped connection or a
  bug in either write, and would report a real fault as a tidy 404. Do
  **not** replace it with the partial `(componentId) WHERE removedAt IS NULL`
  that expresses "at most one open period" directly: knex emits a partial
  index's predicate on PostgreSQL and SQLite but DROPS it on MySQL-compatible
  clients (see `20260820000000_add_local_public_timeline_indexes.js`), leaving a
  bare `UNIQUE(componentId)` that forbids a second period outright.
- **`installSequence`, not `addedAt`, is the ordering key.** The first period's
  `addedAt` is nullable ("since the gear's beginning") and the backends disagree
  on where NULLs sort — the same reason `getFitnessGearComponents` splits its own
  list in JS rather than in SQL.
- **Both rollups reuse the stats predicate**
  (`deletedAt IS NULL` + `processingStatus = 'completed'` + `isPrimary`) that
  `getFitnessActivitySummary` uses, so gear numbers line up with the fitness
  overview. A new rollup that filters differently will quietly disagree with
  every other surface. Two deliberate asymmetries: the summary additionally
  requires a non-null `activityType`/`activityStartTime` because it groups by
  them, so a timestamp-less GPX counts toward a gear total and is invisible
  there; and an activity with no `activityStartTime` counts only for a
  component with a period open on that side, since it cannot be placed inside
  `[addedAt, removedAt)`. A gear total may therefore exceed the sum of its
  components.
- **Below 480px the components table snaps one data column per swipe** —
  `useGearTableColumns` (`@/app/(timeline)/fitness/gear/useGearTableColumns`),
  which is the design system's `useGKSnapCols`. It layers on top of the pinned
  first column described above, and only the components table uses it so far:
  the gear list's bikes/shoes/devices tables pin but do not snap, and still
  carry a `min-w-[520px]`. That is a **known gap against the design**, not a
  decision — `GearKit.jsx` runs all four tables through `useGKSnapCols` (150px
  for the three gear tables, 104px for the components one), so on a phone the
  gear list scrolls as one block where the design snaps it, which is the same
  failure `min-w-[720px]` used to cause on the components table. Under the
  threshold each data
  column is sized to the width the pinned column leaves over — floored at 184px
  so the distance cell's wear line still fits, but that floor may only overhang
  the scrollport by the cell's own 12px of right padding, because the column's
  content is right-aligned and `x mandatory` means nothing that hangs off can be
  scrolled to (at a 320px viewport the floor was hiding 6px of the distance) —
  with `scroll-snap-type: x mandatory` and a `scroll-padding-left` clear of the pin,
  so a swipe lands on one whole column instead of stranding a row's values
  halfway across the viewport. The rule measures the table's **own scroll
  container** with a `ResizeObserver`, not the viewport, for the same reason
  `useCompactActionBar` and `FitnessStatGrid` do: a gear table can sit in a
  narrow column on a wide window. It attaches through a **callback** ref, not a
  ref object: the table is conditional (an empty bike renders the empty state
  instead), and a ref object assigned later re-runs no effect, so the observer
  would never reach the table that appears when the first component is added.
- **Do not put `min-w-[720px]` back on the components table.** The per-cell
  minimums already add up to about that, so the class only ever forced the wide
  layout onto phones, where the type column had scrolled away by the third
  column. Note what the threshold does and does not promise, though: between
  480px and ~740px (the seven minimums: 120 + 96 + 132 + 108 + 112 + 88 + 84,
  which moved with the pin when it went to 120px) the table still scrolls as one
  block, exactly as before — the
  difference is that the type column is pinned through it, which is the half
  that was broken. Only below 480px does a swipe move one column.
- **Every cell in the components table carries `wrap-anywhere`.** A `<td>`'s
  width is advisory, and the component type, brand and model are all free text
  to 255 characters (`gearRequests.ts`) — a long unbroken value widens its
  column past the snap interval, and under `x mandatory` a column wider than its
  interval has a tail the scroller can never rest on. `break-words` is **not** a
  substitute: `overflow-wrap: break-word` does not reduce a box's min-content
  contribution, only `anywhere` does, and the difference is invisible in
  Chromium (which honours the explicit width anyway) while breaking elsewhere.
- **Evaluate service reminders only after the activity is `completed`.** The
  rollups count completed activities, so a reminder computed while the file is
  still `processing` reads the total from before the ride that caused the
  crossing — the notification then arrives one activity late, or never if that
  was the last ride on that gear.
- **Batch, don't loop.** `getFitnessGearDistanceRollups` and
  `getFitnessGearComponentDistanceRollups` each answer a whole page in one
  grouped query; the component one puts the install window in the JOIN condition
  (not the WHERE clause) so a component with no matching activity still returns
  a row and counts 0. The window compares `activityStartTime` column-to-column
  against the bounds, which is safe because knex writes all three in the same
  representation per backend — never add raw date arithmetic there without an
  `isSQLiteClient` branch. The component query additionally joins
  `fitness_gear_component_periods` and carries `p.id IS NOT NULL` in the file
  join: a component with no period row is a shape nothing creates, but without
  that clause BOTH window tests read as TRUE against the missing row's NULLs and
  the component claims every activity on the gear
  (`fitnessGearComponentPeriods.test.ts`).
- **`fitness_files.gearId` has no database-level foreign key**, because adding
  one via `alterTable` needs a table rebuild on SQLite. Ownership is enforced in
  `lib/database/sql/fitnessGear.ts`, and `deleteFitnessGear` nulls the column in
  the same transaction that soft-deletes the gear.
- **Match sports through `normalizeActivityTypeToSportKey`**
  (`@/lib/services/fitness-files/sportTypes`), never against the raw
  `activityType`. Gear stores canonical keys; the normalizer maps the dialects
  onto them and returns null rather than guessing, so an unrecognised type
  simply does not auto-assign. Prefer null over a plausible guess: a wrong
  mapping silently attributes activities to the wrong bike.
- **`fitness_files.activityType` is WRITTEN as a canonical activity type**, via
  `normalizeStoredActivityType` in `toActivityData` — the one function all three
  parsers return through, so it covers uploads and the Strava webhook alike (the
  webhook writes its `sport_type` into a generated TCX and parses it back). Four
  vocabularies still arrive at that funnel (FIT `cycling`, TCX `Biking`, Strava
  `GravelRide`, free-form GPX), and rows imported before this rule keep whichever
  one they came in with until `scripts/fitness/normalizeFitnessActivityTypes.ts`
  sweeps them — which is why matching still goes through the normalizer rather
  than comparing strings. Normalized stored types cover the 9 gear sport keys plus
  canonical non-gear activities (`swim`, `training`, `rowing`, `yoga`, `climbing`,
  `ski`, `skating`, `surfing`, `racket_sports`, `martial_arts`, `team_sports`, `golf`,
  and defaulting anything else to `other`). Missing or whitespace-only values normalize to null.
- **Naming a sport for a post caption is `getActivityPresentation`**
  (`@/lib/services/fitness-files/activityPresentation`) — the import job and the
  Strava summary builder both go through it, and nothing else should grow its
  own table. Matching substrings on a raw `sport_type` is exactly what captioned
  a `MountainBikeRide` with the road-bike glyph. It deliberately keeps **gerund**
  labels ("Cycling", "Gravel cycling") separate from `SPORT_LABELS`' UI nouns
  ("Ride", "Gravel ride"): caption text is federated and stored forever, so
  rewording it changes published posts.
- **Caption from the RAW sport, not the stored key** —
  `FitnessActivityData.rawActivityType` carries the source file's own spelling
  beside the canonical `activityType`, and `buildActivitySummary` prefers it.
  The key answers "which bike or which shoes", so it folds `Handcycle` and
  `Velomobile` into `ride` and `VirtualRun` into `run`; a caption is not
  answering that, and "Cycling" erases a distinction the athlete made. Those
  three have their own entries in `SPECIFIC_ACTIVITY_LABELS`, checked **before**
  the sport-key lookup because they do resolve to a key and would never reach
  the unmodelled table. Reading the stored key here made a directly uploaded
  handcycle ride disagree with the same ride imported from Strava, which
  captions from its own raw `sport_type` — guarded end to end in
  `processFitnessFileJob.test.ts`, since a unit test on the presenter alone
  cannot catch a caller handing it the wrong value.
- **A sport belongs to at most one of an actor's gears**, retired ones included
  — scoping the invariant to active gear only would let unretiring produce two
  holders and make auto-assign arbitrary. Claiming a sport takes it off whoever
  had it, inside the create/update transaction. It is enforced by that
  read-then-write rather than by a constraint (`defaultSports` is a JSON text
  column), so two genuinely concurrent creates can both end up holding a sport;
  auto-assign stays deterministic regardless, because
  `findFitnessGearByDefaultSport` resolves oldest-first.
- **Retiring is not deleting and not un-assignable.** Retired gear is out of the
  pickers and out of auto-assign, but stays explicitly assignable so old
  activities can still be attributed to a bike that has since been sold.
- **The activity page carries gear inline in the header's metadata line** —
  `date · visibility · gear`, the way `FAGearRow` does in the design system's
  `ui_kits/web/FitnessActivity.jsx`, not as a labelled field with a row of its
  own — and that line **reports**, it does not edit. The gear is a LINK to its
  gear page for the owner, plain text with the kind's icon for everyone else
  (`/fitness/gear/<id>` is owner-scoped, so a link offered to a viewer would only
  ever 404 — the same constraint `BrandedDeviceLink` resolves the same way on the
  line below it), and nothing at all when no gear is attributed. The lifetime
  distance rides in the link's `title` rather than on the line, which is already
  carrying the date and the visibility.
- **Changing the assignment is "Change gear" in the post's own ⋯ menu**, as
  `FAMoreMenu` has it — a submenu listing each candidate with its lifetime
  distance (what tells two similar bikes apart at a glance) plus a "No gear" row
  that clears it. It reaches the shared `PostMenu` through `Actions`'
  `extraMenuItems`, which can only **add** to the action set (see **Status Posts
  & Actions**), and it is absent entirely for an owner with nothing to pick — a
  submenu whose only entry is "No gear" is dead UI, the same rule that keeps the
  metadata line clear. The submenu trigger is disabled along with its rows while
  the PATCH is in flight, because two quick changes otherwise race and the
  loser's rollback restores a value the server has already replaced; a menu of
  choices none of which respond is worse than one that will not open. A failure
  reports on the metadata line beside the gear it was for, not in the menu,
  which closes itself on select. Whatever is assigned is always in the list even
  when the kind filter or its retirement would drop it: a picker that cannot
  represent its own value renders the assignment as something else, which reads
  as the gear having changed on its own. In a post's inline chip, gear instead
  rides along with the distance cell ("42.6 km · Moots") rather than taking a
  cell of its own.
- **Nothing is imported from Strava's own gear, and no import ever creates a
  gear row.** Neither the webhook path (`activity.gear_id` plus
  `GET /gear/{id}`) nor the archive path (the `Activity Gear` column and
  `bikes.csv`/`shoes.csv`) reads gear from Strava any more, and the
  `stravaGearId` column is gone with them. The reason is `kind`: it was guessed
  from an undocumented `b`/`g` id prefix or from an optional CSV, it is
  immutable by design, and a bike filed as shoes shows no components card,
  refuses a frame type, and offers shoe advice in its reminder — repairable
  only by deleting the gear and detaching every activity on it. So the shed is
  the athlete's alone: an imported activity is attributed exactly like an
  uploaded one, by `processFitnessFileJob` from the gear whose `defaultSports`
  claims the parsed sport. Do not reintroduce a "create the gear we saw" path
  in any importer.
- **The default-sport mapping has a second editor, on the Strava settings
  page** (`StravaGearDefaultsSection`), listing it the other way round —
  activity type → gear — because that is the question someone connecting an
  import source is asking. It is a view over `fitness_gears.defaultSports`,
  **not** a table of its own: pointing a sport at a gear is one PATCH of that
  gear, and the database's own steal takes the sport off whoever held it. That
  is also why the editor re-reads the whole list after every write — the
  response carries only the gear that was written, never the one it was taken
  from.
- **Import jobs assign with `assignFitnessFileGearIfUnset`**, whose
  `whereNull('gearId')` guard is the correctness guarantee rather than an
  optimisation: those jobs re-run, and a manual assignment made between a read
  and the write must survive. Only the owner's own PATCH uses
  `setFitnessFileGear`, which overwrites.
- **Service reminders are evaluated on write, not on a schedule** — this
  instance has no recurring job infrastructure (the queue can delay a message
  but not repeat one). `evaluateGearServiceReminders` runs where a total can
  change and records the distance it fired at in `lastAlertedDistanceMeters`, so
  each crossing notifies once and a raised threshold re-arms on its own.
- **Orange TEXT uses `text-primary-text`, not `text-primary`.** `--primary`
  (`hsl(24 95% 46%)`) is the brand orange for icons, fills and accents; as a
  foreground it is only 3.37:1 on the card, so link text set in it fails WCAG 2.1
  AA (SC 1.4.3) at body sizes. `--primary-text` is the same hue tuned per theme
  until it clears 4.5:1 on every surface such a link sits on — including the
  `--muted` row-hover, which is stricter than the card — darker in light mode
  (37%) and _lighter_ in dark (55%), because on the dark ramp contrast comes from
  going up. This is the split the design system makes itself (`GK_ORANGE` vs
  `GK_ORANGE_TEXT`). It backs the gear list's retired toggle, the gear
  product-page link, and the components card's retired toggle and per-row
  Retire action;
  `app/globals.contrast.test.ts` recomputes both ratios from the live token
  values, so collapsing the two tokens back together fails the suite. Other
  orange text in the app still predates this and should move over when touched.
- **Every gear table pins its first column, through the shared constants in
  `app/(timeline)/fitness/gear/gearUi.ts`** — `STICKY_COLUMN` and
  `STICKY_CLICKABLE_COLUMN`, used by the gear list's bikes/shoes/devices tables
  and by the components table on a gear's page. The design system's
  `ui_kits/web/GearKit.jsx` builds these tables from a pinned first column with a
  hairline down its right edge, and that hairline is the table's structure — it
  is the table's only vertical rule, and it is what separates each row's subject
  from its numbers. Rendered as plain columns with no rule, the rows read as
  loose text, which is what these tables looked like before. Four details are
  load-bearing. **The pinned column's surface is `bg-card` — the same grey as
  the card behind it — not `bg-background`.** This is the design's own
  relationship, verified against the kit: `useGKSnapCols` pins the cell with
  `background: 'white'` and every card holding one of these tables is
  `bg-white/80`, so the lane is painted the **card's** colour and the hairline is
  the only thing separating it. That literal white is there to make the sticky
  cell opaque, not to step the column off anything — there is no recessed lane
  anywhere in the kit. `bg-background` copied the colour rather than the
  relationship and broke it in **both** themes: the kit is a static prototype
  that hardcodes white instead of reading `--card`, while its `app/globals.css`
  carries the same tokens this app has (light `--background` 100% / `--card` 98%,
  dark 3.9% / 9%), so against a `bg-card` table it came out a bright white stripe
  in light mode — a third of the table's width on a phone — and a well sunk below
  the card in dark. Whatever the colour, it must be **opaque**, or the data
  columns
  scroll straight through the pinned cell. The divider is an inset shadow, not a
  `border-r`, because `border-collapse: collapse` (Tailwind's preflight default)
  hands border painting to the table and drops a sticky cell's own right border.
  A dimmed row (retired gear, a retired component) dims its **cells**, never the
  `<tr>` and never the pinned `<td>` itself — `opacity` fades an element's
  background along with its text, so either one takes the pinned column's surface
  down with it. And the hover colour is the OPAQUE `bg-muted` on both the row and
  its pinned cell, never `bg-muted/50`: a translucent hover replaces the cell's
  own surface rather than layering over it, so the cell would turn 50%
  transparent exactly while the pointer is on the row. Rows separate with
  `border-t`, so the header carries no rule of its own and the last row no
  trailing one. The pinned width is not part of the constants — the design pins
  the gear and device tables at 150px and the denser components table at 104px,
  and the components table takes **120px** rather than that 104px because our
  pinned cell is `px-4` where the design runs a flat `px-3`: at 104px the content
  box was 72px and "Handlebar" (72.6px at `text-sm font-medium`) broke mid-word,
  which is what `wrap-anywhere` does to a word that does not fit. 120px leaves
  88px, clear of "Chainrings" at 74.7px, the widest single word in
  `COMPONENT_TYPE_OPTIONS`; multi-word values still wrap at their spaces, and
  fitting "Front brake pads" on one line would take a 149px pin, 38% of a 390px
  phone. Widen the width, never drop the wrap —
  and `STICKY_CLICKABLE_COLUMN` belongs only on a row that has its own `hover:`
  and the `group` class — a row carrying `group` without a `hover:` lights the
  first column alone, and a row with neither never matches the variant at all.
- **A gear's activities are the POSTS they were published as, rendered through
  the shared `Posts` feed.** `GearActivitiesFeed`
  (`app/(timeline)/fitness/gear/[id]/GearActivitiesFeed.tsx`) is the single
  implementation, used by a bike's Activities view and by the whole of a
  device's page, so the same ride reads identically on either — same body, same
  stat chip, same action row as in the timeline. It is not a bespoke list: a
  fitness activity is a status, and **Status Posts & Actions** applies to it
  like every other surface. Two consequences are load-bearing. The feed pages
  over ACTIVITY ROWS and the endpoint answers `nextOffset` from those rows, not
  from the statuses in the page: deleting a status only nulls
  `fitness_files.statusId`, so a row with no post left still occupies an offset
  (and still counts toward the gear's totals), and paging from
  `statuses.length` would re-request everything in between forever. And because
  such a row yields nothing to render, the **Activities tile and the feed may
  legitimately disagree** — the tile counts activities, the feed shows the ones
  still posted. A page that comes back entirely postless is walked past rather
  than handed to the reader as a "Load more" that adds nothing — by the INITIAL
  load as much as by "Load more", both of which go through the same walk,
  because a first page empty for that reason would otherwise render "no
  activities" above an enabled button that disproves it — capped the way the
  bookmarks timeline caps its own continuations. The empty state is therefore
  gated on `!hasMore` rather than on an empty list: the walk makes that state
  rare and `onPostDeleted` can produce it at any time regardless.
- **A bike switches between Components and Activities; shoes and devices do
  not.** The switcher is `SectionNavSelect`
  (`@/lib/components/section-nav-select`), the state-driven twin of
  `SectionNavDropdown` — same chrome, but its rows call `onChange` instead of
  navigating, and the current one is marked with the boolean `aria-current`
  because nothing is a page. Only a bike renders a components card, so only a
  bike has a second view to reach: shoes and devices go straight to the feed,
  since a menu with one entry is dead UI (the same rule that keeps the "No
  gear" picker off an empty shed). Do not write a third copy of this dropdown —
  the fitness activity detail's section nav is the other consumer.
- **Every kind carries a product page, and one component renders it.**
  `fitness_gears.productUrl` is the manufacturer's page for a bike, a pair of
  shoes and a head unit alike, edited in the same "Product page" field of
  `GearFormDialog` and rendered by the one `GearProductLink`
  (`app/(timeline)/fitness/gear/`) everywhere it appears — every gear page and
  the gear list's device table alike. Hostname only ("moots.com", not the whole
  URL), leading `ExternalLink`, `target="_blank"` with
  `rel="noopener noreferrer"`, and an `aria-label` because a bare domain is no
  accessible name. It was device-only and the API 422'd it for anything else;
  that restriction is gone, so do not reintroduce a kind check around it. The
  anchor is gated on `getProductUrlHostname`, never on the string being
  non-empty: it returns null for anything that is not an http(s) URL, which is
  what stops a row written before the API validated the column from rendering a
  `javascript:` href. Two props are what let one component serve every surface:
  `onEdit` makes the empty state the prompt that opens the gear form, and
  without it that state is an em dash (the list has no form to open); `onClick`
  is where a clickable row passes `stopPropagation`, without which the anchor
  opens the vendor's page and the row pushes the gear's route behind it. The
  hostname takes `text-primary-text` — `text-primary` is 3.37:1 on the card and
  fails AA for text. Only a device's is ever pre-filled: `resolveDeviceGear`
  seeds it from the brand map when the import creates the row.
- **A recording device is a third kind, and almost nothing above applies to it.**
  `kind: 'device'` rows have no components, no default sports, no distance
  total, no service reminder and cannot be retired; a device page reports an
  activity count and a first-used date, then its activities.
  The device rollups **replace** `isPrimary` rather than relaxing it, because
  for a device it answers the wrong question: the merge groups files by TIME
  OVERLAP and never looks at the device columns, so which file won says nothing
  about which device recorded it. Two devices on one ride leave two files and
  the non-primary one is the only evidence the second device exists (with
  `isPrimary` it reports 0 activities forever); one device that produced two
  files for one ride — a `.fit` beside a `.gpx`, a manual upload beside the
  Strava sync — also leaves two, and counting both reports one ride twice. The
  rule is therefore per RIDE per DEVICE, not per file: of the countable files
  sharing a `(statusId, deviceGearId)`, exactly one survives — the primary if
  that device owns it, otherwise the lowest id. It is written as "nothing else
  beats me", so it needs no window function and reads the same on both backends.
  It deliberately never defers to a file that is itself uncountable: a merge
  writes the primary `pending` and the secondaries `completed`, so deferring to
  an unfinished (or permanently `failed`) primary would drop the ride from the
  device entirely. The rollup and the activity list apply the identical
  predicate, so the count and the page can only ever differ by an activity whose
  post was deleted — which the rollup still counts and the feed has nothing to
  render for. A head unit records rides and
  runs alike, so one summed distance would be a number with no meaning, and
  claiming a sport would take that sport off the bike or shoes that should hold
  it. `SPORT_KIND` is therefore typed `Record<SportKey, UserCreatableGearKind>`
  and `getSportKeysForKind('device')` answers `[]` with no special case.
- **A device's identity and its display fields are separate on purpose.**
  `fitness_gears.deviceKey` is derived only from what the file recorded
  (`name:<lowercased, whitespace-collapsed deviceName>`, else `mfr:<brand key>`,
  else nothing — and then no row exists), is UNIQUE with `actorId`, and is never
  rewritten. `name`/`brand`/`model`/`productUrl` are the owner's to edit.
  Keying on the name instead would fork a duplicate row the first time someone
  renamed "Garmin Edge 840" to "the Edge", and every later ride would land on
  the new row while the earlier ones stayed on the old.
  `fitness_files.deviceName`/`deviceManufacturer` stay the immutable recorded
  facts; `deviceGearId` is the editable link.
- **`resolveDeviceGear` is the only thing that creates a device**, and it never
  mutates one it finds. It is called by every import path through the shared
  `linkFitnessFileDeviceGear`, which is best-effort throughout: attribution is
  metadata on an activity that has already parsed and stored, so losing it must
  never fail the import. Unlike `assignFitnessFileGearIfUnset`, that write is an
  unconditional overwrite — which bike a ride was on is a judgement the owner
  may correct, while which head unit recorded it is a fact the file states, so
  re-runs converge instead of preserving a stale row. `POST
/api/v1/fitness/gear` rejects `device` with a 422: a hand-made row would carry
  no `deviceKey` and match no upload.
- **Deleting a device releases its `deviceKey` in the same transaction.** The
  `(actorId, deviceKey)` unique index covers soft-deleted rows, so without that
  release the next upload from that device could never create one again — the
  insert would fail against a row nothing can see.
- **`fitness_files.gearId` never points at a device**, and `setFitnessFileGear`
  is where that is enforced rather than in the picker. `gearId` answers "what
  was this ride done on", which a head unit never is, and an activity pointed at
  one falls out of every rollup at once: the device rollups match on
  `deviceGearId` and the distance rollups skip devices entirely, so its distance
  counts toward nothing, `assignFitnessFileGearIfUnset`'s `whereNull` guard
  refuses to auto-assign it ever again, and the status meta line names the head
  unit as the bike.
- **Devices never appear in the activity gear picker**, and the filter that
  excludes them runs BEFORE the kind narrowing in `FitnessStatusDetail`. An
  unrecognised activity type narrows to nothing and offers every active gear, so
  filtering afterwards would put the head unit that recorded the ride in the
  list of things the ride could have been done on. They are excluded from the
  Strava page's default-gear editor for the same reason — and there, also
  because every empty state on it keys on `gears.length`.
- **The device name links to the device page for the OWNER only.**
  `/fitness/gear/<id>` is owner-scoped, so everyone else keeps the branded
  manufacturer link `BrandedDeviceLink` has always rendered — labelled with the
  gear row's name where one exists, since a rename is a rename of the device
  rather than a private note about it. Both render sites (`post.tsx`'s "Via:"
  line and the activity detail's "Recorded with") gate on the gear name OR the
  recorded label, so a device renamed to something the brand map cannot resolve
  does not vanish from the post.
- **A state change is a predicate on the UPDATE, never a decision taken from a
  read in front of it** — that goes for the reminder claim and for the
  retire/unretire toggle alike. Two concurrent requests (two tabs, a retry, any
  API client) would otherwise both read the old state and both write. Where a
  no-op legitimately writes no row, the result comes from a re-read rather than
  the affected-row count, so "already in that state" stays distinguishable from
  "no such gear of yours" — the latter is the route's 404.

## Link Preview Cards

- **A card is cached per URL, never per status.** `link_previews` is keyed by
  `urlHash` (sha256 of the normalized URL) and `status_link_previews` maps a
  status to the card it shows. That split is the whole point: a link doing the
  rounds is fetched once per refresh window rather than once per post that
  mentions it. Do not "simplify" this into a column on `statuses`.
- **A failed fetch is stored, not just logged.** `fetchStatus: 'failed'` with an
  `error` code IS the negative cache — it is what stops an unreachable or
  hostile host from being re-contacted for every post that links it, the same
  trap the remote-actor refresh path avoids by stamping its failures. A failed
  row is never linked to a status, so it can only ever suppress a fetch, never
  render an empty card. Completed cards refresh after 7 days, failures after 1
  hour.
- **A failure goes through `recordLinkPreviewFailure`, NEVER through
  `upsertLinkPreview`.** The row is shared by every status linking that URL, and
  `upsertLinkPreview` writes the whole row — so recording a failure through it
  nulled `title`/`description`/`imageUrl`, and because `getStatusLinkPreviews`
  filters on `completed`, one transient 502 on a weekly refresh blanked the card
  for **every** post linking that page. There was no repair path either: the
  negative cache then suppressed the retry, and nothing sweeps existing rows, so
  an older link lost its card permanently. A row that is already `completed`
  therefore keeps its content AND its status and records only the error; the
  refresh is deferred to the next window rather than retried against a host that
  just failed.
- **The job re-resolves the URL before attaching a card.** An edit enqueues a
  job for the new URL under a different id, so the pre-edit job is still queued —
  and a remote fetch is delayed, which makes "old job lands last" the likely
  ordering rather than the unlucky one. Without the re-check it re-attaches the
  pre-edit card permanently, and it also resurrects a card an edit had just
  removed. `resolveStatusPreviewUrl` is the single implementation both the
  scheduler and the job use, precisely so the two cannot disagree about what a
  status's URL is.
- **A card is only ever for a link the reader can SEE — on both paths.** A card
  is a full-width clickable block carrying an attacker-chosen title, description
  and thumbnail, so a link that renders as nothing is a ready-made phishing
  surface. Remote text is stored raw and sanitized only at render, so extraction
  sanitizes first — parsing the stored HTML directly sees markup the reader
  never will. Then, on BOTH the remote and the local path, a link whose text
  renders to nothing is skipped: no visible text, or hidden by the
  `hidden`/`invisible` classes this app's own renderer uses. Visibility is
  measured on the RENDERED output, never the source string — a markdown link's
  text can itself be HTML (`[<!-- hi -->](url)`) that renders to an empty
  anchor. Hidden-ness is inherited, so an anchor inside a hidden ancestor counts
  as hidden too; without that it came first in document order and BEAT the
  genuinely visible link below it. `<template>` is NOT such a case: the
  sanitizer unwraps it, so that anchor really is on screen and really should get
  the card.
  The extractor's short hidden-class list (`hidden`, `invisible`, and the
  `quote-inline` quote-fallback marker, which every quote-aware renderer hides)
  only works because `sanitizeText` runs first — see the sanitizer rule below.
  As a denylist it would be hopeless.
- **`sanitizeText` allowlists the CLASS attribute, and everything above depends
  on it.** `SANITIZED_OPTION.allowedClasses` reduces `class` on `a` and `span`
  to `ALLOWED_CONTENT_CLASSES` — `h-card`, `p-author`, `u-url`, `mention`,
  `hashtag`, `invisible`, `ellipsis`, `quote-inline` — and `p`, which keeps a
  `class` attribute solely so Mastodon's `<p class="quote-inline">RE: …</p>`
  quote fallback survives to render time, is filtered to `quote-inline` alone.
  That attribute reaches the real DOM:
  `cleanClassName` hands an anchor's class straight to `className` and leaves
  any span class it does not itself rewrite alone. This app compiles Tailwind,
  so without the allowlist every utility in the bundle is a class a remote
  server can spend on our page — `sr-only` is
  `position:absolute;width:1px;height:1px;clip-path:inset(50%)`, enough to
  publish a link into a post that no reader can see, which then wins the
  preview card on document order.
  Three things to keep right when touching it. It is an explicit list, **not**
  Mastodon's `h-*`/`p-*`/`u-*` prefix globs — those are unsafe here because
  `h-*` would admit `h-screen` and `p-*` would admit `p-0`. `hidden` is
  deliberately absent: no fediverse server sends Tailwind's `display:none`, and
  `invisible` is the marker that actually arrives. And
  `SANITIZED_TRUSTED_STATUS_OPTION` must SPREAD this map rather than replace it
  — a tag with no `allowedClasses` entry keeps its class untouched, so
  declaring only `img` there quietly hands `span` and `a` back an unrestricted
  class attribute. `extractUrl.test.ts` pins the allowlist against the
  extractor's hidden-class list, so adding a class fails the suite until it is
  classified as hiding or benign.
- **`convertEmojisToImages` runs BETWEEN the two sanitize passes, so both halves
  of an emoji tag are an injection point.** On the remote path `createNoteJob`
  persists an inbound `Emoji` tag's `name` and `icon.url` verbatim — the AP
  schema asks only for `z.string()` — and this step splices them into HTML that
  the first pass has already approved and the second will keep if the allowlist
  permits it. (The local path is safe by construction: `getEmojiTags` resolves
  `:shortcode:` tokens against this instance's own emoji table.)
  **Four separate things went wrong here, and the shape of the function is the
  fix for all four.** Do not simplify it back toward
  `tags.reduce((t, tag) => t.replaceAll(tag.name, '<img …>'), text)`.
  1. It searches for a shortcode-shaped TOKEN and then looks the name up, rather
     than using the stored name as the search string. A name shaped like
     `<a href="…">` matched the post's own anchor and consumed it; escaping the
     output can never fix a bad search term.
  2. It is a SINGLE pass over the original text. Every replacement writes an
     `alt=":shortcode:"` of its own, so feeding each result into the next let
     one tag match another's output and nest markup inside an attribute.
  3. It substitutes only in TEXT pieces, never inside tags. A `:` survives
     sanitization in an href, so blind substitution rewrote the very link a
     preview card was for — the reader got a corrupted url while the card named
     the original. This one needed no hostile input: an ordinary custom emoji
     plus any link with a `:word:` path segment did it.
  4. The replacement is a FUNCTION, which is what makes `$` literal. A string
     replacement re-reads `$&` and `` $` `` AFTER escaping, so a url carrying
     those spliced raw `<`, `>` and `"` from elsewhere in the post into the src
     attribute — characters `escapeHtml` never saw, because they were never in
     the url.
     `escapeHtml` on the url is still required on top of all four. Raw, a `"` in it
     closed the `src` attribute and made the remainder live markup, enough to wrap
     a link in `<span class="invisible">` that `cleanClassName` renders as
     `display: none` — a preview card for a link no reader could see.
     Keep this at RENDER, not at ingest: it is the one choke point that also
     protects rows already in the database. A rejected tag renders as nothing
     and the literal `:shortcode:` stays in the text.
     **The accepted shortcode shape is deliberately NOT Mastodon's**
     `[a-zA-Z0-9_]{2,}`. That describes what Mastodon mints, not what arrives:
     applying it to inbound tags deleted real emoji from ~2% of a live Pleroma
     and a live Akkoma instance's packs — `:poi-love:` (hyphens, which Sharkey
     allows on purpose), `:c:` and `:3:` (one character, which GoToSocial and
     Misskey permit), `:afiŝo_miaŭ:` (non-ASCII). Pleroma and Akkoma derive
     shortcodes from pack filenames and never validate what they send.
     `toEmojiShortcodeToken` therefore accepts anything up to 64 characters
     that is not a colon, whitespace, or a control/format character, and makes
     the colons optional because Friendica sends the name bare (`"like"`) while
     its body still says `:like:`. `EMOJI_SHORTCODE_REGEX`, used to mint LOCAL
     tags, stays on Mastodon's narrow shape — the two are different jobs.
- **`syncStatusLinkPreview` never throws.** It is called from local create, local
  edit, and the inbound `CreateNoteJob`/`UpdateNoteJob`, and every one of those
  has already written the status by the time it runs. A preview card is
  decoration; losing one must never fail posting or the ingest of someone
  else's post. The whole body is inside one try/catch for that reason.
- **The delay is conditional on the queue, because NoQueue drops delayed
  messages.** Remote fetches carry a random 1–59s `delaySeconds` so this
  instance is not part of a thundering herd on a widely-shared link (the
  "link preview stampede" Mastodon has repeatedly been blamed for). But the
  in-process queue has no scheduler and silently DROPS any message with a
  positive delay, so the delay is only attached when `getQueue().runsInline` is
  false. Attaching it unconditionally does not delay the fetch — it loses it.
- **Extraction runs the WHOLE `processStatusTextContent` and walks its output.**
  Not a rearrangement of its parts — the same function the rendered post, the
  notifications and the Mastodon API all use, in full, for local and remote
  statuses alike. That is the only way to know what the reader sees, and
  every time this ran a subset of the pipeline something got through:
  walking marked's tokens missed hidden ancestors and entity-only link text;
  sanitizing but skipping the emoji step MEASURED TEXT THE RENDERER THEN
  DELETED (`sanitizeTrustedStatusText` serves emoji images over https only and
  drops an img left without a `src`, so a remote `Emoji` tag pointing at
  `http://` emptied an anchor whose `:blob:` had just been counted as its
  visible text — and the card went to that anchor). This is also why
  `extractPreviewUrl` takes `tags` and `resolveStatusPreviewUrl` passes
  `status.tags`; dropping that argument is a one-line edit that silently hands
  back a phishing card, so it has its own test.
  A consequence worth knowing: an anchor whose only content is an emoji image
  gets NO card, because it has no visible text and an emoji image is whatever
  the remote server serves — a transparent PNG included. Erring toward no card
  is the intended direction.
  **Same string, different PARSERS — this is the one gap the shared pipeline
  does not close.** The extractor runs server-side, so `htmlToDOM` resolves to
  `html-dom-parser`'s Node build (htmlparser2, no HTML5 tree construction). The
  reader's `cleanClassName` runs in the browser bundle, where it resolves to
  `template.innerHTML` — full tree construction, adoption agency and all. So a
  nested `<a>`, which htmlparser2 keeps verbatim and a browser hoists out of
  its ancestor, made the OUTER anchor look like it owned text it does not;
  first in document order, it took the card while rendering as an empty clone.
  The precise rule is that an anchor owns only the text BEFORE a descendant
  anchor: the algorithm pops the outer one at the inner one's START TAG, so the
  inner anchor AND everything after it — inline or block — is reparented
  outside. `getVisibleText` therefore stops at the first descendant anchor, in
  document order. Three separate phishing cards came out of getting this wrong:
  counting the inner anchor's text; counting a trailing `" — worth a read."`
  that the reader sees as prose beside an empty anchor; and checking
  hidden-ness BEFORE the nested-anchor stop, so a nest that was itself
  `invisible` (or sat inside an `invisible` span) never tripped it. That last
  one is the rule to hold on to: **hiding is CSS and a parser never reads it**,
  so the restructuring happens whatever the nest wears. `getVisibleText`
  therefore tests for a nested anchor first, and descends into hidden subtrees
  while suppressing their TEXT rather than returning at them — the suppression
  is what keeps Mastodon's `invisible`/`ellipsis` split link working. What it is NOT is "an
  anchor containing an anchor is invisible" — text before the nest survives and
  stays eligible. `sanitize-html` splits a DIRECT `<a><a>` itself, so it takes
  one allowed tag in between to reach this, and all fourteen work.
  If a construction rule other than nested anchors ever matters here, prefer
  giving the extractor a spec-compliant parser over adding a second special
  case.
  Anchors that are mentions or hashtags are rejected by the markers the
  renderer itself emits (`rel="tag"` and the `mention`/`hashtag`/`u-url`
  classes).
  Do not "simplify" the local path back to walking marked's token tree. It was
  written that way and the tokens are the wrong shape for this job three times
  over: marked flattens raw inline HTML into flat SIBLING tokens, so a link
  inside `<span class="hidden">…</span>` has no ancestor to inherit hidden-ness
  from and beat the visible link below it; link text written as an entity
  (`[&#8203;](url)`) reads as non-empty in source while rendering to nothing;
  and a table cell carries its own `header` BOOLEAN, which crashed the walker
  and silently turned every post containing a table into "no links". Rendering
  first removes all three, because the HTML walker inherits hidden-ness and the
  parser decodes entities.
- **Every optional field of the Mastodon `PreviewCard` gets an `''`/`0`
  default.** That schema declares every string field non-nullable and
  `Mastodon.Status.parse` runs once per status inside a handler that catches and
  SKIPS a status it cannot serialize — so a card missing one key does not lose
  the card, it drops the whole status out of the timeline. `getMastodonPreviewCard`
  owns those defaults and `getMastodonPreviewCard.test.ts` pins them.
- **`html` and `embed_url` are always empty.** This server does not consume
  oEmbed, and emitting remote-authored markup for clients to inject is a hazard
  with no upside. If oEmbed is ever added, that is a deliberate decision with its
  own sanitization story — not a side effect.
- **Card text is remote, author-controlled input.** It is stripped of control,
  C1 and bidi characters and truncated at parse time (`siteName`/`authorName`
  are `varchar(255)`, so that cap is a PostgreSQL insert requirement, not a
  preference), rendered as React text nodes and never as markup, its href goes
  through `safeExternalHref`, and its thumbnail is `https`-only and loaded with
  `referrerPolicy="no-referrer"`. The displayed domain is always derived from
  the URL, never from the page's own `og:site_name`, which the page controls.
- **A YouTube link renders a click-to-play player, and the branch reads the URL
  — never the metadata.** `getYouTubeVideoFromUrl` (`lib/utils/youtube.ts`)
  parses `linkPreview.url`, which is the **redirect-resolved final URL this
  server fetched** (`fetchLinkPreview` stores `normalizePreviewUrl(response.url)`),
  so a page can only be treated as YouTube by actually being served from a
  YouTube host. Neither `og:type` nor the stored `type` column is consulted,
  even though `mapCardType` already writes `'video'` for these pages: that
  column is page-claimed, and gating on it would make one URL render two ways
  depending on what a cache entry happened to capture. Hosts are matched
  **exactly** (`youtube.com.evil.example` ends with nothing that matters) and
  the id must be 11 base64url characters — which rejects a percent-encoded PATH
  segment outright, since the pathname is never decoded, while a `?v=` value is
  decoded by `URLSearchParams` first and then has to satisfy the same shape.
  `/embed/videoseries` is refused by name because it is eleven lowercase
  letters that embed a whole playlist; nothing else needs that carve-out,
  because `list` is never carried into the embed URL, so no playlist can be
  framed however it is spelled.
  The feature's entire third-party surface is two fixed hosts, both in
  `csp.ts`: the player is framed from `https://www.youtube-nocookie.com`, the
  only origin in `frame-src` (there was no `frame-src` at all before this —
  `default-src 'none'` blocks every iframe), and the poster comes from
  `https://i.ytimg.com`, which is an **unconditional** `img-src` source rather
  than one of `remoteMediaSources`, so narrowing (or emptying)
  `ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS` cannot blank the thumbnail of every
  video card. `next.config.test.ts` pins that against the emptied allowlist.
  **Nothing loads from the player until the reader presses play** — a live
  iframe per row is a megabyte of player code and a Google request for every
  video that merely scrolled past — and **the card is mounted under a React
  `key` on the video id**, so a card replaced in place is REMOUNTED and cannot
  inherit the previous video's consent and autoplay something nobody clicked.
  Do not delete that key as redundant: the component also remembers which video
  was played, but that alone was the original guard and it was insufficient —
  the remembered id was only ever compared against, never cleared, so it
  defended a change A→B and not a change back A→B→A, which re-entered the
  playing branch with no gesture. A remount clears it in both directions, and
  happens in the same commit, so there is still no painted frame of autoplay.
  `autoplay` is set only on a player the reader mounted, and must be in the
  iframe's `allow` list to reach the frame at all.
  **The facade's focus indicator lives on a child OVERLAY, not on the button**,
  and that is not a style preference — it is the only place it survives. The
  button is flush with the edges of a wrapper that must clip
  (`overflow-hidden`, to round the video's corners), so anything painted
  outward (a plain `ring`, a zero-offset outline) is clipped on the three sides
  that are flush with it and survives only along the bottom, whose edge is
  interior to the wrapper — a full-width 2px line between the video and the
  caption, measured at 1416 pixels against the shipped overlay's 4412. Unusable
  as an indicator, not invisible; do not repeat the earlier claim that it
  measured zero, which was an artefact of the measurement method below.
  Anything painted inward (`ring-inset`, a negative-offset outline) IS
  effectively invisible — 14 pixels — because it paints BELOW the button's own
  descendants, where the full-bleed poster covers its box exactly. The
  indicator is therefore a `pointer-events-none absolute inset-0` span rendered
  as the button's LAST child, which has no descendants of its own to hide it,
  and carries `rounded-t-[11px]` so the wrapper's inner radius does not nip its
  top corners. On that overlay it is an **outline, not a ring**: forced-colors
  mode (Windows High Contrast) drops box-shadows, which left the card's only
  control with no focus indicator at all while the caption link beside it kept
  one. The caption may keep its outline on the element itself, because its
  children are in-flow text that never reaches its padding edge.
  Verify any focus change by COUNTING INDICATOR PIXELS on an element
  screenshot, **with a poster loaded and with `forced-colors: active` as
  well**, never by reading `getComputedStyle` — a box-shadow that is computed
  is not a box-shadow that is painted, and that mistake cost this feature two
  review rounds. Screenshot the WRAPPER, not the focused element, whenever the
  candidate paints outward: an element screenshot cannot see anything outside
  that element's own box, so it reports zero for every outward indicator and
  will walk you into calling one invisible when it is merely clipped. Two more
  traps in the harness:
  Playwright's `page.screenshot({clip})` is page-relative while
  `getBoundingClientRect()` is viewport-relative (use element screenshots), and
  `:focus-visible` will not match a programmatic `.focus()` unless keyboard
  modality was established first. The two anatomies are **separate components** behind
  one exported `LinkPreviewCard`, so React swaps component type rather than
  reordering hooks. The Mastodon `card.html`/`embed_url` stay empty regardless:
  the embed URL is built in the browser, so this is not oEmbed consumption.
- **The card yields to media, a quote or a fitness activity in the UI** — but it
  is still fetched and still served over the API in all three cases, so a client
  is free to decide otherwise. Display policy lives in `post.tsx`, not in the
  fetcher.
- **The kill switch is `network.linkPreviews`, not a `features.*` flag.** The
  `features.*` namespace is navigation-only (its switches are keyed off the nav
  registry and only remove items from navigation); this one gates outbound
  requests to third-party sites, which is what an operator turning it off
  actually cares about. It lives on Admin → Network with the other
  outbound-request settings and has no env var, so the kill switch can never be
  locked shut by the environment. It gates FETCHING only: the cleanup that drops
  a card when an edit removes its link runs either way, so turning previews off
  cannot strand a card on a post that no longer links anything.
- **Known gaps, all deliberate — none of them is an oversight to "fix" by
  bolting on a sweep.** `FetchLinkPreviewJob` is enqueued from exactly one place
  (`syncStatusLinkPreview`, on create and edit), which has three consequences.
  A status whose first fetch failed never acquires a card, because nothing
  re-runs for it — the hour-long negative cache only helps a _later_ status
  linking the same URL. An attached card is never re-read on its own, so the
  7-day refresh only happens when someone posts that link again. And nothing
  ever deletes a `link_previews` row, so the per-URL cache grows without bound.
  These are the shape of a server with no recurring-job infrastructure (the
  queue can delay a message but not repeat one — the same constraint that makes
  fitness service reminders evaluate on write). `link_previews_status_updated_idx`
  exists for the staleness sweep that would close them; until such a sweep is
  written, expect it to be unused.
- **Polls get no card, but only because nothing asks for one.** Neither
  `createPoll`, `updatePoll` nor `createPollJob` calls `syncStatusLinkPreview`;
  everything below that call is already type-agnostic. `StatusPoll` extends
  `StatusNote` so it carries `linkPreview`, and the hydration and `post.tsx`
  both handle any status.
  There IS a storage asymmetry — `createPoll` stores `convertMarkdownText(...)`'s
  rendered HTML where `createNote` stores raw markdown, and `extractPreviewUrl`
  still picks its branch from `isLocalActor` — but it stopped mattering when
  extraction moved to rendering the text and walking the result: marked leaves
  already-rendered HTML untouched, so a poll body run through the local branch
  renders to itself and yields the same URL the remote branch would. Verified
  both ways round. So this is now a one-line change, and the thing to check
  before making it is not the parser but the ordering rule the note actions
  follow — schedule the sync AFTER the poll has published, or on the default
  in-process queue the author waits on a third-party fetch before their poll
  goes anywhere.

## Status Posts & Actions

Every surface that renders a status post — the home timeline, profiles, lists,
favourites, bookmarks, hashtags, collections, search, and the status **detail**
page — MUST render it through the shared `Posts`/`Post` components in
`lib/components/posts`. Do **not** build a bespoke post row or a page-specific
action row: a post offers the **same action set everywhere**, and that
consistency is enforced by keeping the wiring in one place rather than per page.

- **The action set is owned by `Posts`, not by pages.** `Posts` renders the full
  action row (reply, boost, like, bookmark, react) plus the `⋯` menu (quote,
  edit-own, change visibility / who-can-quote, delete-own; mute / block / report
  for other actors; copy link; open original) and wires reply/quote/edit itself.
  `Post` also renders the emoji **reaction chips** as a sibling directly above
  that action row. The chips follow the same `showActions` + `currentActor`
  gate, but degrade rather than disappearing: a reader who cannot react (logged
  out, `showActions={false}`, or a remote custom emoji this instance cannot
  react with) still sees them as read-only labels, and only the toggling is
  withheld. Reactions are **not** favourites and never touch the like button's
  state. A page
  must **not** pass per-status action callbacks (`onReply`, `onQuote`, `onEdit`)
  and must **not** hide individual actions — that per-page drift is exactly what
  this consolidation removed (profiles used to lack Quote/Edit; six feeds had a
  dead Reply button). To turn actions on, a signed-in page passes `currentActor`
  and `showActions`; that is the whole switch. (The lone exception is the status
  **detail** surface, `StatusBox`, which renders a single `<Post>` directly
  instead of through `Posts`; it drives the same shared `useInlineComposer` /
  `InlineStatusComposer` internally — that is the shared layer doing the wiring,
  not a page opting into per-status callbacks.)
- **The chip row and the action row both span the whole status.** Each is pulled
  `-ml-13` — 13 spacing steps, which is the `size-10` avatar column plus its
  `gap-3`, so the pull tracks the root font size the way those two do — and each
  starts at the post's own left edge rather than under the text. The row spans
  the whole status, but its actions are **packed together at that left edge**:
  reply, boost, like, bookmark and react sit in one `gap-1` cluster and only the
  `⋯` menu is pushed to the far right, by an `ml-auto` on its wrapper (`Actions`
  passes it; `PostMenu` merges the class into its root). That grouping is the
  design system's — `ui_kits/web/Post.jsx` in the Design System project puts the
  same `ml-auto` on its `PostMenu`. The **auto margin is what does the work**:
  flexbox gives positive free space to auto margins _before_ `justify-content`
  ever sees it, so the kit's leftover `justify-between` on the row is inert and
  this row simply drops it rather than carrying a class that describes the
  opposite layout. Re-adding `justify-between` therefore changes nothing while
  the `ml-auto` is there — and spreads all five actions across the full width
  the moment it is not, which reads as five unrelated controls. Keep the pair
  as it is.
  Each row owns a separate `fullBleed` prop and the two default **differently**:
  `Actions` pulls unless a caller opts out, while `ReactionRow` pulls only when
  asked (`Post` passes `fullBleed={showsActionRow}`, so chips with no action row
  beneath them line up with the text instead of hanging off it). A surface with
  no avatar column to pull back over ends up with neither — the fitness activity
  detail's card, where each row already sits at its own container's padding
  edge: the chips with the title and the stat grid in the card body, the action
  row with the source-file link in the footer. (Those two containers are padded
  differently, `p-5` against `px-4`, so the two rows are deliberately aligned to
  their own content rather than to each other.)
  Still give the row the **full width** of its container rather than seating it
  beside something else — but note what that now buys and what it does not. The
  spacing between the actions is a flat `gap-1` and is width-independent, so it
  is identical everywhere for free; the full width is what puts `⋯` on the
  post's right edge and gives the edit-history panel's `right-0` the same edge
  to line up with.
  One overlay does not hang off its own trigger: the edit-history panel is
  anchored to the **row** (its trigger's wrapper is deliberately not
  `relative`, so `Actions`' `relative` root is the containing block) and sits
  `right-0`, flush with the post's right edge. Anchored to the trigger it would
  start wherever that trigger lands — which moves with the engagement counts
  beside it now that the actions are packed left — and a 25rem panel from there
  runs past the post, where every card that wraps a post clips it. (Below `md`
  the panel is viewport-fixed and the post's width stops mattering.)
- **The picker that ADDS a reaction lives in the action row, not beside the
  chips** (`ReactionButton`, showing `SmilePlus` + the running total). The chips
  are a read-out; a post with no reactions yet renders no chip row at all. Both
  halves share one `ReactionState` from `useReactionState`, held by whoever lays
  out the post — `Post`, or `FitnessStatusDetail`, which builds its own card and
  therefore calls the hook itself and passes the state into `Actions`. The same
  applies to the bookmark: `useBookmarkState` is held by `Actions` and
  `BookmarkButton` only renders it.
- **A post narrower than 400px moves bookmark and react into the `⋯` menu**
  ("Bookmark" / "React to post", above the menu's own items). The width comes
  from a `ResizeObserver` on the row itself (`useCompactActionBar`), not a
  viewport breakpoint — a post can sit in a narrow column on a wide window.
  That is measured on the row's own border box, **including** the `-ml-13`
  pull, so a surface that turns `fullBleed` off is 52px narrower at the same
  viewport and collapses a little earlier. That is the rule working, not
  drifting: the row genuinely has less room, and collapsing on real available
  width is the whole reason this is not a breakpoint. Expect a band of window
  widths (roughly 466–499px) where a fitness activity's row is compact while
  the same status in the timeline is not. In
  that mode `ReactionButton` stays mounted with `hideTrigger` (it still owns the
  portalled picker), and the picker anchors to the `⋯` trigger, which is why
  `PostMenu` takes a `triggerRef`. A menu item that opens a focus-taking
  surface sets `deferUntilClosed` so it runs from `onCloseAutoFocus`, which also
  suppresses Radix's own focus restore — otherwise that restore lands after the
  panel has taken focus and pulls it straight back to the `⋯` trigger. A menu
  item also carries `disabled` while its own write is in flight: it has none of
  the busy styling the button it replaced had, so a tap during a pending write
  would otherwise be swallowed by the single-flight guard with nothing on screen
  to explain it. Whatever moves into the menu still has to surface its errors
  from the row — `ActionButtonError` is `position: absolute`, so it can anchor
  to the (`relative`) row without putting a flex item back into it.
- **Reply, quote, and edit open one shared inline composer** rendered beneath the
  post — `InlineStatusComposer`, driven by the `useInlineComposer` hook. Reply
  uses the compact `StatusReplyBox`; quote and edit use `PostBox` in the matching
  mode. Never re-implement a composer per page and never route quote/edit through
  a separate top-of-page box. Pass `isMediaUploadEnabled` (from
  `Boolean(mediaStorage)` in the server page's `getConfig()`) so the composer can
  attach media on every surface, not just the home timeline.
- **Pages supply only optional data-sync callbacks** for their own feed state:
  `onStatusCreated` (a reply/quote was created — prepend it if it belongs in this
  feed, otherwise ignore), `onPostUpdated` (an edit — replace the status in
  place), `onPostDeleted`, `onLikeChanged`, `onBookmarkChanged`,
  `onReactionsChanged` (the emoji-reaction rollups for a status changed). These
  mutate the page's own `statuses` copy; they never decide which actions are
  shown.
- **Read-only or logged-out surfaces** pass `showActions={false}` (optionally
  with `showReadOnlyStats` to show non-interactive engagement counts instead — as
  the logged-out landing feed and logged-out profile do). That is the _only_
  sanctioned way to reduce the action set — never omit callbacks to selectively
  hide an action.
- The bespoke fitness activity detail (`FitnessStatusDetail`) and the
  notification snippet (`StatusNotification`) are intentionally separate
  presentations and are outside this contract; everything else goes through
  `Posts`/`Post`. **That licenses a different page layout, not a different
  action row.** The fitness detail lays out its own card and therefore places
  the two halves of the reaction control by hand — `ReactionRow` in the card
  body under the stats, and the picker trigger in the row below — but the row
  itself is the shared `<Actions>` (`fullBleed={false}`, its own
  `useReactionState` passed in), not a local copy. A hand-rolled row is exactly
  how that page drifted into a right-packed cluster with its own gaps while
  every other surface used the shared spacing.
  It now drives the shared `useInlineComposer` / `InlineStatusComposer` too, so
  **Edit and Quote are in its `⋯` like everywhere else** — the composer renders
  inside the header card beneath the action row that opened it. `editable`
  without `onEdit` would only render a menu item that does nothing, so the two
  are wired together or not at all. Reply is the one action it routes
  differently: this page has an always-on composer in its Comments section, and
  the reply action jumps to that rather than opening a second one.
  What is still unwired is `onPostDeleted`/`onLikeChanged`/`onBookmarkChanged`,
  so a delete from the menu leaves the page showing a status that no longer
  exists. That is a **known gap it shares with `StatusBox`**, the non-fitness
  detail page, which wires none of them either — fix it in both or in neither,
  or the two detail surfaces disagree about what deleting a post does.
- **A surface may ADD an item to the `⋯`, never remove or replace one.**
  `Actions` takes `extraMenuItems: PostMenuExtraItem[]`, forwarded to
  `PostMenu`, for an action only that surface knows about the post — the fitness
  detail's "Change gear" is the only one today. An item is either a single
  action or a submenu of pick-one choices (`items`, rendered on the same
  `DropdownMenuSub` as "Change visibility"), and the two shapes are a union so a
  submenu carrying a dead `onSelect` is a type error. They render **after** the
  items a compact row has displaced into the menu (bookmark, react — those were
  in the row a moment ago, so they stay nearest it) and **before** the menu's
  own. There is deliberately no prop for hiding one of the menu's own items;
  that is the per-page drift this whole section exists to prevent.
- **Every author link in a post derives its href from `getActorProfileHref`
  (`lib/components/posts/actor.tsx`), and each one degrades to unlinked
  content where that answers `undefined`.** The three are the avatar
  (`ActorAvatar`), the display name (`ActorInfo`) and the boosted-by line
  (`BoostStatus` in `post.tsx`) — `ActorInfo` and `BoostStatus` fall back to
  plain text, `ActorAvatar` falls back to an unlinked wrapper around the same
  avatar (image or initials) it would otherwise link. A federated
  `preferredUsername` is a bare `z.string()` that `recordActorIfNeeded` writes
  verbatim, so it can normalise to nothing — and the mention built from one
  that does, `@@domain`, is a handle `parseAccountHandle` rejects. `ActorInfo`
  therefore does **not** simply render `getActorDisplayName(actor)` and
  `getActorMention(actor)`: when the username normalises to empty, the
  mention — and so both the href and the muted handle beside the name — falls
  back to the actor id's `handle`/`domain`/`href` tuple, the same one the
  no-actor case has always used, so the link's destination stays in step with
  the avatar beside it. The name is a separate fallback chain,
  `getActorDisplayName(actor) || idParts?.handle || ''`, that checks the
  actor's own `name` first: a named actor with a degenerate username keeps its
  name as the link text even though the mention under it switched to the
  actor id, and only an actor with neither a name nor a usable username is
  named from the actor-id handle too. Before this was shared, the avatar
  linked to `/@booster@domain` while the display name right next to it linked
  to `/@@domain` — a 404 — with **empty** link text, because
  `name || getDisplayUsername(username)` is `''` for the same actor. Covered
  by the matrix in `lib/components/posts/actor.test.tsx`; every case there
  passes against the old code except the degenerate-username ones.

### Post media layout (`attachments.tsx`)

A status's media is **one attachment at its own size, or a horizontally
scrollable strip — never a grid.** `lib/components/posts/attachments.tsx` owns
this for every surface that renders a post, and the shapes come from the design
system's `Attachments` component.

- **A lone picture keeps its own aspect ratio and hugs the post's left edge.**
  Not `w-full`, not `aspect-video`: the old single branch cropped every portrait
  photo to 16:9 across the full content width. It is scaled by **width** —
  `min(100%, round(SINGLE_MAX_HEIGHT * ratio)px)`, capped at the file's own
  pixels so a thumbnail is never upscaled — and never by capping the height of
  an `aspect-ratio` box, which leaves the ratio to be re-derived from a clamped
  axis and is resolved inconsistently across browsers.
- **Two or more pictures are a fixed-height (`STRIP_ROW_HEIGHT`) scrolling row**,
  each item as wide as its own ratio makes it. Four details are load-bearing
  and must not be "cleaned up":
  - `flex-none` on each item is what makes the strip overflow at all. Without it
    the default `flex-shrink` squeezes every item to fit, so
    `scrollWidth === clientWidth` forever: no chevrons, no fade, no peek, no
    scrolling, and every photo cropped. The whole feature turns off silently,
    which is why a test pins the class — jsdom lays nothing out, so nothing else
    at that level can carry the rule.
  - `STRIP_ITEM_MAX_WIDTH` (78%) means no item can fill the strip, so the next
    one always peeks past the edge. That peek is what says "this scrolls" on a
    touch screen, where the back chevron never appears at all and the forward
    one is easy to miss.
  - `scroll-snap-type: x proximity`, never `mandatory`: mandatory snapping pulls
    the peeking item flush with the edge as soon as the scroll settles and
    destroys the affordance the 78% cap creates.
  - The forward chevron is always visible while there is more to the right; the
    back chevron only appears on hover. Going back is worth chrome only once you
    have gone forward — and `pointer-events-none` while it is `opacity-0` is
    part of that, because `opacity-0` alone still hit-tests and `group-hover`
    never latches on a touch screen, leaving a dead column over the leftmost
    photo.
- **There is no 4-item cap and no `+N` overlay.** Everything attached is in the
  strip, because scrolling reaches it. Re-adding a cap hides media the post
  actually carries. Strip images therefore pass `loading="lazy"` to `Media` —
  a photo dump was 4 requests and is now one per photo. A **lone** picture
  deliberately does not: an in-viewport lazy image is fetched at lower priority,
  which is the wrong trade for the post's largest element. `loading` is an
  image-only attribute, so `Media` turns it into `preload="none"` for a video —
  but **only one carrying a `poster`**. A posterless video's sole pre-playback
  frame comes from the `#t=0.01` source fragment, which needs metadata to
  decode, and the strip hides its controls, so deferring one leaves a bare empty
  box. Federated video always lands there: `thumbnailUrl` is written on the
  local-upload path alone.
- **The edge fade is a `mask-image`, not a background gradient.** Posts render on
  four different surfaces — `bg-card` when framed, `bg-background` on the status
  detail, `bg-muted/30` for an ancestor row, and the page itself when unframed —
  so a fade painted in any one token is visibly wrong on the other three, and a
  literal white one is wrong in dark mode everywhere. A mask fades the strip's
  own pixels and lets whatever is behind show through. It lives in
  `buildEdgeFadeMask` rather than inline so the string itself is unit-testable:
  jsdom's CSS parser rejects the two variants carrying `calc()` and stores
  nothing for them, so a RENDERED node can only be asserted against the
  left-edge-only form. Known cosmetic cost: the mask also fades the leading edge
  of a focused item's outline, which is exactly where the browser scrolls a
  Tab-focused item to.
- **A strip item's focus indicator is an `outline` with a NEGATIVE offset, not
  a ring.** Its border box is exactly the strip's height and `overflow-x-auto`
  forces `overflow-y` to compute to `auto`, so an OUTSET ring's top and bottom
  bars fall outside the scrollport and are clipped away. An INSET ring is worse
  rather than better: an inset `box-shadow` paints with the element's
  background, underneath its content, and the button's only child is an opaque
  image filling the whole box — so it is occluded on all four sides and there is
  no indicator at all. An outline with a negative offset is the one form that
  draws inside the border box AND paints above content. The lone picture is not
  inside an overflow container and keeps the ordinary outset ring. (Note
  `MessageBubble`'s media cells carry `focus-visible:ring-inset` over the same
  full-bleed image shape, so their indicator is invisible too — a pre-existing
  bug, not a precedent to copy.)
- **Keeping the chevrons out of the tab order takes BOTH `tabIndex={-1}` and a
  mousedown guard.** They duplicate no function — every picture is a focusable
  button and focusing one scrolls it into view — and each is unmounted by the
  very scroll it performs, so a chevron holding focus drops it to `<body>` on
  its last press and sends the next Tab back to the top of the page (WCAG
  2.4.3). `tabindex="-1"` removes an element from the SEQUENTIAL order only; it
  stays click-focusable, and Chrome and Firefox focus a `<button>` on click, so
  `preventFocusOnPress` cancels the default on mousedown to close the mouse
  path. Deleting either half reopens the failure.
- **Every picture button carries an explicit `aria-label`.** `Media` names an
  image from its `alt`, but `attachment.name` is a required string that
  federation writes as `attachment.name || ''`, so an undescribed photo left the
  button announcing as a bare "button". Use the same wording as
  `ActorMediaGallery`: the description when there is one, `Open media <n>`
  otherwise.
- **Attachments are bucketed by what can actually be laid out in a picture box.**
  `isVisualAttachment` (`lib/types/domain/attachment.ts`, shared with
  `MessageBubble`) selects image and video; `isAudibleAttachment` renders audio
  as left-aligned players below the strip, because an `<audio>` element
  stretched to the row height is not a picture; and anything else — a fitness
  `.fit` file, a PDF — is skipped rather than rendering the empty box the old
  grid gave it. The **lightbox is handed exactly the pictures on screen** and an
  index into that list, never the raw attachment array: passing on what was
  filtered gives `MediasModal` a blank slide, an empty thumbnail and a wrong
  "n of m". Any surface asking "do I have media to show" must ask
  `isRenderableAttachment`, not `attachments.length` — `post.tsx`'s link-preview
  suppression does, so a post carrying only a PDF still gets its link card.
- **A box is always reserved, and `0` means "unknown", not "zero pixels".**
  Several media-storage paths persist `metaData.width ?? 0` and a federated
  `Document` carries whatever the origin sent, so every dimension read goes
  through `getMediaGeometry`; reading `attachment.width` raw collapsed the box
  to 0x0 and the photo vanished from the post. It also clamps the shape to
  `MIN_ASPECT_RATIO`/`MAX_ASPECT_RATIO` — a 10x10000 sliver otherwise rounds one
  axis to zero — and falls back to `FALLBACK_ASPECT_RATIO` when there are no
  usable dimensions, so the blurhash placeholder has something to paint into and
  the strip measures itself correctly before any bytes arrive.
- The scroll affordances come from `useMediaStripScroll`, which measures the
  strip's own container (never a viewport breakpoint — a post can sit in a
  narrow column on a wide window) through a **callback** ref, because the strip
  is conditional and a ref object assigned later re-runs no effect. Same
  doctrine as `useCompactActionBar` and `useGearTableColumns`. Its `contentKey`
  must describe the laid-out **width** of the items, not merely how many there
  are: the observer watches the container, so editing a post to swap a panorama
  for a portrait changes what overflows without changing the container's box,
  the item count or `scrollLeft`.
- The strip hides its scrollbar with the `no-scrollbar` utility, defined in
  `app/globals.css`. Apply it **only to a row that carries its own overflow
  affordance.** It had been applied in the emoji and reaction pickers' category
  rows for a long time while being defined nowhere — Tailwind v4 has no such
  built-in — so it silently did nothing; defining it for the strip would have
  taken the scrollbar, their only overflow cue, off both, and on an instance
  with custom emoji the reaction picker's row is 9 tabs in a 270px scrollport.
  Both were switched back to a plain scrollbar rather than quietly inheriting
  it.

## Status Delete & Unboost Federation

- **The local delete commits FIRST and the `Delete` fans out from
  `SendDeleteNoteJob` afterwards — and that job must never load the status it is
  announcing the death of — and the same holds for `SendUndoAnnounceJob` and the
  Announce it undoes.** `database.deleteStatus` is a cascading hard delete,
  so by the time the job runs the row (and its whole same-actor reply subtree) is
  gone. `deleteStatusFromUserInput` (`lib/actions/deleteStatus.ts`) therefore
  captures the audience before deleting and publishes it in the payload
  (`{ actorId, statusId, to, cc }`), and `getFederatedStatusDeliveryInboxes`
  takes `Pick<Status, 'to' | 'cc'>` rather than a whole `Status` so a caller
  holding only that payload can still resolve inboxes. **Do not "unify" either job
  onto `loadStatusAndActor`**: that is exactly the bug `sendUndoAnnounceJob`
  shipped with — `undoAnnounce` hard-deletes then enqueues, the job bailed on
  `!status`, and no unboost ever federated. Every delivery test in
  `lib/jobs/sendDeleteNoteJob.test.ts` and `lib/jobs/sendUndoAnnounceJob.test.ts`
  uses a statusId that is deliberately NOT in the database for that reason.
- **The dedup id is `getHashFromString(`${statusId}#delete`)`, and the suffix is
  correctness.** The queue deduplicates globally on `message.id` across job
  names, with a window that outlives consumption, and `SendNoteJob` /
  `SendUpdateNoteJob` already publish under the bare `getHashFromString(statusId)`
  — without the suffix, deleting a status posted or edited inside that window is
  silently dropped and never federates.
- **Unboost carries more than the audience, because its activity embeds the
  Announce.** `undoAnnounce` (`lib/activities/index.ts`) builds its object from
  `id`, `actorId`, `createdAt`, `to`, `cc` and `originalStatus.id`, so the job
  payload carries all six and the sender's `announce` parameter is narrowed to
  exactly that shape (`UndoAnnounceTarget`) rather than a whole `StatusAnnounce`
  — the same narrowing trick `getFederatedStatusDeliveryInboxes` uses, and safe
  because the job is the sender's only consumer. Its dedup id is
  `getHashFromString(`${statusId}#undo`)`, matching the emitted `<id>#undo`;
  `SendAnnounceJob` publishes under the bare status id, so without the suffix a
  boost followed by an unboost inside the dedup window drops the `Undo`. It
  keeps `getFollowersInbox` + `filterFederatedUrls` rather than the shared
  delivery helper, because `sendAnnounceJob` resolves inboxes the same way and
  the two must stay symmetric.
- **Both actions wrap `publish` in try/catch on purpose.** The hard delete has
  already committed and cannot be undone, so a failed enqueue must not surface as
  a failed request — that would tell the author their post is still there when it
  is gone (and on the delete path would skip the route's media cleanup). It is
  logged with a stack; remote copies reconcile on their next fetch, which 404s.
  This matters more for unboost than it looks: once the job stopped bailing
  early, the default in-process queue runs the whole fan-out inside that
  `publish`, so a follower-inbox lookup can now throw where it never could.
- Delivery errors never reach that catch: `postActivityToInbox` swallows every
  network failure and returns `undefined`, so the activities `deleteStatus`
  sender does not reject. A test that fails the _socket_ therefore proves nothing
  about the job's per-inbox guard — mock the **sender** to reject, which is the
  only seam that can.
- Known gap, unchanged by the move to a job: a cascaded reply subtree is deleted
  locally but only the top status's `Delete` federates.

## Deleting Media a Post Uses

- **The two media DELETE routes disagree on purpose, and neither is a bug.**
  `DELETE /api/v1/media/:id` is Mastodon-compatible and refuses media a posted
  status uses (`deleteMediaForAccount` answers `in-use` → 422).
  `DELETE /api/v1/accounts/media/:mediaId`, behind the Settings → Media Storage
  button, deliberately allows it, promising "Posts containing this media will
  show a placeholder image". Do not "reconcile" them by making the settings
  route 422 — that revokes a shipped capability. **The promise holds only for an
  attachment that already carries a BlurHash**: `lib/components/posts/media.tsx`
  gates the `<img>` at `opacity-0` until `onLoad` (which a 404 never fires) ONLY
  inside `if (blurhash)`; a falsy one falls through to a bare `<img>`, so a 404
  is a broken-image icon, and once the bytes are gone nothing can compute one.
  Do not dismiss a broken-image report as handled by design.
- **Deleting a `medias` row therefore leaves `attachments.mediaId` pointing at a
  row that is gone, and clearing it would be a regression, not a cleanup.** A
  NULL `mediaId` is how a FEDERATED attachment is stored, and
  `isReplaceableMediaAttachment` (`lib/database/sql/status.ts`) reads exactly
  that to decide an attachment is not the owner's to replace. Nulling it would
  turn a broken attachment the author can still remove by editing the post into
  one that never can be, and destroy the only record that it was backed by local
  media; `lib/database/sql/status.test.ts` → `clears only editable media while
preserving legacy and fitness attachments` pins the surviving-null behaviour.
  Deleting the attachment row instead removes the promised placeholder and
  silently rewrites a published status whose federated copies keep it.
- **The cost is a maintenance sweep that cannot report the gap.**
  `scripts/maintenance/backfillMediaBlurhash.ts` rebuilds an attachment's
  BlurHash, focal point and `thumbnailUrl` from the linked `medias` row, and
  `thumbnailUrl` has no other source — so such a row is selected, counted in
  `processed`, and re-selected forever. It warns per row and reports **two
  counts, never summed**: a gone media row is nothing to act on, while a
  `mediaId` `toMediaRowId` refuses was never a row id, so nothing was deleted and
  it is a bad WRITE from the unvalidated `createAttachment` path that **Database
  Compatibility Guidelines** documents. Not SQLite-only — `-5` and `0` are valid
  `integer`s PostgreSQL stores and `toMediaRowId` still refuses. **Neither count
  partitions `processed`**: a warned row can still be repaired from its own image
  bytes. Any future repair path over `attachments` owes the same signal. Do not
  confuse these two with the THREE the same script's `--revalidate` mode reports
  (repaired/cleared/untouched), which do partition their own scan — different
  pass, different question, and the shapes are deliberately unalike.

## Better-auth Plugin Guidelines

- **Do not register a better-auth plugin unless its required database tables exist** in the Knex migrations. The custom `knexAdapter` does not auto-create tables; missing tables will cause runtime errors.
- **On any better-auth upgrade, diff the schema better-auth declares against ours — do not reason about which new fields are "reachable".** `knexAdapter.create` does a bare `insert(record)` with whatever a plugin put in the record: it creates no tables and filters no columns, so a field a plugin writes and the schema lacks is a failed INSERT, not a degraded feature — and better-auth swallows the driver error into a 500. The better-auth 1.7 upgrade shipped a green suite while **every OAuth sign-in 500'd**, because the oauth-provider plugin had started writing `oauthConsent.requestedUserInfoClaims` (`[]`, not `undefined`, so the factory's `transformInput` does not drop it) and only the core `account`/`jwks` changes had been noticed. `lib/services/auth/schemaCompleteness.test.ts` now asks `getAuthTables(auth.options)` — the real plugin set, with our `modelName`/`fieldName` overrides applied — and diffs it against `migrations/schema.sqlite.sql`, so the next upgrade fails a test instead of an OAuth login. Take that list as the migration's contents. **The CI "Schema Dump Sync" job cannot catch this**: it regenerates the dumps FROM the migrations, so a migration that omits a column still produces a perfectly matching dump.
- **`lib/services/auth/oauthProviderFlow.test.ts` is the only thing that drives better-auth's real OAuth endpoints** (sign-in → authorize → consent → token exchange, against a database built from the committed dump). `app/(nosidebar)/oauth/token/route.test.ts` mocks `getAuth`, so it asserts our proxying and nothing about better-auth. Keep the flow test running all the way to an access token — each step is there for the rows it writes, and stopping at the first 200 skips exactly the INSERTs that break.
- When adding a new plugin (e.g. `sso()`, `dash()`), first create the necessary migration with `yarn migrate:make <name>`, then register the plugin.
- Plugins that expose admin or dashboard endpoints must be configured with explicit access control (e.g. `adminCredentials` or `adminRole`). Never register `dash()` without authentication gating.
- **Every `account_providers` row this app writes directly must carry an `issuer`.** better-auth 1.7's `signInEmail` resolves the credential row by `issuer` as well as `providerId`, so a row without one is invisible to sign-in — the account exists, the password is right, and the response is still `INVALID_EMAIL_OR_PASSWORD`. `lib/database/sql/account.ts` writes those rows itself rather than through the adapter (sign-up, credential provider creation, password reset, password change, provider linking), so each site sets it from better-auth's own `createLocalAccountIssuer` / `createOAuthAccountIssuer` (`@better-auth/core/db`) instead of a literal, and `20260821120000_better_auth_17_columns` backfills the rows that predate the column. Rows better-auth's own adapter writes get it from the schema and need nothing.
- **`knexAdapter` must implement `consumeOne` and `incrementOne` natively — the factory throws rather than synthesising them.** Both are race-safe primitives better-auth relies on for correctness, not speed: `consumeOne` backs single-use credentials (verification tokens, OAuth authorization codes, device codes) and `incrementOne` backs guarded counters (2FA failed attempts, rate limits, an authorization code's remaining uses). What makes each safe is that the mutating statement **re-applies the caller's predicate** alongside the row's primary key, so a racing caller re-evaluates it after the winner commits and comes away with nothing; a plain read-then-write would let both callers through. An empty predicate returns `null` rather than consuming or mutating an arbitrary row — the factory does not guard that itself.

## Better-auth Database Joins

- **`advanced.database.joins` is ON (`lib/services/auth/auth.ts`), and answering every join is `knexAdapter`'s job — the fallback is a slower path, not a free one.** The flag lived at `experimental.joins` until better-auth 1.7 moved it here. On 1.6.x it was an assertion rather than a request: the adapter factory forwarded `join` to `findOne`/`findMany` and read the related rows straight off what the adapter returned (`data[tableName]`), with no capability check and no fallback, so an adapter that ignored a join shape handed back a session with no user, `findSession` turned that into `null`, and **every signed-in user was silently logged out** while sign-in still appeared to succeed. 1.7 checks whether the adapter included the key and falls back to separate queries, which turns that outage into a per-request extra statement. Nothing in the adapter's own unit tests catches either — they call the adapter directly, so they never see the factory's transform. `lib/services/auth/sessionJoins.test.ts` drives the real better-auth instance against a real database and asserts the single statement; keep it passing.
- **A join key is the joined TABLE name, and the returned row must nest under exactly that key.** For this instance's model mapping, `join: { user: true }` on a session arrives as `{ accounts: { on: { from: 'accountId', to: 'id' }, limit: 1, relation: 'one-to-one' } }` — the columns are already resolved, so the adapter uses them as given.
- **Joined columns must be aliased before they are selected.** `sessions` and `accounts` both have `id`, `createdAt` and `updatedAt`; selecting both tables unaliased overwrites the session's own id with the account's, which is a worse bug than the missing join. The adapter selects each joined column as `__j<n>_<column>` and re-nests it — the prefix is short on purpose, because PostgreSQL truncates identifiers at 63 bytes and a truncated alias merges two columns into one.
- **Only `one-to-one` is folded into the base statement; anything else gets a follow-up query.** A `one-to-many` join carries a per-parent `limit` that plain SQL cannot express without window functions, and on `findMany` it would multiply the base rows and break `limit`/`offset`. The follow-up path is also the fallback for a table better-auth's schema does not describe — that path is always correct, so prefer it over a half-working join.
- The joined table's column list comes from better-auth's own schema, which is lossless: the factory's output transform reads only the model's schema fields plus `id` and drops everything else, so selecting exactly those matches what a `SELECT *` would have produced while keeping app-only columns out.
- **Session lookups run `WHERE token = ?` on every authenticated request** — `sessions.token` is indexed (`sessions_token_idx`) for exactly that reason. The older `(accountId, token)` composite cannot serve it: a B-tree led by `accountId` leaves a bare-`token` predicate to a sequential scan. Don't drop the single-column index on the grounds that the composite already mentions `token`.
- **`experimental` was removed outright in 1.7 — it is not a compatible alias for the new key.** better-auth's options type accepts unknown keys, so a stale `experimental: { joins: true }` neither fails to compile nor warns; it just stops requesting joins, and every authenticated request quietly costs a second statement again. Check the option's location against the installed version's `advanced.database` on any better-auth upgrade.

## OAuth Client Registrations

- **Never delete or expire rows in `oauthClient`.** Registrations created through `POST /api/v1/apps` are durable. Mastodon-API clients (Phanpy, Elk, Tusky, …) persist the `client_id`/`client_secret` they get from that endpoint indefinitely and only re-register when their stored copy is **missing** — so deleting a registration permanently wedges every client still holding it: it keeps presenting a `client_id` this server no longer knows and has no way to learn it must register again. A time-based cleanup does not help, because any finite TTL eventually deletes a live cached client. Mastodon hit exactly this and **removed its own application "vacuuming" in 4.3**. (A 24h "stale registration" collector used to live in `createApplication.ts` and broke Phanpy sign-in for this reason — the failure surfaced as `invalid_client` / `client_id is required`.) The trade-off is that abandoned registrations accumulate: `createApplication`'s per-source throttle only engages when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is set, so a default deployment does not bound them. Accept that, or add a guard that **rejects writes** — never one that deletes registrations.
- **A registration must write `oauthClient.clientCredentialsScopes`, and that is not the same column as `scopes`.** better-auth 1.6 validated a `client_credentials` request against the client's registered `scopes`; 1.7 moved the decision to this separate, server-owned column and denies the grant outright when it is missing or empty — `400 unauthorized_client` / `client has no authorized client_credentials scopes`. The column arrived with the 1.7 schema migration and nothing ever wrote it, so every application on the instance was refused an app token — and a native Mastodon client asks for one **before** it offers to sign a user in (Ivory does, with the credentials `POST /api/v1/apps` just handed it), so the login never started and the only sign of it was that 400 in the token proxy's log. `createApplication` writes the column through `toClientCredentialsScopes` (`lib/services/oauth/clientCredentialsScopes.ts`); that module documents the derivation rule, why its reserved-scope filter is the only thing enforcing it on this path, and how it differs from 1.6 — read it there rather than re-deriving it, and do not simplify the filter away. Fixing the write path is **not sufficient on its own**: registrations are never deleted and clients cache their credentials indefinitely (see the bullet above), so every client already installed would stay wedged — `20260828000000_backfill_oauth_client_credentials_scopes` repairs the existing rows, carrying a second copy of the reserved list because a migration runs through the plain `knex` CLI with no TypeScript loader and no path aliases (`lib/database/sql/oauthClientCredentialsScopesMigration.test.ts` pins the two against each other), plus two gates of its own that refuse public clients and clients not registered for the grant. This grants no new authority: an app token has no user, so only `OAuthAppGuard` accepts one — `apps/verify_credentials` and Mastodon's API account registration, itself gated on `registrations.open` — and every other guard requires an actor that an actor-less token never resolves.
- **An app token lives one hour, not the 7 days `accessTokenExpiresIn` configures.** `createUserTokens` reads `m2mAccessTokenExpiresIn` for a grant with no user and this server does not set it, so better-auth's 3600s default applies. Unrelated to the scope ceiling above; it is the other thing about app tokens that reads wrongly from `auth.ts`.
- **An unknown `client_id` must fail at `/oauth/authorize`, not be forwarded to Better Auth.** Better Auth's authorize endpoint answers an unregistered client with `invalid_client` / **`client_id is required`** — the same message it uses for a genuinely absent `client_id`, which makes the failure very hard to read — and then redirects to the error page, so a failed login used to look like it silently did nothing (before `onAPIError.errorURL`, better-auth's own `/api/auth/error` 302'd straight on to the home timeline in production — see **Auth Error Page** below). `app/(nosidebar)/oauth/authorize/page.tsx` validates the client (and its `redirect_uri`) up front and returns `notFound()`; keep that check ahead of the Better Auth delegation. Per RFC 6749 §4.1.2.1 an invalid `client_id`/`redirect_uri` must be reported to the user rather than redirected to the requested `redirect_uri`.

## Auth Error Page

- **Failed auth/OAuth requests land on our own `/auth/error`, never better-auth's `/api/auth/error`.** `lib/services/auth/auth.ts` sets `onAPIError.errorURL` to `AUTH_ERROR_PATH` (`lib/services/auth/constants.ts`), and `app/(nosidebar)/auth/error/page.tsx` renders it. Better-auth's built-in page is a development affordance: in production it does not render at all — it 302s to `/?error=...&error_description=...`, so a client presenting a `client_id` this server no longer knows just landed on the home timeline and its sign-in appeared to do nothing.
- **`AUTH_ERROR_PATH` is root-relative on purpose.** Better-auth copies the value straight into the `Location` header (`ctx.redirect` and `formatErrorURL` do no resolution), so a relative path keeps the visitor on the host the request arrived on. An absolute URL built from `getBaseURL()` would bounce a login started on a trusted alias domain over to `ACTIVITIES_HOST` mid-flow, the same trap `/oauth/authorize` avoids by building its sign-in redirects from the request host.
- **Never render `error_description`, and render the `error` code only when it is allow-listed.** Both are free text better-auth puts in the query string, and anyone can hand-craft a link to `/auth/error` with any value in either — prose we did not write, shown on our own auth card, is a ready-made phishing surface. Token-shaped is **not** sufficient: `?error=Account-locked-please-call-1-800-555-0100` clears `sanitizeAuthErrorCode`'s character class and 64-char cap while reading as ordinary prose, so the technical-detail line is gated on `isKnownAuthErrorCode` (`lib/services/auth/errorPage.ts`), never on `sanitizeAuthErrorCode` alone. Copy comes from `resolveAuthErrorContent`, with generic fallback copy for anything unmapped. **The allow-list gates rendering only — never logging.** Both the code and the description are logged whatever the code is. Allow-listing bounds nothing in the log (a caller can pair any description with a mapped code; the 200-character description cap and 64-character code cap are the real bounds), and an unmapped code is the case the description matters _most_ for: better-auth's own `/error` endpoint rewrites any code it cannot classify to `UNKNOWN` while forwarding the real description verbatim, and an upgrade can add a rejection we have no copy for. Gating there would blank the description for exactly those, and blunt the tell a description carries: every oauth-provider rejection passes one, so a missing description on an authorize-time code suggests a hand-crafted link — a tell that holds for that class only, since core's `INVALID_TOKEN` redirect legitimately carries none. Codes are looked up with `Object.hasOwn` — a bare lookup answers `constructor`/`toString` with an inherited function, which is truthy and would render an empty card.
- **The redirect behaviour is pinned end-to-end by `lib/services/auth/errorURL.test.ts`**, which drives the real better-auth handler against in-memory SQLite and asserts the `Location` header — not the shape of `auth.options`. Assert with `startsWith`, never `toContain`: the untouched default `/api/auth/error?…` _contains_ `/auth/error?…` as a substring and would pass with the option removed.
- **Do not add `onAPIError.onError` expecting it to see these failures.** Better-auth's router short-circuits `onError` for anything it redirects (`if (isAPIError(e) && e.status === 'FOUND') return`), which is exactly this class of error, and setting `onError` at all suppresses better-auth's own built-in logging. The error page logs what it renders instead.
- **`access_denied` and `invalid_scope` do not come here.** Both are reported to the client's `redirect_uri` (`formatErrorURL(query.redirect_uri, …)`, with no `getErrorURL` call site for either) per RFC 6749 §4.1.2.1; they are mapped on the page only for a client that forwards the code back by hand. Keep `auth.ts`'s comment and `errorPage.ts`'s map agreeing on which codes are actually reachable.
- **If `socialProviders`, `sso()` or `genericOAuth()` are ever added, also pass `errorCallbackURL` per flow** (`authClient.signIn.social({ provider, errorCallbackURL: '/auth/error' })`). `onAPIError.errorURL` is only the default for provider-callback failures; the per-call value is persisted in the OAuth state and wins over it. This instance configures no social providers today, so that path is currently unreachable.

## OAuth Grants Must Resolve an Actor

- **Every OAuth grant issued for a user must record an actor, and every code path that resolves "which actor is this account?" must use `selectAccountActor` (`lib/utils/selectAccountActor.ts`).** Better Auth stores the value `postLogin.consentReferenceId` returns as `oauthAccessToken.referenceId`, and `OAuthGuard` reads that column back as the acting actor — so a grant that resolves to nothing mints a token that **401s on every bearer-authenticated route**, `/oauth/userinfo` included, which fails an OIDC login outright (the relying party 500s on the userinfo call, and the user just bounces through the login loop).
- `accounts.defaultActorId` is **not** a reliable answer on its own: it is only written when a user explicitly picks a default actor, so most accounts have `NULL` there while still owning actors. `resolveConsentReferenceId` (`lib/services/auth/consentReferenceId.ts`) therefore falls back the same way the browser session does — session `actorId`, then default actor, then the first actor not pending deletion.
- This failure is **invisible on a first login and permanent afterwards**: approving the consent screen persists the session actor first (via `/api/v1/actors/switch`), so the initial grant works. Once consent is stored, Better Auth stops showing the consent screen, and every later login on a fresh session issues an actor-less token. Any change here must be exercised with a **second** login, not just the first.
- `OAuthGuard` keeps a matching fallback: a token with a `userId` but no `referenceId` resolves that account's actor rather than failing closed, so tokens issued while a grant was broken recover without the client re-authorizing. Genuine app (`client_credentials`) tokens have neither a user nor an actor and stay actor-less.
- Guard rejections log a `reason` through `oauthLogger` at **debug** level (`token_expired`, `insufficient_scope`, `no_actor_for_token`, …). Bearer failures are otherwise indistinguishable in production — every one is a bare 401. Set `LOG_LEVEL=debug` to tell them apart, and keep new rejection branches logging a reason. Never log the token.
- **A handler asks whether a token is an APP token by reading `userId`, never `currentActor`.** `OAuthAppGuard` leaves `currentActor` null in two unrelated cases: a genuine `client_credentials` token that has no user, and a user-delegated token whose actor it merely FAILED to resolve — the grant recorded no `referenceId` (see the fallback above) and `resolveAccountActorId` found no selectable actor, which happens when every actor the account owns is pending deletion (`selectAccountActor` skips those). `registerViaApi` gated on `currentActor || !client` and so accepted that user as an app, letting them mint accounts and tokens. The guard therefore forwards `userId` on the handler context, and the route requires `userId === null`; a genuine app token has neither a user nor an actor. Do not re-derive "is this an app token" from the actor.

## An Unconfirmed Account May Not Act

- **An account whose confirmation e-mail has not been clicked is refused with 403 on every surface behind the OAuth guard family, `AuthenticatedGuard`, and `AdminApiGuard` — bearer and cookie alike — and `isActorConfirmationPending` (`lib/services/guards/OAuthGuard.ts`) is the check.** This is Mastodon's `require_user!` rule ("Your login is missing a confirmed e-mail address"), and it matters because `POST /api/v1/accounts` hands out a real 7-day user access token the moment an account is registered. `POST /api/v1/apps` is unauthenticated and its throttle only engages when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is set, so without this an anonymous party could script fully usable accounts — posting, uploading, following, federating — for addresses nobody has proven they control. **The gate exists only where `config.email` does:** with no e-mail configured `registerAccount` mints no `verificationCode` and `createAccount` writes the account pre-verified, so registration still hands out a working token exactly as before. That is inherent — an instance that cannot send mail cannot demand confirmation — but it means this mitigation is conditional on an optional setting. The token is still issued, exactly as Mastodon issues it; what changes is that it is not a working credential until the address is confirmed. `OAuthGuard`, `AuthenticatedGuard`, and `AdminApiGuard` enforce `isActorModerationBlocked` and `isActorConfirmationPending`, answering 403 when an actor is suspended or its account is disabled or unconfirmed.
- **Confirmation is read from `verificationCode` AND `emailVerified`, never from `verifiedAt`, and none of that is a style choice.** `verificationCode` says a code is outstanding; `emailVerified` is better-auth's own column, which `requireEmailVerification` has gated credential sign-in on since 2026-03-20. An account better-auth already treats as verified is not held pending here either — that grants nothing new and is what grandfathers the cohort the buggy backfill created (below). `accounts.verifiedAt` originally carried `DEFAULT CURRENT_TIMESTAMP` (`20230824181927_add_accounts_verification`, dropped in `drop_accounts_verifiedat_default`), so `createAccount` could not leave it unset by omitting it: the database stamped `now()` on every pending registration, and `canCreateSessionForAccount`'s `verifiedAt` test has consequently **never fired**. A check keyed on `verifiedAt` is a no-op that reads as a working gate. `createAccount` now writes an explicit `verifiedAt: null` for a pending registration, so that column is accurate for anything created from here on — but rows written before that still carry the default, so `verifiedAt` covers nothing on its own and the other two columns carry the whole answer. `verificationCode` is set once at registration, cleared to `''` by `verifyAccount`, and never set at all on an instance with no e-mail configured.
- **The credential sign-in path was never open FOR AN ACCOUNT REGISTERED AFTER 2026-03-20, which is why this is mostly a token-path fix.** better-auth's own `emailAndPassword.requireEmailVerification` reads `accounts.emailVerified` — a different column, which `createAccount` correctly leaves false — and answers `403 EMAIL_NOT_VERIFIED`. **Older accounts are the exception, and it is not a small one:** `20260320072514_better_auth_columns` populated that column with `whereNotNull('verifiedAt')`, and `verifiedAt` was non-null for every row because of the same default, so the backfill declared EVERY account of that era verified — pending ones included. Those accounts have been signing in with a password ever since. That cohort is grandfathered by the predicate itself, which reads `emailVerified`, so the guard never refuses an account that has worked for months. `20260828140000_clear_stale_verification_codes` then brings the two columns into agreement so a reader of the row is not misled — it is a TIDY-UP, not the mechanism, and its bound decides only whether a stale row is tidied, never whether anyone keeps access. Two earlier attempts to make that bound the mechanism were wrong in opposite directions (a filename timestamp no deployment coincides with; then a batch comparison that is also true whenever the migration is merely first in a new pass), which is why the predicate carries it instead. Do not read the sentence above as covering the whole account table. Both columns are on the domain `Account`, and the guard reads both — that pairing IS the mechanism, not an accident to be simplified away. Removing `emailVerified` from either the schema or the predicate re-locks out the cohort with no way back, which is why this is written as an instruction rather than a description.
- **`unconfirmedAccount: 'allow'` is the one carve-out that lets an unconfirmed account act AS ITSELF, and it exists for exactly one endpoint.** `POST /api/v1/emails/confirmations` resends an account's own confirmation e-mail, so refusing it for being unconfirmed makes the state unrecoverable for a client that lost the message — Mastodon carves out the same controller (`Api::V1::Emails::ConfirmationsController` never calls `require_user!`). It relaxes the confirmation test and **nothing else**: `isActorModerationBlocked` still runs, so a suspended actor or a disabled account is refused there too, and the handler applies `isAccountConfirmationPending` itself. That handler check must be the PREDICATE, never the raw `verificationCode` column: the two disagree for the backfilled cohort, and because this route is bearer-reachable with `write` while the flow that proves an address is cookie-only, reading the raw column let a client token re-point a confirmed account's address and take the account over. The guard admits any account here; the handler alone decides, on the signal every other surface uses. Do not add a second consumer without the same argument.
- **`allowModerationBlocked` is the carve-out on `AuthenticatedGuard` for restrictive session and connected-app revocations.** `DELETE /api/v1/accounts/sessions`, `DELETE /api/v1/accounts/sessions/[token]`, and `DELETE /api/v1/accounts/connected-apps/[clientId]` pass `allowModerationBlocked: true` so a legitimate account owner can terminate attacker sessions and revoke authorized OAuth apps during compromise containment even if the account is disabled or an actor is suspended. Revocation only ever _reduces_ capability (destroying sessions and tokens) and cannot post, follow, or federate on the platform. It relaxes `isActorModerationBlocked` only; CSRF same-origin proof and `isActorConfirmationPending` remain strictly enforced (unconfirmed accounts are still refused with 403).
- **Account-level actor endpoints (`actors/switch`, `actors/cancel-deletion`) authenticate the session's account directly rather than fronting an arbitrary `currentActor`.** `POST /api/v1/actors/cancel-deletion` operates on the target `actorId`, so gating on the session's selected actor would 403 whenever another actor on the same account is suspended (and fail if the only active actor is pending deletion). Like `switch`, it validates same-origin CSRF proof, resolves the account via `getAccountFromSession`, enforces `isAccountConfirmationPending`, and checks that the account owns `actorId`.
- **`OptionalOAuthGuard` neither refuses nor accepts such a token — it DOWNGRADES it to the anonymous path** (`unconfirmedAccount: 'anonymous'`), which is a third answer and not a second use of the carve-out. Both alternatives are wrong there. Refusing made presenting a valid token FAIL a public read — `timelines/public`, `statuses/:id`, search — that succeeds with no `Authorization` header at all; a token must never make a request worse than sending none. Accepting the actor hands an unverified account real capability rather than "just public reads": `canActorReadSingleStatus`'s `isDirectRecipient` lets it read direct messages addressed to it, and `search`/`accounts/lookup` gate `resolve=true` on a non-null actor, so it can drive outbound WebFinger and signed remote fetches from this instance. **Mastodon is not a precedent for granting those** — its search controller applies `require_user!`, so an unconfirmed account never reaches `resolve` there, even though `authorize_if_got_token!` is otherwise the model for this guard. Suspension stays global on the same guard, so `isActorModerationBlocked` still refuses.
- **The check costs no query.** `verificationCode` is already on `actor.account` in both resolution paths — `getActorFromId` loads the account row for the bearer path and `getActorsForAccount` does for the cookie path — which is the same reason `isActorModerationBlocked` can read `account.disabledAt`. An actor with **no** account is left alone, the direction `isActorModerationBlocked` also fails in; the only accountless local actor is the federation signing actor, which never authenticates.
- **`Account.verifiedAt` is `.nullish()`, not `.optional()`, and `SQLAccount.verifiedAt` is nullable to match.** Both row-to-domain mappers hand the column through as a literal `null` (`getActor` writes one explicitly; `toDomainAccount` spreads the raw row, whose conditional override is a no-op for null), so under `z.number().optional()` `Actor.parse` threw the moment the column really was null — the first request by an unconfirmed actor would have 500'd rather than loading. The column default is what had been hiding that.
- **Existing accounts are grandfathered by the PREDICATE — `isAccountConfirmationPending` reading `emailVerified` — not by the migration and not by leaving `verifiedAt` alone.** Nothing backfills `verifiedAt` — so on its own the `verificationCode` half of the check still reaches every legacy pending account, and for the pre-2026-03-20 cohort described above that meant losing a working password login with no way back (the resend endpoint needs a credential, which is what is being refused). `isAccountConfirmationPending`'s `emailVerified` half is what actually grandfathers them; the migration only tidies the row. For an account registered after that date, the only tokens the gate withdraws are ones minted through the hole being closed — `registerViaApi` is the sole path that mints a user token for an unconfirmed account, since credential sign-in is refused and the authorize flow needs a session.
- **The `verifiedAt` column default is dropped (`drop_accounts_verifiedat_default`).** The migration uses knex `.alter()`, which rebuilds the table on SQLite. All **seven** tables carrying a foreign key to `accounts` on both backends (`actors`, `oauthClient`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent`, `passkey`, `twoFactor`) and all four indexes on `accounts` are preserved across the rebuild (`dropAccountsVerifiedAtDefaultMigration.test.ts` pins column definitions, FK preservation, cascade rules, and index preservation). Count these referencing tables by matching case-insensitively and on both quoting styles: `actors` is emitted as `CREATE TABLE IF NOT EXISTS "actors"` with uppercase `REFERENCES`, so a grep written for backticks and lowercase silently reports six. Existing rows were deliberately NOT backfilled: accounts created before the explicit-null fix keep their defaulted value so confirmed status is not altered retroactively.

- **A re-point clears every proof about the old address, in the same write.** `repointUnconfirmedAccountEmail` writes the rotated code, `emailVerified: false`, `verifiedAt: null` and `emailVerifiedAt: null` together, because each proves control of the address it was set for and none may outlive it. The state change is a predicate on the UPDATE statement (`verificationCode` non-empty, `emailVerified` false/null) rather than a decision taken from a read in front of it, and the method re-reads the row to return `Account | null` so the caller distinguishes "no such account of yours" (404) from "no longer pending" (403). Clearing the code alone is not enough for the backfilled cohort: those rows are not pending (the predicate reads `emailVerified`), so a re-point moved their address to an arbitrary one while they stayed verified, and BOTH OIDC surfaces then asserted a verified address to any relying party that links accounts on the claim. They did so by different routes, and the difference is the whole reason clearing the flag works: the id_token (`lib/services/auth/auth.ts`) reads `emailVerified` and asserted it directly, while `/oauth/userinfo` read `verifiedAt` until round 6 moved it — so it was never the flag that made that route answer, it was that such a row is NOT pending (`Boolean(code) && !emailVerified` is false while the flag stands), so the guard admitted the request at all. Clearing the flag closes both: it makes the account pending, and `isActorConfirmationPending` then 403s before the serializer runs. Do not read "userinfo did not read the flag" as "userinfo was unaffected" — that inversion was written here once and is what this sentence replaces. Two costs are named rather than hidden. The confirmations route writes before it sends and answers 500 on a send failure, so a genuinely pending account whose mail fails at that moment must resend to recover. (A backfilled-cohort account cannot reach that write at all — the handler 403s it — so this cost is not theirs.) And `verifyAccount` restores `verifiedAt`, `emailVerified` and `emailVerifiedAt` when the new address is confirmed, so an account that re-points an unconfirmed address recovers every verification proof — including the `/account` "Verified" badge — upon confirmation.

## Testing Guidelines

- Vitest is configured via `vitest.config.ts`. The project is ESM-only
  (`"type": "module"`), so tests run as native ES modules. Use the Vitest API
  (`vi.fn()`, `vi.mock()`, `vi.spyOn()`, …) — do not write `jest.*` calls. (A
  minimal global `jest` proxy exists only as a compat shim for third-party
  libraries like `jest-fetch-mock` — see `vitest-shims/jest-global.ts` — and
  must not be relied on in first-party tests.) The `jest.Mock` /
  `jest.MockedFunction` / `jest.Mocked` **type** names still work via a
  compatibility shim in `vitest.d.ts`.
- **The suite's clock is pinned to `TZ=UTC`** (`vitest.config.ts` → `test.env`).
  CI already runs in UTC, so before the pin a date assertion that only held
  there passed review and then failed on the first developer machine set to
  anything else. The pin is a backstop, not a licence: a formatter whose output
  must not depend on the viewer's zone still has to say `timeZone: 'UTC'`
  itself, because production is not running under the pin. The bug that
  prompted it — an `<input type="date">` value (parsed as UTC midnight) read
  back through a local-time `Intl.DateTimeFormat` — rendered a day early in
  `America/Los_Angeles` and a day late in `Asia/Tokyo`.
- The Vitest default environment is `node`. Any test that renders React or
  touches the DOM must start with a `/** @vitest-environment jsdom */` docblock
  (Vitest 4 removed `environmentMatchGlobs`, so there is no glob-based opt-in);
  jsdom tests get `http://localhost:3000` as their URL via
  `environmentOptions`. A `.test.tsx` without the docblock fails with
  "document is not defined".
- `vitest.setup.ts` installs global mocks that apply to EVERY test: the
  `@/lib/config` barrel (host `test.llun.dev`, in-memory SQLite — a new barrel
  export must also be added to the setup-file factory and
  `lib/config/__mocks__/index.ts`, or every test that hits it fails with
  "x is not a function"), `got`, `node:dns/promises`, and `fetch` via
  jest-fetch-mock's global `fetchMock`
  (passthrough by default — call `fetchMock.doMock()` / `mockResponse…` to
  stub). It also installs a jsdom-only guard on `HTMLElement`/`SVGElement`
  `focus()` that caps synchronous re-entry depth: jsdom fires focus events
  synchronously, so Radix UI's `FocusScope` (DropdownMenu, Dialog, …) can
  re-enter `focus()` without settling and overflow the stack with "Maximum call
  stack size exceeded" when a menu closes as a dialog opens. Real focus flows
  never nest that deep, so normal `focus()` / `document.activeElement` behavior
  is unchanged.
- CI (`.github/workflows/ci.yml`) runs lint + prettier-check, **type check**,
  build, four parallel test shards aggregated into an `All Tests` step, and
  Schema Dump Sync (regenerates the SQLite schema dump from the migrations and
  fails on drift) on every push and PR. Branch protection on `main` requires
  exactly three status checks — `Lint and Prettier`, `Build`, `All Tests` — not
  the `CI Success` aggregate job; `Schema Dump Sync` and `Type Check` are **not**
  required checks, so a red **Type Check** currently blocks nothing at merge
  time even though it is the only gate covering `*.test.ts(x)`. Adding
  `Type Check` to the required list is a repo-settings change a maintainer has
  to make; until then, treat it as advisory and check it by hand before
  merging.
  The test job pins `TEST_DATABASE_TYPE: sqlite`; `lib/database/testUtils.ts`
  also supports `TEST_DATABASE_TYPE=pg` (with `TEST_DATABASE_HOST` /
  `TEST_DATABASE_USERNAME` / `TEST_DATABASE_PASSWORD`; the port is fixed at 5432) for running the suite against a throwaway **local** PostgreSQL. In that
  mode each Vitest worker drops and recreates its **own** database named
  `test_<VITEST_POOL_ID>` — a single shared database would let one worker
  destroy the schema another worker is mid-test on. The schema loader also has
  to `RESET search_path` on the connection it loads `migrations/schema.sql`
  into, because pg_dump's leading
  `SELECT pg_catalog.set_config('search_path', '', false)` is session-scoped and
  would otherwise leave that pooled connection unable to resolve any unqualified
  table name for the rest of its life.
- **`getTestSQLDatabase` and `getTestSQLDatabaseWithInstance` are SQLite-ONLY
  and ignore `TEST_DATABASE_TYPE` entirely.** A suite built on either reports a
  clean pass under the pg environment variables having never opened a PostgreSQL
  connection — which is a trap, not a nuisance: three review rounds of one PR
  reported its job suite "verified on PostgreSQL 17" on exactly that basis.
  `getTestDatabaseTable()` (for a `describe.each` over backends) and
  `getTestDatabaseWithInstance()` (for a suite that is not shaped that way, or
  that needs the raw Knex instance) do honour it. When a claim about
  cross-backend behaviour matters, verify it by pointing `TEST_DATABASE_HOST` at
  an unreachable address first: a suite that still passes is not running where
  you think it is.
- **To grab a mocked module and configure it, use `vi.importMock<T>('@/path')`,
  not `(await import('@/path')) as unknown as T`.** `vi.importMock` is the
  Vitest equivalent of the old `jest.requireMock`: it is purpose-built, always
  returns the mock, and is typed as `MaybeMockedDeep<T>` so no `as unknown as`
  cast is needed. A bare `await import()` returns the **real** module unless it
  is separately `vi.mock`'d, and forces a type-erasing double-cast. `vi.importMock`
  **is** a valid, documented Vitest API — some review bots incorrectly claim it
  does not exist; do not "fix" it on their say-so.
- **"Always returns the mock" stops holding the moment a factory AWAITS
  `importOriginal()`** — which is exactly what keeping part of a module real
  requires. The trigger is that call, **not** the factory being async, and the
  difference matters because the wrong rule sends you to a static import you do
  not need: measured across all four shapes, a sync factory, an async one with
  no `importOriginal` parameter, and an async one that takes it and never calls
  it all return the factory's result; only awaiting it diverges. Then
  `vi.importMock` hands back the **original** module — the export comes back
  real, callable, and a DIFFERENT object from the one the module under test was
  given, so `vi.mocked()` on it configures nothing and asserts nothing, and
  calling it runs the real implementation. Worse than a missing binding,
  because it looks right. Read a partial mock — the
  `{ ...(await importOriginal()), fn: vi.fn() }` shape — through a plain static
  import, which does resolve to the mock.
  `scripts/maintenance/backfillMediaBlurhash.test.ts` has one of each: a sync
  factory read with `vi.importMock`, and four awaiting ones read statically.
- **`vi.restoreAllMocks()` does not reset a `vi.fn()` a `vi.mock` factory
  created.** It only iterates the spies `vi.spyOn` registered, so a module
  mocked as `vi.mock('@/path', () => ({ fn: vi.fn() }))` carries whatever the
  last test told it to return — implementation AND call history — for the rest
  of the file, however thorough the `afterEach` looks. Reset each such export
  explicitly in `beforeEach` (`vi.mocked(fn).mockReset()`). Nothing fails while
  the leak happens to be harmless, which is exactly the problem: the next test
  written against the mock's DEFAULT behaviour silently inherits a neighbour's
  `mockResolvedValue`, and the tests that did notice carry a lone
  `vi.mocked(fn).mockReset()` at the top as a local work-around instead of
  fixing the hook. `scripts/maintenance/backfillMediaBlurhash.test.ts` is the
  worked example, and pins the reset with a guard test placed last in the block
  so it runs after the tests that dirty the mocks.
- **`toHaveBeenCalledWith` asks whether a call ever happened, never whether it
  was the only one.** A once-per-run summary asserted that way is equally
  satisfied by one logged per row, because the last row carries the correct
  cumulative totals — so "once" has to be pinned by filtering
  `vi.mocked(console.log).mock.calls` and asserting the resulting list with
  `toEqual`, over a fixture large enough that the wrong placement logs twice
  (two rows at `batchSize: 1` separates per-row, per-batch and after-the-loop).
  The same gap hides a hardcoded page size: at fixture scale one 50-row batch
  and several 1-row batches write the same rows and log the same counters, so
  paging is only observable by counting the SELECTs off knex's `query` event.
- **To control when an awaited call settles, import `createDeferred` from
  `@/lib/testing/deferred` — do not hand-roll another promise-with-exposed-resolve
  helper.** The same eight lines had been reimplemented in four test files under
  three different names before they were extracted. It returns
  `{ promise, resolve, reject }` and the promise stays **pending** until a test
  settles it, which is the whole point: the pending render and the settled one
  are separate flushes, so a `Promise.resolve(value)` stand-in collapses them
  into the first `act()` and the assertion about the in-flight state passes
  vacuously. `PostBox attachment ref guard` is the sharpest example — it passes
  with the bug present unless the two picker batches are sequenced — and
  thirteen more tests across `MessagesPage`, `SearchPageClient` and
  `FitnessHeatmapView` fail outright if the helper stops deferring.
- **React `cache` does not memoize under Vitest, so a test for a `cache()`d
  helper has to stand a request scope up itself — `runInReactCacheScope` from
  `@/lib/testing/reactCacheScope`.** React ships two builds of it: the client
  build Vitest resolves is a hard passthrough that calls the function every
  time, and only the `react-server` build — the one Next.js loads for Server
  Components and route handlers — keys on the arguments, and then only while an
  async cache dispatcher is installed. That dispatcher **is** the request scope.
  So a test that simply calls a memoized helper twice and expects one query is
  asserting nothing about the memoization; it reads two, and the natural
  "fix" is to weaken the assertion. Swap the server build's `cache` in with
  `vi.mock('react', …)` returning that module's `serverCache`, then wrap the
  calls in `runInReactCacheScope` — one call is one request, with a fresh store,
  restored afterwards — and **sequentially**: React's dispatcher is one mutable
  global, so two live scopes cannot be isolated from each other at all (either
  one's continuation after an `await` reads whichever dispatcher happens to be
  installed), and a second scope entered while one is live therefore throws
  rather than nesting. `app/(timeline)/[actor]/profileFollowLookup.test.ts` is
  the worked example: it asserts one follow query across a whole profile render,
  on the local and remote branches alike, and that a second scope re-reads.
- Prefer unit tests near `lib/` and route tests near `app/`.
- All tests run in parallel using isolated SQLite in-memory databases. The
  schema is loaded from the committed reference dumps (`migrations/schema*.sql`)
  via `lib/database/testUtils.ts` rather than by running the Knex migration
  chain, so the dumps MUST stay in lockstep with the migrations.
- **`describe` / `it` names use plain descriptive text — do not prefix them.**
  Name the function or method under test directly (`describe('getVisibility', …)`,
  not `describe('#getVisibility', …)`), and do not use a leading `#` or `.`
  sigil. `it` names should read as a behavior statement
  (`it('returns null when actor is missing', …)`).
- For tests whose cases differ only by input and expected output, prefer a
  table-driven `it.each([...])('$description', …)` with a `description` column
  instead of repeating near-identical `it` blocks. Reserve standalone `it`
  blocks for cases with distinct setup or assertion shapes.
- Client components that fan out to children which render relative timestamps
  (e.g. `Posts`/`Post`) must receive `currentTime: number` from a Server
  Component and forward it. Add a regression test that renders the component
  with a fixed `currentTime` and a post created a known interval earlier, then
  asserts the rendered relative time (for example `posted 5 minutes ago`). If
  the component calls `Date.now()` internally instead, the assertion fails. See
  `app/(timeline)/MainPageTimeline.test.tsx` for the pattern.

### Local Manual / Browser Testing (SQLite + mock data)

Use this to run the app locally with a logged-in test user and seeded posts —
for example to verify UI changes or reproduce hydration issues in a browser.
These exact steps are verified to work; the gotchas below are load-bearing.

1. Create a git-ignored `.env.local` at the repo root:

   ```bash
   ACTIVITIES_HOST=localhost:3000
   ACTIVITIES_INSECURE_AUTH=true
   ACTIVITIES_SECRET_PHASE=local-dev-secret-phrase-change-me
   ACTIVITIES_ALLOW_EMAILS='["test@example.com"]'
   ACTIVITIES_DATABASE_CLIENT=better-sqlite3
   ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
   ```

   - `ACTIVITIES_INSECURE_AUTH=true` is **required** for local sign-in over
     `http`. Without it, `getBaseURL()` defaults to `https://…`, so better-auth's
     trusted origin becomes `https://localhost:…` and sign-in fails with
     `403 Invalid origin: http://localhost:…`.
   - Wrap JSON-valued vars like `ACTIVITIES_ALLOW_EMAILS` in **single quotes** so
     both `dotenv-flow` and shell `source` keep the inner double quotes.
   - `ACTIVITIES_HOST` must match the port the dev server actually serves on (the
     mock actor's domain is `config.host`). If port 3000 is taken, pick a free
     port and set both `ACTIVITIES_HOST` and `yarn dev --port` to it.

2. Install deps, migrate, and seed mock data:

   ```bash
   yarn install          # Node.js 24
   yarn migrate          # knexfile uses dotenv-flow → auto-loads .env.local

   # The mock scripts do NOT auto-load .env.local.
   # Export the vars into the shell first, then run them:
   set -a; . ./.env.local; set +a
   # The project is ESM-only. Run scripts through the scripts/run.cjs bootstrap
   # (also wired into each script's shebang) so tsx loads them in CommonJS
   # mode — this resolves the app's extensionless and CommonJS-named imports,
   # which Node's strict ESM loader rejects.
   node scripts/run.cjs scripts/mock/createMockUser.ts      # testuser / test@example.com / testpassword123
   node scripts/run.cjs scripts/mock/createMockStatuses.ts  # seeds main (home) timeline posts
   ```

   The mock user is created already email-verified, so credential sign-in works.

3. Run the server and sign in:

   ```bash
   yarn dev --port 3000   # port must match ACTIVITIES_HOST
   ```

   Open `http://localhost:3000/auth/signin` and sign in with
   `test@example.com` / `testpassword123`. The seeded posts appear on the
   timeline at `/`.

4. Reproducing hydration mismatches in a browser: relative timestamps round
   coarsely (date-fns boundaries at 30s, 90s, …), so the natural SSR→hydration
   gap rarely crosses a boundary. To force a deterministic mismatch, override the
   browser clock before load (e.g. Playwright `addInitScript` setting
   `Date.now = () => realNow() + 180000`). With the bug present this throws a
   React hydration error naming the timestamp node; with `currentTime` passed
   from the server it does not, because both SSR and hydration use the identical
   server value.

## Task Recipes

Ordered checklists for the most common task shapes. Follow them step by step;
each ends with the Definition of Done gate.

### Adding a Mastodon-style API endpoint

1. Create `app/api/v1/<name>/route.ts` exporting HTTP-method handlers (`GET`, `POST`, …).
2. Wrap handlers in the right guard from `lib/services/guards/` (e.g. `AuthenticatedGuard`, `AdminApiGuard`) — the guards already handle auth and same-origin proof.
3. Validate request bodies with Zod `safeParse` (never `.parse()` — lint-enforced); add `.max(n)` for sized columns and the empty→`null` transform for nullable text (see **Zod Validation in API Routes**).
4. Take status/actor ids through `resolveStatusIdParam` / `resolveActorIdParam` (or their batch `…Params` forms) and emit them with `getClientStatusId` / `getClientActorId`, including any pagination cursor — never `idToUrl`/`urlToId` inline (see **Client-Facing Entity IDs**).
5. Respond only via `apiResponse` / `apiErrorResponse` from `@/lib/utils/response` (lint-enforced); CORS routes (those exporting `OPTIONS`) use `apiResponse` even for errors.
6. If the web UI calls the endpoint, add a named exported function to `lib/client.ts` and import it in components — never call `fetch()` in a component (lint-enforced).
7. Co-locate `route.test.ts`; plain `describe`/`it` names, table-driven `it.each` for input/expected variants (see **Testing Guidelines**).
8. Update `docs/architecture.md` or the relevant feature guide if they enumerate routes.
9. Run the Definition of Done gate.

### Adding a database migration

1. `yarn migrate:make <name>` — never hand-write the file (migrations are ESM `.js` with named `up`/`down` from `migration.stub`).
2. Use the Knex query builder; the migration must work on SQLite and PostgreSQL and avoid breaking MySQL-compatible clients (see **Database Compatibility Guidelines**).
3. Apply it locally against a throwaway SQLite file with inline env vars: `ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=./throwaway.sqlite3 yarn migrate`.
4. Regenerate BOTH reference schema dumps (see **Keeping the reference schema dumps in sync**). This is not optional: the Vitest suite builds its databases from the dumps, and CI's Schema Dump Sync job fails on SQLite-dump drift.
5. Update the affected `lib/database/` code and types, plus tests.
6. Run the Definition of Done gate.

### Adding an environment variable

1. Read it ONLY inside `lib/config/` — add it to the right module and its Zod schema, with tests (`lib/config/envAccess.test.ts` fails on reads elsewhere).
2. Never read it at build time (`next.config.ts` etc.) — see **Runtime Configuration Guidelines**.
3. Document it in `docs/environment-variables.md` (the `lib/config/envDocumentation.test.ts` sync test fails otherwise) and add it to `.env.example`.
4. Update any setup guide that shows related configuration.
5. Run the Definition of Done gate.

### Adding a page in the `(timeline)` group

1. Create `app/(timeline)/<name>/page.tsx`; render `<PageHeader title="…" />` and inherit the unified `max-w-content` width — no per-page width classes (see **Page Header & Sub-Navigation**).
2. Settings-style sections use the shared `SectionNavDropdown` on every breakpoint; never a vertical nav rail or in-header tabs.
3. Pass timestamps as `Date.now()` numbers from Server Components; Client Components accept `currentTime: number` and never call `Date.now()`/`new Date()` during render (see **Date Serialization**).
4. If the page shows status posts, render them through the shared `Posts`/`Post` components and turn actions on with `currentActor` + `showActions` — never a bespoke post/action row or per-status action callbacks (see **Status Posts & Actions**).
5. All client-side data calls go through named functions in `lib/client.ts` (lint-enforced).
6. Add component tests (`/** @vitest-environment jsdom */` docblock) and verify the page in a real browser (see **Local Manual / Browser Testing**); include screenshots in the PR.
7. Run the Definition of Done gate.

## Documentation Maintenance

- **Docs are part of the change.** Any PR that changes behavior described in `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `REVIEW.md`, or `docs/` MUST update those documents in the same PR. Stale guidance is a bug: these files are the operating manual for both humans and AI agents, and past drift produced broken commands and examples (e.g. docs still saying "Jest" long after the Vitest migration, and Docker examples that could not start).
- Before opening a PR, grep the repo's Markdown for every command, script, route, environment variable, table, flag, or convention your change renames, removes, or reshapes — `grep -rn "<old-name>" *.md docs/` — and fix every hit.
- Common triggers and the docs they touch:
  - `package.json` scripts, tooling, hooks (husky/lint-staged), or CI workflow changes → `AGENTS.md` (Build/Test and Commit sections) and `CONTRIBUTING.md`
  - Environment variables added/removed/renamed, or defaults/validation changed → `docs/environment-variables.md` and `.env.example` (plus any setup guide that shows the variable)
  - API routes added/moved, or HTTP methods changed → `docs/architecture.md` and the relevant feature guide (e.g. `docs/fitness-file-storage.md`)
  - Knex migrations → regenerate both schema dumps (see Database Backends & Local Setup)
  - `scripts/` utilities added or changed → `docs/maintenance.md` (and the feature guide that lists them)
  - Deployment, Docker, or runtime-config changes → `README.md`, `docs/setup.md`, and the database setup guides
  - New or changed coding conventions and patterns → the matching `AGENTS.md` section and the `REVIEW.md` checklist
  - Changes to AGENTS.md rules themselves → `AGENTS.md` (which `CLAUDE.md` symlinks to) and the PR checklist in `.github/PULL_REQUEST_TEMPLATE.md`
- Keep `docs/` durable and general-purpose (see Project Structure): update the reference docs in place; do not add change-specific writeups.

## Commit & Pull Request Guidelines

- **Work reaches `main` as a pull request**: commit to the feature branch, push it, and open a PR. Nothing is merged by committing to `main` directly (Definition of Done item 1), and the review loop below has no PR to attach to until this has happened.
- Commit messages must start with one of these prefixes followed by a short imperative description:
  - `none:` to mark that commit as no-release unless another commit in the range requests a higher bump
  - `major:` for breaking changes (major version bump)
  - `minor:` for backwards-compatible new features (minor version bump)
  - `fix:`, `feat:`, `chore:`, `refactor:`, `test:`, `docs:`, etc. for everything else (patch version bump)
- PRs should include a clear summary, linked issues (if any), test results, and notes for config/migrations.
- Include screenshots or clips for UI changes.
- **Never put production or operational SQL in PR descriptions** (or anywhere committed in the repo). One-off database mutations for a deployment — hotfix `UPDATE`/`INSERT`/`DELETE` statements, data backfills, or any copy-pasteable production runbook — must not live in the PR body. Describe **what** operational change is needed and **why** in prose, and deliver the actual SQL through the deployment runbook or a private ops channel instead. This targets operational/runbook SQL — it does **not** restrict application query code: Knex query-builder calls and `knex.raw`/`whereRaw` in `lib/` are normal application code and unaffected. The database files that legitimately live in the repo, all under `migrations/`, are the Knex migrations (JavaScript/TypeScript that define schema changes — not raw `.sql`) and the reference schema dumps (`migrations/schema.sql`, `migrations/schema.sqlite.sql`); illustrative SQL in the `docs/` setup and maintenance guides (e.g. `docs/postgresql-setup.md` and the schema-dump steps) is also fine. This keeps environment-specific identifiers, hostnames, and runbooks out of the public Git history.

### Version Bump Prefixes

**Do NOT manually change the `version` field in `package.json`.** A CI workflow automatically bumps the version based on commit message prefixes after merge. Manual version changes in PRs will conflict with the automated workflow.

The version-bump workflow reads commit prefixes to determine the next semver version. Use these prefixes to control version bumping:

| Prefix               | Version bump    | When to use                                                                                                                                      |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none:`              | None            | For internal-only changes that do not require a release (e.g. documentation, CI configuration)                                                   |
| `major:`             | Major (`X.0.0`) | Breaking changes that require users to update configs, migrations, or integrations (e.g. removed API, changed auth flow, incompatible DB schema) |
| `minor:`             | Minor (`x.Y.0`) | New backwards-compatible features users can opt into (e.g. new endpoint, new UI page, new optional config)                                       |
| _(any other prefix)_ | Patch (`x.y.Z`) | Bug fixes, refactors, chores, docs, tests — anything that doesn't change the public-facing contract                                              |

#### Squash-merge and PR titles

PRs are **squash-merged**, so the **PR title becomes the commit subject** on `main`. The workflow checks the commit subject first, then falls back to scanning the commit body (which contains the individual commit messages).

**To ensure a `minor` or `major` version bump, the PR title MUST start with `minor:` or `major:`.** For example:

```text
minor: add hashtag timeline support        ← PR title → minor bump
major: remove legacy v1 API endpoints      ← PR title → major bump
feat: fix button alignment                 ← PR title → patch bump (default)
```

If the PR title uses a generic prefix (e.g. `feat:`) but an individual commit inside the PR uses `minor:`, the workflow will also detect it from the squash-merge body. However, **setting the PR title is the most reliable approach** since it is always the commit subject.

Commits that change only files under `.github/` are also treated as no-bump by default, unless the commit message explicitly uses `major:` or `minor:`.
When the repository has no version tag yet, the workflow still bootstraps `v1.0.0` regardless of commit history.

After a merge to `main`, the version-bump workflow opens an auto-merging `Bump version to vX.Y.Z` PR from the reserved `version-bump/main` branch — leave that branch and PR alone. The merged bump commit is tagged by `tag-version.yml`, and `package.yml` builds and publishes multi-arch Docker images (tagged `main`) to GHCR and Docker Hub on every push to `main`.

Examples:

```text
none: update internal CI docs without cutting a release
chore: tweak GitHub Actions cache keys              ← no bump if the commit only changes `.github/`
major: remove legacy v1 API endpoints
minor: add support for S3 media storage
fix: correct timestamp parsing in ActivityPub inbox   ← patch
chore: update dependencies                            ← patch
```

- **Before committing**, always run:
  1. `yarn run prettier --write .` to format all files.
  2. `yarn lint` to ensure no linting errors—**must be green before commit**.
  3. `yarn typecheck` to ensure no type errors—**must be green before commit**.
  4. `yarn build` to ensure no build errors—**must be green before commit**.
  5. `yarn test` to ensure no test errors—**must be green before commit**.
- A husky pre-commit hook (`.husky/pre-commit`) runs on every commit: first `lint-staged` (configured in `package.json`), which runs `prettier --write` on the staged files and re-stages the formatted result, then `yarn lint`, which blocks the commit on lint errors. It does **not** run build or tests — run those yourself per the checklist above.
- The `prettier` / `prettier:check` package scripts only cover `app migrations lib lint`; the trailing `.` in `yarn run prettier --write .` is what extends formatting to the whole tree. CI's format gate (`yarn prettier:check`) does not check `scripts/`, `docs/`, or `.github/`.
- The **sub-agent code-review loop below is the project's review process.** The `gemini-code-assist` bot has been **removed** and no external review bot currently runs on PRs, so do **not** post `/gemini review` (or any other bot trigger) and do not wait on a bot. `REVIEW.md` at the repo root is the project's review checklist and documents recurring reviewer false-flags (e.g. claims that `vi.importMock` does not exist) — read it before acting on review feedback.

## Code Review Loop (Sub-Agents)

**Once a PR is ready, drive a sub-agent code-review loop before treating the work as done, and re-run it every time an agent makes further changes to that PR.** "Ready" means the branch is pushed, the PR is open, and the local pre-commit gate (prettier → lint → build → test) is green. This is a required step for every PR an agent produces, not an optional polish pass — with one exception, **When sub-agents are unavailable** below.

### Fan out sub-agents to review the whole change

- Spawn **sub-agents** (the Task/Agent tool, or the `code-review` skill) to review **all** of the PR's code — correctness bugs plus the project invariants in this file and `REVIEW.md`, security, tests, and style. Use `REVIEW.md` as the checklist. For a sizeable diff, fan several sub-agents out in parallel across different files/dimensions instead of a single pass, then consolidate their findings.
- **Post every finding as a comment on the PR** — an inline review comment anchored to the offending file and line wherever possible, not just a summary in chat. The `code-review` skill's `--comment` flag posts inline comments directly; otherwise open a pending review with `pull_request_review_write` (method `create`), attach comments with `add_comment_to_pending_review`, and submit with `pull_request_review_write` (method `submit_pending`). The PR threads are the source of truth for what still needs addressing.

### Address → reply → resolve, in rounds

For every open review comment (from your sub-agents or from a bot):

1. **Address it** — make the fix on the branch, or, for a false positive / won't-fix, decide that explicitly and be ready to justify it. Commit and push.
2. **Reply** on the comment thread with what changed (or why no change is warranted) via `add_reply_to_pull_request_comment`.
3. **Mark it resolved** via `resolve_review_thread`.

After clearing a batch, **run the sub-agent review again** — fixes can introduce new problems. **Repeat until a full round surfaces no new issues that need addressing, or you reach a maximum of 20 rounds**, whichever comes first. Note the round number as you go so the cap stays visible, and stop early the moment a clean round produces nothing actionable.

### Review bots

- **No external review bot currently runs on PRs.** The `gemini-code-assist` bot has been removed, so do **not** post `/gemini review` (or any other bot trigger) and do **not** wait for a bot review — the sub-agent rounds above are the whole review.
- If an automated review bot is reintroduced later, loop it in the same way: after addressing a round, re-request its review, treat its comments exactly like your own findings (address → reply → resolve), and give it up to 20 minutes to respond before continuing — but until then, don't wait on a bot that isn't there.

### When sub-agents are unavailable

Some sessions cannot spawn sub-agents at all: the harness exposes no Task/Agent tool, the operator's session configuration forbids calling it ("do not call the Agent tool unless the user requested it" and similar), or the user has said not to. **In that case the loop is not required, and you must not stall the work waiting for it.** The exception is narrow and mechanical — it fires on _inability_, never on the change looking small, the diff looking obvious, or the gate being green. Those are the conditions under which a review is cheap, not the conditions under which it is unnecessary.

What still holds when the exception fires:

- **Review the diff yourself, in one pass, against `REVIEW.md` and this file.** The exception is about _who_ reviews, not _whether_ the work is reviewed. A single careful self-review is worth far more than nothing, and it is the whole review in this mode.
- **Say so explicitly**, in the PR body and in the handoff to the user: the loop did not run, and why. A skipped review that nobody can see is indistinguishable from a review that found nothing — which is precisely the failure this rule exists to prevent. Never describe the work as fully reviewed, and never imply rounds ran that did not.
- **The loop is still owed.** Offer to run it the moment sub-agents are available — the user can lift the restriction for the session, or run `/code-review` themselves. If a later session on the same PR _can_ spawn sub-agents, run the loop there before the PR merges.

Everything else about the PR is unchanged: the Definition of Done, the pre-commit gate, and the documentation and schema-dump rules all still apply in full.

### Done when

A full sub-agent review round yields no new actionable comments, or you have run 20 rounds. Every thread you touched should be replied-to and resolved before you stop. Where the exception above applies, you are done when the self-review is complete and the skipped loop is disclosed on the PR.

## Security & Configuration Tips

- Store secrets and instance settings in environment variables; avoid committing secrets.
- Review `docs/setup.md` and the database setup guides before changing auth, host, or database settings.
- The full environment-variable catalog lives in `.env.example` (annotated) and `docs/environment-variables.md` — consult both before adding a new `ACTIVITIES_*` variable in `lib/config/`.

### Uploaded file names are untrusted input

- **In the upload storage drivers (`lib/services/medias/`, `lib/services/fitness-files/`), never join, `extname`, or persist a supplied file name directly — put it through `@/lib/services/medias/fileName` first.** `File.name` and the presigned flows' `fileName` field are plain client-controlled strings: only a browser multipart upload is guaranteed to send a bare basename. Every non-browser Mastodon client (`POST /api/v1/media`, `POST /api/v2/media`, `POST /api/v1/medias/presigned`) puts whatever it likes there, and so do the fitness uploads (`POST /api/v1/fitness-files`, `POST /api/v1/fitness/import`, `POST /api/v1/fitness/strava/archive`, `POST /api/v1/fitness/strava/archive/presigned`). The module lives under `medias/` and is shared, the same way `medias/quota` already is. Apply the same treatment to any new code that accepts an uploaded name.
- `sanitizeStoredFileName` reduces a name to one inert path segment (cuts at the last `/` **or** `\`, drops control, C1, bidi and invisible-spacing characters, rejects `.`/`..`, caps it at 200 bytes so it fits both `varchar(255)` and a filesystem name). Use it for anything persisted or handed to another system — the stored name is federated and becomes the attachment's `name`/alt text on other instances, so bidi overrides there are a display-spoofing vector, and both `medias.originalFileName` and `fitness_files.fileName` are rendered back to users. The cap is not only cosmetic: those columns are `varchar(255)`, so an unbounded name is an insert failure on PostgreSQL. It deliberately keeps U+200C/U+200D, which Persian and Indic spelling and emoji sequences need.
- `createMediaTempFilePath` is the only sanctioned way to build a temp path from a supplied name. `path.join` resolves `..`, so `join(tmpdir(), randomHex + file.name)` escaped `tmpdir()` given three or more `..` (the first is absorbed by the prefix's own segment). With fewer, the name instead cancels the prefix out and lands on a **predictable** `<tmpdir>/<name>`, so one upload can overwrite another's temp file. The helper adds the separator and asserts the result's parent is still `tmpdir()`.
- **A video's preview frame is extracted through `extractVideoPreviewFrame` (`lib/services/medias/videoPreview.ts`), which both storage drivers share, and it runs _before_ the video is stored — never after.** `extractVideoImage` rejects whenever ffmpeg finds no decodable frame, and a stored file with no `medias` row is unreachable by everything except `scripts/maintenance/cleanupMediaStorage.ts`, so extracting from the already-stored file orphaned it on every failure. The step lives in one module precisely because the two drivers are edited one at a time: the local driver had this gap for as long as both existed.
- **The temp copy that ffmpeg decodes carries no part of the supplied name.** ffmpeg picks its demuxer from the path as well as from the bytes, and the `image2`/`mjpeg` demuxers beat content probing for an image extension paired with a `%0Nd` number pattern or a `*` glob — so a perfectly good H.264 mp4 uploaded as `IMG_%04d.jpg` sent ffmpeg hunting for a numbered image sequence and answered 500 for a file the instance can store. The path still comes from `createMediaTempFilePath`, so it keeps the random prefix and the `tmpdir()` assertion, but the name handed to it is the server-derived `video<ext>` from `getStoredMediaExtension` — which makes that helper's sanitizer a second line of defence here rather than the only one. Validate the container **first**, too: `MediaValidationError` is the caller's 422, and deciding it from the probe alone is what keeps an audio-only mp4 — a voice memo the browser labels `video/mp4` — from spawning ffmpeg and coming back as a logged 500 the client will retry.
- `getStoredMediaExtension(contentType, fileName)` derives a generated path's extension from the **validated content type**, not the name. `extname('clip.mp4/../../evil.html')` is `.html`, which on the local driver became the stored filename and made `/api/v1/files/…` serve an mp4/HTML polyglot as `text/html` on the instance origin; a 300-character extension produces a local filename no filesystem accepts. It falls back to the name's extension only for content types outside the map — which the upload routes already reject — and then only for an allowlisted media extension. It also fixes the case-sensitive `endsWith('.mov')` check that stored `MOVIE.MOV` as `.MOV`.
- **Every entry of `ACCEPTED_FILE_TYPES` must have a mapping in `EXTENSION_BY_CONTENT_TYPE`.** A type without one falls through to the supplied name, which is the hole this module closes; `fileName.test.ts` asserts the map covers the list.
- In `lib/services/fitness-files/`, only the stored name is sanitized. `getFitnessFileType` keeps reading the **raw** name: the 200-byte cap can truncate a long name past its extension, and that function throws when neither the name nor the MIME type identifies a type. Its return is one of four literals and is the only part of a supplied name that reaches a storage path.
- Covered by `lib/services/medias/fileName.test.ts` plus entry-point regression tests in the `S3StorageFile.test.ts` / `localFile.test.ts` of both `medias/` and `fitness-files/`.

### A federated blurhash is untrusted input, and the residue is repaired by a mode of its own

- **A blurhash is the one media field a remote actor supplies directly, and `normalizeBlurhash` (`lib/services/medias/imageAnalysis.ts`) is what decides its stored form.** It returns the string to persist or null, never a boolean, because the check normalises before deciding: the predicate it replaced compared `hash.trim()` while `createNoteJob` stored the untrimmed original, so a whitespace-padded hash on a federated note was approved on the trimmed copy and written in a form `decode` throws on (`length is 29 but it should be 28`). Both halves of the check are load-bearing and neither subsumes the other — `BLURHASH_REGEX` covers the base83 alphabet, which `isBlurhashValid` never looks at, and `isBlurhashValid` covers the structure the regex cannot see, that the length must be `4 + 2 * componentX * componentY` for the size flag in the value's own first character, which is why `'aaaaaa'` is well-formed base83 of a legal length and still throws. `createNoteJob` is the only path that stores a peer-supplied hash; every other writer, `medias.blurhash` included, gets one from `computeBlurhash`, i.e. from `encode`, so it is canonical by construction.
- **Fixing a write path does not repair the rows it already wrote, and here nothing re-validates on read** — `lib/types/domain/attachment.ts` re-serves the stored string verbatim to third-party clients as Mastodon's `blurhash` and as a `Document`'s `blurhash`, so a bad value keeps leaving the instance. `scripts/maintenance/backfillMediaBlurhash.ts --revalidate` is the repair, and it is a mode rather than a widening of the default selection for a measurable reason: the default sweep selects `blurhash IS NULL OR thumbnailUrl LIKE '/api/v1/files/%'` and a bad federated hash matches neither branch, while `--force` reaches it only by re-downloading and recomputing **every** attachment in the instance. The repair needs no bytes at all — a padded hash is trimmed, an unsalvageable one cleared — so the mode runs before the storage and host checks and stays usable on an instance whose storage is unreachable, and passing `--force` beside it is an error rather than a silent precedence.
- **It reports three counts — repaired, cleared, untouched — and unlike the two in `backfillAttachments` these DO partition the scan.** They are still not summed, because they call for different responses: a repair is complete, an untouched row was never broken, and a cleared one has lost its placeholder until an ordinary run recomputes it from the image. That is the one direction the two modes compose in: `--revalidate` clears what it cannot fix, and those rows then match the default run's `blurhash IS NULL` selection. Selection is `blurhash IS NOT NULL` with **no `mediaType` filter** — a video attachment carries its poster frame's hash, and the default sweep's analysis step only ever reads `image/*`, so this is the only pass that reaches one.
- **Clearing is safe and is strictly better than leaving the value.** `lib/components/posts/media.tsx` gates the `<img>` at `opacity-0` until `onLoad` behind a canvas ONLY when `blurhash` is truthy, and `BlurhashCanvas` swallows a failed `decode` into an empty canvas — so an undecodable hash is an empty box, where a NULL one falls through to a bare `<img>`. It does not weaken the placeholder promise in **Deleting Media a Post Uses**: that promise rests on the attachment carrying a hash a client can PAINT, and a value `decode` refuses never painted one.

### A stored media URL is only ours if the host says so

- **Recover a stored media path from a URL with `getMediaPathFromFileUrl` (`lib/services/medias/mediaFileUrl.ts`) — never by checking the `/api/v1/files/` prefix on its own.** That route is this project's own, so **every other activities.next instance serves its attachment URLs under exactly that path**. A path-only check therefore reads a remote instance's URL as one of our storage paths: the lookup misses in storage, and at a caller that treats "not local" as "fetch it over HTTP instead" the download branch is skipped entirely, so the archive or backfill references a file it never obtained. `scripts/backup/actorArchive.ts` (attachment URLs plus the actor's `iconUrl`/`headerImageUrl`) is migrated to this shared, host-aware parser. `scripts/maintenance/backfillMediaBlurhash.ts` hit the same bug independently and fixed it first, in #1559, with its own `getLocalStoragePath` / `isOwnAuthority`. #1569 shared the **traversal half** and #1570 the **host half**, so that copy is gone and both callers reach this one parser. The two matchers were measured rather than assumed to agree, and differed in exactly one way: `isOwnInstanceHost` strips BOTH default ports where the script's copy treated only `:443` as implied, so `https://<our-host>:80/api/v1/files/…` is now accepted — the same hostname either way, and pinned by a test. It is the inverse of `getMediaFileUrl` and lives beside it.
- **The host question is `isOwnInstanceHost` (`lib/utils/host.ts`), not `isHostTrustedByRules`.** It must include `ACTIVITIES_TRUSTED_HOSTS`: a multi-domain instance builds a media URL from the OWNING actor's domain (`getAttachmentMediaMetadata` is handed `currentActor.domain`), which is not necessarily the configured primary host. And it must not be `isHostTrustedByRules` alone — that answers the narrower "may an inbound `X-Forwarded-Host` be believed", for which `normalizeHost` deliberately rejects loopback names, so on a `localhost:3000` development instance it says no to the instance's own host. `isOwnInstanceHost` compares canonical authorities first (covering that case and every exact `host:port` match), then defers to the rules matcher for wildcard entries.
- **A recovered path that walks upwards, that is absolute, or that carries a NUL byte is refused too (`isTraversingStoragePath`) — and the check has to run AFTER decoding.** `new URL()` resolves dot segments, and decodes the dots themselves to find them, but only where the separators are literal slashes: `https://<our-host>/api/v1/files/..%2f..%2fsecrets/env` therefore reaches the decoder still spelled `..%2f` and comes back as `../../secrets/env`. The host-relative branch parses no URL at all, so there a plain `/api/v1/files/../../secrets/env` is never normalised either. **This was a live vulnerability, not a theoretical one:** `POST /api/v1/accounts/profile` takes `iconUrl`/`headerImageUrl` as bare `z.string()` and stores them verbatim, so any signed-in local user could point their own avatar at such a URL and have `copyProfileImage` ship an arbitrary file off the operator's machine inside their own account export. Only a segment that RESOLVES to `..` is refused, so `ab/..cd.webp` stays an ordinary stored file name. **Windows is covered deliberately** — the archive and maintenance scripts run wherever the operator runs them — so `\` is a separator, `C:` is absolute, and a segment of bare dots and spaces carrying two or more dots is refused, because Windows normalises trailing dots away and Node's own `path.win32` does not model that. Refusing the whole shape is deliberately wider than the exact spellings Win32 collapses; nothing this instance stores is named out of dots, so over-refusing costs nothing and does not depend on getting the platform's rules exactly right. That is TRAVERSAL coverage, not a claim that every Win32 quirk is handled — a reserved device name like `CON` still resolves to a device, as it already does for `LocalFileStorage.getFile`. The rule is single-sourced and shared with the blurhash backfill; do not fork it. The check reads the DECODED path, so the one shape that escapes it is a path whose escapes cannot be decoded at all — `decodeURIComponent` throws on the first bad escape anywhere in its input, so `..%2f..%2fetc%2fpasswd%zz` comes back still-encoded and reads as one segment. That is inert only because no consumer decodes again (`path.join` and an S3 key both treat `%2f` literally); a consumer that does decode needs its own check.
- **`copyProfileImage` resolves and confirms containment for itself as well**, through the shared `resolveStorageFilePath` (`lib/services/medias/storagePath.ts`), rather than trusting the parser — the same reason `createMediaTempFilePath` asserts its own result is still under `tmpdir()`. It is the step that turns a stored path into a file read off the operator's machine, and its signature says nothing about where that path came from. Resolving rather than joining is what lets an absolute path be seen as outside instead of silently reinterpreted; `LocalFileStorage.getFile` already makes the identical check against its storage root, while `S3FileStorage.getFile` makes **none** — an S3 key that traverses is merely inert, not refused, and with a CDN `hostname` configured it is string-concatenated into a redirect URL — which is why the decision belongs in the parser rather than being left to "the driver will reject it".
- **A wildcard `ACTIVITIES_TRUSTED_HOSTS` entry must never be compared as a literal authority, and the check belongs AFTER parsing.** `new URL()` accepts `*` in a host, so `isOwnInstanceHost`'s exact-authority pass matched a URL whose authority was spelled exactly `*.cdn.example` and handed back its path as one of our own — the same hole `backfillMediaBlurhash.ts`'s `isOwnAuthority` documents closing in #1559, reintroduced by #1560. **Both passes need their own guard, for different reasons.** The exact pass reads RAW rules, so it skips any rule containing `*`. The rules pass normalises first, and `normalizeHost` recognised the documented `*.example.com` form only on the RAW value — missing it behind a scheme, and recognising it nowhere else — so `*example.com` (a plausible typo of it), `cdn.*` and `foo.*.example.com` all survived as LITERAL hostnames carrying a `*`, which `hostMatchesRule` compared literally; `new URL()` percent-decodes `%2a` in an authority, so a caller could spell one exactly and be believed. `normalizeHost` now refuses any parsed hostname still containing `*`, and reads the `*.` marker off the AUTHORITY so a scheme-prefixed rule still expands. It is dropped **silently by `normalizeHost` itself** — `normalizeHostRules` flat-maps the null away, and it is a per-request path behind a cache, so it is the wrong place to log from; `buildTrustedOrigins` is the one consumer that warns.
- **A misplaced wildcard has to be refused at every consumer, because each interprets it differently**, and **each must read the PARSED hostname — the parser is what MAKES the `*`** (it percent-decodes the authority, applies IDNA mapping and strips tab/CR/LF, so `%2aexample.com`, `user@%2aevil.com` and a fullwidth `＊example.com` all arrive already spelled with one). Three consumers apply it: `normalizeHost` (`lib/utils/host.ts`), `buildTrustedOrigins` (`lib/services/auth/trustedOrigins.ts`) and `toHostname` (`lib/services/auth/servedDomains.ts`). There were four until #1570 deleted `isOwnAuthority` from `scripts/maintenance/backfillMediaBlurhash.ts` — that sweep now asks `isOwnInstanceHost`, so it inherits both of that function's guards instead of carrying its own. `buildTrustedOrigins` matters most: better-auth routes any pattern containing `*` through `wildcardMatch`, so `*example.com` GLOBBED `evilexample.com`, gating both the Origin check on state-changing auth requests and `callbackURL`/`redirectTo` — an open redirect carrying auth callbacks. It must also **require a web scheme**, because it checks `hostname` but pushes `origin`, and `blob:` derives its origin from the inner URL in its PATH while reporting an empty host — the one scheme where the two disagree. **`getAllowedOrigins` in `app/api/v1/fitness/apple-maps-token/route.ts` is a fifth consumer that does NOT filter**, minting the MapKit JWT's `origin` claim straight from `host` + `trustedHosts`; whether Apple treats `*` as a glob there is unverified, so filtering could equally close a hole or break a multi-domain deployment. Establish that before sweeping it. `getCanonicalAuthority` is exported for a different question entirely: it is the shape `getMediaFileUrl` consumes, so the backfill's fallback authority is normalised the way the comparison normalises one, instead of by a fourth copy of the same regex chain. Not `getConfiguredHost`, which falls back to the RAW value whenever `normalizeHost` refuses it — every loopback and every malformed one — and must never decide trust.
- **A profile image URL a client submits is validated on write with `parseProfileImageUrl` (`lib/services/accounts/profileImageUrl.ts`), which accepts ONLY a URL SHAPED like one this instance serves its own media from — our own host, under `/api/v1/files/`, no traversal.** It checks the host and path, not the `medias` table: a well-formed URL naming a file that was never uploaded still validates, which is fine, because what this closes is the URL pointing somewhere we do not control. `POST /api/v1/accounts/profile` took `iconUrl` and `headerImageUrl` as bare `z.string()`s and spread them into `updateActor`, so any signed-in local user could point their own avatar at an arbitrary host — which then became a tracking pixel for every viewer of their profile, and, for the actor's icon, was republished as `icon.url` to every instance that fetches the actor. **`z.url()` is NOT this check and does not stand in for it**: in Zod 4 it accepts `javascript:`, `data:` and `file:` URLs, so shape validation alone leaves exactly the schemes worth refusing. **The protocol allowlist needs a test case that ALSO passes the host and path checks** — `ftp://<our-host>/api/v1/files/abc.jpg` — because every scheme case that fails those anyway leaves the allowlist unpinned: delete it and they all still pass, which a mutation sweep caught. `new URL` gives `ftp:`/`ws:` a real authority where `javascript:`/`data:` have none, so one of those carrying our own host and a media-shaped path sails through `getMediaPathFromFileUrl` unopposed. The allowlist must run BEFORE the host check for the same reason `getProductUrlHostname` needs one — `new URL` parses an authority for non-special schemes too, so `javascript://<our-host>/%0aalert(1)` presents a perfectly good hostname. A host-relative `/api/v1/files/...` is refused as well, even though `getMediaPathFromFileUrl` resolves one: the value is federated as `icon.url`, where a relative reference names the READER's origin. `POST /api/v1/accounts/image` (the account avatar) shares the one helper. The rule is **input-time only** — a remote actor's `iconUrl` is written from its actor document by `getPersistableProfile` and is legitimately remote, so there is no render-time host gate and existing rows are not re-validated.
- **An empty submitted value CLEARS the image, and the settings field is read-only for that reason.** `ImageUploadField` submits both fields on every save, so an empty one has to mean something; `updateActor` already reads `null` as an explicit clear. Its text box is `readOnly` because the only values the routes accept are the ones its own upload button produces — a typeable box invited a remote URL the server now refuses — so clearing moved to an explicit Remove button. Do not reintroduce the `placeholder` prop suggesting `https://example.com/avatar.jpg`.
- **A submitted value that MATCHES the one already stored is "no change" and is not re-validated, and that is load-bearing.** `/settings` is a SINGLE form around name, summary, both images and the privacy switch, and `ImageUploadField` seeds its hidden input from the stored URL and resubmits it untouched. Without the `currentValue` argument to `parseProfileImageUrl`, an actor carrying a URL stored before this rule existed — which the field's old `https://example.com/avatar.jpg` placeholder actively invited — would 422 the WHOLE form while editing only their display name, losing that edit to a bare `apiErrorResponse` JSON body (no `Location`, so a native form post renders it in place of the page) and with no way to save anything on `/settings` again until they worked out that the image had to be removed first. It gives nothing away: a NEW value still has to pass and clearing still works, so a stale value stays removable rather than sticky. **An EXACT echo is decided first, then an empty submission, then a trimmed match** — three branches because a legacy value that is nothing but whitespace makes all three collide — nothing on the read path trims, so a legacy value can carry copy-paste whitespace, and one that is nothing BUT whitespace is truthy while trimming to `''`, which collides with the empty submission Remove sends. A field the user never touched echoes the stored value BYTE FOR BYTE while Remove submits `''` exactly, so comparing raw first keeps an untouched save from writing `null` over that row; testing the empty submission next keeps the trimmed match from swallowing Remove and leaving the one control that can clear such a row a silent no-op, since the field is read-only and nothing else writes it. The three tests are ordered, not interchangeable: a legacy stored value can be nothing but whitespace — truthy, yet trimming to the same `''` an empty submission does — so each of the three guards a case the other two collide on. They live in `classifySubmission`, which answers `unchanged`/`clear`/`candidate` and carries that reasoning; do not collapse or reorder them. `POST /api/v1/accounts/image` must then SKIP its write on "no change" — `updateAccountImage` always writes, so `iconUrl.value ?? null` would clear the image the form was resubmitting unchanged.
- **`ImageUploadField`'s Remove button hands focus to Upload, and its read-only field names the `dark:` variant explicitly.** Remove is rendered only while a value is set, so activating it unmounts the button that was just pressed — and a focused element removed from the document drops focus to `<body>`, sending the next Tab back to the top of the page (WCAG 2.4.3). This is the same mechanism **Post media layout** documents for the media strip's chevrons, but their fix (leave the control out of the tab order) does NOT transfer: Remove is the only way to clear the image. React batches the state update, so the call would work after it too; it sits first so the handoff does not depend on that. Separately, the field's muted surface must be spelled `bg-muted dark:bg-muted` — `Input`'s own base carries `dark:bg-input/30`, and this project compiles the dark variant as `&:is(.dark *)`, where `:is()` takes its most specific argument's specificity, so a bare `bg-muted` LOSES the cascade and the field stays indistinguishable from an editable one in dark mode. Naming the same variant lets `twMerge` drop the base instead. Nothing catches this automatically: a jsdom `toHaveClass('bg-muted')` passes against the broken form, which is why the test asserts `dark:bg-input` is ABSENT from the rendered class list. The field stays `readOnly` rather than `disabled` because the preview beside it is a background-image `div` assistive tech cannot see, making this field the only announced representation of which image is set.
- **The settings endpoint owns the settings form's fields and nothing else.** `ProfileRequest` also declared `publicKey`, `followersUrl`, `inboxUrl` and `sharedInboxUrl` as free strings that `updateActor` persists, letting any signed-in user rewrite the public key and inbox endpoints their own actor publishes. No form ever sent them. Zod strips unknown keys, so they are simply absent from the schema now; don't add a field back without a form that sends it.
- **`getAttachmentMediaPath` (`lib/utils/getAttachmentMediaPath.ts`) is a different question and not a substitute.** It always returns a string and matches on `indexOf`, because its callers hold a URL this instance just wrote to its own storage. Use it only there — and **never where the recovered path reaches a DESTRUCTIVE storage call**, which is the case that looks like a fit and is not. `deleteSavedMedia` in `app/api/v1/admin/custom_emojis/route.ts` was the last hand-rolled copy of the parse, and its `saved.url` genuinely is a URL this instance minted a few statements earlier, so the host check there is REDUNDANT — but the path it recovers is handed to `deleteMediaFile`, and never returning null means a URL that is not a media URL falls back to the whole pathname and gets deleted anyway. Redundant is not the same as harmful: it uses `getMediaPathFromFileUrl`, whose null refuses what it cannot prove, for one `getConfig()`. That choice is also what gives the delete `isTraversingStoragePath` for free — the guard lives in the parser precisely so every caller inherits it, and `getAttachmentMediaPath` has none.
- **#1569's traversal fix moves URLs INTO this guard's branch, which is why the ordering was safe.** `getMediaPathFromFileUrl` now returns null for an own-host URL whose decoded path traverses, and that movement is strictly one-directional — it only ever adds null returns — so such a URL stops taking the local-storage branch and starts taking the remote-fetch branch. Had #1569 landed against an unguarded `registerAttachmentUrl`, it would have WIDENED the plain-`fetch` surface by exactly that set. With the guard in place both landings are safe: an own-host traversing URL becomes an ordinary unauthenticated HTTPS request to our own public file route (which any anonymous user can already issue, and `LocalFileStorage.getFile` contains), and a host-relative one throws in `new URL()` and is refused.
- **Once the host check says a URL is NOT ours, fetching it is an SSRF question — use `safeImageFetch` (`@/lib/utils/safeImageDownload`) plus a byte cap, never a plain `fetch`.** `attachment.url` is attacker-controlled by the account owner: `POST /api/v1/accounts/outbox` takes `PostBoxAttachment.url` as a bare `z.string()` (`lib/types/domain/attachment.ts`) and `createAttachment` writes it verbatim from `lib/actions/createNote.ts`. So `registerAttachmentUrl` in `scripts/backup/actorArchive.ts`, whose `--fetch-remote-attachments` branch is reached exactly when `getMediaPathFromFileUrl` says the URL is not ours, was making the exporting machine issue an owner-chosen request and writing the response body into `media_attachments/remote/<sha>.<ext>` of the tarball the owner receives — link-local `169.254.169.254` included. The guard pairs `safeImageFetch` (which refuses non-HTTPS, embedded credentials, and any hostname resolving to a restricted address, re-checking **every** redirect hop) with `readResponseArrayBufferWithLimit`. No content-type check, unlike `downloadRemoteImage`: an archived attachment can legitimately be video or audio. The residual DNS-rebinding window `safeImageDownload.ts` documents applies here too — but the guard forces `https:`, so a flipped record yields a TLS handshake carrying the attacker's SNI against an internal IP, which a plain internal HTTP service cannot complete; the realistic yield is a timing oracle, not body exfiltration, which is why this does not justify a binary-mode `createSafeRemoteFetch`.
- **The guard belongs on the untrusted input, not on the shared fetch helper.** `fetchPublicStorageResponse` (`scripts/backup/productionArchive.ts`) keeps its plain `fetch`, because its other caller `downloadPublicStorageFile` builds URLs from `getStorageEndpoint(hostname)` — the **operator's own** configured storage endpoint, which may legitimately be a private-network MinIO or a plain-http loopback in dev, both of which `safeImageFetch` refuses by design. Pushing the guard down into the helper would have broken the trusted caller while fixing the untrusted one.
- **A timeout that bounds a body read is also a throughput floor, so it cannot be inherited from a header-only one.** `fetchPublicStorageResponse` cleared its 60s timer in a `finally` that ran the moment headers arrived, leaving the body read untimed; `safeImageFetch` keeps its `AbortSignal.timeout` live for the whole read. Passing the old 60s through would therefore have required a sustained 3.5 MB/s to reach even the default 200 MiB cap — silently dropping large federated video from archives that used to contain it, which in a _backup_ is the worst place for silent data loss. Hence `REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS` (10 minutes). It is passed to `safeImageFetch` **twice** — as the per-hop `timeoutMs` and as an overall `signal` deadline — because `timeoutMs` alone restarts on every hop, and the loop runs `hop <= MAX_SAFE_IMAGE_REDIRECTS`, i.e. **four** fetches, not three. Per-hop only, a host stalling just under the limit at each hop costs 40 minutes for ONE attachment, and while a single status is capped at `MAX_STORED_MEDIA_ATTACHMENTS`, an actor's whole history is not — the export walks every one of them sequentially, so an account facing a ban or a legal request, exactly when `--fetch-remote-attachments` gets used, could stall the export for days. The deadline is what bounds an attachment rather than a request. Note it bounds the FETCHES only: `getSafeImageDownloadUrl`'s DNS lookup runs before the signal is attached, so the true ceiling is the deadline plus resolution time at each hop.
- **The per-attachment deadline bounds one attachment; `--remote-fetch-budget` bounds their sum, and it may only decline to START work.** Ten minutes times an actor's whole history was still days. The argument that blocked an aggregate bound for a round — that any such bound would abort a legitimate large download and so trade a stall for silent data loss, which is worse in a backup — was a false dichotomy: a budget that stops STARTING new downloads once exhausted, never aborting one in flight, degrades through the warn-and-keep-the-absolute-URL path `registerAttachmentUrl` already takes for every refused, over-size or failed attachment, which is exactly the behaviour of omitting `--fetch-remote-attachments`, applied to the tail. That loses nothing, so it is now built (default 3600s). **Four details are load-bearing.** The gate sits BELOW the local-storage branch, because a path this instance already holds costs no network and an exhausted budget must not start dropping the actor's own media. The deadline is stamped ONCE where `remoteFetch` is built, not per attachment — recomputed per attachment it is no bound at all, since every attachment then finds a full budget ahead of it. **That one is proved by running a whole export** (`scripts/backup/actorArchiveExport.test.ts`, which charges the mocked clock per download so the budget demonstrably runs out partway), and the history is why: three source-text spellings of the guard were tried first and review defeated each with a different rewrite of the same bug — the last a helper defined above the loop and CALLED inside it, textually indistinguishable from the correct code. A regex can say where an expression is written, never how often it is evaluated; don't put that guard back. The sibling property — `remoteFetch.deadline` is read exactly once, by the gate, because wiring it into `safeImageFetch` as a signal is the abort-in-flight mistake — stays a source assertion in `actorArchive.test.ts`, and legitimately: it only misbehaves once real time elapses, so catching it behaviourally would mean racing the machine the test runs on. It is wall-clock rather than a meter of time spent inside fetches, because metering the fetches leaves the run unbounded the moment the slowness comes from anywhere else. And the skipped count is reported as its OWN `manifest.json` line (`buildRemoteFetchBudgetWarning`), because "this run ran out of time" is answered by re-running with a larger budget and "these downloads failed" is not. Because nothing is aborted, the true ceiling is the budget plus one `REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS`.
- **The cap is the RESOLVED `media.maxFileSize`, threaded in as a parameter — never the `MAX_FILE_SIZE` constant.** That constant is only the default; an admin may raise the setting to `MAX_CONFIGURABLE_FILE_SIZE` (1 GiB), and `getMaxMediaUploadSize(database)` resolves env -> database -> default. Reading the constant refused a remote attachment this instance's own upload path would accept, and `S3StorageFile.ts` already resolves the setting for exactly this reason on its own buffered read. `exportActorArchive` resolves it once before the status loop (it is a database read behind a 15s cache, and the cap must not shift mid-run). Being a parameter is also what makes the byte cap testable: at a realistic 200 MiB the streaming accumulator is unreachable from a test, so a cap test pinned to the constant proves only the `content-length` short-circuit.
- **A refusal from `safeImageFetch` has three causes, the warning must not name only one, and that wording is a SECURITY property rather than operator ergonomics.** It answers `null` for an unsafe URL, for a redirect with no usable `Location`, and for exhausting `MAX_SAFE_IMAGE_REDIRECTS` — so naming only "unsafe address" sends an operator whose CDN merely chains four redirects hunting a DNS problem that does not exist. The deeper reason to keep one string for all three: `getSafeImageDownloadUrl` resolves through `lookup(...).catch(() => [])`, so a hostname that does not exist and one that resolves to a private address produce the SAME refusal. Splitting the message per cause would hand the account owner — who chose the URL — an oracle for internal DNS, telling them which names exist inside the network. Do not "improve" it into distinct messages.
- **The SPACE half of the residual is still open: the time half is now bounded across the export, the bytes are not.** `readResponseArrayBufferWithLimit` buffers, and `Buffer.concat` briefly holds both copies, so one attachment peaks near twice the resolved cap — up to ~2 GiB where an admin has raised `media.maxFileSize` to `MAX_CONFIGURABLE_FILE_SIZE` — while nothing bounds the total written into `os.tmpdir()` across an actor's whole history. `--remote-fetch-budget` bounds it only incidentally, by ending the phase that writes. The fix is the same shape as the time budget and degrades the same non-destructive way — decline to START a download once a byte budget is spent, never abandon one — and it is unbuilt, not rejected. Still strictly better than the unbounded read this replaced.
- **The archived file's extension comes from the attacker's URL and is unrelated to its bytes.** There is deliberately no content-type check (an archived attachment may be video or audio), so `extname` on the URL path is all there is. `path.extname` reads the basename, so it can never contain a separator and cannot traverse — proved against percent-encoded slashes, backslashes and `%00` — and the bytes are inert inside a tarball. It matters only if an operator ever serves an extracted archive over HTTP, which is the same shape as the `text/html`-from-`extname` bug the local media driver had.
- **The refusal tests run the REAL guard, not a mock.** Mocking `safeImageFetch` itself — as `backfillMediaBlurhash.test.ts` does — proves only the wiring, and a revert to a plain `fetch` would still pass. What makes the real guard usable in a test is that `vitest.setup.ts` mocks `node:dns/promises` to resolve every hostname to the public `93.184.216.34`, so the hostname-based happy-path tests still reach the mocked network. Note the refusal rows themselves never reach DNS: IP literals take the `isIP` branch, `localhost` is caught by the hostname-name check before the lookup, and a `http://` URL is refused on protocol before the hostname is parsed.

### A stored path is confined to the storage root

- **Every filesystem path a local STORAGE DRIVER builds runs through `resolveStorageFilePath` / `assertStorageFilePath` (`lib/services/medias/storagePath.ts`) — never a bare `path.resolve(root, filePath)`.** A stored path is data: it reaches a driver from a `medias` / `fitness_files` row, from a URL path segment, or from an archive entry, and `path.resolve` walks straight out of the root given `../` or an absolute path. The escape is silent, because the read or the unlink simply lands somewhere else on disk. `resolveStorageFilePath` answers null, for a read or delete that has somewhere to return it, and logs the refusal — the only signal an operator gets from a branch that should never fire; `assertStorageFilePath` throws, for a write whose only alternative is creating a file the driver does not own. A caller that wants its own context in the error takes `resolveStorageFilePath` and throws its own, as `scripts/maintenance/cleanupMediaStorage.ts` does.
- **The rule covers delete and write, not just read.** `LocalFileStorage.getFile` carried the check inline while `deleteFile` beside it resolved and `unlink`ed with none at all. Nearly every caller **reads** a server-generated path from a row, so it was latent rather than live — but two do not, and `GET /api/v1/files/[...pathname]` is the one that matters: it hands the CLIENT's own URL segments to `getMedia` and so to the driver. Keep its own `path.isAbsolute(normalizedPath) || /^[a-zA-Z]:/` refusal: it is what makes that a 404 at the edge. Behind it, per the bullet above, `resolveStorageFilePath` answers null on an out-of-root path and `LocalFileStorage.getFile` returns that null unchanged, leaving the ROUTE to turn it into the served placeholder. The other **derives** rather than reads: `deleteSavedMedia` (`app/api/v1/admin/custom_emojis/route.ts`) slices the tail off a `/api/v1/files/` URL and `decodeURIComponent`s it, which would turn `%2e%2e%2f` into traversal the moment its input stopped being `saveMedia`'s own output. The asymmetry is the problem: containment was an invariant of the callers, not of the driver, so it held only until someone added a caller, and it made "the storage drivers refuse such a path" false as a claim about the pair (a review of PR #1570 had to narrow a comment in `mediaFileUrl.ts` for exactly that reason). An unlink is the more damaging half. The write paths generate their own names today, so the assert there is the belt rather than the braces, and is applied anyway so confinement is a property of the driver.
- **The module lives under `medias/` and is shared, the same way `medias/fileName` and `medias/quota` already are.** `lib/services/fitness-files/localFile.ts`, `lib/jobs/importStravaArchiveJob.ts`, `scripts/maintenance/cleanupMediaStorage.ts` and `scripts/backup/actorArchive.ts`'s `copyProfileImage` import it too — it replaced the near-identical `fitness-files/path.ts` **and** the cleanup script's own hand-rolled check, which compared against a bare `path.resolve(basePath)` and so accepted a sibling directory the root's name prefixes (`/srv/uploads` accepted `../uploads-backup/x`, and then `unlink`ed it). That is why the helper appends `path.sep` to the root. Note the root itself resolves to itself; only a path that leaves the root is refused. **`copyProfileImage` is the one migration that fixed nothing**, and it is worth knowing which kind a call site is: it asked the same question with `path.relative` — `'..'`, a `..` + separator prefix, or an absolute answer — which carries the separator boundary for free and so never had the cleanup script's bug. It moved because a fourth spelling of one question is a fourth place to forget, not because it was wrong; its test pins the shared helper's log for exactly that reason, since on every input that can reach it the two forms return the same value and push the same warning, leaving the log as the only observable difference.
- **The check is CASE-SENSITIVE, and `cleanupMediaStorage.ts` inverts that — do not reconcile the two.** Its `getContainedRelativePath` resolves symlinks and, where `process.platform` says the filesystem folds case, compares segments case-insensitively, because for a tool that DELETES files, concluding "unrelated" is the expensive direction to be wrong in; here the trade is inverted and over-refusing costs nothing. No live caller reaches the difference — but resist writing down WHY as a closed list, and resist saying which platform takes which branch. Both are claims about a moving set: state the rule, not the inventory. It is the one input where the `path.relative` spelling `copyProfileImage` used disagreed, and `storagePath.test.ts` now pins the refusal as a **characterization** test — it records that the direction is deliberate, so loosening it means re-arguing the trade rather than deleting an unexplained line.
- **The check is LEXICAL, so a symlink under a storage root defeats it.** It never calls `fs.realpath`, so a link inside the root pointing outside resolves to a path that passes — a read would follow it, though an unlink would only remove the link. Both predecessors were lexical too, and nothing creates symlinks in either root (the Strava archive reader decompresses entries into memory, not onto disk, so there is no zip-slip route to plant one), which is why this stays a documented residual rather than a `realpath` call. Anything that gains the ability to create a link under a storage root changes that.
- **The call-site rule is LINT-ENFORCED, by two AST rules in `lint/agentsRules.mjs`.** `agents/no-storage-path-builder` bans `path.resolve`/`path.join` in the two local drivers, which `.oxlintrc.json` names exactly; `agents/no-resolved-path-prefix-check` bans `startsWith` against a resolved path everywhere. Both resolve names through scope, so a renamed import, a destructured `const { resolve } = path`, `path['resolve']`, `path?.resolve`, `path.posix.join` and a `require('path')` alias are all the same node — and so is a call `prettier --write` wrapped across lines, since the rule never sees text. `extname`/`dirname`/`relative` READ a path rather than build one and are untouched, as are `Array#join` and `Promise.resolve`.
- **The extracted-variable spelling is the residual these rules exist to close.** `const root = path.resolve(base); … full.startsWith(root)` carries the identical missing-separator bug as the inline form, and telling it apart from a name that merely reads like a resolved path needs the declaration — an earlier text heuristic reported an unrelated `const resolvedArchivePath = 'database.'` in `scripts/backup/productionArchive.ts` for exactly that reason. The rule follows the binding, so the string-initialised one stays quiet, and so does the correct idiom, whose prefix is built by a conditional that appends `path.sep`.
- **`scripts/**` is in `.oxlintrc.json`'s `ignorePatterns`, and dropping it from this rule would narrow coverage** — `scripts/maintenance/cleanupMediaStorage.ts` is where the one real instance of the bug was found. Un-ignoring the tree wholesale would put ~50 rules onto files that have never satisfied them (15 errors today), so `yarn lint` instead runs oxlint a **second time**, `oxlint -c .oxlintrc.scripts.json scripts`, with that one rule and nothing else enabled. Keep that config minimal: anything added to it starts linting the whole scripts tree.
- **What the rules still do NOT catch, and a reviewer is the enforcement for:** a helper module that resolves on a driver's behalf, a path built by string concatenation or `path.normalize`, a binding imported from another module, a nested destructure (`const { posix: { resolve } } = path`), and an alias chain longer than `MAX_ALIAS_DEPTH` hops.
- **Every predicate strips `TRANSPARENT_WRAPPERS` first — the node types that wrap an expression without changing the value it evaluates to.** An optional chain, TypeScript's `as` / `satisfies` / `<T>` / `!` assertions, and a bare generic instantiation (`foo<T>`), all erased at runtime. A type switch stops at any of them, they NEST, and they arrive in different POSITIONS — which is why it is a loop over a set and not a check at one site: `path?.resolve` is a `ChainExpression` AROUND the member, `path!.resolve` is a plain member whose OBJECT is the wrapper, and `path.resolve(base) as string` wraps the CALL. An inline `path?.resolve(x)` is caught with no unwrapping at all, because there the chain wraps the call and the rule reads its callee — which is exactly what hid the class. Three review rounds each found one member of it before the set banned the category instead of the spellings that turned up.
- **`MAX_ALIAS_DEPTH` counts one unit per hop.** A helper delegating within the same hop passes `depth` through rather than adding to it. Charging twice made a three-step rename fall off a budget of five — one step past the rule's own worked example — while the sibling predicate, which recurses into itself, reached four.
- **Every `TRANSPARENT_WRAPPERS` entry is pinned by a fixture that fails when it is removed; nothing goes in unpinned.** An unpinned entry is a claim the suite does not check, which is how `TSTypeAssertion` sat there proving nothing while this section promised it. `TSInstantiationExpression` was removed once as unreachable and had to be put back: `(path.resolve as unknown as GenericResolver)<string>` compiles clean under `yarn typecheck`, and with the entry gone both rules reported nothing for the call. **Mind which expression a diagnostic code describes** — bare, `path.resolve<string>` is a TS2635; add the call parens and `path.resolve<string>(a, b)` is TS2558, same file and same tsconfig, because it is a different node. Two review rounds asked for the code to be "corrected" after testing the call form.
- **These rules replaced a raw-text scan, `storagePathCallSites.test.ts`, and caught strictly more. Do not reintroduce one for this.** Five review rounds each broke a cleverer version of that file, in both directions — alias tracking fell to a destructured rename, to a nested call, and to `prettier --write` wrapping a call across lines; a substring ban fell to `path['resolve']`; an extracted-variable heuristic reported an unrelated `const resolvedArchivePath = 'database.'`; an import regex matched nothing on a wrapped import and passed VACUOUSLY; and a comment-stripping pass read the `/*` inside the MIME string `'*/*'` as a comment opener and silently blanked two thousand characters of another module. Every one of these shapes needs to know what a NAME refers to, which is scope resolution. A text scan is still right for a LITERAL token rule — that is what the other grep-style guards in this repo do — but not for a call-site invariant.
- **One property did NOT survive the move, and it is the one the old test was best at: a lint rule can be silenced with a comment.** `// oxlint-disable-next-line agents/no-storage-path-builder`, or a file-level `/* oxlint-disable */`, turns either rule off with no diagnostic and nothing reporting the suppression — where the raw-text scan could not be quietly disabled at all, since a comment naming a banned pattern FAILED it. That escape hatch is the repo-wide convention for every `agents/*` rule and is not worth revoking for these two, but it means a disable comment on one of them is a **review** event: it is the one edit that turns the guard off, and it looks like housekeeping. The driver-level traversal tests in `localFile.test.ts` still cover the existing call sites behaviourally; a NEW call site added with a suppression comment and no test is what nothing catches.
- **`lint/agentsRules.test.ts` guards both rules, and guards their WIRING separately.** Fixture-config tests prove what each rule decides, including that it stays quiet on `path.extname`, on the name-reuse shape and on the separator-boundary idiom. A second group runs the repo's OWN `.oxlintrc.json` and `.oxlintrc.scripts.json` — relocated over a fixture tree, with only the plugin path rewritten — because a rule cannot prove it is pointed at anything: an override naming a driver that has since moved reports nothing, silently. That group also asserts both driver paths exist and that `yarn lint` still runs the scripts pass.
- **The object-storage drivers are a different question.** An S3 key has no filesystem root to escape, so `medias/S3StorageFile.ts` and `fitness-files/S3StorageFile.ts` are deliberately not covered by this.
- Covered by `lib/services/medias/storagePath.test.ts` and `lint/agentsRules.test.ts`, plus driver-level regression tests in `lib/services/medias/localFile.test.ts`, `lib/services/fitness-files/localFile.test.ts` and `scripts/backup/actorArchive.test.ts` — including a storage root configured **relatively**, which is what `ACTIVITIES_MEDIA_STORAGE_PATH`'s `./uploads` default ships.
- **"Is this string shaped like traversal?" is a DIFFERENT question from "does this resolve inside THIS root?" — do not fold one into the other.** A shape check takes no root, has to run after decoding, and is where over-refusing `\` and NUL for Windows operators belongs — that is `isTraversingStoragePath` (`lib/services/medias/mediaFileUrl.ts`, from #1569), which is what a path recovered from a URL needs. `resolveStorageFilePath` takes exactly one root, is meaningless without it, and is what a path handed to a storage driver needs. Neither subsumes the other — `scripts/backup/actorArchive.ts`'s `copyProfileImage` is the clearest illustration, because it is behind both: the shape check refuses the traversal at URL recovery, and the root check refuses it again at the copy, where the root is finally known.
- **`productionArchive.ts` keeps its OWN containment check, and that is not drift.** `scripts/backup/productionArchive.ts` builds paths under the same storage roots through `assertRelativeFilePath` / `normalizeStoragePath`, which reject any `..` outright — stricter than this module, and applied to an archive entry's name rather than to a root-relative stored path. They answer a different question on different input; what this module owns is the drivers.

### The archive manifest withholds where storage lives

- **`manifest.json`'s `storage[].failedFiles[].error` never carries a storage-driver message.** `redactStorageSource` (`scripts/backup/productionArchive.ts`) keeps only `kind` and `prefix`, dropping the bucket, region, endpoint, CDN hostname and local root — and that field sits in the same manifest, so it used to put all of that straight back. An export run with `--allow-missing-storage` against a private-network MinIO shipped `getaddrinfo ENOTFOUND minio.internal` inside the tarball; the local driver shipped `ENOENT: … copyfile '/srv/uploads/…'`. **This binds the actor archive too** — `scripts/backup/actorArchive.ts` imports the same `archiveStorage`, and that manifest is handed to the user whose data it is, not to the operator.
- **The claim is about that one field, not the whole manifest.** `actorArchive.ts`'s own `warnings` array, serialized into the same `manifest.json`, still interpolates a raw `error.message` for a failed **remote** attachment fetch. That is deliberate and is not the same disclosure: the fetch is to a third-party host whose URL the warning already names on purpose, and the messages that describe the fetch are `fetch failed`, `HTTP <status>` and `This operation was aborted`, none of which names this instance's own storage. That `try` also spans `new URL` and the staging-directory write, so a local `EACCES`/`ENOSPC` can land there naming the STAGING path — still not the storage root, and still not what `redactStorageSource` withholds, but do not read the list as exhaustive. Do not read the bullet above as covering it, and do not "fix" it by pointing `redactStorageError` at a remote URL it has no source to redact against.
- **`redactStorageError` is an ALLOWLIST, not a scrubber, and that is the point.** It reports the syscall, code, name and HTTP status — `getaddrinfo ENOTFOUND`, `copyfile ENOENT`, `NoSuchKey HTTP 404`, `HTTP 503` — and never the message. A message is free text a driver interpolates whatever it likes into, so a denylist over one is a guess about the forms someone thought of; an allowlist is a guarantee. Two filters back it: a **shape** check (`/^[A-Za-z][A-Za-z0-9_]{0,63}$/`) refuses anything carrying a dot, dash, colon, slash or space, which is what keeps `minio.internal`, `10.4.2.11` and `activitynext-prod-media` out without naming them; on the S3 path **all three of `code`, `name` and `syscall` are whatever the storage server sent** — none is a libuv constant, so never relax the shape check for `code` or `syscall` on the belief that it is one (the mechanism is recorded at the filter) — and a **value** check refuses any token equal to something `redactStorageSource` dropped, for the single-label case the shape check cannot see (a Docker-network `hostname: 'minio'`). Both derive from one definition of "sensitive about a storage source", so a **string** field added to `StorageSource` later is withheld from both halves for free. A non-string one is not, and has to be taught to the value set by hand — the filter records why.
- **It withholds the LOCATION, not every trace of the backend.** A vendor code such as `XMinioStorageFull` still names the storage software. That fingerprint is the price of a code an operator can act on and is worth paying — so state the trade rather than writing that the output says nothing about storage.
- `unknown` is the honest answer for a failure that classifies itself only in its message, and the loss is bounded: **the export console still prints the driver's message in full**, on the operator's own machine, as each file fails. That is why the console line is deliberately NOT redacted — it never enters the archive. The status on our own public-storage failure is attached to the thrown error as `httpStatusCode` rather than only interpolated, because only a structured field survives the allowlist. **And the redactor itself must never throw**: it runs inside the `catch` that lets `--allow-missing-storage` continue, so it falls back to `unknown` rather than turning one tolerated missing file into a failed export.
- Covered by `scripts/backup/productionArchive.test.ts` — a table over `redactStorageError` plus five `archiveStorage` tests that assert the whole manifest, serialized, contains no internal hostname, bucket name, bare IP or local storage root. Reverting the call site to `error.message` fails all five plus the pre-existing partial-file test, and the fifth — which drives the S3 → public-storage fallback — is additionally the only thing that notices if the `httpStatusCode` attachment is dropped. `MAX_ERROR_CAUSE_DEPTH` is pinned in both directions by a chain that resolves at the cap and one that truncates past it.

## Database Backends & Local Setup

- Supported backends: SQLite (`docs/sqlite-setup.md`) and PostgreSQL (`docs/postgresql-setup.md`). MySQL-compatible Knex configuration paths also exist and should not be broken casually.
- Local SQLite is the simplest for development; run `yarn migrate` after updating schema or migrations.

### Keeping the reference schema dumps in sync

There are **two** committed reference schema dumps, one per supported backend.
Use the one that matches the database you are reasoning about:

- **`migrations/schema.sql`** — the **PostgreSQL** schema (a `pg_dump`). Use it when inspecting the schema for PostgreSQL deployments.
- **`migrations/schema.sqlite.sql`** — the **SQLite** schema (a `sqlite3 .schema` dump). Use it when inspecting the schema for SQLite — which is what local dev and the Vitest test suite use (tests run against in-memory SQLite). Because the two backends use different SQL dialects (e.g. `character varying`/`jsonb`/`timestamp with time zone` vs `varchar`/`json`/`datetime`), the Postgres dump cannot be loaded into SQLite and vice versa — always read the file for the right backend.

"In lockstep" means they describe the same migration set, **not** that every column has the same type in both. A migration may deliberately be backend-conditional, and then the dumps legitimately disagree: `20260207223000_fix_attachments_media_id_type.js` returns early unless the client is `pg`, so `attachments.mediaId` is `integer` on PostgreSQL and stays `varchar(255)` on SQLite. That is not drift — do not "reconcile" it or regenerate the dumps over it. Check the migration before treating a per-column difference as a bug.

The app (`yarn migrate`) runs Knex migrations, but the test suite does **not** — `lib/database/testUtils.ts` builds every test database directly from these dumps (see Testing Guidelines). If the dumps drift from the migrations, tests run against a stale schema, so keeping them in lockstep is load-bearing, not just hygiene. They are gitignored by the blanket `*.sql` rule and re-included by explicit `!` negations in `.gitignore`.

- **Any PR that adds, edits, or removes a Knex migration in `migrations/` MUST regenerate BOTH `migrations/schema.sql` and `migrations/schema.sqlite.sql` in the same PR.** Keep them in lockstep — they must always describe the same migration set. CI's **Schema Dump Sync** job regenerates the SQLite dump from the migrations on every push/PR and fails on drift; the PostgreSQL dump has no CI gate, so regenerating it stays on you.
- Regenerate them canonically rather than hand-editing — run every migration against a fresh database of each type and dump the result. In both cases verify `SELECT count(*) FROM knex_migrations` equals the number of `migrations/*.js` files first.

  Pass the DB settings **inline** on the `yarn migrate` line — do **not** write a `.env.local` (you'd clobber an existing one, and the cleanup would delete it). Because `knexfile.js` uses `dotenv-flow`, which never overrides variables already in the environment, inline values win over any `.env.local`; for the same reason, run in a shell with **no** other `ACTIVITIES_DATABASE*` vars exported (a stray one would be merged in and could target a remote DB — check `env | grep ACTIVITIES_DATABASE`).

  **PostgreSQL (`migrations/schema.sql`):**
  1. Start a **local** PostgreSQL 17 (e.g. a throwaway `postgres:17` Docker container, or the docker-compose stack) and wait until it accepts connections (`docker run -d` returns before `initdb` finishes; loop on `pg_isready`). Never point at a remote/shared/production DB.
  2. Run migrations with the settings inline: `ACTIVITIES_DATABASE_CLIENT=pg ACTIVITIES_DATABASE_PG_HOST=… ACTIVITIES_DATABASE_PG_PORT=… ACTIVITIES_DATABASE_PG_USER=… ACTIVITIES_DATABASE_PG_PASSWORD=… ACTIVITIES_DATABASE_PG_DATABASE=… yarn migrate`.
  3. Dump schema only, without ownership/grants: `pg_dump --schema-only --no-owner --no-privileges` (run it against the PG 17 server so the dump matches that version).
  4. Strip pg_dump's noise to match the existing pure-DDL file: the `\restrict`/`\unrestrict` session token (non-deterministic — never commit it), the `-- …` comment headers, and the `SET default_tablespace` / `SET default_table_access_method` lines. Keep the leading `SET`/`SELECT pg_catalog.set_config(...)` block and all `CREATE`/`ALTER` DDL.

  **SQLite (`migrations/schema.sqlite.sql`):**
  1. Run migrations against a throwaway file DB with the settings inline: `ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=./schema-dump.sqlite3 yarn migrate`.
  2. Dump the schema with `sqlite3 ./schema-dump.sqlite3 .schema`.
  3. Strip SQLite's auto-managed internal tables, which it recreates on its own and which must NOT be in the file: the `CREATE TABLE sqlite_sequence(...)` line, and the FTS5 shadow tables (`CREATE TABLE IF NOT EXISTS '<name>_fts_(data|idx|docsize|config|content)'`). Keep the `CREATE VIRTUAL TABLE … USING fts5(…)` statement and its triggers — those are real. A quick sanity check: `sqlite3 /tmp/x.sqlite3 < migrations/schema.sqlite.sql` should load cleanly.

  Then remove the throwaway container / `.sqlite3` file; only the two schema files should change.

- A Postgres regeneration is a full re-dump, so its diff can be large even for unchanged tables (formatting differs from older dumps). That is expected — do not try to reproduce the old line-by-line formatting by hand. Commit the schema regeneration as `none:` when it is the only change (they are reference artifacts and ship nothing).
- **Use only a local database for local dev/tests:** SQLite on `localhost`, or the docker-compose PostgreSQL at `activities.local`. Never connect local dev, tests, or user creation to a remote/shared/production database.
- Tests use isolated SQLite in-memory databases for fast, parallel execution.
- Docker users should persist data under `/opt/activities.next/data` (bind-mount a host directory there and point the SQLite/media env vars into it). Do **not** bind-mount `/opt/activities.next` itself — that directory contains the application (standalone `server.js`, `.next/static`, …), so a host-path mount shadows the app and the container cannot start (see `docs/setup.md` and the database setup guides).

## Local Usernames Are Actor-Id Path Segments

- **A local username is validated by ONE schema, `localUsernameSchema` (`lib/services/accounts/localUsername.ts`), because the charset is a correctness rule rather than a style preference.** `getLocalActorId` builds `https://${domain}/users/${username}` and does **not** percent-encode it, so the username IS a path segment of the actor's canonical id — and a path segment is percent-**decoded** on the way back in. Both creation paths used to let `%` through: `POST /api/v1/accounts` had an **unanchored** `/\w+/` (which only requires one word character _anywhere_, so `%6eull`, `nul%6c` and `a%2Fb` all passed) and `POST /api/v1/actors` had no charset check at all, only a length. So an account could be registered whose stored, federated id was `https://<domain>/users/%6eull`, and dereferencing that id decoded the segment to `null` and served whichever actor owns THAT name — their Person document, their public key, their outbox and followers — under a URI belonging to someone else. Proved against Next's own route matcher: `/api/users/%6eull` and `/api/users/nul%6c` both match as `{ username: 'null' }`. This is not hypothetical here, where the owner's account is genuinely named `null`. It is identity/URI confusion, **not** signature forgery — the holder of the alias has no private key for the actor whose document is served — but `Block` and the `Undo` handlers pass the guard-resolved `actor.id`, so those do land on the impersonated actor.
- **Anchoring is the whole point, so pin it with a test rather than trusting the regex to read correctly.** Both the unanchored-`/\w+/` revert and dropping `^`/`$` from `LOCAL_USERNAME_PATTERN` leave a schema that still rejects `''` and `..`, so it looks like it is working; `localUsername.test.ts` and the two route-level suites fail on the percent-encoded cases specifically.
- **Do NOT unify it with the `USERNAME_PATTERN` in `getFallbackBlockedAccount`/`getFallbackMutedAccount`.** Those decide whether a **remote** actor id's last segment is safe to _display_ as a username. A remote server may legitimately mint names this instance refuses, so the two rules only look alike; sharing one constant would let a change to the local minting rule silently move what remote names render.
- **Sharing the schema also newly bounds a registered username at `LOCAL_USERNAME_MAX_LENGTH` (50), which registration did not previously enforce at all** — `POST /api/v1/actors` carried that limit, `POST /api/v1/accounts` carried none. That is a deliberate tightening rather than a preserved rule: `actors.username` is `varchar(255)`, so a longer name was storable and a 256-character one overflowed the column and 500'd on PostgreSQL instead of being refused.
- **Validation is on creation only, so it cannot clean up rows that already exist.** An instance already holding a `%` in a username, or a name longer than the cap, keeps it — the schema is only consulted when a name is minted. If an instance has been running with the old schemas, check the stored usernames for a `%` before assuming the alias cannot already be present.

## Local Actors ("does this server host this actor?")

- **The SQL test is `privateKey IS NOT NULL AND privateKey <> ''`, and it belongs to `whereLocalActor` (`lib/database/sql/utils/localActor.ts`) — never write either half by hand.** Actor rows written by earlier remote-recording paths store the key they do not have as an **empty string**, not NULL. A null-only check therefore counts them as local: on production that was **216 of the 221** rows it matched, all on remote domains, which made the logged-out local timeline majority-remote. (It also put every domain those actors live on into `getLocalFollowersForActorId`'s "local domains" set — real, but unreachable: that method currently has no production callers.) `20260821120000_normalize_empty_actor_private_key.js` rewrites the stored `''` to NULL; the `<> ''` half stays anyway, for databases restored from an older dump. Applied via knex's `modify`, which works mid-chain and inside a `whereExists` callback: `query.modify(whereLocalActor, 'actors.privateKey')`.
- **`.modify()` returns `QueryBuilder<any, any>` and erases the row type.** Where the rows are consumed as a typed shape afterwards, name it on the `select` (`.select<SQLActor[]>('actors.*')`) or the next `.map` parameter becomes an implicit `any` and the build fails.
- **The JS test is truthiness — `Boolean(actor.privateKey)` — never `actor.privateKey !== ''`.** `getActorFromRow` omits `privateKey` from the domain object unless it is truthy, so the field is a real key or `undefined` and is **never** the empty string. `!== ''` is therefore always true: it reads like a local-actor filter and filters nothing. That is what let `addStatusToTimelines` fan every status out to remote recipients, giving them home-timeline rows and reply/mention notifications on accounts this server does not host.
- **The local public timeline must NOT join `actors`; it passes the local actor ids in as literal values** (`localPublicStatusesQuery`, `lib/database/sql/timeline.ts`). Joining on `actors.id` — a unique key — leaves the planner no statistic correlating an actor with how much it posts, so it assumes an even spread. On production that under-estimated the eligible rows ~48x (150 against 7,262) and the plan changed with `limit` alone, crossing over at 24: a page of 23 ran the ordered index scan in ~1ms, while the API's own default of 30 flipped to a parallel sequential scan of `actors` plus a sort — ~88ms and 35,108 buffers. A local seed reproduces production's row counts but not its statistics, so it does not show that crossover; what it shows is worse. Buffers at limit 23/24/30 on a local PostgreSQL 17 seeded to production's shape: **literal ids 137/142/176; either join form carrying `<> ''` ~16,700 flat at every size; the same join with `IS NOT NULL` alone ~160/~164/~200.** PostgreSQL compiles the inner join and the `whereExists` fallback to one plan, so the fallback is not the cheaper shape; only the literal-id form early-terminates (`Heap Fetches: 0`), which is why it is the only figure quoted exactly. So it is the CORRECTNESS predicate that costs the plan — with it present, either join form loses early termination at _every_ page size, and widening the partial `actors_local_idx` predicate to match does not recover it. The id read is itself capped at one past what the query can bind (`getLocalActorIdLimit`) — it runs on an anonymous path, and above the cap the list is discarded in favour of the semi-join, so fetching it whole would be pure waste. **Adding `<> ''` to the join form without switching to literal ids makes this query dramatically worse** — the two halves of that change are not separable. `localPublicQueryShape.test.ts` pins the shape, because every result-based assertion passes against the slow one.

## Who May See an Actor's Statuses

- **`getActorStatuses` and `getAttachmentsForActor` FAIL OPEN: with none of `publicOnly`, `visibleToActorId` or `includeFollowersOnly` set, no visibility predicate is applied at all.** That is a real mode, not an oversight — it is how the owner sees their own private posts, and how `scripts/backup/actorArchive.ts` exports a complete history — but it means a caller that simply forgets the arguments gets the unfiltered query and no error. The profile page forgot them: `getProfileData` passed only `currentActorId`, which is **hydration-only** (it decides like/bookmark/reaction state, never which rows come back), so `/@user@domain` server-rendered the actor's followers-only posts and their direct messages **to logged-out visitors**, and the `getAttachmentsForActor` call beside it put those posts' images in the Media tab. `GET /api/v1/accounts/:id/media` — the "Load more" behind that tab — served the same set to anyone, with no session at all.
- **Resolve the audience with `resolveActorStatusesAudience` (`lib/services/statusAccess.ts`); do not spell the four arguments out per call site.** It answers `{ isOwner, isFollower, publicOnly, visibleToActorId, includeFollowersOnly, followersAudience }` from `(targetActor, currentActor)`, and it takes `Actor | null | undefined` deliberately. The `publicOnly: currentActor === null` spelling the statuses route used is safe **there** — `OptionalOAuthGuard` hands its handler `Actor | null`, never `undefined` — but it is not safe as a general rule: `getProfileData`'s viewer arrives through an OPTIONAL field a caller can simply omit, which the followers and following pages did, and for `undefined` that comparison is false, so the viewer reads as signed-in and all three arguments come out falsy. Normalising inside the resolver is what makes an omitted viewer fail closed instead of unfiltered.
- **The viewer's own follow row is read through `getViewerFollow` (`lib/services/getViewerFollow.ts`) on read paths, and through `database.getAcceptedOrRequestedFollow` everywhere else.** Rendering `/@user@domain` for a signed-in non-owner asks for that one row twice from two places that cannot see each other — `resolveActorStatusesAudience`, to decide whether followers-only posts are in scope, and `getRelationship`, for the follow button's state plus its reblog/notify preferences and language filter — so the helper wraps the lookup in React `cache` and the two collapse into one query per request. It takes `(database, viewerId, targetActorId)` **positionally**: `cache` keys on argument identity, so the options-object spelling the database method itself uses would allocate a fresh key on every call and memoize nothing. **Read paths only.** Follow, unfollow, block and follow-request authorize/reject each read the row, mutate it, then report the result through `getRelationship`; they reach the helper only _after_ their own write, which is a cold read, and routing one of their pre-mutation reads through it would make the response describe the state they just replaced. `canActorReadSingleStatus` stays on the direct call, and that is a scope boundary rather than a claim that it never repeats — it does. It asks about whoever wrote a boosted ORIGINAL, once per status in `getProfileData`'s own per-status pass with no `followerStateByActorId` prefetch, so a profile carrying two boosts of the same followers-only author issues that query twice. Routing it through the helper too would collapse that as well and is safe, but it reaches a dozen further call sites (inbox handling, status create/edit, search, polls), most with no request scope at all, so it is left for its own change.
- **The SQL scope is necessary but not sufficient — pair it with `canActorReadStatus`.** The recipients predicate matches a status's own audience and cannot see through a boost: an Announce is public while the status it boosts may not be. Every status-serving path does both (`GET /api/v1/accounts/:id/statuses`, the outbox route's `isStatusPubliclyReadable` pass, and now `getProfileData`).
- **One subquery decides both tables.** `buildActorVisibleStatusIdsQuery` (`lib/database/sql/status.ts`) returns the actor's visible status ids, or `null` for the unfiltered mode; `getActorStatuses` filters `statuses.id` by it and `getAttachmentsForActor` filters `attachments.statusId` by it, so an attachment is withheld from exactly the viewers its post is. Never scope one without the other — a gallery that outlives its timeline's filter leaks the same posts as image URLs.
- **Where a required argument fits, use it; `lib/database/statusVisibilityCallSites.test.ts` covers the case where it does not.** `getProfileData`'s viewer IS required (`currentActor: DomainActor | null`, and the options object with it), so the compiler rejects an omission — which is what the original bug was — at every call site, including ones no directory scan would reach. The two database methods are the case a type cannot serve: their unfiltered mode is legitimate, so a required discriminant would make both honest callers restate an intent it still could not verify, and rewrite hundreds of existing calls. Those are enforced by the test instead: every call must state a visibility argument, spread or name a local object that carries one, or carry the `visibility-unfiltered` marker in a comment explaining why. It reads the AST rather than matching names — a name-based rule was defeated four times, by a `...maxIdScope` pagination cursor, by a decoy named for an audience carrying no viewer, by an aliased import that made a call site vanish entirely, and by `database?.getActorStatuses(…)`, whose optional chaining hid it from the walk. Its one documented blind spot is a default re-export, which needs cross-module resolution.

## Publicly Readable Status Ids

- **There are two forms of this predicate, and the choice between them is measured rather than stylistic: correlated where a LIMIT bounds the rows, set-based where a COUNT has to touch every one.** `wherePubliclyReadableStatus` (`lib/database/sql/utils/publiclyReadableStatus.ts`) tests one row at a time, so an ordered index scan can early-terminate; `buildPubliclyReadableStatusIdsQuery` materialises the readable ids as a set, which the planner must finish before `LIMIT` sees a single row. `getActorStatuses({ publicOnly: true })` — the signed-out profile page and the outbox page — attached the set form and therefore cost the actor's ENTIRE public history on every page load: 116.9ms / 25,066 buffers on production for 30 rows, and on a PostgreSQL 18.6 seed shaped like it (176,000 statuses, 14,900 actors, 435,500 recipients, an actor with 2,097 statuses of which 1,889 are publicly readable and half are Announces) **33,308-33,311 buffers at limits of 20, 30 and 40 alike** — the limit bounded nothing — against **325/476/573** correlated, and ~23ms against 0.46/0.63/0.74ms. A deep page (cursor 1,500 rows back) is 33,311 / 22.0ms against 1,888 / 2.2ms: the cursor's `OR` spelling is a filter rather than an index start condition, so the correlated cost grows with page depth, but linearly instead of constant-and-huge. **No index was added** — `statuses_actorId_idx` already serves the ordered scan (Index Scan Backward, plus an Incremental Sort for the `id DESC` tiebreak that index does not carry) and `recipients_actorId_statusId_idx` already serves the semi-join at `Heap Fetches: 0`. A seed reproduces production's row counts, not its statistics; what it reproduces here is the PLAN — same parallel recursive CTE, same ~4,100 `recipients` index searches, same 1,889-row HashAggregate and pkey nested loop.
- **TWO call sites keep the set form, for two different measured reasons, and neither is an oversight to tidy up.** `getActorStatusesCount` keeps it because the correlated form costs one recursive-CTE instantiation per Announce row: a LIMIT amortises that over a page, a COUNT cannot amortise it at all, and on the seed it read 40% fewer buffers and still took three times as long (15,421 buffers / 54ms against 25,752 / 18ms). `getRebloggedBy` keeps it for a sharper reason — it embeds its filtered reblog set **twice**, once as the `visible_reblogs` FROM subquery and again inside the correlated `whereNotExists` that dedupes to each actor's newest reblog, so a correlated predicate is re-evaluated per row PAIR while a materialised id set is computed once and shared. Its candidate set is not this status's reblogs either: `reblogBase`'s legacy `originalStatusId IS NULL` branch admits every pre-backfill Announce in the instance, so the correlated cost scales with instance-wide legacy Announce volume. Measured: **49,474 buffers / 33ms set-based against 11,383 / 415ms correlated** — four times fewer buffers and twelve times the wall clock. That one was shipped correlated and caught in review, which is why the shape test now pins it. `getStatusReplies` and `getStatusRepliesCount` DID move: one status's replies are a small set and both forms measure the same (1,451 buffers / 1.1ms against 1,467 / 1.3ms; 1,448 / 1.1ms against 1,464 / 1.2ms). **Being unlimited is not by itself disqualifying — `getStatusRepliesCount` is an unbounded COUNT on the correlated form. What costs is the number of evaluations.**
- **Do NOT add a "check depth 1 first, then recurse" fast path to the correlated form.** Spelling the common case as its own correlated `EXISTS` reads like an obvious win and is a disaster: PostgreSQL decorrelates it into a **hashed SubPlan**, sequentially scanning every non-Announce status in the instance and hashing every public recipient row to answer one page. On the seed that turned 476 buffers into 11,294 and 0.63ms into 82ms, and the count into 123ms. The recursive CTE resists that rewrite, which is the only reason the predicate reads as one branch instead of two. Both PostgreSQL and SQLite accept an outer column reference inside a subquery's recursive CTE; MySQL does not, so only the chain forks there — to the same one-hop form its branch of the set builder has always had.
- **`publiclyReadableStatusQueryShape.test.ts` pins which form each call site uses, and it is the only thing that would catch a swap in either direction.** Putting `getActorStatuses` back on `whereIn(id, buildPubliclyReadableStatusIdsQuery(…))` leaves all 169 tests in `status.test.ts` and the whole equivalence suite green — the two forms select identical rows, which is the point — and fails exactly the two assertions that read the SQL. It pins the set form for `getActorStatusesCount` and `getRebloggedBy` the same way. Separately, `publiclyReadableStatusCallSites.test.ts` asserts each `publicOnly` call site actually drops a followers-only row: deleting the filter outright from `getStatusReplies`, `getStatusRepliesCount` or `getRebloggedBy` used to leave the entire suite green. `getStatusRepliesCount` is the one with no backstop — the ActivityPub route handlers re-filter `getStatusReplies`'s array with `isStatusPubliclyReadable`, but the count flows straight into the replies collection's `totalItems`. For `getActorStatuses` the distinguishing fixture is a **public boost of a followers-only note**: the recipients-only fallback returns it and only the announce chain drops it.
- **There is no counter for the public status count, and there cannot be one.** `getActorStatusesCount({ publicOnly: true })` — the ActivityPub outbox's `totalItems` — is the one status count that is computed rather than read from `counters`. An Announce is publicly readable only while the status it boosts still is, and that status belongs to a **different** actor, whose visibility edits and deletes never touch this actor's rows. So a stored `total-public-status:<actorId>` would need fan-out from every other actor's writes to stay exact. The plain total (`publicOnly: false`) has no such dependency and does read `CounterKey.totalStatus`.
- **What cannot be a counter can still be cached for a minute: the outbox root serves `totalItems` through `getCachedActorPublicStatusesCount` (`lib/services/statuses/actorPublicStatusesCount.ts`) and sends `Cache-Control: public, max-age=60, s-maxage=60`.** The count above is ~100–160ms of CPU over the actor's whole public history, and nothing deduplicated it: on 2026-08-25 a burst of 530 outbox root fetches in 11 minutes each recomputed it and queued behind one another on a 1-vCPU Cloud SQL instance, taking the query's **average wall time to 899ms against ~150ms of real work** — the executions were waiting for CPU, not doing more of it (~4 CPU-sec/sec demand against a capacity of 1; no IO wait, no lock wait). A count that lags by up to a minute is within what the collection already promises, since the paragraph above is exactly the argument that it cannot be exact anyway. **The cache bounds a burst in two ways and needs both**: the TTL bounds requests arriving after a count is computed, and caching the PROMISE collapses the ones arriving while it still runs — at ~150ms a count, a real share of them. **Do not drop the concurrent-miss collapsing on the grounds that the CDN absorbs bursts.** That was assumed once and does not hold: a shared cache may key on headers that differ per request, and a signed server-to-server fetch — what federation actually sends — carries several, so each takes its own entry and collapses into nothing. llun.dev's CloudFront policy keyed on `Signature` and `Date` when this was written, but that config lives outside this repo and nothing here can verify it stays that way, which is the point — whether a given deployment's cache collapses a burst is a property of its configuration, not of this response. An unauthenticated caller can also vary an ignored query parameter to the same effect. The origin must survive a burst alone; the header is a third layer, not the load-bearing one. Caching the promise rather than the resolved count is also what keeps this to ONE map with no in-flight bookkeeping and no reasoning about which settles first — `getMySQLFullTextMinTokenSize` (`lib/database/sql/search/documents.ts`) is the same pattern, down to deleting the entry on failure. Errors are never cached: a rejection removes the entry, and every waiter sees it rather than hanging. Keyed `WeakMap<Database, Map<actorId, …>>` — per database so the production singleton caches while each test's throwaway resolves independently, per actor because one instance serves several including the headless signing actor, and **bounded**, because entries expire but nothing sweeps them and remote servers choose which actors get fetched.
- **The outbox root's cacheability is a per-branch, per-header decision, and both branches state it.** The header is on the **root only**; `?page=true` sends an explicit `Cache-Control: no-store` rather than relying on the ABSENCE of a header — its `orderedItems` reflects live per-status visibility, so a status hidden mid-window must stop being served at once, and omitting the header asserts nothing, it just defers to whatever the cache in front does with an unlabelled 200. The root also **`Vary`s on `x-activity-next-host`, `x-forwarded-host`, `Host` and `Origin`**, which is not decoration: `headerHost` trusts the two custom headers ahead of `Host`, so on a multi-domain instance the same path serves a different actor — different `id`, `first`, `last` and count — per header, and a shared cache that forwarded them without keying on them would serve one domain's collection for another's. `Origin` is there because `getCORSHeaders` reflects it into `Access-Control-Allow-Origin`. `activityPubResponse` grew an `additionalHeaders` pass-through for all of this. It **appends**, which cuts both ways: `Vary` is a list header so a caller's entry correctly joins the `Accept` it already sends, while `Content-Type` is single-valued and a second one corrupts it into `a/b, c/d` — pass `contentType` for that. A CDN still only honours any of these if its cache key includes them.
- **Count straight off `buildPubliclyReadableStatusIdsQuery` when the outer query adds nothing beyond the subquery's own scoping — but check that it doesn't first.** `getActorStatusesCount` was `where actorId = ? and id in (<subquery>)`, and the subquery is already scoped to that actor's statuses, so the outer half re-applied a settled predicate at one `statuses_pkey` lookup per returned id plus a sort for the `COUNT(DISTINCT)`: 7,884 of 37,731 shared buffers on a PostgreSQL 18 seed shaped like production (500k statuses, an actor with 2,000 of them, half Announces). **`getStatusRepliesCount` is deliberately NOT that case and must keep its outer query** — the reason is recorded at that filter in `lib/database/sql/status.ts`, and `lib/database/sql/status.test.ts` pins it with a row no writer can produce, because dropping the filter moves no number anyone can observe.
- **The announce chain is followed through one pointer column, `COALESCE("originalStatusId", content)`, not an `OR` of the two forms.** Modern Announce rows set both; legacy rows only ever wrote the original's id into `content`. Spelling that as `originalStatusId = id OR (originalStatusId IS NULL AND content = id)` makes PostgreSQL build a `BitmapOr` of two `statuses_pkey` probes per row, and forces the recursion's working table to carry the wide `content` text for every row — including the Notes that never follow a pointer. The `CASE` guard on `type` is what keeps a Note's body out of that column. Together with the point above: **37,731 → 27,018 buffers and 71 → 36 ms** for the count, 37,734 → 34,905 buffers for the outbox page. **Both dialect branches build the pointer from the one `announceOriginalPointer` helper, and that is all they share** — the MySQL branch's own comment records what it does not do. Sharing the pointer is what keeps the two from drifting further, since MySQL has no CI coverage at all.
- **Both the pointer's `COALESCE` order and knex's binding order are pinned by compiled-SQL assertions, because getting either wrong still produces a query that runs.** The hazards themselves are documented at `announceOriginalPointer` in `lib/database/sql/status.ts`. What the tests add: `COALESCE("originalStatusId", content)` must keep that precedence, since `20260517000000_add_status_original_status_id.js` backfilled `originalStatusId` by JSON-parsing `content` and left the raw body behind, so migrated rows hold two different non-null strings and only `originalStatusId` names the boosted status — yet `createAnnounce` writes the two identically, so no fixture built through the normal path can tell the orders apart. Both spellings return a plausible number, so a behaviour test needs a **hand-written** row where the two columns disagree.

## Composite Index Column Order on `statuses` (PostgreSQL 18)

- **Order a composite index so the columns EVERY caller constrains come first.** `statuses_announce_original_actor_idx` is `(type, "originalStatusId", "actorId")` and `20260822000000_reorder_status_announce_index.js` put it that way round deliberately. `20260517000000` had created it as `(type, "actorId", "originalStatusId")`, which serves `hasActorAnnouncedStatus`, `getActorAnnounceStatus`, `getActorAnnouncedStatusId` and the batched announce hydration in `getStatusesHydrationContext` — all four pin all three columns, so the order is invisible to them and to every result-based test. It does **not** serve `getRebloggedBy` (`GET /api/v1/statuses/:id/reblogged_by`), which pins `type` and `originalStatusId` and leaves `actorId` free: with `actorId` in the middle, `originalStatusId` cannot become an index condition, so that endpoint bitmap-scanned every Announce row and filtered. Production's plan on 2026-08-22: **8,973 buffers / 18.4 ms, 19,892 rows scanned to return 1**, growing linearly with the Announce count forever. `statusAnnounceIndexOrderMigration.test.ts` reads the index definition rather than asserting the index merely exists, because a revert is functionally identical.
- **Do not rewrite `getRebloggedBy`'s predicate to use `announceOriginalPointer`.** #1493 introduced that helper for the outbox CTE, where the pointer is a **projection** — `case when type = 'Announce' then coalesce("originalStatusId", content) end` — and collapsing the two-branch `OR` there was the whole win. `getRebloggedBy` uses the same two forms as a **predicate**, and `WHERE coalesce("originalStatusId", content) = ?` is an expression over two columns that no plain column index can serve: it would undo this change and put the endpoint straight back to scanning every Announce row. The `OR` form is what lets PostgreSQL build a `BitmapOr` of two index conditions — `(type, "originalStatusId") = ('Announce', $1)` and `(type, "originalStatusId" IS NULL)` — against the reordered index. Unifying the two call sites looks like tidying and is a regression.
- **PostgreSQL 18 will pick an index whose leading column your query does not constrain, and that is usually fine — do not chase it.** This was investigated twice (PR #1468, then again after #1484) before anyone measured the alternative. PG 18's B-tree skip scan makes `(type, …)` a candidate for an `actorId`-only lookup by skipping the three `type` values, and `cost_index` prices the heap I/O from the **leading** column's `correlation`, which a low-cardinality column scores high on for no real reason — production reads `type` at 0.787 against `actorId` at -0.181. So the planner believed the announce index was ~30% cheaper than `statuses_actorId_idx` while it actually read ~5% **more** buffers. That is the whole effect: an `actorId`-only lookup is dominated by heap fetches, which are the same set either way (production: 1,955 of ~2,000 buffers are heap). On a local PostgreSQL 18.6 seeded to production's shape the two came out at 1,911 and 1,902 buffers. Reordering the announce index takes it out of the running as a side effect; it was never the reason to reorder.
- **There is no `enable_indexskipscan` GUC.** PostgreSQL 18.6 exposes no toggle for skip scan (the diagnostics script dumps every `enable_*` setting, and it is not among them), so there is no read-only way to A/B it on a live server. Do not A/B by dropping an index on production either, even inside a transaction you mean to roll back: `DROP INDEX` takes an ACCESS EXCLUSIVE lock and blocks every query on the table until the rollback. Measure it on a local seed instead.
- **`statuses_actorId_idx` (`actorId`, `createdAt`, `updatedAt`) is load-bearing even though plans often name a different index for `actorId` predicates.** It is what the owner's profile timeline (`getActorStatuses` with no visibility filter) scans backward to satisfy `ORDER BY "createdAt" DESC, id DESC LIMIT 30` with `Index Searches: 1` and early termination — 29 buffers on production, against 693 on a seed with the index removed — and what the nodeinfo active-user rollup uses as an index-only scan with `createdAt` as a second index condition. Production has scanned it 3.8 million times since 2026-03-09. Seeing another index in one plan is not evidence it is unused; check `pg_stat_user_indexes.idx_scan` before proposing to drop it.
- **A local seed reproduces row counts and column widths, not statistics.** Match the shape that matters — row count, distinct values per column, average heap bytes per row, and the physical insert order, since scattered inserts are what leave `actorId` uncorrelated — then say "seeded to production's shape", never "reproduced production's plan". The seed for this work matched production to within ~2% on statuses, type mix, distinct Announce originals and heap width, and still put `actorId`'s correlation at 0.002 where production reads -0.181.

## Database Compatibility Guidelines

- **All database operations must work with SQLite and PostgreSQL, and should avoid assumptions that break MySQL-compatible Knex clients where possible.**
- Use Knex query builder for all database operations—avoid raw SQL unless absolutely necessary.
- When writing raw SQL, ensure syntax is compatible across all supported databases.
- Avoid database-specific features unless wrapped with conditional logic or fallback behavior for each backend.
- Test migrations and queries against SQLite (used in tests) to catch compatibility issues early.
- Use standard SQL types and avoid vendor-specific extensions (e.g., use `text` instead of PostgreSQL's `varchar[]`).
- **A client-supplied id compared against a numeric column must be coerced first — PostgreSQL turns a bad id into an error, not a miss.** `medias.id` (and `attachments.mediaId`) are `integer` on PostgreSQL, so `where('medias.id', 'abc')` raises `invalid input syntax for type integer` and a 404 becomes a 500. SQLite's dynamic typing just matches nothing, so the default test run never sees it: `TEST_DATABASE_TYPE=sqlite` is what CI pins, and only `TEST_DATABASE_TYPE=pg` catches this class of bug. In `lib/database/sql/media.ts` every method that **compares** a `mediaId` against `medias.id` runs it through `toMediaRowId` first, so the caller reports "not found" without touching the database. (`createAttachment` **writes** `mediaId` rather than comparing it and is deliberately unguarded, since coercing would silently drop the link instead of surfacing a bad id. The shape check therefore has to sit at the route: `POST /api/v1/accounts/outbox` takes `PostBoxAttachment.id` as a bare `z.string()` and hands it to `lib/actions/createNote.ts`, so a malformed id used to fail the insert on PostgreSQL **after** the status row was committed — a 500, and a published status whose media had silently vanished, because `createNote.ts` opens no transaction to roll back. That route now rejects an id `toMediaRowId` cannot resolve with a 422 before anything is written. Validate at the route rather than in the action: the action runs after the status write, so it is too late to refuse. The id is shape-checked and forwarded unchanged, never normalised — whether the row exists and belongs to the actor stays `resolveAttachmentMediaMetadata`'s question. `POST /api/v1/statuses` and `PUT /api/v1/statuses/:id` never had this hole: they resolve `media_ids` through `getMediaByIdForAccount` and build each attachment from the returned row, so a malformed id resolves to nothing instead of reaching a write. The outbox route is the one that trusts the client's whole attachment object — `url`, `mediaType` and dimensions included — which is why it needs its own guard.) The guard is shape-checked and range-bounded on purpose, not a bare `Number()` — it accepts optional leading zeros, digits, an optional all-zero fraction, and a value in 1..2147483647, and nothing else. Be aware this is deliberately **tighter than the backends themselves**, so on PostgreSQL it is a behaviour change, not only a bug fix: `'0x10'` and `'0b101'` used to resolve media 16 and 5 there (PostgreSQL accepts non-decimal integer literals since 16) and `'+12'`/`' 12 '` used to resolve media 12 on both backends — all now 404, which is the Mastodon answer for something that is not a row id. `'abc'`, `'1e3'`, `'12.0'` and anything above 2147483647 raised `invalid input syntax`/`value out of range` on PostgreSQL and are the 500s being fixed. `'12.0'` is the one spelling kept rather than tightened away, for **SQLite**: `attachments.mediaId` is `varchar` there, so an id bound as a JS number lands as `'1.0'` and gets re-resolved on every status edit. No production writer does that today, so treat it as defence in depth rather than a shim for observed data. Apply the same treatment to any new query that compares a caller-supplied value against a numeric column, and give test fixtures values the column can actually hold.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
