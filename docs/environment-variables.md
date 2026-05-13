# Environment Variables Reference

This document lists all environment variables supported by Activity.next.

Application configuration can be provided either through environment variables or a `config.json` file in the project root. When a valid `config.json` is present, it supplies the application config instead of `ACTIVITIES_*` app configuration variables, and the two sources are **not** merged. OpenTelemetry app config from `OTEL_EXPORTER_*` variables is also not merged into `config.json`; set the `openTelemetry` object in `config.json` instead. Environment variables read outside app config, such as `NODE_ENV`, `BUILD_STANDALONE`, `NEXT_TELEMETRY_DISABLED`, and `LOG_LEVEL`, still apply.

## Core Configuration

| Variable                   | Required | Description                                                                                                           |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_HOST`          | **Yes**  | Domain name for your instance (e.g., `social.example.com`). No protocol, no trailing slash.                           |
| `ACTIVITIES_SECRET_PHASE`  | **Yes**  | Secret string for signing cookies and tokens. Generate with `openssl rand -base64 32`.                                |
| `ACTIVITIES_ALLOW_EMAILS`  | No       | JSON array of email addresses allowed to register (e.g., `["user@example.com"]`). If unset, registration may be open. |
| `ACTIVITIES_TRUSTED_HOSTS` | No       | JSON array of additional public hosts accepted from `X-Forwarded-Host` and `X-Activity-Next-Host`.                    |
| `ACTIVITIES_INSECURE_AUTH` | No       | Set to `true` to allow HTTP (non-HTTPS) authentication. Only for local development.                                   |

## Proxy Configuration

| Variable                            | Description                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_TRUST_PROXY_IP_HEADERS` | Set to `true` to use proxy-managed client IP headers for unauthenticated app registration throttling. Only enable when all direct app access is blocked and the trusted proxy strips client-supplied forwarding headers before setting its own. |

## Database

Activity.next supports SQLite and PostgreSQL. The configuration loader also accepts MySQL-compatible Knex clients for deployments that provide the needed driver/runtime support. See [SQLite Setup](sqlite-setup.md) and [PostgreSQL Setup](postgresql-setup.md) for detailed guides.

### Full JSON Configuration

| Variable              | Description                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_DATABASE` | Full database configuration as a JSON string (e.g., `{"type":"sql","client":"pg","connection":{...}}`). |

### Individual Variables (SQLite)

| Variable                              | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `ACTIVITIES_DATABASE_CLIENT`          | Set to `better-sqlite3` or `sqlite3` for SQLite.      |
| `ACTIVITIES_DATABASE_SQLITE_FILENAME` | Path to SQLite database file (e.g., `./dev.sqlite3`). |

### Individual Variables (PostgreSQL)

| Variable                          | Description                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_DATABASE_CLIENT`      | Set to `pg` or `pg-native` for PostgreSQL.                                                                                                                                                                                                                                                                                                                                                         |
| `ACTIVITIES_DATABASE_PG_HOST`     | PostgreSQL host.                                                                                                                                                                                                                                                                                                                                                                                   |
| `ACTIVITIES_DATABASE_PG_PORT`     | PostgreSQL port (default: `5432`).                                                                                                                                                                                                                                                                                                                                                                 |
| `ACTIVITIES_DATABASE_PG_USER`     | PostgreSQL username.                                                                                                                                                                                                                                                                                                                                                                               |
| `ACTIVITIES_DATABASE_PG_PASSWORD` | PostgreSQL password.                                                                                                                                                                                                                                                                                                                                                                               |
| `ACTIVITIES_DATABASE_PG_DATABASE` | PostgreSQL database name.                                                                                                                                                                                                                                                                                                                                                                          |
| `ACTIVITIES_DATABASE_PG_SSL_MODE` | PostgreSQL SSL mode: `disable`, `require`, `verify-ca`, or `verify-full`. When set to `require`, SSL is enabled without certificate verification. When set to `verify-ca`, SSL is enabled with certificate verification but without hostname checking. When set to `verify-full`, SSL is enabled with full certificate and hostname verification. When set to `disable` or unset, SSL is not used. |
| `ACTIVITIES_DATABASE_PG_POOL_MIN` | Minimum connection pool size.                                                                                                                                                                                                                                                                                                                                                                      |
| `ACTIVITIES_DATABASE_PG_POOL_MAX` | Maximum connection pool size.                                                                                                                                                                                                                                                                                                                                                                      |

