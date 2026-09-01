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

## Actor usernames

- A local username is the last path segment of the actor's ActivityPub id
  (`getLocalActorId` → `https://<domain>/users/<username>`, and every local
  status id is `${actorId}/statuses/${n}`), so casing is an identity question,
  not a cosmetic one. Every local mint lowercases through `normalizeUsername`
  (`lib/utils/normalizeUsername.ts`) and every lookup folds through
  `findActorRowByUsername` (`lib/database/sql/utils/usernameMatch.ts`).
- Normalization is layered like email's: `localUsernameSchema`,
  `registerAccount`, **and** `createAccount`/`createActorForAccount`. The last is
  the one that matters — it is where the column and the id are
  derived from one variable and so cannot drift. It is NOT the only place a local
  actor row is written — `getFederationSigningActor` inserts its own — and the
  schema's fold is a SECOND spelling of the rule (Zod's `.trim().toLowerCase()`,
  not a `normalizeUsername` call), pinned against it by `localUsername.test.ts`.
- The fold in `localUsernameSchema` runs **before** the reserved-name refine and
  before `.max()`. `isFederationSigningActorUsername` is a case-sensitive
  `startsWith('__instance__')`, so folding afterwards let `__INSTANCE__` mint a
  confusable neighbour of the instance actor; and a fold can change a string's
  length. Sitting before `.max()` is defensive ONLY, not load-bearing: the one
  lengthening mapping is `İ` → `i` + U+0307, and U+0307 is outside
  `LOCAL_USERNAME_PATTERN`, so the regex refuses any input whose fold changes
  length wherever `.max()` sits (verified: both `İ` and a 50-char name plus `İ`
  fail the pattern raw and folded). `AGENTS.md` and the code comment say the
  same; do not "reconcile" them back to the load-bearing claim, which round 1 of
  #1592 removed as false and which survived here only because that round fixed
  two of the three copies.
- The lookup is **exact-match first, then folded — never a lone
  `lower(username) = ?`.** Two reasons, both load-bearing: SQL `lower()` and JS
  `toLowerCase()` fold different alphabets (SQLite's builtin is ASCII-only, so a
  fold-only query stops finding a stored `Фёдор`), and local actors minted before
  normalization keep their casing — they are deliberately not migrated, since
  their ids are already federated — so an instance can hold both `Alice` and
  `alice` and `/@Alice` must not resolve to `alice`. The folded arm orders by
  `createdAt`, `id` so an unmatched casing resolves to whoever claimed the name
  first rather than to whatever the index yields.
- `isUsernameExists` folds too — that is what refuses a new `alice` beside an
  existing `Alice`. The DB unique index stays case-sensitive on purpose: a
  functional UNIQUE index would refuse to build on an instance that already holds
  a colliding pair. Note the TOCTOU rule above still holds and is not weakened by
  this, because every new local actor is lowercase, so a race is a
  lowercase-vs-lowercase collision the existing unique index still catches.
- **MySQL is skipped in both halves** — the migration creates no index and the
  folded arm never runs. Its default collations already fold (so does its unique
  index, so a colliding pair cannot exist there), the DDL is not portable to it
  or to MariaDB, and running the folded query anyway would scan `actors` on every 404. A `_bin`/`_cs` collation gives that backend case-sensitive usernames,
  which is the behaviour it had before, not a new regression.
- `OnlyLocalUserGuard` resolves by username, never by rebuilding the actor id
  from the path segment. It fronts the whole ActivityPub surface, and a rebuilt
  id matches exactly one spelling — which is how `/api/users/alice` came to 404
  while every human-facing surface folded. Matching `domain` against
  `headerHost` preserves the host binding.
- `domain` matching inside the lookup stays exact — but NOT because callers
  normalize it. `app/api/v1/accounts/lookup/route.ts` has its own
  locally-shadowed `parseAccountHandle` that does not lowercase domain, and
  `resolveStatusFromPath.ts` splits the segment inline with none; WebFinger
  carries its own domain fallback precisely because that is not a guarantee.
  Note `getExactAccountIds` in `lib/database/sql/search/` DOES fold domain, so
  search and lookup disagree on `alice@Example.COM` — pre-existing.
