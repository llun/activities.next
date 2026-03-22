# Environment Variables Reference

This document lists all environment variables supported by Activity.next.

Configuration can be provided either through environment variables or a `config.json` file in the project root. When a valid `config.json` is present, it is used exclusively and all environment variables are ignored — the two sources are **not** merged.

## Core Configuration

| Variable                   | Required | Description                                                                                                           |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_HOST`          | **Yes**  | Domain name for your instance (e.g., `social.example.com`). No protocol, no trailing slash.                           |
| `ACTIVITIES_SECRET_PHASE`  | **Yes**  | Secret string for signing cookies and tokens. Generate with `openssl rand -base64 32`.                                |
| `ACTIVITIES_ALLOW_EMAILS`  | No       | JSON array of email addresses allowed to register (e.g., `["user@example.com"]`). If unset, registration may be open. |
| `ACTIVITIES_INSECURE_AUTH` | No       | Set to `true` to allow HTTP (non-HTTPS) authentication. Only for local development.                                   |

## Database

Activity.next supports SQLite and PostgreSQL. See [SQLite Setup](sqlite-setup.md) and [PostgreSQL Setup](postgresql-setup.md) for detailed guides.

### Full JSON Configuration

| Variable              | Description                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_DATABASE` | Full database configuration as a JSON string (e.g., `{"type":"sql","client":"pg","connection":{...}}`). |

### Individual Variables (SQLite)

| Variable                              | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `ACTIVITIES_DATABASE_CLIENT`          | Set to `better-sqlite3` for SQLite.                   |
| `ACTIVITIES_DATABASE_SQLITE_FILENAME` | Path to SQLite database file (e.g., `./dev.sqlite3`). |

### Individual Variables (PostgreSQL)

| Variable                          | Description                        |
| --------------------------------- | ---------------------------------- |
| `ACTIVITIES_DATABASE_CLIENT`      | Set to `pg` for PostgreSQL.        |
| `ACTIVITIES_DATABASE_PG_HOST`     | PostgreSQL host.                   |
| `ACTIVITIES_DATABASE_PG_PORT`     | PostgreSQL port (default: `5432`). |
| `ACTIVITIES_DATABASE_PG_USER`     | PostgreSQL username.               |
| `ACTIVITIES_DATABASE_PG_PASSWORD` | PostgreSQL password.               |
| `ACTIVITIES_DATABASE_PG_DATABASE` | PostgreSQL database name.          |
| `ACTIVITIES_DATABASE_PG_SSL_MODE` | SSL mode (e.g., `require`).        |
| `ACTIVITIES_DATABASE_PG_POOL_MIN` | Minimum connection pool size.      |
| `ACTIVITIES_DATABASE_PG_POOL_MAX` | Maximum connection pool size.      |

## Authentication

| Variable                        | Description                               |
| ------------------------------- | ----------------------------------------- |
| `ACTIVITIES_AUTH`               | Full auth configuration as a JSON string. |
| `ACTIVITIES_AUTH_GITHUB_ID`     | GitHub OAuth app Client ID.               |
| `ACTIVITIES_AUTH_GITHUB_SECRET` | GitHub OAuth app Client Secret.           |

