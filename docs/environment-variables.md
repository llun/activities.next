# Environment Variables Reference

This document lists all environment variables supported by Activity.next.

> Only getting started? The [Quickstart](quickstart.md) covers the three core
> settings strictly required to boot a local instance (host, secret phrase, and
> a database).

Application configuration is provided through environment variables. Root-level `config.json` files are ignored; migrate any previous file settings to the corresponding `ACTIVITIES_*` or `OTEL_EXPORTER_*` variables listed below. Application config is read at runtime, so Docker/standalone builds do not need real `ACTIVITIES_*` or `OTEL_EXPORTER_*` values at build time. Environment variables read outside app config, such as `NODE_ENV`, `BUILD_STANDALONE`, `NEXT_TELEMETRY_DISABLED`, and `LOG_LEVEL`, still apply.

## Database-backed server settings (env → database → default)

Some instance policy is also editable at runtime from the admin area
(**Admin → Server settings / Posts & media / Network**, and the **Federation**
tab), stored in the `server_settings` table. Each such value is resolved with
the precedence **environment variable → database → built-in default**: an
environment variable always wins and locks the field in the admin UI with a
"Set by environment" badge, so removing the variable is what hands control
back to the admin form. Clients read the resolved values from `/api/v1/instance`
and `/api/v2/instance`. On a multi-instance deployment an admin's save
reaches other instances within a short cache window; an environment variable,
when set, always wins regardless.

Every endpoint that creates or edits a status — `POST`/`PUT`
`/api/v1/statuses[/:id]` (which the web composer and the inline reply box post
through) and the deprecated `POST /api/v1/accounts/outbox` — enforces the
resolved `posts.maxCharacters` and `polls.*` limits, and every upload endpoint
(`POST /api/v1/media`, `POST /api/v2/media`, `PUT`/`PATCH /api/v1/media/:id`
thumbnails, `POST /api/v1/medias/presigned`, `PATCH
/api/v1/accounts/update_credentials` avatars/headers, and admin custom emoji)
enforces the resolved `media.maxFileSize`; all answer `422` above the limit.
The status routes put the offending limit in the `error` message (except the
poll-expiry one, which just says it is out of range); the upload routes return
the generic `Unprocessable entity`, apart from `update_credentials`, which says
`Invalid image file`. The web composer, its poll editor and media picker, the
inline reply box, and the avatar/header picker all size themselves to the same
resolved values rather than to fixed constants, so in normal use the client
does not offer what the endpoint will refuse. The one exception is
`posts.maxMediaAttachments`: it is advertised to clients and
honoured by this instance's own composer, but the routes instead cap
attachment lists at the fixed `MAX_STORED_MEDIA_ATTACHMENTS` ceiling (50), so
lowering it changes what clients are told and the composer offers, never what
the routes accept (an API client ignoring the advertised value can still store
up to the ceiling).

Which settings can be set from the admin UI:

- Pinned by an environment variable (the field is locked while the variable is
  set): `ACTIVITIES_SERVICE_NAME`, `ACTIVITIES_SERVICE_DESCRIPTION`,
  `ACTIVITIES_TERMS_OF_SERVICE`, `ACTIVITIES_PRIVACY_POLICY`,
  `ACTIVITIES_LANGUAGES`, `ACTIVITIES_REGISTRATION_OPEN`,
  `ACTIVITIES_ALLOW_EMAILS`, `ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE`,
  `ACTIVITIES_REQUEST_TIMEOUT`, `ACTIVITIES_REQUEST_RETRY`,
  `ACTIVITIES_REQUEST_MAX_RESPONSE_SIZE_BYTES`, `ACTIVITIES_FEDERATION_MODE`,
  and `ACTIVITIES_ALLOW_ACTOR_DOMAINS`.
- Database-or-default only (no environment variable, never locked):
  `posts.maxCharacters` (sanity bound 100,000), `posts.maxMediaAttachments`
  (matches the stored-media ceiling of 50), `polls.maxOptions` (50) and
  `polls.maxCharactersPerOption` (1,000) (both match the ceilings the status
  create schema accepts), and `media.maxFileSize` when
  `ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE` is unset — an admin can set it
  anywhere from 1 byte up to the 1 GiB (`1073741824`) ceiling (default 200 MiB
  / `209715200`; an environment variable above the ceiling still applies,
  because it pins the setting outright). The ceiling is there because the
  synchronous upload path still reads a whole upload into memory, so the 1 GiB
  cap bounds that buffer; stored files are streamed when served, so the read
  path never refuses a size this accepts.
