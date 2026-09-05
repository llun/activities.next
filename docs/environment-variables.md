# Environment Variables Reference

This document lists all environment variables supported by Activity.next.

> Only getting started? The [Quickstart](quickstart.md) covers the three core
> settings strictly required to boot a local instance (host, secret phrase, and
> a database).

Application configuration is provided through environment variables. Root-level `config.json` files are ignored; migrate any previous file settings to the corresponding `ACTIVITIES_*` or `OTEL_EXPORTER_*` variables listed below. Application config is read at runtime, so Docker/standalone builds do not need real `ACTIVITIES_*` or `OTEL_EXPORTER_*` values at build time. Environment variables read outside app config, such as `NODE_ENV`, `BUILD_STANDALONE`, `NEXT_TELEMETRY_DISABLED`, and `LOG_LEVEL`, still apply.

## Database-backed server settings (env → database → default)

Some instance policy is also editable at runtime from the admin area
(**Admin → Instance / Posts & media / Network**, and the **Federation** tab),
stored in the `server_settings` table. Each such value is resolved with the
precedence **environment variable → database → built-in default**: an
environment variable always wins and locks the field in the admin UI with a
"Set by environment" badge, so removing the variable is what hands control back
to the admin form. Clients read the resolved values from `/api/v1/instance` and
`/api/v2/instance`.

Every endpoint that creates or edits a status enforces the resolved
`posts.maxCharacters` and `polls.*` limits — `POST`/`PUT
/api/v1/statuses[/:id]` and `POST /api/v1/accounts/outbox`, which is the
endpoint the web composer and the inline reply box post through. Every upload
endpoint (`POST /api/v1/media`, `POST /api/v2/media`, `PUT`/`PATCH
/api/v1/media/:id` thumbnails, `POST /api/v1/medias/presigned`, `PATCH
/api/v1/accounts/update_credentials` avatars/headers, and admin custom emoji)
enforces the resolved `media.maxFileSize`. All of them answer `422` above the
limit. The status routes put the offending limit in the `error` message (except
the poll-expiry one, which just says it is out of range); the upload routes
return the generic `Unprocessable entity`, apart from
`update_credentials`, which says `Invalid image file`. The web composer, its poll
editor and media picker, the inline reply box, and the avatar/header picker all
size themselves to the same resolved values rather than to fixed constants, so
in normal use the client does not offer what the endpoint will refuse.

`network.linkPreviews` is edited on **Admin → Network** under **Link previews**
and also has no environment variable, so it is never locked. It is not a
`features.*` switch because it does not change navigation: it controls whether
this server makes outbound requests to the pages people link to. Turning it off
stops new fetches immediately; cards already stored keep rendering, and the
Mastodon `card` field simply stays null for statuses posted afterwards.

The `features.*` settings (`features.fitness`, `features.explore`,
`features.messages`) are edited on **Admin → Instance** under **Optional
features** and have no environment variable, so they are never locked. Turning
one off removes that section from every account's navigation — sidebar, rail
and mobile bar. Settings → Navigation still lists it, greyed out and marked
"off for this server", because that page is where someone goes to find out
where a nav item went. It does **not** disable the
section: its pages and API keep working, so an existing link or bookmark still
resolves, and nobody's saved navigation is deleted, so re-enabling a feature
restores each account's layout exactly as they left it.

`posts.maxMediaAttachments` is the exception to the status-limit enforcement
described at the top of this section: it is advertised to clients and honoured
by this instance's own composer and inline reply box (which read it through
`useInstanceLimits()`), but no route enforces the resolved value. All three
create/edit paths — `POST`/`PUT /api/v1/statuses[/:id]` and `POST
/api/v1/accounts/outbox` — instead reject an attachment list longer than the
fixed `MAX_STORED_MEDIA_ATTACHMENTS` ceiling (50), answering `422`. So lowering
`posts.maxMediaAttachments` changes what clients are told and what the built-in
composer offers, never what these routes accept; an API client that ignores the
advertised value can still store up to the ceiling. Note that this is specific
to the attachment count: the outbox route _does_ enforce the resolved
`posts.maxCharacters` and `polls.*` through `validateStatusContentLimits`,
which is why the general claim at the top of this section holds for every limit
but this one.

