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
- Error bodies use Mastodon's `{ error: 'message' }` shape, never `{ status: … }`.
  The shared `apiErrorResponse` / `apiCorsError` / `codeMap` helpers already emit
  `{ error }`; an inline error body must too (`data: { error: '…' }`). Mastodon
  clients read the message from `error`, so a `{ status: … }` body breaks them.
  Only success acks (`DEFAULT_200`/`DEFAULT_202`) keep `{ status: … }`.
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

## Uploaded file names

- A supplied file name (`File.name`, the presigned flows' `fileName`) is
  attacker-controlled: only browser multipart uploads send a bare basename. In
  the upload storage drivers (`lib/services/medias/`,
  `lib/services/fitness-files/`) it must never be joined to a path, passed to
  `extname`, or persisted raw — it goes through `@/lib/services/medias/fileName`
  first. `medias.originalFileName` and `fitness_files.fileName` are both
  `varchar(255)`, so an over-long name is also a PostgreSQL insert failure.
- Temp paths from a supplied name use `createMediaTempFilePath` (random prefix,
  explicit separator, parent asserted to be `tmpdir()`), never
  `join(tmpdir(), prefix + name)` — `path.join` resolves `..`, and prepending a
  prefix without a separator does not stop it: enough `..` still escapes, and
  fewer cancel the prefix out into a predictable path.
- A generated path's extension comes from the validated content type via
  `getStoredMediaExtension()`, not from the name. Every `ACCEPTED_FILE_TYPES`
  entry needs a mapping in `EXTENSION_BY_CONTENT_TYPE`, or it falls through to
  the name.
- A video's preview frame is extracted through the shared
  `extractVideoPreviewFrame` (`medias/videoPreview`) **before** the video is
  stored, never from the stored file: `extractVideoImage` rejects when ffmpeg
  finds no decodable frame, and a stored file with no `medias` row is
  unreachable by everything except `scripts/maintenance/cleanupMediaStorage.ts`.
  Its temp copy goes through `createMediaTempFilePath` like any other, but the
  name it hands over is the server-derived `video<ext>` (so the path is
  `<random prefix>-video<ext>`) and takes nothing from the supplied name —
  ffmpeg picks its demuxer from the path too, and `image2` beats content probing
  for an image extension carrying a `%0Nd` or `*` pattern, so `IMG_%04d.jpg` on
  a valid mp4 turned a storable upload into a 500. Validate the container from
  the probe first, so an audio-only mp4 stays a 422 that never spawns ffmpeg.

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
  schema-only regeneration as `none:`. (CI's Schema Dump Sync job catches
  SQLite-dump drift; the PostgreSQL dump is not CI-checked.)
- "Is this actor local?" is `whereLocalActor`
  (`lib/database/sql/utils/localActor.ts`), never a hand-written
  `whereNotNull('privateKey')`. Legacy rows store `privateKey = ''` for REMOTE
  actors, so a null-only check counts them as local — it did for 216 of 221 rows
  on production. In JS the test is `Boolean(actor.privateKey)`, never
  `actor.privateKey !== ''`: the row mapper drops the field when falsy, so that
  comparison is always true and filters nothing. Note `.modify()` returns
  `QueryBuilder<any, any>` — name the row type on the `select` if the rows are
  consumed as a typed shape.
- The local public timeline passes local actor ids in as literal values and must
  not join `actors`. Joining on that unique key collapses the planner's estimate
  and loses `LIMIT` early termination at every page size once the `<> ''`
  predicate is present (on a local seed matching production's shape, 176
  buffers vs ~16,700 at a page of 30, and the join is no better at 23). The id fetch carries an explicit `LIMIT` of one past
  what the query can bind — it runs on an anonymous path, which is why the bound
  is required, not what supplies it.
- A new composite index orders its columns so the ones **every** caller
  constrains come first. A column that only some callers pin belongs last:
  anything after an unconstrained column cannot become an index condition, and
  the query silently degrades to scanning the whole leading-column range.
  `statuses_announce_original_actor_idx` is `(type, "originalStatusId",
"actorId")` for exactly that reason — `getRebloggedBy` leaves `actorId` free.
  Because the callers that pin all three columns behave identically under either
  order, a functional test cannot see the difference; assert the index
  definition itself (`statusAnnounceIndexOrderMigration.test.ts`).
- PostgreSQL 18 naming an index whose leading column the query does not
  constrain is not by itself a finding. Skip scan makes it a candidate and
  `cost_index` prices heap I/O off the leading column's correlation, which
  low-cardinality columns score high on spuriously — but the heap fetches
  dominate and are the same either way. Measure the alternative on a local seed
  before proposing anything; there is no `enable_indexskipscan` GUC, and never
  A/B it by dropping an index on production.
- A caller-supplied id compared against a **numeric** column is coerced first.
  `medias.id` and `attachments.mediaId` are `integer` on PostgreSQL, so passing a
  non-numeric client string raises `invalid input syntax for type integer` — a
  500 where a 404 was intended. SQLite's dynamic typing just misses, so only
  `TEST_DATABASE_TYPE=pg` catches it. `lib/database/sql/media.ts` routes every
  `mediaId` it **compares** against `medias.id` through `toMediaRowId`.
  It accepts only optional leading zeros, digits, an optional all-zero
  fraction, and 1..2147483647. That is deliberately tighter than the backends:
  on PostgreSQL `'0x10'`/`'0b101'` resolved rows 16/5 (it takes non-decimal
  integer literals since 16), and on both backends `'+12'`/`' 12 '` resolved
  row 12 — all now 404, which is intended, since a media id is a row id.
  `'12.0'` is kept only because SQLite's `varchar` `attachments.mediaId` can
  hold that form. New numeric-column lookups do the same, and fixtures use
  values the column can hold.
- `createAttachment` **writes** `mediaId` rather than comparing it and is
  deliberately unguarded — coercing would drop the link instead of surfacing a
  bad id. Its callers must therefore hand it an id already resolved against
  `medias`. `POST /api/v1/accounts/outbox` does not (its `PostBoxAttachment.id`
  is a bare `z.string()`), so a malformed id there fails the insert on
  PostgreSQL after the status row is committed — a known open bug, separate
  from the lookup guard.
- A per-column type difference between the two schema dumps is not automatically
  drift — a backend-conditional migration (e.g.
  `20260207223000_fix_attachments_media_id_type.js`, PostgreSQL-only) makes them
  legitimately differ. Read the migration before asking for a regeneration.
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
  (Lint-enforced; the frozen legacy exception list in `.oxlintrc.json` must
  only ever shrink.)
- Server Components never pass `new Date()` to a Client Component. Pass
  `Date.now()` (a `number`); the client takes `currentTime: number` and builds
  `new Date(currentTime)` itself.
- A `<Link>` rendered once per feed/list row passes `prefetch={false}`. `<Link>`
  prefetches on viewport entry, so in an infinite-scroll feed that is one RSC
  request per row — against dynamic routes that also federate out for
  unpersisted remote actors. Navigation chrome (sidebar, sub-nav, pagination)
  keeps prefetching. See **Link prefetching in feeds** in `AGENTS.md`.
- Client Components that render relative timestamps (or fan out to `Posts`/`Post`)
  never call `Date.now()` / `new Date()` during render — they receive and forward
  `currentTime` from the server to avoid hydration mismatches.
- Status posts render through the shared `Posts`/`Post` components with the same
  action set on every surface. A page turns actions on with `currentActor` +
  `showActions`; it must not pass per-status action callbacks (`onReply`/`onQuote`/
  `onEdit`), hide individual actions, or build a bespoke post/action row.
  Reply/quote/edit use the shared `InlineStatusComposer`; pages pass only
  data-sync callbacks (`onStatusCreated`/`onPostUpdated`/`onPostDeleted`/
  `onLikeChanged`/`onBookmarkChanged`/`onReactionsChanged`) and
  `isMediaUploadEnabled`. See **Status Posts & Actions** in `AGENTS.md`.
  - Two **detail** surfaces are the standing exception, and they are not feeds:
    `StatusBox` and `FitnessStatusDetail` each render a single post and drive the
    shared `useInlineComposer`/`InlineStatusComposer` themselves, so they do pass
    `editable` + `onEdit` + `onQuote`. That is the shared layer doing the wiring,
    not a page opting into per-status callbacks — a _feed_ passing them is still
    the defect this rule is about.
  - A surface may **add** a `⋯` item for something only it knows about the post,
    via `Actions`' `extraMenuItems` (today: the fitness detail's "Change gear"
    submenu). An extra item is either one action or a submenu of pick-one
    choices, it renders after any items a compact row displaced into the menu,
    and there is deliberately no prop for removing or replacing one of the
    menu's own items — flag any attempt to add one.
