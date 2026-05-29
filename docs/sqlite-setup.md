# SQLite Setup Guide

This guide will help you set up Activity.next using SQLite as your database backend. SQLite is a great choice for development environments or small instances with limited traffic.

## Prerequisites

- Node.js 24 and Yarn (v4.15.0 via Corepack)
- Git (to clone the repository)

## Database Configuration

1. Set the `ACTIVITIES_DATABASE` environment variable with the following JSON configuration (stringify it first):

```json
{
  "type": "sql",
  "client": "better-sqlite3",
  "useNullAsDefault": true,
  "connection": {
    "filename": "./dev.sqlite3"
  }
}
```

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
  -e ACTIVITIES_SECRET_PHASE=random-secret-for-cookie \
  -e ACTIVITIES_DATABASE_CLIENT=better-sqlite3 \
  -e ACTIVITIES_DATABASE_SQLITE_FILENAME=/opt/activities.next/data.sqlite \
  -e ACTIVITIES_MEDIA_STORAGE_TYPE=fs \
  -e ACTIVITIES_MEDIA_STORAGE_PATH=/opt/activities.next/uploads \
  -v /path/to/local/storage:/opt/activities.next \
  ghcr.io/llun/activities.next:latest
```

The `-v` option mounts a local directory to the container's `/opt/activities.next` directory, which allows the SQLite database and configured local uploads directory to persist between container restarts. Make sure to create this directory with appropriate permissions beforehand.
