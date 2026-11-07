# Repository Guidelines

> **Always read `AGENTS.md` at the start of any task** and follow it for all project rules. If `AGENTS.override.md` is also present in the checkout, read it as well — it takes precedence over `AGENTS.md` wherever the two conflict. Treat `AGENTS.override.md` as a layer applied on top of `AGENTS.md`, not a full replacement.

## Definition of Done (read this first)

Every change, however small, is done only when ALL of these hold:

1. It is on a feature branch — never commit to `main`.
2. `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test` all pass, run in that order.
3. Every document the change makes stale is updated in the same PR (see **Documentation Maintenance**).
4. If a migration was added/edited/removed, BOTH schema dumps and the generated Kysely DB types (`lib/database/kysely/db.ts`) are regenerated (see [Database Backends & Local Setup](docs/setup.md#agents-database-backends-local-setup); CI fails on drift in any of them).
5. The commit subject and PR title carry the correct conventional prefix, and `package.json` `version` is untouched (see [Commit & Pull Request Guidelines](CONTRIBUTING.md#agents-commit-pull-request-guidelines)).
6. UI changes are verified in a real browser (see [Local Manual / Browser Testing](CONTRIBUTING.md#local-manual-browser-testing)); screenshots in the PR are not required.
7. Changes that alter the design keep the Sketch design library in step: `Activities.next.sketch` is updated (and redesign screens regenerated when affected), the interactive prototype (`Activities.next/Interactive/`) is regenerated from the merged change, and both are committed, pushed and published (its `scripts/publish.sh`) in the separate `llun/sketch` repository (see [Design Library Sync](CONTRIBUTING.md#agents-design-library-sync)).
8. Once its PR is merged or closed, or the work is dropped without one, the thread removes only what it made and no other thread uses: its own worktree and local branch, that worktree's git-ai log at `.git/ai/worktrees/<worktree folder name>` (`git worktree remove` leaves it behind), and the caches, logs and temp clones it created. The main checkout and what it holds (its `node_modules`, `.next`, `.git/ai/working_logs`) stay, as does anything whose PR is still open.

For the most common task shapes, follow the step-by-step [Task Recipes](CONTRIBUTING.md#agents-task-recipes) instead of improvising.

## Working with Sub-Agents

When to delegate, which model to use and how much effort to spend come from one
guide, kept in the `llun/labs` repository and not repeated here:
[`agents-bridge/config/routing/shared.md`](https://github.com/llun/labs/blob/main/agents-bridge/config/routing/shared.md)
and, for Claude Code,
[`claude.md`](https://github.com/llun/labs/blob/main/agents-bridge/config/routing/claude.md)
beside it. On the owner's Mac it is already loaded through `~/.claude/CLAUDE.md`.

Where the guide can't be read and the `delegate` tool is missing (cloud
sessions), follow this summary of it:

- Delegate work that runs in parallel, is bulk reading or editing, or needs a
  fresh, independent context (review, verification). Do the rest in the main
  thread.
- Set `model` and `effort` on every Claude sub-agent: `haiku`/`low` (Fast),
  `sonnet`/`medium` (Everyday), `opus`/`high` (Heavy), `fable`/`high`
  (Frontier). Start at the tier that fits and go one up only after a wrong or
  shallow answer. Use `xhigh` only for a bug that survived a fix, and never make
  `max` a default.
- Sub-agents see none of this conversation, so name the files, the goal and what
  done looks like. Give parallel writers separate worktrees, and check their
  diff and tests.

In this repository, start at Frontier (`fable`/`high`) for the high-risk areas:
ActivityPub federation (signatures, JSON-LD, inbox/outbox, deletes),
auth/OAuth/better-auth, actor and status visibility, the migrator, baseline and
schema dumps, and the storage-root and outbound-HTTP security rules. Code review
always runs in fresh sub-agents, as the
[review loop](CONTRIBUTING.md#agents-code-review-loop-sub-agents) describes.

## Project Structure & Module Organization

- `app/` — Next.js App Router UI and API routes (`app/api/`, route groups like `app/(nosidebar)/`). `lib/` — core domain logic, database access, services, jobs, shared utilities. `public/` — static assets; `uploads/` and `data/` — local storage in some deployments. `packages/` — modular optional workspace packages (`cloudtasks`, `nodemailer`, `pg`, `qstash`, `resend`, `ses`) isolated from the root package so minimal Docker images omit heavy optional SDKs. `docs/` — setup and database-specific guides. `lint/` — the local Oxlint JS plugin (`agentsRules.mjs`) carrying the AGENTS.md conventions Oxlint cannot express natively, plus its guard test.
- `migrations/` — the TypeScript migrations `yarn migrate` runs with Kysely's migrator, registered in `migrations/index.ts` (names in `migrations/names.ts`); the first, `20261014000000_baseline`, loads the frozen schema in `migrations/baseline/` into an empty database or records it on one the Knex migrations of v1.192.34 built (see [Upgrading past the Knex handover](docs/maintenance.md#upgrading-past-the-knex-handover)).
- **`docs/` is for durable, general-purpose reference documentation only** (setup, architecture, environment variables, feature guides). Do NOT add implementation plans, design docs, task/PR-specific writeups, gap analyses, before/after screenshots, or any other artifact tied to a single change or pull request — those belong in the PR description or issue tracker. Do not create `docs/plans/`, `docs/specs/`, `docs/pr-screenshots/`, or similar scratch directories.
- `scripts/` — organized as `mock/`, `maintenance/`, `fitness/`, `backup/`; every script runs through the `scripts/run.cjs` bootstrap (`node scripts/run.cjs <script>.ts`), wired into each shebang; `yarn search:reindex` is the packaged entry point for `scripts/maintenance/rebuildSearchIndex.ts`. `scripts/` has a dedicated storage-confinement lint pass and is not prettier-checked in CI — verify scripts by running them.
- **`AGENTS.md` is canonical; `CLAUDE.md` is a symlink to `AGENTS.md`**, so tools looking for either file read the exact same instructions without duplication or drift. Per-tool variants (`.cursor/rules/agents.mdc`, `GEMINI.md`, `.github/copilot-instructions.md`) each existed and were removed — do not add another; point tools or symlinks at `AGENTS.md`.
- `proxy.ts` at the repo root is the Next.js middleware entrypoint (Next 16's rename of `middleware.ts`) — do **not** add a `middleware.ts`. It runs in the Edge runtime: import helpers via direct sub-paths (e.g. `@/lib/utils/http-headers/csp`), never barrels that transitively pull Node-only dependencies such as `@/lib/config`. It owns the ActivityPub content-negotiation rewrites and CSP header injection.
- Configuration files live at the repo root only when their tool requires it (`.env.example`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`); Prettier's config is the `prettier` key in `package.json`, the scripts-only Oxlint config is `lint/oxlintrc.scripts.json`. Tests for root-level files (`next.config.ts`, `proxy.ts`, `instrumentation.ts`, `vitest.config.ts`) and the Vitest setup files live in `test/`, not beside those files — do not add `*.test.ts` files to the repo root.
- `.gitignore` intentionally ignores files agents commonly create: `docker-compose.yml`, `scripts/*.js`, `plans/`, `PR_DESCRIPTION.md`, `VERIFICATION_SUMMARY.md`, `AGENTS.override.md`, all `*.sql` (except `!migrations/schema*.sql` and `!migrations/baseline/*.sql`), `*.sqlite3`/`*.sqlite`, `.env*` variants. If a file you added is missing from `git status`, check `git status --ignored` before assuming the add failed.

## Runtime Configuration Guidelines

- Deployment and instance configuration must be read at runtime, not at build time: `ACTIVITIES_*`, `OTEL_EXPORTER_*`, secrets, database, storage, host, and auth settings are runtime-only inputs.
- Do not read runtime deployment config in `next.config.ts`, static Next headers, `images.remotePatterns`, `allowedDevOrigins`, webpack config, `generateBuildId`, or other build-time/module-level Next configuration. Production/Docker builds must succeed when `ACTIVITIES_*` variables are missing or contain invalid placeholder values. `next.config.ts` may read build-only flags (`NODE_ENV`, `BUILD_STANDALONE`, `NEXT_TELEMETRY_DISABLED`) but must not derive app behavior from runtime deployment config.
- Keep `next.config.ts` a thin Next configuration entrypoint — no reusable utility functions, parsing helpers, or shared constants there; move helper logic into an appropriate `lib/` module and import it.
- If runtime config affects browser-visible behavior (CSP, security headers, host redirects, storage upload origins), implement it in request-time server code (`proxy.ts`, route handlers, server services), not static Next config. Do not inject runtime app config through `nextConfig.env` or `NEXT_PUBLIC_*` unless the value is intentionally public, non-secret, and stable at build time.
- Do not read `ACTIVITIES_*` or `OTEL_EXPORTER_*` variables directly, and do not define environment variable name constants, outside `lib/config/` — add or reuse a config utility and import that instead.
- When changing runtime config behavior, add a regression test that loads `next.config.ts` with missing or invalid `ACTIVITIES_*` values and verifies the build config does not consume them.

## Coding Style & Naming Conventions

- TypeScript + React, 2-space indentation. Prettier enforces no semicolons, single quotes, and import sorting (the `prettier` key in `package.json`).
- Use absolute imports (`@/lib/...`) for anything outside the current directory; relative imports only within the same directory (`./helper`); `../` imports are not allowed. Apply the same import-path rule to `vi.mock(...)` module paths.
- Oxlint (with its `typescript` and `nextjs` rule sets) runs via `yarn lint`; unused vars should be prefixed with `_`. Tests are co-located with code and named `*.test.ts`/`*.test.tsx`.

### Tailwind CSS variables

- **This project is on Tailwind v4. A bare CSS variable as an arbitrary value uses the parenthesis form — `w-(--radix-dropdown-menu-trigger-width)` — never the v3 bracket form `w-[--radix-…]`, which v4 compiles literally to an invalid declaration with no error and no build warning.** `[var(--x)]`, arbitrary variants (`[&_svg]`), and arbitrary values that merely contain a variable (`[calc(var(--x)-1px)]`) are still valid. `lib/components/tailwindCssVariableSyntax.test.ts` fails on any occurrence in `app/` or `lib/` and names the replacement.

## Logging Guidelines

- **NEVER** use `console.log`, `console.warn`, `console.error`, or any `console.*` methods in committed code. Migration files in `migrations/` and script files in `scripts/` are exceptions and may use `console.*` for CLI output.
- For server-side code (API routes, services, jobs, models, lib utilities), use the logger from `@/lib/utils/logger` (`logger.info({ message: '…' })`, `logger.warn(...)`, `logger.error(...)`). **Do NOT** use logger in React components or client-side code — logging is server-side only.
- **When logging a caught error, pass the error object as `err`**, not only its message: the formatter reads `err.stack` and emits it as `stack_trace`, which is what Cloud Error Reporting groups and displays; `error: someError.message` alone reports nothing actionable. Anything can be thrown — normalize with `toLoggableError` from `@/lib/utils/toLoggableError`, keeping a human-readable `error: <message>` alongside it when the same string is also persisted.
- **A failure that degrades a feature must not be logged as a `warn` and forgotten** — record it in a signal scoped to what actually broke. If the user can see the degradation (a missing route map, an unrendered attachment), persist it wherever that feature's state lives so it is visible and retryable; a `logger.warn` with no persisted trace is how a permanent outage becomes invisible. Do **not** reach for a coarser flag that already means something bigger: `fitness_files.processingStatus: 'failed'` means "this activity is not usable" and gates the status detail dashboard, the post's stat grid, the fitness overview, the profile's Fitness tab and every stats/heatmap rollup — a missing route map gets its own `mapError` column instead of hiding a good activity everywhere. Before reusing a status flag, grep for what reads it.

## API Response Guidelines

- Always use `apiResponse` and `apiErrorResponse` from `@/lib/utils/response` for API route responses. **Do NOT** use `Response.json()` directly in API routes.
- **Error responses use Mastodon's `{ error: "message" }` shape, never `{ status: ... }`.** `apiErrorResponse`, `apiCorsError`, and the shared `codeMap`/`ERROR_4xx` constants all emit `{ error }` (the HTTP reason phrase for the response `statusText` lives separately in `REASON_PHRASE`), matching the [Mastodon `Error` entity](https://docs.joinmastodon.org/entities/Error/). Mastodon-API clients read the human-readable message from the `error` field — masto.js leaves an error's `message` empty for any other shape — so a `{ status: ... }` error body breaks them. Write inline error bodies as `data: { error: '…' }`. Only success acknowledgements (`DEFAULT_200`/`DEFAULT_202`) keep the `{ status: 'OK' }`/`{ status: 'Accepted' }` shape, because they are not errors.
- On CORS-enabled endpoints (those that export `OPTIONS`), always use `apiResponse` — even for error responses (pass `req`, `allowedMethods`, `data: { error: '…' }`, `responseStatusCode`) — so CORS headers are included. Reserve `apiErrorResponse` for non-CORS routes or middleware.

## Build, Test, and Development Commands

Use Node.js 24 and Yarn for all repository commands. The canonical local gate is `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`, in that order; the detailed command behavior, local-database guard, and workspace guidance live in the [setup guide](docs/setup.md#agents-build-test-and-development-commands). Never run development servers, migrations, or tests against a remote or shared database.

The CI build persists `.next/cache`, and the Docker packaging workflow reuses GitHub Actions BuildKit caches per architecture for its minimal images; see [CI Status Checks](CONTRIBUTING.md#ci-status-checks) for cache ownership and publication behavior.

## Mandatory workflow

For every change, read the [testing rules](CONTRIBUTING.md#agents-testing-guidelines), [commit and PR rules](CONTRIBUTING.md#agents-commit-pull-request-guidelines), [review loop](CONTRIBUTING.md#agents-code-review-loop-sub-agents), and [documentation rules](CONTRIBUTING.md#agents-documentation-maintenance). These apply even when the change does not touch those files.

Open a feature-branch PR after all five local gates pass. Independently review the entire PR, post findings, address them, reply and resolve discussions, and repeat until clean or 20 rounds. Use the documented self-review exception only when sub-agents are unavailable. Never manually change the package version; use a conventional commit subject and PR title. A `major:` release requires a human maintainer to apply the `release:major` label; agents must never apply that label.

## Routing table

Read the linked guide before changing the area; the links are the durable authority for each subsystem's detailed invariants. When a task crosses areas, read every applicable row before editing.

| Change area                                           | Read first                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup, commands, migrations, schema dumps             | [Setup guide](docs/setup.md#agents-build-test-and-development-commands)                                                                                  |
| Database backends, local setup                        | [Database Backends & Local Setup](docs/setup.md#agents-database-backends-local-setup)                                                                    |
| Mastodon client-facing ids, legacy shapes, cursors    | [Client-Facing Entity IDs](docs/mastodon-api-compatibility.md#agents-client-facing-entity-ids)                                                           |
| Local usernames as actor-id path segments             | [Local Usernames Are Actor-Id Path Segments](docs/mastodon-api-compatibility.md#agents-local-usernames-are-actor-id-path-segments)                       |
| Local actors ("does this server host this actor?")    | [Local Actors](docs/mastodon-api-compatibility.md#agents-local-actors-does-this-server-host-this-actor)                                                  |
| Who may see an actor's statuses                       | [Who May See an Actor's Statuses](docs/mastodon-api-compatibility.md#agents-who-may-see-an-actor-s-statuses)                                             |
| Publicly readable status ids                          | [Publicly Readable Status Ids](docs/mastodon-api-compatibility.md#agents-publicly-readable-status-ids)                                                   |
| Actor username case handling                          | [Actor Usernames Are Case-Insensitive](docs/mastodon-api-compatibility.md#agents-actor-usernames-are-case-insensitive)                                   |
| API request validation (Zod)                          | [Zod Validation in API Routes](docs/mastodon-api-compatibility.md#agents-zod-validation-in-api-routes)                                                   |
| Status posts & actions, post media layout             | [Status Posts & Actions](docs/mastodon-api-compatibility.md#agents-status-posts-actions)                                                                 |
| ActivityPub & JSON-LD (compaction, contexts)          | [ActivityPub & JSON-LD](docs/mastodon-api-compatibility.md#agents-activitypub-json-ld)                                                                   |
| Trusting a fetched document's `id`                    | [A Fetched Document's Own `id` Is Not Evidence](docs/mastodon-api-compatibility.md#agents-a-fetched-document-s-own-id-is-not-evidence)                   |
| Server/client module boundary                         | [Server/Client Module Boundary](docs/architecture.md#agents-server-client-module-boundary)                                                               |
| Instance-wide values in client components             | [Instance Limits in Client Components](docs/architecture.md#agents-instance-limits-in-client-components)                                                 |
| Dates crossing the server/client boundary             | [Date Serialization in Server Components](docs/architecture.md#agents-date-serialization-in-server-components)                                           |
| Client-side API calls                                 | [Client-Side API Calls](docs/architecture.md#agents-client-side-api-calls)                                                                               |
| Outbound server-side HTTP requests                    | [Outbound Server-Side HTTP Requests](docs/architecture.md#agents-outbound-server-side-http-requests)                                                     |
| Link prefetching in feeds                             | [Link prefetching in feeds](docs/architecture.md#agents-link-prefetching-in-feeds)                                                                       |
| Navigation customization                              | [Navigation Customization](docs/architecture.md#agents-navigation-customization)                                                                         |
| Page headers & section sub-navigation                 | [Page Header & Sub-Navigation](docs/architecture.md#agents-page-header-sub-navigation)                                                                   |
| Fitness overview calendar                             | [Fitness Overview Calendar](docs/architecture.md#agents-fitness-overview-calendar)                                                                       |
| Shared surface kit (panels, lists, forms, states)     | [Surfaces](docs/architecture.md#agents-surfaces)                                                                                                         |
| Settings forms (client components)                    | [Settings Forms (Client Components)](docs/architecture.md#agents-settings-forms-client-components)                                                       |
| Transactional & notification emails                   | [Transactional & Notification Emails](docs/architecture.md#agents-transactional-notification-emails)                                                     |
| Link preview cards                                    | [Link Preview Cards](docs/architecture.md#agents-link-preview-cards)                                                                                     |
| Status delete & unboost federation                    | [Status Delete & Unboost Federation](docs/architecture.md#agents-status-delete-unboost-federation)                                                       |
| Actor profile & deletion federation                   | [Actor Profile & Deletion Federation](docs/architecture.md#agents-actor-profile-deletion-federation)                                                     |
| Better-auth plugin guidelines                         | [Better-auth Plugin Guidelines](docs/architecture.md#agents-better-auth-plugin-guidelines)                                                               |
| Better-auth database joins                            | [Better-auth Database Joins](docs/architecture.md#agents-better-auth-database-joins)                                                                     |
| Better-auth session refresh                           | [Better-auth Session Refresh](docs/architecture.md#agents-better-auth-session-refresh)                                                                   |
| OAuth client registrations                            | [OAuth Client Registrations](docs/architecture.md#agents-oauth-client-registrations)                                                                     |
| OAuth access token sliding expiry                     | [OAuth Access Token Sliding Expiry](docs/architecture.md#agents-oauth-access-token-sliding-expiry)                                                       |
| OAuth grants resolving an actor                       | [OAuth Grants Must Resolve an Actor](docs/architecture.md#agents-oauth-grants-must-resolve-an-actor)                                                     |
| Auth error page                                       | [Auth Error Page](docs/architecture.md#agents-auth-error-page)                                                                                           |
| Unconfirmed accounts                                  | [An Unconfirmed Account May Not Act](docs/architecture.md#agents-an-unconfirmed-account-may-not-act)                                                     |
| Fitness stat strips, activity dates                   | [stat strips](docs/fitness-file-storage.md#agents-fitness-stat-strips), [activity dates](docs/fitness-file-storage.md#agents-fitness-activity-dates)     |
| Apple Maps basemap, route heatmaps                    | [basemap](docs/fitness-file-storage.md#agents-apple-maps-basemap), [heatmap pyramid](docs/fitness-file-storage.md#agents-fitness-route-heatmap-pyramid)  |
| Fitness gear                                          | [Fitness Gear](docs/fitness-file-storage.md#agents-fitness-gear)                                                                                         |
| Fitness uploads, file storage, processing             | [Storage Implementations](docs/fitness-file-storage.md#storage-implementations), [Processing Pipeline](docs/fitness-file-storage.md#processing-pipeline) |
| Deleting media a post uses                            | [Deleting Media a Post Uses](docs/maintenance.md#agents-deleting-media-a-post-uses)                                                                      |
| Security, storage-root confinement, stored media URLs | [Security & Configuration Tips](docs/maintenance.md#agents-security-configuration-tips)                                                                  |
| Composite indexes on `statuses` (PostgreSQL 18)       | [Composite Index Column Order](docs/maintenance.md#agents-composite-index-column-order-on-statuses-postgresql-18)                                        |
| Database compatibility                                | [Database Compatibility Guidelines](docs/maintenance.md#agents-database-compatibility-guidelines)                                                        |
| Visual design changes (tokens, components, layouts)   | [Design Library Sync](CONTRIBUTING.md#agents-design-library-sync)                                                                                        |
| Tests, known failure classes                          | [Testing Guidelines](CONTRIBUTING.md#agents-testing-guidelines), [Known failure classes](CONTRIBUTING.md#agents-known-failure-classes)                   |
| Task recipes                                          | [Task Recipes](CONTRIBUTING.md#agents-task-recipes)                                                                                                      |
| Commits and PRs                                       | [Commit & Pull Request Guidelines](CONTRIBUTING.md#agents-commit-pull-request-guidelines)                                                                |
| Code review loop                                      | [Code Review Loop (Sub-Agents)](CONTRIBUTING.md#agents-code-review-loop-sub-agents)                                                                      |
| Review checklist                                      | [REVIEW.md](REVIEW.md)                                                                                                                                   |

Section pages always switch through the shared `SectionNavDropdown` (`lib/components/section-nav-dropdown.tsx`) — never a second navigation list, rail, tab strip or menu of a section's pages inside the content pane beside the app sidebar, at any width (the index pages `/settings`, `/account`, `/admin` are the only in-content lists, and they are the page, not a navigation); `lib/components/sectionNavPattern.test.ts` fails on a layout that reintroduces one. Details in [Page Header & Sub-Navigation](docs/architecture.md#agents-page-header-sub-navigation).

## Documentation Maintenance

Durable documentation changes belong in existing guides and must be updated in the same change as the behavior they describe. Do not add plans, review reports, screenshots, or other task artifacts under `docs/`. Keep `CLAUDE.md` as the symlink to this file and preserve the generated Next.js block below. See the [contributor documentation rules](CONTRIBUTING.md#agents-documentation-maintenance).

## Security & Data Safety

Treat runtime configuration, credentials, uploaded names, storage paths, archive files, and remote URLs as untrusted or sensitive. Keep filesystem access confined to the configured storage root, use the canonical media and URL helpers, and verify local database targets before any write. The detailed rules and rationale are in [maintenance and storage](docs/maintenance.md#agents-security-configuration-tips).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
