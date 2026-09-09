# Activity.next Setup Guide

This guide provides an overview of how to set up Activity.next for development or production.

> **Just want to try it locally?** See the [Quickstart](quickstart.md) for the
> fastest minimal setup (SQLite and the three core settings: host, secret
> phrase, and a database). This guide covers the full set of configuration
> options.

## Prerequisites

- **Node.js 24** (the repo pins `engines.node` to `24.x`)
- **Yarn 4** package manager via Corepack (the exact version is pinned by the `packageManager` field in `package.json`)
- **Git** (to clone the repository)
- A **domain name** (required for federation with other servers)

## Database Setup

Activity.next supports multiple SQL database backends. Choose the one that best suits your needs:

- [SQLite Setup Guide](sqlite-setup.md) — Best for development or small instances
- [PostgreSQL Setup Guide](postgresql-setup.md) — Recommended for production deployments
- MySQL-compatible Knex configuration paths — Listed in the [Environment Variables Guide](environment-variables.md) for deployments that provide the needed driver/runtime support

## General Configuration

Activity.next is configured through environment variables prefixed with `ACTIVITIES_`. Top-level options use `ACTIVITIES_<KEY>` (e.g., `ACTIVITIES_HOST`); nested options use `ACTIVITIES_<SECTION>_<KEY>` (e.g., `ACTIVITIES_DATABASE_PG_HOST`).

For a complete reference of all configuration options, see the [Environment Variables Guide](environment-variables.md).

### Required Configuration

At minimum, you need to configure these settings:

#### Domain Name

Set your instance's domain name (without protocol or trailing slash):

```bash
ACTIVITIES_HOST=your-domain.tld
```

#### Authentication Secret

Set a secret phrase for signing cookies and tokens:

```bash
# Generate with: openssl rand -base64 32
ACTIVITIES_SECRET_PHASE=your-random-secret-for-sessions
```

> **Note:** The production runtime rejects an `ACTIVITIES_SECRET_PHASE` shorter than 32 characters.

### Access Control

Restrict who can sign up to your instance by specifying allowed email addresses:

```bash
ACTIVITIES_ALLOW_EMAILS='["your_email@example.com"]'
```

> **Tip:** If `allowEmails` is set, only users with matching email addresses can register. This is recommended for personal or small-group instances.

### Authentication Methods

