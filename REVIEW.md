# Code Review Checklist

A focused checklist for reviewing changes to **activities.next**. It captures the
project-specific invariants that are easy to miss in a diff — both the rules in
`AGENTS.md` and recurring patterns surfaced in past code review. `AGENTS.md`
remains the authoritative source for the full rules. Skip sections that a given
change doesn't touch.

## How to use this checklist

Review the diff against the linked canonical rule source. Check every applicable row, follow links into the guide before approving a change, and record any exception in the PR. The original detailed review rules are retained in their owning existing guides; this file is the fast review index.

### Runtime and boundaries

- [ ] **Runtime vs. build-time configuration** — Keep deployment values in request-time code and out of the Next build configuration. [Detailed checks](docs/architecture.md#review-runtime-vs-build-time-configuration).

- [ ] **API routes** — Use response helpers, Mastodon error bodies, CORS headers, safeParse, and the correct authorization boundary. [Detailed checks](docs/mastodon-api-compatibility.md#review-api-routes).

- [ ] **Fetched ActivityPub document ids** — Verify fetched-object authority before trusting returned ids or changing local state. [Detailed checks](docs/mastodon-api-compatibility.md#review-fetched-activitypub-document-ids).

- [ ] **Mastodon and Fediverse Interoperability Quirks** — Preserve all supported client id shapes, offline JSON-LD handling, and federation compatibility rules. [Detailed checks](docs/mastodon-api-compatibility.md#review-mastodon-and-fediverse-interoperability-quirks).

### Storage and database

- [ ] **Uploaded file names** — Use canonical name, extension, and temporary-path helpers before storing or decoding uploads. [Detailed checks](docs/maintenance.md#review-uploaded-file-names).

- [ ] **Unique constraints (TOCTOU)** — Enforce uniqueness and ownership at the database write, including concurrent requests. [Detailed checks](docs/maintenance.md#review-unique-constraints-toctou).

- [ ] **Database & migrations** — Use portable queries, regenerate both schema dumps, and test backend-sensitive behavior. [Detailed checks](docs/maintenance.md#review-database-migrations).

- [ ] **Stored media** — Preserve ownership, byte accounting, storage-root confinement, rollback, and missing-media behavior. [Detailed checks](docs/maintenance.md#review-stored-media).

### Client and presentation

- [ ] **Client components & data flow** — Keep transport in client modules and preserve server/client boundaries, cleanup, and feedback. [Detailed checks](docs/architecture.md#review-client-components-data-flow).

- [ ] **Page chrome, layout & accessibility** — Use shared page headers and navigation; verify responsive layout, contrast, and browser behavior. [Detailed checks](docs/architecture.md#review-page-chrome-layout-accessibility).

- [ ] **Post media layout** — Preserve attachment layout, dimensions, unsupported media, and the intended fallback behavior. [Detailed checks](docs/architecture.md#review-post-media-layout).

- [ ] **Link preview cards** — Preserve per-URL caching, failure state, shared text extraction, and current-status URL checks. [Detailed checks](docs/architecture.md#review-link-preview-cards).

### Federation, fitness, auth, and email

- [ ] **Actor usernames** — Preserve case-insensitive ownership and safe actor-id path segments. [Detailed checks](docs/mastodon-api-compatibility.md#review-actor-usernames).

- [ ] **Status delete & unboost federation** — Commit local deletion before fan-out, preserve atomic database enqueue, and use pre-deletion payload snapshots. [Detailed checks](docs/architecture.md#review-status-delete-unboost-federation).

- [ ] **Apple Maps basemap** — Preserve MapKit provider behavior, attribution, geometry, failure handling, and fallback. [Detailed checks](docs/fitness-file-storage.md#review-apple-maps-basemap).

- [ ] **Fitness route heatmap pyramid** — Preserve privacy filtering, tile geometry, shared-image behavior, and renderer fallback limits. [Detailed checks](docs/fitness-file-storage.md#review-fitness-route-heatmap-pyramid).

- [ ] **Auth error page** — Preserve documented error codes and user-visible recovery behavior. [Detailed checks](docs/architecture.md#review-auth-error-page).

- [ ] **Unconfirmed accounts & app tokens** — Keep confirmation/moderation predicates and narrowly scoped guard exceptions intact. [Detailed checks](docs/architecture.md#review-unconfirmed-accounts-app-tokens).

- [ ] **Emails** — Keep shared email rendering, transport configuration, and safe link/recipient handling. [Detailed checks](docs/architecture.md#review-emails).

### Workflow and release

- [ ] **Logging** — Use server-only structured logging, normalized errors, and feature-specific persisted failure state. [Detailed checks](docs/architecture.md#review-logging).

- [ ] **Style, imports & tests** — Keep typed mocks, assertion strength, import boundaries, and all tests inside the typecheck program. [Detailed checks](CONTRIBUTING.md#review-style-imports-tests).

- [ ] **Docs hygiene** — Update stale reference guides and keep task artifacts outside tracked documentation. [Detailed checks](CONTRIBUTING.md#review-docs-hygiene).

- [ ] **Commits & versioning** — Use a feature-branch PR and conventional title; never edit package version manually. [Detailed checks](CONTRIBUTING.md#review-commits-versioning).

- [ ] **CI checklist** — Require all four protected checks, including CI Success and its complete upstream dependency set. [Detailed checks](CONTRIBUTING.md#review-ci-checklist).

### Required final checks

- [ ] The five commands in the Definition of Done pass in order: `yarn run prettier --write .`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.
- [ ] The change updates every stale durable guide and keeps package version, generated instruction blocks, and required symlinks intact.
- [ ] The PR uses the contributor workflow and documents any unavailable review loop or deferred gate explicitly.
