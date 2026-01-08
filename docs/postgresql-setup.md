# PostgreSQL Setup Guide

This guide will help you set up Activity.next using PostgreSQL as your database backend. PostgreSQL is recommended for production deployments and instances with higher traffic.

## Prerequisites

- Node.js 18+ and Yarn
- Git (to clone the repository)
- PostgreSQL server (version 12+)

## PostgreSQL Database Setup

1. Create a new PostgreSQL database and user:

```sql
CREATE DATABASE activitynext;
CREATE USER activitynext WITH ENCRYPTED PASSWORD 'your_strong_password';
GRANT ALL PRIVILEGES ON DATABASE activitynext TO activitynext;
```

2. Configure the database connection by setting the `ACTIVITIES_DATABASE` environment variable with the following JSON configuration (stringify it first):

```json
{
  "type": "sql",
  "client": "pg",
  "connection": {
    "host": "localhost",
    "user": "activitynext",
    "password": "your_strong_password",
    "database": "activitynext"
  }
}
```

You can also add this configuration to a `config.json` file in the root directory:

```json
{
  "database": {
    "type": "sql",
    "client": "pg",
    "connection": {
      "host": "localhost",
      "user": "activitynext",
      "password": "your_strong_password",
      "database": "activitynext"
    }
  }
}
```

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

2. Install dependencies:

```bash
yarn install
```

3. Configure the environment (in addition to database settings above):

Create a `config.json` file with the following content:

```json
{
  "host": "your-domain.tld",
  "secretPhase": "your-random-secret-for-sessions",
  "allowEmails": ["your-email@example.com"],
  "auth": {
    "github": {
      "id": "github-app-client-id",
      "secret": "github-app-secret"
    }
  }
}
```

4. Run the development server:

```bash
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

```json
{
  "database": {
    "type": "sql",
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
}
```

## Using with Vercel

When deploying to Vercel, add the database configuration as an environment variable:

```
ACTIVITIES_DATABASE='{"type":"sql","client":"pg","connection":{"host":"your-postgres-host.example.com","port":5432,"user":"activitynext","password":"your_strong_password","database":"activitynext","ssl":true},"pool":{"min":2,"max":10}}'
```

## Docker Deployment with PostgreSQL

To deploy Activity.next with PostgreSQL using Docker:

```bash
docker run -p 3000:3000 \
  -e ACTIVITIES_HOST=your.domain.tld \
  -e ACTIVITIES_SECRET_PHASE=random-secret-for-cookie \
  -e NEXTAUTH_URL=https://your.domain.tld \
  -e NEXTAUTH_SECRET=session-secret \
  -e ACTIVITIES_DATABASE_TYPE=sql \
  -e ACTIVITIES_DATABASE_CLIENT=pg \
  -e ACTIVITIES_DATABASE='{"type":"sql","client":"pg","connection":{"host":"postgres-host","port":5432,"user":"activitynext","password":"your_strong_password","database":"activitynext"},"pool":{"min":2,"max":10}}' \
  ghcr.io/llun/activities.next:latest
```

For a complete setup with both PostgreSQL and Activity.next in Docker, you can use docker-compose:

```yaml
version: '3'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: activitynext
      POSTGRES_PASSWORD: your_strong_password
      POSTGRES_DB: activitynext
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  activitynext:
    image: ghcr.io/llun/activities.next:latest
    depends_on:
      - postgres
    environment:
      ACTIVITIES_HOST: your.domain.tld
      ACTIVITIES_SECRET_PHASE: random-secret-for-cookie
      NEXTAUTH_URL: https://your.domain.tld
      NEXTAUTH_SECRET: session-secret
      ACTIVITIES_DATABASE_TYPE: sql
      ACTIVITIES_DATABASE_CLIENT: pg
      ACTIVITIES_DATABASE: '{"type":"sql","client":"pg","connection":{"host":"postgres","port":5432,"user":"activitynext","password":"your_strong_password","database":"activitynext"},"pool":{"min":2,"max":10}}'
    ports:
      - '3000:3000'
    restart: unless-stopped

volumes:
  postgres_data:
```

Save this as `docker-compose.yml` and run with `docker-compose up -d`.
