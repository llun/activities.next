# Repository Guidelines

> **Always read `AGENTS.md` at the start of any task** and follow it for all project rules. If `AGENTS.override.md` is also present in the checkout, read it as well — it takes precedence over `AGENTS.md` wherever the two conflict. Treat `AGENTS.override.md` as a layer applied on top of `AGENTS.md`, not a full replacement.

## Definition of Done (read this first)

Every change, however small, is done only when ALL of these hold:

1. It is on a feature branch — never commit to `main`.
2. `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test` all pass, run in that order.
3. Every document the change makes stale is updated in the same PR (see **Documentation Maintenance**).
4. If a migration was added/edited/removed, BOTH schema dumps are regenerated (see **Database Backends & Local Setup**; CI fails on SQLite-dump drift).
5. The commit subject and PR title carry the correct conventional prefix, and `package.json` `version` is untouched (see **Commit & Pull Request Guidelines**).
6. UI changes are verified in a real browser (see [Local Manual / Browser Testing](CONTRIBUTING.md#local-manual-browser-testing)) (screenshots in the PR are not required).

For the most common task shapes, follow the step-by-step **Task Recipes** section below instead of improvising.

## Project Structure & Module Organization

- `app/` contains the Next.js App Router UI and API routes (see `app/api/` and route groups like `app/(nosidebar)/`).
- `lib/` hosts core domain logic, database access, services, jobs, and shared utilities.
- `migrations/` holds Knex migration files used for SQL backends.
- `public/` serves static assets; `uploads/` and `data/` are used for local storage in some deployments.
- `packages/` holds modular optional workspace packages (`packages/cloudtasks`, `packages/pg`, `packages/qstash`) isolated from the root package so minimal Docker images omit heavy optional SDKs.
- `docs/` includes setup and database-specific guides; `scripts/` includes repo utilities; `lint/` holds the local Oxlint JS plugin (`agentsRules.mjs`) that carries the AGENTS.md conventions Oxlint cannot express natively, plus its guard test.
  - **`docs/` is for durable, general-purpose reference documentation only** (setup, architecture, environment variables, feature guides). **Do NOT add** implementation plans, design docs, task/PR-specific writeups, gap analyses, before/after screenshots, or any other artifact tied to a single change or pull request. Those belong in the PR description or issue tracker, not the repo. Do not create `docs/plans/`, `docs/specs/`, `docs/pr-screenshots/`, or similar scratch directories.
  - `scripts/` is organized as `mock/`, `maintenance/`, `fitness/`, and `backup/`. Every script runs through the `scripts/run.cjs` bootstrap (`node scripts/run.cjs <script>.ts`), which is also wired into each script's shebang; `yarn search:reindex` is the packaged entry point for `scripts/maintenance/rebuildSearchIndex.ts`. `scripts/` has a dedicated storage-confinement lint pass and is not prettier-checked in CI — verify scripts by running them.
- **`AGENTS.md` is canonical; `CLAUDE.md` is a symlink to `AGENTS.md`.** `CLAUDE.md` exists as a symbolic link pointing to `AGENTS.md` so that tools looking for either file read the exact same instructions without duplication or drift. Per-tool variants are deliberately not kept here — `.cursor/rules/agents.mdc`, `GEMINI.md` and `.github/copilot-instructions.md` each existed and were removed. Do not add another: point tools or symlinks at `AGENTS.md`.
- `proxy.ts` at the repo root is the Next.js middleware entrypoint (Next 16's rename of `middleware.ts`) — do **not** add a `middleware.ts`. It runs in the Edge runtime: import helpers via direct sub-paths (e.g. `@/lib/utils/http-headers/csp`), never barrels that transitively pull Node-only dependencies such as `@/lib/config`. It owns the ActivityPub content-negotiation rewrites and CSP header injection.
- Configuration files live at the repo root (for example `.env.example`, `knexfile.js`, and framework/tooling configs).
- `.gitignore` intentionally ignores several files agents commonly create: `docker-compose.yml`, `scripts/*.js`, `plans/`, `PR_DESCRIPTION.md`, `VERIFICATION_SUMMARY.md`, `AGENTS.override.md`, all `*.sql` (except the two `!migrations/schema*.sql` negations), `*.sqlite3`/`*.sqlite`, and `.env*` variants. If a file you added is missing from `git status`, check `git status --ignored` before assuming the add failed.

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

## Build, Test, and Development Commands

Use Node.js 24 and Yarn for all repository commands. The canonical local gate is `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`, in that order; the detailed command behavior, local-database guard, and workspace guidance live in the [setup guide](docs/setup.md#agents-build-test-and-development-commands). Never run development servers, migrations, or tests against a remote or shared database.

## Mandatory workflow

For every change, read the [testing rules](CONTRIBUTING.md#agents-testing-guidelines), [commit and PR rules](CONTRIBUTING.md#agents-commit-pull-request-guidelines), [review loop](CONTRIBUTING.md#agents-code-review-loop-sub-agents), and [documentation rules](CONTRIBUTING.md#agents-documentation-maintenance). These apply even when the change does not touch those files.

Open a feature-branch PR after all five local gates pass. Independently review the entire PR, post findings, address them, reply and resolve discussions, and repeat until clean or 20 rounds. Use the documented self-review exception only when sub-agents are unavailable. Never manually change the package version; use a conventional commit subject and PR title. Automated releases are capped at minor; a major release is maintainer-led.

## Required subsystem reading map

Read the destination guide before changing the subsystem. The links point to the moved rule source and are the durable authority for the detailed invariants.

| Change area                                                                                      | Required reading                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup, commands, database backends, migrations                                                   | [Setup and local development rules](docs/setup.md#agents-build-test-and-development-commands) and [database setup rules](docs/setup.md#agents-database-backends-local-setup) |
| Mastodon ids, API validation, ActivityPub, actor visibility, status actions                      | [Mastodon compatibility rules](docs/mastodon-api-compatibility.md#agents-client-facing-entity-ids)                                                                           |
| Request boundaries, server/client modules, UI chrome, auth, email, previews, federation deletion | [Architecture rules](docs/architecture.md#agents-server-client-module-boundary)                                                                                              |
| Fitness uploads, dates, maps, route heatmaps, and gear                                           | [Fitness storage and processing rules](docs/fitness-file-storage.md#agents-fitness-stat-strips)                                                                              |
| Stored media, security, indexes, and database compatibility                                      | [Maintenance and storage rules](docs/maintenance.md#agents-security-configuration-tips)                                                                                      |
| Tests, task recipes, documentation, commits, and review loop                                     | [Contributor workflow rules](CONTRIBUTING.md#agents-testing-guidelines) and the [review checklist](REVIEW.md)                                                                |

When a task crosses areas, read the applicable rule sections in every relevant guide before editing. The topic links below identify the exact sections. Keep the root guide limited to cross-cutting rules and this routing map; durable subsystem detail belongs in the linked existing guide.

## Cross-cutting data and protocol rules

- A client-visible status or actor id is emitted with `getClientStatusId` / `getClientActorId`; accept every legacy id shape through the shared resolvers and batch-resolve ids in one query. Read the [client-id source rules](docs/mastodon-api-compatibility.md#agents-client-facing-entity-ids) before adding a serializer or route.
- API handlers use `safeParse`, `apiResponse`, and `apiErrorResponse` as applicable. CORS-enabled routes use `apiResponse` for errors too. The full validation and response invariants are in [Mastodon compatibility](docs/mastodon-api-compatibility.md#agents-zod-validation-in-api-routes).
- Inbound ActivityPub is compacted with the offline JSON-LD processor before validation; outbound Note terms must be declared in the emitted context. Read [ActivityPub and JSON-LD](docs/mastodon-api-compatibility.md#agents-activitypub-json-ld) before changing federation.
- Preserve the server/client boundary, serialize dates before crossing it, use the shared client API and outbound HTTP helpers, and keep feed prefetching intentional. Read the [architecture source rules](docs/architecture.md#agents-server-client-module-boundary).
- Use the local database and storage-root safety rules in the [setup](docs/setup.md#agents-database-backends-local-setup) and [maintenance](docs/maintenance.md#agents-security-configuration-tips) guides.

## Documentation Maintenance

Durable documentation changes belong in existing guides and must be updated in the same change as the behavior they describe. Do not add plans, review reports, screenshots, or other task artifacts under `docs/`. Keep `CLAUDE.md` as the symlink to this file and preserve the generated Next.js block below. See the [contributor documentation rules](CONTRIBUTING.md#agents-documentation-maintenance).

## Security & Data Safety

Treat runtime configuration, credentials, uploaded names, storage paths, archive files, and remote URLs as untrusted or sensitive. Keep filesystem access confined to the configured storage root, use the canonical media and URL helpers, and verify local database targets before any write. The detailed rules and rationale are in [maintenance and storage](docs/maintenance.md#agents-security-configuration-tips).

## Client-Facing Entity IDs

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-client-facing-entity-ids); read it before changing this subsystem.

## Zod Validation in API Routes

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-zod-validation-in-api-routes); read it before changing this subsystem.

## ActivityPub & JSON-LD

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-activitypub-json-ld); read it before changing this subsystem.

## A Fetched Document's Own `id` Is Not Evidence

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-a-fetched-document-s-own-id-is-not-evidence); read it before changing this subsystem.

## Actor Usernames Are Case-Insensitive

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-actor-usernames-are-case-insensitive); read it before changing this subsystem.

## Server/Client Module Boundary

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-server-client-module-boundary); read it before changing this subsystem.

## Instance Limits in Client Components

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-instance-limits-in-client-components); read it before changing this subsystem.

## Date Serialization in Server Components

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-date-serialization-in-server-components); read it before changing this subsystem.

## Client-Side API Calls

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-client-side-api-calls); read it before changing this subsystem.

## Outbound Server-Side HTTP Requests

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-outbound-server-side-http-requests); read it before changing this subsystem.

## Link prefetching in feeds

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-link-prefetching-in-feeds); read it before changing this subsystem.

## Navigation Customization

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-navigation-customization); read it before changing this subsystem.

## Page Header & Sub-Navigation

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-page-header-sub-navigation); read it before changing this subsystem.

## Settings Forms (Client Components)

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-settings-forms-client-components); read it before changing this subsystem.

## Transactional & Notification Emails

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-transactional-notification-emails); read it before changing this subsystem.

## Fitness Stat Strips

The durable rule source moved to [docs/fitness-file-storage.md](docs/fitness-file-storage.md#agents-fitness-stat-strips); read it before changing this subsystem.

## Apple Maps Basemap

The durable rule source moved to [docs/fitness-file-storage.md](docs/fitness-file-storage.md#agents-apple-maps-basemap); read it before changing this subsystem.

## Fitness Activity Dates

The durable rule source moved to [docs/fitness-file-storage.md](docs/fitness-file-storage.md#agents-fitness-activity-dates); read it before changing this subsystem.

## Fitness Route Heatmap Pyramid

The durable rule source moved to [docs/fitness-file-storage.md](docs/fitness-file-storage.md#agents-fitness-route-heatmap-pyramid); read it before changing this subsystem.

## Fitness Gear

The durable rule source moved to [docs/fitness-file-storage.md](docs/fitness-file-storage.md#agents-fitness-gear); read it before changing this subsystem.

## Link Preview Cards

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-link-preview-cards); read it before changing this subsystem.

## Status Posts & Actions

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-status-posts-actions); read it before changing this subsystem.

## Status Delete & Unboost Federation

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-status-delete-unboost-federation); read it before changing this subsystem.

## Deleting Media a Post Uses

The durable rule source moved to [docs/maintenance.md](docs/maintenance.md#agents-deleting-media-a-post-uses); read it before changing this subsystem.

## Better-auth Plugin Guidelines

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-better-auth-plugin-guidelines); read it before changing this subsystem.

## Better-auth Database Joins

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-better-auth-database-joins); read it before changing this subsystem.

## OAuth Client Registrations

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-oauth-client-registrations); read it before changing this subsystem.

## Auth Error Page

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-auth-error-page); read it before changing this subsystem.

## OAuth Grants Must Resolve an Actor

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-oauth-grants-must-resolve-an-actor); read it before changing this subsystem.

## An Unconfirmed Account May Not Act

The durable rule source moved to [docs/architecture.md](docs/architecture.md#agents-an-unconfirmed-account-may-not-act); read it before changing this subsystem.

## Testing Guidelines

The durable rule source moved to [CONTRIBUTING.md](CONTRIBUTING.md#agents-testing-guidelines); read it before changing this subsystem.

## Task Recipes

The durable rule source moved to [CONTRIBUTING.md](CONTRIBUTING.md#agents-task-recipes); read it before changing this subsystem.

## Commit & Pull Request Guidelines

The durable rule source moved to [CONTRIBUTING.md](CONTRIBUTING.md#agents-commit-pull-request-guidelines); read it before changing this subsystem.

## Code Review Loop (Sub-Agents)

The durable rule source moved to [CONTRIBUTING.md](CONTRIBUTING.md#agents-code-review-loop-sub-agents); read it before changing this subsystem.

## Security & Configuration Tips

The durable rule source moved to [docs/maintenance.md](docs/maintenance.md#agents-security-configuration-tips); read it before changing this subsystem.

## Database Backends & Local Setup

The durable rule source moved to [docs/setup.md](docs/setup.md#agents-database-backends-local-setup); read it before changing this subsystem.

## Local Usernames Are Actor-Id Path Segments

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-local-usernames-are-actor-id-path-segments); read it before changing this subsystem.

## Local Actors ("does this server host this actor?")

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-local-actors-does-this-server-host-this-actor); read it before changing this subsystem.

## Who May See an Actor's Statuses

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-who-may-see-an-actor-s-statuses); read it before changing this subsystem.

## Publicly Readable Status Ids

The durable rule source moved to [docs/mastodon-api-compatibility.md](docs/mastodon-api-compatibility.md#agents-publicly-readable-status-ids); read it before changing this subsystem.

## Composite Index Column Order on `statuses` (PostgreSQL 18)

The durable rule source moved to [docs/maintenance.md](docs/maintenance.md#agents-composite-index-column-order-on-statuses-postgresql-18); read it before changing this subsystem.

## Database Compatibility Guidelines

The durable rule source moved to [docs/maintenance.md](docs/maintenance.md#agents-database-compatibility-guidelines); read it before changing this subsystem.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
