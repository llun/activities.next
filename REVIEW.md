# Code Review Checklist

A focused checklist for reviewing changes to **activities.next**. It captures the
project-specific invariants that are easy to miss in a diff — both the rules in
`AGENTS.md` and recurring patterns surfaced in past code review. `AGENTS.md`
remains the authoritative source for the full rules. Skip sections that a given
change doesn't touch.

## Runtime vs. build-time configuration

- No `ACTIVITIES_*` or `OTEL_EXPORTER_*` reads outside `lib/config/`, and no env
  var name constants defined elsewhere — callers import a config utility instead.
- `next.config.ts` stays a thin entrypoint and must not _read_ runtime deployment
  config — directly or via `images.remotePatterns`, `headers()`,
  `allowedDevOrigins`, webpack config, or `generateBuildId`. Those constructs are
  fine as long as they consume only build-safe values (delegate to `lib/config/`
  helpers, as the committed config does); the build must still succeed with
  `ACTIVITIES_*` missing. Don't define reusable helpers/parsers/constants here —
  move them to `lib/`. Build-only flags (`NODE_ENV`, `BUILD_STANDALONE`,
  `NEXT_TELEMETRY_DISABLED`) are fine to read.
- Runtime config that affects browser-visible behavior (CSP, security headers,
  host redirects, upload origins) lives in request-time server code, not static
  Next config.
- A build must succeed with `ACTIVITIES_*` missing or set to placeholder values.
  Changes to runtime-config handling should ship a regression test asserting the
  build config does not consume those values.

## API routes

- Responses go through `apiResponse` / `apiErrorResponse` from
  `@/lib/utils/response` — never `Response.json()`. On CORS-enabled routes (those
  exporting `OPTIONS`), use `apiResponse` even for errors so CORS headers are sent;
  reserve `apiErrorResponse` for non-CORS routes or middleware.
- Request bodies are validated with Zod **`safeParse`**, never `.parse()` (which
  throws and surfaces as a 500). Invalid input returns a 4xx, not a 500.
- String fields backed by a sized column (e.g. `varchar(255)`) carry a matching
  `.max(...)`; nullable text columns normalize empty/whitespace input to `null`
  via `.transform((v) => v || null)`, consistently across create and update.
- State-changing routes (POST/PUT/PATCH/DELETE) that authenticate a cookie session
  manually — rather than through the standard guards — explicitly verify
  same-origin proof via `hasSameOriginProof`
  (`lib/services/guards/sameOriginProof`) to block CSRF. The shared guards
  (`AuthenticatedGuard`, `AdminApiGuard`, …) already enforce this.
- Fetch and apply the actor's active content filters even for unauthenticated
  requests (`getActiveFiltersForActor`), so timeline and detail/context views
  filter consistently.
- Don't case-normalize identity fields (e.g. lowercasing an email) in a single
  endpoint while the rest of the stack treats them case-sensitively — a partial
  change splits lookups. Case-handling must be holistic across the codebase.
- Mastodon-compat mutation responses return the affected entity even when the
  actor can't otherwise read it — e.g. removing a bookmark from a now-unreadable
  status still returns the full `Status` with `bookmarked: false`, not a redacted
  one.

## Unique constraints (TOCTOU)

- Pre-checking uniqueness (email/username exists?) before an insert/update is a
  Time-of-Check to Time-of-Use race: concurrent requests slip past the check and
  hit a DB unique-constraint violation that surfaces as a 500.
- Wrap the write and catch the specific violation (e.g. `isUniqueConstraintError`),
  mapping it to a `422 Unprocessable Entity` instead of letting the raw DB error
  propagate. The pre-check is a UX nicety; the caught violation is the guarantee.
- When a write can violate several unique constraints (multi-column / multi-table
  inserts), identify the offending field by re-running the existence checks — do
  not parse backend-specific constraint names or messages, which differ across
  SQLite and PostgreSQL.

## Database & migrations

