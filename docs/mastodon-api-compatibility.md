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
  encounter both shapes. Notification, report, filter, and media ids are their
  own UUIDs and are unaffected — but a status or account these entities
  _reference_ is still a status or account id, and carries the `publicId` like
  any other: a filter's `status_id`, a `FilterResult`'s `status_matches`, a
  report's `status_ids`, a notification group's `status_id`. Nothing about
  federation changed: what is sent to and received from remote servers is still
  the ActivityPub URI.

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
  thumbnails are served from the origin rather than stored locally. A boost
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
  author is still what grants approval. Legacy Fedibird (`quoteUri`)
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
