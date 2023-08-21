# Activity.next, ActivityPub server with Next.JS

Activity.Next is single actor ActivityPub server (but plan to support
multiple actors under the same account later.) Currently it's in very
alpha stage and has only few features supported.

## Plan features and progress

- ✅ User authenticate with Github (via NextAuth.js)
- ✅ Note, both receive and send
- ✅ Reply
- ✅ Image attachment via Apple Shared Album
- ✅ Boost/Repost
- ✅ Undo Boost/Repost
- ✅ Like
- ✅ Storage adapter, current supports are SQL via Knex.js (Tested with SQLite locally) and Firebase
- 🚧 Account setup with username and password
- [ ] Add actor under the same account (for different handle and type e.g. for `@ride@llun.dev`)
- ✅ Support different domain for different actor
- 🚧 Poll
  - ✅ View poll and poll result
  - [ ] Vote on the poll
  - [ ] Create a poll
- 🚧 Image storage via Object Storage(S3, GCS, etc)
- [ ] Streaming
- 🚧 Timelines
  - ✅ Main timeline
  - [ ] Notifications timeline
  - [ ] Medias timeline
- 🚧 OAuth Bearer
- [ ] Mastodon API compatible and clients supports
- [ ] GPS Activity e.g. Bicycle ride, Running etc

## Setup

Follow [this document](docs/setup.md) to setup your local server

### Host it on Vercel

Fork the project and setup Vercel to the Github repo and add
below environment variables

```
ACTIVITIES_HOST=domain.tld,
ACTIVITIES_DATABASE='{"type":"sql","client":"better-sqlite3","useNullAsDefault":true,"connection":{"filename":"./dev.sqlite3"}}'
ACTIVITIES_SECRET_PHASE='random-hash-for-cookie'
ACTIVITIES_ALLOW_EMAILS='[]'
ACTIVITIES_ALLOW_MEDIA_DOMAINS='[]'
ACTIVITIES_AUTH='{"github":{"id":"GITHUB_APP_CLIENT_ID","secret":"GITHUB_APP_SECRET"}}'
```

Change the database client to your database type e.g. pg and update
the connection with your database configuration.