Activity.next uses [better-auth](https://www.better-auth.com/) for authentication and supports local email/password accounts, passkeys, and two-factor authentication.

### Media Storage (Optional)

By default, media files are not stored (uploads are disabled). To enable media uploads, configure a storage backend:

#### Local Filesystem

```bash
ACTIVITIES_MEDIA_STORAGE_TYPE=fs
ACTIVITIES_MEDIA_STORAGE_PATH=./uploads
```

#### S3 / S3-Compatible Object Storage

```bash
ACTIVITIES_MEDIA_STORAGE_TYPE=s3          # or 'object' for S3-compatible
ACTIVITIES_MEDIA_STORAGE_BUCKET=my-bucket
ACTIVITIES_MEDIA_STORAGE_REGION=us-east-1
# Optional: public CDN/custom domain used to serve media files
ACTIVITIES_MEDIA_STORAGE_HOSTNAME=media.example.com
# Optional: S3-compatible API endpoint for uploads/storage operations
ACTIVITIES_MEDIA_STORAGE_ENDPOINT=https://s3.example.com
```

Optional storage limits:

```bash
ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE=209715200       # 200 MiB in bytes
ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT=1073741824  # 1 GiB in bytes
```

### Email Configuration (Optional)

Email is optional. Leave the email variables unset when the instance should not
send account verification or notification messages. When email is configured,
notification delivery is best effort: errors are logged, with no durable
retries or delivery-status tracking.

The supported providers are SMTP, Resend, and AWS SES. If an explicit provider
value is unknown, including the removed `lambda` value, configuration fails
instead of silently disabling email. Before upgrading an instance that used
Lambda, migrate its configuration to one of the retained providers and remove
the Lambda-specific variables. No replacement provider is selected
automatically. See the [Environment Variables Guide](environment-variables.md#email)
for JSON precedence, malformed-JSON fallback behavior, and the requirement that
individual email variables include `ACTIVITIES_EMAIL_TYPE`.

#### SMTP

```bash
ACTIVITIES_EMAIL_TYPE=smtp
ACTIVITIES_EMAIL_FROM=noreply@your-domain.tld
ACTIVITIES_EMAIL_SMTP_HOST=smtp.example.com
ACTIVITIES_EMAIL_SMTP_PORT=587
ACTIVITIES_EMAIL_SMTP_USER=your-username
ACTIVITIES_EMAIL_SMTP_PASSWORD=your-password
ACTIVITIES_EMAIL_SMTP_SECURE=false
```

#### Resend

```bash
ACTIVITIES_EMAIL_TYPE=resend
ACTIVITIES_EMAIL_FROM=noreply@your-domain.tld
ACTIVITIES_EMAIL_RESEND_TOKEN=re_xxxxxxxxxxxx
```

#### AWS SES

```bash
ACTIVITIES_EMAIL_TYPE=ses
ACTIVITIES_EMAIL_FROM=noreply@your-domain.tld
ACTIVITIES_EMAIL_SES_REGION=us-east-1
```

### Queue Configuration (Optional)

Background jobs (sending ActivityPub activities, processing uploads) use a queue. Without a queue configured, jobs run synchronously.

> **Note:** Client libraries for queue providers (`@upstash/qstash` and `@google-cloud/tasks`) are optional dependencies packaged as Yarn workspaces (`@activities/qstash` and `@activities/cloudtasks`). They are dynamically imported when the respective queue is enabled.

#### Upstash QStash

```bash
ACTIVITIES_QUEUE_TYPE=qstash
ACTIVITIES_QUEUE_URL=https://your-domain.tld/api/v1/queue/qstash
ACTIVITIES_QUEUE_TOKEN=your-qstash-token
ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY=your-signing-key
ACTIVITIES_QUEUE_NEXT_SIGNING_KEY=your-next-signing-key
```

#### Google Cloud Tasks

```bash
ACTIVITIES_QUEUE_TYPE=cloudtasks
ACTIVITIES_QUEUE_NAME=activities-queue
ACTIVITIES_QUEUE_URL=https://your-domain.tld/api/v1/queue/cloudtasks
ACTIVITIES_QUEUE_CLOUDTASKS_LOCATION=europe-west1
ACTIVITIES_QUEUE_CLOUDTASKS_PROJECT_ID=your-gcp-project-id
# Optional authentication:
ACTIVITIES_QUEUE_CLOUDTASKS_SERVICE_ACCOUNT=service-account@project.iam.gserviceaccount.com
ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE=https://your-domain.tld
ACTIVITIES_QUEUE_CLOUDTASKS_SECRET=your-shared-webhook-secret
```

### Push Notifications (Optional)

Web push notifications require a VAPID key pair:

```bash
ACTIVITIES_PUSH_VAPID_PUBLIC_KEY=your-public-key
ACTIVITIES_PUSH_VAPID_PRIVATE_KEY=your-private-key
ACTIVITIES_PUSH_VAPID_EMAIL=mailto:admin@your-domain.tld
```

## Starting the Application

### Development Environment

To run the service locally:

```bash
yarn dev
```

The app will be available at `http://localhost:3000`.

To communicate with other servers in the Fediverse while running locally, you'll need a tunnel service to expose your local server to the internet:

1. Set up a tunnel using [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) or [ngrok](https://ngrok.com/)
2. Point the tunnel to `localhost:3000`
3. Use your tunnel's domain as the `host` in your configuration

### First-Time Setup

After starting the application:

1. Navigate to `https://your-domain.tld/auth/signup` (your email must be in the allow list)
2. Create your account with email and password
3. Log in and start interacting with the Fediverse

## Deployment Options

### Vercel Deployment

To deploy on Vercel:

1. Fork this repository
2. Connect it to your Vercel account
3. Add the required environment variables (see [Environment Variables Guide](environment-variables.md))

> **Note:** Vercel deployments require an external PostgreSQL database and S3-compatible storage since Vercel has no persistent filesystem.

### Docker Deployment

Activity.next provides official minimal Docker images at `ghcr.io/llun/activities.next:main` (the image is published with the `main` tag; there is no `latest` tag). The official image includes only the core application and SQLite dependencies to keep the image slim.

Basic Docker run command (uses SQLite by default):

```bash
docker run -p 3000:3000 \
  -e ACTIVITIES_HOST=your.domain.tld \
  -e ACTIVITIES_SECRET_PHASE=change-me-to-a-random-secret-at-least-32-chars \
  -e ACTIVITIES_DATABASE_SQLITE_FILENAME=/opt/activities.next/data/data.sqlite \
  -e ACTIVITIES_MEDIA_STORAGE_TYPE=fs \
  -e ACTIVITIES_MEDIA_STORAGE_PATH=/opt/activities.next/data/uploads \
  -v /path/to/local/storage:/opt/activities.next/data \
  ghcr.io/llun/activities.next:main
```

> **Important:** Mount persistent data under `/opt/activities.next/data` as above — do **not** bind-mount `/opt/activities.next` itself. That directory contains the application (the standalone `server.js`, static assets, etc.), so a host-path mount would shadow it and the container cannot start. See the [SQLite Docker guide](sqlite-setup.md#docker-deployment-with-sqlite) for preparing the mounted database file.

#### Custom Docker Builds with Optional Workspaces

Optional dependencies (such as PostgreSQL, Cloud Tasks, and QStash) are isolated in Yarn workspaces under `packages/`:

- `@activities/pg` — PostgreSQL driver (`pg`)
- `@activities/cloudtasks` — Google Cloud Tasks client (`@google-cloud/tasks`)
- `@activities/qstash` — Upstash QStash client (`@upstash/qstash`)

To include optional workspaces when building a Docker container, pass the `WORKSPACES` build argument:

```bash
# Example: Build with PostgreSQL and QStash support
docker build --build-arg WORKSPACES="activities.next @activities/pg @activities/qstash" -t activities.next:custom .

# Example: Build with all optional workspaces
docker build --build-arg WORKSPACES="activities.next @activities/pg @activities/cloudtasks @activities/qstash" -t activities.next:full .
```

To verify built Docker images locally:

```bash
node scripts/run.cjs scripts/maintenance/verifyDockerImages.ts
```

For database-specific Docker deployment instructions:

- [SQLite Docker Deployment](sqlite-setup.md#docker-deployment-with-sqlite)
- [PostgreSQL Docker Deployment](postgresql-setup.md#docker-deployment-with-postgresql)

### Public Endpoint Protection

Public fitness route-data responses are cacheable for 60 seconds when the source status is public or unlisted and the request is anonymous. Self-hosted deployments that expose public fitness route data should put Activity.next behind an upstream cache and rate limiter, such as nginx `limit_req`, Cloudflare, or an equivalent reverse proxy rule for `/api/v1/fitness-files/*/route-data`. The application does not keep process-local anonymous rate-limit buckets for this endpoint because client IP headers are deployment-specific, spoofable unless normalized by a trusted proxy, and not shared across serverless instances.

---

## Contributor rules

Read the applicable rules and review checks below before changing this subsystem. The mandatory workflow remains in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

- [Build, Test, and Development Commands](#agents-build-test-and-development-commands)
- [Database Backends & Local Setup](#agents-database-backends-local-setup)

<a id="agents-build-test-and-development-commands"></a>

### Build, Test, and Development Commands

- **Agents:** MUST use Node.js version 24 for running any node commands in this project.
- **Always use `yarn` for all package management.** Never use `npm install`, `npm ci`, or any other `npm` commands to install or manage packages.
- **Optional dependencies are modularized into Yarn workspaces (`packages/*`).** External database drivers and queue SDKs (`pg`, `@google-cloud/tasks`, `@upstash/qstash`) live in isolated packages (`@activities/pg`, `@activities/cloudtasks`, `@activities/qstash`). `yarn install` at the repo root installs all workspaces by default for development and test execution. The Dockerfile builds minimal images using `yarn workspaces focus ${WORKSPACES}` (defaulting to `activities.next`), and core code imports optional modules dynamically (`dynamicImport` / dynamic `import()`) with type stubs in `lib/types/optional-modules.d.ts` so the application runs without optional packages installed when those features are unconfigured.
- `yarn dev` runs the local Next.js development server. The package script binds Next.js to `0.0.0.0`, so the dev server is reachable from the local network — only run it on trusted networks.
- `yarn build` builds the production app; `yarn start` serves it.
- `yarn lint` runs **Oxlint** over the app and lib code, then a **second** pass, `oxlint -c .oxlintrc.scripts.json scripts`. `.oxlintrc.json` ignores `scripts/**`, `migrations/**`, `plans/**`, and `*.config.*` files; the second pass exists because exactly one rule has to reach the otherwise-unlinted scripts tree (see **A stored path is confined to the storage root**), and keeping it to one rule is what avoids putting the whole rule set onto files that have never satisfied it. Several AGENTS.md conventions are **lint-enforced**: no `console.*`, no `../` imports, no `Response.json()`/`NextResponse.json()` or Zod `.parse()` in `app/api` routes (`agents/api-response-helpers`, `agents/zod-safe-parse`), no direct `fetch()` in component files (`agents/no-component-fetch`, whose `allowFiles` option in `.oxlintrc.json` is a frozen legacy-offender list — never add a file to it; shrink it by migrating callers to `lib/client.ts`), no `path.resolve`/`path.join` in a local storage driver (`agents/no-storage-path-builder`), and no `startsWith` against a resolved path anywhere (`agents/no-resolved-path-prefix-check`). Those five `agents/*` rules are a local Oxlint JS plugin, `lint/agentsRules.mjs`, because Oxlint has no `no-restricted-syntax`; `lint/agentsRules.test.ts` runs the linter against fixtures so an Oxlint upgrade that stopped loading the plugin fails `yarn test` instead of silently un-enforcing them, and also runs the repo's own configs over fixtures so a rule that stopped being pointed at anything fails too. Reach for a rule there rather than a raw-text Vitest scan whenever the convention depends on what a NAME refers to — aliases, destructuring, renamed imports — which a text scan decides wrongly in both directions. Suppress one line with `// oxlint-disable-next-line <rule>` (the `eslint-disable-next-line` spelling still works), but note Oxlint does **not** honor `/* global … */` block directives — declare globals in `.oxlintrc.json` instead, as the `public/sw.js` override does. That override carries more weight than it looks: the service worker is a static asset in **no** tsconfig and imported by nothing, so lint is the only thing that reads it at all — and `no-undef` is its only check for an undeclared global, which is what a typo there looks like. The no-env-reads-outside-`lib/config/` rule is enforced by `lib/config/envAccess.test.ts`; every `ACTIVITIES_*`/`OTEL_*` variable read in `lib/config/` must have a row in `docs/environment-variables.md` (`lib/config/envDocumentation.test.ts` fails otherwise); and server-only trees must not import a runtime value from a `'use client'` module (`lib/clientModuleBoundary.test.ts` — see **Server/Client Module Boundary**). Three more repo-wide guards live as tests: `next.config.test.ts` (the build config must not consume runtime deployment values), `app/globals.contrast.test.ts` (the WCAG contrast floor), and `lib/components/tailwindCssVariableSyntax.test.ts` (see **Tailwind CSS variables** below). The remaining conventions in this file are review-enforced.
- `yarn test` runs the full Vitest suite (all tests run in parallel with SQLite in-memory databases).
- **`yarn typecheck` type-checks the whole project; `yarn build` type-checks everything except tests.** TypeScript 7 has no compiler API, so `next build` type-checks by running the `tsc` CLI (`experimental.useTypeScriptCli`), which checks every file its tsconfig includes rather than only the app's module graph — the build therefore reads `tsconfig.build.json` (inherits `tsconfig.json`, drops `*.test.ts(x)`) and catches type errors in `scripts/` and in unimported `lib/` modules, which the old checker missed. `yarn typecheck` runs `tsc --noEmit` directly against `tsconfig.json` covering all files in the repository (production code, scripts, and all `*.test.ts(x)` files) with zero exclusions or ratchets. The base `exclude` drops `vitest.setup.ts` and `vitest-shims/`. And **silently**, TypeScript resolves a wildcard `include` to one extension per basename, so a `foo.test.tsx` sitting beside a `foo.test.ts` is dropped from every program while Vitest still runs it — a live test file no compiler reads, which is what `lib/utils/text/cleanClassName.test.tsx` was until it was renamed. `lib/testFileTypeCoverage.test.ts` guards that last one. `incremental` is `false` in every tsconfig on purpose: TypeScript 7.0's `tsc` serves stale diagnostics from `.tsbuildinfo` after a global `.d.ts` changes (the microsoft/typescript-go#4664 class of bug), and a full check takes ~2s.
- **TypeScript is on the `7.x` line — the native compiler, which ships a CLI and _no_ JavaScript compiler API** (`require('typescript')` exposes only `{ version }`; a new, different API is expected in 7.1). Nothing in the repo may depend on that API, which is why lint is **Oxlint** rather than ESLint + typescript-eslint (peer `<6.1.0`, and it throws on load under 7.x — [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)), `scripts/run.cjs` boots with **tsx** rather than `@swc-node/register` (peer `<7`), `lib/clientModuleBoundary.test.ts` parses with **`@swc/core`**, and `next build` type-checks through the **`tsc` CLI** (see the `yarn typecheck` bullet above). Two traps worth knowing before changing any of this: Next resolves the CLI from the package named `typescript` and needs its `bin.tsc`, so aliasing that package for a side-by-side TypeScript 6 install (`typescript: npm:@typescript/typescript6`) makes `next build` run `yarn add --dev typescript` itself and rewrite `package.json` mid-build; and TypeScript 7.0's `tsc` serves **stale diagnostics** from `.tsbuildinfo` after a global `.d.ts` changes (the microsoft/typescript-go#4664 class of bug), so `incremental` stays `false` everywhere. Type-aware lint rules were never enabled here; if they are ever wanted, the TypeScript 7-native route is `oxlint --type-aware` (tsgolint), not a return to typescript-eslint.
- `yarn migrate` applies Knex migrations; `yarn migrate:make <name>` creates a new migration. Migrations are ESM `.js` files with named `up`/`down` exports generated from `migration.stub` — always create them with `yarn migrate:make`; do not hand-write `.ts` or CommonJS migrations.
- **Local database is local-only.** For development and tests, use either **SQLite** on `localhost` (`ACTIVITIES_DATABASE_CLIENT=better-sqlite3` with a local `*.sqlite3` file, or the `ACTIVITIES_DATABASE` JSON equivalent) or the **PostgreSQL in the docker-compose stack at `activities.local`**. **Never run the dev server, migrations, or tests against a remote/shared/production database** (e.g. a non-local `ACTIVITIES_DATABASE_PG_HOST` such as `34.79.77.243`). Verify the resolved database target is local before migrating or starting the app. When working in a git worktree, do not copy a main-checkout `.env.local` that points at a remote DB; create a worktree-local SQLite config instead.
- **Creating test/mock users is allowed** for local verification (for example, to log in and check UI changes), but only against a local database as defined above — never against a remote/shared/production database.

<a id="agents-database-backends-local-setup"></a>

### Database Backends & Local Setup

- Supported backends: SQLite (`docs/sqlite-setup.md`) and PostgreSQL (`docs/postgresql-setup.md`). MySQL-compatible Knex configuration paths also exist and should not be broken casually.
- Local SQLite is the simplest for development; run `yarn migrate` after updating schema or migrations.

#### Keeping the reference schema dumps in sync

There are **two** committed reference schema dumps, one per supported backend.
Use the one that matches the database you are reasoning about:

- **`migrations/schema.sql`** — the **PostgreSQL** schema (a `pg_dump`). Use it when inspecting the schema for PostgreSQL deployments.
- **`migrations/schema.sqlite.sql`** — the **SQLite** schema (a `sqlite3 .schema` dump). Use it when inspecting the schema for SQLite — which is what local dev and the Vitest test suite use (tests run against in-memory SQLite). Because the two backends use different SQL dialects (e.g. `character varying`/`jsonb`/`timestamp with time zone` vs `varchar`/`json`/`datetime`), the Postgres dump cannot be loaded into SQLite and vice versa — always read the file for the right backend.

"In lockstep" means they describe the same migration set, **not** that every column has the same type in both. A migration may deliberately be backend-conditional, and then the dumps legitimately disagree: `20260207223000_fix_attachments_media_id_type.js` returns early unless the client is `pg`, so `attachments.mediaId` is `integer` on PostgreSQL and stays `varchar(255)` on SQLite. That is not drift — do not "reconcile" it or regenerate the dumps over it. Check the migration before treating a per-column difference as a bug.

The app (`yarn migrate`) runs Knex migrations, but the test suite does **not** — `lib/database/testUtils.ts` builds every test database directly from these dumps (see Testing Guidelines). If the dumps drift from the migrations, tests run against a stale schema, so keeping them in lockstep is load-bearing, not just hygiene. They are gitignored by the blanket `*.sql` rule and re-included by explicit `!` negations in `.gitignore`.

- **Any PR that adds, edits, or removes a Knex migration in `migrations/` MUST regenerate BOTH `migrations/schema.sql` and `migrations/schema.sqlite.sql` in the same PR.** Keep them in lockstep — they must always describe the same migration set. CI's **SQLite Schema Dump Sync** and **PostgreSQL Schema Dump Sync** jobs regenerate both reference dumps from the migrations on every push/PR and fail on drift.
- Regenerate them canonically rather than hand-editing — run every migration against a fresh database of each type and dump the result. In both cases verify `SELECT count(*) FROM knex_migrations` equals the number of `migrations/*.js` files first.

  Pass the DB settings **inline** on the `yarn migrate` line — do **not** write a `.env.local` (you'd clobber an existing one, and the cleanup would delete it). Because `knexfile.js` uses `dotenv-flow`, which never overrides variables already in the environment, inline values win over any `.env.local`; for the same reason, run in a shell with **no** other `ACTIVITIES_DATABASE*` vars exported (a stray one would be merged in and could target a remote DB — check `env | grep ACTIVITIES_DATABASE`).

  **PostgreSQL (`migrations/schema.sql`):**
  1. Start a **local** PostgreSQL 17 (e.g. a throwaway `postgres:17` Docker container, or the docker-compose stack) and wait until it accepts connections (`docker run -d` returns before `initdb` finishes; loop on `pg_isready`). Never point at a remote/shared/production DB.
  2. Run migrations with the settings inline: `ACTIVITIES_DATABASE_CLIENT=pg ACTIVITIES_DATABASE_PG_HOST=… ACTIVITIES_DATABASE_PG_PORT=… ACTIVITIES_DATABASE_PG_USER=… ACTIVITIES_DATABASE_PG_PASSWORD=… ACTIVITIES_DATABASE_PG_DATABASE=… yarn migrate`.
  3. Dump schema only, without ownership/grants: `pg_dump --schema-only --no-owner --no-privileges` (run it against the PG 17 server so the dump matches that version).
  4. Strip pg_dump's noise to match the existing pure-DDL file: the `\restrict`/`\unrestrict` session token (non-deterministic — never commit it), the `-- …` comment headers, and the `SET default_tablespace` / `SET default_table_access_method` lines. Keep the leading `SET`/`SELECT pg_catalog.set_config(...)` block and all `CREATE`/`ALTER` DDL.

  **SQLite (`migrations/schema.sqlite.sql`):**
  1. Run migrations against a throwaway file DB with the settings inline: `ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=./schema-dump.sqlite3 yarn migrate`.
  2. Dump the schema with `sqlite3 ./schema-dump.sqlite3 .schema`.
  3. Strip SQLite's auto-managed internal tables, which it recreates on its own and which must NOT be in the file: the `CREATE TABLE sqlite_sequence(...)` line, and the FTS5 shadow tables (`CREATE TABLE IF NOT EXISTS '<name>_fts_(data|idx|docsize|config|content)'`). Keep the `CREATE VIRTUAL TABLE … USING fts5(…)` statement and its triggers — those are real. A quick sanity check: `sqlite3 /tmp/x.sqlite3 < migrations/schema.sqlite.sql` should load cleanly.

  Then remove the throwaway container / `.sqlite3` file; only the two schema files should change.

- A Postgres regeneration is a full re-dump, so its diff can be large even for unchanged tables (formatting differs from older dumps). That is expected — do not try to reproduce the old line-by-line formatting by hand. Commit the schema regeneration as `none:` when it is the only change (they are reference artifacts and ship nothing).
- **Use only a local database for local dev/tests:** SQLite on `localhost`, or the docker-compose PostgreSQL at `activities.local`. Never connect local dev, tests, or user creation to a remote/shared/production database.
- Tests use isolated SQLite in-memory databases for fast, parallel execution.
- Docker users should persist data under `/opt/activities.next/data` (bind-mount a host directory there and point the SQLite/media env vars into it). Do **not** bind-mount `/opt/activities.next` itself — that directory contains the application (standalone `server.js`, `.next/static`, …), so a host-path mount shadows the app and the container cannot start (see `docs/setup.md` and the database setup guides).
