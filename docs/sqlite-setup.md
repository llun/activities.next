# SQLite Setup Guide

This guide will help you set up Activity.next using SQLite as your database backend. SQLite is a great choice for development environments or small instances with limited traffic.

## Prerequisites

- Node.js 24 and Yarn 4 via Corepack (the exact version is pinned by the `packageManager` field in `package.json`)
- Git (to clone the repository)

## Database Configuration

1. Configure SQLite with the individual database variables — these are read by both `yarn migrate` and the app runtime:

```bash
ACTIVITIES_DATABASE_CLIENT=better-sqlite3
ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
```

Alternatively, the app runtime (only) also accepts the whole configuration as a JSON string in `ACTIVITIES_DATABASE` — the value is a plain [Knex configuration object](https://knexjs.org/guide/#configuration-options):

```json
{
  "client": "better-sqlite3",
  "useNullAsDefault": true,
  "connection": {
    "filename": "./dev.sqlite3"
  }
}
```

> **Note:** `yarn migrate` (the Knex CLI) does **not** read the `ACTIVITIES_DATABASE` JSON variable — without any `ACTIVITIES_DATABASE_*` variables set it silently migrates a default `./activities.sqlite` file instead. Use the individual variables when running migrations.

2. Run database migrations to set up the schema:

```bash
yarn migrate
```

This will execute all migration scripts in the [migrations directory](https://github.com/llun/activities.next/tree/main/migrations).

## Development Setup

1. Clone the repository:

```bash
git clone https://github.com/llun/activities.next.git
cd activities.next
```

2. Enable Corepack and install dependencies:

```bash
corepack enable
yarn install
```

3. Configure the environment (in addition to database settings above):

```bash
ACTIVITIES_HOST=your-domain.tld
ACTIVITIES_SECRET_PHASE=your-random-secret-for-sessions
ACTIVITIES_ALLOW_EMAILS='["your-email@example.com"]'
ACTIVITIES_DATABASE_CLIENT=better-sqlite3
ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
```

4. Run migrations and start the development server:

```bash
yarn migrate
yarn dev
```

## Using with a Tunnel for Local Development

To run Activity.next locally and communicate with other federated servers, you'll need a tunnel service that exposes your local server to the internet:

1. Set up a tunnel service like [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) or [ngrok](https://ngrok.com/)
2. Point the tunnel to localhost:3000
3. Use your tunnel's domain as `ACTIVITIES_HOST`

## Production Deployment with SQLite

For production deployment with SQLite:

1. Make sure to place your SQLite database in a persistent directory
2. Consider using a more robust file locking mechanism
3. Implement regular database backups

Remember that SQLite is best suited for low to moderate traffic instances. For higher traffic or multi-server deployments, consider using [PostgreSQL](postgresql-setup.md) instead.

### Docker Deployment with SQLite

To deploy Activity.next with SQLite using Docker:

```bash
docker run -p 3000:3000 \
  -e ACTIVITIES_HOST=your.domain.tld \
  -e ACTIVITIES_SECRET_PHASE=change-me-to-a-random-secret-at-least-32-chars \
  -e ACTIVITIES_DATABASE_CLIENT=better-sqlite3 \
  -e ACTIVITIES_DATABASE_SQLITE_FILENAME=/opt/activities.next/data/data.sqlite \
  -e ACTIVITIES_MEDIA_STORAGE_TYPE=fs \
  -e ACTIVITIES_MEDIA_STORAGE_PATH=/opt/activities.next/data/uploads \
  -v /path/to/local/storage:/opt/activities.next/data \
  ghcr.io/llun/activities.next:main
```

Notes:

- The image is published with the `main` tag — there is no `latest` tag on the registry.
- The production runtime rejects an `ACTIVITIES_SECRET_PHASE` shorter than 32 characters, so use a sufficiently long random secret.
- The `-v` option mounts a local directory at `/opt/activities.next/data` so the SQLite database and the local uploads directory persist between container restarts. Create the host directory with appropriate permissions beforehand. Do **not** bind-mount `/opt/activities.next` itself — that directory contains the application (the standalone `server.js`, static assets, etc.), and a host-path mount would shadow it so the container cannot start.
- The mounted data directory starts empty, and the runtime image does not run migrations. Before the first start, either run the Knex migrations against the mounted file from a checkout (`ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=/path/to/local/storage/data.sqlite yarn migrate`) or copy the image's pre-migrated database as a starting point (`docker run --rm -v /path/to/local/storage:/data ghcr.io/llun/activities.next:main cp /opt/activities.next/data.sqlite /data/data.sqlite`).
