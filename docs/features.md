# Feature Roadmap

This document tracks the implemented and planned features for Activity.next.

## Current Features

### Core

- ✅ **ActivityPub federation** — Send and receive activities with other Fediverse servers
- ✅ **Notes** — Create, receive, edit, and delete posts
- ✅ **Replies** — Threaded conversation support, including on-demand fetching of full remote reply threads when viewing a remote status
- ✅ **Image attachments** — Upload and display images in posts
- ✅ **Boost / Repost** — Share other users' posts (with undo)
- ✅ **Like / Favorite** — React to posts (with undo)
- ✅ **Polls** — Create, vote on, and view poll results (single and multiple choice)
- ✅ **Quote posts (Mastodon 4.5)** — Quote another post with the full FEP-044f consent handshake (`QuoteRequest` → `Accept` + a hosted `QuoteAuthorization` stamp; revocation is a `Delete` of the stamp), a per-post quote-approval policy (`public` / `followers` / `nobody`) with a per-account default, and inbound interop with Fedibird (`quoteUri`) and Misskey (`_misskey_quote`) quotes (rendered as unapproved until a stamp verifies)
- ✅ **Multiple actors per account** — Create and switch between multiple handles under one account (e.g., `@user@domain.tld` and `@ride@domain.tld`)
- ✅ **Multi-domain support** — Different domains for different actors
- ✅ **Account blocks** — Block or unblock remote accounts and list blocked accounts
- ✅ **Domain blocks** — Block or unblock an entire remote domain and list your blocked domains via `/api/v1/domain_blocks`; blocking hides that domain's posts (and boosts) from your timelines, is reflected in `domain_blocking` on relationships, and severs follows in both directions
- ✅ **Follow requests** — Review, authorize, and reject follow requests
- ✅ **Custom emoji** — Instance-defined custom emoji with a sticker/emoji picker in the post box
- ✅ **Featured hashtags** — Feature hashtags on your profile and manage them from settings
- ✅ **Status translation** — Translate posts into your language via DeepL, LibreTranslate, or an OpenAI-compatible backend
- ✅ **Public & logged-out pages** — Logged-out landing page plus publicly viewable profile and status pages, with design-system error pages (404/500)

### Authentication & OAuth

