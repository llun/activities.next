# Feature Roadmap

This document tracks the implemented and planned features for Activity.next.

## Current Features

### Core

- ✅ **ActivityPub federation** — Send and receive activities with other Fediverse servers
- ✅ **Notes** — Create, receive, edit, and delete posts
- ✅ **Replies** — Threaded conversation support
- ✅ **Image attachments** — Upload and display images in posts
- ✅ **Boost / Repost** — Share other users' posts (with undo)
- ✅ **Like / Favorite** — React to posts (with undo)
- ✅ **Polls** — Create, vote on, and view poll results (single and multiple choice)
- ✅ **Multiple actors per account** — Create and switch between multiple handles under one account (e.g., `@user@domain.tld` and `@ride@domain.tld`)
- ✅ **Multi-domain support** — Different domains for different actors
- ✅ **Account blocks** — Block or unblock remote accounts and list blocked accounts
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
- ✅ **OAuth Bearer tokens** — API authentication for third-party clients
- ✅ **Email verification** — Required for new accounts
- ✅ **Password reset** — Reset password via email

### Timelines & Notifications

- ✅ **Main timeline** — Home feed with posts from followed accounts
- ✅ **Favorites page** — Browse posts you've favorited
- ✅ **List timelines** — Per-list timelines honoring replies policy, exclusive lists, and block/mute/keyword filtering
- ✅ **Notifications** — Like, follow, mention, reblog, and follow request notifications
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
- ✅ **Fitness route heatmaps** — Generate route heatmap caches by actor, activity type, period, and region
- ✅ **Strava import** — Import activities through Strava OAuth/webhooks and uploaded Strava archive ZIP files
- ✅ **Fitness privacy locations** — Hide configured location radii from route maps and heatmaps
- ✅ **Storage quotas** — Per-account file size and storage limits

### API Compatibility

- ✅ **Mastodon API v1/v2** — Compatible with Mastodon client applications (including iOS clients); statuses, accounts, and media endpoints are fully Mastodon-compatible
- ✅ **Mastodon-compatible status actions** — Favourite, reblog, bookmark, pin, context, history, translate, and relationship endpoints
- ✅ **Granular OAuth scopes** — Fine-grained scope enforcement and client-credentials app tokens
- ✅ **Search** — Search accounts, hashtags, and statuses via `/api/v2/search` (status search backed by a full-text index)
- ✅ **Lists** — Create and manage timeline lists, their members, replies policy, and exclusive flag
- ✅ **Filters** — Keyword/status filters via `/api/v2/filters` with notification filtering
- ✅ **Reports** — Submit reports against accounts and statuses via `/api/v1/reports`
- ✅ **Markers** — Save and restore per-timeline read positions
- ✅ **Announcements** — Read active instance announcements via `GET /api/v1/announcements`, dismiss them with `POST /api/v1/announcements/:id/dismiss`, and react with `PUT`/`DELETE /api/v1/announcements/:id/reactions/:name`; unread active announcements surface as a dismissible banner at the top of the home timeline for signed-in users, and admins manage them in the admin area (`/admin/announcements`) backed by `/api/v2/admin/announcements`
- ✅ **Endorsements** — Feature accounts on your profile
- ✅ **Account notes & preferences** — Private per-account notes and client preferences
- ✅ **Featured tags API** — `/api/v1/featured_tags` endpoints backing the profile featured-hashtags feature
- ✅ **Follow suggestions** — friends-of-friends suggestions via `GET /api/v2/suggestions` (plus deprecated `GET /api/v1/suggestions`), with per-account dismissal via `DELETE /api/v1/suggestions/:account_id`
- ✅ **Trends** — local trending hashtags via `GET /api/v1/trends/tags` (plus deprecated `GET /api/v1/trends`) and trending statuses via `GET /api/v1/trends/statuses`, both computed live from the last seven days of public local activity; `GET /api/v1/trends/links` intentionally stays an empty list (no preview-card storage)
- ✅ **Followed hashtags** — Follow and unfollow hashtags and view a followed-tags timeline
- ✅ **Mutes** — Mute and unmute accounts
- ✅ **WebFinger** — Actor discovery via `/.well-known/webfinger`
- ✅ **NodeInfo** — Instance metadata at `/.well-known/nodeinfo`
- ✅ **OAuth Authorization Server metadata** — At `/.well-known/oauth-authorization-server`

### Infrastructure

- ✅ **Background jobs** — Async processing via Upstash QStash (with synchronous fallback)
- ✅ **Email sending** — SMTP, Resend, AWS SES, or AWS Lambda
- ✅ **Docker support** — Official container image at `ghcr.io/llun/activities.next`
- ✅ **Vercel deployment** — Deploy as a serverless Next.js application
- ✅ **Federation controls** — Admin allow/block rules, import for domain blocks, and allowlist mode

## In Progress

- 🚧 **Fitness import hardening** — Repair and resume scripts cover interrupted or legacy Strava imports while the importer continues to mature

## Planned Features

- [ ] Streaming API for real-time updates
- [ ] Moderation review dashboard for submitted reports
- [ ] Bookmark collections

## Feature Requests

If you have a feature request, please [open an issue](https://github.com/llun/activities.next/issues/new) with the "feature request" label.