- Queries use the Knex query builder, not raw SQL, unless unavoidable. Operations
  must work on SQLite (tests + local dev) and PostgreSQL, and avoid breaking
  MySQL-compatible Knex clients. Use standard SQL types (e.g. `text`, not
  `varchar[]`).
- Any PR that adds/edits/removes a migration regenerates **both**
  `migrations/schema.sql` (PostgreSQL) and `migrations/schema.sqlite.sql` (SQLite)
  in the same PR, against fresh local DBs — never hand-edited. Commit a
  schema-only regeneration as `none:`.
- Better-auth plugins are only registered once their required tables exist in a
  migration; admin/dashboard plugins are gated with explicit access control.
- Cursor-based pagination: pass the raw cursor row (with its stored representations,
  e.g. a `Date`) to the query builder's cursor helper rather than pre-normalizing
  it (e.g. to a millisecond `number`), so it matches the column's backend
  representation. When resolving a cursor record by id, don't filter the lookup by
  mutable status fields (`pending`, `requested`, …) — the row must still resolve if
  its status changed between page requests.
- Mastodon pagination: `since_id` and `min_id` are not interchangeable —
  `since_id` returns the newest band above the cursor (descending), `min_id` the
  oldest band immediately after it (ascending, then reversed). Order each query
  accordingly.
- Idempotency-key storage uses `.onConflict().ignore()`, not `.merge()`, so the
  first stored resource id is preserved when a request is retried.

## Client components & data flow

- React components never call `fetch()` directly — every client→server call is a
  named, typed, exported function in `lib/client.ts`, imported from there.
- Server Components never pass `new Date()` to a Client Component. Pass
  `Date.now()` (a `number`); the client takes `currentTime: number` and builds
  `new Date(currentTime)` itself.
- Client Components that render relative timestamps (or fan out to `Posts`/`Post`)
  never call `Date.now()` / `new Date()` during render — they receive and forward
  `currentTime` from the server to avoid hydration mismatches.
- Settings/account forms are client components that POST JSON and show inline
  success/error, not HTML `<form method="post">` with server redirects; the route
  returns JSON via `apiResponse()`.
- Validate any user-controlled URL before using it as an `href`: parse with
  `new URL()` and allow only the `http:` or `https:` protocols — not a `startsWith`
  or regex check — so a `javascript:` (or other) scheme can't become a DOM-XSS
  sink (see `lib/utils/fitness.ts`).
- React state updater functions stay pure — no side effects, and don't fire another
  variable's state update from inside an updater. Do the separate `setState` calls
  in the event handler instead, so Strict Mode's double-invoke can't misfire them.
- Optimistic UI (e.g. optimistic delete with rollback on failure) disables the
  create/edit actions while the operation is in flight, so a rollback can't discard
  items added in the meantime.
- Don't wrap a callback in `useCallback` when its dependencies change on every
  render, or when the consuming child isn't memoized — it adds cost without
  preventing re-renders.

## Page chrome, layout & accessibility

- `(timeline)` pages use `PageHeader` from `@/lib/components/page-header` and share
  the single `max-w-content` (940px) width. No reintroduced `max-w-2xl`/`max-w-4xl`
  split, `contentWidth` prop, or `data-layout-width="wide"`.
- Settings-style sections (settings, fitness, admin) use the shared
  `SectionNavDropdown` on every breakpoint — no re-inlined dropdown markup and no
  desktop vertical icon rail. Sentence-case labels ("Blocked accounts").
- When pairing a visible count with `sr-only` text, put only the noun (e.g.
  "boosts") in the `sr-only` span, not the number — the visible digit is already
  announced, so including it double-reads (see `posts/read-only-stats.tsx`).
- Use the dynamic viewport unit `min-h-dvh` (not `min-h-screen` / `100vh`) for
  full-height layouts, so mobile browser toolbars don't break centering.
- One `<main>` landmark per page: don't render `<main>` in a `page.tsx` when an
  ancestor layout already provides one.

## Logging