- ✅ **Local authentication** — Email and password sign-up/sign-in (via [better-auth](https://www.better-auth.com/))
- ✅ **Passkeys** — Register and use passkeys for account authentication
- ✅ **Two-factor authentication** — TOTP-based second-factor login support
- ✅ **OAuth 2.0 provider** — App acts as a full OAuth 2.0 / OpenID Connect server
- ✅ **OIDC RP-Initiated Logout** — `end_session_endpoint` advertised in discovery; OAuth clients registered with `post_logout_redirect_uris` can drive single logout (sign the user out of this instance, not just the relying party)
- ✅ **OAuth Bearer tokens** — API authentication for third-party clients
- ✅ **Email verification** — Required for new accounts
- ✅ **Password reset** — Reset password via email

### Timelines & Notifications

- ✅ **Main timeline** — Home feed with posts from followed accounts
- ✅ **Favorites page** — Browse posts you've favorited
- ✅ **List timelines** — Per-list timelines honoring replies policy, exclusive lists, and block/mute/keyword filtering
- ✅ **Notifications** — Like, follow, mention, reblog, follow request, quote (someone quoted your post), quote-update (a post you quoted was edited), and collection (added-to-collection / collection-update) notifications
- ✅ **Notification grouping** — Group similar notifications together
- ✅ **Email notifications** — Configurable email alerts for each notification type
- ✅ **Push notifications** — Web Push subscriptions with VAPID configuration
- ✅ **Unread count** — Badge showing unread notification count

### Storage & Media

- ✅ **SQL database support** — SQLite and PostgreSQL, with MySQL-compatible Knex configuration paths
- ✅ **Media upload** — Upload images and video to local filesystem, S3, or S3-compatible object storage
- ✅ **Media management** — Browse, view, and delete uploaded media from the settings page with storage usage display
- ✅ **Profile media gallery** — Browse a user's public media posts from profile tabs
- ✅ **Fitness file storage** — Upload .fit, .gpx, and .tcx activity files
- ✅ **Fitness activity processing** — Parse GPS tracks and metrics from uploaded .fit, .gpx, and .tcx files
- ✅ **Fitness activity display** — Show route maps, activity statistics, analysis graphs, and device info in posts
- ✅ **Pluggable fitness map provider** — Choose `apple` (MapKit JS + Apple Maps Snapshots), `mapbox` (Mapbox GL JS + Static Images API), or `osm` (keyless MapLibre / OpenFreeMap) with `ACTIVITIES_FITNESS_MAP_PROVIDER`; missing or invalid credentials fall back to `osm`. Stored route-map PNGs keep the previous provider's style until the user runs **Regenerate maps** (`POST /api/v1/fitness/general/regenerate-maps`). With the `apple` provider, per-activity route-map images are rendered by Apple Web Snapshots; heatmap embed images with many activity segments exceed Apple's ~5,000-character snapshot URL limit and fall back to the built-in SVG heatmap renderer
- ✅ **Fitness route heatmaps** — Per-region master/detail heatmaps by actor and region (aggregated across all activities and all time), rendered on an interactive map through the configured map provider (Apple MapKit JS, Mapbox GL JS, or keyless MapLibre / OpenFreeMap), with live generation progress, per-heatmap cancel/retry/remove, inline region renaming, and shareable/embeddable views (iframe + image)
- ✅ **Strava import** — Import activities through Strava OAuth/webhooks and uploaded Strava archive ZIP files
- ✅ **Fitness import resilience** — Recover stuck/orphaned imports, resumable Strava archive retries, same-ride upload merging, and per-file retry from the UI; repair scripts cover legacy imports
- ✅ **Fitness privacy locations** — Hide configured location radii from route maps and heatmaps
- ✅ **Storage quotas** — Per-account file size and storage limits

### API Compatibility

- ✅ **Mastodon API v1/v2** — Compatible with Mastodon client applications (including iOS clients); statuses, accounts, and media endpoints are fully Mastodon-compatible
- ✅ **Mastodon-compatible status actions** — Favourite, reblog, bookmark, pin, context, history, translate, and relationship endpoints
- ✅ **Quote posts API (Mastodon 4.5)** — `quoted_status_id` + `quote_approval_policy` on `POST /api/v1/statuses`, the `quote` sub-entity and `quote_approval` on the Status entity, `GET /api/v1/statuses/:id/quotes`, `POST /api/v1/statuses/:id/quotes/:quoting_status_id/revoke`, `PUT /api/v1/statuses/:id/interaction_policy`, and the `posting:default:quote_policy` preference / `source[quote_policy]` on `update_credentials`; quote support is advertised to clients via `api_versions.mastodon: 7` on `GET /api/v2/instance`
- ✅ **Granular OAuth scopes** — Fine-grained scope enforcement and client-credentials app tokens
- ✅ **Search** — Search accounts, hashtags, and statuses via `/api/v2/search` (status search backed by a full-text index)
- ✅ **Lists** — Create and manage timeline lists, their members, replies policy, and exclusive flag
- ✅ **Collections** — curated account collections aligned with the **final Mastodon 4.6 spec**: dual request vocabulary (`name`/`tag_name`/`discoverable`/`sensitive`/`account_ids` plus the pre-final `title`/`topic`/`visibility` extensions), spec response entities (`WrappedCollection`, `CollectionWithAccounts`, `WrappedCollectionItem` with stable item ids), anonymous reads of discoverable collections, `GET /api/v1/accounts/:id/collections`, cross-owner `in_collections`, and item-id-addressed remove/revoke (account-id addressing kept as an extension). Plus an activities.next shareable **public feed** of each collection (owner-private and public projections, the public one limited to approved members and public-visibility posts) with a per-collection capped materialized feed. Collections federate outbound as **FEP-7aa9 `FeaturedCollection`** objects, auto-follow and backfill remote members' existing posts when they are added, and emit added-to-collection / collection-update notifications
- ✅ **Filters** — Keyword/status filters via `/api/v2/filters` with notification filtering, plus the deprecated Mastodon v1 `/api/v1/filters` (and `/api/v1/filters/:id`) compatibility shim served as a view over the same v2 filter storage
- ✅ **Reports** — Submit reports against accounts and statuses via `/api/v1/reports`
- ✅ **Admin moderation** — Moderate accounts and reports via the Mastodon admin API (`/api/v1/admin/accounts`, `/api/v2/admin/accounts`, `POST /api/v1/admin/accounts/:id/action`, the approve/reject/enable/unsilence/unsuspend/unsensitive state actions, suspended-first `DELETE`, and the reports workflow `GET`/`PUT /api/v1/admin/reports[/:id]` + `assign_to_self`/`unassign`/`resolve`/`reopen`), enforced instance-wide (sign-in, token acceptance, ActivityPub 410, inbound-inbox drops, timeline filtering, forced-sensitive creation), with per-actor moderation controls and a reports queue in the admin area (`/admin/accounts/:id`, `/admin/reports`)
- ✅ **Markers** — Save and restore per-timeline read positions
- ✅ **Announcements** — Read active instance announcements via `GET /api/v1/announcements`, dismiss them with `POST /api/v1/announcements/:id/dismiss`, and react with `PUT`/`DELETE /api/v1/announcements/:id/reactions/:name`; unread active announcements surface as a dismissible banner at the top of the home timeline for signed-in users, and admins manage them in the admin area (`/admin/announcements`) backed by `/api/v2/admin/announcements`
- ✅ **Endorsements** — Feature accounts on your profile
- ✅ **Account notes & preferences** — Private per-account notes and client preferences
- ✅ **Profile entity** — `GET`/`PATCH /api/v1/profile` return the Mastodon 4.6 `Profile` entity (raw `display_name`/`note`/`fields`, nullable `avatar`/`header`, and the appearance preferences `avatar_description`/`header_description`/`hide_collections`/`indexable`/`show_media`/`show_media_replies`/`show_featured`/`attribution_domains`); PATCH accepts and persists those appearance params on the actor's settings, while `PATCH /api/v1/accounts/update_credentials` still returns `CredentialAccount`
- ✅ **Featured tags API** — `/api/v1/featured_tags` endpoints plus the Mastodon 4.4 `POST /api/v1/tags/:tag/feature` and `POST /api/v1/tags/:tag/unfeature` aliases (both returning the `Tag` entity with the `featuring` flag), backing the profile featured-hashtags feature
- ✅ **Follow suggestions** — friends-of-friends suggestions via `GET /api/v2/suggestions` (plus deprecated `GET /api/v1/suggestions`), with per-account dismissal via `DELETE /api/v1/suggestions/:account_id`
- ✅ **Trends** — local trending hashtags via `GET /api/v1/trends/tags` (plus deprecated `GET /api/v1/trends`) and trending statuses via `GET /api/v1/trends/statuses`, both computed live from the last seven days of public local activity; `GET /api/v1/trends/links` intentionally stays an empty list (no preview-card storage)
- ✅ **Followed hashtags** — Follow and unfollow hashtags and view a followed-tags timeline
- ✅ **Mutes** — Mute and unmute accounts
- ✅ **WebFinger** — Actor discovery via `/.well-known/webfinger`
- ✅ **NodeInfo** — Instance metadata at `/.well-known/nodeinfo`
- ✅ **OAuth Authorization Server metadata** — At `/.well-known/oauth-authorization-server`
- ✅ **Instance legal documents** — Admin-configured plain-text pages via `GET /api/v1/instance/privacy_policy` and `GET /api/v1/instance/terms_of_service` (plus `GET /api/v1/instance/terms_of_service/:date`), backed by the optional `ACTIVITIES_PRIVACY_POLICY` / `ACTIVITIES_TERMS_OF_SERVICE` config keys; each returns 404 when its document is unset
- ✅ **Health check** — Unauthenticated `GET /health` liveness probe returning `{"status":"UP"}`
- ✅ **oEmbed provider** — `GET /api/oembed` returns rich embed metadata for this instance's public/unlisted status pages, discoverable via the `application/json+oembed` `<link>` emitted on every status page
- ✅ **Notification policy** — Filtered-notification policy via `GET|PUT|PATCH /api/v2/notifications/policy`, plus the deprecated `GET|PUT|PATCH /api/v1/notifications/policy` alias serving the legacy `filter_*` boolean entity
- 📖 **[Mastodon API compatibility reference](./mastodon-api-compatibility.md)** — Intentional divergences (e.g. 7-day OAuth tokens), unplanned endpoints, and activities.next-only extensions

### Infrastructure

- ✅ **Background jobs** — Async processing via Upstash QStash (with synchronous fallback)
- ✅ **Email sending** — SMTP, Resend, AWS SES, or AWS Lambda
- ✅ **Docker support** — Official container image at `ghcr.io/llun/activities.next`
- ✅ **Vercel deployment** — Deploy as a serverless Next.js application
- ✅ **Federation controls** — Admin allow/block rules, import for domain blocks, and allowlist mode
- ✅ **Database-backed server settings** — Edit instance identity, registrations, post/poll/upload limits, and federation policy from the admin area, resolved `env → database → default` (an environment variable wins and locks the field). See [Environment Variables](environment-variables.md#database-backed-server-settings-env--database--default)

## In Progress

- 🚧 **Inbound collection federation** — Outbound `FeaturedCollection` federation has shipped; consuming remote `FeaturedCollection` objects is still maturing

## Planned Features

- [ ] Streaming API for real-time updates
- [ ] Bookmark collections
- [ ] Media attachment `blurhash` computation and animated-GIF `gifv` detection (Mastodon `MediaAttachment` parity — currently always `blurhash: null`, and GIFs are served as `type: "image"`)

## Feature Requests

If you have a feature request, please [open an issue](https://github.com/llun/activities.next/issues/new) with the "feature request" label.
