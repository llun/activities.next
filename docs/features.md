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
- ✅ **Multi-domain support** — Different domains for different actors

### Authentication & OAuth

- ✅ **Local authentication** — Email and password sign-up/sign-in (via [better-auth](https://www.better-auth.com/))
- ✅ **GitHub OAuth** — Sign in with GitHub
- ✅ **OAuth 2.0 provider** — App acts as a full OAuth 2.0 / OpenID Connect server
- ✅ **OAuth Bearer tokens** — API authentication for third-party clients
- ✅ **Email verification** — Required for new accounts
- ✅ **Password reset** — Reset password via email

### Timelines & Notifications

- ✅ **Main timeline** — Home feed with posts from followed accounts
- ✅ **Notifications** — Like, follow, mention, reblog, and follow request notifications
- ✅ **Notification grouping** — Group similar notifications together
- ✅ **Email notifications** — Configurable email alerts for each notification type
- ✅ **Unread count** — Badge showing unread notification count

### Storage & Media

- ✅ **SQL database support** — SQLite and PostgreSQL via Knex.js
- ✅ **Media upload** — Upload images to local filesystem, S3, or S3-compatible object storage
- ✅ **Fitness file storage** — Upload .fit, .gpx, and .tcx activity files
- ✅ **Storage quotas** — Per-account file size and storage limits

### API Compatibility

- ✅ **Mastodon API v1/v2** — Compatible with Mastodon client applications
- ✅ **WebFinger** — Actor discovery via `/.well-known/webfinger`
- ✅ **NodeInfo** — Instance metadata at `/.well-known/nodeinfo`
- ✅ **OAuth Authorization Server metadata** — At `/.well-known/oauth-authorization-server`

### Infrastructure

- ✅ **Background jobs** — Async processing via Upstash QStash (with synchronous fallback)
- ✅ **Email sending** — SMTP, Resend, AWS SES, or AWS Lambda
- ✅ **Docker support** — Official container image at `ghcr.io/llun/activities.next`
- ✅ **Vercel deployment** — Deploy as a serverless Next.js application

## In Progress

- 🚧 **Fitness activity processing** — GPS data parsing, map generation from uploaded files
- 🚧 **Strava import** — Import activity data from Strava archives
- 🚧 **Media timeline** — Timeline filtered to show only posts with media attachments

## Planned Features

- [ ] Multiple actors under the same account (for different handles, e.g., `@ride@example.com`)
- [ ] ActivityStreams extensions (e.g., for bicycle rides, running activities)
- [ ] Streaming API for real-time updates
- [ ] Media management improvements (gallery view, bulk delete)
- [ ] Enhanced moderation tools
- [ ] Federation controls and domain blocks
- [ ] Tag following
- [ ] Lists
- [ ] Bookmark collections
- [ ] Full-text search

## Feature Requests

If you have a feature request, please [open an issue](https://github.com/llun/activities.next/issues/new) with the "feature request" label.
