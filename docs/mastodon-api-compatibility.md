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

- **Status and account ids are UUIDv7 strings, not numeric snowflakes.**
  Mastodon serializes `Status.id` and `Account.id` as decimal snowflake strings
  that happen to sort chronologically when parsed as numbers. Activity.next
  emits a UUIDv7 `publicId` — still time-ordered, but a UUID — on the `Status`
  and `Account` entities and on every field that references one:
  `in_reply_to_id`, `in_reply_to_account_id`, `mentions[].id`, the embedded
  `reblog` / `quote` statuses, `Relationship.id`, `Report.status_ids`,
  collection `account_id`s, the admin entities, and the `max_id` / `min_id` /
  `since_id` pagination cursors in both the query parameters and the `Link`
  header (a cursor is just the id of an entity on the page). Treat them as
  opaque strings: do not parse, sort, or compare them numerically, and use the
  server's cursors for ordering. `uri` and `url` are unchanged and still carry
  ActivityPub URIs — an id is not a URL, and neither can be derived from the
  other.

  Every id form the instance has ever handed out stays accepted on **input**,
  indefinitely: a UUIDv7 `publicId`, the colon-encoded form
  (`domain:users:username`), the `apurl_` opaque form, and a raw ActivityPub
  URI all resolve to the same entity, so ids a client cached before the switch
  keep working. In the other direction, a row that has no `publicId` — one
  written before the [Public ID Backfill](./maintenance.md#public-id-backfill),
  or a remote actor this instance does not store, such as a mention of an
  unknown account — keeps emitting the legacy colon form, so a client can still
  encounter both shapes. Notification, report, and filter ids are their
  own UUIDs and are unaffected — but a status or account these entities
  _reference_ is still a status or account id, and carries the `publicId` like
  any other: a filter's `status_id`, a `FilterResult`'s `status_matches`, a
  report's `status_ids`, a notification group's `status_id`. Nothing about
  federation changed: what is sent to and received from remote servers is still
  the ActivityPub URI.

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
- **An attachment this instance cannot describe is `type: "unknown"`, never a
  `null` entry.** An `audio/mp4` upload has no stored duration and a remote GIF
  no `gifv` metadata, so neither fills Mastodon's `Audio`/`Gifv` shape; both are
  served as `unknown`, carrying the id, url, description and blurhash. This is
  not cosmetic: `media_attachments` is an array of MediaAttachment, so a `null`
  entry failed the entity's own validation and took the entire status off the
  API — dropped from timelines as un-hydratable, an error on a single-status
  GET — while the web UI still rendered it. The id matters as much as the type:
  an entry a client cannot name is one it cannot preserve through an edit.

- **OAuth access tokens expire after 7 days.** Mastodon access tokens do not
  expire by default. Activity.next issues short-lived access tokens (7 days)
  and offers the standard `refresh_token` grant (refresh tokens last 30 days) so
  well-behaved clients can stay signed in. Both `authorization_code` and
  `refresh_token` grants are advertised in
  `/.well-known/oauth-authorization-server`. This is a security choice: leaked
  tokens age out quickly. Mastodon-only clients that never refresh will need to
  re-authorize weekly. Configured in `lib/services/auth/auth.ts`.

- **A remote reaction is not a favourite.** Mastodon has no reaction concept, so
  a Misskey `Like` carrying an emoji used to land here as an ordinary favourite
  and inflate `favourites_count`. It is now stored as an emoji reaction instead:
  no `likes` row, no favourites-count movement. `favourites_count`/`favourited`
  therefore count exactly local favourites plus plain remote `Like`s. Reactions
  received before this change stay favourites — they are indistinguishable from
  genuine ones in storage, so there is no backfill.

- **`GET /oauth/userinfo` `sub` is the local account id, not the actor URI.**
  The OpenID Connect `userinfo` response uses the owning account (user record)
  id for `sub` so it matches the `sub` claim in the OIDC `id_token`. Actor-scoped
  profile fields (`profile`, `preferred_username`, etc.) remain sourced from the
  actor. Set in `lib/services/oauth/userinfo.ts`.

- **Media processing is synchronous.** `POST /api/v2/media` always returns
  `200 OK` with a fully-processed attachment; it never returns `202 Accepted`
  with an unprocessed placeholder the way Mastodon does for large uploads.
  Activity.next processes uploads inline. Clients that poll `GET /api/v1/media/:id`
  after a `202` still work — they simply receive the finished attachment on the
  first read. (An asynchronous, presigned direct-to-storage upload path exists as
  an extension; see below.)

- **`GET /api/v1/trends/links` intentionally returns `[]`.** Activity.next now
  stores link preview cards (see below), but it does not compute trend rankings
  over them — this is a personal server, where "what is trending" over one
  account's timeline is not a meaningful number. Trending hashtags
  (`/api/v1/trends/tags`) and statuses (`/api/v1/trends/statuses`) are fully
  implemented.

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

- **`GET /api/v1/timelines/direct` is retained.** Mastodon removed this endpoint
  in 3.0 in favor of conversations, but Activity.next keeps it for legacy clients.
  The first-party UI uses `/api/v1/conversations` for threaded direct messages;
  the `direct` timeline is served by the shared `timelines/[timeline]` handler.

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

- **The legacy `follow` scope is not honored for granular follow actions.**
  Mastodon deprecated the aggregate `follow` scope in 3.5 in favor of
  `read:follows` / `write:follows` / `write:blocks` / `write:mutes`. Activity.next
  recognizes `follow` at registration for client compatibility but enforces the
  granular (or coarse `read`/`write`) scopes on the relevant routes.

- **`GET /health` returns JSON, not `text/plain`.** Mastodon's health endpoint
  renders `text/plain` body `OK`; Activity.next returns `{"status":"UP"}` with a
  `200 OK`. Liveness probes should assert on the `200` status, not the body.

- **`GET /api/v1/instance/privacy_policy` returns 404 when unset.** Mastodon
  falls back to a bundled default privacy policy when the admin has not set one.
  Activity.next ships no default, so the endpoint returns `404` until
  `ACTIVITIES_PRIVACY_POLICY` is configured (clients hide the link on a 404). The
  companion `GET /api/v1/instance/terms_of_service` (and `/:date`) 404-when-unset
  already matches Mastodon; both report `1970-01-01` as their single effective
  date, the same "no date tracked" placeholder `extended_description` uses.

- **`GET /api/oembed` emits a static blockquote embed.** Activity.next has no
  per-status embed widget, so the oEmbed `html` field is a `blockquote` linking
  to the status page rather than Mastodon's `<iframe src=".../embed">`. The
  provider resolves only this instance's own public or unlisted status URLs
  (including on configured trusted hosts).

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

- **Grouped notifications' `most_recent_notification_id` is a synthesized
  integer, not a resolvable id.** In the `GET /api/v2/notifications` response
  (and the single-group `/:group_key` variant), Mastodon serializes
  `most_recent_notification_id` as the numeric notification id, and clients
  decode it as an integer (the official Mastodon iOS app types it `Int` and
  crashes on a string). Activity.next uses UUID notification ids, which can't be
  numbers, so it emits a deterministic integer derived from the group's
  most-recent notification `createdAt` (epoch ms). This value is display-only —
  clients never send it back as a cursor. Pagination uses the `Link` header and
  the string `page_min_id` / `page_max_id`, which stay real UUID cursors the
  server can resolve. Do **not** "fix" `most_recent_notification_id` back to the
  UUID string: that re-crashes the Mastodon iOS decoder. Unlike Mastodon's
  globally-unique integer notification ids, this timestamp-derived value is not
  guaranteed unique — two groups whose most-recent members were created in the
  same millisecond share it — which is harmless because clients key the list on
  the (unique) `group_key`, not on this field.

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
  posts show their quote once actually ingested and stored. Configured under
  `lib/services/quotes/`, `lib/actions/*Quote*`, and
  `app/api/v1/statuses/[id]/quotes|interaction_policy`.

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

## Extensions

Activity.next adds endpoints and parameters beyond the Mastodon surface. These
are not part of the Mastodon API and are safe for Mastodon clients to ignore.

- **Multi-actor management** — `/api/v1/actors` and friends (`switch`, `default`,
  `domains`, `delete`, `cancel-deletion`) let one account own multiple actors.
- **Fitness tracking** — `/api/v1/fitness/*` (general settings, `.fit`/`.gpx`/`.tcx`
  imports, Strava sync) plus per-account fitness summaries, calendars, activity
  types, and route heatmaps under `/api/v1/accounts/:id/fitness-*`.
- **`?format=activities_next`** — timeline endpoints and
  `GET /api/v1/trends/statuses` accept this query flag to return the raw internal
  status JSON instead of the Mastodon status shape (the web `/explore` Posts tab
  uses it to render the interactive timeline post component).
- **Presigned / direct-to-storage media** — `/api/v1/medias/presigned` (and the
  Strava archive presigned upload) provide an asynchronous upload path that
  offloads bytes directly to object storage.
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
- **Curated collections** — `/api/v1/collections/*`, `/api/v1/accounts/:id/collections`,
  `/api/v1/accounts/:id/in_collections`, and `/api/v1/timelines/collection/:id`
  back the shareable public-feed feature, which federates as FEP-7aa9
  `FeaturedCollection` objects. The API follows the final Mastodon 4.6 collections
  spec (`name`/`tag_name`/`discoverable`/`sensitive` params, `WrappedCollection` /
  `CollectionWithAccounts` / `WrappedCollectionItem` responses with stable item
  ids, anonymous reads of discoverable collections, and item-id-addressed
  remove/revoke) while keeping the pre-final `title`/`topic`/`visibility`
  vocabulary, bulk `account_ids` mutations, the per-member approve consent
  endpoint, and account-id addressing as documented extensions.
- **Hosted quote-authorization stamps** — `GET /users/:username/quote_authorizations/:id`
  serves the FEP-044f `QuoteAuthorization` object for an approved quote; it 404s
  once the quote is revoked (the edge is no longer `accepted`).
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
  `Like` (no reaction content) remains an ordinary favourite.

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
  deliberately out of scope for the first release — see the reaction-spam note
  in the epic plan — so treat an abusive peer as a moderation/defederation
  matter for now.

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
- **Admin CRUD extras** — custom emoji, domain allow/deny lists (with import),
  announcements, filters, and rules management under `/api/v1/admin/*` and
  `/api/v2/admin/*`.

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
- [Review: API routes](#review-api-routes)
- [Review: Actor usernames](#review-actor-usernames)
- [Review: Mastodon and Fediverse Interoperability Quirks](#review-mastodon-and-fediverse-interoperability-quirks)
- [Review: Fetched ActivityPub document ids](#review-fetched-activitypub-document-ids)

<a id="agents-client-facing-entity-ids"></a>

### Client-Facing Entity IDs

- **An id that leaves the server is the `publicId`, and it is produced by `getClientStatusId` / `getClientActorId` (`@/lib/utils/publicId`) — never by `urlToId(status.id)`.** Statuses and actors are addressed internally by their ActivityPub URI, but the Mastodon API and the web status path emit the row's UUIDv7 `publicId`; the two helpers wrap the "publicId, else the legacy encoding" fallback that pre-backfill rows and unstored remote actors still need. A new serializer that reaches for `urlToId` regresses that one field to the legacy shape while every sibling field emits a UUID — the kind of bug no single response looks wrong enough to reveal.
- **Emission is narrow, acceptance is permanent.** Every id form the instance ever handed out still resolves on input, and for status and actor ids there are exactly two boundaries that do it: `lib/services/mastodon/resolveClientId.ts` for the API (`resolveStatusIdParam`/`resolveActorIdParam` and their batch `…Params` forms — `publicId`, colon-encoded, `apurl_`, raw ActivityPub URI) and `app/(timeline)/[actor]/[status]/resolveStatusFromPath.ts` for the web status page (`publicId`, sha256 URL hash, percent-encoded remote URI, bare local status-id tail). A new id-accepting route goes through them instead of calling `idToUrl` itself, and the legacy branches are never pruned — cached client ids and old links depend on them indefinitely.
- **A media attachment has TWO client-visible ids, and the status edit route accepts both.** `POST /api/v2/media` answers with the numeric `medias` row id; a status's `media_attachments[].id` is the attachment row's own UUID. Mastodon has one id where this instance has two, so a client that only ever saw the status — a focal-point drag in Elk or Ivory — can only send the UUID, which `toMediaRowId` rejects outright, and `PUT /api/v1/statuses/:id` answered 422 for every third-party media edit. `resolveStatusAttachmentMediaIds` (`lib/services/statuses/mediaIds.ts`) is that third acceptance boundary, mapping the UUID through the status's own attachments before either `media_ids` or `media_attributes[][id]` reaches a media path; an id that is already a media id passes through untouched. It lives beside the other media-id helpers rather than in `resolveClientId.ts` because it resolves a different id space against one status. **The UUID branch is permanent** — it is what every already-published status hands back. Only this route can do it: `POST /api/v1/statuses` (delete-and-redraft) has no status left to resolve against, which is why redraft still needs the upload id. Note this is the one place a media id legitimately arrives non-numeric; every comparison against `medias.id` still goes through `toMediaRowId` (see **Database Compatibility Guidelines**).
- **An attachment the Mastodon serializer cannot describe is `type: "unknown"`, never `null` — a `null` took the entire status off the API.** `getMastodonAttachment` covers image and video; an `audio/mp4` upload (an accepted type) has no stored duration for Mastodon's `Audio` shape and a remote GIF no `gifv` metadata. Returning `null` was not a degraded entry, it was a fatal one: `media_attachments` is `MediaAttachment.array()`, so `getMastodonStatus`'s closing `Mastodon.Status.parse` threw, `getMastodonStatuses` caught it and dropped the status from the page as "un-hydratable", and a single-status GET errored — one audio clip made a post invisible to every Mastodon client while the web UI still showed it. `unknown` carries the id, url, description and blurhash without claiming dimensions the row does not have. The id matters too: an attachment a client cannot name is one an edit cannot preserve.
- **`lib/client.ts` never re-encodes an id — it sends back exactly what it was handed.** Because the accept side takes all three forms, encoding on the way out buys nothing for a legacy id or a raw URI and actively corrupts a `publicId`: `urlToId` parses a bare UUIDv7 as a URL host and returns it with a trailing colon, a value `isPublicId` rejects and `idToUrl` mangles, so no resolver can reach the row. (That is how the "Follow back" button on a follow notification broke the moment Account ids flipped.) Ids in a query param or a JSON body go out verbatim; the only transformation left is `toIdPathSegment` (`@/lib/utils/urlToId`) for an id going into a URL **path** segment, and it fires solely for a raw AP URI, whose slashes would otherwise split the route.
- **A pagination cursor is an entity id, so it flips with the entity.** A `max_id`/`min_id`/`since_id` value the client sends back must be the value it was shown, which is why status cursors go through `getClientStatusCursors` (`lib/services/mastodon/clientCursor.ts` — it resolves off-page boundary statuses in one batched query) and admin account cursors through `getClientActorId`.
- **Never join two serialized payloads on an id; join on the ActivityPub URI.** The URI is stable and encoding-independent, while an id's shape depends on whether that row has a `publicId`. `serializeAdminReports` keys its status map on `status.uri` for exactly this reason.
- **Resolving a batch of ids is one query, not one per id.** Use the `…Params`/`getActorPublicIds`/`getStatusPublicIds` batch forms when serializing or accepting a whole page; a `map` of point lookups fired at a pool of 10 is what these replaced.
- Background: [Architecture → Public Identifiers](architecture.md#public-identifiers) and the [Public ID Backfill](maintenance.md#public-id-backfill) runbook.

<a id="agents-zod-validation-in-api-routes"></a>

### Zod Validation in API Routes

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

<a id="agents-activitypub-json-ld"></a>

### ActivityPub & JSON-LD

ActivityPub objects are **JSON-LD**, so the same logical object can arrive in many shapes (`type` as a string, array, CURIE, or full IRI; recipients as a single value or an array; id references inline or as nested objects; varied `@context` orderings and extension vocabularies). Do **not** lock the wire format to a single shape with strict schemas — be liberal in what you accept and canonical in what you emit.

- **Canonicalise every inbound ActivityPub document with `compactActivityPub` from `@/lib/activities/jsonld` before validating or processing it.** It runs the real `jsonld` processor, compacting against one canonical context so downstream code (and the Zod schemas) can rely on a predictable shape: bare `type` terms, id references as strings, and `to`/`cc`/`tag`/`attachment` always arrays. **Any new entry point that parses an untrusted remote AP note/activity/actor MUST compact first.** Already wired: the shared inbox (`app/api/inbox/route.ts`), the per-user inbox (`app/api/users/[username]/inbox/route.ts`), `getActorPerson`, `getActorPosts`, and `getNote` (so `getRemoteStatus` and boosted-note resolution inherit it). `compactActivityPub` is generic (`<T>(input: T) => Promise<T>`), preserves the document's logical shape, and falls back to the raw input on any processing error.
- **The processor must never dereference remote `@context` URLs at runtime** (SSRF/DoS vector). Contexts are bundled as committed offline assets under `lib/activities/jsonld/contexts/` and served by `offlineDocumentLoader`; unknown context URLs resolve to an empty context (their terms simply drop). Add new contexts as bundled assets, never as network fetches. `jsonld` (via `rdf-canonize`) is a heavy, Node-only dependency that breaks under jsdom, so it is imported **lazily** inside `compactActivityPub` — keep it that way so it never enters component/jsdom test module graphs.
- **Extension `type`s that are not defined in the bundled ActivityStreams context must be aliased in `CANONICAL_CONTEXT`**, otherwise compaction emits a CURIE (e.g. `toot:Emoji`, `as:Hashtag`, `schema:PropertyValue`) that the strict `type` validators then drop. `Emoji`, `Hashtag`, `PropertyValue`, `QuoteRequest`, `QuoteAuthorization`, and `EmojiReact` are the currently-aliased ones (all other matched AS2 types are already in the bundled context). If you start matching on a new non-AS2 `type`, add its alias **and a regression test** asserting it survives compaction as a bare term.
- **A term this instance WRITES onto a Note must be declared in the context it sends, not only aliased inbound.** `CANONICAL_CONTEXT` governs what we accept; `NOTE_ACTIVITY_CONTEXT` (`lib/activities/noteContext.ts`) is what we emit. This is the outbound mirror of the aliasing rule above and it fails the same silent way: JSON-LD is context-driven, so a term the document never defines expands to a blank node and `stripJsonLdArtifacts` deletes it. The note keeps its content and quietly loses the rest — no error, no build warning, and no test failure, because every result-based assertion still passes. Mastodon reads the JSON without processing it, which is why this survived so long; a conformant receiver — GoToSocial, or another activities.next, whose inbox runs `compactActivityPub` — silently lost the terms. **Seven surfaces carry a Note and all seven send `NOTE_ACTIVITY_CONTEXT`:** `sendNote`'s Create, `sendUpdateNote`'s Update, `sendQuoteRequest`'s `instrument`, the AP status GET, the `/replies` collection, the user outbox page, and the `outbox.json` writer in `scripts/backup/actorArchive.ts`. It supersets `QUOTE_ACTIVITY_CONTEXT`, so a surface on it also satisfies the quote vocabulary's own requirement; the other quote activities (Accept/Reject/Delete) echo ids rather than Notes and keep the narrower one. The archive's likes/bookmarks collections share the outbox writer but hold bare ids, so the extra definitions are inert there. **Both emitters build these fields through `lib/activities/quoteNoteFields.ts` and emit `interactionPolicy` and the quote aliases unconditionally** — `getNoteFromStatus` for delivery, `toActivityPubObject` for fetch — so the rule binds every note-carrying surface, quote post or not. The same module's `addQuoteFallbackToContent` prepends Mastodon's legacy quote fallback — `<p class="quote-inline">RE: <a href="…">…</a></p>` — to both emitters' `content` and the Mastodon API status/edit serializers on a live (pending/accepted) edge, preferring the original status web url over the bare ActivityPub id, skipped when the content already carries the quoted url or id; it is plain HTML rather than a JSON-LD term, so no context entry is involved, and `post.tsx` hides the `quote-inline` marker whenever it renders a quote card (see **Link Preview Cards** for the sanitizer/extractor half). `interactionPolicy` arrives through a spread (`getInteractionPolicyFields`), so grepping for the literal key finds nothing: check the spreads. The only asymmetry left is `votersCount`, which `toActivityPubObject` emits on a poll Question while `getNoteFromStatus` returns null for Polls entirely. Both also carry an attachment's `blurhash`/`focalPoint` and the `Hashtag`/`Emoji` tag TYPES, none of which the bundled ActivityStreams context defines. `focalPoint` needs `"@container": "@list"` or a processor is free to reorder the `[x, y]` pair. One caveat on the outbox page: its context sits on the `OrderedCollectionPage`, so embedded Notes inherit it only from a receiver that processes the page as one document — and OUR reader does not, `getActorPosts` compacting each `orderedItems` entry on its own. That is a pre-existing limitation of the reader, not of the emitted page. Each surface is pinned by a `@context` assertion (`lib/activities/index.test.ts`, `sendUpdateNoteJob.test.ts`, the three route tests, and `scripts/backup/actorArchive.test.ts`) because a revert is invisible in results; `lib/activities/quoteNoteFields.test.ts` and `lib/activities/jsonld/index.test.ts` prove the round trip. The tag TYPES are the exception a round trip cannot cover — `stripJsonLdArtifacts` recovers a blank-node `type`, so our own reader keeps them either way; they are pinned by asserting the context declares each under the IRI we accept it as.
- **An alias in `CANONICAL_CONTEXT` only helps when the _sender_ defines the term too.** `CANONICAL_CONTEXT` is the context compaction targets; expansion still uses the document's own `@context`, and the bundled ActivityStreams context sets `"@vocab": "_:"`, so a term the sender never defines expands to a blank node — which `stripJsonLdArtifacts` recovers for `type` values but **deletes** for property keys. For terms peers commonly emit undefined (Misskey's `_misskey_reaction`) or declare in a vocabulary the offline loader cannot resolve (litepub's `EmojiReact`), also add them to `EXTENSION_TERM_FALLBACK_CONTEXT`, which `normalizeInputContext` prepends to every inbound document as the lowest-precedence entry — so a sender that does define the term still wins. This is the same trick that keeps litepub actors' `publicKey` readable via the `security/v1` fallback.
- **Keep the Zod schemas liberal, not strict.** Model only the fields you consume; never `.strict()`; tolerate unknown tag/attachment kinds via the `z.looseObject({})` fallback in the `Tag`/`Attachment` unions (`z.looseObject` is valid Zod v4 — see `lib/types/activitypub/actor.ts`); never Zod-validate `@context`. Narrow loose values back to fully-valid known shapes at the consumption boundary with `safeParse` (e.g. `getTags`/`getAttachments` return only valid `KnownTag`/`Document` via `KnownTag.safeParse`/`Document.safeParse`).
- **Do not change `http://schema.org#` to `https`.** Mastodon maps the `schema` prefix to the non-standard `http://schema.org#` base in actor `@context`; the canonical context must use the same IRI so profile fields (`PropertyValue`/`value`) compact correctly.
- Compaction emits the public collection as the compact alias `as:Public`; `toRecipientArray` canonicalises it back to the full ActivityStreams Public IRI when coercing recipients for persistence so stored recipients have one canonical form. JSON-LD blank-node ids (`_:b0`) are document-local artifacts and are rejected by `extractActivityPubId`/`normalizeActivityPubUri` — they are never valid resolvable ActivityPub ids.
- **Forwarded ActivityPub deliveries (ActivityPub §7.1.2 inbox forwarding) pass the signature guard with `forwarded: true` instead of 403 `sender_actor_mismatch`.** Because the payload is signed by the forwarding server rather than the document's author, it cannot be trusted directly. Forwarded `Create`, `Update`, and `Delete` activities route to `ProcessForwardedActivityJob` (`names.ts:PROCESS_FORWARDED_ACTIVITY_JOB_NAME`) to verify and re-fetch the object from the author's origin server before executing side effects; all other forwarded activity types (`Follow`, `Accept`, `Reject`, `Like`, `Undo`) lack an origin verification path and are acknowledged with `202 Accepted` and dropped without side effects.

<a id="agents-a-fetched-document-s-own-id-is-not-evidence"></a>

### A Fetched Document's Own `id` Is Not Evidence

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

<a id="agents-actor-usernames-are-case-insensitive"></a>

### Actor Usernames Are Case-Insensitive

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

<a id="agents-status-posts-actions"></a>

### Status Posts & Actions

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

#### Post media layout (`attachments.tsx`)

A status's media is **one attachment at its own size, or a horizontally
scrollable strip — never a grid.** `lib/components/posts/attachments.tsx` owns
this for every surface that renders a post, and the shapes come from the design
system's `Attachments` component.

- **A lone picture keeps its own aspect ratio and starts on the post text's
  left line.** Not `w-full`, not `aspect-video`: the old single branch
  cropped every portrait photo to 16:9 across the full content width. It is
  scaled by **width** — `min(100%, round(SINGLE_MAX_HEIGHT * ratio)px)`, capped
  at the file's own pixels so a thumbnail is never upscaled — and never by
  capping the height of an `aspect-ratio` box, which leaves the ratio to be
  re-derived from a clamped axis and is resolved inconsistently across browsers.
  The full-bleed media row can still reach the owning feed frame's inner edges
  while a strip scrolls, but the picture itself is inset to the post text's
  line (`--post-media-bleed-left` doubles as the item inset; see the frame-bleed
  contract in `docs/architecture.md` → "Post media layout"), not flush with the
  frame's left edge — a wide picture still reaches the frame's right edge.
- **Two or more pictures are a horizontally scrolling gallery** with 240px image
  boxes, 12px gaps, rounded corners, and cards sized from their aspect ratio.
  Cards have a 160px minimum and a 78% container maximum so neighboring cards
  peek into view. Captions render below their images, preserve line breaks and
  custom emoji, clamp to three lines, and expose independent Show more /
  Show less controls when their measured content exceeds that height. Four
  details are load-bearing and must not be "cleaned up":
  - `flex-none` on each item is what makes the strip overflow at all. Without it
    the default `flex-shrink` squeezes every item to fit, so
    `scrollWidth === clientWidth` forever: no arrows, no peek, no
    scrolling, and every photo cropped. The whole feature turns off silently,
    which is why a test pins the class — jsdom lays nothing out, so nothing else
    at that level can carry the rule.
  - `STRIP_ITEM_MAX_WIDTH` (78%) means no item can fill the strip, so the next
    one always peeks past the edge. That peek is what says "this scrolls" on a
    touch screen.
  - `scroll-snap-type: x proximity`, never `mandatory`: mandatory snapping pulls
    the peeking item onto the settled line as soon as the scroll settles and
    destroys the affordance the 78% cap creates. The scroller's `padding-left`
    and `scroll-padding-left` share the left bleed's line
    (`--post-media-bleed-left`), so the resting first card and the card a slide
    settles on both line up with the post text, while the card can still travel
    out to the frame edge while the reader is dragging.
  - Paired circular arrow controls remain mounted while the strip overflows,
    sit below the captions, and expose guarded `aria-disabled` states at each
    boundary. Each press advances exactly one adjacent card and lands it on the
    text line — `useMediaStripScroll` subtracts the scroller's
    `scroll-padding-left` from the card boundary — with reduced motion honored.
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
- **There are no edge fades or overlaid arrows.** The paired arrows sit below
  captions so they never obscure a card or interfere with touch.
- **Every media button's focus indicator is an `outline` with a NEGATIVE
  offset, not a ring.** For a strip item, its border box is exactly the strip's
  height and `overflow-x-auto` forces `overflow-y` to compute to `auto`, so an
  OUTSET ring's top and bottom bars fall outside the scrollport and are clipped
  away. The media box can still reach the feed frame's inner edge — a wide lone
  picture's right edge, and every strip card while it is dragged — and below
  `md` that is the viewport edge, where `main`'s `overflow-x-clip` cuts the
  ring's outer edge, so both shapes share the same inset outline. An INSET ring is
  worse rather than better: an inset `box-shadow` paints with the element's
  background, underneath its content, and the button's only child is an opaque
  image filling the whole box — so it is occluded on all four sides and there is
  no indicator at all. An outline with a negative offset is the one form that
  draws inside the border box AND paints above content. (Note
  `MessageBubble`'s media cells carry `focus-visible:ring-inset` over the same
  full-bleed image shape, so their indicator is invisible too — a pre-existing
  bug, not a precedent to copy.)
- **Arrow controls remain focusable at boundaries.** Their `aria-disabled` state
  guards activation while preserving focus, which lets keyboard users discover
  and retain their position at either end.
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

<a id="agents-local-usernames-are-actor-id-path-segments"></a>

### Local Usernames Are Actor-Id Path Segments

- **A local username is validated by ONE schema, `localUsernameSchema` (`lib/services/accounts/localUsername.ts`), because the charset is a correctness rule rather than a style preference.** `getLocalActorId` builds `https://${domain}/users/${username}` and does **not** percent-encode it, so the username IS a path segment of the actor's canonical id — and a path segment is percent-**decoded** on the way back in. Both creation paths used to let `%` through: `POST /api/v1/accounts` had an **unanchored** `/\w+/` (which only requires one word character _anywhere_, so `%6eull`, `nul%6c` and `a%2Fb` all passed) and `POST /api/v1/actors` had no charset check at all, only a length. So an account could be registered whose stored, federated id was `https://<domain>/users/%6eull`, and dereferencing that id decoded the segment to `null` and served whichever actor owns THAT name — their Person document, their public key, their outbox and followers — under a URI belonging to someone else. Proved against Next's own route matcher: `/api/users/%6eull` and `/api/users/nul%6c` both match as `{ username: 'null' }`. This is not hypothetical here, where the owner's account is genuinely named `null`. It is identity/URI confusion, **not** signature forgery — the holder of the alias has no private key for the actor whose document is served — but `Block` and the `Undo` handlers pass the guard-resolved `actor.id`, so those do land on the impersonated actor.
- **Anchoring is the whole point, so pin it with a test rather than trusting the regex to read correctly.** Both the unanchored-`/\w+/` revert and dropping `^`/`$` from `LOCAL_USERNAME_PATTERN` leave a schema that still rejects `''` and `..`, so it looks like it is working; `localUsername.test.ts` and the two route-level suites fail on the percent-encoded cases specifically.
- **Do NOT unify it with the `USERNAME_PATTERN` in `getFallbackBlockedAccount`/`getFallbackMutedAccount`.** Those decide whether a **remote** actor id's last segment is safe to _display_ as a username. A remote server may legitimately mint names this instance refuses, so the two rules only look alike; sharing one constant would let a change to the local minting rule silently move what remote names render.
- **Sharing the schema also newly bounds a registered username at `LOCAL_USERNAME_MAX_LENGTH` (50), which registration did not previously enforce at all** — `POST /api/v1/actors` carried that limit, `POST /api/v1/accounts` carried none. That is a deliberate tightening rather than a preserved rule: `actors.username` is `varchar(255)`, so a longer name was storable and a 256-character one overflowed the column and 500'd on PostgreSQL instead of being refused.
- **Validation is on creation only, so it cannot clean up rows that already exist.** An instance already holding a `%` in a username, or a name longer than the cap, keeps it — the schema is only consulted when a name is minted. If an instance has been running with the old schemas, check the stored usernames for a `%` before assuming the alias cannot already be present.

<a id="agents-local-actors-does-this-server-host-this-actor"></a>

### Local Actors ("does this server host this actor?")

- **The SQL test is `privateKey IS NOT NULL AND privateKey <> ''`, and it belongs to `whereLocalActor` (`lib/database/sql/utils/localActor.ts`) — never write either half by hand.** Actor rows written by earlier remote-recording paths store the key they do not have as an **empty string**, not NULL. A null-only check therefore counts them as local: on production that was **216 of the 221** rows it matched, all on remote domains, which made the logged-out local timeline majority-remote. (It also put every domain those actors live on into `getLocalFollowersForActorId`'s "local domains" set — real, but unreachable: that method currently has no production callers.) `20260821120000_normalize_empty_actor_private_key.js` rewrites the stored `''` to NULL; the `<> ''` half stays anyway, for databases restored from an older dump. Applied via knex's `modify`, which works mid-chain and inside a `whereExists` callback: `query.modify(whereLocalActor, 'actors.privateKey')`.
- **`.modify()` returns `QueryBuilder<any, any>` and erases the row type.** Where the rows are consumed as a typed shape afterwards, name it on the `select` (`.select<SQLActor[]>('actors.*')`) or the next `.map` parameter becomes an implicit `any` and the build fails.
- **The JS test is truthiness — `Boolean(actor.privateKey)` — never `actor.privateKey !== ''`.** `getActorFromRow` omits `privateKey` from the domain object unless it is truthy, so the field is a real key or `undefined` and is **never** the empty string. `!== ''` is therefore always true: it reads like a local-actor filter and filters nothing. That is what let `addStatusToTimelines` fan every status out to remote recipients, giving them home-timeline rows and reply/mention notifications on accounts this server does not host.
- **The local public timeline must NOT join `actors`; it passes the local actor ids in as literal values** (`localPublicStatusesQuery`, `lib/database/sql/timeline.ts`). Joining on `actors.id` — a unique key — leaves the planner no statistic correlating an actor with how much it posts, so it assumes an even spread. On production that under-estimated the eligible rows ~48x (150 against 7,262) and the plan changed with `limit` alone, crossing over at 24: a page of 23 ran the ordered index scan in ~1ms, while the API's own default of 30 flipped to a parallel sequential scan of `actors` plus a sort — ~88ms and 35,108 buffers. A local seed reproduces production's row counts but not its statistics, so it does not show that crossover; what it shows is worse. Buffers at limit 23/24/30 on a local PostgreSQL 17 seeded to production's shape: **literal ids 137/142/176; either join form carrying `<> ''` ~16,700 flat at every size; the same join with `IS NOT NULL` alone ~160/~164/~200.** PostgreSQL compiles the inner join and the `whereExists` fallback to one plan, so the fallback is not the cheaper shape; only the literal-id form early-terminates (`Heap Fetches: 0`), which is why it is the only figure quoted exactly. So it is the CORRECTNESS predicate that costs the plan — with it present, either join form loses early termination at _every_ page size, and widening the partial `actors_local_idx` predicate to match does not recover it. The id read is itself capped at one past what the query can bind (`getLocalActorIdLimit`) — it runs on an anonymous path, and above the cap the list is discarded in favour of the semi-join, so fetching it whole would be pure waste. **Adding `<> ''` to the join form without switching to literal ids makes this query dramatically worse** — the two halves of that change are not separable. `localPublicQueryShape.test.ts` pins the shape, because every result-based assertion passes against the slow one.

<a id="agents-who-may-see-an-actor-s-statuses"></a>

### Who May See an Actor's Statuses

- **`getActorStatuses` and `getAttachmentsForActor` FAIL OPEN: with none of `publicOnly`, `visibleToActorId` or `includeFollowersOnly` set, no visibility predicate is applied at all.** That is a real mode, not an oversight — it is how the owner sees their own private posts, and how `scripts/backup/actorArchive.ts` exports a complete history — but it means a caller that simply forgets the arguments gets the unfiltered query and no error. The profile page forgot them: `getProfileData` passed only `currentActorId`, which is **hydration-only** (it decides like/bookmark/reaction state, never which rows come back), so `/@user@domain` server-rendered the actor's followers-only posts and their direct messages **to logged-out visitors**, and the `getAttachmentsForActor` call beside it put those posts' images in the Media tab. `GET /api/v1/accounts/:id/media` — the "Load more" behind that tab — served the same set to anyone, with no session at all.
- **Resolve the audience with `resolveActorStatusesAudience` (`lib/services/statusAccess.ts`); do not spell the four arguments out per call site.** It answers `{ isOwner, isFollower, publicOnly, visibleToActorId, includeFollowersOnly, followersAudience }` from `(targetActor, currentActor)`, and it takes `Actor | null | undefined` deliberately. The `publicOnly: currentActor === null` spelling the statuses route used is safe **there** — `OptionalOAuthGuard` hands its handler `Actor | null`, never `undefined` — but it is not safe as a general rule: `getProfileData`'s viewer arrives through an OPTIONAL field a caller can simply omit, which the followers and following pages did, and for `undefined` that comparison is false, so the viewer reads as signed-in and all three arguments come out falsy. Normalising inside the resolver is what makes an omitted viewer fail closed instead of unfiltered.
- **The viewer's own follow row is read through `getViewerFollow` (`lib/services/getViewerFollow.ts`) on read paths, and through `database.getAcceptedOrRequestedFollow` everywhere else.** Rendering `/@user@domain` for a signed-in non-owner asks for that one row twice from two places that cannot see each other — `resolveActorStatusesAudience`, to decide whether followers-only posts are in scope, and `getRelationship`, for the follow button's state plus its reblog/notify preferences and language filter — so the helper wraps the lookup in React `cache` and the two collapse into one query per request. It takes `(database, viewerId, targetActorId)` **positionally**: `cache` keys on argument identity, so the options-object spelling the database method itself uses would allocate a fresh key on every call and memoize nothing. **Read paths only.** Follow, unfollow, block and follow-request authorize/reject each read the row, mutate it, then report the result through `getRelationship`; they reach the helper only _after_ their own write, which is a cold read, and routing one of their pre-mutation reads through it would make the response describe the state they just replaced. `canActorReadSingleStatus` stays on the direct call, and that is a scope boundary rather than a claim that it never repeats — it does. It asks about whoever wrote a boosted ORIGINAL, once per status in `getProfileData`'s own per-status pass with no `followerStateByActorId` prefetch, so a profile carrying two boosts of the same followers-only author issues that query twice. Routing it through the helper too would collapse that as well and is safe, but it reaches a dozen further call sites (inbox handling, status create/edit, search, polls), most with no request scope at all, so it is left for its own change.
- **The SQL scope is necessary but not sufficient — pair it with `canActorReadStatus`.** The recipients predicate matches a status's own audience and cannot see through a boost: an Announce is public while the status it boosts may not be. Every status-serving path does both (`GET /api/v1/accounts/:id/statuses`, the outbox route's `isStatusPubliclyReadable` pass, and now `getProfileData`).
- **One subquery decides both tables.** `buildActorVisibleStatusIdsQuery` (`lib/database/sql/status.ts`) returns the actor's visible status ids, or `null` for the unfiltered mode; `getActorStatuses` filters `statuses.id` by it and `getAttachmentsForActor` filters `attachments.statusId` by it, so an attachment is withheld from exactly the viewers its post is. Never scope one without the other — a gallery that outlives its timeline's filter leaks the same posts as image URLs.
- **Where a required argument fits, use it; `lib/database/statusVisibilityCallSites.test.ts` covers the case where it does not.** `getProfileData`'s viewer IS required (`currentActor: DomainActor | null`, and the options object with it), so the compiler rejects an omission — which is what the original bug was — at every call site, including ones no directory scan would reach. The two database methods are the case a type cannot serve: their unfiltered mode is legitimate, so a required discriminant would make both honest callers restate an intent it still could not verify, and rewrite hundreds of existing calls. Those are enforced by the test instead: every call must state a visibility argument, spread or name a local object that carries one, or carry the `visibility-unfiltered` marker in a comment explaining why. It reads the AST rather than matching names — a name-based rule was defeated four times, by a `...maxIdScope` pagination cursor, by a decoy named for an audience carrying no viewer, by an aliased import that made a call site vanish entirely, and by `database?.getActorStatuses(…)`, whose optional chaining hid it from the walk. Its one documented blind spot is a default re-export, which needs cross-module resolution.

<a id="agents-publicly-readable-status-ids"></a>

### Publicly Readable Status Ids

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

<a id="review-api-routes"></a>

### Review: API routes

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

<a id="review-actor-usernames"></a>

### Review: Actor usernames

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

<a id="review-mastodon-and-fediverse-interoperability-quirks"></a>

### Review: Mastodon and Fediverse Interoperability Quirks

When reviewing code that interfaces with Mastodon APIs, ActivityPub, or JSON-LD contexts, note the following deliberate deviations from standard web best practices required for Fediverse interoperability in this codebase:

- **Actor URIs vs. Opaque IDs:** `account.url` and `account.uri` carry the full Actor URI (e.g., `https://domain/users/username`), while `account.id` is an opaque client-facing identifier — a UUIDv7 `publicId` (e.g., `01937b2f-…`) for rows that have one, falling back to the legacy colon-encoded form (e.g., `domain:users:username`) for rows written before the publicId backfill and for remote actors this instance does not store. `status.id` / `status.uri` split the same way. The id and the URI are different things and neither is derivable from the other: do not flag `account.url` as a profile URL that should be replaced with `account.id` for Actor URI lookups (that causes 404s in follow request routes), and do not "simplify" an id-accepting route into taking a URI.
- **Legacy ID Forms Are Permanent:** only the `publicId` is emitted, but the accept side still resolves every form the instance ever handed out — `resolveClientId.ts` takes the colon-encoded and `apurl_` forms and raw ActivityPub URIs, and `resolveStatusFromPath.ts` takes the sha256 URL hash, a percent-encoded remote URI, and a bare local status-id tail. That asymmetry is deliberate so cached client ids and old links keep working; the legacy branches are not dead code and must not be pruned. Conversely, a new serializer must emit the id via `getClientStatusId`/`getClientActorId` (`@/lib/utils/publicId`) rather than `urlToId(...)`, or that one field regresses to the legacy shape while its siblings emit UUIDs.
- **The Client Never Re-Encodes an ID:** `lib/client.ts` forwards whatever id it was given — a `publicId`, a legacy colon/`apurl_` id, or a raw ActivityPub URI — because the accept side resolves all three. Do not "restore" a `urlToId(...)` call around an id headed for a query param or a JSON body: run over a UUIDv7 it yields `<uuid>:`, which nothing can resolve. The single exception is `toIdPathSegment`, used only for an id interpolated into a URL **path** segment, and it transforms only raw URIs (their slashes would split the route).
- **Schema.org Namespace:** The JSON-LD `@context` must use `http://schema.org#` (not `https://schema.org#`). Mastodon strictly maps the `schema` prefix to the non-standard `http://schema.org#` base. Changing to HTTPS breaks JSON-LD compaction and silently drops profile fields like `PropertyValue`.
- **FEP-044f Quote Terms Need Their Context:** a document emitting the quote aliases (`quote`/`quoteUrl`/`quoteUri`/`_misskey_quote`/`quoteAuthorization`) or `interactionPolicy` must declare `QUOTE_ACTIVITY_CONTEXT`, never the bare `ACTIVITY_STREAM_URL`. Both emitters (`getNoteFromStatus` for delivery, `toActivityPubObject` for fetch) build these fields via `lib/activities/quoteNoteFields.ts` and emit `interactionPolicy` unconditionally, so this binds every note-carrying surface — quote post or not. A receiver that compacts drops any term the document's own context never defined, so the note keeps its content and silently loses its quote: no error, no failing test, because nothing reads `interactionPolicy` inbound. Flag any new AP surface returning a note that does not carry a `@context` assertion pinning it. The legacy content fallback rides with the fields: both emitters prepend `<p class="quote-inline">RE: <a …></a></p>` via `addQuoteFallbackToContent` (same module, same live-edge gate) — flag a new note-emitting surface that builds `content` without it, and flag any change that adds the fallback on a rejected/revoked/deleted edge or stores it into `status.text`. See **ActivityPub & JSON-LD** in `AGENTS.md`.
- **Internal API CORS:** Next.js API routes exclusively consumed by the internal web client (e.g., via `lib/client.ts`) do not require `OPTIONS` handlers or CORS preflight configurations, even if they use `apiResponse` with `allowedMethods`.
- **Conditional Object Spreading:** Spreading `null` in object literals (e.g., `...(cond ? { ... } : null)`) is a deliberate, consistent no-op pattern used to cleanly omit keys and should not be flagged as confusing or replaced with `{}`.

<a id="review-fetched-activitypub-document-ids"></a>

### Review: Fetched ActivityPub document ids

- A document's own `id` is a claim by whoever answered the fetch — `getNote` and
  `getActorPerson` validate nothing. Flag any new code that resolves a database
  row from a fetched `id`: `updatePoll` and `createAnnounce` both key on a bare
  `where('id', ?)` with no ownership, locality or type filter, so the remote
  server is choosing which of our rows the write lands on.
- **Check which of the two questions the call site is asking**, because they take
  different guards and a reviewer who unifies them breaks one of them.
  "Did I get back the document I asked for?" (`syncRemotePoll`, which fetches the
  canonical id it stored) is an exact id match, normalized. "Is this document
  allowed to name that id?" (`createAnnounceJob`, where a third party chose
  `object`) is `isSameActivityPubOrigin`. Tightening the second into an id match
  looks like hardening and is an interop regression — this instance's own
  `proxy.ts` serves `/@user/<id>` with an `id` of `/users/<user>/statuses/<n>`,
  Mastodon does the same, `safeRemoteFetch` follows redirects, and
  `createRelayAnnounceJob` already records the same fact about the same fetch.
  Check the parser rather than a remembered list before relying on a specific
  fold: it does scheme/host case, default port, dot segments, IDNA mapping and
  encode-direction percent-encoding, but **not** percent-decoding and **not** a
  trailing slash on a non-empty path.
- The origin guard in `createAnnounceJob` does **not** make a boost's target
  safe: an already-stored status is resolved before it and skips the branch, and
  `createAnnounce` applies no audience check. A remote actor can still boost a
  local followers-only status by naming its id directly (reproduced; the sibling
  `createRelayAnnounceJob` gates it with `isPublicStatus`, this job does not).
  Open and pre-existing — flag any comment or doc that implies the guard shuts
  it.
- Reject any new inline `new URL(a).host === new URL(b).host`; use
  `isSameActivityPubOrigin`. It fails closed — a blank node, an empty string, an
  unparseable id or a **host-less URI** (`urn:`, `did:`, `tag:`, `mailto:`, all
  of which parse to `host === ''`) matches nothing, _including itself_. That
  last case is the one a bare `.host` comparison silently gets wrong, so the
  helper is intentionally stricter than the five copies it replaces on that
  input alone. It compares the host and not the scheme, which is deliberate:
  scheme does not partition who controls an id space, and the port — which
  does — is already part of `host`.
- In `createAnnounceJob` the guard must precede the `createNoteJob`/
  `createPollJob` dispatch, not just the fallback `getStatus`. Below the
  dispatch it still lets a lying document be persisted at an id we were never
  pointed at. Relocating it fails exactly one test; if a reviewer sees the guard
  move and the suite stay green, the pinning test was deleted.
- `syncRemotePoll` writes with `statusId: status.id`, never `question.id`. That
  is what actually closes the vulnerability, so it is not redundancy to tidy
  away once the guard is in place.
- An id match is not an ownership check. Where the resolved row belongs to
  someone else, compare `normalizeActorId(attributedTo)` against the stored
  status's `actorId`, as `updateNoteJob` and `updatePollJob` both do. The
  inbox's `createObjectActorMismatch` only binds the payload to the _signer_,
  which an attacker satisfies by attributing the Update to themselves.
- **Demand a test on each side of every guard**: one that fails when it is
  loosened, one when it is tightened. A PR carrying only the first has pinned
  that the guard exists, not that it has the right width — which is exactly how
  an over-strict version of this change nearly shipped.
- Known-open and deliberately so: `createAnnounceJob` does not bind the fetched
  note's `attributedTo` (and `actorMatchesVerifiedSender` fails open on a direct
  call, which carries no `verifiedSenderActorId`); `recordActorIfNeeded` takes a
  row's `id` from the request and its `domain` from the fetched `person.id`
  unchecked. Do not treat these as covered by the guards above — they are a
  different class (forged attribution) awaiting their own decision.