- No `console.*` in committed code. Server-side code uses `logger` from
  `@/lib/utils/logger` (`logger.info({ message })`). Migrations and `scripts/` may
  use `console.*`. Do not log from React/client code.

## Style, imports & tests

- TypeScript + React, 2-space indent; Prettier (no semicolons, single quotes,
  import sorting) is clean. Unused vars are `_`-prefixed.
- Absolute imports (`@/lib/...`) for anything outside the current directory;
  same-directory `./` only, no `../`. The same rule applies to `vi.mock(...)`
  paths.
- Tests are co-located, named `*.test.ts(x)`. `describe`/`it` names are plain
  descriptive text — no `#`/`.` sigil — and read as behavior statements.
  Input/expected-only variations use a table-driven `it.each([...])`.
- Tests run on **Vitest** (`vi.*`, not `jest.*`). To read a mocked module and
  configure it, prefer **`vi.importMock<T>('@/path')`** over
  `(await import('@/path')) as unknown as T`. `vi.importMock` is purpose-built,
  returns a typed `MaybeMockedDeep<T>` (no `as unknown as` cast needed), and
  always yields the mock; bare `await import()` returns the real module unless it
  is separately `vi.mock`'d. (Some review bots wrongly flag `vi.importMock` as
  non-existent — it is a valid, documented Vitest API.)

## Docs hygiene

- `docs/` is durable, general-purpose reference only. No implementation plans,
  design docs, PR/task-specific writeups, gap analyses, or screenshots, and no
  `docs/plans/`, `docs/specs/`, `docs/pr-screenshots/` scratch dirs — that belongs
  in the PR description.
- The diff updates every doc its behavior change makes stale (see
  `AGENTS.md` → Documentation Maintenance): commands/scripts/tooling →
  `AGENTS.md` + `CONTRIBUTING.md`; env vars → `docs/environment-variables.md` +
  `.env.example`; routes → `docs/architecture.md` + feature guides; deployment →
  `README.md` + setup guides; conventions → `AGENTS.md` + this checklist. Grep
  the repo's Markdown for identifiers the diff renames or removes.

## Mastodon and Fediverse Interoperability Quirks

When reviewing code that interfaces with Mastodon APIs, ActivityPub, or JSON-LD contexts, note the following deliberate deviations from standard web best practices required for Fediverse interoperability in this codebase:

- **Actor URIs vs. Opaque IDs:** `account.url` maps to the full Actor URI (e.g., `https://domain/users/username`), while `account.id` is an opaque, colon-encoded identifier (e.g., `domain:users:username`). Do not flag `account.url` as a profile URL that should be replaced with `account.id` for Actor URI lookups; doing so causes 404s in follow request routes.
- **Schema.org Namespace:** The JSON-LD `@context` must use `http://schema.org#` (not `https://schema.org#`). Mastodon strictly maps the `schema` prefix to the non-standard `http://schema.org#` base. Changing to HTTPS breaks JSON-LD compaction and silently drops profile fields like `PropertyValue`.
- **Internal API CORS:** Next.js API routes exclusively consumed by the internal web client (e.g., via `lib/client.ts`) do not require `OPTIONS` handlers or CORS preflight configurations, even if they use `apiResponse` with `allowedMethods`.
- **Conditional Object Spreading:** Spreading `null` in object literals (e.g., `...(cond ? { ... } : null)`) is a deliberate, consistent no-op pattern used to cleanly omit keys and should not be flagged as confusing or replaced with `{}`.

## Commits & versioning

- Every commit subject starts with a conventional prefix (`fix:`, `feat:`,
  `chore:`, `refactor:`, `test:`, `docs:`, `none:`, `minor:`, `major:`).
- `version` in `package.json` is never edited by hand — CI bumps it from prefixes.
- For a `minor`/`major` bump the **PR title** carries the prefix (PRs squash-merge,
  so the title is the commit subject). `.github/`-only changes are no-bump unless
  explicitly `minor:`/`major:`.
- Pre-commit gate is green in order: `yarn run prettier --write .`, `yarn lint`,
  `yarn build`, `yarn test`.
