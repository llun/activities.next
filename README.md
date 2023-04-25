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

## Running locally

For SQLite (or SQL database), add `config.json`

```
{
  "host": "domain.tld",
  "database": {
    "type": "knex",
    "client": "better-sqlite3",
    "useNullAsDefault": true,
    "connection": {
      "filename": "./dev.sqlite3"
    }
  },
  "allowMediaDomains": [],
  "allowEmails": [],
  "secretPhase": "random-hash-for-cookie",
  "auth": {
    "github": {
      "id": "GITHUB_APP_CLIENT_ID",
      "secret": "GITHUB_APP_SECRET"
    }
  }
}
```

and run database migration with `yarn migrate`.

To start the server, run `yarn dev` or build the server with
`yarn build` and start it with `yarn start`

### Host it on Vercel

Fork the project and setup Vercel to the Github repo and add
below environment variables

```
ACTIVITIES_HOST=domain.tld,
ACTIVITIES_DATABASE='{"type":"knex","client":"better-sqlite3","useNullAsDefault":true,"connection":{"filename":"./dev.sqlite3"}}'
ACTIVITIES_SECRET_PHASE='random-hash-for-cookie'
ACTIVITIES_ALLOW_EMAILS='[]'
ACTIVITIES_ALLOW_MEDIA_DOMAINS='[]'
ACTIVITIES_AUTH='{"github":{"id":"GITHUB_APP_CLIENT_ID","secret":"GITHUB_APP_SECRET"}}'
```

Change the database client to your database type e.g. pg and update
the connection with your database configuration.

### Firebase

To use Firebase, change the type to `firebase` and add the configuration
that Firebase provide e.g.

```
{
  "type": "firebase",
  "apiKey": "FireBaseAPIKey",
  "authDomain": "project.firebaseapp.com",
  "projectId": "project",
  "storageBucket": "project.appspot.com",
  "messagingSenderId": "senderId",
  "appId": "appId",
  "measurementId": "measurementId"
}
```

and add below index to FireStore

- Collection `statuses`, `actorId` Ascending, `createdAt` Descending
- Collection `statuses`, `reply` Ascending, `createdAt` Descending
- Collection `statuses`, `actorId` Ascending, `reply` Ascending, `createdAt` Descending
- Collection `statuses`, `to` Arrays, `actorId` Ascending, `createdAt` Descending
- Collection `follows`, `actorId` Ascending, `status` Ascending, `targetActorId` Ascending, `createdAt` Descending
- Collection `timelines`, `timeline` Ascending, `createdAt` Descending
- Collection group `accountProviders`, `provider` Ascending, `accountId` Ascending
- Exemptions collection group `sessions`, `token` Ascending
- Exemptions collection group `timeline`, `statusId` Ascending
