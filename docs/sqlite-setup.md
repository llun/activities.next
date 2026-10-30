# SQLite Setup Guide

This guide covers the SQLite-specific configuration and deployment. SQLite is the default database backend bundled with Activity.next (requiring no external database server or optional drivers) and is the backend included in the official minimal Docker image. It is a great choice for development environments or small instances with limited traffic.

For the shared local development setup (cloning the repository, Corepack/Yarn install, the core `.env.local` settings, sign-in and allow-list notes), see the [Quickstart](quickstart.md). Every database variable is documented in the [Environment Variables Guide](environment-variables.md#database).

## Database Configuration

1. Configure SQLite with the individual database variables — these are read by both `yarn migrate` and the app runtime:

```bash
ACTIVITIES_DATABASE_CLIENT=better-sqlite3
ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
```

Alternatively, both `yarn migrate` and the app runtime accept the whole configuration as a JSON string in `ACTIVITIES_DATABASE` (see [Environment Variables](environment-variables.md#full-json-configuration)):

```json
{
  "client": "better-sqlite3",
  "useNullAsDefault": true,
  "connection": {
    "filename": "./dev.sqlite3"
  }
}
```

> **Note:** For `yarn migrate` only, setting `ACTIVITIES_DATABASE_SQLITE_FILENAME` without `ACTIVITIES_DATABASE_CLIENT` selects `better-sqlite3`; the app runtime still requires `ACTIVITIES_DATABASE_CLIENT`, so set both. An `ACTIVITIES_DATABASE` value that is not a JSON object makes `yarn migrate` fail rather than fall back to the default `./activities.sqlite` file.

2. Run database migrations to set up the schema:

```bash
yarn migrate
```

On an empty database the first migration loads the baseline schema (`migrations/baseline/sqlite.sql`), then every later migration in the [migrations directory](https://github.com/llun/activities.next/tree/main/migrations) runs.

## Production Deployment with SQLite

For production deployment with SQLite:

1. Make sure to place your SQLite database in a persistent directory
2. Consider using a more robust file locking mechanism
3. Implement regular database backups

Remember that SQLite is best suited for low to moderate traffic instances. For higher traffic or multi-server deployments, consider using [PostgreSQL](postgresql-setup.md) instead.

### Docker Deployment with SQLite

To deploy Activity.next with SQLite using Docker (the official minimal `ghcr.io/llun/activities.next:main` image is pre-configured with SQLite):

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
- The mounted data directory starts empty, and the runtime image does not run migrations. Before the first start, either run `yarn migrate` against the mounted file from a checkout (`ACTIVITIES_DATABASE= ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=/path/to/local/storage/data.sqlite yarn migrate` — the empty `ACTIVITIES_DATABASE=` keeps a JSON configuration in a checkout's `.env.local` from taking precedence) or copy the image's pre-migrated database as a starting point (`docker run --rm -v /path/to/local/storage:/data ghcr.io/llun/activities.next:main cp /opt/activities.next/data.sqlite /data/data.sqlite`).