To set up GitHub OAuth, create an app at [GitHub Developer Settings](https://github.com/settings/developers) and set the callback URL to `https://your-domain.tld/api/auth/callback/github`.

## Email

Email is used for account verification and notifications.

| Variable                | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `ACTIVITIES_EMAIL`      | Full email configuration as a JSON string.              |
| `ACTIVITIES_EMAIL_TYPE` | Email provider: `smtp`, `resend`, `ses`, or `lambda`.   |
| `ACTIVITIES_EMAIL_FROM` | Sender email address (e.g., `noreply@your-domain.tld`). |

### SMTP

| Variable                         | Description                     |
| -------------------------------- | ------------------------------- |
| `ACTIVITIES_EMAIL_SMTP_HOST`     | SMTP server hostname.           |
| `ACTIVITIES_EMAIL_SMTP_PORT`     | SMTP server port (e.g., `587`). |
| `ACTIVITIES_EMAIL_SMTP_USER`     | SMTP username.                  |
| `ACTIVITIES_EMAIL_SMTP_PASSWORD` | SMTP password.                  |
| `ACTIVITIES_EMAIL_SMTP_SECURE`   | Use TLS (`true` or `false`).    |

### Resend

| Variable                        | Description       |
| ------------------------------- | ----------------- |
| `ACTIVITIES_EMAIL_RESEND_TOKEN` | Resend API token. |

### AWS SES

| Variable                      | Description                             |
| ----------------------------- | --------------------------------------- |
| `ACTIVITIES_EMAIL_SES_REGION` | AWS region for SES (e.g., `us-east-1`). |

### AWS Lambda

| Variable                                     | Description                      |
| -------------------------------------------- | -------------------------------- |
| `ACTIVITIES_EMAIL_LAMBDA_REGION`             | AWS region for Lambda function.  |
| `ACTIVITIES_EMAIL_LAMBDA_FUNCTION_NAME`      | Lambda function name.            |
| `ACTIVITIES_EMAIL_LAMBDA_FUNCTION_QUALIFIER` | Lambda function qualifier/alias. |

## Media Storage

Required for media uploads (images in posts).

| Variable                                     | Description                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ACTIVITIES_MEDIA_STORAGE_TYPE`              | Storage backend: `fs` (local), `s3`, or `object` (S3-compatible).                         |
| `ACTIVITIES_MEDIA_STORAGE_PATH`              | Local filesystem path for `fs` storage (e.g., `./uploads`).                               |
| `ACTIVITIES_MEDIA_STORAGE_BUCKET`            | S3 bucket name (for `s3` or `object`).                                                    |
| `ACTIVITIES_MEDIA_STORAGE_REGION`            | S3 region (e.g., `us-east-1`).                                                            |
| `ACTIVITIES_MEDIA_STORAGE_HOSTNAME`          | Custom S3 endpoint hostname (for S3-compatible services like MinIO, DigitalOcean Spaces). |
| `ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE`     | Maximum file size in bytes (default: 10 MB).                                              |
| `ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT` | Per-account storage quota in bytes.                                                       |

## Fitness File Storage

For fitness activity file uploads (.fit, .gpx, .tcx). Falls back to media storage configuration if not set.

| Variable                                       | Description                                         |
| ---------------------------------------------- | --------------------------------------------------- |
| `ACTIVITIES_FITNESS_STORAGE_TYPE`              | Storage backend: `fs`, `s3`, or `object`.           |
| `ACTIVITIES_FITNESS_STORAGE_PATH`              | Local filesystem path (default: `uploads/fitness`). |
| `ACTIVITIES_FITNESS_STORAGE_BUCKET`            | S3 bucket name.                                     |
| `ACTIVITIES_FITNESS_STORAGE_REGION`            | S3 region.                                          |
| `ACTIVITIES_FITNESS_STORAGE_HOSTNAME`          | Custom S3 endpoint hostname.                        |
| `ACTIVITIES_FITNESS_STORAGE_PREFIX`            | S3 key prefix (default: `fitness/`).                |
| `ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE`     | Maximum file size in bytes (default: 50 MB).        |
| `ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT` | Per-account quota in bytes.                         |
| `ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN`       | Mapbox API token for map generation from GPS data.  |

## Queue (Background Jobs)

For asynchronous processing of ActivityPub delivery, file processing, etc.

| Variable                               | Description                                                |
| -------------------------------------- | ---------------------------------------------------------- |
| `ACTIVITIES_QUEUE_TYPE`                | Queue backend: `qstash`.                                   |
| `ACTIVITIES_QUEUE_URL`                 | Base URL for queue callbacks (your instance's public URL). |
| `ACTIVITIES_QUEUE_TOKEN`               | QStash API token.                                          |
| `ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY` | QStash current signing key (for webhook verification).     |
| `ACTIVITIES_QUEUE_NEXT_SIGNING_KEY`    | QStash next signing key (for key rotation).                |

## Domain Controls

| Variable                         | Description                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `ACTIVITIES_ALLOW_MEDIA_DOMAINS` | JSON array of allowed domains for remote media (e.g., `["cdn.example.com"]`). |
| `ACTIVITIES_ALLOW_ACTOR_DOMAINS` | JSON array of allowed domains for actors.                                     |

## Request Configuration

| Variable                         | Description                                                            |
| -------------------------------- | ---------------------------------------------------------------------- |
| `ACTIVITIES_REQUEST_TIMEOUT`     | HTTP request timeout in milliseconds for outgoing federation requests. |
| `ACTIVITIES_REQUEST_RETRY`       | Number of retries for failed outgoing requests.                        |
| `ACTIVITIES_REQUEST_RETRY_NOISE` | Random delay noise added between retries (in milliseconds).            |

## Internal API

| Variable                         | Description                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_INTERNAL_SHARED_KEY` | Shared key for internal API authentication. Setting any `ACTIVITIES_INTERNAL_API_*` variable enables the internal API. |

## Observability

| Variable                      | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| `OTEL_SERVICE_NAME`           | OpenTelemetry service name (default: `activities.next`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint URL.                    |

## Build & Runtime

| Variable                  | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`                | Node.js environment (`development` or `production`).                 |
| `BUILD_STANDALONE`        | Set to `true` to build a standalone Next.js output (used in Docker). |
| `NEXT_TELEMETRY_DISABLED` | Set to `1` to disable Next.js telemetry.                             |

## config.json Format

All environment variables can alternatively be set in a `config.json` file. Here is a complete example:

```json
{
  "host": "social.example.com",
  "secretPhase": "your-random-secret",
  "allowEmails": ["admin@example.com"],
  "database": {
    "type": "sql",
    "client": "pg",
    "connection": {
      "host": "localhost",
      "port": 5432,
      "user": "activitynext",
      "password": "your_password",
      "database": "activitynext"
    },
    "pool": {
      "min": 2,
      "max": 10
    }
  },
  "auth": {
    "github": {
      "id": "github-client-id",
      "secret": "github-client-secret"
    }
  },
  "email": {
    "type": "smtp",
    "serviceFromAddress": "noreply@social.example.com",
    "host": "smtp.example.com",
    "port": 587,
    "auth": {
      "user": "username",
      "pass": "password"
    },
    "secure": false
  },
  "mediaStorage": {
    "type": "s3",
    "bucket": "my-media-bucket",
    "region": "us-east-1"
  }
}
```