Several settings carry an upper bound. `polls.maxOptions` (50) and
`polls.maxCharactersPerOption` (1,000) match the ceilings the status create
schema accepts; `posts.maxMediaAttachments` matches the stored-media ceiling;
`posts.maxCharacters` (100,000) is a sanity bound only. `media.maxFileSize`
defaults to **200 MiB** (`209715200`) and can be lowered freely or raised to a
ceiling of **1 GiB** (`1073741824`). The ceiling is there because the
object-storage driver buffers a stored file in memory when it reads it back out;
that read bounds itself by the same resolved `media.maxFileSize`, so raising the
cap never stores media the instance would then refuse to serve. An
`ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE` above the ceiling still applies,
because an environment variable pins its setting outright.

The variables that pin an admin-editable setting are:
`ACTIVITIES_SERVICE_NAME`, `ACTIVITIES_SERVICE_DESCRIPTION`,
`ACTIVITIES_LANGUAGES`, `ACTIVITIES_REGISTRATION_OPEN`,
`ACTIVITIES_ALLOW_EMAILS`, `ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE`,
`ACTIVITIES_REQUEST_TIMEOUT`, `ACTIVITIES_REQUEST_RETRY`,
`ACTIVITIES_REQUEST_MAX_RESPONSE_SIZE_BYTES`, `ACTIVITIES_FEDERATION_MODE`, and
`ACTIVITIES_ALLOW_ACTOR_DOMAINS`. Post size and poll limits have no environment
variable and are database-or-default only. `ACTIVITIES_ALLOW_MEDIA_DOMAINS` and
the `ACTIVITIES_MEDIA_STORAGE_*` backend stay environment-only (they feed the
Edge-runtime CSP and storage infrastructure). `ACTIVITIES_ALLOW_MEDIA_DOMAINS`
is shown read-only on the Federation tab, and the resolved storage backend is
shown read-only on the Posts & media tab. On a multi-instance deployment, an admin's save takes effect
on other instances within a short cache window rather than instantly; an
environment variable, when set, always wins regardless.

The Posts & media tab also carries a **Configure environment** builder for the
infrastructure that stays environment-only: it assembles a copy-pasteable `.env`
block for media storage (`ACTIVITIES_MEDIA_STORAGE_*`) and for the fitness map
provider (`ACTIVITIES_FITNESS_MAP_PROVIDER` and its credentials). The builder is
inert — nothing typed into it is submitted, stored, or sent anywhere, and the
server still only reads those values from the environment at boot, so a change
needs a restart.

A required variable you have not filled in is listed in the block carrying a
value only when the example is itself a correct one to keep — today that is just
`ACTIVITIES_MEDIA_STORAGE_PATH=./uploads` — and empty otherwise (`NAME=`), never
its example. The example belongs to the input beside it: a block that carried
examples as values could be pasted verbatim and boot a real configuration out of
them, pointing a live instance's uploads at a bucket the operator does not own.
Note that `./uploads` is a default of the builder's field, not of the variable:
none of the storage variables has an app-level default, so omitting a required
one from your `.env` fails config validation rather than falling back. An
**optional** variable is left out of the block entirely until you type something
into it, which is why `ACTIVITIES_MEDIA_STORAGE_ENDPOINT` does not appear by
default.

