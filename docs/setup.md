# Setup

How to setup this project and run in your localhost or in the Vercel.

## Prepare the database

Activities.next supports two types of database, SQL via Knex.js (currently
tested with SQLite only in development) and [Google Firestore/Firebase Firestore](https://cloud.google.com/firestore)

### Using SQL

Add database configuration into `config.json` file

```json
{
  "database": {
    "type": "sql",
    "client": "better-sqlite3",
    "useNullAsDefault": true,
    "connection": {
      "filename": "./dev.sqlite3"
    }
  }
}
```

and run `yarn migrate`, this will run the migration via knex migration scripts
in [this directory](https://github.com/llun/activities.next/tree/main/migrations)

### Using Firestore

To use Firestore, create a Firestore in the GCP console or Firebase.

![Create database with production secure rule](https://github.com/llun/activities.next/blob/main/docs/images/firestore-create-database.png?raw=true)

The security rules here doesn't matter because we're going to disable it and don't
allow access from client side.

Add below indexes into Firestore indexes.

- Collection `statuses`, `actorId` Ascending, `createdAt` Descending
- Collection `statuses`, `reply` Ascending, `createdAt` Descending
- Collection `statuses`, `actorId` Ascending, `reply` Ascending, `createdAt` Descending
- Collection `statuses`, `to` Arrays, `actorId` Ascending, `createdAt` Descending
- Collection `follows`, `actorId` Ascending, `status` Ascending, `targetActorId` Ascending, `createdAt` Descending
- Collection `timelines`, `timeline` Ascending, `createdAt` Descending
- Collection group `accountProviders`, `provider` Ascending, `accountId` Ascending
- Collection group `accountProviders`, `provider` Ascending, `providerAccountId` Ascending
- Exemptions collection group `sessions`, `token` Ascending
- Exemptions collection group `timeline`, `statusId` Ascending
- Exemptions collection group `attachments`, `actorId` Descending

then go to `Service accounts` to create a private key for SDK access.

![Create firebase account key](https://github.com/llun/activities.next/blob/main/docs/images/firestore-service-accounts-key.png?raw=true)

Add the below database configuration into `config.json` file with the private key
from the Firestore.

```json
{
  "database": {
    "type": "firebase",
    "projectId": "Firebase project id or GCP project id",
    "credentials": {
      "client_email": "client email from json file downloads from service accounts tab",
      "private_key": "private key from json file downloads from service accounts tab"
    }
  }
}
```

## Set default domain name to the instance

Add below configuration to tell what is the domain that will use for this ActivityPub server

```json
{
  "host": "domain.tld"
}
```

## Add allow email/domain list

Activities.next is still in very early development, to make sure that your instance
is use only you, add the emails that allow to use the service in config.

```json
{
  "allowEmails": ["your_email@domain.tld"]
}
```

## Authentication

Setup the secret for the cookie and jwt session

```json
{
  "secretPhase": "super secret for cookie and jwt session"
}
```

the service come with the local credentials username/password authentication
however, if you want to use Github (oAuth), create personal oAuth app from Github
settings.

![Github settings oAuth apps list](https://github.com/llun/activities.next/blob/main/docs/images/github-settings-oauth-apps.png?raw=true)

The callback URL is `https://{host}/api/auth/callback/github` and click register application
which Github will provider the app id and secret. Copy those value to the config.

```json
{
  "auth": {
    "enableStorageAdapter": true,
    "github": {
      "id": "github personal app id",
      "secret": "github personal app secret"
    }
  }
}
```

## Start the app

To run the ActivityPub locally and talk to other federate servers, you will need a tunnel.
Personally, I use [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) but
any tunnel should work including [ngrok](https://ngrok.com/)

Point the tunnel to localhost at port 3000 and start the service with `yarn dev` then
register your personal account at `https://{host}/auth/register` then login. after this
you should be able to use your ActivityPub server to follow other or post to other in
Fediverse.
