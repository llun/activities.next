# Features

The features Activity.next ships today. Most lines link to the documentation that covers the feature in detail; some features have no separate doc.

## Current Features

### Core

- ✅ **ActivityPub federation** — Send and receive activities with other Fediverse servers ([Architecture](architecture.md#activitypub-federation))
- ✅ **Notes** — Create, receive, edit, and delete posts ([Mastodon API](mastodon-api-compatibility.md#status-posts--actions))
- ✅ **Profile federation** — Profile edits, deletions, moves and aliases federate as `Update(Person)`, `Delete(actor)` and `Move`, and the "mark media as sensitive" flag travels with notes ([Architecture](architecture.md#actor-profile--deletion-federation))
- ✅ **Account migration (outgoing)** — Move your followers to another account, or leave a redirect pointer behind ([Architecture](architecture.md#account-migration-move))
- ✅ **Handle rename (in place)** — Rename your account without changing its links, and keep old handles resolving forever ([Architecture](architecture.md#handle-rename))
- ✅ **Replies** — Threaded conversation support, including on-demand fetching of full remote reply threads ([Architecture](architecture.md#reply-addressing-and-communities-fep-1b12))
- ✅ **Combined self-replies in the timeline** — A run of quick replies by one author to their own posts shows as one post, with other people's short replies tucked in ([Architecture](architecture.md#client-component-patterns))
- ✅ **Combined self-replies on the post page** — Opening any post of a run shows the author's quick self-replies around it as one run, with the opened part marked; same-author runs among its ancestors are grouped the same way ([Architecture](architecture.md#client-component-patterns))
- ✅ **Federated Audio and Event objects** — Funkwhale tracks and Mobilizon/Gancio events from other servers are stored as posts ([Mastodon API](mastodon-api-compatibility.md#activitypub--json-ld))
- ✅ **Image and video attachments** — Upload and display images and video in posts, with automatic preview frames and blurhash ([Architecture](architecture.md#media--file-storage))
- ✅ **Boost / Repost** — Share other users' posts, with undo ([Mastodon API](mastodon-api-compatibility.md#status-posts--actions))
- ✅ **Like / Favorite** — React to posts, with undo ([Mastodon API](mastodon-api-compatibility.md#status-posts--actions))
- ✅ **Polls** — Create, vote on, and view poll results, single and multiple choice ([Mastodon API](mastodon-api-compatibility.md#status-posts--actions))
- ✅ **Quote posts (Mastodon 4.5)** — Quote another post with the FEP-044f consent handshake and a per-post quote-approval policy ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **Multiple profiles per account & account menu** — Create and switch between multiple handles/profiles under one account from the account menu ([Architecture](architecture.md#navigation-customization))
- ✅ **Multi-domain support** — Different domains for different actors ([Architecture](architecture.md#served-domains))
- ✅ **Account blocks** — Block or unblock remote accounts and list blocked accounts ([Mastodon API](mastodon-api-compatibility.md))
- ✅ **Domain blocks** — Block an entire remote domain; its posts disappear from your timelines and follows are severed in both directions ([Mastodon API](mastodon-api-compatibility.md))
- ✅ **Follow requests** — Review, authorize, and reject follow requests ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Custom emoji** — Instance-defined custom emoji with a picker in the post box and `:shortcode:` support across names, bios, fields, warnings, poll choices and media descriptions ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **Profile links** — Up to four label/content fields under the bio, federated in the actor document, with background link-back verification as on Mastodon ([Architecture](architecture.md#profile-links-fields-storage-and-formatting))
- ✅ **Featured hashtags** — Feature hashtags on your profile and manage them in the Featured hashtags section of Edit profile ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Status translation** — Translate posts into your language via DeepL, Gemini, or an OpenAI-compatible backend ([Environment Variables](environment-variables.md#translation))
- ✅ **Public & logged-out pages** — Logged-out landing page plus publicly viewable profile and status pages, with design-system error pages (404/500) ([Mastodon API](mastodon-api-compatibility.md#publicly-readable-status-ids))

### Authentication & OAuth

- ✅ **Local authentication** — Email and password sign-up/sign-in via better-auth ([Architecture](architecture.md#authentication))
- ✅ **Passkeys** — Register and use passkeys for account authentication ([Setup](setup.md#authentication-methods))
- ✅ **Two-factor authentication** — TOTP-based second-factor login support ([Setup](setup.md#authentication-methods))
- ✅ **OAuth 2.0 provider** — The app acts as a full OAuth 2.0 / OpenID Connect server ([Architecture](architecture.md#authentication))
- ✅ **OIDC RP-Initiated Logout** — `end_session_endpoint` advertised in discovery; OAuth clients registered with `post_logout_redirect_uris` can drive single logout
- ✅ **OAuth Bearer tokens** — API authentication for third-party clients ([Architecture](architecture.md#oauth-access-token-sliding-expiry))
- ✅ **Email verification** — Required for new accounts ([Architecture](architecture.md#an-unconfirmed-account-may-not-act))
- ✅ **Password reset** — Reset password via email ([Architecture](architecture.md#authentication))
- ✅ **Sign out & unsent draft protection** — Sign-out confirms first and warns about unsent queued posts, and preserves them if sign-out fails or is offline

### Timelines & Notifications

- ✅ **Main timeline** — Home feed with posts from followed accounts ([Architecture](architecture.md#client-component-patterns))
- ✅ **Favorites page** — Browse posts you've favorited ([Mastodon API](mastodon-api-compatibility.md#status-posts--actions))
- ✅ **List timelines** — Per-list timelines honoring replies policy, exclusive lists, and block/mute/keyword filtering; you can add yourself to your own list ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Notifications** — Like, follow, mention, reblog, follow request, quote, quote-update, and emoji reaction notifications ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Notification grouping** — Group similar notifications together ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Email notifications** — Configurable email alerts for each notification type, including fitness activity imports ([Architecture](architecture.md#transactional--notification-emails))
- ✅ **Push notifications** — Web Push subscriptions with VAPID configuration ([Setup](setup.md#push-notifications-optional))
- ✅ **Unread count** — Badge showing the unread notification count on the Notifications row, never on the mobile menu button; the Admin row carries the unresolved report count ([Architecture](architecture.md#navigation-customization))
- ✅ **Customizable navigation** — Hide, restore, and reorder the sidebar per account, with hidden items tucked under a More group ([Architecture](architecture.md#navigation-customization))
- ✅ **Status emoji reactions** — React to any post with a unicode or custom emoji, federating both ways with Pleroma/Akkoma and the Misskey family ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Link preview cards** — A post containing a link shows a card with the page's title, description, publisher and thumbnail, with a click-to-play YouTube player for video links ([Architecture](architecture.md#link-preview-cards))

### Storage & Media

- ✅ **SQL database support** — SQLite and PostgreSQL ([Setup](setup.md#database-setup))
- ✅ **Media upload** — Upload images and video to local filesystem, S3, or S3-compatible object storage ([Setup](setup.md#media-storage-optional))
- ✅ **Blurhash & smart focal points** — Automatic server-side blurhash placeholders and saliency-based focal point detection on uploaded images and video preview frames ([Architecture](architecture.md#media--file-storage))
- ✅ **Automated alt text** — Generate accessibility descriptions for uploaded images and videos from a configured OpenAI-compatible vision endpoint ([Environment Variables](environment-variables.md#alt-text-generation))
- ✅ **Account data export** — Download a zip of everything an account owns, plus Mastodon-compatible CSV exports ([Architecture](architecture.md#account-data-export))
- ✅ **Account archive import** — Import a Mastodon archive or this server's own export, and Mastodon-compatible CSV files, into the current profile ([Architecture](architecture.md#account-data-import))
- ✅ **Media management** — Browse, view, and delete uploaded media from the settings page with storage usage display ([Maintenance](maintenance.md#deleting-media-a-post-uses))
- ✅ **Media details & EXIF** — Uploaded photos carry optional subject, taken-at, gear, exposure and place details, with EXIF read once at upload to pre-fill them ([Maintenance](maintenance.md#media-details-exif-and-gallery-settings))
- ✅ **Photo editor** — Crop, straighten and adjust your own photos in the browser, with local adjustments on up to four masks and curated presets ([Architecture](architecture.md#photo-editor-client))
- ✅ **Animated GIF and GIFV playback** — Detect and play animated GIFs and GIFV attachments according to the reader's saved GIF autoplay preference, with manual playback controls ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Gallery** — An owner-only `/gallery` section (Subjects, All media, Albums, Map, Life list, Gear, Privacy) over photos with media details, with photos you add kept private until you post them ([Maintenance](maintenance.md#media-details-exif-and-gallery-settings))
- ✅ **Gallery albums** — Group your own gallery photos into albums, with suggested trips, species series and activity days, and public/private visibility ([Architecture](architecture.md#gallery-albums))
- ✅ **Public albums** — A public album opens for anyone at `/@user@domain/albums/<id>` with no sign-in, showing each visitor only the photos they could read ([Architecture](architecture.md#gallery-albums))
- ✅ **Add to an album from anywhere** — Add photos to albums from the media details dialog, the lightbox, or Select mode in Gallery → All media ([Architecture](architecture.md#gallery-albums))
- ✅ **Smart subjects, threatened-species hiding and place names** — Suggested photo subjects checked against the GBIF Backbone Taxonomy, with the place of a threatened species hidden from everyone but the owner, and place names from OpenStreetMap ([Environment Variables](environment-variables.md#gallery-lookups))
- ✅ **Profile media gallery** — Browse a user's public media posts from profile tabs ([Architecture](architecture.md#profile-tabs-and-the-edit-profile-page))
- ✅ **Profile tab visibility** — Hide the Replies, Media, Gallery and Fitness tabs of a profile from every viewer ([Architecture](architecture.md#profile-tabs-and-the-edit-profile-page))
- ✅ **Edit profile page** — Edit everything public about the actor in one place, with a live preview on wide screens ([Architecture](architecture.md#profile-tabs-and-the-edit-profile-page))
- ✅ **Profile settings & sections** — Profile-scoped settings organized under a section index: Edit profile, Appearance, Posting & reading, Notifications, Sidebar, Media & AI, Privacy & safety, Moving, and Delete this profile ([Architecture](architecture.md#surfaces-shared-surface-kit))
- ✅ **Account & security settings & sections** — Account settings shared across your profiles: Email & name, Password & sign-in, Sessions & apps, Profiles, and Import and export ([Architecture](architecture.md#surfaces-shared-surface-kit))
- ✅ **Fitness file storage** — Upload .fit, .gpx, and .tcx activity files ([Fitness File Storage](fitness-file-storage.md#overview))
- ✅ **Fitness activity processing** — Parse GPS tracks and metrics from uploaded .fit, .gpx, and .tcx files ([Fitness File Storage](fitness-file-storage.md#processing-pipeline))
- ✅ **Fitness activity display** — Show route maps, activity statistics, analysis graphs, and device info in posts ([Fitness File Storage](fitness-file-storage.md#user-facing-features))
- ✅ **Fitness overview** — A training calendar in the viewer's own time zone, with totals and per-activity-type breakdowns over a chosen range ([Architecture](architecture.md#fitness-overview-calendar))
- ✅ **Pluggable fitness map provider** — Choose `apple`, `mapbox`, or keyless `osm` for interactive and static maps, with fallback to `osm` ([Environment Variables](environment-variables.md#fitness-map-provider))
- ✅ **Fitness route heatmaps** — Per-region heatmaps by actor, aggregated across all activities and all time, drawn from a tile pyramid so zooming in reveals street-level detail ([Fitness File Storage](fitness-file-storage.md#route-heatmap-tile-pyramid))
- ✅ **Gear tracking** — Track bikes and shoes and the components fitted to a bike, with lifetime distance derived from activities and optional service reminders ([Fitness File Storage](fitness-file-storage.md#gear-tracking))
- ✅ **Recording devices** — The head unit or watch each activity was recorded on becomes gear of its own, created automatically from the file ([Fitness File Storage](fitness-file-storage.md#recording-devices))
- ✅ **Strava import** — Import activities through Strava OAuth/webhooks and uploaded Strava archive ZIP files ([Fitness File Storage](fitness-file-storage.md#user-facing-features))
- ✅ **Fitness import resilience** — Recover stuck or orphaned imports, resumable Strava archive retries, same-ride upload merging, and per-file retry from the UI ([Fitness File Storage](fitness-file-storage.md#maintenance-scripts))
- ✅ **Fitness privacy locations** — Trim the start and finish of a route around configured locations on route maps and route data ([Fitness File Storage](fitness-file-storage.md#security-and-privacy))
- ✅ **Storage quotas** — Per-account file size and storage limits ([Environment Variables](environment-variables.md#media-storage))

### API Compatibility

- ✅ **Mastodon API v1/v2** — Compatible with Mastodon client applications, including iOS clients; statuses, accounts, and media endpoints are fully Mastodon-compatible ([Mastodon API compatibility](mastodon-api-compatibility.md))
- ✅ **Mastodon-compatible status actions** — Favourite, reblog, bookmark, pin, context, history, translate, and relationship endpoints ([Mastodon API](mastodon-api-compatibility.md#status-posts--actions))
- ✅ **Quote posts API (Mastodon 4.5)** — `quoted_status_id` and the quote sub-entity, quote revocation, and the `posting:default:quote_policy` preference ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **Granular OAuth scopes** — Fine-grained scope enforcement and client-credentials app tokens ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Search** — Search accounts, hashtags, and statuses via `/api/v2/search`, with status search backed by a full-text index ([Mastodon API](mastodon-api-compatibility.md))
- ✅ **Lists** — Create and manage timeline lists, their members, replies policy, and exclusive flag, with yourself allowed as a member as in Mastodon ≥ 4.2 ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Filters** — Keyword/status filters via `/api/v2/filters` with notification filtering, plus the deprecated v1 compatibility shim, and admin server filters ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **Reports** — Submit reports against accounts and statuses, forwarded to the remote server as an ActivityPub `Flag`, and inbound `Flag`s from other servers become local reports ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **Admin moderation** — Moderate accounts and reports via the Mastodon admin API, enforced instance-wide, with a reports queue in the admin area ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **Markers** — Save and restore per-timeline read positions ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Announcements** — Read, dismiss and react to instance announcements, per served domain, managed in the admin area ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **Endorsements** — Feature accounts on your profile
- ✅ **Account notes & preferences** — Private per-account notes and client preferences
- ✅ **Profile entity** — `GET`/`PATCH /api/v1/profile` return the Mastodon 4.6 `Profile` entity with appearance preferences ([Architecture](architecture.md#actor-profile--deletion-federation))
- ✅ **Featured tags API** — `/api/v1/featured_tags` endpoints plus the Mastodon 4.4 feature/unfeature aliases ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Follow suggestions** — Friends-of-friends suggestions via `GET /api/v2/suggestions`, with per-account dismissal
- ✅ **Trends** — Local trending hashtags and statuses computed live from the last seven days of public local activity; `GET /api/v1/trends/links` intentionally stays empty ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Followed hashtags** — Follow and unfollow hashtags and view a followed-tags timeline ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Mutes** — Mute and unmute accounts ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **WebFinger** — Actor discovery via `/.well-known/webfinger`, including the remote-follow subscribe template ([Architecture](architecture.md#activitypub-federation))
- ✅ **Remote follow** — Both directions of the fediverse remote-follow handshake, turned off for a moved profile ([Mastodon API](mastodon-api-compatibility.md#extensions))
- ✅ **NodeInfo** — Instance metadata at `/.well-known/nodeinfo` (NodeInfo 2.0 and 2.1) ([Architecture](architecture.md#directory-structure))
- ✅ **OAuth Authorization Server metadata** — At `/.well-known/oauth-authorization-server` ([Architecture](architecture.md#directory-structure))
- ✅ **Instance legal documents** — A terms of service and a privacy policy written in Markdown in the admin area, served by the Mastodon endpoints and required at sign-up when set ([Mastodon API](mastodon-api-compatibility.md#intentional-divergences))
- ✅ **Health check** — Unauthenticated `GET /health` liveness probe returning `{"status":"UP"}` ([Architecture](architecture.md#directory-structure))
- ✅ **Browser Web Vitals (opt-in)** — A sampled share of page loads reports LCP, CLS and INP to `POST /api/v1/web-vitals` ([Architecture](architecture.md#browser-web-vitals))
- ✅ **oEmbed provider** — `GET /api/oembed` returns rich embed metadata for this instance's public/unlisted status pages ([Architecture](architecture.md#directory-structure))
- ✅ **Notification policy** — Filtered-notification policy via `GET|PUT|PATCH /api/v2/notifications/policy`, plus the deprecated v1 alias
- ✅ **CSV export and import** — Mastodon-format CSV exports, and resumable background CSV imports via `POST /api/v1/imports` ([Architecture](architecture.md#bulk-imports-csv))
- 📖 **[Mastodon API compatibility reference](./mastodon-api-compatibility.md)** — Intentional divergences, unplanned endpoints, and activities.next-only extensions

### Infrastructure

- ✅ **Background jobs** — Async processing via Upstash QStash or Google Cloud Tasks, with synchronous fallback ([Architecture](architecture.md#background-jobs))
- ✅ **Email sending** — SMTP, Resend, or AWS SES (optional; notification delivery is best effort) ([Setup](setup.md#email-configuration-optional))
- ✅ **Docker support** — Official minimal container image at `ghcr.io/llun/activities.next` (SQLite default) ([Setup](setup.md#docker-deployment))
- ✅ **Vercel deployment** — Deploy as a serverless Next.js application ([Setup](setup.md#vercel-deployment))
- ✅ **Federation controls** — Admin allow/block rules, import for domain blocks, and allowlist mode ([Environment Variables](environment-variables.md#domain-controls))
- ✅ **Multiple domains** — Serve profiles on more than one domain from one server, each with its own sign-ups, identity, policies, rules, announcements, features and reports ([Architecture](architecture.md#served-domains))
- ✅ **Database-backed server settings** — Edit instance identity, registrations, post/poll/upload limits, and federation policy from the admin area, resolved `env → database → default` (an environment variable wins and locks the field). See [Environment Variables](environment-variables.md#database-backed-server-settings-env--database--default)

Feature requests are welcome — please [open an issue](https://github.com/llun/activities.next/issues/new) with the "feature request" label.