An emitted `NAME=` is inert because a blank required value is rejected rather
than accepted — see [Media Storage](#media-storage) below for that rule.

## Core Configuration

| Variable                         | Required | Description                                                                                                                                                                                                                                                                                           |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_HOST`                | **Yes**  | Domain name for your instance (e.g., `social.example.com`). No protocol, no trailing slash.                                                                                                                                                                                                           |
| `ACTIVITIES_SECRET_PHASE`        | **Yes**  | Secret string for signing cookies and tokens. Generate with `openssl rand -base64 32`.                                                                                                                                                                                                                |
| `ACTIVITIES_SERVICE_NAME`        | No       | Public instance display name used by instance metadata, auth display, and WebAuthn issuer labels.                                                                                                                                                                                                     |
| `ACTIVITIES_SERVICE_DESCRIPTION` | No       | Public instance description used by instance metadata endpoints.                                                                                                                                                                                                                                      |
| `ACTIVITIES_PRIVACY_POLICY`      | No       | Plain-text privacy policy served (HTML-escaped, paragraph-wrapped) by `GET /api/v1/instance/privacy_policy`. When unset the endpoint returns 404. (Mastodon serves a bundled default policy instead; this server has none, so unset means 404.)                                                       |
| `ACTIVITIES_TERMS_OF_SERVICE`    | No       | Plain-text terms of service served (HTML-escaped, paragraph-wrapped) by `GET /api/v1/instance/terms_of_service` (effective date reported as `1970-01-01`). When unset the endpoint returns 404, matching Mastodon.                                                                                    |
| `ACTIVITIES_LANGUAGES`           | No       | JSON array of supported instance languages (e.g., `["en","nl"]`). Defaults to `["en"]`.                                                                                                                                                                                                               |
| `ACTIVITIES_ALLOW_EMAILS`        | No       | JSON array of email addresses allowed to register (e.g., `["user@example.com"]`). If unset, registration may be open.                                                                                                                                                                                 |
| `ACTIVITIES_REGISTRATION_OPEN`   | No       | Set to `false` to close new-account sign-up entirely (sign-in stays available; the logged-out landing shows a "registration closed" notice). Defaults to open. Orthogonal to `ACTIVITIES_ALLOW_EMAILS`, which restricts _who_ may register while open.                                                |
| `ACTIVITIES_TRUSTED_HOSTS`       | No       | JSON array of additional public hosts accepted from `X-Forwarded-Host` and `X-Activity-Next-Host`. Also lets WebFinger, account search, and account lookup resolve `user@<trusted-host>` to the canonical local actor, so clients reaching the instance via an alias host can load the local account. |
| `ACTIVITIES_INSECURE_AUTH`       | No       | Set to `true` to allow HTTP (non-HTTPS) authentication. Only for local development.                                                                                                                                                                                                                   |

## Proxy Configuration

| Variable                            | Description                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_TRUST_PROXY_IP_HEADERS` | Set to `true` to use proxy-managed client IP headers for unauthenticated app registration throttling. Only enable when all direct app access is blocked and the trusted proxy overwrites or strips client-supplied forwarding headers before setting its own. Do not enable behind append-only proxies; if the proxy appends to `X-Forwarded-For`, the first element may still be untrusted. |

## Database

Activity.next supports SQLite and PostgreSQL. The configuration loader also accepts MySQL-compatible Knex clients for deployments that provide the needed driver/runtime support. See [SQLite Setup](sqlite-setup.md) and [PostgreSQL Setup](postgresql-setup.md) for detailed guides.

### Full JSON Configuration

| Variable              | Description                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVITIES_DATABASE` | Full database configuration as a JSON string (e.g., `{"client":"pg","connection":{...}}`). The value is a [Knex configuration object](https://knexjs.org/guide/#configuration-options) passed straight to `knex()`. Note: only the app runtime reads this variable — `yarn migrate` (the Knex CLI) does not; use the individual `ACTIVITIES_DATABASE_*` variables below when running migrations. |

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

| Variable          | Description                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_AUTH` | Full auth configuration as a JSON string. If not provided, local email/password authentication is enabled by default. |

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

## Translation

Optional. Enables `POST /api/v1/statuses/:id/translate` and the Translate control on posts, and sets `translation.enabled` in `/api/v2/instance`. One backend is active at a time, selected by `ACTIVITIES_TRANSLATION_TYPE`; if the required variables for the chosen backend are missing, translation is disabled. Translations are sanitized and cached in the `translation_cache` table.

| Variable                          | Description                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVITIES_TRANSLATION_TYPE`     | Translation backend: `deepl`, `gemini`, or `openai`.                                                                                                                                                               |
| `ACTIVITIES_TRANSLATION_API_KEY`  | API key. Required for `deepl`, `gemini`, and `openai`.                                                                                                                                                             |
| `ACTIVITIES_TRANSLATION_ENDPOINT` | Backend endpoint URL. Required for `openai` (full chat-completions URL including the path, e.g. `https://api.openai.com/v1/chat/completions`); optional for `gemini` (defaults to Google Generative Language API). |
| `ACTIVITIES_TRANSLATION_MODEL`    | Model name. Required for `openai` (e.g. `gpt-4o-mini`); optional for `gemini` (defaults to `gemini-2.5-flash`).                                                                                                    |
| `ACTIVITIES_TRANSLATION_PLAN`     | DeepL plan: `free` (default) or `pro`. Routes requests to `api-free.deepl.com` or `api.deepl.com`. Used by `deepl` only.                                                                                           |

## Alt Text Generation

Optional. Automatically generates accessibility descriptions (alt text) for uploaded images when no description is provided by the client, using an OpenAI-compatible vision chat-completions API. If any required variable is missing, alt text generation is disabled.

| Variable                       | Description                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_ALT_TEXT_ENDPOINT` | Chat-completions endpoint URL supporting vision (e.g. `https://api.openai.com/v1/chat/completions`). Required. |
| `ACTIVITIES_ALT_TEXT_API_KEY`  | API key for the chat-completions endpoint. Required.                                                           |
| `ACTIVITIES_ALT_TEXT_MODEL`    | Model name supporting vision (e.g. `gpt-4o-mini`). Required.                                                   |

## Media Storage

Required for media uploads (images and video in posts). If no media storage is configured, media uploads are disabled.

`ACTIVITIES_MEDIA_STORAGE_PATH`, `ACTIVITIES_MEDIA_STORAGE_BUCKET`, and `ACTIVITIES_MEDIA_STORAGE_REGION` are required for their storage type and have no default. Surrounding whitespace is trimmed, and a value that is **set but empty** (or whitespace only) is treated as **not configured**: the app logs a warning and leaves media storage disabled instead of starting a broken backend. An empty `ACTIVITIES_MEDIA_STORAGE_PATH` would otherwise resolve to the application's working directory, and an empty bucket or region would only fail later inside the AWS SDK.

If you have been running with a blank media path, treat it as a **credential exposure**, not merely a misconfiguration. `GET /api/v1/files/<path>` reads straight off the storage root with no database lookup — it only checks that the path stays inside the root and that the extension maps to a known MIME type — so with the root set to the working directory, any file in the application checkout with a recognised extension was readable without authentication. `.env`, `.env.local` and `*.sqlite3` happen not to map to a MIME type and so were not readable, but that is not an all-clear; plenty of secret-bearing files do map, including:

- a legacy root `config.json` (`application/json`), which on older instances held the whole configuration: `secretPhase`, database credentials, and auth and email secrets (S3 credentials were never in it — those come from the AWS SDK chain);
- `backups/production-archives/*.tar.gz` (`application/gzip`), the default output directory of `scripts/backup/productionArchive.ts` — a full database and media archive;
- `backups/actor-archives/*.tar.gz` (`application/gzip`), the default output directory of `scripts/backup/exportActorArchive.ts` — one account's full ActivityPub archive (every status regardless of visibility, media, fitness files, likes, bookmarks, and follows);
- key material such as `.p8` (the Apple Maps signing key), `.pem`, `.crt`, `.p12` and `.pfx`;
- `.conf`, `.ini`, `.toml` and `.txt`, plus source files (`.ts`, `.js`, `.json`, `.md`, `.yml`, `.sql`).

Audit what was sitting in the application directory and rotate anything reachable from that list, rather than assuming only source code leaked.

Leaving one of them **unset** while its storage type is configured is different, and still a hard startup failure — unless another required variable for the same storage type is blank, which disables storage before validation runs.

The rule covers those three value variables, not `ACTIVITIES_MEDIA_STORAGE_TYPE`, which is neither trimmed nor blank-checked: a padded `' fs '` is simply an unrecognised type. An unrecognised type — and a type left unset while other `ACTIVITIES_MEDIA_STORAGE_*` variables are set — disables media storage with a warning naming the variable.

| Variable                                     | Description                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVITIES_MEDIA_STORAGE_TYPE`              | Storage backend: `fs` (local), `s3`, or `object` (S3-compatible).                                                                                                                                                                                                                    |
| `ACTIVITIES_MEDIA_STORAGE_PATH`              | Local filesystem path for `fs` storage (e.g., `./uploads`).                                                                                                                                                                                                                          |
| `ACTIVITIES_MEDIA_STORAGE_BUCKET`            | S3 bucket name (for `s3` or `object`).                                                                                                                                                                                                                                               |
| `ACTIVITIES_MEDIA_STORAGE_REGION`            | S3 region (e.g., `us-east-1`).                                                                                                                                                                                                                                                       |
| `ACTIVITIES_MEDIA_STORAGE_HOSTNAME`          | Public media hostname/CDN used to serve stored media files. If unset, media files are served through the app from the configured storage backend. This value is not used for S3 API operations.                                                                                      |
| `ACTIVITIES_MEDIA_STORAGE_ENDPOINT`          | S3-compatible API endpoint used for storage operations and browser presigned uploads (for services like MinIO, DigitalOcean Spaces, Cloudflare R2). If unset, the AWS SDK uses the standard AWS S3 endpoint for the configured region; set this for non-AWS S3-compatible providers. |
| `ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE`     | Maximum file size in bytes (default: 200 MiB / `209715200`). Also pins the admin-editable `media.maxFileSize` setting; when unset, an admin can set the cap anywhere from 1 byte up to 1 GiB (`1073741824`).                                                                         |
| `ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT` | Per-account combined media + fitness storage quota in bytes. If unset, the config value stays empty and the quota service applies its 1 GiB (`1073741824`) default when enforcing quota.                                                                                             |

S3 credentials are not `ACTIVITIES_*` variables: the AWS SDK resolves them from its standard chain, so set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (or leave them unset when the host already supplies an IAM role or instance profile).

> Upgrade note: If you previously set `ACTIVITIES_MEDIA_STORAGE_HOSTNAME` or `ACTIVITIES_FITNESS_STORAGE_HOSTNAME` to a MinIO, Cloudflare R2, DigitalOcean Spaces, or other S3-compatible API endpoint, move that value to the matching `*_STORAGE_ENDPOINT` variable. `*_STORAGE_HOSTNAME` is for a public hostname/CDN origin, not for S3 API operations or browser presigned uploads.

> Upgrade note: An instance that was running with a **blank** required storage variable (most likely `ACTIVITIES_MEDIA_STORAGE_TYPE=fs` with an empty `ACTIVITIES_MEDIA_STORAGE_PATH=`) had a working-looking media backend rooted at the process working directory. That configuration now disables media and fitness storage: uploads stop, and every existing media URL serves the "media removed" placeholder. The signal is a pair of boot warnings — `ACTIVITIES_MEDIA_STORAGE_PATH is set but empty; media storage will be disabled` and the matching `… fitness storage will be disabled` — so grep for `is set but empty` after upgrading. To recover, set a real path and move your existing files into it. They are loose in the directory the app was started from, named `<16 hex characters><extension>`: `.webp` for stored images, `-thumbnail.webp` for their thumbnails, `.jpg` for the JPEG renditions generated for email, and `.mp4`/`.webm` for video attachments — so move all of those, not just the `.webp` files. Fitness activity files were not loose in that directory: the fallback defaulted the empty path to `uploads`, so move `./uploads/fitness/` into `<new path>/fitness/` as well, or every `.fit`/`.gpx`/`.tcx` and imported Strava `.zip` archive goes missing. Route maps and their email JPEGs are **not** in there — they go through media storage, so they are among the loose files and the first move already covers them. Set the path even if you do not want media storage: leaving the `ACTIVITIES_MEDIA_STORAGE_*` variables unset entirely is the supported way to turn uploads off.

## Fitness File Storage

For fitness activity file uploads (.fit, .gpx, .tcx). Falls back to media storage configuration if not set.

`ACTIVITIES_FITNESS_STORAGE_PATH`, `ACTIVITIES_FITNESS_STORAGE_BUCKET`, and `ACTIVITIES_FITNESS_STORAGE_REGION` follow the same rule as their media counterparts: whitespace is trimmed, and a **set but empty** value disables fitness storage with a warning rather than starting a broken backend. The media-storage fallback applies the rule to the `ACTIVITIES_MEDIA_STORAGE_*` variables it reads, so a blank `ACTIVITIES_MEDIA_STORAGE_PATH` no longer falls through to `uploads/fitness` under the application's working directory.

Setting `ACTIVITIES_FITNESS_STORAGE_TYPE` to a **non-empty** value opts out of the media-storage fallback. If the type is set but unusable — a blank required value, or a type this app does not recognise — fitness storage is disabled and a warning names the variable; it does **not** quietly write fitness files into the media bucket. (Leaving the type empty, `ACTIVITIES_FITNESS_STORAGE_TYPE=`, still selects the fallback, exactly as leaving it unset does.)

| Variable                                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_FITNESS_STORAGE_TYPE`                            | Storage backend: `fs`, `s3`, or `object`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ACTIVITIES_FITNESS_STORAGE_PATH`                            | Local filesystem path for `fs` storage. Required when `ACTIVITIES_FITNESS_STORAGE_TYPE=fs` is set (there is no default). When fitness storage is not explicitly configured and media storage is `fs`, fitness files fall back to `<ACTIVITIES_MEDIA_STORAGE_PATH>/fitness` and this variable is ignored.                                                                                                                                                                                                |
| `ACTIVITIES_FITNESS_STORAGE_BUCKET`                          | S3 bucket name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ACTIVITIES_FITNESS_STORAGE_REGION`                          | S3 region.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ACTIVITIES_FITNESS_STORAGE_HOSTNAME`                        | Public fitness file hostname/CDN. If fitness storage is not explicitly configured, it inherits `ACTIVITIES_MEDIA_STORAGE_HOSTNAME` through the media-storage fallback; if explicit fitness storage is configured and this is unset, no separate fitness public hostname is configured and files are served through the app. This value is not used for S3 API operations.                                                                                                                               |
| `ACTIVITIES_FITNESS_STORAGE_ENDPOINT`                        | S3-compatible API endpoint used for fitness storage operations and browser presigned uploads. If fitness storage is not explicitly configured, it inherits `ACTIVITIES_MEDIA_STORAGE_ENDPOINT` through the media-storage fallback; otherwise, if unset, the AWS SDK uses the standard AWS S3 endpoint for the configured region. Set this for non-AWS S3-compatible providers.                                                                                                                          |
| `ACTIVITIES_FITNESS_STORAGE_PREFIX`                          | S3 key prefix (default: `fitness/`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE`                   | Maximum file size in bytes (default: 50 MiB / `52428800`).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT`               | Override for the shared per-account media + fitness storage quota in bytes. When set, it takes precedence over `ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT` for both media and fitness quota checks; when unset, the media quota or quota service default applies.                                                                                                                                                                                                                                      |
| `ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN`                     | Mapbox API token for map rendering. Required when `ACTIVITIES_FITNESS_MAP_PROVIDER=mapbox` (an empty token falls back to `osm`). It also selects `mapbox` when `ACTIVITIES_FITNESS_MAP_PROVIDER` is unset or holds an unknown value. Only public `pk.*` tokens are passed to browser maps; secret `sk.*` tokens stay server-side and the browser falls back to `osm`.                                                                                                                                   |
| `ACTIVITIES_FITNESS_MAP_PROVIDER`                            | Fitness map provider: `apple`, `mapbox`, or `osm`. When unset or set to an unknown value the provider is inferred for back-compat: `mapbox` if `ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN` is set, otherwise `osm`. If the selected provider is missing its required credentials, it falls back to keyless `osm` so maps keep rendering. Changing the provider requires an app restart because the resolved CSP is cached for the process lifetime.                                                        |
| `ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID`                      | Apple Developer team ID used to sign Apple Maps (MapKit JS) tokens. Required when `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`; if this, the key ID, or the private key is blank the provider falls back to `osm`.                                                                                                                                                                                                                                                                                           |
| `ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID`                       | Apple MapKit JS key ID (Key ID of the MapKit private key). Required when `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`; if this, the team ID, or the private key is blank the provider falls back to `osm`.                                                                                                                                                                                                                                                                                                   |
| `ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY`                  | Apple MapKit JS private key (PEM). Required when `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`; if this, the team ID, or the key ID is blank the provider falls back to `osm`. A single-line `\n`-escaped PEM is accepted and expanded into a real multi-line key.                                                                                                                                                                                                                                            |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES`       | Worker heap budget before route-cache accumulation is downsampled (default: 512 MB).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT`  | Maximum in-memory route points before accumulation is downsampled (default: 160,000).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_FILE_POINT_LIMIT`          | Maximum points retained from one parsed fitness file before privacy trimming (default: 80,000). The trim's along-route distance is therefore measured on the already-decimated track, which under-estimates true route length and so trims slightly more, never less.                                                                                                                                                                                                                                   |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS` | Finest Ramer–Douglas–Peucker tolerance (meters) applied to each route before accumulation and to the final stored payload; straight stretches collapse toward their endpoints while bends keep road-following detail. Acts as a floor — dense regions are adaptively coarsened from here to fit the point budget without corner-cutting, and it is also the floor under each zoom's own one-pixel tolerance when the tile pyramid is built. Smaller = higher fidelity and larger payloads (default: 1). |

### Fitness map provider

Interactive maps (route detail, heatmaps) and the stored static route-map images are
rendered by one pluggable provider, selected with `ACTIVITIES_FITNESS_MAP_PROVIDER`:

- `apple` — Apple Maps: MapKit JS in the browser (authenticated with a short-lived
  token signed from `ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID` /
  `..._KEY_ID` / `..._PRIVATE_KEY`) and the Apple Maps Snapshots API for static images.
  Both draw Apple's **muted standard** basemap — the standard road map with its
  land, water and POI colours de-saturated — so the route lines, heat runs and
  privacy circles painted on top stay the most prominent thing on the map. There
  is no map-type control and no way to switch to hybrid or satellite.
- `mapbox` — Mapbox GL JS plus the Mapbox Static Images API, using
  `ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN`.
- `osm` — keyless MapLibre GL JS with OpenFreeMap tiles; no credentials needed.

Fallback rule: if the selected provider's credentials are incomplete (any required
variable blank — for `apple` that means all three of team ID, key ID and private key),
the resolver silently falls back to `osm` rather than failing to render. Only presence is
checked, so a malformed private key still selects `apple` and surfaces as a failed token
mint. When the variable is unset or holds an unknown value the provider is inferred: a
configured Mapbox token selects `mapbox` for backward compatibility, otherwise `osm`.
Because the Content-Security-Policy
is resolved once and cached for the process lifetime, changing the provider (or its
credentials) requires restarting the app.

