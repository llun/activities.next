# Mastodon API Compatibility

Activity.next implements a large subset of the [Mastodon client API](https://docs.joinmastodon.org/api/)
so that standard Mastodon apps (Phanpy, Ivory, Ice Cubes, Elk, and others) can
sign in and operate against an Activity.next instance. Most endpoints behave
exactly as documented upstream.

This page is the durable reference for the places where Activity.next
**intentionally diverges** from Mastodon, the endpoints it **does not plan** to
implement, and the **extensions** it adds on top of the Mastodon surface. It is
not an exhaustive endpoint list — see the [Feature Roadmap](./features.md) for
the feature-level status.

> Keeping this page current is part of the definition of done: any change that
> closes, adds, or re-scopes one of the items below updates this page in the
> same pull request.

## Intentional divergences

These behaviors differ from stock Mastodon on purpose. Each is a deliberate
product or security decision, not a gap to be closed.

### Ids & pagination

- **Status and account ids are UUIDv7 strings, not numeric snowflakes.**
  Mastodon serializes `Status.id` and `Account.id` as decimal snowflake strings
  that happen to sort chronologically when parsed as numbers. Activity.next
  emits a UUIDv7 `publicId` — still time-ordered, but a UUID — on the `Status`
  and `Account` entities and on every field that references one:
  `in_reply_to_id`, `in_reply_to_account_id`, `mentions[].id`, the embedded
  `reblog` / `quote` statuses, `Relationship.id`, `Report.status_ids`,
  the admin entities, and the `max_id` / `min_id` /
  `since_id` pagination cursors in both the query parameters and the `Link`
  header (a cursor is just the id of an entity on the page). Treat them as
  opaque strings: do not parse, sort, or compare them numerically, and use the
  server's cursors for ordering. `uri` and `url` are unchanged and still carry
  ActivityPub URIs — an id is not a URL, and neither can be derived from the
  other.

  Every id form the instance has ever handed out stays accepted on **input**,
  indefinitely: a UUIDv7 `publicId`, the colon-encoded form
  (`domain:users:username`), the `apurl_` opaque form, and a raw ActivityPub
  URI all resolve to the same entity, so ids a client cached earlier keep
  working. In the other direction, a row that has no `publicId` — one
  written before the [Public ID Backfill](./maintenance.md#public-id-backfill),
  or a remote actor this instance does not store, such as a mention of an
  unknown account — keeps emitting the legacy colon form, so a client can still
  encounter both shapes. Notification, report, and filter ids are their
  own row ids and are unaffected (notification ids are time-ordered UUIDv7s
  of their own, see the next item) — but a status or account these entities
  _reference_ is still a status or account id, and carries the `publicId` like
  any other: a filter's `status_id`, a `FilterResult`'s `status_matches`, a
  report's `status_ids`, a notification group's `status_id`. Nothing about
  federation changed: what is sent to and received from remote servers is still
  the ActivityPub URI.

- **Notification ids are time-ordered UUIDv7s, minted from the notification's
  `createdAt`.** Mastodon's notification ids are snowflakes that grow with time,
  and clients rely on it: Ivory sorts the notification list, and compares the
  `notifications` read marker, by id. `createNotification` therefore mints the
  id with `generatePublicId(createdAt)` — the same scheme as a status or
  account `publicId` — so v7 ids compare chronologically as plain strings, and
  for v7 ids the id order matches the server's `(createdAt, id)` page order.
  Do not go back to `crypto.randomUUID()`: a random v4 id put Ivory's
  notification list in a random order.

  Ids minted before the rewrite were rewritten by the
  `20261009163215_time_ordered_notification_ids` migration, which also
  repointed the stored `notifications` marker. A `notifications` marker left on
  a v4 id that names no notification at all (it was dismissed or cleared
  first) is reset to the highest UUIDv7 for the millisecond the marker was last
  written (`xxxxxxxx-xxxx-7fff-bfff-ffffffffffff`, the timestamp then every
  other bit set), so it still reads as "read up to then" instead of sorting
  above every new notification. A v4 id minted before the rewrite does
  **not** age out: a v4 id almost always sorts above every v7 id, so an
  id-ordering client pins it to the top of the list for good and may set its
  read marker to it, making every newer notification look read. The
  [Notification ID Rewrite](./maintenance.md#notification-id-rewrite)
  rewrites them (it repairs orphan markers the same way).

  As a backstop, `POST /api/v1/markers` only moves the `notifications` marker
  to:
  - a UUIDv7, stored lowercased;
  - one of the caller's own notifications, stored as given;
  - an all-digit epoch-ms value between 2000-01-01 and one day from now, which
    is stored as the highest UUIDv7 for that millisecond. This is what
    grouped-notification clients send back: Phanpy posts
    `'' + most_recent_notification_id`, which this server emits as epoch ms
    (see below).

  Any other `last_read_id` leaves the stored marker unchanged with no error: the
  response reports the stored marker, or omits the `notifications` key when
  none is stored. A client with a stale cache therefore cannot poison it.

  Ids a client cached before the rewrite no longer resolve — there is no alias
  from an old id to its new one, and notification ids have no legacy-form
  resolver. What such a client sees: a cached `min_id` or `since_id` returns
  empty pages with no `Link` header (an unresolvable lower-bound cursor ends
  pagination), so the client sees nothing new until it reloads from the top; a
  cached `max_id` is ignored and returns the newest page again, which a client
  may append to its list as duplicates; `GET` or dismiss of an old id is a
  404, as is `GET` of an `ungrouped-<old id>` group (dismissing one is a
  no-op). The remedy is a full refresh of the
  client's notification list (reloading it from the top, without a cursor).

- **An attachment has two client-visible ids.** `POST /api/v2/media` answers
  with the numeric `medias` row id, while a status's `media_attachments[].id`
  is the attachment row's own UUID — Mastodon has one id where this instance
  has two, because a media upload and its use on a post are separate rows here.
  `PUT /api/v1/statuses/:id` accepts **either** form in `media_ids` and
  `media_attributes[][id]`, resolving the UUID through the status's own
  attachments, so a client that only ever saw the status (a focal-point drag in
  Elk or Ivory) works. Everything else still wants the upload id: `POST
/api/v1/statuses`, `POST /api/v1/accounts/outbox` and `PUT /api/v1/media/:id`
  have no status to resolve against. **Delete-and-redraft is the known gap** —
  the client re-posts the ids it read off the deleted status, and by then the
  attachment rows are gone, so those UUIDs resolve to nothing and the create
  answers 422.

### Auth & apps

- **OAuth access tokens expire after about a week without use.** Mastodon
  access tokens do not expire by default. Activity.next issues a user access
  token for a 7-day window and slides it forward when an API request it
  authenticates is accepted (writing at most once a day), so a client in
  regular use stays signed in indefinitely while a token nobody presents for
  6–7 days ages out — the security property the window exists for. No refresh
  token is ever issued (`offline_access` is not a scope this server offers, and
  Mastodon clients would not use one), so the slide is what keeps clients
  signed in. Accordingly the `refresh_token` grant is not advertised in
  `grant_types_supported` by either discovery document, and the token endpoint
  answers it with `unsupported_grant_type`. App (`client_credentials`) tokens
  last one hour and do not slide.
  Configured in `lib/services/auth/constants.ts` and applied in
  `lib/services/guards/OAuthGuard.ts`; see
  [OAuth Access Token Sliding Expiry](architecture.md#agents-oauth-access-token-sliding-expiry).

- **`GET /oauth/userinfo` `sub` is the local account id, not the actor URI.**
  The OpenID Connect `userinfo` response uses the owning account (user record)
  id for `sub` so it matches the `sub` claim in the OIDC `id_token`. Actor-scoped
  profile fields (`profile`, `preferred_username`, etc.) remain sourced from the
  actor. Set in `lib/services/oauth/userinfo.ts`.

- **The legacy `follow` scope is not honored for granular follow actions.**
  Mastodon deprecated the aggregate `follow` scope in 3.5 in favor of
  `read:follows` / `write:follows` / `write:blocks` / `write:mutes`. Activity.next
  recognizes `follow` at registration for client compatibility but enforces the
  granular (or coarse `read`/`write`) scopes on the relevant routes.

### Statuses

- **`PUT /api/v1/statuses/:id` accepts `visibility`, and widening it drops the
  edit history.** Mastodon cannot change a posted status's visibility; this
  instance can. `status_history` rows record a prior version's text and media
  but not the audience it was written for, so when the new audience reaches
  anyone the old one did not (direct → public, followers-only → unlisted, a new
  mention), `updateNoteVisibility` deletes the status's history, and the route
  deletes it again after a combined visibility + content edit, whose content
  half snapshots the pre-edit (narrower-audience) version. Narrowing keeps the
  history. `GET /api/v1/statuses/:id/history` then returns only the current
  version.

- **A status's `card` is populated.** When a status contains a link, the server
  fetches that page once, extracts its OpenGraph/Twitter-card metadata and
  serves it as the [PreviewCard](https://docs.joinmastodon.org/entities/PreviewCard/)
  in `Status.card`. Two fields are always empty, deliberately: `html` and
  `embed_url` (this server does not consume oEmbed, and emitting remote-authored
  markup for clients to inject buys nothing), and `blurhash` is null because
  thumbnails are served from the origin rather than stored locally. The
  first-party web UI's YouTube player is no exception to that: it derives its
  embed URL in the browser from `card.url`, so a client reading these two fields
  still sees them empty. A boost
  (`reblog`) carries `card: null` at the top level; the card is on the wrapped
  status. Fetching can be turned off entirely by an admin under
  Admin → Network → Link previews, in which case `card` stays null for new
  statuses.

- **`GET /api/oembed` emits a static blockquote embed.** Activity.next has no
  per-status embed widget, so the oEmbed `html` field is a `blockquote` linking
  to the status page rather than Mastodon's `<iframe src=".../embed">`. The
  provider resolves only this instance's own public or unlisted status URLs
  (including on configured trusted hosts).

- **Quote approval is consent-gated (FEP-044f) and has no manual-approval
  queue.** Quote posts (Mastodon 4.5) are supported end to end — `quoted_status_id`
  and `quote_approval_policy` on `POST /api/v1/statuses`, the `quote` sub-entity
  and `quote_approval` on the Status entity, `GET /api/v1/statuses/:id/quotes`,
  `POST /api/v1/statuses/:id/quotes/:quoting_status_id/revoke`, and
  `PUT /api/v1/statuses/:id/interaction_policy` — with a few deliberate limits.
  Approval is driven by the FEP-044f handshake (`QuoteRequest` → `Accept` + a
  hosted `QuoteAuthorization` stamp; revocation is a `Delete` of that stamp), so
  the policy vocabulary is `public` / `followers` / `nobody` and `quote_approval.manual`
  is always empty (there is no held-for-review queue). For a `followers`-policy
  status, `quote_approval.current_user` reflects the follower relationship — a
  non-author viewer sees `automatic` when they are an accepted follower of the
  author and `denied` otherwise (an anonymous viewer still sees `unknown`); the
  verdict is resolved in one batched follow query per page, so it adds no N+1.
  An inbound quote that arrives with a valid `quoteAuthorization` stamp is
  accepted even when the quoted post is not already stored locally: the quoted
  note is fetched (instance-signed, like the boost path) so the stamp can be
  verified against its author and the quote card can embed the content. Fetching
  only makes the author knowable — the stamp's three-field match against that
  author is still what grants approval. An approval is honored on whichever
  activity carries it: the quoted author's `Accept` (whose `object` is the
  `QuoteRequest`, never a `Follow`), or a later `Update` in which the quoter
  re-federates the note now bearing the stamp. Both settle a `pending` edge
  through the same one-way state machine, so a re-derived `pending` can never
  downgrade one already accepted. Legacy Fedibird (`quoteUri`)
  and Misskey (`_misskey_quote`) quotes carry no stamp, so they are stored and
  rendered as unapproved (`pending`) rather than as embedded quotes, matching
  Mastodon 4.5's treatment of stamp-less quotes. Revoking approval fans the stamp
  `Delete` out to the quoting author's inbox **and** every named (`to`/`cc`)
  recipient of the quoting note, so third-party servers that saw the quote honor
  the revocation (FEP-044f); every copy stays signed by the quoted author, which
  is what the receiving side requires. Changing a status's quote policy via
  `PUT …/interaction_policy` is not treated as an edit (it never sets
  `edited_at`). The v2 instance entity advertises `api_versions.mastodon: 7` so
  Mastodon 4.5 clients enable their quote UI (streaming stays unadvertised —
  `configuration.urls.streaming` is empty, so no streaming capability is
  claimed). Quote cards render only for **stored** statuses: a live
  remote-profile view (`getActorPosts` / `fromNote`, which builds unstored
  ephemeral statuses that carry no quote edge) omits quote rendering — those
  posts show their quote once actually ingested and stored. When a user creates
  a quote referencing a remote status URL that is not yet stored locally (e.g.
  from the web composer or Mastodon API), `resolveQuoteForCreate` delegates to
  `fetchQuoteTargetForCreate` (`lib/services/quotes/fetchQuoteTargetForCreate.ts`)
  to fetch, verify, and store the unstored note or poll on demand (signed by the
  instance actor), with `skipQuoteResolution: true` to bound quote fetch recursion
  to 1 hop. Configured under `lib/services/quotes/`, `lib/actions/*Quote*`, and
  `app/api/v1/statuses/[id]/quotes|interaction_policy`.

### Timelines & trends

- **`GET /api/v1/trends/links` intentionally returns `[]`.** Activity.next
  stores link preview cards (see below), but it does not compute trend rankings
  over them — this is a personal server, where "what is trending" over one
  account's timeline is not a meaningful number. Trending hashtags
  (`/api/v1/trends/tags`) and statuses (`/api/v1/trends/statuses`) are fully
  implemented.

- **`GET /api/v1/timelines/direct` is retained.** Mastodon removed this endpoint
  in 3.0 in favor of conversations, but Activity.next keeps it for legacy clients.
  The first-party UI uses `/api/v1/conversations` for threaded direct messages;
  the `direct` timeline is served by the shared `timelines/[timeline]` handler.

- **Timeline context and `format=activities_next`.** Standard Mastodon requests
  to `GET /api/v1/timelines/:timeline` receive a flat JSON array of Mastodon Status
  entities with pagination Link headers. When requested with query parameter
  `format=activities_next`, the endpoint returns a JSON payload
  `{ statuses, context, nextMaxStatusId, prevMinStatusId }`. `context` provides
  safe, viewer-scoped reply parent previews, conversation groupings, and thread
  indicators used by the first-party web UI to render grouped timelines while
  leaving standard Mastodon client responses completely unmodified.

- **Status thread context and traversal boundaries.**
  `GET /api/v1/statuses/:id/context` returns `{ ancestors, descendants }` using the
  standard Mastodon response schema and `thread` filter context annotations. The
  underlying `getStatusContext` service is shared with native server components,
  resolves both database UUIDs and URL aliases, enforces viewer visibility/block
  predicates, and bounds iterative ancestor and descendant traversal.

### Media

- **An attachment this instance cannot describe is `type: "unknown"`, never a
  `null` entry.** Animated clips with resolved `playbackType: "gifv"` are served
  as `type: "gifv"`; unresolvable media or an `audio/mp4` upload without stored
  duration falls back to `unknown`, carrying the id, url, description and blurhash.
  Timelines batch-enrich unclassified video attachments on read (with bounded
  concurrency, per-page limits, and a deadline guard) and persist resolved
  classifications, so timeline feeds and status detail pages both serve `type: "gifv"`
  consistently on first read. The write is scoped to the attachment's own status
  (`updateAttachmentPlayback` takes `statusId`), and a status the detail page
  live-fetched rather than read from the database is enriched in memory only: its
  attachment ids are whatever the remote document says, so persisting against
  them would let any remote note rewrite another status's attachment rows.
  This is not cosmetic: `media_attachments` is an array of MediaAttachment, so a `null`
  entry failed the entity's own validation and took the entire status off the
  API — dropped from timelines as un-hydratable, an error on a single-status
  GET — while the web UI still rendered it. The id matters as much as the type:
  an entry a client cannot name is one it cannot preserve through an edit.

- **Media processing is synchronous.** `POST /api/v2/media` always returns
  `200 OK` with a fully-processed attachment; it never returns `202 Accepted`
  with an unprocessed placeholder the way Mastodon does for large uploads.
  Activity.next processes uploads inline. Clients that poll `GET /api/v1/media/:id`
  after a `202` still work — they simply receive the finished attachment on the
  first read. (An asynchronous, presigned direct-to-storage upload path exists as
  an extension; see below.)

### Reactions

- **A remote reaction is not a favourite.** Mastodon has no reaction concept, so
  a Misskey `Like` carrying an emoji is stored as an emoji reaction, not an
  ordinary favourite: no `likes` row, no favourites-count movement.
  `favourites_count`/`favourited` therefore count exactly local favourites plus
  plain remote `Like`s. Reactions federated before this rule stay favourites —
  they are indistinguishable from genuine ones in storage, so there is no
  backfill.

### Notifications

- **A block, or a mute with notifications on, suppresses every notification
  from that account.** `createNotificationWithPolicy` is the single seam all
  notification creation goes through, and it drops a notification whose source
  has blocked or been blocked by the recipient, or whom the recipient muted with
  `notifications: true` — follows, follow requests, mentions, replies,
  favourites, boosts, quotes alike. Notifications
  an account raises for itself (activity imports, gear reminders, a poll's own
  author) are exempt.

- **Grouped notifications' `most_recent_notification_id` is a synthesized
  integer, not a resolvable id.** In the `GET /api/v2/notifications` response
  (and the single-group `/:group_key` variant), Mastodon serializes
  `most_recent_notification_id` as the numeric notification id, and clients
  decode it as an integer (the official Mastodon iOS app types it `Int` and
  crashes on a string). Activity.next's notification ids are time-ordered
  UUIDv7 strings (see **Notification ids are time-ordered UUIDv7s** above),
  which can't be numbers, so it emits a deterministic integer derived from the
  group's most-recent notification `createdAt` (epoch ms) — the same
  millisecond that notification's UUIDv7 encodes. This server cannot resolve it
  as a cursor: Phanpy's background poller calls
  `GET /api/v1/notifications?limit=1&since_id=<most_recent_notification_id as
a string>`, which returns an empty page, so that poller never detects new
  notifications (pre-existing behaviour). Some clients also send it back as a
  read marker: Phanpy posts it as the
  `notifications` marker's `last_read_id`, and `POST /api/v1/markers` stores an
  epoch-ms value as the highest UUIDv7 for that millisecond, so it compares
  correctly against real notification ids. Pagination uses the `Link` header and
  the string `page_min_id` / `page_max_id`, which stay real UUID cursors the
  server can resolve. Do **not** "fix" `most_recent_notification_id` back to the
  UUID string: that re-crashes the Mastodon iOS decoder. Unlike Mastodon's
  globally-unique integer notification ids, this timestamp-derived value is not
  guaranteed unique — two groups whose most-recent members were created in the
  same millisecond share it — which is harmless because clients key the list on
  the (unique) `group_key`, not on this field.

### Accounts

- **`agreement` on `POST /api/v1/accounts`.** An API registration must send
  `agreement=true` whether or not the server has terms, as Mastodon requires;
  without it the answer is `422` with an `agreement` `ERR_ACCEPTED` detail.
  The web sign-up form needs it only when the domain it is on has a terms of
  service or privacy policy. Mastodon also stores when a user agreed; this
  server does not.

- **`GET /api/v1/tags/:name` always includes `following` and `featuring`.**
  Mastodon omits these optional `Tag` fields for unauthorized tokens;
  Activity.next always returns them, defaulting both to `false` for anonymous or
  unauthenticated requests, so clients get a consistent `Tag` shape. The
  `featuring` flag (Mastodon 4.4.0) also appears on the `POST /api/v1/tags/:name/feature`
  and `POST /api/v1/tags/:name/unfeature` responses.

- **Remote profiles are fetched live instead of served from local history
  only.** Mastodon renders a remote account from whatever has already federated
  to the instance, so a small instance shows an empty profile with zeroed
  counts. Activity.next stores the remote-advertised follower/following/status
  collection totals when it records or refreshes a remote actor. A known remote
  actor is refreshed (stale profile + counter sync) before serialization on
  every account-serving path an authenticated client uses to open a profile:
  `GET /api/v1/accounts/:id`, `GET /api/v1/accounts/lookup`,
  `GET /api/v1/accounts/search` (exact `resolve=true` handle matches), and the
  resolved exact match of `GET /api/v2/search`. The refresh is guarded so hot
  account paths cannot degrade: concurrent requests share one in-flight
  refresh, a failed refresh backs off for a few minutes instead of retrying
  per request, and a slow remote only delays the response briefly — the
  refresh finishes in the background and the stored profile is served in the
  meantime. Relatedly, `GET /api/v1/accounts/lookup` validates a presented
  bearer token up front and rejects an invalid one with `401` (matching the
  rest of the guarded API surface, where stock Mastodon treats lookup as
  fully public); credential-less lookups still serve stored data without any
  remote fetch. The statuses endpoint
  (`GET /api/v1/accounts/:id/statuses`) falls back to fetching the actor's
  recent public posts live from their outbox when the local store cannot fill
  the first page for an authenticated viewer. A live-served page carries no
  `Link` pagination headers (remote ids cannot cursor the local store), and
  the fetched statuses are display-only — they are not persisted.

### Lists & imports

- **Adding yourself to your own list backfills your recent posts.** As in
  Mastodon (≥ 3.1), a list owner may add their own account to a list without a
  follow, and their posts then fan into it. Mastodon backfills none of the
  owner's history, so only posts written afterwards appear. Activity.next
  backfills the owner's 200 most recent posts other than direct messages
  (`LIST_OWNER_BACKFILL_MAX_POSTS`), so their recent posts appear in the list
  at once. The list's replies policy is applied when the list is read, not
  during the backfill, so replies it hides still count toward the 200 and
  appear if the policy is loosened later.

- **Adding any other member backfills their recent history.** Adding an account
  you follow to a list brings its stored posts into the list, newest first, up
  to `LIST_MEMBER_BACKFILL_MAX_POSTS` (1000) per member and read in pages of
  `LIST_MEMBER_BACKFILL_BATCH_SIZE`, so the work done inside the request (or the
  inbox transaction on a remote Follow Accept) does not scale with how much
  history is cached for the member. An account you have only requested to follow
  can join a list too (Mastodon ≥ 4.2), and its stored posts are brought in the
  same way once it accepts the request. Mastodon ≥ 4.4 merges at most 200 of a
  member's recent posts in both cases, and earlier versions backfill nothing.

- **CSV export and import are plain endpoints.** Exports (`GET
/api/v1/exports/<file>.csv`) match Mastodon's `Export` file formats, and
  `following_accounts.csv` lists the newest follow first. Imports follow
  `Form::Import`, `BulkImportService` and `BulkImportRowService` (merge or
  overwrite, 20,000 rows). Mastodon has no REST API for either, only the
  settings web UI, so `POST /api/v1/imports` and `GET /api/v1/imports[/:id]` are
  this server's own. A file over 5 MiB gets 413 `File is too large`, and the
  body is read with a byte cap, so a chunked body over the limit is refused
  without being buffered. Rows run in resumable, time-budgeted slices of about
  20 seconds rather than one Sidekiq job per row, with one attempt per row. The
  run's lease is renewed after each unit of work, and a NoQueue run is
  unbudgeted and finishes in one go. A row that throws is stored with a generic
  error, not the exception message. A blank or missing follow option leaves an
  existing follow's stored value. A following row, or a list row for another
  account, fails with `Account is blocked` when either side blocks the other or
  the importer blocks the target's domain or its handle's domain, and with
  `Account has moved` when the target has moved. Overwrite matches an account by
  its handle, then by the actor that handle resolves to, so Mastodon's
  local-domain handles still match; a relation is kept, not removed, when a row
  with the same username, whose resolution failed for a reason that may pass,
  names the same domain (a dotted one; the relation's host may be a subdomain of
  it), and that row is retried. Failed rows are kept and listed (up to 100 on
  `GET /api/v1/imports/:id`); Mastodon deletes imported rows and only counts
  failures. A failed NoQueue run finishes the import immediately. When the actor
  starts another import, an unfinished one with no live claim and no progress
  for 15 minutes, or no progress for 24 hours, is abandoned (`lastError`
  "Abandoned: no progress", its lease cleared). A bookmark of a remote status is
  fetched through the existing remote status fetch, which stores only public
  notes, so a non-public remote bookmark fails. A mute's `notifications` flag is
  Mastodon's `hide_notifications`.

### Admin

- **Admin account ids are the actor id space, not numeric snowflakes.**
  `Admin::Account.id` (and the `account`/`target_account`/`assigned_account`/
  `action_taken_by_account` ids embedded in `Admin::Report`) is exactly the id
  the public `Account` entity emits for that actor — its UUIDv7 `publicId`, or
  the legacy colon-encoded actor id for an actor that has none — never the
  internal login-account UUID. The two id spaces move together by construction,
  so an admin account id is always usable against the ordinary account
  endpoints. Admin report ids are the raw report UUIDs. Admin tooling that
  assumes numeric ids must treat these as opaque strings. Because one login
  account can own several actors across domains,
  `suspend`/`silence`/`sensitize` act per actor and apply
  to remote actors too, while `disable`/`enable`/`approve`/`reject` are
  local-account-only (a remote target returns `422`); a full Mastodon-style
  "suspend freezes login" needs both `suspend` and `disable`. Registration
  approval is wired but empty today (`pending` lists return `[]` until an
  approval-required mode exists).

- **Admin endpoints accept only admin scopes from a bearer token.** A bearer
  token calling any `/api/v1/admin/*` or `/api/v2/admin/*` route
  (`AdminApiGuard`) needs `admin:read` for `GET` and `admin:write` for
  mutations, or the route's own granular scope where it opts into one
  (`admin:read:accounts`, `admin:write:reports`, …). A token holding only the
  coarse `read`/`write` scopes is refused as `insufficient_scope`, matching
  Mastodon, where `read` never implies `admin:read`; an admin client must
  request the admin scopes explicitly. The refusal is a `401`
  (`insufficient_scope`, this repo's bearer-failure convention), where Mastodon
  answers `403`. The account's admin role is checked as well (`403`
  without it) — both must hold. A cookie-session admin (the web
  admin UI) carries no scopes: it is gated by the admin role, the account and
  actor state checks (disabled, unconfirmed, moderation-blocked) and, for
  mutations, the same-origin proof; scopes do not apply.

### Instance & health

- **`GET /health` returns JSON, not `text/plain`.** Mastodon's health endpoint
  renders `text/plain` body `OK`; Activity.next returns `{"status":"UP"}` with a
  `200 OK`. Liveness probes should assert on the `200` status, not the body.

- **`GET /api/v1/instance/privacy_policy` returns 404 when unset.** Mastodon
  falls back to a bundled default privacy policy when the admin has not set one.
  Activity.next ships no default, so the endpoint returns `404` until a policy
  is saved in Admin › Server settings or `ACTIVITIES_PRIVACY_POLICY` is set (clients
  hide the link on a 404), and `/api/v2/instance` reports
  `configuration.urls.privacy_policy` as `null` then, where Mastodon always has
  a URL. The companion `GET /api/v1/instance/terms_of_service` (and `/:date`)
  404-when-unset and its `null` `configuration.urls.terms_of_service` already
  match Mastodon. Both documents are Markdown rendered like Mastodon's
  serializers (Redcarpet with `escape_html` and `no_images`, `%{domain}`
  replaced); bare URLs and email addresses are also linked. Only the current
  version of each is kept: the terms report the UTC date they last changed as
  their single `effective_date` and are never `succeeded_by` another, and the
  policy's `updated_at` is when it last changed. A document pinned by the
  environment has no date and reports the epoch (`1970-01-01`).

## Not planned

These endpoints are not implemented and are not currently on the roadmap. They
can be revisited on demand — file an issue if you need one.

- Admin IP blocks — `/api/v1/admin/ip_blocks`
- Admin email domain blocks — `/api/v1/admin/email_domain_blocks`
- Admin canonical email blocks — `/api/v1/admin/canonical_email_blocks`
- Admin measures / dimensions / retention — `/api/v1/admin/measures`,
  `/api/v1/admin/dimensions`, `/api/v1/admin/retention`
- Admin trends moderation — `/api/v1/admin/trends/*`
- Annual reports ("wrapped") — `/api/v1/annual_reports/*`
- Link timeline — `/api/v1/timelines/link` (preview cards are stored now, but
  this timeline also needs the trend ranking that `/api/v1/trends/links` does
  not compute)
- Async refreshes — `/api/v1_alpha/async_refreshes`
- The out-of-band redirect flow — `urn:ietf:wg:oauth:2.0:oob`
- Collections — `/api/v1/collections/*`, `/api/v1/accounts/:id/collections`,
  `/api/v1/accounts/:id/in_collections` and `/api/v1/timelines/collection/:id`
  were removed and answer 404; the `read:collections` and `write:collections`
  scopes are still accepted at sign-in.
- Streaming API — `/api/v1/streaming` is not implemented and not planned;
  `configuration.urls.streaming` stays empty, so clients poll.

## Extensions

Activity.next adds endpoints and parameters beyond the Mastodon surface. These
are not part of the Mastodon API and are safe for Mastodon clients to ignore.

### Statuses & posting

- **Declared language of a new status** — `POST /api/v1/statuses` (notes and
  polls, immediate and scheduled at publish time) stores `language` by the same
  chain as Mastodon: the request's own `language` as sent (trimmed, never cut to
  two letters, so `yue`, `fil` and `zh-TW` survive; a malformed value such as
  `English` is ignored), else the author's saved
  posting language (`defaultLanguage`, Mastodon's `source.language`; ignored
  when it is not a 2-3 letter code with optional subtags), else `en`. That last
  step is `getPostingLanguage` (`lib/utils/postingLanguage.ts`), the same value
  `verify_credentials` reports as `source.language` and Settings → Preferences
  shows, so a created status always has a language
  (`GET /api/v1/preferences` still reports `posting:default:language` as null
  when none is set or it is malformed, as Mastodon does). Only the request's
  own language is passed to content-based detection as its hint, on create and
  on edit; a defaulted or stored one is not.

- **Atomic `Idempotency-Key` on `POST /api/v1/statuses`** — `Idempotency-Key`
  (up to 255 characters; a longer key is rejected with `422` before any work)
  is claimed atomically inside the same database transaction as the status row
  creation (`createNoteWithResult` / `createPollWithResult` in
  `lib/database/domains/status/writes.ts`), scoped to `(actorId, key)`, stamped
  with the time of the request (not a backdated `created_at`), and bound to a
  SHA-256 `contentHash` of the normalized request payload (`status`,
  `spoiler_text`, `visibility`, `sensitive`, `language`, `in_reply_to_id`,
  `quoted_status_id`, `quote_approval_policy`, `media_ids`, `poll`,
  `fitness_file_id`, `scheduled_at`, `created_at`). A repeat with the same key
  and identical payload returns `200 OK` with the existing serialized `Status`
  without creating a second status or enqueuing a second federation delivery;
  a repeat with the same key and different request parameters returns
  `422 Unprocessable Entity` (`{ error }`). An immediate (unscheduled) request
  is checked against its key right after the body parses, before the
  poll/media, content-limit and `created_at` checks: the hash binds the payload
  the kept post was accepted with, so a retry is answered with that post even
  after an admin lowered a limit. A scheduled request does not look its key
  up; it claims it when it publishes (below). A key stored before content hashing
  (a `NULL` hash) matches any payload. Concurrent requests for the same
  `(actorId, key)` in one process wait for the first request's create; across
  processes the `(actorId, key)` unique constraint inside the status creation
  transaction picks one winner, and the others answer as a repeat does. Each
  key records how far its create got (`idempotency_keys.state`): `pending`
  from the claim, `publishing` while a request is queueing its federation job
  (stamped with `stateChangedAt`), `publish_failed` when the post was saved but
  that job could not be queued, and `complete` once the queue has accepted it
  (keys stored before the column existed are `complete`). After the status row commits, the steps that
  complete the post (mention, hashtag and emoji tags, attachments, timelines,
  fitness linking and the hydrating re-read) must all succeed. When one fails,
  its parallel siblings are allowed to settle, then the not-yet-federated
  status is deleted locally (no `Delete` is sent) together with this request's
  key (`discardUnpublishedStatus`), and the route answers `400`, so a retry
  with the same key creates the post afresh. The discard happens only while the
  key is still `pending`: if a retry has taken the key over and sent the post
  (see below), the post is kept as it was left. A post that stays (that case,
  or a discard that itself fails) answers `503` as below, never `400`, and so
  does any failure after the post was saved or found by a repeat (such as
  serializing it for the response): a `400` tells a client nothing was kept,
  and an edited resend under a new key would post it twice. Queueing
  `SendNoteJob` / `ProcessFitnessFileJob` is the commit point, on every queue:
  a queue error is ambiguous (the job may have been accepted, or run inline),
  so the post is kept, the key moves to `publish_failed`, and the route answers
  `503 Service Unavailable` (`{ error }`); the deprecated
  `POST /api/v1/accounts/outbox` answers that `503` too. A retry with the same
  key queues the job again under the same deterministic job id and answers
  `200 OK` (or `503` again); without a key nothing re-sends that post. Of the
  create and its retries, one queues the job at a time: each takes the key to
  `publishing` with one conditional update first; the queue's acceptance then
  moves it to `complete` and a queue error to `publish_failed`. When that
  state write fails the key stays `publishing`, and a retry answers `409`
  until it is 60 seconds old, then queues the job again under the same id. Best-effort steps (detected language, hashtag
  counters and search indexing before the publish; the quote request,
  notifications and alerts, and link preview sync after it, which run even
  when the publish failed, since the post is kept) are logged on failure and do
  not change the response. A repeat that finds the key `pending` waits for the create when it
  runs in the same process. Otherwise it answers `409 Conflict` (`{ error }`,
  retryable) while the key is younger than 60 seconds
  (`IDEMPOTENCY_PENDING_STALE_MS`), and after that treats the key as
  `publish_failed`, since its process most likely stopped: that post is sent
  as it was left, which can be incomplete if the process died part-way through
  the completion steps. Such a retry only queues the federation job: the quote
  request, notifications and alerts, and link preview sync of a create whose
  process stopped before running them are never run (re-running them could
  notify twice), and its hashtags are uncounted if it stopped before counting
  them. A process that stops after taking the key to `publishing` leaves it
  there, and a retry 60 seconds later queues the job again under the same id;
  if the queue had in fact accepted it, or the publish ran longer than 60
  seconds (on the in-process queue, a slow inline fan-out), the job is queued
  twice, which only QStash and the database queue deduplicate. A repeat that
  finds the key but not its status re-reads the key, and answers `410` only
  when the key still names that status; when the create was discarded in
  between, the repeat creates the post afresh. Deleting a status
  (`lib/database/domains/status/deletion.ts`) preserves its `idempotency_keys`
  row as a tombstone, and retrying with the key of a deleted status returns
  `410 Gone` (`{ error: 'The status associated with this Idempotency-Key was deleted' }`)
  instead of recreating the post. A scheduled status claims its key (the
  client's, or `scheduled-<id>`) the same way when it publishes, bound to a hash
  of its stored params; when that key already belongs to a deleted status or to
  different content, the scheduled status is dropped with a warning. A publish
  that would answer `503` or `409` fails the job instead and keeps the scheduled
  row, so the queue's retry finishes the post through the same key. Keys older
  than 7 days (`IDEMPOTENCY_KEY_TTL_MS`) are purged by
  `deleteExpiredIdempotencyKeys` on each tick of the actor-deletion sweep
  (`startActorDeletionSweep` in `lib/services/actors/actorDeletion.ts`), and
  erasing an actor deletes all of its keys.

- **Backdated statuses** — `POST /api/v1/statuses` accepts an optional
  `created_at` (JSON or form field): an ISO 8601 date-time with `Z` or an
  offset, for example to post a photo album dated at the end of the event it
  records. The status, its poll and its attachments are stored with that time,
  the status's UUIDv7 `id` is minted from it (so id order still matches
  `created_at` order on every timeline), and the federated `Create`/`Note`
  carries it as `published`. A blank value means now. It is answered with a
  422 `{ error }` when it is not a date-time with a zone, is at or before 1970-01-01T00:00:00Z,
  is more than one minute in the future, or is combined with `scheduled_at`. A
  poll's `expires_in` still counts from the time of the request. A backdated
  status lands at its backdated position on timelines, not at the top as a new
  post, so clients polling with `since_id`/`min_id` will not pick it up, and a
  backdated direct message older than a conversation's latest message does not
  mark the conversation unread or move it up the conversations list (its mention
  notification still arrives). Mastodon clients never send it.

- **`?format=activities_next`** — timeline endpoints,
  `GET /api/v1/trends/statuses` and `GET /api/v1/accounts/:id/statuses` accept
  this query flag to return the raw internal status JSON instead of the Mastodon
  status shape (the web `/explore` Posts tab uses it to render the interactive
  timeline post component). On the account statuses endpoint the body is
  `{ statuses, nextMaxStatusId }` with no `Link` header: a local account's
  profile page loads its older posts with it, passing `nextMaxStatusId` back as
  `max_id` the way Mastodon's web profile pages this endpoint.

### Media & uploads

- **`Activities-Expected-Actor` on `POST /api/v1/statuses` and the upload
  routes** — a web-client extension (not part of Mastodon, and not listed in
  `Access-Control-Allow-Headers`): the offline send queue sends the id of the
  profile a post was written as, so a resend under another profile's cookie
  cannot create the post as that profile. The queue's uploads carry it too, so
  one profile's photos and activity files (with their GPS) never become another
  profile's media or fitness rows: `POST /api/v1/media` and `POST
/api/v2/media`, `POST` and `PATCH /api/v1/medias/presigned` (the presigned
  upload and its completion), `PUT`/`PATCH /api/v1/media/:id` (a video's
  thumbnail) and `POST /api/v1/fitness-files`. When the header names an actor
  other than the authenticated one, each of these answers `409`
  (`{ error: 'Signed in as a different profile' }`) and writes nothing: the
  check runs right after authentication, before the body is read and before
  any row or stored file. On `POST /api/v1/statuses` that is also before the
  `Idempotency-Key` length check and any replay, so a mismatch is never answered
  with a replay of the key the current actor already claimed. An absent or
  whitespace-only header is ignored, so Mastodon clients and the composer are
  unaffected. The literals live in `lib/services/statuses/expectedActor.ts`
  (dependency-free, shared with the web client) and the check in
  `expectedActorMismatchResponse` (`expectedActorMismatch.ts` beside it).

- **Presigned / direct-to-storage media** — `/api/v1/medias/presigned` (and the
  Strava archive presigned upload) provide an asynchronous upload path that
  offloads bytes directly to object storage.

### Gallery

- **Media details and gallery** — `GET`/`PUT`/`PATCH /api/v1/media/:id` carry a
  non-Mastodon `details` object (snake_case on the way in), and
  `/api/v1/gallery/*` and `/api/v1/accounts/:id/gallery/*` serve the gallery.
  `GET /api/v1/accounts/:id/gallery/media` takes owner-only query parameters: `show`
  (`all`, `in_gallery`, `hidden`, `not_posted`, `not_in_album`; ignored for anyone else),
  `sort` (`taken_desc` default for UI, `uploaded` default for API and non-owners, `taken_asc`),
  `cursor` (opaque keyset date cursor `<sortAt ms>:<mediaId>` for date sorts),
  `taken_from` and `taken_to` (`YYYY-MM-DD` inclusive UTC date range),
  `place` (place name or `none`), `activity_id` (fitness file id or `none`; the activity's route map image, found by the file's recorded `mapImagePath` and so still after a post edit renames it, is not one of its photos), and `album_id`
  (calculates membership for album pickers), `include_total=true`, `include_days=true` (the
  owner's page then also carries `days`, per-day stats keyed by the day a photo is shown under:
  `YYYY-MM-DD` of `sortAt` for a dated photo under a date sort, `uploaded:YYYY-MM-DD` of
  `createdAt` for a dateless photo under a date sort and for every photo under `sort=uploaded`),
  and `day_key` (restricts a normal list page to one matching day, or is required with
  `ids_only`). Anyone else's copies of these owner-only
  parameters are ignored, even malformed ones (only `gear_id` and `ids_only` answer 422 to a
  non-owner); `max_id` still pages the `uploaded` order. `ids_only=true&day_key=<GalleryDayKey>`
  is an owner-only read answered as `{ mediaIds }` — the ids of that day's matches from
  `offset` (an integer from 0 to 100,000, default 0), `limit` at most (capped at the album item cap, not the page's 60), in `sort` order, minus the `album_id`
  album's members (`album_id` excludes here rather than counting) — and it answers 422
  `{ error: 'ids_only is only available to the owner' }` to anyone else, checked before the
  owner-only strip so it is never silently honoured, like `gear_id`; the owner's 422s include an
  invalid `day_key` on either read, `ids_only` without `day_key`, a `day_key` that does not match
  `sort`, and `ids_only` with `cursor` or `max_id`. On a normal read, `day_key` filters the list
  page to that day and keeps normal cursor or `max_id` pagination. The response adds
  `nextCursor` for date pagination (while `nextMaxId` is used for `uploaded`), `total` (matching
  photos across all pages, on the owner's first page when `include_total=true`), `inAlbumTotal`
  (when `album_id` is supplied), `days` (when `include_days=true`), and reports `inGallery`,
  `posted`, `uploadedAt` and `albumCount` on each of the owner's items. Photos with no `sortAt` (inserted by a build older than the migration) are left
  out of the date sorts until `scripts/maintenance/backfillMediaSortAt.ts` fills them.
  `place=none` and `activity_id=none` are reserved values meaning "no place" and "not from an
  activity" (any media on an activity's post counts as from it, the route map included); a place literally named "none" cannot be selected by name (accepted limitation).
  `GET /api/v1/gallery/media/facets?show=<GalleryShow>` is an owner-only endpoint returning filter facet options
  and counts across the owner's media in `show`: `total`, `species`, `places`, `noPlaceCount`, `months`
  (`YYYY-MM` UTC), `activities`, and `notFromActivityCount`. Photos the
  owner added in Gallery without a post (`POST /api/v1/gallery/media` with
  `{ "media_ids": [...] }`, up to 40, scope `write` or `write:media`, answers
  `{ "media_ids": [...] }` with the ones kept) are listed to the owner only,
  with a `null` `statusId`; they are never shown to anyone else and never
  federated, and `DELETE /api/v1/media/:id` removes one (Mastodon's media
  destroy, which still refuses media a post uses).
  `PUT /api/v1/statuses/:id` accepts `media_attributes[][description]` of up to
  1500 characters, as `PUT /api/v1/media/:id` does and as Mastodon does, and an
  edit that sends only `media_attributes` keeps the post's
  text, spoiler, sensitivity, visibility and other attachments (with the alt
  text they already publish: only the photos it describes change theirs),
  records a history entry and federates one Update.
  The owner's `details` (camelCase on the way out) also reports what the
  lookups found: `subject.taxonKey`, `subject.taxonPath`,
  `subject.iucnCategory`, `subject.threatStatus` (`threatened`,
  `not-threatened` or `unchecked`), `subject.lookupStatus`,
  `subject.lookupAt` (when the status was last written, ISO 8601),
  `subject.lookupStale` (pending for over two minutes, so Retry is offered),
  `place.countryCode`, `place.nameSource`, `place.lookupStatus`,
  `place.lookupAt`, `place.lookupStale` (the same rules for the place
  lookup), and the
  model's `subjectSuggestions`. None of the IUCN fields or the suggestions is
  ever returned to anyone else, and a threatened or not-yet-checked species'
  `place` is `null` for every non-owner. `POST /api/v1/media/:id/subject-suggestions`
  and `POST /api/v1/media/:id/lookups` are owner-only; Mastodon clients get no
  suggestions. A suggestions body that is JSON but not `{ refresh?: boolean }`
  is a 422. A lookups body may be `{ kind?: 'subject' | 'place' }`: a kind
  retries only that lookup (the web dialog sends the kind of the Retry that
  was pressed, so a subject Retry never re-queues the place), and an empty
  body, or none, retries both; any other JSON body is a 422 that costs no
  retry. Fresh suggestion runs are limited to 30 per actor per hour, lookup
  retries to 20 per actor per hour, and `GET /api/v1/gallery/taxa` (species
  search for the picker) to 60 per actor per minute, all answering 429 past the
  limit; the counters are in process
  (`createWindowCounter`, `lib/services/gallery/lookups/rateLimit.ts`). See "Media Details, EXIF and Gallery Settings" in
  [maintenance.md](maintenance.md#media-details-exif-and-gallery-settings).

- **Photo edits** — owner-only, non-Mastodon routes under
  `/api/v1/media/:id/edit` (`write` or `write:media`, or the web session):
  `GET` answers `{ media, edit, usage, capabilities }`, `GET …/edit/source`
  streams the uploaded original from this origin, `POST` (multipart: `file`,
  `recipe`, `base_version`, `save_id`, `apply_to_posts`, `focus`, plus a
  `mask_<id>` PNG per new or changed subject or brush mask) stores the
  browser's render as the live file, `GET …/edit/masks/:maskId` streams one
  stored mask PNG (owner-only, `Cache-Control: private`; never federated nor
  in any public entity), and
  `POST …/edit/revert` (JSON) restores
  the original and removes the masks. `GET` lists the stored masks as
  `edit.masks: [{ id, url }]` and offers the browser's subject model as
  `capabilities.subjectModel` (`null` when the server turned it off). Photo editing uses client-side Look Presets rather than a remote enhance endpoint. Errors are `{ error }`; a stale `base_version` is
  `409 { error: 'stale', edit: { version, saveId } }`. The owner's `details`
  gains `edit: { version, editedAt }` and the public media details gain
  `editedAt` (ISO 8601, null when unedited). The Mastodon `MediaAttachment`
  is unchanged: its `url` and `meta` already describe the live file, so a
  Mastodon client sees an edited photo as an ordinary one (`preview_url` is
  the edited file too, even when a client had uploaded a thumbnail for it). See "Media Details,
  EXIF and Gallery Settings" in
  [maintenance.md](maintenance.md#media-details-exif-and-gallery-settings).

- **Gallery albums** — owner-only, non-Mastodon routes (snake_case on the way
  in), taking `read` or `read:statuses` to read and `write` or `write:media` to
  write (or the web session). `GET /api/v1/gallery/albums` returns `albums`
  (each with `itemCount`, dates, `cover`, `previews` and the owner-only
  `hiddenPlaceCount`) and a top-level `photoCount`, the number of distinct
  photos across them; `POST` creates one (`title`, `description`,
  `visibility` `public` or `private`, `sort_order` `taken_desc`, `taken_asc` or
  `added_desc`, optional `cover_media_id` which must be one of `media_ids`, and up to 100 `media_ids`, created together with the album in one transaction). `GET`, `PATCH` (`cover_media_id` must
  be an item, `null` clears it) and `DELETE /api/v1/gallery/albums/:id` read,
  change and remove an album, the `GET` carrying the facts (the public-safe
  numbers, for a private album too), species chips, `mediaIds` (every photo
  the owner can see in it), `storedItemCount` (the items that count against the
  2,000 cap, including photos whose post was deleted, which `itemCount` leaves
  out) and the first page of photos (`?limit&sort`). Each
  album card carries the owner-only `hiddenPlaceCount`. `GET`, `POST` and `DELETE
/api/v1/gallery/albums/:id/items` page the photos (`?max_id&limit&sort&subject`)
  and add or remove `media_ids` (1 to 100; the `POST` answers `added`,
  `existing` and `skipped`, and is all or nothing). An album holds at most 2,000
  photos and an actor 200 albums (422 past either). A missing album and
  somebody else's both answer 404; writes are limited to 120 per actor per
  minute (429, in process). Albums are not federated.

- **Public gallery albums** — `GET /api/v1/accounts/:id/gallery/albums` and
  `GET /api/v1/accounts/:id/gallery/albums/:albumId`, non-Mastodon, CORS `GET`s
  behind `OptionalOAuthGuard` (`read` or `read:statuses`, or no token, or the web
  session), answering for whoever is asking. The list returns `albums` (each
  with `itemCount`, `firstAt`, `lastAt`, `cover` and `previews`) and `photoCount`
  for the albums that viewer can open: for anyone but the owner, only `public`
  albums with at least one photo they can see, every number computed from the
  photos they can see, in last-updated order. For anyone but the owner an album's
  `createdAt` and `updatedAt` are not the stored times (which move whenever the
  owner adds or removes any photo, visible or not) but when the first and the
  latest photo that viewer can see joined the album, and the list order uses the
  latter. The album returns `album`, `facts`, `species` and a page
  of `items` with `nextMaxId` (`?max_id&limit&sort&subject`; `limit` 1 to 60,
  default 24, clamped; a bad `max_id`, `sort` or `subject` is a 422). A private
  album, a missing one, another account's, and one with no photo the viewer can
  see are all the same 404, answered before the query is checked, and so is a
  missing or remote account. `place` on an item is exactly `getPublicPlace`;
  `coverMediaId` is null and `hiddenPlaceCount` 0 for everyone but the owner,
  and no IUCN or lookup field is ever sent. Reads are limited to 300 per viewer
  per minute (429, in process): a signed-in viewer by actor, a logged-out one
  by client address only when `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is on, and
  otherwise not limited here.

- **`GET /api/v1/media/:id/albums`** — owner-only, non-Mastodon, for the add to
  album menu (taking `read` or `read:statuses`, or the web session). It answers
  `albums` (every album of the caller, last updated first, each with `id`,
  `title`, `visibility` and the `itemCount` the owner sees), `albumIds` (the
  ones that hold this photo) and `addable` (the owner's posted or Gallery-added
  media, whatever its gallery switch, or a pending upload; a photo that cannot
  be added can still be taken out). Media that does not exist and media that is
  somebody else's both answer 404. Adding and removing use the album `items` routes above.

- **`POST /api/v1/gallery/albums/membership`** — owner-only, non-Mastodon, taking
  `read` or `read:statuses` (or the web session). Body: `{ media_ids: [...] }`
  (1–100 `media_ids`, 422 otherwise); answers `albums: [{ id, mediaIds }]` for
  the caller's albums only that hold at least one of the ids. Not rate limited.

- **Gallery album suggestions** — owner-only, non-Mastodon, computed on demand and
  never stored; they take `read` or `read:statuses` (or the web session).
  `GET /api/v1/gallery/albums/suggestions?time_zone=` (an IANA zone name; the day of an
  activity is read in it, default `UTC`; 422 otherwise. A photo's day is its UTC
  date, as an album shows it, and a photo day matches an activity on that date, or, when
  none is on it, on the zone's date of any of its photos) returns `suggestions`, most
  recent first, each with `id`, `kind` (`trip`, `species` or `activity_day`),
  `title`, `photoCount`, `firstAt`, `lastAt`, `preview`, `mediaIds` (at most
  2,000, newest first) and `truncated`, `placeCount`, `speciesCount` and
  `activityCount`. A title speaks only for the photos a visitor could see and names a
  place only when all of them show that one place, so a hidden location, a
  threatened species or a trip through several places never appears in it; with
  no such photo it is a generic "Trip", "Species series" or "Day out", and
  "Activity day" appears only when one of the day's activities is on a post a
  visitor can read. A suggestion an existing album already holds in full (the
  `mediaIds` it offers) is left out.
  `GET /api/v1/gallery/albums/suggestions/media?media_ids=1,2,3` (1 to 100 ids)
  returns `items`, the owner's gallery photos in the order asked, leaving out
  any that are not. Reads are limited to 20 (suggestions) and 120 (photos) per
  actor per minute (429, in process).

### Fitness

- **Fitness tracking** — `/api/v1/fitness/*` (general settings, `.fit`/`.gpx`/`.tcx`
  imports, Strava sync) plus per-account fitness summaries, calendars, activity
  types, and route heatmaps under `/api/v1/accounts/:id/fitness-*`.
  `POST /api/v1/statuses` also accepts an optional `fitness_file_id` (JSON or
  form field) for note statuses, linking an uploaded fitness file owned by the
  caller to the newly created status and queuing `ProcessFitnessFileJob` (it
  answers `422` when combined with `poll`, when the file does not exist or
  belongs to another actor, or when the file is already attached to a status),
  and the serialized Mastodon `Status` entity includes an optional `fitness`
  object (`StatusFitnessFile`) when a fitness file is attached. The web composer
  (`createNote` and `createPoll` in `lib/client/statuses.ts`) posts through
  `POST /api/v1/statuses` using these extensions alongside `quoted_status_id`,
  `quote_approval_policy`, and `Idempotency-Key`; the legacy
  `POST /api/v1/accounts/outbox` route is kept for backward compatibility.

### Emoji reactions

- **Status emoji reactions** — a Misskey/Pleroma-style reaction store that is
  deliberately **separate from favourites**. Every serialized `Status` carries
  the same rollups under both ecosystem names — `pleroma.emoji_reactions`
  (Pleroma/Akkoma, what Husky and the Megalodon-family clients read) and
  `reactions` (the glitch-soc dialect) — each entry being
  `{name, count, me, url, static_url}`. `name` is a unicode emoji, a local
  custom-emoji shortcode, or `shortcode@domain` for a remote custom emoji.
  Reactions arrive as their own notification type, `pleroma:emoji_reaction`,
  which carries an extra `emoji` field; `types[]`/`exclude_types[]` accept that
  name. None of this is core Mastodon API, and vanilla clients ignore all of it.
  The write endpoints are the Pleroma/Akkoma dialect, with the glitch-soc pair
  as thin aliases over the same service and store, so the two can never
  disagree. All take `write` or `write:favourites`; the reads take `read` or
  `read:statuses` and accept anonymous callers (`me` is then always false):

  | Endpoint                                                     | Dialect           |
  | ------------------------------------------------------------ | ----------------- |
  | `PUT`/`DELETE /api/v1/pleroma/statuses/:id/reactions/:emoji` | Pleroma (primary) |
  | `GET /api/v1/pleroma/statuses/:id/reactions`                 | Pleroma           |
  | `GET /api/v1/pleroma/statuses/:id/reactions/:emoji`          | Pleroma           |
  | `POST /api/v1/statuses/:id/react/:name`                      | glitch-soc        |
  | `POST /api/v1/statuses/:id/unreact/:name`                    | glitch-soc        |

  The write endpoints return the affected `Status`; the reads return
  `{name, count, me, url, static_url, accounts}` in first-reaction order. A
  reaction this instance originates must be a **single emoji grapheme** or a
  shortcode naming an enabled local custom emoji — anything else is `422`. That
  is stricter than what is accepted inbound, deliberately: we have to be able to
  render and federate what we send.

  Inbound federation accepts both dialects at the per-user **and** shared
  inboxes: the litepub `EmojiReact` of FEP-c0e0 and a Misskey-style `Like`
  carrying `content`/`_misskey_reaction`, plus the `Undo` of either. A **plain**
  `Like` (no reaction content) remains an ordinary favourite at both inboxes:
  the shared inbox routes it, and its `Undo`, to `LikeJob`, which applies the
  same `likeRequest`/`deleteLike` as the personal inbox. It keeps only likes of
  local statuses, binds the Like's actor to the verified signer, and is
  idempotent (a Like delivered to both inboxes is stored once and notifies
  once). A group's `Announce(Like)` (Lemmy) is still dropped.

  **Inbound `Flag` (a report another server forwards) is a local report.**
  Both inboxes route a `Flag` to `ReceiveFlagJob` (`lib/jobs/receiveFlagJob.ts`),
  which mirrors Mastodon's `ActivityPub::Activity::Flag`. The `Flag`'s `actor`
  must be the verified signer (Mastodon signs with its instance actor, an
  `Application`, so the reporter is an actor row, not a person). `object` is one
  id or an array. The local accounts it names are reported: one report is filed
  per LOCAL account (up to 20), skipping suspended ones as Mastodon does, and
  each report keeps only the LOCAL statuses owned by that account. A `Flag`
  naming no local account is ignored; Mastodon also accepts reports about
  remote accounts whose posts reply to local accounts, this server does not.
  Lemmy `Flag`s name only posts and communities, so they never match. A
  reporter whose domain has a domain block with `reject_reports` is ignored,
  whatever the block's severity. The report is stored through `createReport`
  with the sending actor as reporter, category `other`, the reported profile's
  domain in `reports.domain` and the `content`
  (capped at 5000 characters, as Mastodon does) as the comment, so it appears
  in `/api/v1/admin/reports` and the admin reports queue like any other. The
  reports table has no origin column: a report whose reporter is a remote actor
  is a forwarded one. There is no notification or push alert for new reports of
  either origin. Redelivery is absorbed by the queue job id (derived from the
  `Flag`'s id) and by skipping an unresolved report with the same reporter,
  target, comment and statuses, so identical reports from one server collapse
  into one while the first is unresolved (a deliberate deviation: Mastodon
  would file each). A `Flag` delivered by
  inbox forwarding (signer is not the actor) is dropped.

  **Outbound, a reaction is emitted as a Misskey-style `Like`** — the emoji on
  both `content` and `_misskey_reaction`, plus an `Emoji` tag for a custom one —
  because that is the only spelling every server family renders something for.
  The consequence is worth stating plainly: **on vanilla Mastodon your reaction
  arrives as a favourite.** Mastodon has no `EmojiReact` handler at all and
  drops that activity silently, while its `Like` handler ignores `content`, so a
  visible favourite is strictly better than nothing. On the Misskey family a
  favourite arrives as a `❤` reaction and a later reaction replaces it (their
  one-per-user rule). Reacting never favourites the post locally.

  Removal is where the single-shape compromise bites. A reaction-native
  receiver (Misskey family, Pleroma/Akkoma, another Activity.next) resolves the
  `Undo` by reaction content and removes exactly that emoji. Vanilla Mastodon
  resolves `Undo{Like}` by _(account, status)_ against the one favourite our
  reaction degraded into, so it can also clear a genuine favourite or the
  stand-in for another of your reactions. The `Undo` is sent regardless: the
  Mastodon-side effect is cosmetic on a server that never rendered the reaction
  and is recoverable by re-favouriting, whereas withholding it would leave the
  reaction stuck visible forever on exactly the servers that do render it.

  Reacting to a boost applies the reaction to the **boosted post**, matching how
  the rollups are serialized (an `Announce` wrapper reports no reactions of its
  own; they appear on `reblog`). A reaction past the per-actor cap of 8 answers
  `422` rather than a 200 that silently stored nothing.

  Known limitation: reactions are capped at 8 distinct emoji per actor per
  status, but the number of _distinct_ emoji on a status is not capped, and the
  rollups are serialized in full (twice — once per dialect) on every status.
  A federating peer with many actors can therefore inflate the size of a status
  entity. Storage is unaffected; the cost is response size. A per-status cap is
  deliberately out of scope — treat an abusive peer as a moderation/defederation
  matter for now.

### Quotes

- **Hosted quote-authorization stamps** — `GET /users/:username/quote_authorizations/:id`
  serves the FEP-044f `QuoteAuthorization` object for an approved quote; it 404s
  once the quote is revoked (the edge is no longer `accepted`).

### Multi-actor & account management

- **Multi-actor management** — `/api/v1/actors` and friends (`switch`, `default`,
  `domains`, `delete`, `cancel-deletion`) let one account own multiple actors.

- **Remote-follow resolution** — `GET /api/v1/remote-follow?account=…&target=…`
  resolves where to send a logged-out visitor so they can follow a local account
  (`target`, a local `user@domain`) from their own server (`account`, their
  handle or bare domain). It answers `{ "url": "…" }` built from the remote
  server's advertised `http://ostatus.org/schema/1.0/subscribe` template,
  falling back to Mastodon's conventional `/authorize_interaction?uri={uri}`
  path when that server advertises none. Deliberately unauthenticated — the
  feature exists for visitors with no account here — and read-only; `target`
  must name an actor this instance hosts. The inbound half is the
  Mastodon-compatible `/authorize_interaction` **page** (not an API endpoint),
  which this instance advertises in its own WebFinger document.

- **Remote statuses** — `/api/v1/accounts/:id/remote-statuses` exposes cached
  remote posts for an actor.

- **Remote follow lists are read live from the remote collections.** Mastodon
  answers `GET /api/v1/accounts/:id/followers` and `/following` for a remote
  account from the relationships it already knows about, so a small instance
  shows one local follower and nothing followed. For a remote actor these two
  routes instead read the actor's own `followers`/`following` ActivityPub
  collections (`lib/services/mastodon/remoteFollowCollection.ts`), signed by
  the federation signing actor when one is available, and serialize each listed
  actor as an Account entity. The remote page URLs ride in the Mastodon
  cursors — the Link header's `max_id` carries the page's `next` and `min_id` its
  `prev` — so an unmodified client paginates by sending them back. When the
  remote is consulted, a URL cursor is accepted only for a page of that actor's
  collection and is a `400` otherwise; `limit` is echoed in the Link header but
  the page size is the remote server's, capped at 80. Only a signed-in viewer
  triggers the remote read: an anonymous caller, a blocked domain, an unreachable
  server or actor document, a page in a shape the reader does not handle, and a
  hidden collection (Mastodon's "hide your social graph", which publishes a size
  but no page) all fall back to the locally-known rows, so the old behaviour is
  the floor — and on that fallback a URL cursor is ignored and the first local
  page served. Each page resolves at most 20 actors this instance has never
  stored (five at a time, each a `recordActorIfNeeded`) and drops the rest of
  that page's unknowns; a resolved page is cached for 60 seconds per actor,
  field and page, with concurrent misses sharing one fetch. The cache bounds
  repeat opens only, since a page URL is client-chosen; a cap of four uncached
  remote reads in flight per database instance (one per process today) is what
  bounds a flood, answering the local rows past it. Activity.next's own
  ActivityPub `followers` and `following` collections still publish only
  `totalItems`, so another Activity.next instance cannot list this instance's
  users this way yet.

### Account archives

- **Account archive export** — `POST`/`GET /api/v1/account/archives` request and
  list the signed-in account's data exports, and
  `GET /api/v1/account/archives/:id/download` streams (or, on object storage,
  redirects to a short-lived signed URL for) a finished one. These are **not** a
  Mastodon API: Mastodon has no archive endpoint (its export is a web-UI
  action), so no client is expected to call them, they use the web session, not
  an OAuth scope, and they answer `404` to anyone but the owning account. The
  archive's top level follows Mastodon's export (`actor.json`, `outbox.json`,
  `likes.json`, `bookmarks.json`, media files), so a Mastodon-format importer
  can read it; everything else lives under `activities.next/`. Mastodon's
  limit is one request per 6 days in code and 7 in its documentation; this
  server uses 7. `POST` answers `429` with `nextAllowedAt` and a `Retry-After`
  header both while an export is running and inside the 7 days. The web client
  names the actor it loaded the page as — the `actorId` query parameter on
  `GET`, the `actorId` JSON field on `POST`; when it differs from the
  signed-in actor, both answer `409` `{ "error": "Actor changed" }` before
  anything is read or written, and a request without `actorId` (an API
  client's) keeps working. See [Account data export](architecture.md#account-data-export).

- **Account archive import** — These routes, which back Account & security →
  Import and export (`/account/import-export`), use the signed-in web session
  and bind every import to the current actor; they do not use an
  OAuth scope. Error JSON has Mastodon's `{ "error": "…" }` shape. `OPTIONS`
  preflight on each route returns `200` with CORS headers. The shared
  `AuthenticatedGuard` returns `403` for missing same-origin proof, suspended
  or disabled actors, or unconfirmed accounts; without a session it redirects
  with `303` for browser navigation and `307` otherwise. These preflight and
  session-guard responses apply to every route; the table lists each method's
  own responses as well.

  | Method and route                         | Request                                                                            | Success response                                                                             | Other route statuses                                   |
  | ---------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
  | `GET /api/v1/account/imports`            | Optional `actorId` query parameter                                                 | `200`: array of at most 20 import objects                                                    | `403`, `404`, `409`                                    |
  | `POST /api/v1/account/imports`           | Optional `actorId` query parameter; raw ZIP body                                   | `202`: import object                                                                         | `400`, `403`, `404`, `409`, `413`, `422`, `503`        |
  | `POST /api/v1/account/imports/presigned` | Required JSON `size` (positive safe integer); optional `actorId` in query or JSON  | `202`: import object plus `uploadUrl: string \| null` and `directUploadPath: string \| null` | `400`, `403`, `404`, `409`, `413`, `422`, `503`        |
  | `GET /api/v1/account/imports/:id`        | Optional `actorId` query parameter                                                 | `200`: import object, plus `report` when the import is `done`, `failed` or `cancelled`       | `403`, `404`, `409`                                    |
  | `POST /api/v1/account/imports/:id`       | Optional `actorId` query parameter; raw ZIP body                                   | `202`: import object                                                                         | `400`, `403`, `404`, `409`, `413`, `422`, `503`        |
  | `POST /api/v1/account/imports/:id/start` | JSON `{ "actorId"?: string, "options"?: ImportOptions }`; optional `actorId` query | `202`: import object                                                                         | `400`, `403`, `404`, `409`, `413`, `422`, `429`, `503` |
  | `DELETE /api/v1/account/imports/:id`     | Optional `actorId` query parameter                                                 | `202`: import object with `status: "cancelled"`                                              | `403`, `404`, `409`                                    |

  `options` accepts the `likes`, `bookmarks`, `profile` and `settings` boolean
  fields, plus `repliesToOthers` (`"skip"` or `"keep"`). The boolean fields
  default to `false`; `repliesToOthers` defaults to `"skip"`. Unknown option
  keys are stripped. Each import object contains
  `id`, `status`, `kind`, `phase`, `progress`, `createdAt`, `startedAt`,
  `finishedAt` and `lastErrorCode`. `progress` contains source actor/followers
  identifiers, status order, catalog stage/index, total/completed/skipped item
  counts and, after start, the selected options; when the profile option
  skipped the avatar or header, it also carries `profileImageSkips`
  (`media_quota_exceeded` or `media_invalid`). It does not expose upload
  tokens or lease data. `GET /api/v1/account/imports/:id` adds a `report`
  field, but only once the import is `done`, `failed` or `cancelled` — never
  while it is `queued` or `running`, and never in the list route's objects.
  `report` groups the import's catalog items by outcome: `done` counts by
  item kind, `skipped` and `failed` count by reason code (`unknown` for a
  row without one), each as `{ [kind or reason]: count }`.

  The presigned request requires `size` because the S3 PUT URL signs that exact
  content length and expires after 15 minutes. When storage cannot provide a
  presigned URL—local-file storage or an S3 upload over 5 GiB—`uploadUrl` is
  `null` and `directUploadPath` names the import's streamed upload route.

  Each route checks the optional `Activities-Expected-Actor` header and returns
  `409` when it names another actor. A mismatched `actorId` query/body value is
  also `409`. Other `409`s indicate an active import, an import that is not
  queued, an existing upload, a finished cancellation, an incomplete upload at
  start (a missing or empty stored object, or a mismatch between its stored
  size and the declared size) or an archive change detected during start.
  `413` means an upload exceeds the configured size. `422` means a
  moved/deleting actor, unsupported archive or invalid start options; `429` is
  the per-account start limit and includes `Retry-After`. `400` covers
  malformed request JSON, an invalid presigned `size` field or a missing
  streamed upload body. An unsupported or malformed ZIP is rejected with `422`
  at start. `503` covers unavailable storage, upload signing or queueing. See
  [Account data import](architecture.md#account-data-import).

### Observability

- **Browser Web Vitals** — `POST /api/v1/web-vitals` takes a same-origin,
  sampled report of LCP, CLS and INP from this app's own pages and writes it to
  the server log; it is off (404) unless `ACTIVITIES_WEB_VITALS_SAMPLE_RATE` is
  above zero. See [Browser Web Vitals](architecture.md#browser-web-vitals).

### Admin & per-domain settings

- **Admin CRUD extras** — custom emoji, domain allow/deny lists (with import),
  announcements, filters, and rules management under `/api/v1/admin/*` and
  `/api/v2/admin/*`.

- **Rules, announcements and reports per served domain** — Mastodon has one
  list of each per server; with several served domains each can be scoped.
  `instance_rules.domain` and `announcements.domain` are nullable, null meaning
  every domain (a server rule, an announcement for all). On the visited host
  (`headerHost`), `GET /api/v1/instance/rules` and the `rules` of
  `GET /api/v1/instance` and `GET /api/v2/instance` return the server rules
  followed by that domain's own rules (the primary and an unknown host get the
  server rules only; ids are unique, one table), `GET /api/v1/announcements`
  returns the every-domain announcements plus the visited host's, and
  `POST /api/v1/reports` answers
  `422 { "error": "Validation failed: Rule ids does not reference valid rules" }`
  for a `rule_ids` entry that is not visible on that host; citing rules makes
  the report a `violation`, as Mastodon's
  ReportService does.
  A report stores `reports.domain`, the domain of the reported profile (the host
  of its actor id, also for a forwarded `Flag`); the migration backfilled it.
  Admin: `GET /api/v2/admin/rules` lists one scope (no `domain`: the server
  rules; `?domain=<served domain>`: that domain's own rules), `POST` takes
  `domain` (null/absent: a server rule), a rule keeps its domain, reordering is
  a `position` update within its scope, and the primary domain has no rules of
  its own (`422`, `code: primary`; `unknown` and `invalid` for other refusals).
  `POST`/`PATCH /api/v2/admin/announcements` take `domain` (null: every domain;
  any served domain, the primary included) and `GET` takes `?domain=` to list
  one domain's own announcements. `GET /api/v1/admin/reports` takes `domain`
  (reports about profiles on that served domain, kept in the `Link` pagination
  URLs) and every Admin::Report carries `domain`. Moderators and the report
  queue stay server-wide, and a moderator may set any rule on a report (admin
  `PUT /api/v1/admin/reports/:id`, which still answers "Unknown rule id").

- **Per-domain feature switches** — `GET`/`PATCH /api/v1/admin/domains/:domain`
  carry `disabledFeatures` (a list of `fitness`, `explore`, `messages`; `[]` or
  null for none; the primary is refused with `422`, `code: primary`). A feature
  is on for a visitor when the server switch (Admin › Server settings) is on and the
  visited domain does not list it. Like the server switches it only changes
  navigation and the bootstrap `features`, never routes.

The standard Mastodon **admin moderation** cluster is implemented:
`GET /api/v1/admin/accounts`, `GET /api/v2/admin/accounts`,
`GET /api/v1/admin/accounts/:id`, `POST /api/v1/admin/accounts/:id/action`, the
`approve`/`reject`/`enable`/`unsilence`/`unsuspend`/`unsensitive` state actions,
`DELETE /api/v1/admin/accounts/:id` (suspended-first), and the reports API
(`GET`/`PUT /api/v1/admin/reports[/:id]`, `assign_to_self`/`unassign`/`resolve`/
`reopen`). See the admin id-space divergence above. `warning_preset_id` and
`send_email_notification` on the account action endpoint are accepted and
ignored (no moderation-mail/presets subsystems).

---

## Contributor rules

Read the applicable rules and review checks below before changing this subsystem. The mandatory workflow remains in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

- [Client-Facing Entity IDs](#agents-client-facing-entity-ids)
- [Zod Validation in API Routes](#agents-zod-validation-in-api-routes)
- [ActivityPub & JSON-LD](#agents-activitypub-json-ld)
- [A Fetched Document's Own id Is Not Evidence](#agents-a-fetched-document-s-own-id-is-not-evidence)
- [Actor Usernames Are Case-Insensitive](#agents-actor-usernames-are-case-insensitive)
- [Status Posts & Actions](#agents-status-posts-actions)
- [Local Usernames Are Actor-Id Path Segments](#agents-local-usernames-are-actor-id-path-segments)
- [Local Actors ("does this server host this actor?")](#agents-local-actors-does-this-server-host-this-actor)
- [Who May See an Actor's Statuses](#agents-who-may-see-an-actor-s-statuses)
- [Publicly Readable Status Ids](#agents-publicly-readable-status-ids)

<a id="agents-client-facing-entity-ids"></a>
<a id="review-mastodon-and-fediverse-interoperability-quirks"></a>

### Client-Facing Entity IDs

- **An id that leaves the server is the `publicId`, and it is produced by `getClientStatusId` / `getClientActorId` (`@/lib/utils/publicId`) — never by `urlToId(status.id)`.** Statuses and actors are addressed internally by their ActivityPub URI, but the Mastodon API and the web status path emit the row's UUIDv7 `publicId`; the two helpers wrap the "publicId, else the legacy encoding" fallback that pre-backfill rows and unstored remote actors still need. A new serializer that reaches for `urlToId` regresses that one field to the legacy shape while every sibling field emits a UUID — the kind of bug no single response looks wrong enough to reveal.
- **`account.url` / `account.uri` carry the full Actor URI (e.g. `https://domain/users/username`), while `account.id` is the opaque client-facing identifier; `status.id` / `status.uri` split the same way.** The id and the URI are different things and neither is derivable from the other: do not replace `account.url` with `account.id` for Actor URI lookups (that causes 404s in follow request routes), and do not "simplify" an id-accepting route into taking a URI.
- **Emission is narrow, acceptance is permanent.** Every id form the instance ever handed out still resolves on input, and for status and actor ids there are exactly two boundaries that do it: `lib/services/mastodon/resolveClientId.ts` for the API (`resolveStatusIdParam`/`resolveActorIdParam` and their batch `…Params` forms — `publicId`, colon-encoded, `apurl_`, raw ActivityPub URI) and `app/(timeline)/[actor]/[status]/resolveStatusFromPath.ts` for the web status page (`publicId`, sha256 URL hash, percent-encoded remote URI, bare local status-id tail). A new id-accepting route goes through them instead of calling `idToUrl` itself, and the legacy branches are never pruned — cached client ids and old links depend on them indefinitely.
- **A media attachment has TWO client-visible ids, and the status edit route accepts both.** `POST /api/v2/media` answers with the numeric `medias` row id; a status's `media_attachments[].id` is the attachment row's own UUID. Mastodon has one id where this instance has two, so a client that only ever saw the status — a focal-point drag in Elk or Ivory — can only send the UUID, which `toMediaRowId` rejects outright, and `PUT /api/v1/statuses/:id` answered 422 for every third-party media edit. `resolveStatusAttachmentMediaIds` (`lib/services/statuses/mediaIds.ts`) is that third acceptance boundary, mapping the UUID through the status's own attachments before either `media_ids` or `media_attributes[][id]` reaches a media path; an id that is already a media id passes through untouched. It lives beside the other media-id helpers rather than in `resolveClientId.ts` because it resolves a different id space against one status. **The UUID branch is permanent** — it is what every already-published status hands back. Only this route can do it: `POST /api/v1/statuses` (delete-and-redraft) has no status left to resolve against, which is why redraft still needs the upload id. Note this is the one place a media id legitimately arrives non-numeric; every comparison against `medias.id` still goes through `toMediaRowId` (see **Database Compatibility Guidelines** in `docs/maintenance.md`).
- **An attachment the Mastodon serializer cannot describe is `type: "unknown"`, never `null` — a `null` took the entire status off the API.** `getMastodonAttachment` covers image, video, and animated `gifv` attachments; an unresolvable clip or an `audio/mp4` upload (an accepted type) without stored duration falls back to `unknown`. Returning `null` was not a degraded entry, it was a fatal one: `media_attachments` is `MediaAttachment.array()`, so `getMastodonStatus`'s closing `Mastodon.Status.parse` threw, `getMastodonStatuses` caught it and dropped the status from the page as "un-hydratable", and a single-status GET errored — the post becomes invisible to every Mastodon client while the web UI still shows it. `unknown` carries the id, url, description and blurhash without claiming dimensions the row does not have. The id matters too: an attachment a client cannot name is one an edit cannot preserve.
- **`lib/client.ts` never re-encodes an id — it sends back exactly what it was handed.** Because the accept side takes all three forms, encoding on the way out buys nothing for a legacy id or a raw URI and actively corrupts a `publicId`: `urlToId` parses a bare UUIDv7 as a URL host and returns it with a trailing colon, a value `isPublicId` rejects and `idToUrl` mangles, so no resolver can reach the row. Ids in a query param or a JSON body go out verbatim; the only transformation left is `toIdPathSegment` (`@/lib/utils/urlToId`) for an id going into a URL **path** segment, and it fires solely for a raw AP URI, whose slashes would otherwise split the route.
- **A pagination cursor is an entity id, so it flips with the entity.** A `max_id`/`min_id`/`since_id` value the client sends back must be the value it was shown, which is why status cursors go through `getClientStatusCursors` (`lib/services/mastodon/clientCursor.ts` — it resolves off-page boundary statuses in one batched query) and admin account cursors through `getClientActorId`.
- **Never join two serialized payloads on an id; join on the ActivityPub URI.** The URI is stable and encoding-independent, while an id's shape depends on whether that row has a `publicId`. `serializeAdminReports` keys its status map on `status.uri` for exactly this reason.
- **Resolving a batch of ids is one query, not one per id.** Use the `…Params`/`getActorPublicIds`/`getStatusPublicIds` batch forms when serializing or accepting a whole page, never a `map` of point lookups.
- Background: [Architecture → Public Identifiers](architecture.md#public-identifiers) and the [Public ID Backfill](maintenance.md#public-id-backfill) note.

<a id="agents-zod-validation-in-api-routes"></a>
<a id="review-api-routes"></a>

### Zod Validation in API Routes

- **Always use `safeParse`**, never `.parse()`, in API route handlers. `.parse()` throws an unhandled `ZodError` that propagates as a 500; `safeParse` lets you return a proper 4xx response.
- For string columns with a database size limit (e.g. `varchar(255)`), add a matching `.max(255)` constraint in the Zod schema to prevent runtime DB errors.
- When a text column is nullable, use `.transform((v) => v || null)` to convert empty/whitespace-only strings to `null`. Keep this normalization consistent between create and update paths. On a PATCH field where `undefined` means "leave unchanged" and `null` means "clear the column", never place `.nullish()` before `.transform((v) => v || null)` — it collapses `undefined` (omitted) into `null` (explicit clear) and wipes the column whenever the caller omits the key.

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

- **Responses go through `apiResponse` / `apiErrorResponse` from
  `@/lib/utils/response` — never `Response.json()`.** On CORS-enabled routes
  (those exporting `OPTIONS`), use `apiResponse` even for errors so CORS headers
  are sent; reserve `apiErrorResponse` for non-CORS routes or middleware. A
  route consumed only by the internal web client (via `lib/client.ts`) needs no
  `OPTIONS` handler or CORS preflight, even with `allowedMethods`.
- **Error bodies use Mastodon's `{ error: 'message' }` shape, never
  `{ status: … }`.** The shared `apiErrorResponse` / `apiCorsError` / `codeMap`
  helpers already emit `{ error }`; an inline error body must too
  (`data: { error: '…' }`). Mastodon clients read the message from `error`, so a
  `{ status: … }` body breaks them. Only success acks
  (`DEFAULT_200`/`DEFAULT_202`) keep `{ status: … }`.
- **State-changing routes (POST/PUT/PATCH/DELETE) that authenticate a cookie
  session manually — rather than through the standard guards — explicitly
  verify same-origin proof via `hasSameOriginProof`
  (`lib/services/guards/sameOriginProof`) to block CSRF.** The shared guards
  (`AuthenticatedGuard`, `AdminApiGuard`, …) already enforce this.
- **Fetch and apply the actor's active content filters even for unauthenticated
  requests (`getActiveFiltersForActor`)**, so timeline and detail/context views
  filter consistently.
- **Don't case-normalize identity fields (e.g. lowercasing an email) in a
  single endpoint while the rest of the stack treats them case-sensitively** —
  a partial change splits lookups. Case-handling must be holistic across the
  codebase.
- **Mastodon-compat mutation responses return the affected entity even when the
  actor can't otherwise read it** — e.g. removing a bookmark from a
  now-unreadable status still returns the full `Status` with
  `bookmarked: false`, not a redacted one.

<a id="agents-activitypub-json-ld"></a>

### ActivityPub & JSON-LD

ActivityPub objects are **JSON-LD**, so the same logical object can arrive in many shapes (`type` as a string, array, CURIE, or full IRI; recipients as a single value or an array; id references inline or as nested objects; varied `@context` orderings and extension vocabularies). Do **not** lock the wire format to a single shape with strict schemas — be liberal in what you accept and canonical in what you emit.

- **Canonicalise every inbound ActivityPub document with `compactActivityPub` from `@/lib/activities/jsonld` before validating or processing it.** It runs the real `jsonld` processor, compacting against one canonical context so downstream code (and the Zod schemas) can rely on a predictable shape: bare `type` terms, id references as strings, and `to`/`cc`/`tag`/`attachment` always arrays. **Any new entry point that parses an untrusted remote AP note/activity/actor MUST compact first.** Already wired: the shared inbox (`app/api/inbox/route.ts`), the per-user inbox (`app/api/users/[username]/inbox/route.ts`), `getActorPerson`, `getActorPosts`, and `getNote` (so `getRemoteStatus` and boosted-note resolution inherit it). `compactActivityPub` is generic (`<T>(input: T) => Promise<T>`), preserves the document's logical shape, and falls back to the raw input on any processing error. `getActorPosts` hands each outbox item its own copy of the page's `@context` before compacting it, so it truncates a page to `MAX_OUTBOX_PAGE_ITEMS`, refuses a page whose context exceeds `MAX_INHERITED_CONTEXT_ENTRIES` (`lib/activities/inheritActivityPubContext.ts`), and resolves items a few at a time — otherwise an O(entries + items) response costs O(entries × items) in allocations and JSON-LD work.
- **The processor must never dereference remote `@context` URLs at runtime** (SSRF/DoS vector). Contexts are bundled as committed offline assets under `lib/activities/jsonld/contexts/` and served by `offlineDocumentLoader`; unknown context URLs resolve to an empty context (their terms simply drop). Add new contexts as bundled assets, never as network fetches. `jsonld` (via `rdf-canonize`) is a heavy, Node-only dependency that breaks under jsdom, so it is imported **lazily** inside `compactActivityPub` — keep it that way so it never enters component/jsdom test module graphs.
- **Extension `type`s that are not defined in the bundled ActivityStreams context must be aliased in `CANONICAL_CONTEXT`**, otherwise compaction emits a CURIE (e.g. `toot:Emoji`, `as:Hashtag`, `schema:PropertyValue`) that the strict `type` validators then drop. `Emoji`, `Hashtag`, `PropertyValue`, `QuoteRequest`, `QuoteAuthorization`, and `EmojiReact` are the currently-aliased ones (all other matched AS2 types are already in the bundled context). If you start matching on a new non-AS2 `type`, add its alias **and a regression test** asserting it survives compaction as a bare term.
- **A term this instance WRITES onto a Note must be declared in the context it sends, not only
  aliased inbound.** `CANONICAL_CONTEXT` governs what we accept; `NOTE_ACTIVITY_CONTEXT`
  (`lib/activities/noteContext.ts`) is what we emit. This is the outbound mirror of the aliasing
  rule above and it fails the same silent way: JSON-LD is context-driven, so a term the document
  never defines expands to a blank node and `stripJsonLdArtifacts` deletes it. The note keeps its
  content and quietly loses the rest — no error, no build warning, and no test failure, because
  every result-based assertion still passes. Mastodon reads the JSON without processing it; a
  conformant receiver — GoToSocial, or another activities.next, whose inbox runs
  `compactActivityPub` — silently loses the terms.
  - **Seven surfaces carry a Note and all seven send `NOTE_ACTIVITY_CONTEXT`:** `sendNote`'s Create,
    `sendUpdateNote`'s Update, `sendQuoteRequest`'s `instrument`, the AP status GET, the `/replies`
    collection, the user outbox page, and the `outbox.json` writer in
    `scripts/backup/actorArchive.ts`. It supersets `QUOTE_ACTIVITY_CONTEXT`, so a surface on it also
    satisfies the quote vocabulary's own requirement; the other quote activities
    (Accept/Reject/Delete) echo ids rather than Notes and keep the narrower one. The archive's
    likes/bookmarks collections share the outbox writer but hold bare ids, so the extra definitions
    are inert there.
  - **Both emitters build these fields through `lib/activities/quoteNoteFields.ts` and emit
    `interactionPolicy` and the quote aliases unconditionally** — `getNoteFromStatus` for delivery,
    `toActivityPubObject` for fetch — so the rule binds every note-carrying surface, quote post or
    not.
  - The same module's `addQuoteFallbackToContent` prepends Mastodon's legacy quote fallback — `<p
class="quote-inline">RE: <a href="…">…</a></p>` — to both emitters' `content` and the Mastodon
    API status/edit serializers on a live (pending/accepted) edge, preferring the original status
    web url over the bare ActivityPub id, skipped when the content already carries the quoted url or
    id; it is plain HTML rather than a JSON-LD term, so no context entry is involved, and it is
    never stored into `status.text`, and `post.tsx` hides the `quote-inline` marker whenever it
    renders a quote card (see [Link Preview Cards](architecture.md#agents-link-preview-cards) for
    the sanitizer/extractor half).
  - `interactionPolicy` arrives through a spread (`getInteractionPolicyFields`), so grepping for the
    literal key finds nothing: check the spreads.
  - The only asymmetry left is `votersCount`, which `toActivityPubObject` emits on a poll Question
    while `getNoteFromStatus` returns null for Polls entirely. Both also carry an attachment's
    `blurhash`/`focalPoint` and the `Hashtag`/`Emoji` tag TYPES, none of which the bundled
    ActivityStreams context defines. `focalPoint` needs `"@container": "@list"` or a processor is
    free to reorder the `[x, y]` pair.
  - One caveat on the outbox page: its context sits on the `OrderedCollectionPage`, so embedded
    Notes inherit it only from a receiver that processes the page as one document — and OUR reader
    does not, `getActorPosts` compacting each `orderedItems` entry on its own. That is a
    pre-existing limitation of the reader, not of the emitted page.
  - Each surface is pinned by a `@context` assertion (`lib/activities/index.test.ts`,
    `sendUpdateNoteJob.test.ts`, the three route tests, and `scripts/backup/actorArchive.test.ts`)
    because a revert is invisible in results; `lib/activities/quoteNoteFields.test.ts` and
    `lib/activities/jsonld/index.test.ts` prove the round trip. The tag TYPES are the exception a
    round trip cannot cover — `stripJsonLdArtifacts` recovers a blank-node `type`, so our own reader
    keeps them either way; they are pinned by asserting the context declares each under the IRI we
    accept it as.
- **An alias in `CANONICAL_CONTEXT` only helps when the _sender_ defines the term too.** `CANONICAL_CONTEXT` is the context compaction targets; expansion still uses the document's own `@context`, and the bundled ActivityStreams context sets `"@vocab": "_:"`, so a term the sender never defines expands to a blank node — which `stripJsonLdArtifacts` recovers for `type` values but **deletes** for property keys. For terms peers commonly emit undefined (Misskey's `_misskey_reaction`) or declare in a vocabulary the offline loader cannot resolve (litepub's `EmojiReact`, FEP-2c59's actor `webfinger`, which Mastodon and WordPress declare by the socialweb context URL), also add them to `EXTENSION_TERM_FALLBACK_CONTEXT`, which `normalizeInputContext` prepends to every inbound document as the lowest-precedence entry — so a sender that does define the term still wins. This is the same trick that keeps litepub actors' `publicKey` readable via the `security/v1` fallback.
- **Keep the Zod schemas liberal, not strict.** Model only the fields you consume; never `.strict()`; tolerate unknown tag/attachment kinds via the `z.looseObject({})` fallback in the `Tag`/`Attachment` unions (`z.looseObject` is valid Zod v4 — see `lib/types/activitypub/actor.ts`); never Zod-validate `@context`. Narrow loose values back to fully-valid known shapes at the consumption boundary with `safeParse` (e.g. `getTags`/`getAttachments` return only valid `KnownTag`/`Document` via `KnownTag.safeParse`/`Document.safeParse`). `getAttachments` reads all four ActivityStreams media attachment types — Mastodon's `Document` and the `Image`/`Video`/`Audio` that Pixelfed, Friendica and Funkwhale send — plus a `url` given as a Link or an array of Link renditions, and normalises each to a `Document`; a missing `mediaType` defaults by kind (`image/jpeg`, `video/mp4`, `audio/mpeg`), except on a `Document`, which is dropped without one.
- **An actor's `publicKey` may be an array.** The `Actor` schema (`lib/types/activitypub/actor.ts`) still outputs a single key object, chosen by `selectDefaultActorPublicKey`: among the entries shaped as a key (id, owner, `publicKeyPem`; a Multikey is skipped) it prefers the `#main-key` entry, else the first, and an empty or all-invalid array fails the parse. When a signature names a key, `getSenderPublicKey` first narrows the array to the entry whose normalised id equals that `keyId`, so a request signed with a non-default key resolves when the key is fetched (an actor not yet stored, or the throttled refresh below; the stored row keeps only the default key, so for a stored actor this is best effort); the narrowed entry then goes through the same owner checks as a single key, so an entry owned by another actor is rejected.
- **Inbound HTTP signatures accept RFC 9421 as well as draft-cavage; outbound stays draft-cavage.** `ActivityPubVerifyGuard` accepts both, so a peer that has moved to RFC 9421 HTTP Message Signatures still delivers, while every peer can still read what we send: a request with a `Signature-Input` header is verified as RFC 9421 (`rsa-v1_5-sha256` or `ed25519`, `alg` checked against the key type and inferred when absent), any other request as draft-cavage exactly as before. A 9421 `POST` must cover `content-digest` and its RFC 9530 `Content-Digest` must match the body; the target URI and other derived components come from our own view of the request (trusted host, https), so a signature made for another host or path fails. Both schemes share the freshness window, the `keyId` resolution, the domain policy check, the key-rotation refresh below and the forwarded-delivery handling. There is no outbound RFC 9421 signing and no double-knocking; RSA-PSS, ECDSA, HMAC, Multikey keys and a nonce replay cache are out of scope. See **Inbound Forwarding & Verification** in [architecture.md](architecture.md#inbound-forwarding--verification) for the required components.
- **An inbound `Move` is Mastodon's account migration, accepted at the shared and the per-user inbox
  (it is no longer an accepted-and-ignored type).** `actor` and `object` must both be the HTTP
  signer (the origin account) and `target` the new account; anything else is dropped with 202.
  - `MoveActorJob` takes a per-origin 7-day cooldown (Mastodon's `move_in_progress`, kept in the
    actor's settings JSON and released when verification fails), refuses a suspended or deleted
    target (a local target's aliases are verified from its stored row without network fetch; a
    remote target is re-fetched, signed when a federation signing actor is configured) and requires
    its `alsoKnownAs` to contain the origin before it records the origin's `movedTo` (which the
    Mastodon Account entity then exposes as `moved`). It then queues one `MoveFollowerJob` per
    accepted local follower.
  - It skips (and keeps the origin follow for) a target that became unavailable, or a follower and
    target that block each other or where the follower blocks the target's domain. Otherwise it
    follows the target with the same options, moves the follower's lists to the target and unfollows
    the origin.
  - Local followers are repointed onto a local target directly without network Follow: an unsilenced
    local follower is Accepted directly (`follow` notification), while a silenced local follower
    gets a follow request (`Requested` + `follow_request` notification, as Mastodon's
    `FollowService`); the Undo is still sent to the remote origin.
  - A Requested follow it made itself is sent again, never duplicated; if the follower already
    follows or requested the target (Requested or Accepted), only the options are copied, the target
    is added to their lists and the origin follow stays. A failed verification releases the 7-day
    cooldown, so the limit applies to verified moves. The queue does not dedupe job ids on every
    backend, so the follower job guards itself with a deterministic follow id.
  - Account notes, mutes (notifications flag and end time kept) and blocks (federated only for
    remote targets via `SendBlockJob`, deterministic uri; not federated for a local target) are
    carried over by `MoveRelationshipsJob` with Mastodon's skip rules and note texts, even if the
    target has itself moved; on resume, `SendBlockJob` is re-published with the deterministic id for
    remote targets (deduplicating queues drop it and receivers treat duplicate blocks with the same
    uri as no-ops). Details in
    [architecture.md](architecture.md#agents-actor-profile-deletion-federation).
- **Outgoing account migration is this server's own API,
  `/api/v1/accounts/migration` (`GET`, `POST`, `DELETE`), not a Mastodon
  endpoint.** Mastodon does it from its settings forms
  (`Settings::MigrationsController` for a move, `Settings::Migration::RedirectsController`
  for a redirect), so there is no REST shape to match. The rules follow
  Mastodon: a 30-day cooldown between moves
  (`AccountMigration::COOLDOWN_PERIOD`), an alias on the new account required
  for a move only, the current password (or the current username for a
  passwordless account) as the challenge, and `MoveService`'s steps (the Move
  activity to the remote followers, the remote accounts that block the origin and
  every accepted relay, follower rewiring, then notes, blocks and mutes carried
  over). Differences: the cooldown answers 429 with `cooldownUntil`; the move
  row and `movedTo` are written in one locked transaction, then `Update(Person)`
  goes out and the Move is queued, so a queue failure answers 503 and keeps the
  move, and retrying the same request publishes the same job and completes it
  (only until the job is queued: a repeat of a started move is 422, and a move
  repeated after a `DELETE` and a redirect is 429, so a cancelled move is never
  sent again); a move whose start failed (503) and was never retried keeps
  `movedTo` and still counts toward the 30-day cooldown, as Mastodon's cooldown
  counts every recorded migration (`DELETE` clears the pointer, not the
  cooldown, and does not stop a move already started: the fan-out and the
  follower rewiring complete, as Mastodon never stops a performed move; a
  `DELETE` that lands between the job's publish and the start being recorded
  can still let the start run); a redirect to the account `movedTo` already names
  is 422 `Already moved to this account`, even for two concurrent requests; an unreachable target is 502, a server with no federation signing
  actor to fetch with is 500, and a reachable target without the alias is 422;
  one Move goes to each remote shared inbox across all continuations; and
  Settings → Moving (`/settings/moving`) is the web UI for it. Details in
  [architecture.md](architecture.md#agents-actor-profile-deletion-federation).
- **Handle rename in place is this server's own API, `/api/v1/accounts/handle`
  (`GET`, `POST`), not a Mastodon endpoint.** Mastodon has no REST rename: a
  local account's handle is immutable there, and a remote account's rename is
  applied when an `Update(Person)` arrives, verified against WebFinger
  (`extract_username_and_domain!` + `check_webfinger!`) — see the remote-rename
  bullet below. `GET` (and the POST 200 body) returns
  `{ actorId, username, domain, acct, history, cooldownUntil, domains }`:
  the current handle, the ledger history (current row first, then replaced
  newest-first), the running rename cooldown as ISO or null, and the domains
  the account may still rename onto (the actor-domain choices filtered through
  the account's sign-up filter, plus the current domain always). POST takes
  `{ username, domain?, password?, currentUsername?, actorId? }` and
  re-authenticates like Mastodon's migration form: the current password, or
  the CURRENT username for a passwordless account (`currentUsername` holds the
  old name; `username` is the new one, validated by `localUsernameSchema`; the
  optional `domain` goes through the actor-domain pipeline, else 400 `Domain
is not allowed` — except a target that IS the actor's current domain,
  case-insensitively, whether sent or defaulted, which skips the pipeline:
  the handle already lives there, so a later-narrowed `allowActorDomains` or
  sign-up filter cannot strand a plain username change). The rename costs the actor nothing it keeps: the ActivityPub
  id and every id-derived URL stay, `Update(Person)` goes out, old handles
  keep resolving and stay reserved forever. Status codes: 200; 400 for
  unparseable JSON or a disallowed domain; 403 for the federation signing
  actor; 404 for a missing record; 409 for an `actorId` that is not the
  session actor's; 422 `{ error }` for an invalid request or username, `Nothing
to change` (a case-only rename included), `Username already exists`, `This
profile cannot be renamed` (either side of a legacy case pair), the moved error, and
  `This account is not available` (suspended or
  deleting); 429 `{ error, cooldownUntil }` inside the 30-day rename cooldown,
  which is measured from the actor's own handle history and is separate from
  the Move cooldown. Details in
  [architecture.md](architecture.md#agents-actor-profile-deletion-federation).
- **Mastodon renames a remote account only through WebFinger, and our answers
  satisfy its `check_webfinger!` in both directions.** When Mastodon fetches a
  renamed actor's Person, it reads the FEP-2c59 `webfinger` property (which
  this server emits for every local actor, with the `https://purl.archive.org/socialweb/webfinger`
  context URL) and checks `acct:<claimed>` on that domain: our WebFinger
  answers the current handle with the same handle as `subject` and a `self`
  link whose href is the immutable actor id verbatim (Mastodon's direct-match
  branch), and answers a historical handle with 200, the CURRENT handle as
  `subject` (Mastodon's one-hop subject-redirect branch) and the same
  immutable `self` href — so a peer that learned the old handle still confirms
  the rename onto this actor id, and one that checks the new handle confirms
  it directly. Inbound, this server applies a remote rename the same way (see
  [architecture.md](architecture.md#agents-actor-profile-deletion-federation)):
  an unconfirmed claim aborts the refresh.
- **One account can no longer hold two actors whose usernames differ only by
  case on the same domain.** The handle ledger's unique `(lower(username),
domain)` index and the ledger arm of `isUsernameExists` fold casing at every
  mint and rename, so the case-colliding pair the `actors` unique index never
  refused (deliberately: it could not build on instances that already held
  one, see the Actor Usernames section below) can no longer be created through
  any account-facing path.
- **A moved account takes no new followers, and a moved target cannot be
  followed.** An inbound `Follow` to a local account with `movedTo` set is
  answered with `Reject` and creates nothing, like Mastodon's
  `reject_follow_request!`; `POST /api/v1/accounts/:id/follow` answers 403
  `Target account has moved` (the bulk import reports `Account has moved`) for a
  moved local or remote target, where Mastodon's `FollowService` raises
  `NotPermittedError`. `POST /api/v1/follow_requests/:id/authorize` from a
  moved account is 422 `This account has moved` (`reject` stays allowed). An
  existing follow can still have its preferences updated. Unfollowing an
  existing target is allowed even after that target moves.
- **Posting and editing from a moved account gets 422 `This account has moved`.**
  The check covers `POST /api/v1/statuses` (polls, replies and scheduled posts
  included), reblogs, the edit `PUT /api/v1/statuses/:id`,
  `PUT /api/v1/statuses/:id/interaction_policy` (it rewrites the note and
  re-federates it), and the deprecated `accounts/outbox` and `accounts/repost`
  routes. `DELETE` on the migration route clears the pointer and lifts the
  posting restriction; a due scheduled status is held while the account is
  moved. `DELETE` requeues already-due statuses only when it observed `movedTo`
  set before clearing it, with deterministic queue IDs scoped to the latest
  migration. A redirect set again during the replay scan cancels that replay;
  the next `DELETE`, scoped to the new migration, replays those posts. A later
  `DELETE` with no current redirect does not replay them, including after a
  partial queue failure, so `PUT /api/v1/scheduled_statuses/:id` is the
  recovery path for due posts a partial queue failure left unpublished: it
  requeues a post, and its minimum-ahead check is the only gate. Other API
  actions retain their ordinary permissions: follow-request rejection, status
  deletion, favourites, bookmarks, poll votes, reactions, quote revocation,
  following an account that has not moved, unfollowing even a moved target,
  media, lists, filters, reports, mutes, blocks, notes, pins, tags,
  endorsements, gallery and albums, fitness uploads and retries, settings,
  exports, account deletion, and reads. A fitness import can still keep a
  backing status for its activity without inserting a timeline post, notifying
  followers or federating a new post while the author is moved. These posting
  and follow-request refusals are explicit here. Mastodon's API base skips the
  inherited `require_functional!` gate except in limited federation mode, and
  its `require_user!` checks `User#nonfunctional_reason`, which does not include
  a moved account. Its signed-in web path checks `User#functional?`, which does
  exclude moved accounts; individual Mastodon API actions can have their own
  checks.
- **A failed verification against a stored remote key triggers one throttled refresh.** When `ActivityPubVerifyGuard` cannot verify a request with the key it holds (non-empty), it calls `refreshSenderPublicKeyDetails`, which re-fetches the `keyId` through `fetchSenderPublicKeyDetails` (3 s, no retries, no cross-host redirects, owner-validated) and returns the key only if its owner equals the stored owner and the key differs. It never refreshes a local actor, a key with no stored row, or a row updated within 5 minutes, and records the attempt per owner before fetching (in memory, so a failing peer is throttled too). The happy path makes no network call. Only a key that came from the stored actor row is refreshed (a key just fetched, such as a path-based GoToSocial key, is already fresh). The attempt map is capped; when full it drops only entries outside the window and otherwise refuses to refresh. The stored key is replaced (`persistRefreshedSenderPublicKey`) only after this very request verifies with the fresh key, and only when that key is the actor's default key (the single key, or the array's `#main-key`/first entry): a request signed with another key of a multi-key actor is accepted but leaves the stored default key alone. A failed write is logged and the verified request continues. It deliberately does not call `recordActorIfNeeded`: that is a slow, multi-fetch path, wrong for an unauthenticated inbox request.
- **Do not change `http://schema.org#` to `https`.** Mastodon maps the `schema` prefix to the non-standard `http://schema.org#` base in actor `@context`; the canonical context must use the same IRI so profile fields (`PropertyValue`/`value`) compact correctly.
- **Account `fields[].verified_at` is the time `VerifyProfileLinksJob` saw the field's page link
  back with `rel="me"`, or `null`; `source.fields` carries the same value.** It follows Mastodon's
  `VerifyLinkService` (single https URL values only, as `Account::Field`'s `ACCEPTED_SCHEMES =
%w(https)`, so an `http://` value is not verified there either and shows no status; an `<a>` or
  `<link>` with the `me` rel token and an `href` equal, case-insensitively, to the profile URL — the
  current one or, after an in-place rename, any replaced handle's (`/api/v1/accounts/handle`) — and
  its `requires_verification?` re-queue of an unverified link on every save.
  - Deviations: the page is fetched through `safeRemoteFetch` (HTTPS only, SSRF guard, 1 MiB, HTML
    only, two redirects, 5 s connect + 5 s read per hop, so about 30 s per link at most); **the
    actor id is also accepted as a link-back target**, where Mastodon matches only
    `url_for(account)`; a remote actor's profile URL is derived as `https://<domain>/@<username>`
    because its own `url` is not stored; at most four fields are checked; and a verified link is not
    checked again until its value changes.
  - The job stamps `linksCheckedAt` in the actor's settings on every run (internal, never federated,
    not in the API), and a remote profile render queues a check only when that stamp is older than 1
    hour (changed values) or 3 days (unchanged unverified values); local saves and real refreshes
    always queue.
  - The time is never federated: the `PropertyValue` attachments carry no verification, and each
    server verifies for itself.
- Compaction emits the public collection as the compact alias `as:Public`; `toRecipientArray` canonicalises it back to the full ActivityStreams Public IRI when coercing recipients for persistence so stored recipients have one canonical form. JSON-LD blank-node ids (`_:b0`) are document-local artifacts and are rejected by `extractActivityPubId`/`normalizeActivityPubUri` — they are never valid resolvable ActivityPub ids.
- **Read a collection's items through `toCollectionItems` (`lib/activities/orderedCollection.ts`), never by iterating `items`/`orderedItems` directly.** Compaction collapses a one-element array into the bare value, so a replies page holding exactly one reply reaches the reader as that reply — an embedded object, or a string id ref — and `for…of` throws on the object (failing the whole thread fetch) and walks the string one character at a time. `orderedItems` keeps its array under a conformant processor (the ActivityStreams context declares it `@container: @list`), but a remote is free to serve a bare value there too, so the raw outbox readers normalise it the same way. `fetchRemoteStatusJob`'s replies walk, `getActorPosts`, `followTimelineBackfillJob` and `getActorCollections` (for a collection root that inlines its `orderedItems`) all go through it; `remoteFollowCollection` deliberately reports a non-array page as `unavailable` instead.
- **Every non-Mastodon dialect this instance must read has a fixture in `lib/stub/fediverse/`, and a change to inbound parsing runs against all of them.** The corpus holds actor, object, activity and collection payloads in the shapes Misskey, Lemmy, PeerTube, Pixelfed, Pleroma/Akkoma, GoToSocial, Funkwhale and Mobilizon put on the wire (hosts rewritten to `<software>.test`, `gts.test` for GoToSocial); `mockFediverseRequests` serves each document at its own `id`, plus WebFinger for every fixture actor. Three suites push them through the real code: `app/api/inbox/fediverseInterop.test.ts` (shared inbox → `getJobMessage` → the job, on a real database), `app/api/users/[username]/inbox/fediverseInterop.test.ts` (Follow, Like and reactions at the personal inbox) and `lib/activities/fediverseInterop.test.ts` (actor recording, `getRemoteStatus`, outboxes, reply-thread crawls). When a federation bug comes from a dialect, add or extend that server's fixture with the shape that broke rather than writing a one-off payload into a unit test, so every path sees it. The corpus is what caught these, each pinned there:
  - **An `Announce` need not carry `published`.** Lemmy communities and PeerTube channels omit it, and with it required every boost they sent — the only way a community or channel follower sees anything — was dropped as malformed.
  - **A FEP-1b12 group announces the author's `Create`, not the post.** `normalizeActivityPubAnnounce` reads the boosted object from an embedded `Create`'s `object` (id only; the post is still fetched from its origin). Any other announced activity is routed by `getJobMessage` as the bullet on community Announces below describes, so a relayed vote (`Announce(Like)`) stores nothing.
  - **PeerTube attributes a video to the account and its channel.** `bindObjectToSender` in `getJobMessage` accepts it signed by the account (see the bullet on it below).
  - **Media attachments may be typed `Image`/`Video`/`Audio`, not `Document`** (Pixelfed, Friendica). `getAttachments` reads them as the `Document` they describe; the Pixelfed fixture pins it end to end.
- **Audio and Event objects are stored as Notes, as Mastodon does for its `CONVERTED_TYPES`.** Funkwhale sends tracks as `Audio`, Mobilizon and Gancio send `Event`; `getJobMessage`'s `NOTE_TYPES`, `BaseNote`, the create/update note jobs and `fetchQuoteTargetForCreate` accept both. An `Audio` stores its playable rendition (the `audio/*` Link, whose type Funkwhale writes as `mimeType`) as an audio attachment and takes the `text/html` Link as the status url (`getStatusUrl`); an `Event` has no attachment, and `getContent` puts its `startTime` and location name (string, `{ name }` or the first of an array) between the title and the description. `normalizeActivityPubContent` keeps an Audio's `url` array whole, as for Video.
- **Article and Page `name` is rendered as a bold title paragraph, as for Video, Audio and Event.** Lemmy (Page) and WriteFreely/Plume/WordPress (Article) send the title only in `name`; `getContent` prepends `<p><strong>name</strong></p>` and, when the object has no body, adds a link to its `url`. Mastodon renders converted types as title plus link; we keep the body. `summary` is the content warning for every type, as in Mastodon, and the serializer reports `sensitive` when a summary is present.
- **Forwarded ActivityPub deliveries (ActivityPub §7.1.2 inbox forwarding) pass the signature guard with `forwarded: true` instead of 403 `sender_actor_mismatch`.** Because the payload is signed by the forwarding server rather than the document's author, it cannot be trusted directly. Forwarded `Create`, `Update`, and `Delete` activities route to `ProcessForwardedActivityJob` (`names.ts:PROCESS_FORWARDED_ACTIVITY_JOB_NAME`) to verify and re-fetch the object from the author's origin server before executing side effects; all other forwarded activity types (`Follow`, `Accept`, `Reject`, `Like`, `Undo`) lack an origin verification path and are acknowledged with `202 Accepted` and dropped without side effects.
- **A community (`Group`) Announce that wraps a whole activity is treated as a forwarded activity.** Lemmy, Mbin and Kbin relay a member's `Update`, `Delete` and votes as `Announce(<activity>)` signed by the group, so the inner activity's author never signed it. `getJobMessage` checks the Announce actor against the signer as usual, then hands a wrapped `Update`/`Delete` to `getForwardedJobMessage`, i.e. `ProcessForwardedActivityJob`'s origin re-fetch, with no `verifiedSenderActorId`, provided the inner activity's `id` is on the inner actor's origin (the re-fetch job dedups on that id, so a foreign id would let a signer pre-empt another server's real activity); any other wrapped type (`Like`, `Dislike`, `Undo`, ...) is dropped rather than being boosted by the activity's own id. A wrapped `Create` stays on the ordinary boost path.
- **A `Delete` whose `object` is a bare string is an account delete when it is the verified sender, and otherwise a status delete when it names a stored status.** Pleroma/Akkoma, GoToSocial and Lemmy delete posts this way. As in Mastodon, `deleteObjectJob` checks the id against the verified sender first; any other id is looked up as a status, and that delete is scoped to the verified sender exactly as a Tombstone delete is, so naming someone else's status deletes nothing and never falls back to an actor delete. When no status can be read for the id, the sender-scoped delete still runs, so an orphan boost row of the sender (its boosted original gone) is removed as before; the span then carries `objectNotFound`, and `senderMismatch` only when a stored status belongs to someone else or an Announce's actor is not the sender.
- **A `Delete` may also embed the whole object, of any type.** Like Mastodon (`value_or_id`), `deleteObjectJob` reads only the embedded object's string `id` and handles it exactly like the bare-string id above, in the same order: an id equal to the verified sender deletes that account, and any other id that names a stored status deletes the status (scoped to the verified sender, so naming someone else's status deletes nothing). This holds for a full `Note`/`Page`, an actor, a `Tombstone` (a Tombstone naming the sender's own id deletes the account), or a type we do not know (BookWyrm's `Review`); there is no type allow-list. Two refusals: an embedded `Announce` never takes this path (an `Undo(Announce)` is routed to this job and must never delete an account or a status by id), and a message without `verifiedSenderActorId` (only legacy queued messages) neither deletes an account nor runs an unscoped status delete for an embedded object; bare-string ids and Tombstones from such messages keep their previous behaviour.
- **Tags are parsed leniently, and one bad tag never rejects a Note.** A `Hashtag` needs only a
  `name` (Misskey and Pleroma/Akkoma omit the `#` or the `href`). The stored name always gets its
  `#`, and the `href` is stored only when it is an http(s) URL, otherwise empty. An `Emoji` need not
  carry `updated`.
  - Hashtag names are normalised and validated like Mastodon (`HashtagNormalizer` and
    `Tag::HASHTAG_NAME_RE`, ported in `lib/jobs/noteTags.ts`): leading `#` characters are stripped,
    and so is every character that is not alphabetic, a decimal digit, a Thai mark (U+0E47–U+0E4E)
    or a separator (`_`, `·`, `・`, ZWNJ). That strips most combining marks too, so a decomposed
    `café` becomes `cafe` and `हिन्दी` becomes `हिनदी`, as in Mastodon's display name, and `foo-bar`
    becomes `foobar` and `x²` becomes `x`. What remains must be word characters and separators, with
    the same shape rule as Mastodon: `1_1` and `foo_` are valid, and only `·`, `・` and ZWNJ cannot
    end a name (Persian `می‌خواهم` is accepted; `foo·` and `12_` are not). The check runs as a
    single linear pass instead of Mastodon's backtracking regex, and like Mastodon it is applied to
    the name and to its folded form (NFKC plus lowercase of the raw name, with invalid characters
    stripped afterwards), so a name such as `abcŀ`, which folds to `abcl·`, is skipped. The
    equivalence with Mastodon holds per Unicode version: Node's Unicode tables may be newer than
    those of Mastodon's Ruby, so a character that is newly assigned or newly alphabetic can be
    accepted here before Mastodon accepts it.
  - **Deliberate divergence:** this project's tag key only lowercases. Unlike Mastodon there is no
    NFKC or ASCII folding, so `Café` and `cafe`, or `ｆｏｏ` and `foo`, stay distinct tags, and `x²`
    becomes `x` rather than Mastodon's `x2`.
  - A name that fails this is skipped, as is any tag whose name or value exceeds 255 characters (the
    Postgres column width). Each tag is stored on its own, so one that fails is logged and skipped.
  - Create(Note), Update(Note) and Create(Question) share this code and the same counter rule,
    `isPubliclyAddressed` (the one Delete uses): hashtag counters move only for posts addressed to
    the public collection.
  - An inbound `Update(Note)` replaces a remote post's emoji, hashtag and mention tags with the
    Update's `tag` set (as Mastodon does), planning and validating the new set before the old rows
    are removed, and moves each hashtag counter by the difference between the new set and the
    previous rows (counted per stored row, as Delete does); the previous set is read from the raw
    stored names, so a legacy name the current rule would reject is still decremented. An
    `Update(Question)` does not touch tags.
  - **Known gaps:** the tag resync (delete the old rows, insert the new ones, move the counters) is
    not one transaction, because the database facade has no transaction helper to wrap it, so a
    crash part-way leaves the edit half applied until the next Update; and Mastodon's
    `ProcessStatusUpdateService` notifies newly added local mentions; here a new mention added in an
    edit does not notify.
- **`content` is HTML unless the object says `mediaType: text/markdown`.** PeerTube sends markdown that way; `getContent` renders it with `renderRemoteMarkdown` (everything escaped, paragraphs, `<br>`, http(s) links only; bounded patterns, no markdown dependency) before the usual sanitising. `source` is a fallback when `content` is absent, for markdown or plain text, never Misskey's MFM. Both the markdown rendering and the `source` fallback are deliberate additions beyond Mastodon, which only reads `content`.
- **The public collection is recognised in all three spellings** (`https://www.w3.org/ns/activitystreams#Public`, `as:Public`, `Public`) by `getVisibility`. Inbound recipients are canonicalised on ingest: `toRecipientArray` maps both short spellings to the full IRI, so the SQL public checks (`PUBLIC_ACTIVITY_RECIPIENTS`: the full IRI and `as:Public`) and the hashtag counters on delete see one form. Rows stored with a bare `Public` before the ingest canonicalisation are not matched by the SQL checks and need no migration. Reads that go through `getVisibility` treat them as public and the API labels them public, matching what the sender meant, while SQL-side filters keep the old handling; no hashtag counter moves for them: Create, Update and Delete all decide counters with `isPubliclyAddressed`, which does not match the bare term. `getVisibility` also takes the author's stored followers URL (`actor.followersUrl`) so a collection that does not end in `/followers` (Friendica's `/followers/<nick>`) counts as followers-only; only the Mastodon API status visibility label passes it, and other callers of `getVisibility` (for example `isPublicOrUnlisted`) still use the `/followers` suffix rule.
- **Inbound `audience` (FEP-1b12) is folded into `cc`** by `normalizeActivityPubContent` when it is not already in `to`/`cc`, so a post keeps the community it was written for on its stored recipients. It must never change visibility, so an `audience` naming the public collection (either spelling) or a followers collection is ignored rather than folded.
- **An inbox takes the activity's `actor` from the RAW body the signature guard verified, never from the compacted document.** Compaction expands under the sender's own `@context`, so an inline `{ "actor": null }` plus an `https://www.w3.org/ns/activitystreams#actor` property compacts to a different `actor` than the one the guard bound to the signer. Both inboxes overwrite the compacted `actor` with `extractActivityPubId(activityBody.actor)` — the shared inbox inline, the per-user inbox through `compactWithVerifiedActor` on all three of its compaction paths (forwarded, relay handshake, and the main dispatch).
- **An inbound Create/Update binds its object to the signer through `bindObjectToSender` (`app/api/inbox/getJobMessage.ts`), and the signer only has to be ONE of the `attributedTo` authors.** PeerTube attributes a `Video` to the uploading account (a `Person`) AND its channel (a `Group`) and signs with the account; requiring every author to equal the signer dropped every PeerTube upload. Two limits keep the relaxation from widening spoofing: every co-author must share the signer's origin (`isSameActivityPubOrigin`), so a sender cannot list a third party's actor, and any object-level `actor` must still be the signer itself. The job receives a copy whose `attributedTo` is pinned to the signer's own entry, because `normalizeActivityPubContent` stores the FIRST id of an array — without the pin, a `[channel, account]` ordering would store the channel as the author. Pinned on both sides by the multi-author and PeerTube cases in `app/api/inbox/getJobMessage.test.ts`.

#### Interoperability quirks

Deliberate deviations from standard web best practices that Fediverse interoperability requires:

- **An inbound `Update(Note)` replaces a remote post's attachments.** `updateNoteJob` compares the Update's attachment URLs, in order, with the post's stored remote attachments and, when they differ, replaces them in one transaction (`buildRemoteAttachments` in `lib/jobs/noteAttachments.ts`, then `replaceRemoteAttachmentsForStatus`), as Mastodon does, so a failure leaves the old rows and no reader sees the post without its media. Each new row's `createdAt` is `published` plus its position in the note's full attachment list, the same rule the Create used, so the order holds against the fitness rows the Update keeps. Only rows the note brought (no `mediaId`, not a fitness file) are replaced, and a local status is never touched. Outbound, `sendNoteJob` and `sendUpdateNoteJob` apply **no** visibility or opt-in checks of their own — if a caller publishes to them, they federate — and because Mastodon synthesises a `Create` when it receives an `Update` for an unseen object younger than ~a day (`OBJECT_AGE_THRESHOLD` in Mastodon's `ActivityPub::Activity::Update`), sending an ungated `Update` (e.g. after attaching or editing media) publishes a status that deliberately stayed local or private.
- **Spreading `null` in object literals (e.g. `...(cond ? { ... } : null)`) is a deliberate, consistent no-op pattern** used to cleanly omit keys; do not replace it with `{}`.

<a id="agents-a-fetched-document-s-own-id-is-not-evidence"></a>
<a id="review-fetched-activitypub-document-ids"></a>

### A Fetched Document's Own `id` Is Not Evidence

`getNote` fetches a URL and returns whatever the body says; it does not check that the document's `id` is the id that was asked for (`getActorPerson` does — see the actor-document bullet below). So a fetched `id` is a **claim by whoever answered the request**, exactly as much as its `content` is — and the moment that claim resolves a database row, a remote server is choosing which of our rows a write lands on. The sink is a bare `where('id', ?)` with no ownership, locality or type filter — as in `updatePoll` and `createAnnounce`.

**There are two different questions here and they take two different guards. Do not unify them.**

- **"Did I get back the document I asked for?" — exact id, normalized.** `lib/services/polls/syncRemotePoll.ts` fetches `status.id`, which is the origin's OWN canonical id, stored from its own earlier document. There is no third party and no aliasing: ask an origin for its canonical id and it answers with that id. A different id means it is describing a different object, so the sync is refused through the existing `failedPollSyncsAt` cooldown. `normalizeActivityPubUri` on both sides absorbs the serialization noise the URL parser itself removes: scheme/host case, an explicit default port, dot segments, IDNA host mapping, a backslash in the path, an empty path gaining its `/`, and characters the parser must percent-ENCODE (a non-ASCII username in a path). Do not read that as a closed list — state the rule, not the inventory, and check the parser before relying on a specific fold. Two it does **not** do: it never percent-DECODEs (`%7E` and `~` still differ), and it does not fold a trailing slash on a non-empty path (only the bare-origin case gains one). The write additionally uses `statusId: status.id`, never `question.id` — that is what actually closes the vulnerability, so the guard's tightness is defence in depth and refusing too much only costs stale tallies plus a warn.
- **"Is this document allowed to name that id?" — same ORIGIN, via `isSameActivityPubOrigin`.**
  `lib/jobs/createAnnounceJob.ts` compares the fetched note's `id` against the Announce's own
  `object`, and `object` was chosen by a **third party** — the announcer — who may legitimately name
  a same-origin alias.
  - **An exact match here is a real interop regression, not merely a stricter rule:** a server may
    canonicalise a URL within its own origin, and this instance's own `proxy.ts` does exactly that,
    answering `/@user/<id>` under an ActivityPub `Accept` header with a document whose `id` is
    `/users/<user>/statuses/<n>`. Mastodon behaves the same way, and `getNote` follows same-host
    redirects. Cross-origin is the entire attack, because a server can already serve whatever it
    likes at any id it owns.
  - Similarly, on-demand quote fetching in `fetchQuoteTargetForCreate`
    (`lib/services/quotes/fetchQuoteTargetForCreate.ts`) enforces same-origin between the requested
    quoted status URL and the fetched note's `id` (`isSameActivityPubOrigin(fetchedNote.id,
quotedStatusId)`), and also binds attribution by requiring that `attributedTo` shares the same
    origin (`isSameActivityPubOrigin(fetchedNote.attributedTo, fetchedNote.id)`), closing the
    attribution hole for quotes before storing via `createNoteJob`/`createPollJob` with
    `skipQuoteResolution: true`.
  - `fetchRemoteStatusJob` (the status page's on-demand fetch) applies the same pair to every note
    it stores — the requested note, each parent and each reply — against the URL that actually
    served it: the page a reply was inlined in, or the reply's own URL when it was fetched
    separately. The requested note is gated before `normalizeActivityPubContent` runs, so, like
    `dispatchCreateNoteOrPollJob` below, it checks the `extractActivityPubId` author rather than the
    raw `attributedTo`, which may still be an embedded actor object or a PeerTube-style array.
  - The inbound-quote resolver `resolveInboundQuotedStatus`
    (`lib/services/quotes/persistInboundQuoteEdge.ts`) binds attribution the same way after its
    exact-id check, and gates the fetch on `isLocalFederationDomain`/`canFederateWithDomain` BEFORE
    sending it — the quoted id is the remote sender's choice, so checking policy only when the
    result is stored still lets a sender aim instance-signed requests at a blocked host.
- **The URL a document is compared against is only evidence if that URL's host actually answered.** `safeRemoteFetch` follows redirects across hosts by default, so an open redirect on the claimed origin (a Mastodon reblog permalink is one) lets any other host serve a document that passes every same-origin check made against the REQUESTED URL — a forged quote target or forwarded Update, a forged Tombstone that confirms a forwarded Delete, a forged `QuoteAuthorization` stamp. Fetches that authenticate a document by where it came from therefore pass `allowCrossHostRedirects: false` to `request`/`safeRemoteFetch`, which refuses the hop (`ERR_CROSS_HOST_REDIRECT`, never retried) before the other host is contacted: `getNote` always does, as do the forwarded-Delete confirmation in `processForwardedActivityJob`, the stamp fetch in `verifyRemoteQuote`, and the inbox sender-key fetch (and its owner re-fetch) in `getSenderPublicKey` — the one fetch that mints a verified sender, where a redirect would also let a host the domain-block check on the keyId never saw serve the key. Same-host redirects are still followed — that is the same authority. A new fetch whose response is trusted because of its origin must opt in too; do not instead compare the document against the final URL after the fact, because by then the other host has already been sent the request.
- **`isSameActivityPubOrigin` (`lib/utils/activitypub.ts`) fails CLOSED and is the shared spelling of a check five modules still carry inline** as `sameHost`/`sameAuthority` (`processForwardedActivityJob`, `verifyRemoteQuote`, `persistInboundQuoteEdge`, `handleQuoteRequest`, `handleQuoteResponse`); those copies should collapse onto it in the dedup pass. Failing closed matters more than it looks: a blank node, an empty string, an unparseable id **and a host-less URI** all match nothing, including themselves, so no pair of degenerate ids can ever compare equal the way two `normalizeActivityPubUri(null)` results would. The host-less case is the one a bare `.host` comparison gets wrong rather than throwing on — `urn:`, `did:`, `tag:` and `mailto:` ids all parse and report `host === ''` — so the helper is deliberately **stricter than the five inline copies on that input and no other**, which is what makes migrating them onto it safe rather than merely tidy. It compares the host and not the scheme, which is deliberate: scheme does not partition who controls an id space, and the port — which does — is already part of `host`.
- **`getActorPerson` binds an actor document's `id` to the origin that served it, and nothing downstream may write a LOCAL actor row from fetched data.** Every caller keys actor rows, public keys and inboxes on `person.id`, and `getSenderPublicKey` trusts a stored row's key before fetching from origin — so a WebFinger target on `evil.example` that answered with `id: https://victim.example/users/alice` (or one of OUR ids) and its own key used to plant that key under the victim's id, after which it could sign inbox traffic as them; `getProfileData`'s refresh branch overwrote a local actor's `publicKey` the same way. A document served (after redirects — `RequestResult.url`) from the origin its `id` names is accepted as-is; a foreign-origin `id` is re-fetched ONCE from the id it claims, Mastodon-style, and accepted only when that origin serves the very same id (normalized). That keeps split-domain deployments (WebFinger `self` on `llun.dev`, actor on `social.llun.dev`) working while making the returned document always the claimed origin's own. `getProfileData` additionally skips `updateActor`/`createActor`/`setActorCounters` when the row at `person.id` has a `privateKey` or an `account`, mirroring `recordActorIfNeeded`'s "Don't update local actor".
- **In `createAnnounceJob` the guard sits BEFORE the `createNoteJob`/`createPollJob` dispatch, not merely before the fallback lookup.** Placed after it, a document claiming an id we were never pointed at is still _persisted_ — a status planted on another server's id space, attributed to whatever `attributedTo` claims. Pinned by `stores nothing when the fetched object claims an unstored id on another host`, which is the only test that moves when the guard is relocated.
- **The second `getStatus` arm in `createAnnounceJob` stays.** `getStatus` does not normalize and the child jobs persist under the FETCHED spelling, so when the Announce named an alias the `object` lookup misses a row that was just written; that arm resolves it, and the origin guard is what keeps it from reaching another host.
- **Where the id resolves a row someone else owns, an id match is not enough — check ownership.** `updatePollJob` had no author check at all, the poll twin of the one `updateNoteJob` carries and documents. The inbox only proves `attributedTo` matches the _signer_ (`getJobMessage`'s `bindObjectToSender`), which an attacker satisfies by attributing the Update to themselves while pointing `id` at someone else's poll — so any federated actor could rewrite any stored poll's text, spoiler and tallies, `status_history` revision included, and the defacement read as a genuine edit by the victim. Both jobs compare `normalizeActorId(attributedTo)` against the stored status's `actorId`.
- **Every guard here is bracketed by tests on BOTH sides** — one that fails when it is loosened and one when it is tightened. That is not belt-and-braces, it is the only way to record that a guard has a correct _width_: `accepts an announce naming a same-origin permalink for the boosted status` is what fails if someone "hardens" the origin check into an id check.
- **This guard does not make an Announce's target safe, and the distinction is easy to misread.** A
  boost of an ALREADY-STORED status never reaches the guard at all — `getStatus({ statusId: object
})` resolves it and skips the whole branch — and `createAnnounce` itself checks only that the
  original _exists_.
  - The audience check is a separate step AFTER both arms: a public or unlisted Announce whose
    target is not `isStatusPubliclyReadable` is dropped. `createRelayAnnounceJob`'s `isPublicStatus`
    is stricter still — listed public only (Public in `to`), because the federated timeline is a
    discovery surface an unlisted note must stay off, and `getFederatedStatusDeliveryInboxes`
    forwards only listed-public statuses to relays for the same reason.
  - A **followers-only** Announce of a non-public target is still admitted on purpose (pinned by
    `preserves authorized private announce of a followers-only status`), and `mainTimelineRule` fans
    it to the announcer's local followers with no audience check on the boosted status.
  - The Mastodon API then withholds it from any viewer who could not read the original —
    `getMastodonStatus` drops an Announce whose original fails `canActorReadStatus` — but the web
    UI's signed-in home timeline renders `getTimeline({ timeline: MAIN })` rows without that pass,
    so that one surface is still open.
  - Local boosts are gated before they exist: `userAnnounce` (`lib/actions/announce.ts`) refuses
    anything but a readable public/unlisted status, or the booster's own followers-only post boosted
    back to the same followers (Mastodon's `StatusPolicy#reblog?`).
  - None of this is the origin guard's doing — do not read the guard's presence as audience
    coverage.
- **The boost, relay and forward paths bind the fetched note's AUTHOR to its id's origin, in
  `dispatchCreateNoteOrPollJob`.** All three hand an origin-fetched note to
  `createNoteJob`/`createPollJob` without a `verifiedSenderActorId` — authenticity comes from the
  fetch, not the sender's signature — so `actorMatchesVerifiedSender` fails open and the child job
  stores whatever `attributedTo` claims.
  - Each caller pins `note.id` to the origin it fetched (`isSameActivityPubOrigin(note.id,
<requested id>)`), but that only proves the origin vouches for the _document_: without the
    author binding, any federated actor could Announce a note on its own origin attributed to a
    LOCAL actor and have it stored, shown on that actor's profile and fanned out as theirs. The
    dispatcher therefore refuses a note whose `attributedTo` is not same-origin with its `id` — the
    same pair `fetchQuoteTargetForCreate`, `resolveInboundQuotedStatus` and `fetchRemoteStatusJob`
    apply — at the one seam all three callers share, so a new caller inherits it.
  - It checks `extractActivityPubId(attributedTo)`, the id `normalizeActivityPubContent` goes on to
    store, not the raw value: an embedded actor object or a multi-valued array (PeerTube names the
    account and the channel) survives compaction as-is, and gating the raw value refused every such
    note even when its author was on the note's own origin.
  - `processForwardedActivityJob` already implied the binding on its own (its pointer must share the
    claimed actor's origin, and the fetched `attributedTo` must equal that actor), so the check is
    load-bearing for the boost and relay paths; it is pinned by `refuses a fetched note attributed
to an actor on another origin` in `createAnnounceJob.test.ts` and
    `createRelayAnnounceJob.test.ts`.
- **`recordActorIfNeeded` refuses an actor whose fetched `person.id` is on another origin than the
  id it was asked for, and keys a new row on `person.id`, never on the requested id**
  (`getRequestedActorPerson` and `recordActorIfNeeded` in `lib/actions/utils.ts`; the origin check
  runs on both the create and the refresh path). `getActorPerson` only guarantees the document
  belongs to `person.id`'s origin, not that it is the actor asked for.
  - Requesting `https://evil.example/x` whose document claims `https://victim.example/users/alice`
    returns alice's real document, and the row used to be written as id `evil.example/x`, username
    `alice`, domain `victim.example`: the handle `@alice@victim.example` resolved to a row
    evil.example answered for on every refresh, inbox and key included. A same-origin canonical form
    (Mastodon serves `/@bob` with id `/users/bob`) is still accepted — an exact-id match would
    refuse it — but the row is stored under `/users/bob`, and an alias request answers with the row
    already stored under `person.id` when there is one, never rewriting it.
  - **The alias's document is never persisted** — not by `recordActorIfNeeded`, and not by
    `getProfileData`, whose WebFinger `self` link is not bound to the handle's domain and so can
    name any URL. Both apply one rule, `getPersistableActorPerson` in `lib/actions/utils.ts`: a
    document fetched from its own id is written as-is; otherwise a row already stored under
    `person.id` is left untouched (profile, key, inboxes and counters), and when there is none,
    `person.id` is re-fetched and only the document that URL serves is stored, and only when that
    document's `id` is exactly `person.id`; a failed re-fetch, or one naming yet another id, records
    nothing (Mastodon re-fetches the same way). `getProfileData` still renders the fetched document;
    only the write is gated.
  - Persisting the alias's document put whatever any same-origin URL served (a user upload claiming
    `/users/alice` with its own `publicKey` and `inbox`) onto the REAL actor's row, and inbound
    signature verification trusts a stored row's key for its keyId, so that document's key would
    have verified activities signed as alice.
  - The refresh path only ever re-fetches a row's own id, so it cannot write an alias-served key
    onto a canonical row either.
  - Keying the row on the alias let any URL the origin answers for (`/@alice`, `/users/alice/`,
    `/users/alice?x`, which a hostile collection can list) occupy the actor's UNIQUE `(username,
domain)`, after which the real id could never be recorded and every activity from it failed on
    the constraint.
  - Callers that write rows pointing at the target after recording it (the follow and block routes
    and `fetchRemoteStatusJob`'s note author) use the returned actor's `id`; the inbound handlers
    that store a signed activity's own actor (likes, reactions, votes, announces and inbox-delivered
    notes) need not, because the signature guard pins that actor to the verified key owner — the
    document's own id — up to `normalizeActorId`. A note fetched from its origin without a verified
    sender (boost, relay, forward, quote) still stores its `attributedTo` as written; only that
    origin chooses it, and an alias there leaves only that origin's own notes pointing at an id with
    no row; collection counters are keyed on the stored row's id, the key `hasActorCounters` reads.
  - **What the origin check does NOT prove:** sharing an origin shows that one host vouches for the
    id, username and domain — not that the handle is genuine. Any document that host serves (a user
    upload on a same-origin media path, for one) can claim any `preferredUsername` on it; the next
    bullet is what closes that.
  - A split-domain deployment is unaffected because its WebFinger `self` link names the actor id
    itself (Mastodon's and this instance's both do), so the requested and fetched ids agree; only a
    `self` link naming a cross-origin ALIAS is refused here, and `getProfileData` still renders that
    profile, persisting it under the rule above.
  - Rows stored before these guards are not repaired: a row whose id is an alias (or a cross-origin
    id) still holds its handle, is still refreshed by its own id, and recording the real id while it
    exists returns nothing (with a warning) instead of throwing — an operator removes it.
  - Pinned by `lib/actions/utils.actorBinding.test.ts` and
    `app/(timeline)/[actor]/getProfileData.actorBinding.test.ts`, which run the real
    `getActorPerson` against a real database and bracket the guard on both sides.
- **Every ActivityPub GET reads a body only when it is labelled ActivityPub, and a new remote actor row is created only when its host's WebFinger confirms the handle** — the two halves of Mastodon's CVE-2024-23832 fix. Both answer the hole the origin check leaves: a JSON file uploaded to a Pleroma/Akkoma instance that serves media from its own domain is same-origin with every actor there, so it could serve `{ id: <its own URL>, preferredUsername: 'admin', inbox, publicKey }`, be recorded as `@admin@thathost`, and have its key accepted by `getSenderPublicKey` for inbox signatures.
  - **Content type — `isActivityPubDocumentResponse` (`lib/activities/activityPubResponse.ts`).** A 200 is read as a document only when its `Content-Type` is `application/activity+json` (any parameters) or `application/ld+json` whose `profile` lists `https://www.w3.org/ns/activitystreams`; anything else — `application/json`, `application/octet-stream`, `text/plain`, bare `application/ld+json` — is treated like a failed fetch and logged. That is exactly Mastodon's `valid_activitypub_content_type?`, so every server Mastodon federates with already passes; observed: Mastodon, Misskey, Akkoma and PeerTube send `application/activity+json; charset=utf-8` and Lemmy the bare type (GoToSocial answers unsigned fetches with 401, so it was not observed — it federates with Mastodon, which applies the same rule). It is the one thing an upload cannot choose. It gates `getActorPerson`, `getNote`, `getActorCollections` (root and pages), `fetchRemoteStatusJob`, the forwarded-Delete Tombstone in `processForwardedActivityJob` (a 404/410 still confirms; a 200 counts only as a labelled Tombstone), the stamp fetch in `verifyRemoteQuote`, and the inbox key fetch in `getSenderPublicKey`. **A new ActivityPub GET must use it instead of a bare `statusCode === 200`.** WebFinger (a fixed `/.well-known` path an upload cannot occupy) and the non-ActivityPub Misskey/Pixelfed JSON APIs are not gated.
  - **Handle — `confirmActorHandle` (`lib/activities/confirmActorHandle.ts`).** Before
    `recordActorIfNeeded` or `getProfileData` CREATES a remote actor row, and before
    `getSenderPublicKey` accepts the key of a sender with no stored row, WebFinger must name
    `person.id` (normalized) as a `self` link, and the row is written under the handle that
    WebFinger confirmed — never under a username nobody vouched for.
    - **First question: `acct:<preferredUsername>@<host of person.id>` on that host**, and when it
      confirms, the row is `preferredUsername@<actor host>`. **Split-domain deployments confirm
      here** because the actor host answers WebFinger for `user@<actor host>` too (Mastodon's
      `WEB_DOMAIN`, GoToSocial's `host`, Pleroma/Akkoma, this server), naming the handle's domain as
      `subject`; the row keeps the actor host and that `subject` is not asked.
    - **The handle the viewer typed is never asked** — `@x@evil.example`'s own WebFinger can point
      `self` at anyone's upload, which is the profile-page form of the attack.
    - **Second question, only when the actor host does not confirm**, as Mastodon does: the handle
      the actor document names in its FEP-2c59 `webfinger` property or, when that one is malformed
      or cannot be asked (it names the actor host handle itself, as WordPress's always does, a
      blocked domain or this instance), the `subject` the actor host answered with (Mastodon's
      `subject` redirect). Only the first that can be asked is asked. That handle's domain must
      answer with the SAME handle as its `subject` (one hop, no chains) and `person.id` as a `self`
      link, it is checked against the federation policy (`canFederateWithDomain`) and skipped when
      it is this instance (`isLocalFederationDomain`) before it is asked, and the lookup never
      follows a redirect to another host. The row then stores that domain's handle, and
      `localizeAccount` shows a qualified `acct` with the stored domain rather than the id's host.
    - **Accepted trade-off, kept for Mastodon parity:** the `webfinger` property is chosen by the
      document, not its host, so an upload a host serves AS ActivityPub could name a domain its
      author controls, be confirmed there, and be recorded as `x@<that domain>` with an id on the
      host that served it. It can never take a username on that host, but it passes the same-origin
      rules keyed on the actor id (`bindObjectToSender` co-authors, note ids in
      `dispatchCreateNoteOrPollJob`, quote stamps, forwarding) as if it belonged there. The
      content-type gate above already refuses uploads served under any other type, which leaves only
      hosts that serve user uploads as ActivityPub.
    - A malformed `webfinger` or `subject` (more than one `@`, a path, userinfo, a non-`acct` URI)
      is ignored, not followed. A host whose WebFinger is down or does not know the handle gets no
      row; `getProfileData` still renders the profile.
    - **Any `self` link counts, not the first:** Lemmy answers `acct:lemmy@lemmy.ml` with both the
      person and the community of that name, as Mbin does for a user and a magazine sharing a name.
    - **Only creation is gated:** the row fixes `username@domain` until the actor itself renames,
      the refresh paths re-fetch the row's own id and rewrite the handle only through the
      WebFinger-confirmed `confirmRemoteHandleChange` check (an unconfirmed claim aborts the
      refresh; see the remote-rename bullet in
      [architecture.md](architecture.md#agents-actor-profile-deletion-federation)), and a WebFinger
      outage must not stop a known actor from refreshing.
    - **Signature verification is gated too, not only the row:** a row is not the only place a
      handle shows up. `createNoteJob` stores an inbox-delivered note alongside
      `recordActorIfNeeded` even when that records nothing, likes are stored first, and the web post
      renders a status with no actor row as `@<path segment>@<actor host>` linking to the real
      account — so an upload a host serves AS ActivityPub (a media proxy re-serving the upstream
      type) could still post under that host's name if only the row were gated. `getSenderPublicKey`
      therefore confirms the key owner's handle (`preferredUsername` from the owner document, which
      owner validation already fetches for a path-based key) before returning a fetched key,
      Mastodon's order, with the key fetch's own budget (`numberOfRetry: 0`, the 3 s timeout, for
      each of the at most two lookups) and, like it, `allowCrossHostRedirects: false` — it runs
      before the signature is verified, and a hop would reach a host no domain block was checked
      against.
    - **A known signer is never asked:** a `#main-key` keyId whose owner has a stored row is
      answered from the row before any fetch; a path-based keyId (GoToSocial's `/users/x/main-key`,
      which matches no row and so is fetched on every request) skips the lookup once its owner
      resolves to a stored row; and an ACCEPTED relay (`getAcceptedRelays`, matched on its `actorId`
      normalized by `normalizeActorId`; `getRelayByActorId` is not used because an unsubscribed row
      keeps the same `actorId`) skips it too. A relay actor never gets an actor row, so without that
      every relayed post paid a WebFinger lookup on the inbox path and a slow or rate-limited relay
      WebFinger turned its Announces into 401s.
    - A relay accepted since this check existed had its Accept verified through it while pending;
      one accepted before is not re-confirmed, the same caveat as old rows. Any other sender whose
      deliveries never record a row pays one lookup per inbox POST; signed GETs never reach this
      path.
    - Rows created before this check are not re-confirmed — the same "operator removes it" caveat as
      the alias rows above.
    - **User domain blocks match both the actor id's host and the stored handle domain** at the read
      sites (`getRelevantStatusDomains` reads `status.actor.domain` and the boosted author's,
      `getRelationship`'s `domain_blocking` checks the target row's `domain` too), because a client
      takes the domain to block from the `acct` it shows.
    - The follow-severing on a new block and instance-level domain policy still key on the id's host
      only, so blocking a redirected handle domain hides the account but does not sever its follows;
      blocking the id's host does both.
    - Pinned on both sides by the `refuses a handle its host does not vouch for` block in
      `lib/actions/utils.actorBinding.test.ts` (forged upload, missing WebFinger, wrong host, a
      FEP-2c59 `webfinger` handle stored under its domain, a `subject` redirect stored under its
      handle, Lemmy's two `self` links, refresh without WebFinger, accepted and refused content
      types), `renders but does not record an actor whose host does not confirm its handle`,
      `records an actor its webfinger domain confirms under that domain` and `records an actor under
the handle its host redirects to` in `getProfileData.actorBinding.test.ts`, the content-type
      cases and the `confirms an unknown sender through its host WebFinger` block (subject redirect,
      `webfinger` property, accepted and pending relays), `domainBlockFilter.test.ts` and
      `relationship.test.ts` (stored handle domain) and `does not ask WebFinger about a path-based
key whose owner is stored` in `getSenderPublicKey.test.ts`,
      `lib/activities/confirmActorHandle.test.ts` (host with port, host-case noise, host-less ids,
      the `webfinger` property, its precedence over the redirect's subject and the fallback when it
      cannot be asked, chain, domain-block, own-instance and malformed-subject cases),
      `lib/services/accounts/localizeAccount.test.ts`, and
      `lib/activities/activityPubResponse.test.ts`.

<a id="agents-actor-usernames-are-case-insensitive"></a>
<a id="review-actor-usernames"></a>

### Actor Usernames Are Case-Insensitive

A local actor's username is not a label on its identity, it **is** its identity: `getLocalActorId` builds `https://<domain>/users/<username>` and every ActivityPub id downstream is derived from that string (`getLocalStatusId` is literally `${actorId}/statuses/${n}`). So casing is a correctness question on two separate axes, and both are handled. (The in-place rename softens this in one direction only: the id and every id derived from it keep the username they were minted with forever — what a rename changes is the stored handle, the Person document's `preferredUsername`/`webfinger` and the profile URL, while the ledger keeps the old ones resolving. See the handle-rename bullets in [architecture.md](architecture.md#agents-actor-profile-deletion-federation).)

- **Every local username this instance MINTS is lowercased** — trim then lowercase, deliberately as
  minimal as `normalizeEmail`. It is layered the same way email normalization is:
  `localUsernameSchema` (both creation routes), `registerAccount` (so a direct service call cannot
  bypass the schema), and `createAccount`/`createActorForAccount`. The last two normalize into a
  local variable that feeds BOTH the `username` column and `getLocalActorId`, so the column and the
  id are derived from one value and cannot drift.
  - **There are TWO spellings of the rule, not one**: `normalizeUsername`
    (`lib/utils/normalizeUsername.ts`) and the schema's own Zod `.trim().toLowerCase()` chain —
    exactly the relationship the email schemas have with `normalizeEmail`. Nothing makes them agree
    by construction, so `localUsername.test.ts` asserts `localUsernameSchema.parse(x) ===
normalizeUsername(x)` over a table; teach one to strip a trailing dot and that test is what
    catches the other not following.
  - And `createAccount`/`createActorForAccount` are the two ACCOUNT-facing mint paths, **not** the
    only places a local actor row is written: `getFederationSigningActor`
    (`lib/database/domains/actor/federationSigner.ts`) inserts its own row with a non-empty
    `privateKey`, touching neither method. It is safe because it derives its `username` and its
    `getFederationSigningActorId` from one variable too — the same argument, made separately.
  - And because every new mint is lowercase, a mint race is a lowercase-vs-lowercase collision the
    case-sensitive `actors` unique index still catches.
- **Folding in `localUsernameSchema` runs BEFORE the reserved-name refine, and that ordering is load-bearing.** `isFederationSigningActorUsername` is a case-sensitive `startsWith('__instance__')`, so `__INSTANCE__` passed the check and minted a confusable neighbour of the instance actor at a _different_ id. Sitting before `.max()` is defensive only, NOT load-bearing: the one lengthening mapping is `İ` -> `i` + U+0307, and U+0307 is not in `LOCAL_USERNAME_PATTERN`, so the regex refuses such input wherever `.max()` sits. `LOCAL_USERNAME_PATTERN` still names `A-Z` on purpose: it describes what a caller may SEND, and by the time it runs there is none left.
- **Username lookups fold through `findActorRowByUsername`** (`lib/database/kysely/usernameMatch.ts`, for both `getActorFromUsername` and `isUsernameExists`) — covering `/@user`, the whole ActivityPub surface behind `OnlyLocalUserGuard`, WebFinger, mentions (which go through WebFinger), `/api/v1/accounts/lookup`, `authorize_interaction`, the actor archive, and the `resolve=true` branch of both search routes. **It is not yet universal, so do not read the rule as one:** `getExactAccountIds` (`lib/database/domains/search/accounts.ts`) resolves an exact handle with a lone `LOWER(username) = ?` **and** a `LOWER(domain) = ?` — no exact arm, no precedence ordering — and it runs on EVERY `searchAccountIds` call, not only the resolve branch. So search and lookup disagree on `alice@Example.COM`, and the SQLite ASCII-fold gap below is live in that one path. Pre-existing; unifying it is its own change. `isUsernameExists` folding is what stops a second `Alice` from being minted beside an existing `alice`.
- **It is exact-match-first, then folded — NOT a single `lower(username) = ?`, for two independent reasons.** (1) SQL `lower()` and JS `toLowerCase()` are not the same function: SQLite's builtin folds ASCII only, so a remote actor named `Фёдор` has its stored value fold to `Фёдор` while the JS side folds the identical input to `фёдор`, and a fold-only query stops finding a row that resolves today. Trying exact first means no lookup that works now can break, on any backend, for any charset. (2) Local actors minted before normalization keep their casing — their ids are already federated, so they are deliberately NOT migrated — which means an instance can hold both `Alice` and `alice`, and `/@Alice` must not start resolving to `alice`. "Exact wins" says that without a tiebreak clause. The folded arm orders by `createdAt` then `id` so an unmatched casing resolves to whoever claimed the name first, rather than to whatever the index yields. It folds with a bare `toLowerCase()`, **not** `normalizeUsername` — that also trims, and a trim here is not a fold at all: it compares a TRIMMED input against an UNTRIMMED `lower(username)`, so `' alice '` found `alice` while `alice` could never find a stored `'alice '`. An asymmetric match can only ever ADD rows, so `/users/%20alice%20` can serve alice's whole ActivityPub surface. (Shared-cache keys are NOT the reason — case folding creates URL variants regardless.)
- **The `20260826120000_add_actors_lower_username_index` migration added the functional index the
  folded arm reads** — `(lower(username), domain)`, identical on both backends
  (`lib/database/testing/schemaInvariants.test.ts` pins it). Without it the folded arm sequentially
  scans `actors` on exactly the requests least able to afford it: an unknown handle (404 traffic),
  the first lookup of a remote actor, account search — on a table that grows with every remote
  account this instance has ever seen.
  - Verified an index scan with both columns as index conditions on PostgreSQL 17 (50k rows) and
    SQLite.
  - It is **not unique**: an instance may already hold a case-colliding pair, and a unique index
    would refuse to build there; collision is refused at the application layer by
    `isUsernameExists`.
  - **MySQL is skipped rather than translated.** Its default collations (`utf8mb4_0900_ai_ci` and
    friends) are already case-insensitive, so the exact arm folds on its own — and so does
    `actors_username_domain_unique`, so a case-colliding pair cannot exist there at all, and the
    folded arm never runs. A second query would find nothing the first did not and would find it by
    scanning `actors`, since the statement is the least portable of the three (`((lower(username)),
domain)`, no `IF NOT EXISTS` on `CREATE INDEX`, backtick quoting, functional indexes only from
    8.0.13, and never in MariaDB, which the `mysql2` client also reaches).
  - An operator who puts a `_bin`/`_cs` collation on `actors` gets case-sensitive usernames on MySQL
    — the behaviour that backend always had, not a new regression.
  - `lib/database/testing/schemaInvariants.test.ts` reads the index definition (`sqlite_master` on
    SQLite, `pg_indexes` on PostgreSQL) because a revert is invisible in results — every functional
    test passes against a table with no index at all, and `PRAGMA index_info` reports a null column
    name for an expression.
- **A reserved username is reserved case-INSENSITIVELY, and `OnlyLocalUserGuard` enforces that at
  the URI.** Resolving by username is what made this necessary: `__INSTANCE__` was registerable
  before the refine folded casing, and the folded arm answers a request for `__instance__` with that
  account's actor — a user-owned Person document, inbox, outbox and followers served at
  `getFederationSigningActorId(domain)` itself, past the `actor.account` check and without
  `allowFederationSigningActor`, until `getFederationSigningActor()` first runs on that domain.
  - The guard therefore 404s a request whose segment folds to a username this instance could itself
    MINT a signer on — `isFederationSigningActorIdUsername`, `/^__instance__([1-9]\d*)?$/` — unless
    the resolved actor IS the genuine signing actor, gated on the REQUESTED segment rather than the
    resolved row.
  - **That is deliberately narrower than the `isFederationSigningActorUsername` prefix the mint
    refine reserves, and the two must not be unified.** The prefix form de-federates a legacy
    `__instance__archive` or `__instance__0` account — 404ing an actor document and inbox that work
    on `main` — while the precise form is not "every id that can ever be a signer" either:
    `getExistingHeadlessActor` ADOPTS any headless `__instance__%` Service row and validates it with
    the loose form, so an instance can legitimately sign as `__instance__archive`. Narrowing
    `isValidFederationSigningSQLActor`/`isFederationSigningActor` onto the precise form would
    silently end federation signing there.
  - The guard survives the split because an adopted signer's name falls outside the precise
    predicate, so the reserved-name test never fires for it.
  - Serving the genuine signer needs BOTH of the guard's checks — `isAllowedActor`'s
    `allowFederationSigningActor` disjunct (an accountless signer reaches the handler only through
    it, on the 9 of 14 invocations that opt in) and the `!isFederationSigningActor(actor)` conjunct
    (which covers a signer whose name the minter CAN emit). Neither is redundant with the other.
- **`OnlyLocalUserGuard` resolves by username, not by rebuilding the actor id from the path segment.** It fronts the entire ActivityPub surface — actor document, inbox, outbox, followers, following, statuses, collections — and the rebuilt id could only ever match one spelling, so it answered `/api/users/Alice` and 404'd `/api/users/alice` while every human-facing surface folded. The host binding is unchanged: matching `domain` against `headerHost` is the same constraint as requiring the id to have been minted on this host, because both are written from one value at mint time.
- **`domain` matching inside the lookup stays case-sensitive**, which is what it already was — folding it is a separate change with its own index implications. Do NOT justify that by saying callers normalize it first: `parseAccountHandle` does, but `app/api/v1/accounts/lookup/route.ts` has its own locally-shadowed `parseAccountHandle` that does not, and `resolveStatusFromPath.ts` splits the segment inline with no normalization at all. `getWebFingerResponse` carries its own exact-then-lowercased domain fallback precisely because that is not a guarantee.
- **A remote username is validated like Mastodon's `Account` model** (`USERNAME_ONLY_RE` =
  `/\A[a-z0-9_]+([.-]+[a-z0-9_]+)*\z/i`, after `squish`): `isValidRemoteUsername` / `squishUsername`
  in `lib/utils/username.ts`, ASCII only.
  - The length limit is the smaller of Mastodon's 2048 (`USERNAME_LENGTH_HARD_LIMIT`) and the 255 of
    the `actors.username` column, so 255. `squishUsername` follows Rails' `[[:space:]]`: U+0085 is
    whitespace, U+FEFF is not. A stored username cannot start with `=`, `+`, `-` or `@`, so a
    hostile server cannot plant a spreadsheet formula in a CSV export.
  - The one chokepoint is `confirmActorHandle`, which every path that CREATES a remote row passes
    (`recordActorIfNeeded`, `getProfileData`, `getSenderPublicKey`). As in Mastodon, what is
    validated is the handle that would be STORED, not `preferredUsername` itself: an invalid claimed
    name (logged) only disqualifies the host handle, so the handle can still come from the FEP-2c59
    `webfinger` property, or, when the claimed name is still URL-safe, from the `subject` the host
    answers with (`check_webfinger!`).
  - Every candidate is validated by `parseAcct`; if none confirms, `confirmActorHandle` returns
    `null`, the actor is not recorded and a `Refused remote actor whose handle WebFinger does not
confirm` line is logged.
  - The refresh paths (`updateActor`, inbound `Update(Person)`) follow a rename only through the
    WebFinger-confirmed `confirmRemoteHandleChange` check (see
    [architecture.md](architecture.md#agents-actor-profile-deletion-federation)): a claimed handle
    that does not confirm aborts the whole refresh, so a profile is never recorded under an
    unconfirmed handle, and the stored username is otherwise never rewritten.
  - A new LOCAL username must satisfy the same rule (`localUsernameSchema`: no leading or trailing
    dot or dash), so peers that apply Mastodon's rule can federate with it; existing local rows are
    untouched.
  - Rows stored before this check are not migrated; the CSV exports (`lib/services/exports/`) omit a
    remote actor whose stored username is invalid and log it, as Mastodon could never hold such a row.
    Valid rows are exported byte for byte.
- **Remote usernames are stored verbatim.** A remote server mints its own ids and chooses its own casing; we fold when _matching_ them, never when persisting. WebFinger answers with the STORED casing too (`subject` and the profile-page alias are built from `actor.username`), so a client that echoes the subject back gets the canonical handle rather than the casing it asked with.

<a id="agents-status-posts-actions"></a>

### Status Posts & Actions

Every surface that renders a status post — the home timeline, profiles, lists,
favourites, bookmarks, hashtags, search, and the status **detail**
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
  **Exception — the timeline's combined post** (`CombinedPostListItem`, a run of
  quick self-replies shown as one row): repost, like, bookmark and react for the
  parts live on its one shared action bar and act on the first post, and reply
  goes to the latest post (`Actions`' `splitTargets`). Every later part and every
  tucked-in reply still keeps its own `⋯` menu (the same `PostMenu`, so quote,
  copy link, open original, mute, block, report, translate and edit/delete-own
  all work on that post), and "Show as separate posts" gives each post its full
  action bar. A new combined-style surface must not drop a post's `⋯` menu.
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
  post, where each row already sits at its own container's padding edge: the
  reaction chips in the post body (`p-4`) and the action row alone in the footer
  (`px-4`), both 16px from the post's edge, so neither pulls back.
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
  out the post — `Post`, or the activity page's `ActivityPostFrame`, which builds its own post and
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
  action row.** The fitness detail lays out its own post and therefore places
  the two halves of the reaction control by hand — `ReactionRow` in the post
  body under the figure band, and the picker trigger in the row below — but the row
  itself is the shared `<Actions>` (`fullBleed={false}`, its own
  `useReactionState` passed in), not a local copy. A hand-rolled row is exactly
  how that page drifted into a right-packed cluster with its own gaps while
  every other surface used the shared spacing.
  It now drives the shared `useInlineComposer` / `InlineStatusComposer` too, so
  **Edit and Quote are in its `⋯` like everywhere else** — the composer renders
  in the post, under the action row that opened it. `editable`
  without `onEdit` would only render a menu item that does nothing, so the two
  are wired together or not at all. Reply opens the same inline composer, at
  the top of the replies in the post, and shows the replies again if
  the reader had hidden them.
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

#### Post media layout (`attachments.tsx`)

Post media layout rules (strip, grid, crops, captions, composer tiles) live in [docs/architecture.md → Post media layout](architecture.md#review-post-media-layout).

- **A lone picture is scaled by width — `min(100%, round(SINGLE_MAX_HEIGHT * ratio)px)`, capped at the file's own pixels so a thumbnail is never upscaled — never by capping the height of an `aspect-ratio` box**, which leaves the ratio to be re-derived from a clamped axis and is resolved inconsistently across browsers. Not `w-full`, not `aspect-video`.
- **`flex-none` on each strip item is what makes the strip overflow at all.** Without it the default `flex-shrink` squeezes every item to fit, so `scrollWidth === clientWidth` forever: no arrows, no peek, no scrolling, and every photo cropped. The whole feature turns off silently, which is why a test pins the class — jsdom lays nothing out, so nothing else at that level can carry the rule.
- **`STRIP_ITEM_MAX_WIDTH` (78%) and `scroll-snap-type: x proximity` are load-bearing, not tidy numbers.** No item can fill the strip, so the next one always peeks past the edge — the peek is what says "this scrolls" on a touch screen — and `mandatory` snapping pulls the peeking item onto the settled line as soon as the scroll settles and destroys that affordance.
- Captions expose independent Show more / Show less controls when their measured content exceeds the three-line clamp.
- **Every picture button carries an explicit `aria-label`.** `Media` names an image from its `alt`, but `attachment.name` is a required string that federation writes as `attachment.name || ''`, so an undescribed photo left the button announcing as a bare "button". Use the same wording as `ActorMediaGallery`: the description when there is one, `Open media <n>` otherwise.
- `MessageBubble`'s media cells carry `focus-visible:ring-inset` over the same full-bleed image shape, so their focus indicator is invisible too — a pre-existing bug, not a precedent to copy.

<a id="agents-local-usernames-are-actor-id-path-segments"></a>

### Local Usernames Are Actor-Id Path Segments

- **A local username is validated by ONE schema, `localUsernameSchema`
  (`lib/services/accounts/localUsername.ts`), because the charset is a correctness rule rather than
  a style preference.** `getLocalActorId` builds `https://${domain}/users/${username}` and does
  **not** percent-encode it, so at MINT time the username IS a path segment of the actor's canonical
  id — and a path segment is percent-**decoded** on the way back in. Since the in-place rename
  (`/api/v1/accounts/handle`) the coupling is one-way and frozen: the id keeps the username it was
  minted with forever, while the stored username can change, so after a rename the id's path segment
  is the handle the actor gave up, not its current one (see the handle-rename bullets in
  [architecture.md](architecture.md#agents-actor-profile-deletion-federation)).
  - Both creation paths used to let `%` through: `POST /api/v1/accounts` had an **unanchored**
    `/\w+/` (which only requires one word character _anywhere_, so `%6eull`, `nul%6c` and `a%2Fb`
    all passed) and `POST /api/v1/actors` had no charset check at all, only a length. So an account
    could be registered whose stored, federated id was `https://<domain>/users/%6eull`, and
    dereferencing that id decoded the segment to `null` and served whichever actor owns THAT name —
    their Person document, their public key, their outbox and followers — under a URI belonging to
    someone else.
  - Proved against Next's own route matcher: `/api/users/%6eull` and `/api/users/nul%6c` both match
    as `{ username: 'null' }`.
  - This is not hypothetical here, where the owner's account is genuinely named `null`.
  - It is identity/URI confusion, **not** signature forgery — the holder of the alias has no private
    key for the actor whose document is served — but `Block` and the `Undo` handlers pass the
    guard-resolved `actor.id`, so those do land on the impersonated actor.
- **Anchoring is the whole point, so pin it with a test rather than trusting the regex to read correctly.** Both the unanchored-`/\w+/` revert and dropping `^`/`$` from `LOCAL_USERNAME_PATTERN` leave a schema that still rejects `''` and `..`, so it looks like it is working; `localUsername.test.ts` and the two route-level suites fail on the percent-encoded cases specifically.
- **Do NOT unify it with the `USERNAME_PATTERN` in `getFallbackBlockedAccount`/`getFallbackMutedAccount`.** Those decide whether a **remote** actor id's last segment is safe to _display_ as a username. A remote server may legitimately mint names this instance refuses, so the two rules only look alike; sharing one constant would let a change to the local minting rule silently move what remote names render.
- **Sharing the schema also newly bounds a registered username at `LOCAL_USERNAME_MAX_LENGTH` (50), which registration did not previously enforce at all** — `POST /api/v1/actors` carried that limit, `POST /api/v1/accounts` carried none. That is a deliberate tightening rather than a preserved rule: `actors.username` is `varchar(255)`, so a longer name was storable and a 256-character one overflowed the column and 500'd on PostgreSQL instead of being refused.
- **Validation is on creation only, so it cannot clean up rows that already exist.** An instance already holding a `%` in a username, or a name longer than the cap, keeps it — the schema is only consulted when a name is minted. If an instance has been running with the old schemas, check the stored usernames for a `%` before assuming the alias cannot already be present.

<a id="agents-local-actors-does-this-server-host-this-actor"></a>

### Local Actors ("does this server host this actor?")

- **The SQL test is `privateKey IS NOT NULL AND privateKey <> ''`, and it belongs to `isLocalActor` (`lib/database/kysely/visibility/localActor.ts`) — never write either half by hand.** Actor rows written by earlier remote-recording paths store the key they do not have as an **empty string**, not NULL. A null-only check therefore counts them as local: on production that was **216 of the 221** rows it matched, all on remote domains, which made the logged-out local timeline majority-remote. (It also put every domain those actors live on into `getLocalFollowersForActorId`'s "local domains" set — real, but unreachable: that method currently has no production callers.) The `20260821120000_normalize_empty_actor_private_key` migration rewrote the stored `''` to NULL; the `<> ''` half stays anyway, for databases restored from an older dump. It takes the `actors` expression builder, so a query on `actors` passes it straight to `where`: `.where(isLocalActor)`.
- **The JS test is truthiness — `Boolean(actor.privateKey)` — never `actor.privateKey !== ''`.** `getActorFromRow` omits `privateKey` from the domain object unless it is truthy, so the field is a real key or `undefined` and is **never** the empty string. `!== ''` is therefore always true: it reads like a local-actor filter and filters nothing. That is what let `addStatusToTimelines` fan every status out to remote recipients, giving them home-timeline rows and reply/mention notifications on accounts this server does not host.
- **The local public timeline must NOT join `actors`; it passes the local actor ids in as literal
  values** (`localPublicStatusesQuery`, `lib/database/domains/timeline/localPublic.ts`). Joining on
  `actors.id` — a unique key — leaves the planner no statistic correlating an actor with how much it
  posts, so it assumes an even spread.
  - On production that under-estimated the eligible rows ~48x (150 against 7,262) and the plan
    changed with `limit` alone, crossing over at 24: a page of 23 ran the ordered index scan in
    ~1ms, while the API's own default of 30 flipped to a parallel sequential scan of `actors` plus a
    sort — ~88ms and 35,108 buffers.
  - A local seed reproduces production's row counts but not its statistics, so it does not show that
    crossover; what it shows is worse. Buffers at limit 23/24/30 on a local PostgreSQL 17 seeded to
    production's shape: **literal ids 137/142/176; either join form carrying `<> ''` ~16,700 flat at
    every size; the same join with `IS NOT NULL` alone ~160/~164/~200.**
  - PostgreSQL compiles the inner join and the `whereExists` fallback to one plan, so the fallback
    is not the cheaper shape; only the literal-id form early-terminates (`Heap Fetches: 0`), which
    is why it is the only figure quoted exactly.
  - So it is the CORRECTNESS predicate that costs the plan — with it present, either join form loses
    early termination at _every_ page size, and widening the partial `actors_local_idx` predicate to
    match does not recover it.
  - The id read is itself capped at one past what the query can bind (`getLocalActorIdLimit`) — it
    runs on an anonymous path, and above the cap the list is discarded in favour of the semi-join,
    so fetching it whole would be pure waste.
  - **Adding `<> ''` to the join form without switching to literal ids makes this query dramatically
    worse** — the two halves of that change are not separable. `localPublicQueryShape.test.ts` pins
    the shape, because every result-based assertion passes against the slow one.
- **"Is this domain ours?" is answered by `isLocalDomain` / `getLocalDomainMatcher`
  (`lib/services/domains/localDomains.ts`, built on `createServedDomainMatcher` in
  `lib/utils/host.ts`), resolved per request — never `=== getConfig().host`.** The served domains
  are `ACTIVITIES_HOST`, the CONCRETE `ACTIVITIES_TRUSTED_HOSTS` entries and the domains turned on
  in Admin › Served domains (through `getServedHostConfig()`).
  - Multi-domain actor resolution is strictly per-domain: `null@llun.dev` and `null@llun.social` are
    distinct actors with separate followers and timelines, so a handle or username that does not
    exist on the queried served domain must return 404 and never alias across served domains (the
    former cross-domain `aliasServedLocalActor` fallback was reverted in #1019 for this reason).
  - Account search, lookup and v2 search use it to decide whether to WebFinger, `handleQuoteRequest`
    to refuse an inbound quote of our own note, forwarding to drop our own inboxes, inbound
    reactions to keep our actors' bare emoji shortcodes, and `processForwardedActivityJob` /
    `createRelayAnnounceJob` to skip re-fetching our own objects; before, each of those compared
    against the primary host alone, so a server on a second domain forwarded to itself and
    namespaced its own actors' emoji.
  - **A wildcard trusted host is not a served domain**: it exists to believe `X-Forwarded-Host`
    (`*.vercel.app` previews), not to claim every subdomain as this server.
  - **`federation.allowActorDomains` is not a served domain either**: it keeps its two older roles —
    the domains actors may be created on (`lib/services/domains/actorDomains.ts`; only its concrete
    entries count, a wildcard entry approves no actor domain, and a list of only wildcards approves
    nothing; when it is empty, the primary host, concrete trusted hosts and the Admin › Served
    domains rows that are on with "Existing users can add profiles here" on, so a wildcard trusted
    host never approves actor creation) and the federation-policy exemption — because in `allowlist`
    mode the admin form presents it as "Allowed servers", so it can hold remote servers.
  - `resolveAccountTarget`, `fetchQuoteTargetForCreate`, `persistInboundQuoteEdge`,
    `fetchEphemeralRemoteStatus`, `resolveActorRedirect` and `confirmActorHandle` still call
    `isLocalFederationDomain` (served domains plus `allowActorDomains`), unchanged.
  - The federation policy's `isLocalFederationDomain` / `canFederateWithDomain` / `isDomainAllowed`
    / `filterFederatedUrls` exempt the served domains plus `federation.allowActorDomains` (its
    wildcards included).
  - Comparing the port matters: the policy's `getDomainFromUrl` drops it, so locality is decided on
    the full URL, not on the domain the block lookups use.
  - Widening "local" only skips work — no fetch, no WebFinger, no domain-block or allow-list lookup,
    no forward — and never stands in for a signature or ownership check; every rule is operator
    configuration, and an authority spelled with a `*` (literally, or `%2a` that the parser decodes)
    matches nothing, so a remote server cannot become local by spelling a rule.
  - The matcher is built once per call site (`createServedDomainMatcher` /
    `createHostRulesMatcher`), never per URL inside a fan-out loop.
  - Separately, `isOwnInstanceHost` answers for the host and every trusted host, wildcards included
    — the set better-auth trusts and `selectHeaderHost` accepts — which is what the media-URL
    helpers and the account-domain email links (`getServedLinkDomain`) need.

<a id="agents-who-may-see-an-actor-s-statuses"></a>

### Who May See an Actor's Statuses

- **`getActorStatuses` and `getAttachmentsForActor` FAIL OPEN: with none of `publicOnly`, `visibleToActorId` or `includeFollowersOnly` set, no visibility predicate is applied at all.** That is a real mode, not an oversight — it is how the owner sees their own private posts, and how `scripts/backup/actorArchive.ts` exports a complete history — but it means a caller that simply forgets the arguments gets the unfiltered query and no error. The profile page forgot them: `getProfileData` passed only `currentActorId`, which is **hydration-only** (it decides like/bookmark/reaction state, never which rows come back), so `/@user@domain` server-rendered the actor's followers-only posts and their direct messages **to logged-out visitors**, and the `getAttachmentsForActor` call beside it put those posts' images in the Media tab. `GET /api/v1/accounts/:id/media` — the "Load more" behind that tab — served the same set to anyone, with no session at all.
- **Resolve the audience with `resolveActorStatusesAudience` (`lib/services/statusAccess.ts`); do not spell the four arguments out per call site.** It answers `{ isOwner, isFollower, publicOnly, visibleToActorId, includeFollowersOnly, followersAudience }` from `(targetActor, currentActor)`, and it takes `Actor | null | undefined` deliberately. The `publicOnly: currentActor === null` spelling the statuses route used is safe **there** — `OptionalOAuthGuard` hands its handler `Actor | null`, never `undefined` — but it is not safe as a general rule: `getProfileData`'s viewer arrived through an OPTIONAL field a caller could simply omit, which the followers and following pages did, and for `undefined` that comparison is false, so the viewer reads as signed-in and all three arguments come out falsy. Normalising inside the resolver is what makes an omitted viewer fail closed instead of unfiltered.
- **The followers and following pages load `getProfileIdentity`, not `getProfileData`** (both in
  `app/(timeline)/[actor]/getProfileData.ts`).
  - They render only the actor's name, handle and follower/following counts, and for a local account
    `getProfileData` also loads the first page of statuses with full hydration, attachments, the
    fitness and gallery tab flags, gallery settings and a per-status `canActorReadStatus` pass — all
    thrown away.
  - `getProfileIdentity` shares `getProfileData`'s local-account gate (`findLocalProfileActor`: the
    handle split, the case-folding `getActorFromUsername`, and the `actor.account` check) and
    answers a local account from that one actor row — its `followersCount`/`followingCount` come
    from the same `total-followers:`/`total-following:` counter rows
    `getActorFollowersCount`/`getActorFollowingCount` read, defaulting to 0 the same way — in a
    handful of statements touching only `actors`, `accounts` and `counters`.
  - It returns no statuses, attachments or tab flags, so there is no audience to scope. Anything
    that is not a local account goes through `getProfileData`'s remote branch
    (`getRemoteProfileData`) unchanged: a signed-out visitor gets null (a 404), and a signed-in
    viewer gets the fetched profile with the same federation gates, persistence and counter sync.
    Its viewer is required just like `getProfileData`'s.
  - `getProfileData.identity.test.ts` pins the table set and bounds the statement count (at most 8)
    on a real database, and checks that both functions agree on the person and counts for exact-case
    and different-case handles. A new page that shows only who an actor is should use
    `getProfileIdentity` too.
- **The viewer's own follow row is read through `getViewerFollow`
  (`lib/services/getViewerFollow.ts`) on read paths, and through
  `database.getAcceptedOrRequestedFollow` everywhere else.** Rendering `/@user@domain` for a
  signed-in non-owner asks for that one row twice from two places that cannot see each other —
  `resolveActorStatusesAudience`, to decide whether followers-only posts are in scope, and
  `getRelationship`, for the follow button's state plus its reblog/notify preferences and language
  filter — so the helper wraps the lookup in React `cache` and the two collapse into one query per
  request.
  - It takes `(database, viewerId, targetActorId)` **positionally**: `cache` keys on argument
    identity, so the options-object spelling the database method itself uses would allocate a fresh
    key on every call and memoize nothing.
  - **Read paths only.** Follow, unfollow, block and follow-request authorize/reject each read the
    row, mutate it, then report the result through `getRelationship`; they reach the helper only
    _after_ their own write, which is a cold read, and routing one of their pre-mutation reads
    through it would make the response describe the state they just replaced.
  - `canActorReadSingleStatus` stays on the direct call, and that is a scope boundary rather than a
    claim that it never repeats — it does. It asks about whoever wrote a boosted ORIGINAL, once per
    status in `getProfileData`'s own per-status pass with no `followerStateByActorId` prefetch, so a
    profile carrying two boosts of the same followers-only author issues that query twice. Routing
    it through the helper too would collapse that as well and is safe, but it reaches a dozen
    further call sites (inbox handling, status create/edit, search, polls), most with no request
    scope at all, so it is left for its own change.
- **A REMOTE actor's live outbox is filtered to public and unlisted notes by `getActorPosts` itself.** The remote profile page and `GET /api/v1/accounts/:id/remote-statuses` fetch it signed by the shared instance actor, which follows some remote actors, and a server that filters its outbox by signer (Mastodon does) can hand that follower its followers-only and direct notes. Any local viewer would then read what the remote only authorised the instance actor to see, so `getActorPosts` drops every Create note — fetched, embedded, or resolved from a stored row — that `isPublicOrUnlisted` rejects, and every Announce whose ORIGINAL it rejects, whether that original was stored or fetched (a remote may boost its own followers-only post).
- **Live-outbox statuses are never persisted, so a status action that only reads must not assume a row.** `POST /api/v1/statuses/:id/translate` reads the stored row first and, when there is one, decides on it alone (`canActorReadStatus`, 404 if unreadable, no network call). Only an id with no row falls back to `fetchEphemeralRemoteStatus` (`lib/services/statuses/fetchEphemeralRemoteStatus.ts`), which fetches the note live with the instance signer and returns it **without storing it**: it refuses non-URL ids, local domains and domains the federation policy rejects (request URL and author), requires the fetched `id` to be same-origin with the requested URL and the author same-origin with that `id` (see [A Fetched Document's Own `id` Is Not Evidence](#agents-a-fetched-document-s-own-id-is-not-evidence)), and serves only public or unlisted notes. It uses `getNote` rather than `getRemoteStatus` so the author's server is not contacted before the attribution check passes, and records the author's actor row (`recordRemoteActorBestEffort`, as search-with-resolve does) because the Mastodon serializer reads the account from the database.
- **The SQL scope is necessary but not sufficient — pair it with `canActorReadStatus`.** The recipients predicate matches a status's own audience and cannot see through a boost: an Announce is public while the status it boosts may not be. Every status-serving path does both (`GET /api/v1/accounts/:id/statuses`, the outbox route's `isStatusPubliclyReadable` pass, and now `getProfileData`).
- **One subquery decides both tables.** `actorVisibleStatusIds` (`lib/database/kysely/visibility/actorVisible.ts`) returns the actor's visible status ids, or `null` for the unfiltered mode; `getActorStatuses` filters `statuses.id` by it and `getAttachmentsForActor` filters `attachments.statusId` by it, so an attachment is withheld from exactly the viewers its post is. `actorVisible.test.ts` pins what it selects for every audience. Never scope one without the other — a gallery that outlives its timeline's filter leaks the same posts as image URLs.
- **Where a required argument fits, use it; `lib/database/statusVisibilityCallSites.test.ts` covers the case where it does not.** `getProfileData`'s viewer IS required (`currentActor: DomainActor | null`, and the options object with it, as for `getProfileIdentity`), so the compiler rejects an omission — which is what the original bug was — at every call site, including ones no directory scan would reach. The two database methods are the case a type cannot serve: their unfiltered mode is legitimate, so a required discriminant would make both honest callers restate an intent it still could not verify, and rewrite hundreds of existing calls. Those are enforced by the test instead: every call must state a visibility argument, spread or name a local object that carries one, or carry the `visibility-unfiltered` marker in a comment explaining why. It reads the AST rather than matching names — a name-based rule was defeated four times, by a `...maxIdScope` pagination cursor, by a decoy named for an audience carrying no viewer, by an aliased import that made a call site vanish entirely, and by `database?.getActorStatuses(…)`, whose optional chaining hid it from the walk. Its one documented blind spot is a default re-export, which needs cross-module resolution.
- **The gallery methods (`getGalleryMediaPage`, `getGallerySubjects`, `getGalleryLifeList`, `getGalleryMapPoints` in `lib/services/gallery/galleryQueries.ts`, and `getGalleryMediaByIds`) take a required `GalleryAudience` and have no fail-open mode.** `owner` is the only unfiltered audience; a viewer audience whose flags are all falsy is coerced to `publicOnly` in the gallery scope (`lib/database/kysely/visibility/galleryMedia.ts`), not by `toGalleryAudience` (which copies the flags through unchanged), so a caller that forgets them gets the public view, not everything. Do not loosen that database-layer coercion. Their attachment filter reuses `actorVisibleStatusIds`, so a photo is withheld from exactly the viewers its post is, and `getGalleryMediaByIds` re-applies the scope instead of trusting the ids it is given.
- **The gallery's place rule takes both its options, and no caller may default them.** `getPublicPlace(details, { hiddenLocations, hideThreatenedPlaces })` and the projection's `settings` pick (`showGear`, `hiddenLocations`, `hideThreatenedPlaces`) have no optional fields, and every `PublicPlaceInput` field is required, so a read path that selects a new column but forgets to pass it fails to compile instead of reading it as "no subject". The map builds its input with `toPublicPlaceInput(row)`, never by spreading `EMPTY_MEDIA_DETAILS` over a map row. Country counts and `firstPlaceName` are derived from the projected place, not from the stored `placeCountryCode`, for every non-owner audience.

<a id="agents-publicly-readable-status-ids"></a>

### Publicly Readable Status Ids

- **There are two forms of this predicate, and the choice between them is measured rather than
  stylistic: correlated where a LIMIT bounds the rows, set-based where a COUNT has to touch every
  one.** `publiclyReadableStatus` (`lib/database/kysely/visibility/publiclyReadable.ts`) tests one
  row at a time, so an ordered index scan can early-terminate; `publiclyReadableStatusIds` (same
  file) materialises the readable ids as a set, which the planner must finish before `LIMIT` sees a
  single row.
  - `getActorStatuses({ publicOnly: true })` — the signed-out profile page and the outbox page —
    attached the set form and therefore cost the actor's ENTIRE public history on every page load:
    116.9ms / 25,066 buffers on production for 30 rows, and on a PostgreSQL 18.6 seed shaped like it
    (176,000 statuses, 14,900 actors, 435,500 recipients, an actor with 2,097 statuses of which
    1,889 are publicly readable and half are Announces) **33,308-33,311 buffers at limits of 20, 30
    and 40 alike** — the limit bounded nothing — against **325/476/573** correlated, and ~23ms
    against 0.46/0.63/0.74ms.
  - A deep page (cursor 1,500 rows back) is 33,311 / 22.0ms against 1,888 / 2.2ms: the cursor's `OR`
    spelling is a filter rather than an index start condition, so the correlated cost grows with
    page depth, but linearly instead of constant-and-huge.
  - **No index was added** — `statuses_actorId_idx` already serves the ordered scan (Index Scan
    Backward, plus an Incremental Sort for the `id DESC` tiebreak that index does not carry) and
    `recipients_actorId_statusId_idx` already serves the semi-join at `Heap Fetches: 0`.
  - A seed reproduces production's row counts, not its statistics; what it reproduces here is the
    PLAN — same parallel recursive CTE, same ~4,100 `recipients` index searches, same 1,889-row
    HashAggregate and pkey nested loop.
- **TWO call sites keep the set form, for two different measured reasons, and neither is an
  oversight to tidy up.** `getActorStatusesCount` keeps it because the correlated form costs one
  recursive-CTE instantiation per Announce row: a LIMIT amortises that over a page, a COUNT cannot
  amortise it at all, and on the seed it read 40% fewer buffers and still took three times as long
  (15,421 buffers / 54ms against 25,752 / 18ms).
  - `getRebloggedBy` keeps it for a sharper reason — it embeds its filtered reblog set **twice**,
    once as the `visible_reblogs` FROM subquery and again inside the correlated `NOT EXISTS` that
    dedupes to each actor's newest reblog, so a correlated predicate is re-evaluated per row PAIR
    while a materialised id set is computed once and shared.
  - Its candidate set is not this status's reblogs either: `reblogBase`'s legacy `originalStatusId
IS NULL` branch admits every pre-backfill Announce in the instance, so the correlated cost
    scales with instance-wide legacy Announce volume. Measured: **49,474 buffers / 33ms set-based
    against 11,383 / 415ms correlated** — four times fewer buffers and twelve times the wall clock.
    That one was shipped correlated and caught in review, which is why the shape test now pins it.
  - `getStatusReplies` and `getStatusRepliesCount` DID move: one status's replies are a small set
    and both forms measure the same (1,451 buffers / 1.1ms against 1,467 / 1.3ms; 1,448 / 1.1ms
    against 1,464 / 1.2ms).
  - **Being unlimited is not by itself disqualifying — `getStatusRepliesCount` is an unbounded COUNT
    on the correlated form. What costs is the number of evaluations.**
- **Do NOT add a "check depth 1 first, then recurse" fast path to the correlated form.** Spelling the common case as its own correlated `EXISTS` reads like an obvious win and is a disaster: PostgreSQL decorrelates it into a **hashed SubPlan**, sequentially scanning every non-Announce status in the instance and hashing every public recipient row to answer one page. On the seed that turned 476 buffers into 11,294 and 0.63ms into 82ms, and the count into 123ms. The recursive CTE resists that rewrite, which is the only reason the predicate reads as one branch instead of two. Both PostgreSQL and SQLite accept an outer column reference inside a subquery's recursive CTE.
- **`publiclyReadableStatusQueryShape.test.ts` pins which form each call site uses, and it is the only thing that would catch a swap in either direction.** Putting `getActorStatuses` back on the set form (`where('statuses.id', 'in', publiclyReadableStatusIds(…))`) leaves every test in the `status*.test.ts` files (the `getActorStatuses` ones are in `statusActorQueries.test.ts` and `statusReadQueries.test.ts`) and the whole `publiclyReadable.test.ts` suite green — the two forms select identical rows, which is the point — and fails exactly the two assertions that read the SQL. It pins the set form for `getActorStatusesCount` and `getRebloggedBy` the same way. Separately, `publiclyReadableStatusCallSites.test.ts` asserts each `publicOnly` call site actually drops a followers-only row: deleting the filter outright from `getStatusReplies`, `getStatusRepliesCount` or `getRebloggedBy` used to leave the entire suite green. `getStatusRepliesCount` is the one with no backstop — the ActivityPub route handlers re-filter `getStatusReplies`'s array with `isStatusPubliclyReadable`, but the count flows straight into the replies collection's `totalItems`. For `getActorStatuses` the distinguishing fixture is a **public boost of a followers-only note**: the recipients-only fallback returns it and only the announce chain drops it.
- **The anonymous feeds that unwrap boosts use the correlated form too: the local public timeline (`localPublicStatusesQuery` in `lib/database/domains/timeline/localPublic.ts` — the logged-out landing, its threshold count and `/api/v1/timelines/public`).** Each checked only the row's OWN recipients, so a public boost of a followers-only or direct note passed and was hydrated and rendered in full. The local feed keeps its `to: Public` test — that is what "listed" means there — and adds the predicate for the announce chain. Measured on a PostgreSQL 17 seed (200,000 statuses, a fifth of them Announces, 230,000 recipients), the plan keeps its shape — `Index Scan Backward using statuses_reply_created_idx` early-terminating under `Limit`, the chain a correlated SubPlan evaluated only for Announce rows, no hashed SubPlan — at 177/364 buffers for limits of 20/40 against 66/129 before, and the landing's `limit` count at 92 against 18. `getMastodonStatus` additionally drops an Announce whose original the viewer cannot read, which covers the Mastodon-API surfaces whose queries do not follow the chain (home, lists).
- **The reply counter and the hashtag counter count only publicly addressed statuses, because anonymous surfaces serve them.** `CounterKey.totalReply` is `replies_count` on every Mastodon status entity, including the unauthenticated public timeline, and `CounterKey.totalHashtag` is the post count on the logged-out `/tags/<tag>` page; counting followers-only and direct statuses made a private reply, or a private post's tag, observable as a number. Mastodon counts only `distributable?` (public or unlisted) replies too. The rule is `isPubliclyAddressed` (`lib/database/domains/status/status.ts`) at create time — `updateStatusCounters` for replies, the `increaseHashtagCounter` callers in `createNote`, `createNoteJob` and `createPollJob` for tags — and every reversal mirrors it: `deleteStatus` and `deleteActorData` read `selectPubliclyAddressedStatusIds` (`lib/database/domains/status/deletion.ts`) **before** the recipient rows go, and `updateNoteVisibility` moves both counters when an edit crosses the public line. Counters written before this rule were not recounted — they stay as high as the private statuses already made them, and nothing decrements those any more.
- **`actors.lastStatusAt` is public too — it is the account's `last_status_at` and the directory's `order=active` — so a direct status never advances it**, on create (`updateStatusCounters`) or when a delete recomputes it (`recomputeActorsLastStatusAt` takes the newest status addressed to the public collection or a followers collection). Followers-only posts still count, as in Mastodon. The author profile a status embeds (`getStatusActorProfile` in `lib/database/domains/status/rows.ts`) carries `lastStatusAt: null`: nothing renders it there, and public pages serialize statuses whole, which would otherwise date the newest followers-only post to the millisecond. Existing values were not recomputed. **Known residual: `statuses_count` still counts direct statuses.** `CounterKey.totalStatus` — served publicly as `statuses_count` — is incremented for every status, direct included, so polling it can still time a direct message to the polling interval; Mastodon skips direct statuses there too. Closing it is not a one-line gate: the create path (`updateStatusCounters`), the status-delete path (`applyStatusDeletionCounterAdjustments`) and the actor-deletion bulk decrement in `lib/database/domains/actor/deletion.ts` must all apply the same rule, and every stored counter would need a recount, so it is left for its own change rather than gated on create alone, which would make deletes under-count (decrementing a counter the create never incremented, clamped at 0).
- **There is no counter for the public status count, and there cannot be one.** `getActorStatusesCount({ publicOnly: true })` — the ActivityPub outbox's `totalItems` — is the one status count that is computed rather than read from `counters`. An Announce is publicly readable only while the status it boosts still is, and that status belongs to a **different** actor, whose visibility edits and deletes never touch this actor's rows. So a stored `total-public-status:<actorId>` would need fan-out from every other actor's writes to stay exact. The plain total (`publicOnly: false`) has no such dependency and does read `CounterKey.totalStatus`.
- **What cannot be a counter can still be cached for a minute: the outbox root serves `totalItems`
  through `getCachedActorPublicStatusesCount` (`lib/services/statuses/actorPublicStatusesCount.ts`)
  and sends `Cache-Control: public, max-age=60, s-maxage=60`.**
  - The count above is ~100–160ms of CPU over the actor's whole public history, and nothing
    deduplicated it: on 2026-08-25 a burst of 530 outbox root fetches in 11 minutes each recomputed
    it and queued behind one another on a 1-vCPU Cloud SQL instance, taking the query's **average
    wall time to 899ms against ~150ms of real work** — the executions were waiting for CPU, not
    doing more of it (~4 CPU-sec/sec demand against a capacity of 1; no IO wait, no lock wait).
  - A count that lags by up to a minute is within what the collection already promises, since the
    paragraph above is exactly the argument that it cannot be exact anyway.
  - **The cache bounds a burst in two ways and needs both**: the TTL bounds requests arriving after
    a count is computed, and caching the PROMISE collapses the ones arriving while it still runs —
    at ~150ms a count, a real share of them.
  - **Do not drop the concurrent-miss collapsing on the grounds that the CDN absorbs bursts.** That
    was assumed once and does not hold: a shared cache may key on headers that differ per request,
    and a signed server-to-server fetch — what federation actually sends — carries several, so each
    takes its own entry and collapses into nothing. llun.dev's CloudFront policy keyed on
    `Signature` and `Date` when this was written, but that config lives outside this repo and
    nothing here can verify it stays that way, which is the point — whether a given deployment's
    cache collapses a burst is a property of its configuration, not of this response.
  - An unauthenticated caller can also vary an ignored query parameter to the same effect. The
    origin must survive a burst alone; the header is a third layer, not the load-bearing one.
  - Caching the promise rather than the resolved count is also what keeps this to ONE map with no
    in-flight bookkeeping and no reasoning about which settles first.
  - Errors are never cached: a rejection removes the entry, and every waiter sees it rather than
    hanging.
  - Keyed `WeakMap<Database, Map<actorId, …>>` — per database so the production singleton caches
    while each test's throwaway resolves independently, per actor because one instance serves
    several including the headless signing actor, and **bounded**, because entries expire but
    nothing sweeps them and remote servers choose which actors get fetched.
- **The outbox root's cacheability is a per-branch, per-header decision, and both branches state it.** The header is on the **root only**; `?page=true` sends an explicit `Cache-Control: no-store` rather than relying on the ABSENCE of a header — its `orderedItems` reflects live per-status visibility, so a status hidden mid-window must stop being served at once, and omitting the header asserts nothing, it just defers to whatever the cache in front does with an unlabelled 200. The root also **`Vary`s on `x-activity-next-host`, `x-forwarded-host`, `Host` and `Origin`**, which is not decoration: `headerHost` trusts the two custom headers ahead of `Host`, so on a multi-domain instance the same path serves a different actor — different `id`, `first`, `last` and count — per header, and a shared cache that forwarded them without keying on them would serve one domain's collection for another's. `Origin` is there because `getCORSHeaders` reflects it into `Access-Control-Allow-Origin`. `activityPubResponse` grew an `additionalHeaders` pass-through for all of this. It **appends**, which cuts both ways: `Vary` is a list header so a caller's entry correctly joins the `Accept` it already sends, while `Content-Type` is single-valued and a second one corrupts it into `a/b, c/d` — pass `contentType` for that. A CDN still only honours any of these if its cache key includes them.
- **Count straight off `publiclyReadableStatusIds` when the outer query adds nothing beyond the subquery's own scoping — but check that it doesn't first.** `getActorStatusesCount` was `where actorId = ? and id in (<subquery>)`, and the subquery is already scoped to that actor's statuses, so the outer half re-applied a settled predicate at one `statuses_pkey` lookup per returned id plus a sort for the `COUNT(DISTINCT)`: 7,884 of 37,731 shared buffers on a PostgreSQL 18 seed shaped like production (500k statuses, an actor with 2,000 of them, half Announces). **`getStatusRepliesCount` is deliberately NOT that case and must keep its outer query** — the reason is recorded at that filter in `lib/database/domains/status/reads.ts`, and `lib/database/domains/status/statusReadableSql.test.ts` pins it with a row no writer can produce, because dropping the filter moves no number anyone can observe.
- **The announce chain is followed through one pointer column, `COALESCE("originalStatusId", content)`, not an `OR` of the two forms.** Modern Announce rows set both; legacy rows only ever wrote the original's id into `content`. Spelling that as `originalStatusId = id OR (originalStatusId IS NULL AND content = id)` makes PostgreSQL build a `BitmapOr` of two `statuses_pkey` probes per row, and forces the recursion's working table to carry the wide `content` text for every row — including the Notes that never follow a pointer. The `CASE` guard on `type` is what keeps a Note's body out of that column. Together with the point above: **37,731 → 27,018 buffers and 71 → 36 ms** for the count, 37,734 → 34,905 buffers for the outbox page. `publiclyReadable.ts` builds the pointer in one `announceOriginalPointer` helper for both of its forms; `actorVisibleStatusIds` (`actorVisible.ts`) spells the same `CASE` in a copy of its own, so change the two together.
- **The pointer's `COALESCE` order and the inlined `'Announce'` literal are pinned by compiled-SQL assertions (`statusReadableSql.test.ts`), because getting either wrong still produces a query that runs.** The pointer is documented at `announceOriginalPointer` in `lib/database/kysely/visibility/publiclyReadable.ts`. What the tests add: `COALESCE("originalStatusId", content)` must keep that precedence, since the `20260517000000_add_status_original_status_id` migration backfilled `originalStatusId` by JSON-parsing `content` and left the raw body behind, so migrated rows hold two different non-null strings and only `originalStatusId` names the boosted status — yet `createAnnounce` writes the two identically, so no fixture built through the normal path can tell the orders apart. Both spellings return a plausible number, so a behaviour test needs a **hand-written** row where the two columns disagree.
