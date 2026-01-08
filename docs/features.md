# Feature Roadmap

This document tracks the implemented and planned features for Activity.next.

## Current Features

- ✅ User authentication with GitHub (via NextAuth.js)
- ✅ Local account setup with username and password
- ✅ Notes - both receive and send
- ✅ Replies
- ✅ Image attachment support
- ✅ Boost/Repost functionality
- ✅ Undo Boost/Repost
- ✅ Like/Favorite
- ✅ SQL database support via Knex.js (SQLite, PostgreSQL, MySQL)
- ✅ Support for different domains for different actors
- ✅ Media upload support via Object Storage (S3, GCS, etc.)
- ✅ OAuth Bearer token authentication
- ✅ Main timeline

## In Progress

- 🚧 Poll support
  - ✅ View poll and poll results
  - [ ] Vote on polls
  - [ ] Create polls
- 🚧 Mastodon API compatibility and client support
- 🚧 Additional timelines
  - ✅ Main timeline
  - 🚧 Notifications timeline
  - [ ] Media timeline

## Planned Features

- [ ] Multiple actors under the same account (for different handles and types, e.g., `@ride@example.com`)
- [ ] ActivityStreams extensions (e.g., for bicycle rides, running, etc.)
- [ ] Streaming API
- [ ] Media management improvements
- [ ] Enhanced moderation tools
- [ ] Federation controls and domain blocks
- [ ] Tag following
- [ ] Lists
- [ ] Bookmark collections
- [ ] Search functionality

## Feature Requests

If you have a feature request, please [open an issue](https://github.com/llun/activities.next/issues/new) with the "feature request" label.