### Individual Variables (MySQL)

| Variable                             | Description                           |
| ------------------------------------ | ------------------------------------- |
| `ACTIVITIES_DATABASE_CLIENT`         | Set to `mysql` or `mysql2` for MySQL. |
| `ACTIVITIES_DATABASE_MYSQL_HOST`     | MySQL host.                           |
| `ACTIVITIES_DATABASE_MYSQL_PORT`     | MySQL port (default: `3306`).         |
| `ACTIVITIES_DATABASE_MYSQL_USER`     | MySQL username.                       |
| `ACTIVITIES_DATABASE_MYSQL_PASSWORD` | MySQL password.                       |
| `ACTIVITIES_DATABASE_MYSQL_DATABASE` | MySQL database name.                  |
| `ACTIVITIES_DATABASE_MYSQL_POOL_MIN` | Minimum connection pool size.         |
| `ACTIVITIES_DATABASE_MYSQL_POOL_MAX` | Maximum connection pool size.         |

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

Required for media uploads (images and video in posts). If no media storage is configured, media uploads are disabled.

| Variable                                     | Description                                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_MEDIA_STORAGE_TYPE`              | Storage backend: `fs` (local), `s3`, or `object` (S3-compatible).                                                                                                                        |
| `ACTIVITIES_MEDIA_STORAGE_PATH`              | Local filesystem path for `fs` storage (e.g., `./uploads`).                                                                                                                              |
| `ACTIVITIES_MEDIA_STORAGE_BUCKET`            | S3 bucket name (for `s3` or `object`).                                                                                                                                                   |
| `ACTIVITIES_MEDIA_STORAGE_REGION`            | S3 region (e.g., `us-east-1`).                                                                                                                                                           |
| `ACTIVITIES_MEDIA_STORAGE_HOSTNAME`          | Custom S3 endpoint hostname (for S3-compatible services like MinIO, DigitalOcean Spaces).                                                                                                |
| `ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE`     | Maximum file size in bytes (default: 200 MiB / `209715200`).                                                                                                                             |
| `ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT` | Per-account combined media + fitness storage quota in bytes. If unset, the config value stays empty and the quota service applies its 1 GiB (`1073741824`) default when enforcing quota. |

## Fitness File Storage

For fitness activity file uploads (.fit, .gpx, .tcx). Falls back to media storage configuration if not set.

| Variable                                                    | Description                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVITIES_FITNESS_STORAGE_TYPE`                           | Storage backend: `fs`, `s3`, or `object`.                                                                                                                                                                                                                          |
| `ACTIVITIES_FITNESS_STORAGE_PATH`                           | Local filesystem path (default: `uploads/fitness`).                                                                                                                                                                                                                |
| `ACTIVITIES_FITNESS_STORAGE_BUCKET`                         | S3 bucket name.                                                                                                                                                                                                                                                    |
| `ACTIVITIES_FITNESS_STORAGE_REGION`                         | S3 region.                                                                                                                                                                                                                                                         |
| `ACTIVITIES_FITNESS_STORAGE_HOSTNAME`                       | Custom S3 endpoint hostname.                                                                                                                                                                                                                                       |
| `ACTIVITIES_FITNESS_STORAGE_PREFIX`                         | S3 key prefix (default: `fitness/`).                                                                                                                                                                                                                               |
| `ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE`                  | Maximum file size in bytes (default: 50 MiB / `52428800`).                                                                                                                                                                                                         |
| `ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT`              | Override for the shared per-account media + fitness storage quota in bytes. When set, it takes precedence over `ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT` for both media and fitness quota checks; when unset, the media quota or quota service default applies. |
| `ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN`                    | Mapbox API token for map rendering. Only public `pk.*` tokens are passed to browser maps; secret tokens stay server-side.                                                                                                                                          |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES`      | Worker heap budget before route-cache accumulation is downsampled (default: 512 MB).                                                                                                                                                                               |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT` | Maximum in-memory route points before accumulation is downsampled (default: 160,000).                                                                                                                                                                              |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_FILE_POINT_LIMIT`         | Maximum points retained from one parsed fitness file before privacy filtering (default: 80,000).                                                                                                                                                                   |

## Queue (Background Jobs)

For asynchronous processing of ActivityPub delivery, file processing, etc.

| Variable                               | Description                                                |
| -------------------------------------- | ---------------------------------------------------------- |
| `ACTIVITIES_QUEUE_TYPE`                | Queue backend: `qstash`.                                   |
| `ACTIVITIES_QUEUE_URL`                 | Base URL for queue callbacks (your instance's public URL). |
| `ACTIVITIES_QUEUE_TOKEN`               | QStash API token.                                          |
| `ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY` | QStash current signing key (for webhook verification).     |
| `ACTIVITIES_QUEUE_NEXT_SIGNING_KEY`    | QStash next signing key (for key rotation).                |

## Push Notifications

| Variable                            | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `ACTIVITIES_PUSH_VAPID_PUBLIC_KEY`  | VAPID public key for Web Push.           |
| `ACTIVITIES_PUSH_VAPID_PRIVATE_KEY` | VAPID private key for Web Push.          |
| `ACTIVITIES_PUSH_VAPID_EMAIL`       | VAPID contact email, often `mailto:...`. |

## Domain Controls

| Variable                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_ALLOW_MEDIA_DOMAINS` | Optional JSON array of allowed domains for Next image remote patterns (e.g., `["cdn.example.com"]`). Browser `<img>` loads remain governed by CSP separately and allow HTTPS remote media for federated avatars and emoji, while Next image optimization is disabled so arbitrary remote media is not fetched server-side. Wildcard entries are rejected in explicit config. If this variable is not set, the default configuration allows images from all HTTPS hosts (`**`) to support federated content like remote avatars and emoji. This value is read during `next build`, so Docker/standalone deployments must provide it in the build environment, not only at container runtime. |
| `ACTIVITIES_ALLOW_ACTOR_DOMAINS` | JSON array of allowed domains for actors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ACTIVITIES_FEDERATION_MODE`     | Federation mode: `open` (default) or `allowlist` to require explicit allowed actor domains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ACTIVITIES_TRUSTED_HOSTS`       | JSON array of additional public hosts accepted from `X-Forwarded-Host` and `X-Activity-Next-Host`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Request Configuration