- The reaction chips and the action row are both full-bleed (`-ml-13`), and the
  action row packs every action into one `gap-1` cluster at the post's left edge
  with only the `⋯` menu pushed right by an `ml-auto` on its wrapper. That auto
  margin is what does the work — flexbox feeds free space to auto margins before
  `justify-content` sees it, so it beats any `justify-content` the row might
  carry — and the row therefore keeps none of its own. Dropping the margin
  collapses `⋯` into the cluster; a `justify-between` without it spreads all
  five actions across the full width. Each row carries its own
  `fullBleed` prop and they default differently — `Actions` pulls unless told
  not to, `ReactionRow` only when asked — so a surface with no avatar column to
  pull back over (the fitness activity detail's card) correctly has neither.
  The row still gets the full width of its container — the spacing between
  actions is a width-independent `gap-1`, but `⋯` needs the post's right edge
  to sit on. The edit-history
  panel is anchored to the row (its trigger's wrapper is deliberately not
  `relative`) and sits `right-0`, flush with the post's right edge — anchored to
  the trigger, its 25rem width starts wherever the counts push that trigger and
  the post's card clips the overhang. The picker trigger lives
  in the action row (`ReactionButton`), not beside the chips, and both halves
  share one `useReactionState`; `useBookmarkState` is held by `Actions` for the
  same reason. A row narrower than 400px — measured by `ResizeObserver` on the
  row itself, never a viewport breakpoint — hands bookmark and react to the `⋯`
  menu, and a menu item opening a focus-taking surface uses `deferUntilClosed`
  (which also suppresses Radix's focus restore). A control that moves into the
  menu keeps a `disabled` state while its write is in flight and still surfaces
  its error from the row, absolutely positioned so it adds no flex item.
- Settings/account forms are client components that POST JSON and show inline
  success/error, not HTML `<form method="post">` with server redirects; the route
  returns JSON via `apiResponse()`.
- Server-only code (`app/api/`, `lib/services|actions|jobs|database|config`)
  never imports a **runtime value** from a `'use client'` module — on the server
  it resolves to a client reference, so a constant read out of it is empty and no
  test can see it (`lib/clientModuleBoundary.test.ts` enforces this).
  Type-only imports are fine; `export … from` re-exports are not. Shared
  constants live in a dependency-free module both sides import. See
  **Server/Client Module Boundary** in `AGENTS.md`.
- Client authoring UI reads admin-configured limits from `useInstanceLimits()`
  rather than hardcoding a constant, and new authoring/upload surfaces render
  under `InstanceLimitsProvider`. The limits are still enforced server-side. See
  **Instance Limits in Client Components** in `AGENTS.md`.
- Validate any user-controlled URL before using it as an `href`: parse with
  `new URL()` and allow only the `http:` or `https:` protocols — not a `startsWith`
  or regex check — so a `javascript:` (or other) scheme can't become a DOM-XSS
  sink (see `lib/utils/fitness.ts`).
- Fitness gear distance stays **derived**, never cached in a column, and every
  rollup reuses the same completed/primary/not-deleted predicate as
  `getFitnessActivitySummary` so the numbers reconcile across surfaces. Sport
  matching goes through `normalizeActivityTypeToSportKey`, never the raw
  `activityType`, and import jobs assign with `assignFitnessFileGearIfUnset` so a
  re-run can't clobber a manual assignment. No importer reads gear from Strava or
  creates a gear row — attribution comes only from the owner's `defaultSports`
  mapping. See **Fitness Gear** in `AGENTS.md`.
- A `kind: 'device'` gear is a recording device and follows different rules from
  a bike or shoes. `deviceKey` is create-only — it is the identity an upload
  matches against, while `name`/`brand`/`model`/`productUrl` are display fields
  the owner edits — and `resolveDeviceGear` is the only thing that may create
  one (the create route answers 422). Deleting a device must **release** its
  `deviceKey` in the same transaction, because the unique index covers
  soft-deleted rows. Devices are filtered out of the activity gear picker
  **before** its kind narrowing, and `setFitnessFileGear` rejects one outright:
  `gearId` means "what was this ride done on", and an activity pointed at a
  device falls out of every rollup. The device rollups **replace** `isPrimary`
  with a per-ride-per-device rule — of the countable files sharing a
  `(statusId, deviceGearId)`, exactly one survives, the primary if that device
  owns it and otherwise the lowest id — because the merge groups by time overlap
  and never looks at the device columns. That counts the watch half of a
  two-device ride while counting a `.fit`+`.gpx` pair from one device once, and
  it must never defer to a sibling that is itself uncountable (a merge writes
  the primary `pending`). The rollup and the activity list must apply the
  identical predicate, so the only thing that may separate a device's count from
  its page is an activity whose post was deleted. The device page link
  is owner-only; everyone else gets the branded manufacturer link.
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
- Fitness stat strips (the activity detail's header strip, the strip under its
  map, the inline chip in a post) render through `FitnessStatGrid` and size
  themselves with **container** queries — no hand-rolled `grid-cols-*` strip and
  no `sm:`/viewport breakpoint, which cannot see a narrow column on a wide
  window. `@container` belongs on a wrapper, never on the grid it sizes. Two
  older strips (gear detail, fitness overview) are not migrated yet — see
  **Fitness Stat Strips** in `AGENTS.md`.
- A gear's activities render through the shared `GearActivitiesFeed` → `Posts`,
  never a bespoke row list, and the endpoint's `nextOffset` counts activity rows
  rather than the statuses in the page (an activity whose post was deleted still
  occupies an offset). Both the initial load and "Load more" walk past a page
  that is postless, and the empty state is gated on `!hasMore` — "no activities"
  above an enabled "Load more" is the bug that gate exists for.
- A nested sub-nav that switches a **view** uses the shared `SectionNavSelect`
  (state-driven); one that navigates to another route uses the in-content
  segmented control via `PageSubnavProvider`. Neither is ever re-inlined. A bike
  gets the Components/Activities switcher; shoes and devices render none,
  because a menu with one entry is dead UI.
- Gear tables (the gear list's bikes/shoes/devices, the components table on a
  gear's page) pin their first column through `STICKY_COLUMN` /
  `STICKY_CLICKABLE_COLUMN` in `app/(timeline)/fitness/gear/gearUi.ts` — never a
  hand-rolled sticky cell. The pinned cell is painted in the card's own surface
  (`bg-card`, never `bg-background` — the design paints the lane the card's
  colour and sets a colour there only to keep the sticky cell opaque, so
  `bg-background` reads as a white stripe down a grey card in light mode and a
  well sunk below it in dark) and must
  stay **opaque**, its hover must be the opaque `bg-muted` on both the row and
  the cell (never `bg-muted/50`, which replaces the background rather than
  layering over it), and a dimmed row dims its **cells**, never the `<tr>` or the
  pinned `<td>` — `opacity` fades a background along with its text. Use
  `STICKY_CLICKABLE_COLUMN` only on a row carrying `group` and its own `hover:`.
  See **Fitness Gear** in `AGENTS.md`.
- Orange **text** uses `text-primary-text`, not `text-primary`. `--primary` is
  the accent orange for icons and fills and is only 3.37:1 on the card, below the
  WCAG AA floor for body text; `--primary-text` is tuned per theme to clear 4.5:1
  on every surface, including the `--muted` row hover. Applies to links, link-ish
  buttons and any orange text node — icons keep `text-primary`. Move stale
  `text-primary` text over when you touch it; `app/globals.contrast.test.ts`
  guards the tokens.
- When pairing a visible count with `sr-only` text, put only the noun (e.g.
  "boosts") in the `sr-only` span, not the number — the visible digit is already
  announced, so including it double-reads (see `posts/read-only-stats.tsx`).
- Use the dynamic viewport unit `min-h-dvh` (not `min-h-screen` / `100vh`) for
  full-height layouts, so mobile browser toolbars don't break centering.
- One `<main>` landmark per page: don't render `<main>` in a `page.tsx` when an
  ancestor layout already provides one.

## Logging

- No `console.*` in committed code (lint-enforced in `app/`/`lib/`). Server-side
  code uses `logger` from `@/lib/utils/logger` (`logger.info({ message })`).
  Migrations and `scripts/` may use `console.*`. Do not log from React/client
  code.
- A caught error is logged as `err: toLoggableError(error)`
  (`@/lib/utils/toLoggableError`), not only as `error: err.message`. The
  formatter reads `err.stack` to emit `stack_trace`; a message string alone
  reports nothing actionable. Keep the human-readable `error: <message>` too
  when that same string is persisted.
- A user-visible degradation is not a `logger.warn` and nothing else — persist it
  where that feature's state lives so it is visible and retryable. But scope the
  signal to what broke: don't reuse a status flag that already means something
  bigger (a missing route map records `fitness_files.mapError`; setting
  `processingStatus: 'failed'` would hide the whole activity from the detail
  dashboard, the stat grid, the fitness overview and every rollup). Grep for what
  reads a flag before reusing it.

## Auth error page

- Failed auth/OAuth requests must reach the in-app `/auth/error`, never
  better-auth's built-in `/api/auth/error`: `onAPIError.errorURL` in
  `lib/services/auth/auth.ts` stays set. The built-in page does not render in
  production — it 302s to `/?error=...`, dropping a failed sign-in on the home
  timeline.
- `AUTH_ERROR_PATH` stays **root-relative**. better-auth copies it straight into
  the `Location` header with no resolution, so an absolute URL built from
  `getBaseURL()` bounces a login started on a trusted alias domain over to
  `ACTIVITIES_HOST` mid-flow.
- The error page never renders `error_description`, and renders the `error` code
  only when it is **allow-listed** (`isKnownAuthErrorCode`) — not merely
  token-shaped. Both are caller-controlled via a hand-crafted link, and
  `?error=Account-locked-please-call-1-800-555-0100` passes the character class
  and length cap while reading as prose on our own auth card.
- That allow-list gates **rendering only**. Both fields are still logged for any
  code: allow-listing bounds nothing in the log (any description can ride a
  mapped code — the 200/64-character caps are the real bounds), and an unmapped
  code is what most needs the description, since better-auth rewrites codes it
  cannot classify to `UNKNOWN` while forwarding the real description.
- Don't add `onAPIError.onError` for correlation: better-auth short-circuits it
  for anything it redirects (`status === 'FOUND'`), which is exactly this class
  of failure, and setting it suppresses better-auth's own built-in logging.
- If `socialProviders`, `sso()` or `genericOAuth()` are added, pass
  `errorCallbackURL` per flow as well — `onAPIError.errorURL` is only the default
  for provider-callback failures.

## Emails

- Every email is built by a `build<Name>Email(params): RenderedEmail` module in
  `lib/services/email/templates/`. No subject/HTML/text literals at a call site.
  All eleven templates follow this; there is no legacy shape left to copy.
- Templates compose blocks from `@/lib/services/email/layout/blocks` and render
  through `renderEmail`; they never write markup. Escaping belongs to the block
  builders, so a template hands in plain strings, and nothing in the layout emits
  an unescaped value today.
- Every `href`/`src` is absolute and built from `getBaseURL()`. Root-relative
  URLs are unresolvable in a mail client, and a hardcoded `https://${config.host}`
  is wrong under `ACTIVITIES_INSECURE_AUTH=true`.
- The plain-text part is derived from the same block list, never hand-written
  alongside the HTML.
- **A local `vi.mock('@/lib/config', …)` must include `getBaseURL`.** It shadows
  the global mock, and because most email call sites catch delivery errors, an
  omission does not fail loudly: the template throws, the catch swallows it, and
  the test passes while the email silently stops sending. This has bitten twice.
- Template changes are verified by rendering:
  `./scripts/mock/renderEmailPreviews.ts` (see `docs/maintenance.md`). A PR
  migrating a template must add it to `buildPreviews()`, and fixtures must be
  production-shaped (43-char codes).
- Outlook-only properties (`mso-padding-alt` on both the button cell and its
  anchor, `mso-hide:all`, the MSO ghost table pinning the column to 600px) are
  load-bearing and invisible in a browser. Don't drop them as dead style.
- **An email image never points at a stored media path directly.** Stored images
  are WebP unless the caller asked for another format, and Outlook desktop and
  Windows Mail cannot decode WebP. An email image needs a stored JPEG copy
  (`saveMediaImageRendition(…, 'jpeg')`) and a column remembering it — the route
  map uses `fitness_files.mapImageEmailPath` — with the WebP as a **live**
  fallback for every case where no copy exists (storage unconfigured, over quota,
  failed encode, or a row predating the column), not legacy-only dead code. A
  stored file with no `medias` row is invisible to generic media cleanup, backup
  and deletion, so check each of those knows about it and that the file is
  deleted wherever its reference is dropped.

## Style, imports & tests

- TypeScript + React, 2-space indent; Prettier (no semicolons, single quotes,
  import sorting) is clean. Unused vars are `_`-prefixed.
- Absolute imports (`@/lib/...`) for anything outside the current directory;
  same-directory `./` only, no `../`. The same rule applies to `vi.mock(...)`
  paths.
- Tests are co-located, named `*.test.ts(x)`. `describe`/`it` names are plain
  descriptive text — no `#`/`.` sigil — and read as behavior statements.
  Input/expected-only variations use a table-driven `it.each([...])`.
- A test that needs to control **when** an awaited call settles imports
  `createDeferred` from `@/lib/testing/deferred` rather than hand-rolling another
  promise-with-exposed-resolve helper (the same eight lines had been copied into
  four files under three names). Its promise stays pending until the test settles
  it — a `Promise.resolve(value)` stand-in collapses the pending render and the
  settled one into the same `act()` flush, so the assertion about the in-flight
  state passes whether or not the code under test is correct.
- Tests run on **Vitest** (`vi.*`, not `jest.*`). To read a mocked module and
  configure it, prefer **`vi.importMock<T>('@/path')`** over
  `(await import('@/path')) as unknown as T`. `vi.importMock` is purpose-built,
  returns a typed `MaybeMockedDeep<T>` (no `as unknown as` cast needed), and
  always yields the mock; bare `await import()` returns the real module unless it
  is separately `vi.mock`'d. (Some review bots wrongly flag `vi.importMock` as
  non-existent — it is a valid, documented Vitest API.)

## Stored media

- Stored-image resizes go through `STORED_IMAGE_RESIZE_OPTIONS`
  (`lib/services/medias/constants.ts`), never an inline `{ fit: 'inside' }`.
  sharp's `fit: 'inside'` **enlarges** by default, so a bare
  `MAX_WIDTH`/`MAX_HEIGHT` box is an upscale, not a cap — it inflates every
  stored image below the cap, silently, with no error and no test failure.
- `original.metaData`/`original.bytes` describe the **uploaded** file, while
  `thumbnail.*` describes the **stored** WebP (`outputInfo`). Know which one a
  change reads: only the latter moves when the encode pipeline changes, and only
  the latter feeds `meta.small`.
- **The two storage drivers must answer the same input identically.**
  `LocalFileStorage` and `S3FileStorage` are edited one at a time and drift
  silently — an uploaded `thumbnail` was stored by one and dropped by the other
  for as long as both existed, so the same upload answered with a different
  `meta.small`/`preview_url` per backend (the upload-response entity only;
  `getMastodonAttachment` hardcodes `preview_url: null` and the AP `Document`
  has no thumbnail field, so nothing federated). Shared policy belongs in a
  module both import
  (`medias/thumbnailInput` validates a supplied thumbnail; `medias/fileName`
  handles supplied names), and a change to one driver's `saveFile` needs the
  matching test in **both** `localFile.test.ts` and `S3StorageFile.test.ts`.
- **A stored file with no `medias` row is unreachable**, so whatever fails
  after a write must reclaim it — only `scripts/maintenance/cleanupMediaStorage.ts`
  can find it otherwise. Equally, do not report a storage failure as a
  `MediaValidationError`: that is a 422 the client will not retry, and
  `handleSyncMediaUpload` deliberately logs nothing for it. Validate input
  first, then let a genuine fault stay a logged 500.

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

- **Actor URIs vs. Opaque IDs:** `account.url` and `account.uri` carry the full Actor URI (e.g., `https://domain/users/username`), while `account.id` is an opaque client-facing identifier — a UUIDv7 `publicId` (e.g., `01937b2f-…`) for rows that have one, falling back to the legacy colon-encoded form (e.g., `domain:users:username`) for rows written before the publicId backfill and for remote actors this instance does not store. `status.id` / `status.uri` split the same way. The id and the URI are different things and neither is derivable from the other: do not flag `account.url` as a profile URL that should be replaced with `account.id` for Actor URI lookups (that causes 404s in follow request routes), and do not "simplify" an id-accepting route into taking a URI.
- **Legacy ID Forms Are Permanent:** only the `publicId` is emitted, but the accept side still resolves every form the instance ever handed out — `resolveClientId.ts` takes the colon-encoded and `apurl_` forms and raw ActivityPub URIs, and `resolveStatusFromPath.ts` takes the sha256 URL hash, a percent-encoded remote URI, and a bare local status-id tail. That asymmetry is deliberate so cached client ids and old links keep working; the legacy branches are not dead code and must not be pruned. Conversely, a new serializer must emit the id via `getClientStatusId`/`getClientActorId` (`@/lib/utils/publicId`) rather than `urlToId(...)`, or that one field regresses to the legacy shape while its siblings emit UUIDs.
- **The Client Never Re-Encodes an ID:** `lib/client.ts` forwards whatever id it was given — a `publicId`, a legacy colon/`apurl_` id, or a raw ActivityPub URI — because the accept side resolves all three. Do not "restore" a `urlToId(...)` call around an id headed for a query param or a JSON body: run over a UUIDv7 it yields `<uuid>:`, which nothing can resolve. The single exception is `toIdPathSegment`, used only for an id interpolated into a URL **path** segment, and it transforms only raw URIs (their slashes would split the route).
- **Schema.org Namespace:** The JSON-LD `@context` must use `http://schema.org#` (not `https://schema.org#`). Mastodon strictly maps the `schema` prefix to the non-standard `http://schema.org#` base. Changing to HTTPS breaks JSON-LD compaction and silently drops profile fields like `PropertyValue`.
- **Internal API CORS:** Next.js API routes exclusively consumed by the internal web client (e.g., via `lib/client.ts`) do not require `OPTIONS` handlers or CORS preflight configurations, even if they use `apiResponse` with `allowedMethods`.
- **Conditional Object Spreading:** Spreading `null` in object literals (e.g., `...(cond ? { ... } : null)`) is a deliberate, consistent no-op pattern used to cleanly omit keys and should not be flagged as confusing or replaced with `{}`.

## Link preview cards

- A card is cached **per URL** in `link_previews` and mapped to a status by
  `status_link_previews`. A change that moves card data onto `statuses`, or
  keys the cache per status, loses the whole point: a widely-shared link is
  fetched once per refresh window, not once per post.
- **A failure must go through `recordLinkPreviewFailure`, never
  `upsertLinkPreview`.** The latter writes the whole row, so recording a failure
  through it blanks a card that every status linking that URL is still showing —
  and the negative cache then suppresses the retry that would repair it. A row
  that is already `completed` keeps its content and its status.
- `fetchLinkPreviewJob` must re-resolve the status's URL before attaching
  (`resolveStatusPreviewUrl`). An edit leaves the pre-edit job queued; without
  the re-check it re-attaches the old card, or resurrects one an edit removed.
  The scheduler and the job must keep using that single resolver.
- Extraction runs the **whole** `processStatusTextContent` and walks its output,
  on both paths — not a rearrangement of its parts, so the extractor sees the
  reader's DOM. Check that `extractPreviewUrl` is still given `tags` and that
  `resolveStatusPreviewUrl` still passes `status.tags`: the emoji substitution
  can EMPTY an anchor whose text the extractor already counted (a non-https
  `Emoji` icon url is dropped entirely by `sanitizeTrustedStatusText`), and
  dropping that one argument silently restores a phishing card.
- **The extractor and the reader parse that shared string with DIFFERENT
  parsers** — htmlparser2 on the server, the browser's own tree construction in
  the client bundle — so any HTML5 rule that MOVES content between elements is a
  divergence. Nested anchors are the known one: `getVisibleText` must keep
  stopping at the FIRST descendant `<a>`, in document order, because a browser
  pops the outer anchor at the inner one's start tag — so the inner anchor and
  everything after it ends up outside. Reject a change that counts a nested
  anchor's text as its ancestor's, and equally one that counts the text AFTER
  the nest (a trailing `" — worth a read."` reads as prose beside an empty
  anchor). Reject "an anchor containing an anchor is invisible" too — text
  before the nest survives and keeps the outer anchor eligible.
  New cases belong in `parserAgreement.test.ts`, which checks the extractor
  against a jsdom DOM rather than against hand-written expectations. A link whose text renders to nothing — empty,
  entity-only, or hidden by `hidden`/`invisible` including via an ANCESTOR — is
  skipped, because otherwise a link the reader cannot see gets a full-width
  clickable card carrying an attacker-chosen title and image. `<template>` is
  not an exception: the sanitizer unwraps it, so that anchor is genuinely
  visible and keeps its card. Reject any change that walks marked's token tree
  for local posts — it cannot see ancestors, cannot decode entities, and its
  table cells crashed the walker into "no links at all".
- **That two-entry hidden-class list is only sufficient because
  `sanitizeText` allowlists the `class` attribute** (`ALLOWED_CONTENT_CLASSES`,
  applied to `a` and `span`). The class reaches the real DOM — `cleanClassName`
  hands an anchor's straight to `className` — and this app compiles Tailwind, so
  before the allowlist a remote post could hide a link with `sr-only`,
  `opacity-0` or any other utility in the bundle and take the card while the
  reader saw nothing. Treat the two lists as one mechanism: adding a class to
  the allowlist without deciding whether it hides content reopens this, and the
  coupling test in `extractUrl.test.ts` is what fails when someone tries. Reject
  prefix globs (`h-*`, `p-*`) however much Mastodon's own config uses them —
  here they would admit `h-screen` and `p-0`. Also reject a
  `SANITIZED_TRUSTED_STATUS_OPTION` that REPLACES `allowedClasses` instead of
  spreading it: a tag with no entry keeps its class untouched, so listing only
  `img` hands `span`/`a` back an unrestricted class attribute.
- **Anything that rewrites status HTML between the two sanitize passes is an
  injection point, and `convertEmojisToImages` is the one that exists.** A
  remote `Emoji` tag's `name` and `icon.url` are stored verbatim, so both are
  attacker-controlled. Four distinct bugs have come out of this one function, so
  reject any change that simplifies it back toward
  `tags.reduce((t, tag) => t.replaceAll(tag.name, …), text)`. It must keep all
  of: searching for a shortcode-shaped **token** and looking the name up (never
  using the name as the search string); a **single** pass over the original text
  (each replacement emits an `alt=":shortcode:"` that a later one would match);
  substituting only in **text** pieces, never inside tags (a `:` survives in an
  href, and rewriting there corrupted the very link the card was for — no
  hostile input needed); and a **function** replacement, which is what makes `$`
  literal (`$&` / `` $` `` are re-read after escaping and splice raw markup
  from elsewhere in the post into the src). `escapeHtml` on the url is required
  on top of those. Reject moving the check to ingest only: at render it also
  covers rows already stored.
- Every optional Mastodon `PreviewCard` field needs an `''`/`0` default. That
  schema is non-nullable and `Status.parse` runs per status inside a handler
  that **skips** what it cannot serialize, so one missing key drops the whole
  status from the timeline rather than just losing the card.
- `html`/`embed_url` stay empty (no oEmbed consumption, so no remote markup is
  handed to clients), thumbnails are `https`-only and hotlinked with
  `referrerPolicy="no-referrer"`, and the href goes through `safeExternalHref`.
- The kill switch is `network.linkPreviews`, checked both when scheduling and
  inside the job (a delayed job must not drain after an operator turns it off).
  It is not a `features.*` flag: that namespace is navigation-only. It gates
  fetching only — the cleanup that drops a card when an edit removes its link
  runs regardless.
- Known and deliberate: a first-fetch failure is never retried, an attached card
  is only refreshed if someone posts the link again, `link_previews` rows are
  never collected, and polls get no card at all. There is no recurring-job
  infrastructure to hang a sweep on, and polls store rendered HTML where notes
  store markdown (so wiring them up needs that asymmetry fixed first, not just
  the call added). Don't flag these as bugs, and don't "fix" them with a sweep
  that has nothing to run it.

## Apple Maps basemap

- Every Apple-rendered map draws `mutedStandard`, interactive and static alike:
  the four MapKit components pass `mapType: mutedStandardMapType(mapkit)` to
  `new mapkit.Map(...)`, and the Web Snapshot URL carries `t=mutedStandard`. A
  surface with its own map type, or a re-enabled `showsMapTypeControl`, loses the
  contrast the route lines, heat runs and privacy circles depend on.
- `mutedStandardMapType` falls back to the literal rather than reading straight
  through `mapkit.Map.MapTypes` — that static belongs to the `map` library, not
  `mapkit.core.js`, and every component builds its map inside a `try` that drops
  the whole map to the static/OSM fallback on throw. Don't "simplify" the
  fallback away.
- The snapshot module keeps its own copy of the literal instead of importing the
  component one: `lib/services/**` is server-only and must not reach into the
  client component tree.
- Adding a query parameter to the snapshot URL shifts `MAX_SNAPSHOT_OVERLAYS`,
  which is derived from `buildPath`. Re-check the ceiling rather than assuming it.

## Fitness route heatmap pyramid

- An activity is folded into a build **exactly once** — the gate is positional
  (`(createdAt, id)` against the build's own cursor), never a counter, and the
  cursor advances for every file the pass finished with, including one whose
  parse threw.
- Resuming requires the build's **own token** (row id + `claimSeq`), not a
  `resume: true` flag; a pass that can present neither a token nor an offset of
  zero must not claim at all, because the claim itself is destructive.
- Every fence — claim, tile flush, progress/status write, completion sweep —
  names the pyramid **row** as well as `claimSeq`.
- Any tile-path failure abandons the build rather than failing the legacy
  heatmap. A build the pass was CARRYING is released from one place — the
  handler's `finally` — rather than at each of the four exits that drop a
  continuation; a build it went on to CLAIM is released at each exit that can
  abandon one.
- A build only stamps `completed` over a history it actually scanned, recounted
  at the decision: `completedAt` is what makes the next claim answer
  `already-fresh`, so certifying short refuses the rebuild that would heal it.
  The recount runs after the scan, so it catches an addition only while nothing
  cancels the shortfall — which is why the fold keeps its own already-folded
  guard — and it cannot catch a deletion from the scanned part at all.
- Completion and the stale-tile sweep are separate steps: a failing sweep must
  not demote a build that already wrote `completed`.
- A build that could not read every file still completes, and records the loss
  on the row — withholding the sweep does not preserve the missing geometry,
  because a merge replaces any tile a readable activity also touched.
- Tiles are stored unclipped; a region is applied when they are served. Only
  the all-activities/all-time heatmap can be tile-backed.
- The public token route refuses any share the pyramid cannot answer, through
  the same `buildHeatmapTileSource` that decides whether a heatmap advertises
  tiles — a share scoped to one sport or one year would otherwise be served the
  actor's whole history, which region clipping cannot catch. The owner route
  names no variant and needs no such gate.
- On the public token route the region comes from the **shared row**, never from
  the caller, and the resolver **fails closed**: a non-empty region that yields
  no bounds is refused, because no bounds means no clipping. It runs before the
  conditional-request check. Out-of-region tiles are answered before any read.
- **All four PUBLIC surfaces** — the share page, the embed page, the embed image
  and the embed tiles route — refuse through the one
  `resolveSharedHeatmapRegionBounds`, because for such a row the untiled
  geometry was built unclipped too. The OWNER tile route is not one of them: it
  clips to the region its own authenticated caller sent.
- Anything that PRODUCES a rectangle gates on `isSerializableRect`, the same rule
  `serializeRegions` applies. A box thinner than the 0.01° step is well formed
  and has no canonical key of its own; saved, it takes the WORLD's key.
- Both tile routes share one query parser, and read the share row without its
  geometry.
- The public route strips the privacy flag and keeps the geometry
  (`flattenTilePrivacyForPublic`, beside the untiled doctrine), and re-encodes
  every byte it returns rather than forwarding a stored payload.
- Only a `completed` pyramid serves tiles, only at its own `version`, and the
  response's keys are the ones the request named. A well-formed `v` busts caches
  and never filters tiles; a malformed one is a 400 on both routes.
- The static share image is a pyramid reader like the tile routes: it gates on
  `buildHeatmapTileSource` before reading, takes the heatmap row rather than a
  bare actor id, clips each tile to the shared row's region, and places geometry
  with the row's own `z`/`x`/`y`. Its rung comes from the image's own size along
  the axis the renderer fits by.
- A static renderer takes the tiles first and the stored blob second. Apple
  refuses past `MAX_SNAPSHOT_OVERLAYS`; Mapbox truncates at its URL budget and
  then frames on what survived, so the tiled candidate passes
  `requireAllOverlays`. Removing that fallback, or nulling `segments` on pyramid
  rows, costs Apple/Mapbox instances their basemap — reject it unless the raster
  path has been made to stand alone.
- See AGENTS.md → Fitness Route Heatmap Pyramid.

## Commits & versioning

- Every commit subject starts with a conventional prefix (`fix:`, `feat:`,
  `chore:`, `refactor:`, `test:`, `docs:`, `none:`, `minor:`, `major:`).
- `version` in `package.json` is never edited by hand — CI bumps it from prefixes.
- For a `minor`/`major` bump the **PR title** carries the prefix (PRs squash-merge,
  so the title is the commit subject). `.github/`-only changes are no-bump unless
  explicitly `minor:`/`major:`.
- Pre-commit gate is green in order: `yarn run prettier --write .`, `yarn lint`,
  `yarn typecheck`, `yarn build`, `yarn test`.
