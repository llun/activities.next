# PostgreSQL Setup Guide

This guide will help you set up Activity.next using PostgreSQL as your database backend. PostgreSQL is recommended for production deployments and instances with higher traffic.

## Prerequisites

- Node.js 24 and Yarn 4 via Corepack (the exact version is pinned by the `packageManager` field in `package.json`)
- Git (to clone the repository)
- PostgreSQL server (version 12+)

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

Alternatively, the app runtime (only) also accepts the whole configuration as a JSON string in `ACTIVITIES_DATABASE` — the value is a plain [Knex configuration object](https://knexjs.org/guide/#configuration-options):

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

> **Note:** `yarn migrate` (the Knex CLI) does **not** read the `ACTIVITIES_DATABASE` JSON variable — without any `ACTIVITIES_DATABASE_*` variables set it silently falls back to a local SQLite file instead of your PostgreSQL server. Use the individual variables when running migrations.

3. Run database migrations to set up the schema:

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
ACTIVITIES_DATABASE_CLIENT=pg
ACTIVITIES_DATABASE_PG_HOST=localhost
ACTIVITIES_DATABASE_PG_USER=activitynext
ACTIVITIES_DATABASE_PG_PASSWORD=your_strong_password
ACTIVITIES_DATABASE_PG_DATABASE=activitynext
```

4. Run migrations and start the development server:

```bash
yarn migrate
yarn dev
```

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

To deploy Activity.next with PostgreSQL using Docker:

```bash
docker run -p 3000:3000 \
  -e ACTIVITIES_HOST=your.domain.tld \
  -e ACTIVITIES_SECRET_PHASE=change-me-to-a-random-secret-at-least-32-chars \
  -e ACTIVITIES_DATABASE='{"client":"pg","connection":{"host":"postgres-host","port":5432,"user":"activitynext","password":"your_strong_password","database":"activitynext"},"pool":{"min":2,"max":10}}' \
  ghcr.io/llun/activities.next:main
```

> **Notes:** The image is published with the `main` tag — there is no `latest` tag on the registry. The production runtime rejects an `ACTIVITIES_SECRET_PHASE` shorter than 32 characters. The runtime image does not include the Knex CLI, so run `yarn migrate` against the PostgreSQL server from a checkout (using the individual `ACTIVITIES_DATABASE_*` variables) before the first start.

For a complete setup with both PostgreSQL and Activity.next in Docker, you can use Docker Compose:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: activitynext
      POSTGRES_PASSWORD: your_strong_password
      POSTGRES_DB: activitynext
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  activitynext:
    image: ghcr.io/llun/activities.next:main
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
