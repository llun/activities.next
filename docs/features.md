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

- ✅ **Mastodon API v1/v2** — Compatible with Mastodon client applications
- ✅ **Mastodon-compatible status actions** — Favourite, reblog, bookmark, pin, context, history, and relationship endpoints
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

- 🚧 **Mastodon compatibility gaps** — Lists, followed tags, mutes, and search endpoints exist but are not fully implemented
- 🚧 **Fitness import hardening** — Repair and resume scripts cover interrupted or legacy Strava imports while the importer continues to mature

## Planned Features

- [ ] Streaming API for real-time updates
- [ ] Expanded moderation workflows and reporting
- [ ] Tag following
- [ ] Lists
- [ ] Bookmark collections
- [ ] Full-text search

## Feature Requests

If you have a feature request, please [open an issue](https://github.com/llun/activities.next/issues/new) with the "feature request" label.
