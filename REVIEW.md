# Code Review Checklist

A focused checklist for reviewing changes to **activities.next**. It captures the
project-specific invariants that are easy to miss in a diff — both the rules in
`AGENTS.md` and recurring patterns surfaced in past code review. The rules in
`AGENTS.md` and the guides its routing table links to remain the authoritative
source for the full rules. Skip sections that a given
change doesn't touch.

## How to use this checklist

Review the diff against the linked canonical rule source. Check every applicable row, follow links into the guide before approving a change, and record any exception
in the PR. The detailed review checks are merged into the rule sections of the
guides that own them; this file is the fast review index.

### Review lenses

- **Correctness** — [Database & migrations](docs/maintenance.md#review-database-migrations), [Unique constraints (TOCTOU)](docs/maintenance.md#review-unique-constraints-toctou), [API routes](docs/mastodon-api-compatibility.md#review-api-routes), [Status delete & unboost federation](docs/architecture.md#review-status-delete-unboost-federation), [Fitness route heatmap pyramid](docs/fitness-file-storage.md#review-fitness-route-heatmap-pyramid), and [Where findings come from](CONTRIBUTING.md#agents-code-review-loop-sub-agents).
- **Scope & regression** — [Where findings come from](CONTRIBUTING.md#agents-code-review-loop-sub-agents), [Mastodon and Fediverse Interoperability Quirks](docs/mastodon-api-compatibility.md#review-mastodon-and-fediverse-interoperability-quirks), [Database & migrations](docs/maintenance.md#review-database-migrations), [OAuth access token sliding expiry](docs/architecture.md#review-oauth-access-token-sliding-expiry), and [Unconfirmed accounts & app tokens](docs/architecture.md#review-unconfirmed-accounts-app-tokens).
- **Testing** — [Style, imports & tests](CONTRIBUTING.md#review-style-imports-tests), [Testing Guidelines](CONTRIBUTING.md#agents-testing-guidelines), and [Known failure classes](CONTRIBUTING.md#agents-known-failure-classes).
- **Design system** — [Page chrome, layout & accessibility](docs/architecture.md#review-page-chrome-layout-accessibility), [Surfaces](docs/architecture.md#review-surfaces), [Post media layout](docs/architecture.md#review-post-media-layout), [Client components & data flow](docs/architecture.md#review-client-components-data-flow), and [Apple Maps basemap](docs/fitness-file-storage.md#review-apple-maps-basemap).
- **Quality** — [Runtime vs. build-time configuration](docs/architecture.md#review-runtime-vs-build-time-configuration), [Client components & data flow](docs/architecture.md#review-client-components-data-flow), [Logging](docs/architecture.md#review-logging), [Style, imports & tests](CONTRIBUTING.md#review-style-imports-tests), [Docs hygiene](CONTRIBUTING.md#review-docs-hygiene), [Commits & versioning](CONTRIBUTING.md#review-commits-versioning), and [CI checklist](CONTRIBUTING.md#review-ci-checklist).
- **Security** — [Uploaded file names](docs/maintenance.md#review-uploaded-file-names), [Stored media](docs/maintenance.md#review-stored-media), [Fetched ActivityPub document ids](docs/mastodon-api-compatibility.md#review-fetched-activitypub-document-ids), [Actor usernames](docs/mastodon-api-compatibility.md#review-actor-usernames), [Auth error page](docs/architecture.md#review-auth-error-page), [Better-auth session refresh](docs/architecture.md#review-better-auth-session-refresh), [Unconfirmed accounts & app tokens](docs/architecture.md#review-unconfirmed-accounts-app-tokens), and [Link preview cards](docs/architecture.md#review-link-preview-cards).

### Runtime and boundaries

- [ ] **Runtime vs. build-time configuration** — Keep deployment values in request-time code and out of the Next build configuration. [Detailed checks](docs/architecture.md#review-runtime-vs-build-time-configuration).

- [ ] **API routes** — Use `safeParse`, the shared response helpers with Mastodon `{ error }` bodies, CORS headers, and same-origin proof on routes that authenticate a session manually. [Detailed checks](docs/mastodon-api-compatibility.md#review-api-routes).

- [ ] **Fetched ActivityPub document ids** — Verify fetched-object authority before trusting returned ids or changing local state. [Detailed checks](docs/mastodon-api-compatibility.md#review-fetched-activitypub-document-ids).

- [ ] **Mastodon and Fediverse Interoperability Quirks** — Preserve all supported client id shapes, offline JSON-LD handling, and federation compatibility rules ([client ids](docs/mastodon-api-compatibility.md#review-mastodon-and-fediverse-interoperability-quirks), [offline JSON-LD](docs/mastodon-api-compatibility.md#agents-activitypub-json-ld)).

### Storage and database

- [ ] **Uploaded file names** — Use canonical name, extension, and temporary-path helpers before storing or decoding uploads. [Detailed checks](docs/maintenance.md#review-uploaded-file-names).

- [ ] **Unique constraints (TOCTOU)** — Enforce uniqueness and ownership at the database write, including concurrent requests. [Detailed checks](docs/maintenance.md#review-unique-constraints-toctou).

- [ ] **Database & migrations** — Use portable queries; add a migration only through `yarn migrate:make` and register it in `migrations/index.ts` and `migrations/names.ts` (never edit `migrations/baseline/`); regenerate both schema dumps and `lib/database/kysely/db.ts`; open transactions only with `inTransaction`, never the root instance inside one (refused with `TransactionScopeError`; run detached work after it resolves); compare timestamp columns only through `timestampValue()`; and test backend-sensitive behavior. [Detailed checks](docs/maintenance.md#review-database-migrations).

- [ ] **Stored media** — Preserve ownership, byte accounting, storage-root confinement, rollback, and missing-media behavior ([pipelines](docs/maintenance.md#review-stored-media), [deleting media](docs/maintenance.md#agents-deleting-media-a-post-uses), [storage-root confinement](docs/maintenance.md#agents-security-configuration-tips)).

### Client and presentation

- [ ] **Client components & data flow** — Keep transport in client modules and preserve server/client boundaries, cleanup, and feedback ([module boundary](docs/architecture.md#review-client-components-data-flow), [client-side API calls](docs/architecture.md#agents-client-side-api-calls), [component patterns](docs/architecture.md#client-component-patterns)).

- [ ] **Page chrome, layout & accessibility** — Use shared page headers and navigation; verify responsive layout, contrast, and browser behavior ([page header & sub-navigation](docs/architecture.md#review-page-chrome-layout-accessibility), [accessibility](docs/architecture.md#accessibility)).

- [ ] **Surfaces** — Build page UI from the shared surface kit (`lib/components/surface/`): `rounded-lg` frames with no panel shadow, sentence case, theme tokens only, every list one framed `divide-y` list, one `Frame form` of `FormRow`s with a `SaveBar` footer, `Alert` for messages, skeletons instead of "Loading…". [Detailed checks](docs/architecture.md#review-surfaces).

- [ ] **Post media layout** — Preserve attachment layout, dimensions, unsupported media, and the intended fallback behavior. [Detailed checks](docs/architecture.md#review-post-media-layout).

- [ ] **Link preview cards** — Preserve per-URL caching, failure state, shared text extraction, and current-status URL checks. [Detailed checks](docs/architecture.md#review-link-preview-cards).

### Federation, fitness, auth, and email

- [ ] **Actor usernames** — Preserve case-insensitive ownership and safe actor-id path segments. [Detailed checks](docs/mastodon-api-compatibility.md#review-actor-usernames).

- [ ] **Status delete & unboost federation** — Commit local deletion before fan-out, preserve atomic database enqueue, and use pre-deletion payload snapshots. [Detailed checks](docs/architecture.md#review-status-delete-unboost-federation).

- [ ] **Apple Maps basemap** — Preserve MapKit provider behavior, attribution, geometry, failure handling, and fallback. [Detailed checks](docs/fitness-file-storage.md#review-apple-maps-basemap).

- [ ] **Fitness route heatmap pyramid** — Preserve privacy filtering, tile geometry, shared-image behavior, and renderer fallback limits. [Detailed checks](docs/fitness-file-storage.md#review-fitness-route-heatmap-pyramid).

- [ ] **Better-auth session refresh** — Server-side session reads never slide a session; refreshes happen only inside better-auth's `/api/auth/*` handler, where the cookie is re-issued with the row. [Detailed checks](docs/architecture.md#review-better-auth-session-refresh).

- [ ] **OAuth access token sliding expiry** — Every bearer guard slides a user's opaque access token forward when it accepts a request, and only then, because this server issues no refresh tokens; every path that mints one uses `OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS`. [Detailed checks](docs/architecture.md#review-oauth-access-token-sliding-expiry).

- [ ] **Auth error page** — Preserve documented error codes and user-visible recovery behavior. [Detailed checks](docs/architecture.md#review-auth-error-page).

- [ ] **Unconfirmed accounts & app tokens** — Keep confirmation/moderation predicates and narrowly scoped guard exceptions intact. [Detailed checks](docs/architecture.md#review-unconfirmed-accounts-app-tokens).

- [ ] **Emails** — Keep shared email rendering, transport configuration, and safe link/recipient handling. [Detailed checks](docs/architecture.md#review-emails).

### Workflow and release

- [ ] **Logging** — Use server-only structured logging, normalized errors, and feature-specific persisted failure state. [Detailed checks](docs/architecture.md#review-logging).

- [ ] **Style, imports & tests** — Use the Vitest API with typed mocks, keep assertions strong, respect import boundaries (e.g. `date-fns` sub-paths), follow the environment rules (jsdom docblocks, fake timers, pinned `TZ`), and keep every test file inside the typecheck program ([detailed checks](CONTRIBUTING.md#review-style-imports-tests), [typecheck coverage](docs/setup.md#agents-build-test-and-development-commands)).

- [ ] **Docs hygiene** — Update stale reference guides in the same change and keep task artifacts outside tracked documentation ([docs hygiene](CONTRIBUTING.md#review-docs-hygiene), [documentation maintenance](CONTRIBUTING.md#agents-documentation-maintenance)).

- [ ] **Commits & versioning** — Use a feature-branch PR and a conventional title (it drives the CI version bump); never edit the `package.json` version manually ([versioning](CONTRIBUTING.md#review-commits-versioning), [PR guidelines](CONTRIBUTING.md#agents-commit-pull-request-guidelines)).

- [ ] **CI checklist** — Require the three ruleset checks (All Tests, Lint and Prettier, Build); CI Success is the fail-closed aggregate of every job. [Detailed checks](CONTRIBUTING.md#review-ci-checklist).

### Required final checks

- [ ] The five commands in the Definition of Done pass in order: `yarn run prettier --write .`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.
- [ ] The change updates every stale durable guide and keeps package version, generated instruction blocks, and required symlinks intact.
- [ ] The PR uses the contributor workflow and documents any unavailable review loop or deferred gate explicitly.