- The folded arm folds CASE only. It uses a bare `toLowerCase()`, never
  `normalizeUsername`, which also trims: a trimmed input compared against an
  untrimmed column is asymmetric and can only ADD matches, which is how
  `/users/%20alice%20` served a whole actor surface. Shared-cache keys are not
  the reason — case folding creates URL variants regardless.
- `OnlyLocalUserGuard` 404s a segment folding to a username this instance could
  MINT a signer on (`isFederationSigningActorIdUsername`,
  `/^__instance__([1-9]\d*)?$/`) unless the actor IS the genuine signing actor —
  without that, a legacy `__INSTANCE__` account answered at
  `getFederationSigningActorId(domain)`. **Do not widen it to the
  `isFederationSigningActorUsername` prefix the mint refine uses**, which
  de-federates a legacy `__instance__archive` or `__instance__0` account; and do
  not narrow the loose form onto the precise one, because
  `getExistingHeadlessActor` adopts any headless `__instance__%` Service row as
  the signer and validates it loosely.
- Remote usernames are stored verbatim — a remote server mints its own ids.
  WebFinger answers with the **stored** casing, so an echoed `subject` is the
  canonical handle.

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
- The viewer's own follow row is read with `getViewerFollow`
  (`lib/services/getViewerFollow.ts`) on **read** paths — it is
  `cache()`d, so a profile render resolves it once instead of once per call site
  — and with `database.getAcceptedOrRequestedFollow` everywhere else. Its
  arguments are positional because `cache` keys on argument identity; an options
  object memoizes nothing. Never route a **mutating** route's own pre-mutation
  read through it: follow, unfollow, block and follow-request
  authorize/reject read the row, change it, then report the result, so a value
  cached from before their write would describe the state they replaced.
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

## Unconfirmed accounts & app tokens

- A check for "has this account confirmed its e-mail" reads `verificationCode`
  AND `emailVerified`, never `verifiedAt`. The second column is what
  grandfathers the accounts `20260320072514_better_auth_columns` wrongly marked
  verified — better-auth's `requireEmailVerification` has been letting them sign
  in ever since, so honouring it here grants nothing new and locks nobody out.
  A repair keyed on when a migration ran is NOT a substitute: two attempts at
  that bound shipped wrong in opposite directions. `accounts.verifiedAt` originally carried `DEFAULT CURRENT_TIMESTAMP`
  (`20230824181927_add_accounts_verification`, dropped in `drop_accounts_verifiedat_default`), so a pending registration previously got a
  timestamp anyway and a `verifiedAt` test is a **no-op that reads as a working
  gate**. The column carried that default since 2023-08-24; every check
  written against it since has been inert, `canCreateSessionForAccount`'s
  included.
  `createAccount` writes an explicit `verifiedAt: null` now, but rows written
  before that still carry the default. The same trap bit
  `20260320072514_better_auth_columns`, whose `whereNotNull('verifiedAt')`
  backfill consequently set `emailVerified = true` on every account of that
  era, pending ones included — which is why `20260828140000_clear_stale_verification_codes`
  exists and why `serializeAdminAccounts`' `confirmed` field had to stop reading
  `verifiedAt` too.
- Every MANDATORY authenticated surface refuses an unconfirmed account with 403
  (`isActorConfirmationPending` in `lib/services/guards/OAuthGuard.ts`,
  `lib/services/guards/AuthenticatedGuard.ts`, and
  `lib/services/guards/AdminApiGuard.ts`), matching Mastodon's
  `require_user!`. `OptionalOAuthGuard` deliberately does NOT — it
  DOWNGRADES such a token to the anonymous path
  (`unconfirmedAccount: 'anonymous'`). Refusing made presenting a
  valid token FAIL a public read that succeeds with no Authorization header at
  all; accepting the actor would let an unverified account read DMs addressed
  to it and drive outbound federation via `resolve=true`, which Mastodon does
  not permit either — its search controller applies `require_user!`, so
  `authorize_if_got_token!` is only a partial model here. Suspension is
  different and stays global in both codebases. The reason it matters:
  `POST /api/v1/accounts` returns a real user access token at registration and
  `POST /api/v1/apps` is unauthenticated, so a token that works before
  confirmation lets an anonymous party script usable accounts.