Apple Maps free tier (per Apple Developer Program membership, as published by Apple):
250,000 MapKit JS map views per day, 25,000 service calls per day, and 25,000 unique
snapshot requests per day. Static route images are generated once per fitness post and
stored, so snapshot usage tracks new imports rather than page views.

Existing route-map images keep the style they were generated with — both the
provider and its basemap; run **Regenerate maps for old statuses** on the fitness
privacy page (`/fitness/privacy`, backed by
`POST /api/v1/fitness/general/regenerate-maps`) after switching providers, or after
a basemap change, to re-render them.

## Queue (Background Jobs)

For asynchronous processing of ActivityPub delivery, file processing, etc.

| Variable                                      | Description                                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_QUEUE_TYPE`                       | Queue backend: `qstash` or `cloudtasks`.                                                                                                                                                                                                                  |
| `ACTIVITIES_QUEUE_URL`                        | Full callback endpoint URL of this instance's queue handler, e.g. `https://your-domain.tld/api/v1/queue/qstash` or `https://your-domain.tld/api/v1/queue/cloudtasks`. The queue backend delivers job messages to exactly this URL — it is not a base URL. |
| `ACTIVITIES_QUEUE_NAME`                       | Queue name for Cloud Tasks (e.g. `activities-prod-queue`).                                                                                                                                                                                                |
| `ACTIVITIES_QUEUE_TOKEN`                      | QStash API token.                                                                                                                                                                                                                                         |
| `ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY`        | QStash current signing key (for webhook verification).                                                                                                                                                                                                    |
| `ACTIVITIES_QUEUE_NEXT_SIGNING_KEY`           | QStash next signing key (for key rotation).                                                                                                                                                                                                               |
| `ACTIVITIES_QUEUE_QSTASH_MAX_RETRIES`         | Maximum retry attempts before delivering failed task to QStash DLQ (default 3).                                                                                                                                                                           |
| `ACTIVITIES_QUEUE_CLOUDTASKS_LOCATION`        | Google Cloud location/region for Cloud Tasks (default `europe-west1`).                                                                                                                                                                                    |
| `ACTIVITIES_QUEUE_CLOUDTASKS_PROJECT_ID`      | Google Cloud project ID for Cloud Tasks (falls back to `FIREBASE_PROJECT_ID` or default credentials project if unset).                                                                                                                                    |
| `ACTIVITIES_QUEUE_CLOUDTASKS_SERVICE_ACCOUNT` | Authorized Google Cloud service account email for Cloud Tasks OIDC authentication.                                                                                                                                                                        |
| `ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE`        | Expected audience for Cloud Tasks OIDC token verification.                                                                                                                                                                                                |
| `ACTIVITIES_QUEUE_CLOUDTASKS_SECRET`          | Pre-shared webhook secret / bearer token for Cloud Tasks endpoint authentication.                                                                                                                                                                         |
| `ACTIVITIES_QUEUE_CLOUDTASKS_MAX_RETRIES`     | Maximum retry attempts before capturing failed task in dead letter queue (default 5).                                                                                                                                                                     |

