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

- **OAuth access tokens expire after 7 days.** Mastodon access tokens do not
  expire by default. Activity.next issues short-lived access tokens (7 days)
  and offers the standard `refresh_token` grant (refresh tokens last 30 days) so
  well-behaved clients can stay signed in. Both `authorization_code` and
  `refresh_token` grants are advertised in
  `/.well-known/oauth-authorization-server`. This is a security choice: leaked
  tokens age out quickly. Mastodon-only clients that never refresh will need to
  re-authorize weekly. Configured in `lib/services/auth/auth.ts`.

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

- **`GET /api/v1/trends/links` intentionally returns `[]`.** Activity.next does
  not store link preview cards, so there is no trending-links data to surface.
  Trending hashtags (`/api/v1/trends/tags`) and statuses (`/api/v1/trends/statuses`)
  are fully implemented.

- **`GET /api/v1/timelines/direct` is retained.** Mastodon removed this endpoint
  in 3.0 in favor of conversations, but Activity.next keeps it for legacy clients.
  The first-party UI uses `/api/v1/conversations` for threaded direct messages;
  the `direct` timeline is served by the shared `timelines/[timeline]` handler.

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
- Link timeline — `/api/v1/timelines/link` (needs stored preview cards)
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
- **`?format=activities_next`** — timeline endpoints accept this query flag to
  return the raw internal status JSON instead of the Mastodon status shape.
- **Presigned / direct-to-storage media** — `/api/v1/medias/presigned` (and the
  Strava archive presigned upload) provide an asynchronous upload path that
  offloads bytes directly to object storage.
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
- **Remote statuses** — `/api/v1/accounts/:id/remote-statuses` exposes cached
  remote posts for an actor.
- **Admin CRUD extras** — custom emoji, domain allow/deny lists (with import),
  announcements, filters, and rules management under `/api/v1/admin/*` and
  `/api/v2/admin/*`.