- `unconfirmedAccount: 'allow'` (supported in `OAuthGuard` and
  `AuthenticatedGuard` options) has exactly one active route consumer,
  `POST /api/v1/emails/confirmations` — the endpoint that resends the
  confirmation e-mail, which Mastodon exempts too. A second consumer needs the
  same argument. It relaxes confirmation only: `isActorModerationBlocked` still
  runs in both guards, so a suspended actor or disabled account is refused there
  as well.
  `OptionalOAuthGuard`'s `unconfirmedAccount: 'anonymous'` downgrade is a
  different disposition and does not count against this.
- `allowModerationBlocked` (supported in `AuthenticatedGuard` options) is
  reserved for restrictive revocation endpoints (`accounts/sessions`,
  `accounts/sessions/[token]`, `accounts/connected-apps/[clientId]`) so an owner
  can terminate attacker sessions and revoke connected apps during suspected
  account compromise even while suspended/disabled. It relaxes
  `isActorModerationBlocked` only; CSRF same-origin proof and
  `isActorConfirmationPending` remain enforced.
- Account-level actor management (`actors/switch`, `actors/cancel-deletion`)
  authenticates the account directly via session and same-origin CSRF proof,
  checking account ownership of the target actor rather than gating on the
  session's active actor.
- Do not "unify" this with better-auth's `emailAndPassword.requireEmailVerification`,
  which covers credential sign-in only — but DO read the same column it reads.
  `emailVerified` is on the domain `Account` precisely so the two gates agree;
  removing it re-locks out the backfilled cohort. That gate is why the cookie
  path was never open **for an account registered after 2026-03-20** — older
  ones were marked `emailVerified` by that migration's backfill and have been
  signing in ever since, which is the cohort
  `20260828140000_clear_stale_verification_codes` exists for. Do not repeat the
  unqualified form of this claim.
- A handler that needs to know whether a bearer token is an **app**
  (`client_credentials`) token reads `userId`, never `currentActor`.
  `OAuthAppGuard` also leaves `currentActor` null when it merely fails to resolve
  an actor for a user-delegated token (no grant `referenceId`, and every actor on
  the account pending deletion), which is how a user was accepted as an app and
  could mint accounts.
- `Account.verifiedAt` stays `.nullish()` and `SQLAccount.verifiedAt` nullable:
  both row-to-domain mappers pass a literal `null` through, so `.optional()`
  makes `Actor.parse` throw and the first request by an unconfirmed actor 500s.

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
  state passes whether or not the code under test is correct. `PostBox
attachment ref guard` is exactly that: it passed with the bug present until
  the two picker batches were sequenced.
- A test for a React `cache()`d helper stands a request scope up with
  `runInReactCacheScope` from `@/lib/testing/reactCacheScope` and swaps that
  module's `serverCache` in via `vi.mock('react', …)`. Vitest resolves React's
  client build, whose `cache` is a hard passthrough — only the `react-server`
  build memoizes, and only inside a scope — so a test that calls the helper
  twice and expects one query reads two and proves nothing either way. Scopes are
  sequential: React's dispatcher is a single mutable global, so a nested or
  concurrent scope throws instead of pretending to isolate.
- **`vi.restoreAllMocks()` does not reset a `vi.fn()` a `vi.mock` factory
  created** — it only iterates the spies `vi.spyOn` registered. A module mocked
  as `vi.mock('@/path', () => ({ fn: vi.fn() }))` keeps its implementation and
  its call history across the whole file, so reset each export explicitly in
  `beforeEach`. A lone `vi.mocked(fn).mockReset()` at the top of one test is the
  tell: that test noticed the leak and worked around it instead of fixing the
  hook.
- **`toHaveBeenCalledWith` is "was ever called", not "was the only call".** A
  once-per-run summary asserted that way passes when it is logged once per row,
  because the last row's cumulative totals are correct. Pin the count by
  filtering `mock.calls` and asserting the list with `toEqual`, over a fixture
  where the wrong placement logs twice. Same blind spot for a hardcoded page
  size: at fixture scale one big batch and several small ones are
  indistinguishable by result, so paging needs the SELECTs counted off knex's
  `query` event.