- Network switches, on **Admin → Network**, no environment variable:
  `network.linkPreviews`, `network.speciesLookups` (GBIF) and
  `network.placeLookups` (Nominatim), the latter two on by default. Turning
  one off stops new outbound requests immediately; already-stored results
  keep rendering. See [Gallery Lookups](#gallery-lookups).
- Optional features, on **Admin → Server settings**, no environment
  variable: `features.fitness`, `features.explore`, `features.messages`.
  Turning one off removes that section from every account's navigation only
  (sidebar, rail and mobile drawer) — Settings → Sidebar still lists it, greyed
  out and marked "off for this server" — its pages and API keep working, and
  re-enabling it restores each account's layout. A served domain can turn a
  feature off for its own visitors, never on.
- Environment-only, because they feed the Edge-runtime CSP and storage
  infrastructure; shown read-only in the admin UI:
  `ACTIVITIES_ALLOW_MEDIA_DOMAINS` (Federation tab), the resolved storage
  backend (Posts & media tab), and the fitness map provider. The Posts &
  media tab's **Configure environment** builder assembles a copy-pasteable
  `.env` block for the `ACTIVITIES_MEDIA_STORAGE_*` and map-provider
  variables; it is inert, and changes still need a restart. A required variable is
  emitted as `NAME=` (never its example, which could be pasted verbatim into a
  live `.env`), except
  `ACTIVITIES_MEDIA_STORAGE_PATH=./uploads`; optional variables are omitted until
  typed; and no storage variable has an app-level default, so omitting a required
  one fails config validation.

To override a database value, set the pinning environment variable and
restart; to hand control back to the admin form, remove the variable and
restart. A blank required storage value is rejected rather than accepted —
see [Media Storage](#media-storage).

## Core Configuration

| Variable                         | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_HOST`                | **Yes**  | Domain name for your instance (e.g., `social.example.com`). No protocol, no trailing slash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ACTIVITIES_SECRET_PHASE`        | **Yes**  | Secret string for signing cookies and tokens. Generate with `openssl rand -base64 32`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ACTIVITIES_SERVICE_NAME`        | No       | The server's display name. Pins the `instance.name` server setting (Admin › Server settings), whose field is then locked. Every name label — page titles, the web app manifest, sign-in, the landing, instance metadata and NodeInfo, the passkey relying party name and the 2FA issuer (colons and control characters dropped) — follows the visited domain's own name (Admin › Served domains) when set, else this setting. Session, token and revoke handling keep this value (or `Activities.next`) as the name of their auth instance, which they never show.                                                                                             |
| `ACTIVITIES_SERVICE_DESCRIPTION` | No       | Public instance description used by instance metadata endpoints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ACTIVITIES_PRIVACY_POLICY`      | No       | Privacy policy as Markdown. Pins the `policies.privacyPolicy` server setting (Admin › Server settings, Terms and privacy), whose field is then locked; an empty value counts as unset. Rendered the way Mastodon renders it (raw HTML shown as text, images dropped, `%{domain}` replaced with the visited domain) for `GET /api/v1/instance/privacy_policy`, the `/privacy-policy` page and the sign-up agreement; a served domain's own policy takes its place there. With no policy set the endpoint returns 404 (Mastodon serves a bundled default policy instead; this server has none), and a policy set here has no date, so `updated_at` is the epoch. |
| `ACTIVITIES_TERMS_OF_SERVICE`    | No       | Terms of service as Markdown. Pins the `policies.termsOfService` server setting (Admin › Server settings, Terms and privacy), whose field is then locked; an empty value counts as unset. Rendered like the privacy policy for `GET /api/v1/instance/terms_of_service`, the `/terms-of-service` page and the sign-up agreement; a served domain's own terms take its place there. With no terms set the endpoint returns 404, matching Mastodon; terms set here have no date (effective `1970-01-01`), while terms saved in the admin form take the UTC date they last changed.                                                                                |
| `ACTIVITIES_LANGUAGES`           | No       | JSON array of supported instance languages (e.g., `["en","nl"]`). Defaults to `["en"]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ACTIVITIES_ALLOW_EMAILS`        | No       | JSON array of email addresses allowed to register (e.g., `["user@example.com"]`); if unset, registration may be open. Applies to sign-up on `ACTIVITIES_HOST`; every other domain has its own list in Admin › Served domains.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ACTIVITIES_REGISTRATION_OPEN`   | No       | Set to `false` to close new-account sign-up on `ACTIVITIES_HOST` (sign-in stays available; the logged-out landing shows a "sign-ups are closed" notice); defaults to open. Every other domain has its own sign-up switch in Admin › Served domains and never falls back to this one. Orthogonal to `ACTIVITIES_ALLOW_EMAILS`, which restricts _who_ may register while open.                                                                                                                                                                                                                                                                                   |
| `ACTIVITIES_TRUSTED_HOSTS`       | No       | JSON array of additional public hosts this server answers on, accepted from `X-Forwarded-Host` and `X-Activity-Next-Host`; entries may be `*.example.com` wildcards (subdomains only, trusted for forwarded hosts and sign-in only). A concrete entry is one of this server's own domains and shows in Admin › Served domains as always on (actors may be created on it when `ACTIVITIES_ALLOW_ACTOR_DOMAINS` is empty; its sign-ups are closed until an admin opens them there); a wildcard is neither — see [Which domains are local](#which-domains-are-local). Domains can also be added without a restart in Admin › Served domains.                      |
| `ACTIVITIES_INSECURE_AUTH`       | No       | Set to `true` to allow HTTP (non-HTTPS) authentication. Only for local development.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Proxy Configuration

| Variable                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_TRUST_PROXY_IP_HEADERS` | Set to `true` to use proxy-managed client IP headers for two limits on unauthenticated callers: the throttle on app registration (`POST /api/v1/apps`) and the rate limit (300 reads per client per minute) on logged-out reads of the public gallery album endpoints (`GET /api/v1/accounts/:id/gallery/albums[/:albumId]`). Left off, neither applies to anonymous callers, because client IP headers are spoofable when no trusted proxy sets them (signed-in album reads are still limited per account). Only enable when all direct app access is blocked and the trusted proxy overwrites or strips client-supplied forwarding headers; behind an append-only proxy the first `X-Forwarded-For` element may still be untrusted. |

## Database

Activity.next supports SQLite (`better-sqlite3`) and PostgreSQL (`pg`) only. Any other `ACTIVITIES_DATABASE_CLIENT` makes the app fail at startup. See [SQLite Setup](sqlite-setup.md) and [PostgreSQL Setup](postgresql-setup.md) for detailed guides.

### Full JSON Configuration

| Variable              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVITIES_DATABASE` | Full database configuration as a JSON string (e.g., `{"client":"pg","connection":{...}}`). Takes precedence over the individual `ACTIVITIES_DATABASE_*` variables below, and both the app runtime and `yarn migrate` (`scripts/database/migrate.ts`) read it. The app uses `client` (`better-sqlite3`, or `pg`/`postgres`/`postgresql`), `connection` (for SQLite the `filename`, or the filename as a string; for PostgreSQL a node-postgres client configuration such as `host`, `port`, `user`, `password`, `database`, `ssl` and `application_name`, or a connection string; without `connection`, node-postgres reads the `PG*` environment variables, under `yarn migrate` too), `pool.min`/`pool.max` (defaults 2 and 10) and `acquireConnectionTimeout` (how long a query waits for a free pooled connection, in milliseconds, a whole number > 0 or a string holding one; default 60000); any other key (`searchPath`, `debug`, other `pool` settings, …) is ignored with a warning naming it. `application_name` defaults to `Activities.next`. See [PostgreSQL Setup](postgresql-setup.md) and [SQLite Setup](sqlite-setup.md). |

### Individual Variables (SQLite)

| Variable                              | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `ACTIVITIES_DATABASE_CLIENT`          | Set to `better-sqlite3` for SQLite.                   |
| `ACTIVITIES_DATABASE_SQLITE_FILENAME` | Path to SQLite database file (e.g., `./dev.sqlite3`). |

### Individual Variables (PostgreSQL)

| Variable                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_DATABASE_CLIENT`      | Set to `pg` for PostgreSQL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ACTIVITIES_DATABASE_PG_HOST`     | PostgreSQL host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ACTIVITIES_DATABASE_PG_PORT`     | PostgreSQL port (default: `5432`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ACTIVITIES_DATABASE_PG_USER`     | PostgreSQL username.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ACTIVITIES_DATABASE_PG_PASSWORD` | PostgreSQL password.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ACTIVITIES_DATABASE_PG_DATABASE` | PostgreSQL database name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ACTIVITIES_DATABASE_PG_SSL_MODE` | PostgreSQL SSL mode: `disable`, `require`, `verify-ca`, or `verify-full`. When set to `require`, SSL is enabled without certificate verification. When set to `verify-ca`, SSL is enabled with certificate verification but without hostname checking. When set to `verify-full`, SSL is enabled with full certificate and hostname verification. When set to `disable` or unset, SSL is not used.                                                                                                                                                            |
| `ACTIVITIES_DATABASE_PG_POOL_MIN` | Minimum connection pool size (default: `1`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ACTIVITIES_DATABASE_PG_POOL_MAX` | Maximum connection pool size per server process (default: `5`); keep instances × max under the PostgreSQL `max_connections`. A query that finds every pooled connection busy waits for one for up to 60 seconds, then fails. These pool variables apply only with the individual `ACTIVITIES_DATABASE_PG_*` variables; with the `ACTIVITIES_DATABASE` JSON config the pool comes from its `pool` key (defaults min 2, max 10). A pool size that is not a whole number, a max below 1, or a min below 0 or above the max fails when the configuration is read. |

### Unsupported clients

MySQL (`mysql`, `mysql2`), node-sqlite3 (`sqlite3`) and `pg-native` are not supported, and none of their drivers is a dependency. Setting `ACTIVITIES_DATABASE_CLIENT` to one of them (or to any other value besides `better-sqlite3` and `pg`) makes the app fail at startup; the log shows an error that names the two supported clients. The `ACTIVITIES_DATABASE_MYSQL_*` variables (`HOST`, `PORT`, `USER`, `PASSWORD`, `DATABASE`, `POOL_MIN`, `POOL_MAX`) are no longer read, by the app or by `yarn migrate`.

## Authentication

| Variable          | Description                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_AUTH` | Full auth configuration as a JSON string (`{"enableCredential": boolean, "enableInstrumentation": boolean}`). If not provided, local email/password authentication is enabled and OpenTelemetry instrumentation is disabled by default. |

## Email

Email is optional. Leave `ACTIVITIES_EMAIL` and all individual
`ACTIVITIES_EMAIL_*` variables unset to disable email intentionally. In that
mode, account registration keeps the no-email behavior and notification sends
are skipped. Notification delivery is best effort: errors are logged, with no
durable retries or delivery-status tracking.

`ACTIVITIES_EMAIL` accepts the full provider configuration as JSON and takes
precedence when it is syntactically valid; malformed JSON falls back to the
individual variables below, and when none are set configuration fails rather
than running with email disabled (which would let registration write accounts
pre-verified). A syntactically valid value with an unsupported provider or
schema is rejected rather than falling back — including the removed `lambda`
provider, so an instance that used Lambda must migrate to SMTP, Resend, or AWS
SES and remove the Lambda-specific variables before upgrading; the app never
chooses a replacement provider automatically (see
[Setup](setup.md#email-configuration-optional)).

When configuring email through individual variables rather than JSON,
`ACTIVITIES_EMAIL_TYPE` is required (a partial configuration without a
provider type is invalid and fails configuration); leave all email variables
unset when email should be disabled.

| Variable                | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_EMAIL`      | Full email configuration as a JSON string.                                                                                                                                                                                                                                                                                                                 |
| `ACTIVITIES_EMAIL_TYPE` | Email provider: `smtp`, `resend`, or `ses`.                                                                                                                                                                                                                                                                                                                |
| `ACTIVITIES_EMAIL_FROM` | Sender email address (e.g., `noreply@your-domain.tld`), used as written for the primary domain (the part inside `<>` if you wrote `Name <address>`). Mail for any other served domain is sent from the same address under that domain's name (Admin › Served domains, else Admin › Server settings), so no extra sender verification is needed per domain. |

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

Optional. Automatically generates accessibility descriptions (alt text) for uploaded images and videos when no description is provided by the client, and generates route descriptions for fitness activity route maps, using an OpenAI-compatible vision chat-completions API. For a video, the representative preview frame is extracted and sent as the image input. Alt-text generation is best-effort: a provider or extraction failure leaves the media without a generated description rather than failing the upload or fitness processing. Note this is separate from storing the video's poster frame, which a synchronous video upload still requires to be decodable. If any required variable is missing, alt text generation is disabled.

| Variable                       | Description                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_ALT_TEXT_ENDPOINT` | Chat-completions endpoint URL supporting vision (e.g. `https://api.openai.com/v1/chat/completions`). Required. |
| `ACTIVITIES_ALT_TEXT_API_KEY`  | API key for the chat-completions endpoint. Required.                                                           |
| `ACTIVITIES_ALT_TEXT_MODEL`    | Model name supporting vision (e.g. `gpt-4o-mini`). Required.                                                   |

## Gallery Lookups

Optional. Smart subjects and place names for photos in the media gallery. Every variable is optional and the defaults work out of the box.

- **Subject suggestions** reuse the Alt Text Generation endpoint and key above. They are available only when alt text is configured and `ACTIVITIES_GALLERY_SUBJECTS` is not `off`. Suggestions are never decisions: they are stored as owner-only candidates and a subject is only saved when its owner confirms it.
- **Species lookups** call the [GBIF](https://www.gbif.org/developer/summary) v1 API (taxonomy, plus the IUCN Red List category GBIF carries). No key is needed. The IUCN category is only used to hide the place of threatened species (CR, EN, VU) from other people.
- **Place names** call [Nominatim](https://nominatim.org/release-docs/latest/api/Reverse/) reverse geocoding. **Only the centre of the 0.05 degree grid cell (about 5 km) a photo is in is ever sent, never the stored point.** The lookup runs for every photo with GPS coordinates, including ones whose public precision is hidden, so the owner can be offered a name. The public Nominatim service is on by default; see its [usage policy](https://operations.osmfoundation.org/policies/nominatim/). Point `ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT` at your own Nominatim for a busy instance.
- **Rate limits and the circuit breaker.** Calls are throttled in-process (GBIF: 4 at a time, 10 per second; Nominatim: one at a time, at least 1.1 seconds apart). After a timeout, a 5xx or a 429 a provider is treated as down for its `Retry-After` or 5 minutes, so an air-gapped server does not add a timeout to every upload. This is best effort per process; on several instances the lookup cache (the `gallery_lookup_cache` table, which stores snapped ~5 km cells, so it is a coarse record of where photos were taken) is the real protection.
- **Admin switches.** Species lookups and place names can each be turned off under **Admin → Network**. They have no environment variable, so they are never locked. Turning one off stops new requests; results already stored stay. Queued lookups re-check the switch when they run.

| Variable                                | Description                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_GALLERY_SUBJECTS`           | Set to `off` to disable subject suggestions even when alt text is configured. Default: on when alt text is configured. |
| `ACTIVITIES_GALLERY_SUBJECTS_MODEL`     | Vision model used for subject suggestions. Defaults to `ACTIVITIES_ALT_TEXT_MODEL`.                                    |
| `ACTIVITIES_GALLERY_GBIF_ENDPOINT`      | GBIF API base URL. Default: `https://api.gbif.org/v1`.                                                                 |
| `ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT` | Nominatim base URL. Default: `https://nominatim.openstreetmap.org`.                                                    |
| `ACTIVITIES_GALLERY_NOMINATIM_EMAIL`    | Contact email sent as the `email` parameter, as the Nominatim usage policy asks. Optional.                             |

An endpoint must be an `https:` URL without credentials. An invalid value logs one warning and falls back to the default; it never stops the server or the build. The vision API key is never sent to GBIF or Nominatim.

## Photo Editor

Optional. The photo editor's **Select subject** tool runs a small segmentation model (SlimSAM, `Xenova/slimsam-77-uniform`) in the owner's browser. The browser downloads two model files once (about 14 MB together), checks each file's size and SHA-256 against constants built into the app (`lib/config/photoEditor.ts`), and keeps them in its Cache Storage. The server never downloads or runs the model, and no photo leaves the browser for it. The brush and the other mask tools work without it.

| Variable                               | Description                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL` | Where the browser downloads the model files from. Default: `https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/` (a pinned revision). Set an `https:` URL without credentials that ends with `/` to self-host the same files (`onnx/vision_encoder_quantized.onnx` and `onnx/prompt_encoder_mask_decoder_quantized.onnx` under it), or `off` to turn Select subject off. |

The value is read at request time and changes the Content Security Policy. While the model is on, `connect-src` allows its origins (for the default, `https://huggingface.co` and `https://*.hf.co`, the CDN Hugging Face redirects to; for a custom URL, its origin only) and `script-src` gains `'wasm-unsafe-eval'` for the WebAssembly runtime. With `off`, neither is added. A self-hosted server must answer the browser's cross-origin `fetch` with CORS headers. An invalid value logs one warning and is treated as `off`; it never stops the server or the build.

## Media Storage

Required for media uploads (images and video in posts). If no media storage is configured, media uploads are disabled.

`ACTIVITIES_MEDIA_STORAGE_PATH`, `ACTIVITIES_MEDIA_STORAGE_BUCKET`, and `ACTIVITIES_MEDIA_STORAGE_REGION` are required for their storage type and have no default. Surrounding whitespace is trimmed, and a value that is **set but empty** (or whitespace only) is treated as **not configured**: the app logs a warning and leaves media storage disabled instead of starting a broken backend. An empty `ACTIVITIES_MEDIA_STORAGE_PATH` would otherwise resolve to the application's working directory, and an empty bucket or region would only fail later inside the AWS SDK.

If you have been running with a blank media path, treat it as a **credential
exposure**, not merely a misconfiguration: `GET /api/v1/files/<path>` reads
straight off the storage root with no database lookup — it only checks that the path stays inside the root and that the extension maps to a known MIME type — so with the root set to
the working directory any file in the application checkout with a recognised
extension was readable without authentication. `.env`, `.env.local` and
`*.sqlite3` happen not to map to a MIME type, but that is not an all-clear;
plenty of secret-bearing files do — a legacy root `config.json` (which on
older instances held the whole configuration; S3 credentials were never in it —
those come from the AWS SDK chain), `backups/production-archives/*.tar.gz`
and `backups/actor-archives/*.tar.gz` (the backup scripts' default outputs: a
full database/media archive, and one account's full ActivityPub archive —
every status regardless of visibility, media, fitness files, likes, bookmarks
and follows), key material (`.p8`, the Apple Maps signing key, `.pem`, `.crt`,
`.p12`, `.pfx`),
and `.conf`, `.ini`, `.toml`, `.txt` plus source files. Audit what was sitting
in the application directory and rotate anything reachable, rather than
assuming only source code leaked.

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

> Upgrade note: An instance that was running with a **blank** required storage
> variable (most likely `ACTIVITIES_MEDIA_STORAGE_TYPE=fs` with an empty
> `ACTIVITIES_MEDIA_STORAGE_PATH=`) had a working-looking media backend rooted
> at the process working directory. That configuration now disables media and
> fitness storage: uploads stop, every existing media URL serves the "media
> removed" placeholder, and the boot warnings (`… is set but empty; …
storage will be disabled`) name the variable — grep for `is set but empty`
> after upgrading. To recover, set a real path and
> move the loose stored files into it — they sit in the directory the app was
> started from, named `<16 hex characters><extension>`: images (`.webp`),
> thumbnails (`-thumbnail.webp`), email JPEGs (`.jpg`), videos
> (`.mp4`/`.webm`), plus
> `./uploads/fitness/` into `<new path>/fitness/` (fitness files were not
> loose — the fallback defaulted the empty path to `uploads`, and skipping the
> move loses every `.fit`/`.gpx`/`.tcx` and imported Strava `.zip`; route maps
> go through media
> storage and are among the loose files). Set the path even if you do not want
> media storage: leaving the `ACTIVITIES_MEDIA_STORAGE_*` variables unset
> entirely is the supported way to turn uploads off.

## Fitness File Storage

For fitness activity file uploads (.fit, .gpx, .tcx). Falls back to media storage configuration if not set.

The `ACTIVITIES_FITNESS_STORAGE_*` value variables follow the same rule as
their media counterparts: whitespace is trimmed, and a **set but empty** value
disables fitness storage with a warning rather than starting a broken backend.
Setting `ACTIVITIES_FITNESS_STORAGE_TYPE` to a **non-empty** value opts out of
the media-storage fallback (an empty `ACTIVITIES_FITNESS_STORAGE_TYPE=` still
selects the fallback, exactly as leaving it unset does); a set-but-unusable
type disables fitness storage
with a warning naming the variable rather than quietly writing fitness files
into the media bucket. See
[Fitness File Storage](fitness-file-storage.md#configuration) for the
fallback and blank-value rules in detail.

| Variable                                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_FITNESS_STORAGE_TYPE`                            | Storage backend: `fs`, `s3`, or `object`.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ACTIVITIES_FITNESS_STORAGE_PATH`                            | Local filesystem path for `fs` storage; required when `ACTIVITIES_FITNESS_STORAGE_TYPE=fs` (no default). When fitness storage is not explicitly configured and media storage is `fs`, files fall back to `<ACTIVITIES_MEDIA_STORAGE_PATH>/fitness` and this variable is ignored.                                                                                                                                                                                                                |
| `ACTIVITIES_FITNESS_STORAGE_BUCKET`                          | S3 bucket name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ACTIVITIES_FITNESS_STORAGE_REGION`                          | S3 region.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ACTIVITIES_FITNESS_STORAGE_HOSTNAME`                        | Public fitness file hostname/CDN; not used for S3 API operations. Inherits `ACTIVITIES_MEDIA_STORAGE_HOSTNAME` through the fallback when fitness storage is not explicitly configured; when explicit and unset, files are served through the app.                                                                                                                                                                                                                                               |
| `ACTIVITIES_FITNESS_STORAGE_ENDPOINT`                        | S3-compatible API endpoint for storage operations and browser presigned uploads; set for non-AWS S3-compatible providers, else the AWS SDK uses the standard endpoint for the region. Inherits `ACTIVITIES_MEDIA_STORAGE_ENDPOINT` through the fallback when fitness storage is not explicitly configured.                                                                                                                                                                                      |
| `ACTIVITIES_FITNESS_STORAGE_PREFIX`                          | S3 key prefix (default: `fitness/`).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE`                   | Maximum file size in bytes (default: 50 MiB / `52428800`).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT`               | Override for the shared per-account media + fitness storage quota in bytes; takes precedence over `ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT` for both quota checks, else the media quota or quota service default applies.                                                                                                                                                                                                                                                                    |
| `ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN`                     | Mapbox API token for map rendering; required when `ACTIVITIES_FITNESS_MAP_PROVIDER=mapbox` (an empty token falls back to `osm`), and it selects `mapbox` when the provider is unset or unknown. Only public `pk.*` tokens are passed to browser maps; secret `sk.*` tokens stay server-side and the browser falls back to `osm`.                                                                                                                                                                |
| `ACTIVITIES_FITNESS_MAP_PROVIDER`                            | Fitness map provider: `apple`, `mapbox`, or `osm`. Missing credentials for the selected provider fall back to keyless `osm`; when unset or unknown, the provider is inferred (`mapbox` if a Mapbox token is set, else `osm`). Changing it requires an app restart; see [Fitness map provider](#fitness-map-provider) below.                                                                                                                                                                     |
| `ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID`                      | Apple Developer team ID used to sign Apple Maps (MapKit JS) tokens. Required when `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`; a blank team ID, key ID, or private key falls back to `osm`.                                                                                                                                                                                                                                                                                                         |
| `ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID`                       | Apple MapKit JS key ID (Key ID of the MapKit private key). Required when `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`; a blank team ID, key ID, or private key falls back to `osm`.                                                                                                                                                                                                                                                                                                                  |
| `ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY`                  | Apple MapKit JS private key (PEM); a single-line `\n`-escaped PEM is accepted and expanded into a real multi-line key. Required when `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`; a blank team ID, key ID, or private key falls back to `osm`.                                                                                                                                                                                                                                                      |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES`       | Worker heap budget before route-cache accumulation is downsampled (default: 512 MB).                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT`  | Maximum in-memory route points before accumulation is downsampled (default: 160,000).                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_FILE_POINT_LIMIT`          | Maximum points retained from one parsed fitness file before privacy trimming (default: 80,000). The trim's along-route distance is measured on the already-decimated track, so it under-estimates true route length and trims slightly more, never less.                                                                                                                                                                                                                                        |
| `ACTIVITIES_FITNESS_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS` | Finest Ramer–Douglas–Peucker tolerance (meters) applied to each route before accumulation and to the final stored payload (default: 1): straight stretches collapse toward their endpoints while bends keep road-following detail. Smaller = higher fidelity and larger payloads; it is the floor that dense regions are adaptively coarsened from to fit the point budget without corner-cutting, and also the floor under each zoom's own one-pixel tolerance when the tile pyramid is built. |

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
provider and its basemap. Run **Regenerate maps for old statuses** on the
fitness privacy page (`/fitness/privacy`) after switching providers or changing
the basemap to re-render them; see
[Apple Maps Basemap](fitness-file-storage.md#apple-maps-basemap).

## Account Import

The owner-only importer of an account archive (a Mastodon archive or this
server's own export) into the current profile.

| Variable                                  | Description                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE` | Maximum archive upload size in bytes (default: 10 GiB / `10737418240`). The value is parsed as a base-10 integer; a non-finite or non-positive parsed value falls back to the default with a warning. |

## Queue (Background Jobs)

For asynchronous processing of ActivityPub delivery, file processing, etc.

| Variable                                      | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_QUEUE_TYPE`                       | Queue backend: `database`, `qstash`, or `cloudtasks`.                                                                                                                                                                                                                                                                                                                                                 |
| `ACTIVITIES_QUEUE_DATABASE_MAX_RETRIES`       | Maximum retry attempts for database queue tasks using polynomial backoff before capturing failed task in dead letter queue (default 16).                                                                                                                                                                                                                                                              |
| `ACTIVITIES_QUEUE_DATABASE_POLL_INTERVAL_MS`  | Polling interval in milliseconds for the in-process database queue runner (default 1000).                                                                                                                                                                                                                                                                                                             |
| `ACTIVITIES_QUEUE_URL`                        | Full callback endpoint URL of this instance's queue handler, e.g. `https://your-domain.tld/api/v1/queue/qstash` or `https://your-domain.tld/api/v1/queue/cloudtasks`. The queue backend delivers job messages to exactly this URL — it is not a base URL. For Cloud Tasks, this also serves as the default audience for OIDC token verification when `ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE` is unset. |
| `ACTIVITIES_QUEUE_NAME`                       | Queue name for Cloud Tasks (e.g. `activities-prod-queue`).                                                                                                                                                                                                                                                                                                                                            |
| `ACTIVITIES_QUEUE_TOKEN`                      | QStash API token.                                                                                                                                                                                                                                                                                                                                                                                     |
| `ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY`        | QStash current signing key (for webhook verification).                                                                                                                                                                                                                                                                                                                                                |
| `ACTIVITIES_QUEUE_NEXT_SIGNING_KEY`           | QStash next signing key (for key rotation).                                                                                                                                                                                                                                                                                                                                                           |
| `ACTIVITIES_QUEUE_QSTASH_MAX_RETRIES`         | Maximum retry attempts before delivering failed task to QStash DLQ (default 3).                                                                                                                                                                                                                                                                                                                       |
| `ACTIVITIES_QUEUE_CLOUDTASKS_LOCATION`        | Google Cloud location/region for Cloud Tasks (default `europe-west1`).                                                                                                                                                                                                                                                                                                                                |
| `ACTIVITIES_QUEUE_CLOUDTASKS_PROJECT_ID`      | Google Cloud project ID for Cloud Tasks (falls back to `FIREBASE_PROJECT_ID` or default credentials project if unset).                                                                                                                                                                                                                                                                                |
| `ACTIVITIES_QUEUE_CLOUDTASKS_SERVICE_ACCOUNT` | Authorized Google Cloud service account email for Cloud Tasks OIDC authentication. Required for OIDC verification; an audience alone never authorizes requests.                                                                                                                                                                                                                                       |
| `ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE`        | Expected audience for Cloud Tasks OIDC token verification (falls back to `ACTIVITIES_QUEUE_URL` if unset).                                                                                                                                                                                                                                                                                            |
| `ACTIVITIES_QUEUE_CLOUDTASKS_SECRET`          | Pre-shared webhook secret for Cloud Tasks endpoint authentication (`Authorization: Bearer <secret>`, `x-cloudtasks-secret`, or `x-cloudtasks-token`).                                                                                                                                                                                                                                                 |
| `ACTIVITIES_QUEUE_CLOUDTASKS_MAX_RETRIES`     | Maximum retry attempts before capturing failed task in dead letter queue (default 5).                                                                                                                                                                                                                                                                                                                 |

## Push Notifications

| Variable                            | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `ACTIVITIES_PUSH_VAPID_PUBLIC_KEY`  | VAPID public key for Web Push.           |
| `ACTIVITIES_PUSH_VAPID_PRIVATE_KEY` | VAPID private key for Web Push.          |
| `ACTIVITIES_PUSH_VAPID_EMAIL`       | VAPID contact email, often `mailto:...`. |

## Domain Controls

| Variable                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_ALLOW_MEDIA_DOMAINS`        | Optional JSON array of additional service-owned media origins allowed by runtime `img-src` and `media-src` CSP — for media this service creates and serves from public domains/CDNs not covered by the media storage hostname. Additive; does not restrict browser-loaded federated remote media.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS` | Optional JSON array of remote media origins allowed by runtime `img-src` and `media-src` CSP for browser-loaded federated status images, avatars, emoji, video and audio; enforced at request time (Next image optimization is disabled and remote image patterns are build-time static, so not during `next build`). Unset or blank means broad HTTPS browser loading; when set, broad `https:` is replaced by the configured origins (`[]` blocks all federated remote media). Federated media only — `img-src` always keeps `https://i.ytimg.com`, the fixed thumbnail host of the click-to-play YouTube player in link preview cards (a first-party feature's host, not a remote origin an operator is choosing to trust).                                                                                                                                                                                               |
| `ACTIVITIES_ALLOW_ACTOR_DOMAINS`        | JSON array of the domains actors may be created on (pins the admin-editable `federation.allowActorDomains` setting). When non-empty it is the whole list, so include `ACTIVITIES_HOST` if actors should still be created there; only concrete entries approve an actor domain — a `*.example.com` entry approves nothing and never appears as a choice (a wildcard-only list does not fall back), though every entry, wildcards included, is exempt from domain blocks and `allowlist` mode. When empty, actors may be created on `ACTIVITIES_HOST`, a concrete `ACTIVITIES_TRUSTED_HOSTS` entry, or an on served domain with "Existing users can add profiles here" — never on a subdomain a wildcard covers. Matched case-insensitively, ignoring a trailing dot. It does NOT make a domain one of this server's own for search, quotes, forwarding or reactions: see [Which domains are local](#which-domains-are-local). |
| `ACTIVITIES_FEDERATION_MODE`            | Federation mode: `open` (default) federates with every domain that is not blocked; `allowlist` federates only with domains added as domain allows (Admin › Federation). `ACTIVITIES_ALLOW_ACTOR_DOMAINS` entries are this server's own actor domains, not that allowlist, though they are exempt from federation policy too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ACTIVITIES_ENABLE_INBOX_FORWARDING`    | Enable ActivityPub Outbound Inbox Forwarding (W3C ActivityPub §7.1.2) to fan out verified public replies and mentions targeting local users to their remote followers (`true` or `false`, default: `false`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ACTIVITIES_TRUSTED_HOSTS`              | JSON array of additional public hosts this server answers on, accepted from `X-Forwarded-Host` and `X-Activity-Next-Host`. Entries may be `*.example.com` wildcards. A concrete entry is one of this server's own domains, and when `ACTIVITIES_ALLOW_ACTOR_DOMAINS` is empty, actors may be created on it; a wildcard entry is neither (see [Which domains are local](#which-domains-are-local)). Sign-up on a concrete entry is closed until an admin opens it in Admin › Served domains.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Which domains are local

Two related lists answer two different questions.

**Served domains** — "is this domain this server?" — are `ACTIVITIES_HOST`,
every **concrete** `ACTIVITIES_TRUSTED_HOSTS` entry, and every domain an admin
added and turned on in **Admin › Served domains** (`createServedDomainMatcher` in
`lib/utils/host.ts`, resolved per request by `isLocalDomain` /
`getLocalDomainMatcher` in `lib/services/domains/localDomains.ts`). A domain
added in Admin › Served domains is trusted for `X-Forwarded-Host`, sign-in and
federation only while it is on. Turning it off takes effect at once in the
server process that handled the change. Other processes re-read the list every
30 seconds, so they stop trusting it within about 30 seconds. If a process
cannot read the list, it keeps the last one for up to five minutes, then trusts
none of these domains. Hosts are compared case-insensitively,
after IDNA mapping and without a trailing dot or a default port; a different
port is a different host. Account search, lookup and v2 search, inbound quote
requests, inbox forwarding, emoji reactions, remote status actions (favourite,
reblog, bookmark, react) and the forwarded-activity and relay-announce
self-echo guards use it: a served domain is not WebFingered as
if it were remote, never receives forwarded activities, and an actor on it
reacts with this server's own custom emoji. A **wildcard** trusted host
(`*.vercel.app`, say) is not a served domain: it exists so `X-Forwarded-Host`
can be believed on preview deployments, and it does not claim every subdomain
under it as this server.

**The federation-policy exemption** is the served domains plus every
`federation.allowActorDomains` entry (`ACTIVITIES_ALLOW_ACTOR_DOMAINS`, or the
admin setting when that is unset), its `*.example.com` wildcards included —
which match their subdomains but not `example.com` itself. A domain in it skips
domain blocks and `allowlist` mode. `federation.allowActorDomains` is kept out
of the served domains on purpose: in `allowlist` mode the admin Federation form
presents it as the allowed servers, so it can hold remote servers. Callers that
still use `isLocalFederationDomain` (served domains plus
`allowActorDomains`) — `lib/services/actors/resolveAccountTarget.ts`,
`lib/services/quotes/fetchQuoteTargetForCreate.ts`,
`lib/services/quotes/persistInboundQuoteEdge.ts`,
`lib/services/statuses/fetchEphemeralRemoteStatus.ts`,
`app/(timeline)/[actor]/resolveActorRedirect.ts` and
`lib/activities/confirmActorHandle.ts` — keep treating a remote server listed
there as local until a planned database-backed domain list replaces
`allowActorDomains`.

Neither list is trusted for anything else: inbound activities from them are
still signature-checked like any other. Only list hosts you control.

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

### Browser Web Vitals

Optional and off by default. When on, a sample of page loads reports Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS) and Interaction to Next Paint (INP) to `POST /api/v1/web-vitals`, which writes one structured log line per metric. Nothing is stored and nothing is sent to a third party; the numbers only aggregate if you run a log pipeline over the server's stdout (for example a Cloud Logging log-based metric). See [Browser Web Vitals](architecture.md#browser-web-vitals) for what is collected and how to build a p75 chart.

| Variable                                       | Description                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITIES_WEB_VITALS_SAMPLE_RATE`            | Share of page loads that report, a number from `0` (off, the default) to `1` (every page load). Each page load decides once. An invalid value turns reporting off.                                                                                                                                                    |
| `ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE` | Per-process cap on same-origin report requests per fixed one-minute window, valid or not, an integer from `1` to `1000000` (default `600`). Requests over the cap are answered `202` without being read or logged, and each process logs at most one warning per clock minute. An invalid value restores the default. |

Invalid Web Vitals settings log one warning per process in total. Both are read at request time, so changing them needs a restart but no rebuild. The prerendered 404 page uses the value from build time, normally off, so it is not sampled; the global-error page renders its own document and never reports.

API route spans (`traceApiRoute`) record `url.path` as the route template — every dynamic segment replaced by its parameter name, e.g. `/api/v1/webhooks/strava/[webhookToken]` — and `url.query` with the values of credential-like parameters replaced by `REDACTED`, capped at 2048 characters. A parameter name is lowercased and split on `.`, `_`, `-` and brackets, and redacted when any part is exactly one of `code`, `state`, `token`, `secret`, `key`, `password`, `nonce`, `otp`, `sig`, `signature`, `assertion`, `email` or `verifier` — so `access_token`, `hub.verify_token`, `client_secret` and `code_verifier` are caught, but a camelCase name such as `accessToken` is not. Some routes carry a credential in the path or query, and spans leave the process through whatever exporter is attached, so a route that needs a concrete id on its span adds it explicitly through `addAttributes`.

## Build & Runtime

| Variable                  | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`                | Node.js environment (`development` or `production`).                 |
| `BUILD_STANDALONE`        | Set to `true` to build a standalone Next.js output (used in Docker). |
| `NEXT_TELEMETRY_DISABLED` | Set to `1` to disable Next.js telemetry.                             |
