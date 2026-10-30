# PostgreSQL Setup Guide

This guide covers the PostgreSQL-specific setup: creating the database and user, connection configuration, and deployment. PostgreSQL is recommended for production deployments and instances with higher traffic.

For the shared local development setup (cloning the repository, Corepack/Yarn install, the core `.env.local` settings, sign-in and allow-list notes), see the [Quickstart](quickstart.md). Every database variable is documented in the [Environment Variables Guide](environment-variables.md#database).

## Prerequisites

- PostgreSQL server (version 14+; CI loads the baseline schema on PostgreSQL 14)

> **Note:** `yarn install` at the repository root installs all workspaces by default (including `@activities/pg`), so PostgreSQL support is available immediately for development. You can also focus specifically on the core app and PostgreSQL workspace with `yarn workspaces focus activities.next @activities/pg`.

## PostgreSQL Database Setup

1. Create a new PostgreSQL database and user:

```sql
CREATE DATABASE activitynext;
CREATE USER activitynext WITH ENCRYPTED PASSWORD 'your_strong_password';
GRANT ALL PRIVILEGES ON DATABASE activitynext TO activitynext;
```

> On PostgreSQL 15 and newer, `GRANT ALL PRIVILEGES ON DATABASE` no longer
> grants schema-level access. Also grant ownership/usage of the `public`
> schema so migrations can create tables (run while connected to the
> `activitynext` database):
>
> ```sql
> \connect activitynext
> GRANT ALL ON SCHEMA public TO activitynext;
> ```

2. Configure the database connection with the individual `ACTIVITIES_DATABASE_*` variables — these are read by both `yarn migrate` and the app runtime:

```bash
ACTIVITIES_DATABASE_CLIENT=pg
ACTIVITIES_DATABASE_PG_HOST=localhost
ACTIVITIES_DATABASE_PG_USER=activitynext
ACTIVITIES_DATABASE_PG_PASSWORD=your_strong_password
ACTIVITIES_DATABASE_PG_DATABASE=activitynext
```

Alternatively, both `yarn migrate` and the app runtime accept the whole configuration as a JSON string in `ACTIVITIES_DATABASE` (see [Environment Variables](environment-variables.md#full-json-configuration)):

```json
{
  "client": "pg",
  "connection": {
    "host": "localhost",
    "user": "activitynext",
    "password": "your_strong_password",
    "database": "activitynext"
  }
}
```

> **Note:** An `ACTIVITIES_DATABASE` value that is not a JSON object makes `yarn migrate` fail rather than fall back to a local SQLite file.

3. Run database migrations to set up the schema:

```bash
yarn migrate
```

On an empty database the first migration loads the baseline schema (`migrations/baseline/postgres.sql`), then every later migration in the [migrations directory](https://github.com/llun/activities.next/tree/main/migrations) runs. `yarn migrate` prints the database it resolved before it does anything, and `yarn migrate:status` lists the applied and pending migrations without writing to the database. An existing database that ran the old Knex migrations needs one check first: see [Upgrading past the Knex handover](maintenance.md#upgrading-past-the-knex-handover).

## Production Deployment with PostgreSQL

For production deployment with PostgreSQL:

1. Consider using connection pooling for better performance
2. Set up regular database backups
3. For a managed PostgreSQL solution, consider services like:
   - AWS RDS
   - Google Cloud SQL
   - Azure Database for PostgreSQL
   - DigitalOcean Managed Databases

You can adjust the database connection configuration as needed for your hosting environment.

### Example Configuration for Production

The value of the `ACTIVITIES_DATABASE` environment variable (stringified):

```json
{
  "client": "pg",
  "connection": {
    "host": "your-postgres-host.example.com",
    "port": 5432,
    "user": "activitynext",
    "password": "your_strong_password",
    "database": "activitynext",
    "ssl": true
  },
  "pool": {
    "min": 2,
    "max": 10
  }
}
```

## Using with Vercel

When deploying to Vercel, add the database configuration as an environment variable:

```
ACTIVITIES_DATABASE='{"client":"pg","connection":{"host":"your-postgres-host.example.com","port":5432,"user":"activitynext","password":"your_strong_password","database":"activitynext","ssl":true},"pool":{"min":2,"max":10}}'
```

## Docker Deployment with PostgreSQL

> **Important:** The official pre-built Docker image (`ghcr.io/llun/activities.next:main`) is a minimal image configured for SQLite; optional dependencies such as the PostgreSQL driver (`pg`) are omitted to keep image size small. To run Activity.next with PostgreSQL in Docker, build a container image from a checkout with the `@activities/pg` workspace included:
>
> ```bash
> docker build --build-arg WORKSPACES="activities.next @activities/pg" -t activities.next:pg .
> ```
>
> You can verify the built image using `node scripts/run.cjs scripts/maintenance/verifyDockerImages.ts --only full --full-image activities.next:pg --skip-build`.

To deploy Activity.next with PostgreSQL using Docker:

```bash
docker run -p 3000:3000 \
  -e ACTIVITIES_HOST=your.domain.tld \
  -e ACTIVITIES_SECRET_PHASE=change-me-to-a-random-secret-at-least-32-chars \
  -e ACTIVITIES_DATABASE='{"client":"pg","connection":{"host":"postgres-host","port":5432,"user":"activitynext","password":"your_strong_password","database":"activitynext"},"pool":{"min":2,"max":10}}' \
  activities.next:pg
```

> **Notes:** The production runtime rejects an `ACTIVITIES_SECRET_PHASE` shorter than 32 characters. The runtime image does not run migrations, so run `yarn migrate` against the PostgreSQL server from a checkout (using the individual `ACTIVITIES_DATABASE_*` variables or the `ACTIVITIES_DATABASE` JSON) before the first start.

For a complete setup with both PostgreSQL and Activity.next in Docker, you can use Docker Compose with a local build:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: activitynext
      POSTGRES_PASSWORD: your_strong_password
      POSTGRES_DB: activitynext
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  activitynext:
    build:
      context: .
      args:
        WORKSPACES: 'activities.next @activities/pg'
    depends_on:
      - postgres
    environment:
      ACTIVITIES_HOST: your.domain.tld
      ACTIVITIES_SECRET_PHASE: change-me-to-a-random-secret-at-least-32-chars
      ACTIVITIES_DATABASE: '{"client":"pg","connection":{"host":"postgres","port":5432,"user":"activitynext","password":"your_strong_password","database":"activitynext"},"pool":{"min":2,"max":10}}'
    ports:
      - '3000:3000'
    restart: unless-stopped

volumes:
  postgres_data:
```

Save this as `docker-compose.yml` and run with `docker compose up -d`.