- Tests run on **Vitest** (`vi.*`, not `jest.*`). To read a mocked module and
  configure it, prefer **`vi.importMock<T>('@/path')`** over
  `(await import('@/path')) as unknown as T`. `vi.importMock` is purpose-built,
  returns a typed `MaybeMockedDeep<T>` (no `as unknown as` cast needed), and
  always yields the mock; bare `await import()` returns the real module unless it
  is separately `vi.mock`'d. (Some review bots wrongly flag `vi.importMock` as
  non-existent — it is a valid, documented Vitest API.)
- **But "always yields the mock" stops holding once a factory AWAITS
  `importOriginal()`** — the shape a partial mock takes whenever one export has
  to stay real. Then `vi.importMock` measurably returns the **original**
  module: the export is real, callable, and a different object from the mock
  the module under test received, so `vi.mocked()` on it configures and asserts
  nothing while calling it runs the real implementation. Flag a `vi.importMock`
  whose factory awaits `importOriginal()`; the static import is the mock there.
  Do not flag it merely for being `async` — a factory that never calls
  `importOriginal` returns the mock like any sync one, so that heuristic
  over-reports.

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
  `meta.small`/`preview_url` per backend. That divergence now reaches every
  client reading the status, not just the upload response: an attachment row
  snapshots `thumbnailUrl` (resolved off `meta.small`) and
  `getMastodonAttachment` serves it as `preview_url`. Only federation is still
  blind to it — the AP `Document` has no thumbnail field. Shared policy belongs in a
  module both import
  (`medias/thumbnailInput` validates a supplied thumbnail; `medias/fileName`
  handles supplied names), and a change to one driver's `saveFile` needs the
  matching test in **both** `localFile.test.ts` and `S3StorageFile.test.ts`.