## Push Notifications

| Variable                            | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `ACTIVITIES_PUSH_VAPID_PUBLIC_KEY`  | VAPID public key for Web Push.           |
| `ACTIVITIES_PUSH_VAPID_PRIVATE_KEY` | VAPID private key for Web Push.          |
| `ACTIVITIES_PUSH_VAPID_EMAIL`       | VAPID contact email, often `mailto:...`. |

## Domain Controls

| Variable                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_ALLOW_MEDIA_DOMAINS`        | Optional JSON array of additional service-owned media origins allowed by runtime `img-src` and `media-src` CSP. Use this for media created by this service and served from public domains/CDNs that are not otherwise covered by the configured media storage hostname. This setting is additive and does not restrict browser-loaded federated remote media.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS` | Optional JSON array of remote media origins allowed by runtime `img-src` and `media-src` CSP for browser-loaded federated status images, avatars, emoji, video, and audio. Next image optimization is disabled and remote image patterns are build-time static, so this setting is enforced at request time instead of during `next build`. When unset or blank, federated remote media defaults to broad HTTPS browser loading; when set, broad `https:` is replaced by the configured origins. Set `[]` to block all federated remote media sources. This governs federated media only: `img-src` always keeps `https://i.ytimg.com`, the thumbnail host for the click-to-play YouTube player in a link preview card, because that is a fixed host belonging to a first-party feature rather than a remote origin an operator is choosing to trust. |
| `ACTIVITIES_ALLOW_ACTOR_DOMAINS`        | JSON array of allowed domains for actors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ACTIVITIES_FEDERATION_MODE`            | Federation mode: `open` (default) or `allowlist` to require explicit allowed actor domains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ACTIVITIES_ENABLE_INBOX_FORWARDING`    | Enable ActivityPub Outbound Inbox Forwarding (W3C ActivityPub §7.1.2) to fan out verified public replies and mentions targeting local users to their remote followers (`true` or `false`, default: `false`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ACTIVITIES_TRUSTED_HOSTS`              | JSON array of additional public hosts accepted from `X-Forwarded-Host` and `X-Activity-Next-Host`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Request Configuration

| Variable                                     | Description                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVITIES_REQUEST_TIMEOUT`                 | HTTP request timeout in milliseconds for outgoing federation requests.                                                   |
| `ACTIVITIES_REQUEST_RETRY`                   | Number of retries for failed outgoing requests.                                                                          |
| `ACTIVITIES_REQUEST_RETRY_NOISE`             | Random delay noise added between retries (in milliseconds).                                                              |
| `ACTIVITIES_REQUEST_MAX_RESPONSE_SIZE_BYTES` | Maximum size of an outgoing federation request's response body, in bytes (default: 2 MB). Larger responses are rejected. |

## Observability

| Variable                              | Description                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OTEL_SERVICE_NAME`                   | OpenTelemetry service name. The app itself does not read this variable or set a default — it is only meaningful to an externally attached OTel SDK/collector.                                                |
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