| Variable                         | Description                                                            |
| -------------------------------- | ---------------------------------------------------------------------- |
| `ACTIVITIES_REQUEST_TIMEOUT`     | HTTP request timeout in milliseconds for outgoing federation requests. |
| `ACTIVITIES_REQUEST_RETRY`       | Number of retries for failed outgoing requests.                        |
| `ACTIVITIES_REQUEST_RETRY_NOISE` | Random delay noise added between retries (in milliseconds).            |

## Observability

| Variable                              | Description                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OTEL_SERVICE_NAME`                   | OpenTelemetry service name (default: `activities.next`).                                                                                                                                                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | OpenTelemetry collector endpoint URL.                                                                                                                                                                        |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | Trace-specific OTLP endpoint URL.                                                                                                                                                                            |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Metrics-specific OTLP endpoint URL.                                                                                                                                                                          |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`    | Logs-specific OTLP endpoint URL.                                                                                                                                                                             |
| `OTEL_EXPORTER_OTLP_PROTOCOL`         | OTLP protocol: `grpc`, `http/protobuf`, or `http/json`. The app config schema also accepts the non-standard value `google`; it stores `openTelemetry.protocol` as `google` and does not require an endpoint. |
| `OTEL_EXPORTER_OTLP_HEADERS`          | OTLP headers string passed to the exporter.                                                                                                                                                                  |
| `LOG_LEVEL`                           | Logger level, default `info`.                                                                                                                                                                                |

## Build & Runtime

| Variable                  | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`                | Node.js environment (`development` or `production`).                 |
| `BUILD_STANDALONE`        | Set to `true` to build a standalone Next.js output (used in Docker). |
| `NEXT_TELEMETRY_DISABLED` | Set to `1` to disable Next.js telemetry.                             |

## config.json Format

Most `ACTIVITIES_*` application settings can alternatively be set in a `config.json` file. When `config.json` is present, `OTEL_EXPORTER_*` variables are not merged into app config; use the `openTelemetry` object for OpenTelemetry app config. Build/runtime flags such as `NODE_ENV`, `BUILD_STANDALONE`, `NEXT_TELEMETRY_DISABLED`, and logger settings remain environment-only. Here is a complete example:

```json
{
  "host": "social.example.com",
  "trustedHosts": ["social-alias.example.com"],
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
  },
  "openTelemetry": {
    "endpoint": "https://otel.example.com",
    "protocol": "http/protobuf"
  }
}
```