- **A `/api/v1/files/` URL is only ours if its HOST says so — parse it with
  `getMediaPathFromFileUrl` (`lib/services/medias/mediaFileUrl`), never a bare
  path prefix check.** That route is this project's own, so every other
  activities.next instance serves its attachment URLs under exactly the same
  path. Matching on the path alone reads a remote instance's URL as a local
  storage path, which then misses in storage and — where the caller treats
  "not local" as "fetch it over HTTP instead" — skips the branch that would
  have retrieved the file correctly. The host question itself is
  `isOwnInstanceHost` (`lib/utils/host`), which covers `ACTIVITIES_TRUSTED_HOSTS`
  (a multi-domain instance mints media URLs on the OWNING actor's domain) and
  loopback development hosts, which `isHostTrustedByRules` alone rejects.
  `getAttachmentMediaPath` is not this check: it never returns null and is for
  URLs this instance just produced.
- **The path it recovers must also be refused when it walks upwards, is
  absolute, or carries a NUL byte — and that check runs AFTER decoding**
  (`isTraversingStoragePath`, shared with the blurhash backfill; do not fork
  it). `new URL()` resolves dot segments only where the separators are literal
  slashes, so `https://<our-host>/api/v1/files/..%2f..%2fsecrets/env` reaches
  the decoder still spelled `..%2f` and comes back as `../../secrets/env`; the
  host-relative branch parses no URL at all, so a plain
  `/api/v1/files/../../secrets/env` is never normalised either.
  `copyProfileImage` joined that onto the staging directory and copied whatever
  it found into the archive as `avatar.<ext>`, and `iconUrl` is a bare
  `z.string()` any signed-in user can set — so this was a live arbitrary-file
  read, not a hardening exercise. Refuse only a segment that RESOLVES to `..`:
  `ab/..cd.webp` is an ordinary stored file name. Cover Windows too — `\` is a
  separator, `C:` is absolute, and Win32 strips a component's trailing dots and
  spaces carrying two or more dots, since Windows normalises trailing dots away
  and Node's own `path.win32` does not model that. Refusing the whole shape is
  deliberately wider than what Win32 actually collapses — no stored path is
  named out of dots, so over-refusing costs nothing and does not depend on
  getting the platform's rules exactly right.
- **Do not answer "the storage driver will reject it".** `LocalFileStorage.getFile`
  does make a containment check; `S3FileStorage.getFile` makes none — a
  traversing key is merely inert there, and with a CDN `hostname` configured it
  is string-concatenated into a redirect URL. Any new step that turns a stored
  path into a filesystem read should still resolve and confirm containment for
  itself, the way `copyProfileImage` and `createMediaTempFilePath` do — a
  signature taking a bare path says nothing about where the path came from.
- **A wildcard trusted-host entry is not a literal authority, and the check
  belongs AFTER parsing.** `new URL()` accepts `*` in a host, so an
  exact-authority comparison against the rule's own spelling let
  `https://*.cdn.example/api/v1/files/<path>` pass as ours. Both of
  `isOwnInstanceHost`'s passes need a guard: the exact pass reads RAW rules so
  it skips any rule containing `*`, and `normalizeHost` — which recognised the
  documented `*.example.com` form only on the raw value, leaving `*example.com`,
  `cdn.*` and `foo.*.example.com` as literal hostnames a `%2a`-spelled
  authority matched exactly — now refuses any parsed hostname still containing
  one, reading the `*.` marker off the AUTHORITY so a scheme-prefixed rule
  still expands.
- **Three consumers of `ACTIVITIES_TRUSTED_HOSTS` apply that refusal, each on
  the PARSED hostname** — `normalizeHost`, `buildTrustedOrigins` and
  `toHostname` — because each reads a misplaced wildcard differently. A fourth,
  `isOwnAuthority` in the blurhash backfill, was deleted by #1570: that sweep
  asks `isOwnInstanceHost` now and inherits its guards. `buildTrustedOrigins` hands it to
  better-auth, which globs any pattern containing `*`, so `*example.com`
  trusted `evilexample.com` for the auth Origin check and for
  `callbackURL`/`redirectTo` — an open redirect carrying auth callbacks.
  **Check after parsing, never before: the parser is what MAKES the `*`.** It
  percent-decodes the authority, applies IDNA mapping and strips tab/CR/LF, so
  `%2aexample.com` and a fullwidth `＊example.com` sail past a raw check — which
  buys nothing anyway, since a literal `*example.com` parses to a hostname
  carrying the same `*`. Where a guard reads `hostname` but emits `origin`, it
  must also require a web scheme: `blob:` derives its origin from the inner URL
  in its PATH and reports an empty host, the one scheme where the two disagree.
  `getAllowedOrigins` in the Apple Maps token route is a fifth consumer that
  deliberately does not filter — whether MapKit globs `*` is unverified, so
  establish that before sweeping it.
- **A stored path is confined to the storage root by
  `resolveStorageFilePath` / `assertStorageFilePath`
  (`lib/services/medias/storagePath`), on every filesystem path a local driver
  builds — read, delete and write alike.** A bare `path.resolve(root, filePath)`
  walks out of the root given `../` or an absolute path, and the escape is
  silent: the read or the unlink lands somewhere else on disk. Watch for the
  read-only variant of this — `LocalFileStorage.getFile` carried the check while
  `deleteFile` beside it had none, which made containment an invariant of the
  callers rather than of the driver. `resolveStorageFilePath` returns null (and
  logs the refusal); `assertStorageFilePath` throws, for a write with nothing
  sensible to return. Object storage is a different question: an S3 key has no
  filesystem root to escape.
- **Reject a hand-rolled containment check, and reject `startsWith` against a
  bare resolved root.** `fullPath.startsWith(path.resolve(base))` has no
  separator boundary, so a sibling directory whose name the root prefixes passes
  it — root `/srv/uploads` accepts `/srv/uploads-backup/x`. That form guarded an
  `fs.unlink` in `scripts/maintenance/cleanupMediaStorage.ts`, and it reads as
  correct at a glance. Two Oxlint rules in `lint/agentsRules.mjs` now decide
  this on the AST: `agents/no-storage-path-builder` in the two local drivers and
  `agents/no-resolved-path-prefix-check` everywhere, `scripts/**` included via
  the second `yarn lint` pass. Because they resolve names through scope, a
  renamed import, a destructured `resolve`, `path['resolve']`, `path?.resolve`
  and a root pulled into a variable first are all caught — so what is left for a
  reviewer is narrower and worth knowing: a helper that resolves on a driver's
  behalf, a path built by string concatenation, and a binding imported from
  another module. Do not answer any of those with a raw-text Vitest scan; that
  is what these rules replaced, and it was wrong in both directions. **Treat an
  `oxlint-disable` comment naming either rule as a finding in itself** — a lint
  rule can be silenced with a comment where the text scan could not be, and
  nothing reports that the suppression was used. Note the
  check is lexical either way: a symlink planted under a storage root defeats
  it, which is a documented residual, not something to paper over at the call
  site.
- **A stored file with no `medias` row is unreachable**, so whatever fails
  after a write must reclaim it — only `scripts/maintenance/cleanupMediaStorage.ts`
  can find it otherwise. Equally, do not report a storage failure as a
  `MediaValidationError`: that is a 422 the client will not retry, and
  `handleSyncMediaUpload` deliberately logs nothing for it. Validate input
  first, then let a genuine fault stay a logged 500.
- **A blurhash is the one media field a remote actor supplies directly, and
  `normalizeBlurhash` (`lib/services/medias/imageAnalysis.ts`) decides its
  stored form.** It returns the string to persist or null, never a boolean,
  because it trims before deciding: the predicate it replaced validated
  `hash.trim()` while `createNoteJob` stored the untrimmed original, so a padded
  hash from a federated note was persisted in a form `decode` throws on and
  re-served to clients verbatim. Reject any new caller that tests the value and
  then stores its own argument. Both halves of the check are load-bearing —
  `BLURHASH_REGEX` covers the base83 alphabet `isBlurhashValid` ignores, and
  `isBlurhashValid` covers the structure the regex cannot see, that the length
  must be `4 + 2 * componentX * componentY` for the size flag in the value's own
  first character, which is why `'aaaaaa'` is legal base83 of a legal length and
  still throws.
- **Fixing a write path does not repair the rows it already wrote.** Ask, for
  any validation added to an inbound field, what happens to the values already
  stored — here nothing re-validates on read and
  `lib/types/domain/attachment.ts` re-serves the stored string verbatim, so a
  bad value keeps leaving the instance. The repair is
  `scripts/maintenance/backfillMediaBlurhash.ts --revalidate`, a MODE rather
  than a widening of the default selection: a bad federated hash matches neither
  branch of that sweep's `blurhash IS NULL OR thumbnailUrl LIKE …` predicate,
  and `--force` reaches it only by re-downloading every attachment in the
  instance. It reads no image bytes, refuses to run beside `--force`, and
  reports repaired/cleared/untouched separately — those three DO partition its
  scan, unlike `backfillAttachments`' two counts. Clearing an undecodable hash
  is deliberate: `lib/components/posts/media.tsx` gates the `<img>` behind the
  blurhash canvas only when `blurhash` is truthy, so a NULL falls through to a
  bare `<img>` while an undecodable value paints an empty box. It does not
  weaken the deleted-media placeholder promise, which rests on a hash a client
  can actually paint.

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
- **FEP-044f Quote Terms Need Their Context:** a document emitting the quote aliases (`quote`/`quoteUrl`/`quoteUri`/`_misskey_quote`/`quoteAuthorization`) or `interactionPolicy` must declare `QUOTE_ACTIVITY_CONTEXT`, never the bare `ACTIVITY_STREAM_URL`. Both emitters (`getNoteFromStatus` for delivery, `toActivityPubObject` for fetch) build these fields via `lib/activities/quoteNoteFields.ts` and emit `interactionPolicy` unconditionally, so this binds every note-carrying surface — quote post or not. A receiver that compacts drops any term the document's own context never defined, so the note keeps its content and silently loses its quote: no error, no failing test, because nothing reads `interactionPolicy` inbound. Flag any new AP surface returning a note that does not carry a `@context` assertion pinning it. The legacy content fallback rides with the fields: both emitters prepend `<p class="quote-inline">RE: <a …></a></p>` via `addQuoteFallbackToContent` (same module, same live-edge gate) — flag a new note-emitting surface that builds `content` without it, and flag any change that adds the fallback on a rejected/revoked/deleted edge or stores it into `status.text`. See **ActivityPub & JSON-LD** in `AGENTS.md`.
- **Internal API CORS:** Next.js API routes exclusively consumed by the internal web client (e.g., via `lib/client.ts`) do not require `OPTIONS` handlers or CORS preflight configurations, even if they use `apiResponse` with `allowedMethods`.
- **Conditional Object Spreading:** Spreading `null` in object literals (e.g., `...(cond ? { ... } : null)`) is a deliberate, consistent no-op pattern used to cleanly omit keys and should not be flagged as confusing or replaced with `{}`.

## Post media layout

- A status's media is **one attachment at its own size, or a horizontally
  scrollable strip — never a grid.** `lib/components/posts/attachments.tsx` owns
  this for every surface that renders a post. A lone picture keeps its own
  aspect ratio and hugs the post's left edge, scaled by WIDTH; the branch this
  replaced cropped every portrait photo to a full-width 16:9.
- Four details of the strip are load-bearing and a "cleanup" that drops any of
  them is a regression: `flex-none` on each item, without which they shrink to
  fit and nothing ever overflows (the whole feature turns off silently);
  `STRIP_ITEM_MAX_WIDTH` (78%) so the next item always
  peeks — that peek is what says "this scrolls" on a touch screen, where the
  back chevron never appears at all; `scroll-snap-type: x proximity`, never `mandatory`, which pulls the
  peek flush the moment the scroll settles; and the forward chevron staying
  visible while the back one appears on hover only.
- **There is no item cap and no `+N` overlay** — scrolling reaches everything —
  so anything the strip renders unboundedly needs a deferral: images pass
  `loading="lazy"`, videos `preload="none"` (`loading` is image-only) — but only
  a video carrying a `poster`. A posterless one shows nothing at all when
  deferred, since its only pre-playback frame comes from the `#t=0.01` fragment,
  and federated video never has a poster. A lone picture or video is
  deliberately eager, being the post's largest element. Re-adding a cap hides
  media the post actually carries.
- The edge fade is a **`mask-image`**, not a background gradient: posts render
  on four surfaces (`bg-card`, `bg-background`, `bg-muted/30`, unframed) and a
  fade painted in one token is wrong on the other three and in dark mode
  everywhere.
- **Filtering is layout-only.** `isVisualAttachment` picks what gets a picture
  box and `isAudibleAttachment` what becomes an inline player; a `.fit` file or
  PDF is skipped rather than rendering an empty box. But the lightbox is handed
  exactly the pictures on screen, indexed into THAT list — passing the raw
  array gives `MediasModal` a blank slide and a wrong "n of m". Anything asking
  "do I have media to show" asks `isRenderableAttachment`, never
  `attachments.length` (`post.tsx`'s link-preview suppression does).
- **A stored dimension of `0` means "unknown", not "zero pixels"** — several
  media-storage paths persist `metaData.width ?? 0` — so every read goes through
  `getMediaGeometry`, which also clamps pathological shapes and falls back to a
  4:3 box so blurhash has something to reserve.
- **A strip item's focus indicator is an `outline` with a NEGATIVE offset.** An
  outset ring is clipped by the strip's own `overflow-x-auto`, and an inset ring
  is invisible — an inset `box-shadow` paints beneath content and the button's
  only child is an opaque image. This has been got wrong twice; the class string
  is pinned by a test.
- `useMediaStripScroll` measures the strip's own container, never a viewport
  breakpoint, through a **callback** ref because the strip is conditional. Its
  `contentKey` must describe item WIDTHS, not their count: the observer watches
  the container, which does not resize when an edit swaps a panorama for a
  portrait.
- `no-scrollbar` belongs only on a row that carries its own overflow affordance.
  It was applied in the emoji and reaction pickers while defined nowhere, so
  defining it would have removed their only cue.

## Fetched ActivityPub document ids

- A document's own `id` is a claim by whoever answered the fetch — `getNote` and
  `getActorPerson` validate nothing. Flag any new code that resolves a database
  row from a fetched `id`: `updatePoll` and `createAnnounce` both key on a bare
  `where('id', ?)` with no ownership, locality or type filter, so the remote
  server is choosing which of our rows the write lands on.
- The check is the fetched id against the id that was **requested**, normalized
  on both sides with `normalizeActivityPubUri` — `syncRemotePoll` against
  `status.id`, `createAnnounceJob` against the Announce's own `object`. A raw
  `!==` is over-strict (it refuses a benign default port or percent-encoding and
  breaks the `#1694` fallback lookup); dropping normalization to a substring or
  host comparison is under-strict. Every guard here is bracketed by a test on
  each side — one that fails when it is loosened, one when it is tightened. A PR
  that adds only the first has not pinned it.
- In `createAnnounceJob` the guard must precede the `createNoteJob`/
  `createPollJob` dispatch, not just the fallback `getStatus`. Below the
  dispatch it still lets a lying document be persisted at an id we were never
  pointed at. Relocating it fails exactly one test; if a reviewer sees the guard
  move and the suite stay green, the pinning test was deleted.
- `syncRemotePoll` writes with `statusId: status.id`, never `question.id`. That
  is deliberate belt-and-braces on top of the guard, not redundancy to tidy
  away — it is what keeps the write target correct if the guard is ever
  weakened.
- An id match is not an ownership check. Where the resolved row belongs to
  someone else, compare `normalizeActorId(attributedTo)` against the stored
  status's `actorId`, as `updateNoteJob` and `updatePollJob` both now do. The
  inbox's `createObjectActorMismatch` only binds the payload to the _signer_,
  which an attacker satisfies by attributing the Update to themselves.
- Known-open and deliberately so: `createAnnounceJob` does not bind the fetched
  note's `attributedTo` (and `actorMatchesVerifiedSender` fails open on a direct
  call, which carries no `verifiedSenderActorId`); `recordActorIfNeeded` takes a
  row's `id` from the request and its `domain` from the fetched `person.id`
  unchecked. Do not treat these as covered by the guards above — they are a
  different class (forged attribution) awaiting their own decision.

## Status delete & unboost federation

- The local delete commits **first**; `SendDeleteNoteJob` federates the
  `Delete`/`Tombstone` afterwards. Flag any change that reintroduces inline
  fan-out ahead of `database.deleteStatus`: that made the response wait on every
  remote inbox, and put inbox resolution ahead of the delete, so an error while
  collecting them abandoned the delete entirely. (A failing remote server was
  never the trigger — both the sender and `getActorPerson` swallow and return.)
- Neither job may load the status it federates: `database.deleteStatus` is a
  cascading hard delete, so the data travels in the payload — `to`/`cc` for the
  `Delete`, plus `originalStatusId`/`createdAt` for the `Undo`, all captured
  pre-delete. `getFederatedStatusDeliveryInboxes` takes `Pick<Status, 'to' | 'cc'>`
  and the `undoAnnounce` sender takes a matching narrowed `announce`. A
  "consistency" refactor onto `loadStatusAndActor` silently stops federation —
  that is precisely how `sendUndoAnnounceJob` shipped broken.
- Dedup ids keep their `#delete` / `#undo` suffix; the bare status id collides
  with `SendNoteJob`/`SendUpdateNoteJob`/`SendAnnounceJob` in the queue's global
  dedup window.
- `sendUndoAnnounceJob` and `sendAnnounceJob` must resolve inboxes the same way
  (`getFollowersInbox` + `filterFederatedUrls`), or an unboost reaches a
  different audience than the boost did.
- The activities `deleteStatus` sender never rejects (`postActivityToInbox`
  swallows and returns `undefined`), so a per-inbox isolation test must mock the
  sender, not the socket, or it asserts nothing.

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
- **That short hidden-class list (`hidden`, `invisible`, `quote-inline`) is
  only sufficient because `sanitizeText` allowlists the `class` attribute**
  (`ALLOWED_CONTENT_CLASSES`, applied to `a` and `span`; `p` keeps `class`
  filtered to `quote-inline` alone, for Mastodon's quote fallback). The class reaches the real DOM — `cleanClassName`
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
