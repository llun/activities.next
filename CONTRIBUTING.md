# Contributing to Activities.next

Thank you for your interest in contributing to Activities.next! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)
- [Contributor workflow reference](#contributor-workflow-reference)

## Documentation and rule map

The root files are indexes into the durable guides:

- [AGENTS.md](AGENTS.md) contains the Definition of Done, cross-cutting conventions, and the required subsystem reading map.
- [REVIEW.md](REVIEW.md) is the actionable review checklist.
- [Architecture rules](docs/architecture.md), [Mastodon compatibility rules](docs/mastodon-api-compatibility.md), [fitness and storage rules](docs/fitness-file-storage.md), [maintenance rules](docs/maintenance.md), and the [setup guide](docs/setup.md) own subsystem detail.
- [Design library sync](#agents-design-library-sync) explains how design changes reach the Sketch library in `llun/sketch`.
- [Documentation maintenance](#agents-documentation-maintenance) explains how durable docs stay navigable and current.

These references complement AGENTS.md; they do not relax its mandatory core. Keep linked rules consistent when behavior changes.

## Code of Conduct

This project follows the standard open source code of conduct. Be respectful, inclusive, and considerate in all interactions.

## Getting Started

### Prerequisites

- **Node.js 24** (the `engines` field in `package.json` pins `24.x`)
- **Yarn 4** via Corepack (the exact version is pinned by the `packageManager` field in `package.json`)
- **Git**
- A code editor (VS Code recommended)

### Setting Up Development Environment

1. **Fork and clone the repository**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/activities.next.git
   cd activities.next
   ```

2. **Enable Corepack** (for Yarn 4 support):

   ```bash
   corepack enable
   ```

3. **Install dependencies**:

   ```bash
   yarn install
   ```

   > **Note:** `yarn install` at the repository root installs all workspaces (the core app plus optional packages under `packages/`), providing all database drivers and queue clients out of the box for development.

4. **Set up your environment**:

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your local configuration
   ```

   At minimum, set `ACTIVITIES_HOST`, `ACTIVITIES_SECRET_PHASE`, and a database configuration (e.g., `ACTIVITIES_DATABASE_CLIENT=better-sqlite3`).

5. **Run database migrations**:

   ```bash
   yarn migrate
   ```

6. **Start the development server**:

   ```bash
   yarn dev
   ```

7. **Open your browser** to [http://localhost:3000](http://localhost:3000)

## Development Workflow

### Branch Naming

Use descriptive branch names:

- `feature/description` - For new features
- `fix/description` - For bug fixes
- `docs/description` - For documentation changes
- `refactor/description` - For code refactoring

### Commit Messages

Follow conventional commit format:

- `feat: add new feature`
- `fix: resolve bug in component`
- `docs: update setup guide`
- `style: format code with prettier`
- `refactor: restructure database queries`
- `test: add tests for status model`
- `chore: update dependencies`

Keep commits:

- Small and focused
- With clear, descriptive messages
- Building on each other logically

## Coding Standards

### TypeScript

- **Use strict TypeScript**: Avoid `any` types — use proper types or `unknown`
- **Type everything**: Functions, parameters, and complex objects should have explicit types
- **Use TypeScript features**: Interfaces, type guards, utility types, etc.

### Code Style

The project uses:

- **Prettier** for formatting — the Husky pre-commit hook formats staged files automatically via `lint-staged` (`prettier --write` on the staged files, re-staged before the commit); CI enforces formatting with `yarn prettier:check`. `yarn run prettier --write .` still formats the whole tree manually
- **Oxlint** for linting — the pre-commit hook also runs `yarn lint` and blocks the commit on errors. In VS Code, use the `oxc.oxc-vscode` extension (the ESLint extension no longer applies). `yarn lint` runs Oxlint twice: once over the repo with `.oxlintrc.json`, then over `scripts/` — which the first pass ignores — with `.oxlintrc.scripts.json`, which enables one rule and is meant to stay that way
- **2-space indentation**
- **Single quotes**
- **No semicolons**

Run formatting and linting:

```bash
yarn run prettier --write .
yarn lint
```

### Import Conventions

- Use **absolute imports** (`@/lib/...`) for anything outside the current directory
- **Relative imports** (`./helper`) are only allowed for files in the same directory
- **Never** use `../` relative imports
- Apply the same rules to `vi.mock(...)` paths

### File Organization

- Place tests next to the code: `feature.ts` and `feature.test.ts`
- Follow existing directory structure

### Naming Conventions

- **Files**: camelCase for utilities, PascalCase for components
- **Variables/Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE for true constants
- **React Components**: PascalCase

### React Components

- Use functional components with hooks
- Prefer named exports for components
- Use TypeScript interfaces for props
- Keep components focused and single-purpose

Example:

```typescript
interface ProfileCardProps {
  actor: Actor
  isFollowing: boolean
  onFollow: () => void
}

export const ProfileCard: FC<ProfileCardProps> = ({
  actor,
  isFollowing,
  onFollow
}) => {
  // Component implementation
}
```

### Logging

- **Never** use `console.log`, `console.warn`, `console.error`, or any `console.*` methods in committed code
- Exception: Migration files in `migrations/` and scripts in `scripts/` may use `console.*`
- For server-side code, use the logger:

```typescript
import { logger } from '@/lib/utils/logger'

logger.info({ message: 'Something happened' })
logger.error({ message: 'Error occurred', error })
```

- **Do not** use logger in React components or client-side code

### API Responses

- Always use `apiResponse` and `apiErrorResponse` from `@/lib/utils/response`
- **Never** use `Response.json()` directly in API routes
- On CORS-enabled endpoints (those that export `OPTIONS`), always use `apiResponse` for error responses too, so CORS headers are included

```typescript
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'

// Success response (requires req and allowedMethods for CORS headers)
return apiResponse({ req, allowedMethods: ['GET'], data: result })

// Error response (non-CORS route)
return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
```

### Zod Validation

- **Always use `safeParse`**, never `.parse()`, in API routes — `.parse()` throws an unhandled `ZodError` that produces a 500 instead of a proper 4xx
- Add `.max(255)` to string schemas for `varchar(255)` database columns
- Normalize empty strings to `null` with `.transform((v) => v || null)` for nullable columns
- Keep create and update validation consistent (same normalization logic)

```typescript
const UpdateRequest = z.object({
  name: z
    .string()
    .trim()
    .max(255)
    .transform((v) => v || null)
})

const parsed = UpdateRequest.safeParse(json)
if (!parsed.success) {
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error: 'Invalid input' },
    responseStatusCode: 422
  })
}
```

### Settings Forms

- Settings forms (name, email, password, etc.) must be **client components** that submit JSON API calls through named exported functions in `lib/client.ts` — never call `fetch()` directly in a component
- Do **not** use plain HTML `<form method="post">` with server-side redirects — this breaks error feedback and can cause redirect bugs (307 re-POSTs instead of 303 GET)
- Manage state with `useState` and show inline success/error messages (the existing `Change*Form` components still call `fetch()` directly — a legacy pattern from before the `lib/client.ts` rule; do not copy it)

### Better-auth Plugins

- Do **not** register a better-auth plugin unless its required database tables exist in migrations
- The custom `knexAdapter` does not auto-create tables; missing tables cause runtime errors
- Admin/dashboard plugins (e.g. `dash()`) must have explicit access control configuration

## Testing

### Running Tests

```bash
# Run all tests (includes database tests with SQLite in-memory)
yarn test
```

The suite runs on [Vitest](https://vitest.dev/) (native ESM; use the `vi.*` API, e.g. `vi.fn()` / `vi.mock()` / `vi.importMock()` — there is no `jest` global). All tests run in parallel using isolated SQLite in-memory databases for fast execution.

### Running PostgreSQL Database Integration Tests

While the full test suite runs with SQLite in-memory databases for fast execution, database integration test suites can be executed against a local PostgreSQL 17 instance to verify cross-backend portability.

The backend-aware database test harness (`lib/database/testUtils.ts`) configures per-worker databases (`test_<VITEST_POOL_ID>`) dropped and migrated from `migrations/schema.sql`.

1. Start a local disposable PostgreSQL 17 container:

```bash
docker run --rm -d --name test-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=activities \
  -e POSTGRES_PASSWORD=activities \
  -e POSTGRES_DB=postgres \
  postgres:17
```

2. Run the PostgreSQL database test suites with bounded worker concurrency (e.g. `--maxWorkers=2` to avoid connection exhaustion):

```bash
TEST_DATABASE_TYPE=pg \
TEST_DATABASE_HOST=127.0.0.1 \
TEST_DATABASE_PORT=5432 \
TEST_DATABASE_USERNAME=activities \
TEST_DATABASE_PASSWORD=activities \
yarn test --maxWorkers=2 \
  lib/database/sql/media.test.ts \
  lib/database/sql/mediaDetails.test.ts \
  lib/database/sql/gallery.test.ts \
  lib/database/sql/galleryMedia.test.ts \
  lib/services/gallery/galleryQueries.test.ts \
  lib/services/gallery/galleryGear.test.ts \
  lib/services/gallery/subjectHashtags.test.ts \
  lib/services/gallery/uploadMediaDetails.test.ts \
  lib/database/sql/fitnessFile.test.ts \
  lib/database/sql/fitnessGear.test.ts \
  lib/database/sql/fitnessGearComponentPeriods.test.ts \
  lib/database/sql/fitnessRouteHeatmapTile.test.ts \
  lib/database/sql/queueJob.test.ts \
  lib/database/sql/statusDeletionQueue.test.ts \
  lib/database/sql/list.test.ts
```

3. When finished, stop the container:

```bash
docker stop test-postgres
```

### Writing Tests

- **Co-locate tests** with the code being tested
- **Use descriptive test names** that explain what is being tested
- **Follow AAA pattern**: Arrange, Act, Assert
- **Test behavior**, not implementation details

Example:

```typescript
describe('createNote', () => {
  it('creates a new status and adds it to timeline', async () => {
    // Arrange
    const actor = await createTestActor()
    const noteData = { text: 'Test note', ... }

    // Act
    const status = await createNote(noteData)

    // Assert
    expect(status).toBeDefined()
    expect(status.text).toBe('Test note')
  })
})
```

### Test Coverage

- Aim for high coverage of business logic
- Don't skip edge cases
- Test error conditions
- Mock external dependencies appropriately

## Pull Request Process

### Before Submitting

Run all checks in order:

```bash
yarn run prettier --write .       # Format code
yarn lint                        # Lint — must pass with no errors
yarn typecheck                   # Type check — must pass
yarn build                       # Build — must succeed
yarn test                        # Tests — must pass
```

Also:

- Update every doc your change makes stale — grep `*.md` and `docs/` for renamed or removed commands, env vars, routes, and scripts (see `AGENTS.md` → Documentation Maintenance)
- Test manually if UI changes are involved
- Rebase on main to ensure clean history:

  ```bash
  git fetch origin
  git rebase origin/main
  ```

### PR Guidelines

- **Title**: Clear and descriptive (follows conventional commit format)
- **Description**: Explain what and why, not just how
  - What problem does this solve?
  - What approach did you take?
  - Any breaking changes?
  - Screenshots for UI changes (optional, not required)
- **Link issues**: Reference related issues using `Fixes #123` or `Relates to #456`
- **Keep PRs focused**: One feature/fix per PR

### CI Status Checks

Branch protection on `main` requires four status checks:

- `All Tests`
- `Lint and Prettier`
- `Build`
- `CI Success`

`CI Success` is required and fail-closed over all upstream CI checks: lint (`Lint and Prettier`), typecheck (`Type Check`), build (`Build`), test shards (`All Tests`), PostgreSQL database tests (`PostgreSQL Database Tests`), and schema dump checks (`SQLite Schema Dump Sync` and `PostgreSQL Schema Dump Sync`). If any upstream check fails, `CI Success` fails and blocks merging.

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated — if the change adds/renames/removes commands, env vars, routes, scripts, tooling, or conventions, every doc that mentions them (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `REVIEW.md`, `docs/`) is updated in the same PR (see `AGENTS.md` → Documentation Maintenance)
- [ ] No `console.log` statements (use logger for server-side code)
- [ ] TypeScript types are proper (no `any`)
- [ ] Commit messages follow convention
- [ ] `yarn run prettier --write .`, `yarn lint`, `yarn typecheck`, `yarn build`, and `yarn test` pass
- [ ] All CI status checks pass (including required check `CI Success`, fail-closed over lint, typecheck, build, tests, PostgreSQL database tests, and schema dump checks)

## Project Structure

```
activities.next/
├── app/                       # Next.js App Router
│   ├── (timeline)/            # Timeline routes (with sidebar)
│   ├── (nosidebar)/           # Auth routes (no sidebar)
│   ├── embed/                 # Public embed widgets (heatmaps)
│   ├── health/                # Health liveness probe
│   ├── api/                   # API routes
│   │   ├── auth/              #   Authentication (better-auth)
│   │   ├── inbox/             #   Shared ActivityPub inbox
│   │   ├── nodeinfo/          #   NodeInfo 2.0 / 2.1 metadata
│   │   ├── oauth/             #   OAuth 2.0 provider
│   │   ├── oembed/            #   Public oEmbed endpoint
│   │   ├── users/             #   ActivityPub actor endpoints
│   │   ├── v1/                #   Mastodon-compatible API v1
│   │   ├── v2/                #   Mastodon-compatible API v2
│   │   └── well-known/        #   Federation discovery
│   └── layout.tsx             # Root layout
├── lib/                       # Core application logic
│   ├── actions/               # Server actions
│   ├── activities/            # ActivityPub protocol logic
│   ├── components/            # Shared React components
│   ├── config/                # Configuration loaders
│   ├── database/              # Database abstraction (Knex)
│   ├── jobs/                  # Background job handlers
│   ├── services/              # Business logic services
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Utility functions
├── migrations/                # Database migrations (Knex)
├── packages/                  # Modular optional workspace packages
│   ├── cloudtasks/            #   Google Cloud Tasks queue adapter (@activities/cloudtasks)
│   ├── pg/                    #   PostgreSQL database driver (@activities/pg)
│   └── qstash/                #   Upstash QStash queue adapter (@activities/qstash)
├── docs/                      # Documentation
├── lint/                      # Local Oxlint JS plugin (AGENTS.md conventions)
├── public/                    # Static assets
└── scripts/                   # Development/admin scripts (backup/, fitness/, maintenance/, mock/)
```

### Important Files

- `package.json` — Dependencies, scripts, and workspace configuration
- `packages/` — Optional dependency workspaces (`@activities/cloudtasks`, `@activities/pg`, `@activities/qstash`)
- `tsconfig.json` — TypeScript configuration (editors, `yarn tsc`, and `yarn typecheck`)
- `tsconfig.build.json` — what `next build` type-checks (excludes tests)
- `.oxlintrc.json` + `.oxlintrc.scripts.json` + `lint/agentsRules.mjs` — Oxlint rules
- `.prettierrc.yml` — Code formatting rules
- `vitest.config.ts` — Test configuration
- `next.config.ts` — Next.js configuration
- `knexfile.js` — Database migration configuration
- `Dockerfile` — Docker container build

## Common Tasks

### Adding a New API Endpoint

1. Create route in `app/api/v1/[endpoint]/route.ts`
2. Define request/response types using Zod — use `safeParse` (not `parse`), add `.max()` for bounded columns
3. Add authentication guard if needed (use guards from `lib/services/guards/`)
4. Use `apiResponse`/`apiErrorResponse` for responses (use `apiResponse` with req and allowedMethods on CORS-enabled endpoints)
5. Add tests

### Adding a New Background Job

1. Create job handler in `lib/jobs/`
2. Add job name constant in `lib/jobs/names.ts`
3. Register the job in `lib/jobs/index.ts`
4. Add tests

### Creating a Database Migration

```bash
yarn migrate:make descriptive_migration_name
```

Edit the generated file in `migrations/`, then run:

```bash
yarn migrate
```

> **Important:** All migrations must work with SQLite and PostgreSQL, and should avoid assumptions that break MySQL-compatible Knex clients where possible. Use Knex query builder and avoid database-specific SQL unless it is wrapped with backend-specific fallback logic.

#### Updating the reference schema dumps

There are **two** committed reference schema dumps, one per supported backend:

- **`migrations/schema.sql`** — the **PostgreSQL** schema (`pg_dump`).
- **`migrations/schema.sqlite.sql`** — the **SQLite** schema (`sqlite3 .schema`).
  SQLite is what local dev and the Vitest test suite use.

Read the file that matches the backend you care about — the two SQL dialects
differ (e.g. `character varying` / `jsonb` / `timestamp with time zone` vs
`varchar` / `json` / `datetime`), so a Postgres dump cannot be loaded into SQLite
or vice versa. Both files are gitignored by the blanket `*.sql` rule and
re-included by explicit `!` negations in `.gitignore`.

Any pull request that adds, edits, or removes a migration **must regenerate BOTH
files in the same PR**, keeping them in lockstep. The app runs Knex migrations,
but the Vitest suite loads its database schema directly from these dumps
(`lib/database/testUtils.ts`), so a drifted dump makes the whole test suite run
against a stale schema — regeneration is mandatory, not just hygiene.

Regenerate them canonically rather than hand-editing. In both cases, run every
migration against a fresh database first and confirm the `knex_migrations` row
count equals the number of `migrations/*.js` files.

> **Heads up on environment isolation.** The commands below pass the database
> settings **inline** on the `yarn migrate` line rather than writing a
> `.env.local` — this avoids clobbering an existing `.env.local` (the file the
> setup docs have you create). `knexfile.js` uses `dotenv-flow`, which never
> overrides a variable already in the environment, so each inline value wins
> over the same variable in `.env.local` — but **only that variable**. Anything
> `.env.local` sets that the line does not is still loaded, and an
> `ACTIVITIES_DATABASE` JSON configuration takes precedence over every
> individual `ACTIVITIES_DATABASE_*` variable. That is why every recipe below
> starts with an empty `ACTIVITIES_DATABASE=`: without it, a JSON configuration
> in `.env.local` would silently redirect `yarn migrate` to that (possibly
> remote/shared) database. For the same reason, run them in a shell where you
> have **not** exported any other `ACTIVITIES_DATABASE*` variables — a stray
> exported `ACTIVITIES_DATABASE_PG_*` would otherwise be merged in. Check with
> `env | grep ACTIVITIES_DATABASE` first; unset anything that shows up.

##### PostgreSQL — `migrations/schema.sql`

1. Start a **local** PostgreSQL 17 — for example a throwaway Docker container —
   and **wait until it is accepting connections** (`docker run -d` returns before
   `initdb` finishes, so migrating immediately often fails with a connection
   error). Never point at a remote/shared/production database.

   ```bash
   docker run -d --name anext-schema-pg \
     -e POSTGRES_USER=activities \
     -e POSTGRES_PASSWORD=activities \
     -e POSTGRES_DB=activities \
     -p 127.0.0.1:55432:5432 postgres:17

   # Wait for readiness before continuing.
   until docker exec anext-schema-pg pg_isready -U activities -q; do sleep 1; done
   ```

2. Run the migrations against it, passing the database settings **inline** (see
   the environment-isolation note above — this avoids touching your `.env.local`,
   and each inline variable wins over the same variable in `.env.local`; the
   leading empty `ACTIVITIES_DATABASE=` is what neutralises a JSON
   configuration there):

   ```bash
   ACTIVITIES_DATABASE= \
   ACTIVITIES_DATABASE_CLIENT=pg \
   ACTIVITIES_DATABASE_PG_HOST=127.0.0.1 \
   ACTIVITIES_DATABASE_PG_PORT=55432 \
   ACTIVITIES_DATABASE_PG_USER=activities \
   ACTIVITIES_DATABASE_PG_PASSWORD=activities \
   ACTIVITIES_DATABASE_PG_DATABASE=activities \
     yarn migrate
   ```

   Sanity check that every migration ran: the row count in `knex_migrations`
   should equal the number of `migrations/*.js` files.

   ```bash
   docker exec anext-schema-pg \
     psql -U activities -d activities -tAc 'SELECT count(*) FROM knex_migrations;'
   ls migrations/*.js | wc -l
   ```

3. Dump schema only, without ownership/grants, from the PG 17 server:

   ```bash
   docker exec anext-schema-pg \
     pg_dump -U activities -d activities --schema-only --no-owner --no-privileges \
     > /tmp/schema_raw.sql
   ```

4. Strip `pg_dump`'s noise so the file stays pure DDL matching the committed
   style — drop the `\restrict`/`\unrestrict` session token (it is
   non-deterministic and must never be committed), the `-- …` comment headers,
   and the `SET default_tablespace` / `SET default_table_access_method` lines.
   Keep the leading `SET` / `SELECT pg_catalog.set_config(...)` block and all
   `CREATE` / `ALTER` statements.

   ```bash
   awk '
     /^SET statement_timeout/ { started = 1 }
     !started { next }
     /^--/ { next }
     /^\\(un)?restrict/ { next }
     /^SET default_tablespace/ { next }
     /^SET default_table_access_method/ { next }
     { print }
   ' /tmp/schema_raw.sql | cat -s > migrations/schema.sql
   ```

5. Clean up the throwaway container.

   ```bash
   docker rm -f anext-schema-pg
   ```

A Postgres regeneration is a full re-dump, so its diff can be large even for
tables that did not change structurally (formatting differs from older dumps).
That is expected — do not try to reproduce the previous line-by-line formatting
by hand.

##### SQLite — `migrations/schema.sqlite.sql`

1. Run the migrations against a throwaway local SQLite file, passing the settings
   **inline** (same reasoning as above — no `.env.local` is written or touched):

   ```bash
   ACTIVITIES_DATABASE= \
   ACTIVITIES_DATABASE_CLIENT=better-sqlite3 \
   ACTIVITIES_DATABASE_SQLITE_FILENAME=./schema-dump.sqlite3 \
     yarn migrate
   sqlite3 schema-dump.sqlite3 'SELECT count(*) FROM knex_migrations;'  # == number of migrations
   ```

2. Dump the schema and strip SQLite's auto-managed internal tables — it recreates
   these itself, so they must NOT be committed: the `sqlite_sequence` table and
   the FTS5 shadow tables (`<name>_fts_data` / `_fts_idx` / `_fts_docsize` /
   `_fts_config` / `_fts_content`). Keep the `CREATE VIRTUAL TABLE … USING fts5(…)`
   statement and its triggers — those are real.

   ```bash
   sqlite3 schema-dump.sqlite3 '.schema' \
     | grep -vE "^CREATE TABLE sqlite_sequence" \
     | grep -vE "^CREATE TABLE IF NOT EXISTS '[A-Za-z_]+_fts_(data|idx|docsize|config|content)'" \
     > migrations/schema.sqlite.sql
   ```

3. Sanity-check that the result loads cleanly into a fresh database:

   ```bash
   rm -f /tmp/roundtrip.sqlite3
   sqlite3 /tmp/roundtrip.sqlite3 < migrations/schema.sqlite.sql && echo OK
   ```

4. Clean up the throwaway files:

   ```bash
   rm -f schema-dump.sqlite3 /tmp/roundtrip.sqlite3
   ```

After both dumps, only `migrations/schema.sql` and `migrations/schema.sqlite.sql`
should be left changed. When a schema regeneration is the only change in a
commit, use the `none:` prefix since these files ship nothing.

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/guide/)
- [better-auth Documentation](https://www.better-auth.com/)
- [Knex.js Documentation](https://knexjs.org/)

## Getting Help

- Check existing [issues](https://github.com/llun/activities.next/issues)
- Review [documentation](docs/)
- Ask questions in discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Contributor workflow reference

These rules apply to every change. The [Definition of Done](AGENTS.md#definition-of-done-read-this-first) and mandatory subsystem reading map remain in AGENTS.md. The sections below preserve the detailed commands, tests, review process, and rationale.

<a id="agents-testing-guidelines"></a>

## Testing Guidelines

- Vitest is configured via `vitest.config.ts`. The project is ESM-only
  (`"type": "module"`), so tests run as native ES modules. Use the Vitest API
  (`vi.fn()`, `vi.mock()`, `vi.spyOn()`, …) — do not write `jest.*` calls. (A
  minimal global `jest` proxy exists only as a compat shim for third-party
  libraries like `jest-fetch-mock` — see `vitest-shims/jest-global.ts` — and
  must not be relied on in first-party tests.) The `jest.Mock` /
  `jest.MockedFunction` / `jest.Mocked` **type** names still work via a
  compatibility shim in `vitest.d.ts`.
- **The suite's clock is pinned to `TZ=UTC`** (`vitest.config.ts` assigns
  `process.env.TZ` at the top of the file). CI runners default to UTC, so
  before the pin a date assertion that only held there passed review and then
  failed on the first developer machine set to anything else. The pin is a
  backstop, not a licence: a formatter whose output must not depend on the
  viewer's zone still has to say `timeZone: 'UTC'` itself, because production
  is not running under the pin. The bug that prompted it — an
  `<input type="date">` value (parsed as UTC midnight) read back through a
  local-time `Intl.DateTimeFormat` — rendered a day early in
  `America/Los_Angeles` and a day late in `Asia/Tokyo`.
  - **The pin is set in Vitest's main process, not in `test.env`.** `test.env`
    is applied inside each worker, and on a worker thread an assignment to
    `process.env.TZ` changes the variable without changing the zone `Date` and
    `Intl` use — Node re-reads the zone only for the main thread. With the pin
    in `test.env`, `process.env.TZ` read `UTC` while every test on the
    `threads` project ran in the machine's own zone. `vitest.config.test.ts`
    runs in both projects and fails if either pool is not in UTC.
  - **An external `TZ` does not override it**: `TZ=Pacific/Noumea yarn test`
    still runs in UTC. The pin is the suite's zone, not a default. The CI
    `test-shards` job sets `TZ: Pacific/Noumea` on purpose, because on a UTC
    runner `vitest.config.test.ts` could not fail if the pin were deleted,
    moved back to `test.env` or weakened to `??=`. Do not "tidy" that to UTC.
  - **A test that needs another zone wraps the code in `withTimeZone`** from
    `@/lib/testing/withTimeZone` — for example to show that a timestamp
    without an offset is parsed as UTC, which a UTC process cannot tell apart
    from a local-time parse. For the same reason a bare
    `process.env.TZ = '…'` inside a test does nothing on a worker thread and
    leaves the test passing without testing anything; the helper throws when
    the zone did not move, and `vitest.config.ts` routes every file that
    imports it to the `forks` project (see the worker-threads rule below).
- **The suite also runs with `LOG_LEVEL=silent`** (`vitest.config.ts` →
  `test.env`). Failure-path tests log hundreds of expected warn/error lines,
  and printed they buried the real failures. Assert logging by spying on
  `logger.*` (a spy records the call whatever the level), never by reading
  output; a test of the logger's own level handling sets or deletes
  `LOG_LEVEL` itself, as `lib/utils/logger.test.ts` does.
- **Never wait out a timer in real time.** A test that sleeps
  `setTimeout(resolve, 4100)` to watch a 4000 ms timer fire spends four
  seconds per run, has 100 ms of margin on a loaded CI runner, and still
  passes if the timer is shortened. Install `vi.useFakeTimers()` just before
  the action that arms the timer (after any `waitFor` setup, which needs real
  timers), import the component's own timeout constant, and pin both sides of
  the boundary: advance to `TIMEOUT - 1` and assert nothing happened, then by
  one more and assert it did. Restore with `vi.useRealTimers()` in `afterEach`.
- **Test files run on worker threads, except those that call
  `process.chdir()` or import `withTimeZone`.** `vitest.config.ts` defines two
  projects: `threads` (every test file, one fresh worker thread per file) and
  `forks` (the handful of files that need the main thread of a process of
  their own: those that `process.chdir()` into a temp directory — Node rejects
  that call inside a worker thread with "process.chdir() is not supported in
  workers" — and those that move the time zone with `withTimeZone`, which a
  worker thread silently ignores). The config finds them by scanning test
  files for `process.chdir(` and for an import specifier ending in
  `/withTimeZone` (which also catches a generic, aliased or namespace call),
  so a new such file needs no list edit, and one the scan misses fails — with
  that Node error, or with `withTimeZone`'s own — rather than passing. Threads
  start faster than a process per file: the split cut a full run by about a
  fifth on a 14-core machine, and by about 7% on CI's 4-core runners (fewer
  workers, so less per-file start-up to save). Two faster options were
  measured and declined: `isolate: false` failed 163 files on leaked cross-file
  state, and running the jsdom files on `vmThreads` breaks any test that
  redefines `window.location` (unforgeable in a VM context) and carries
  Vitest's documented VM-pool memory caveat. Each worker thread still gets its
  own `VITEST_POOL_ID`, so the `TEST_DATABASE_TYPE=pg` harness keeps one
  database per worker.
- **Import `date-fns` functions from their sub-path**
  (`import { format } from 'date-fns/format'`), never the barrel. The barrel
  evaluates every date-fns function — about half a second, against roughly
  40 ms for one sub-path — in every test file that transitively reaches it,
  and because Vitest isolates each file that cost is paid hundreds of times
  per run. Oxlint's `no-restricted-imports` rejects the bare `'date-fns'`
  import in `app/` and `lib/`.
- **Seed password fixtures at bcrypt cost 4** (`TEST_BCRYPT_COST` in the auth
  tests), the lowest cost bcrypt accepts. `bcrypt.compare` reads the cost from
  the stored hash, so a fixture's cost changes nothing a test asserts, while
  cost 10 (production's, in `lib/services/auth/auth.ts`) costs tens of
  milliseconds per hash and per sign-in verify.
- The Vitest default environment is `node`. Any test that renders React or
  touches the DOM must start with a `/** @vitest-environment jsdom */` docblock
  (Vitest 4 removed `environmentMatchGlobs`, so there is no glob-based opt-in);
  jsdom tests get `http://localhost:3000` as their URL via
  `environmentOptions`. A `.test.tsx` without the docblock fails with
  "document is not defined".
- `vitest.setup.ts` installs global mocks that apply to EVERY test: the
  `@/lib/config` barrel (host `test.llun.dev`, in-memory SQLite — a new barrel
  export must also be added to the setup-file factory and
  `lib/config/__mocks__/index.ts`, or every test that hits it fails with
  "x is not a function"), `got`, `node:dns/promises`, and `fetch` via
  jest-fetch-mock's global `fetchMock`
  (passthrough by default — call `fetchMock.doMock()` / `mockResponse…` to
  stub). It also installs a jsdom-only guard on `HTMLElement`/`SVGElement`
  `focus()` that caps synchronous re-entry depth: jsdom fires focus events
  synchronously, so Radix UI's `FocusScope` (DropdownMenu, Dialog, …) can
  re-enter `focus()` without settling and overflow the stack with "Maximum call
  stack size exceeded" when a menu closes as a dialog opens. Real focus flows
  never nest that deep, so normal `focus()` / `document.activeElement` behavior
  is unchanged.
- CI (`.github/workflows/ci.yml`) runs lint + prettier-check, **type check**,
  build, four parallel test shards aggregated into an `All Tests` step, and
  schema dump sync jobs (regenerating SQLite and PostgreSQL schema dumps from
  the migrations and failing on drift) on every push and PR. Branch protection on `main` requires
  four status checks — `All Tests`, `Lint and Prettier`, `Build`, and `CI Success`
  (strict: false). The `CI Success` aggregate job is fail-closed over all upstream
  jobs (`Lint and Prettier`, `Type Check`, `Build`, `All Tests`,
  `PostgreSQL Database Tests`, `SQLite Schema Dump Sync`, and `PostgreSQL Schema Dump Sync`), so failures in
  `Type Check` (the gate covering `*.test.ts(x)`), database portability, or schema dump drift block
  merging via `CI Success`.
  The test job pins `TEST_DATABASE_TYPE: sqlite`; `lib/database/testUtils.ts`
  also supports `TEST_DATABASE_TYPE=pg` (with `TEST_DATABASE_HOST` /
  `TEST_DATABASE_USERNAME` / `TEST_DATABASE_PASSWORD`, and optional
  `TEST_DATABASE_PORT` defaulting to 5432) for running the suite against a throwaway **local** PostgreSQL. In that
  mode each Vitest worker drops and recreates its **own** database named
  `test_<VITEST_POOL_ID>` — a single shared database would let one worker
  destroy the schema another worker is mid-test on. The schema loader also has
  to `RESET search_path` on the connection it loads `migrations/schema.sql`
  into, because pg_dump's leading
  `SELECT pg_catalog.set_config('search_path', '', false)` is session-scoped and
  would otherwise leave that pooled connection unable to resolve any unqualified
  table name for the rest of its life.
- **`getTestSQLDatabase` and `getTestSQLDatabaseWithInstance` are SQLite-ONLY
  and ignore `TEST_DATABASE_TYPE` entirely.** A suite built on either reports a
  clean pass under the pg environment variables having never opened a PostgreSQL
  connection — which is a trap, not a nuisance: three review rounds of one PR
  reported its job suite "verified on PostgreSQL 17" on exactly that basis.
  `getTestDatabaseTable()` (for a `describe.each` over backends) and
  `getTestDatabaseWithInstance()` (for a suite that is not shaped that way, or
  that needs the raw Knex instance) do honour it. When a claim about
  cross-backend behaviour matters, verify it by pointing `TEST_DATABASE_HOST` at
  an unreachable address first: a suite that still passes is not running where
  you think it is.
- **To grab a mocked module and configure it, use `vi.importMock<T>('@/path')`,
  not `(await import('@/path')) as unknown as T`.** `vi.importMock` is the
  Vitest equivalent of the old `jest.requireMock`: it is purpose-built, always
  returns the mock, and is typed as `MaybeMockedDeep<T>` so no `as unknown as`
  cast is needed. A bare `await import()` returns the **real** module unless it
  is separately `vi.mock`'d, and forces a type-erasing double-cast. `vi.importMock`
  **is** a valid, documented Vitest API — some review bots incorrectly claim it
  does not exist; do not "fix" it on their say-so.
- **"Always returns the mock" stops holding the moment a factory AWAITS
  `importOriginal()`** — which is exactly what keeping part of a module real
  requires. The trigger is that call, **not** the factory being async, and the
  difference matters because the wrong rule sends you to a static import you do
  not need: measured across all four shapes, a sync factory, an async one with
  no `importOriginal` parameter, and an async one that takes it and never calls
  it all return the factory's result; only awaiting it diverges. Then
  `vi.importMock` hands back the **original** module — the export comes back
  real, callable, and a DIFFERENT object from the one the module under test was
  given, so `vi.mocked()` on it configures nothing and asserts nothing, and
  calling it runs the real implementation. Worse than a missing binding,
  because it looks right. Read a partial mock — the
  `{ ...(await importOriginal()), fn: vi.fn() }` shape — through a plain static
  import, which does resolve to the mock.
- **`vi.restoreAllMocks()` does not reset a `vi.fn()` a `vi.mock` factory
  created.** It only iterates the spies `vi.spyOn` registered, so a module
  mocked as `vi.mock('@/path', () => ({ fn: vi.fn() }))` carries whatever the
  last test told it to return — implementation AND call history — for the rest
  of the file, however thorough the `afterEach` looks. Reset each such export
  explicitly in `beforeEach` (`vi.mocked(fn).mockReset()`). Nothing fails while
  the leak happens to be harmless, which is exactly the problem: the next test
  written against the mock's DEFAULT behaviour silently inherits a neighbour's
  `mockResolvedValue`, and the tests that did notice carry a lone
  `vi.mocked(fn).mockReset()` at the top as a local work-around instead of
  fixing the hook, and pin the reset with a guard test placed last in the block
  so it runs after the tests that dirty the mocks.
- **A test must pass whichever test in its file ran before it.** Files are
  isolated from each other, but the tests inside one share every mock handle
  and every row the file's `beforeAll` built, and two leaks hide there.
  `vi.clearAllMocks()` empties call history but keeps queued `mock…Once`
  values, so a `mockResolvedValueOnce` a test queues for a call its path never
  makes answers the next test's first call instead of that test's own default —
  reset those module-level `vi.fn()` handles in `beforeEach` and set their
  defaults again straight after, because `mockReset()` also drops a default
  given at creation (`vi.fn().mockReturnValue(x)`), while `vi.fn(impl)` keeps
  `impl`. And a test that announces, blocks, deletes or likes hands those rows
  to whichever test runs next — build the database in `beforeEach` and destroy
  it in `afterEach`, or, on the PostgreSQL harness where `prepare` recreates a
  whole database, have each test seed the rows it asserts on under ids of its
  own. CI runs tests in declaration order and cannot see either leak, and in
  that order one had left a route test passing without ever reaching the filter
  it tests (`app/api/v1/fitness/general/regenerate-maps/route.test.ts`,
  `returns zero when there are no eligible old statuses`). Check with
  `yarn test --sequence.shuffle --sequence.seed=<n>` over a few seeds.
- **`toHaveBeenCalledWith` asks whether a call ever happened, never whether it
  was the only one.** A once-per-run summary asserted that way is equally
  satisfied by one logged per row, because the last row carries the correct
  cumulative totals — so "once" has to be pinned by filtering
  `vi.mocked(console.log).mock.calls` and asserting the resulting list with
  `toEqual`, over a fixture large enough that the wrong placement logs twice
  (two rows at `batchSize: 1` separates per-row, per-batch and after-the-loop).
  The same gap hides a hardcoded page size: at fixture scale one 50-row batch
  and several 1-row batches write the same rows and log the same counters, so
  paging is only observable by counting the SELECTs off knex's `query` event.
- **To control when an awaited call settles, import `createDeferred` from
  `@/lib/testing/deferred` — do not hand-roll another promise-with-exposed-resolve
  helper.** The same eight lines had been reimplemented in four test files under
  three different names before they were extracted. It returns
  `{ promise, resolve, reject }` and the promise stays **pending** until a test
  settles it, which is the whole point: the pending render and the settled one
  are separate flushes, so a `Promise.resolve(value)` stand-in collapses them
  into the first `act()` and the assertion about the in-flight state passes
  vacuously. `PostBox attachment ref guard` is the sharpest example — it passes
  with the bug present unless the two picker batches are sequenced — and
  thirteen more tests across `MessagesPage`, `SearchPageClient` and
  `FitnessHeatmapView` fail outright if the helper stops deferring.
- **React `cache` does not memoize under Vitest, so a test for a `cache()`d
  helper has to stand a request scope up itself — `runInReactCacheScope` from
  `@/lib/testing/reactCacheScope`.** React ships two builds of it: the client
  build Vitest resolves is a hard passthrough that calls the function every
  time, and only the `react-server` build — the one Next.js loads for Server
  Components and route handlers — keys on the arguments, and then only while an
  async cache dispatcher is installed. That dispatcher **is** the request scope.
  So a test that simply calls a memoized helper twice and expects one query is
  asserting nothing about the memoization; it reads two, and the natural
  "fix" is to weaken the assertion. Swap the server build's `cache` in with
  `vi.mock('react', …)` returning that module's `serverCache`, then wrap the
  calls in `runInReactCacheScope` — one call is one request, with a fresh store,
  restored afterwards — and **sequentially**: React's dispatcher is one mutable
  global, so two live scopes cannot be isolated from each other at all (either
  one's continuation after an `await` reads whichever dispatcher happens to be
  installed), and a second scope entered while one is live therefore throws
  rather than nesting. `app/(timeline)/[actor]/profileFollowLookup.test.ts` is
  the worked example: it asserts one follow query across a whole profile render,
  on the local and remote branches alike, and that a second scope re-reads.
- Prefer unit tests near `lib/` and route tests near `app/`.
- **Test a behaviour once, at the layer that owns it.** A parent component's
  test checks that it wires a child in, not the child's behaviour again. For
  example, the route privacy hint's tap timer is tested in
  `ActivityRouteMapKit` and `ActivityMapPanel`, which each own a timer, and not
  again through `FitnessStatusDetail`, which only renders `ActivityMapPanel`.
  Copies at several layers fail together on one change and slow the suite.
- **Don't re-test OAuth scope or "401 without a session" in each route's own
  test file.** For a route guarded by `OAuthGuard`, `OAuthGuardAnyScope`,
  `OptionalOAuthGuard` or `OAuthAppGuard`, add it to `EXPECTED` in
  `app/api/v1/routeScopeWiring.test.ts` (and to `MULTI_METHOD` if its methods
  use different scopes, and with `guard` if it is not `OAuthGuardAnyScope`).
  That test pins the scope literals (per method for `MULTI_METHOD` routes, as
  a set for the rest) and, for each exported method, which guard it is behind,
  so an any-of → all-of or required → optional switch fails; it also asserts
  that no listed route opts into `unconfirmedAccount` (except
  `emails/confirmations`, its single documented recovery carve-out). It fails
  if a route whose handlers carry an OAuth guard is in neither `EXPECTED` nor
  `UNLISTED_BASELINE` (now empty, with all routes pinned). A route that builds
  its guard inside its own handler, so that no exported method is the guard's
  handler, cannot be pinned by the table; it goes in `GUARDED_BY_OWN_CODE` with
  the test that pins its scopes. `MULTI_METHOD`
  entries must name every guarded method the route exports.
  `lib/services/guards/OAuthGuard.test.ts` covers what each guard then does
  (no session, wrong scope, a parent scope, unconfirmed accounts) once, for
  every route. Two routes keep an end-to-end check against the real guard, as
  a canary that guard and route still fit together:
  `app/api/v1/preferences/route.test.ts` for a read and
  `app/api/v1/notifications/clear/route.scopes.test.ts` for a write. This
  applies only to that guard family: routes behind `AuthenticatedGuard` or
  their own session check have no wiring table, so their own 401/403 tests are
  the only proof and must stay.
- **Assert what the user or caller sees.** Query by role, label or text rather
  than `toHaveClass`/`querySelector`, unless the class is the contract (a
  design-system token such as `.skeleton`). Use `toHaveBeenCalledTimes` only
  when the count itself is the behaviour. Both break on refactors that change
  nothing a user can observe.
- All tests run in parallel using isolated SQLite in-memory databases. The
  schema is loaded from the committed reference dumps (`migrations/schema*.sql`)
  via `lib/database/testUtils.ts` rather than by running the Knex migration
  chain, so the dumps MUST stay in lockstep with the migrations.
- **`describe` / `it` names use plain descriptive text — do not prefix them.**
  Name the function or method under test directly (`describe('getVisibility', …)`,
  not `describe('#getVisibility', …)`), and do not use a leading `#` or `.`
  sigil. `it` names should read as a behavior statement
  (`it('returns null when actor is missing', …)`).
- For tests whose cases differ only by input and expected output, prefer a
  table-driven `it.each([...])('$description', …)` with a `description` column
  instead of repeating near-identical `it` blocks. Reserve standalone `it`
  blocks for cases with distinct setup or assertion shapes.
- Client components that fan out to children which render relative timestamps
  (e.g. `Posts`/`Post`) must receive `currentTime: number` from a Server
  Component and forward it. Add a regression test that renders the component
  with a fixed `currentTime` and a post created a known interval earlier, then
  asserts the rendered relative time (for example `posted 5 minutes ago`). If
  the component calls `Date.now()` internally instead, the assertion fails. See
  `app/(timeline)/MainPageTimeline.test.tsx` for the pattern.

<a id="local-manual-browser-testing"></a>

### Local Manual / Browser Testing (SQLite + mock data)

Use this to run the app locally with a logged-in test user and seeded posts —
for example to verify UI changes or reproduce hydration issues in a browser.
These exact steps are verified to work; the gotchas below are load-bearing.

1. Create a git-ignored `.env.local` at the repo root:

   ```bash
   ACTIVITIES_HOST=localhost:3000
   ACTIVITIES_INSECURE_AUTH=true
   ACTIVITIES_SECRET_PHASE=local-dev-secret-phrase-change-me
   ACTIVITIES_ALLOW_EMAILS='["test@example.com"]'
   ACTIVITIES_DATABASE_CLIENT=better-sqlite3
   ACTIVITIES_DATABASE_SQLITE_FILENAME=./dev.sqlite3
   ```

   - `ACTIVITIES_INSECURE_AUTH=true` is **required** for local sign-in over
     `http`. Without it, `getBaseURL()` defaults to `https://…`, so better-auth's
     trusted origin becomes `https://localhost:…` and sign-in fails with
     `403 Invalid origin: http://localhost:…`.
   - Wrap JSON-valued vars like `ACTIVITIES_ALLOW_EMAILS` in **single quotes** so
     both `dotenv-flow` and shell `source` keep the inner double quotes.
   - `ACTIVITIES_HOST` must match the port the dev server actually serves on (the
     mock actor's domain is `config.host`). If port 3000 is taken, pick a free
     port and set both `ACTIVITIES_HOST` and `yarn dev --port` to it.

2. Install deps, migrate, and seed mock data:

   ```bash
   yarn install          # Node.js 24
   yarn migrate          # knexfile uses dotenv-flow → auto-loads .env.local

   # The mock scripts do NOT auto-load .env.local.
   # Export the vars into the shell first, then run them:
   set -a; . ./.env.local; set +a
   # The project is ESM-only. Run scripts through the scripts/run.cjs bootstrap
   # (also wired into each script's shebang) so tsx loads them in CommonJS
   # mode — this resolves the app's extensionless and CommonJS-named imports,
   # which Node's strict ESM loader rejects.
   node scripts/run.cjs scripts/mock/createMockUser.ts      # testuser / test@example.com / testpassword123
   node scripts/run.cjs scripts/mock/createMockStatuses.ts  # seeds main (home) timeline posts
   ```

   The mock user is created already email-verified, so credential sign-in works.

3. Run the server and sign in:

   ```bash
   yarn dev --port 3000   # port must match ACTIVITIES_HOST
   ```

   Open `http://localhost:3000/auth/signin` and sign in with
   `test@example.com` / `testpassword123`. The seeded posts appear on the
   timeline at `/`.

4. Reproducing hydration mismatches in a browser: relative timestamps round
   coarsely (date-fns boundaries at 30s, 90s, …), so the natural SSR→hydration
   gap rarely crosses a boundary. To force a deterministic mismatch, override the
   browser clock before load (e.g. Playwright `addInitScript` setting
   `Date.now = () => realNow() + 180000`). With the bug present this throws a
   React hydration error naming the timestamp node; with `currentTime` passed
   from the server it does not, because both SSR and hydration use the identical
   server value.

<a id="agents-task-recipes"></a>

## Task Recipes

Ordered checklists for the most common task shapes. Follow them step by step;
each ends with the Definition of Done gate.

### Adding a Mastodon-style API endpoint

1. Create `app/api/v1/<name>/route.ts` exporting HTTP-method handlers (`GET`, `POST`, …).
2. Wrap handlers in the right guard from `lib/services/guards/` (e.g. `AuthenticatedGuard`, `AdminApiGuard`) — the guards already handle auth and same-origin proof.
3. Validate request bodies with Zod `safeParse` (never `.parse()` — lint-enforced); add `.max(n)` for sized columns and the empty→`null` transform for nullable text (see **Zod Validation in API Routes**).
4. Take status/actor ids through `resolveStatusIdParam` / `resolveActorIdParam` (or their batch `…Params` forms) and emit them with `getClientStatusId` / `getClientActorId`, including any pagination cursor — never `idToUrl`/`urlToId` inline (see **Client-Facing Entity IDs**).
5. Respond only via `apiResponse` / `apiErrorResponse` from `@/lib/utils/response` (lint-enforced); CORS routes (those exporting `OPTIONS`) use `apiResponse` even for errors.
6. If the web UI calls the endpoint, add a named exported function to `lib/client.ts` and import it in components — never call `fetch()` in a component (lint-enforced).
7. Co-locate `route.test.ts`; plain `describe`/`it` names, table-driven `it.each` for input/expected variants (see **Testing Guidelines**).
8. Update `docs/architecture.md` or the relevant feature guide if they enumerate routes.
9. Run the Definition of Done gate.

### Adding a database migration

1. `yarn migrate:make <name>` — never hand-write the file (migrations are ESM `.js` with named `up`/`down` from `migration.stub`).
2. Use the Knex query builder; the migration must work on SQLite and PostgreSQL and avoid breaking MySQL-compatible clients (see **Database Compatibility Guidelines**).
3. Apply it locally against a throwaway SQLite file with inline env vars: `ACTIVITIES_DATABASE= ACTIVITIES_DATABASE_CLIENT=better-sqlite3 ACTIVITIES_DATABASE_SQLITE_FILENAME=./throwaway.sqlite3 yarn migrate` (the empty `ACTIVITIES_DATABASE=` keeps a JSON configuration in `.env.local` from taking over).
4. Regenerate BOTH reference schema dumps (see **Keeping the reference schema dumps in sync**). This is not optional: the Vitest suite builds its databases from the dumps, and CI's SQLite and PostgreSQL Schema Dump Sync jobs fail on schema-dump drift.
5. Update the affected `lib/database/` code and types, plus tests.
6. Run the Definition of Done gate.

### Adding an environment variable

1. Read it ONLY inside `lib/config/` — add it to the right module and its Zod schema, with tests (`lib/config/envAccess.test.ts` fails on reads elsewhere).
2. Never read it at build time (`next.config.ts` etc.) — see **Runtime Configuration Guidelines**.
3. Document it in `docs/environment-variables.md` (the `lib/config/envDocumentation.test.ts` sync test fails otherwise) and add it to `.env.example`.
4. Update any setup guide that shows related configuration.
5. Run the Definition of Done gate.

### Adding a page in the `(timeline)` group

1. Create `app/(timeline)/<name>/page.tsx`; render `<PageHeader title="…" />` and inherit the unified `max-w-content` width — no per-page width classes (see **Page Header & Sub-Navigation**). `PageHeader` also renders the mobile compact bar below 768px; a page without a `PageHeader` renders `MobileCompactHeader` itself (or, for a cover-led page like the profile, the floating `MobileNavigationTrigger`). Never put a back arrow or a logo in a title — pass `back` to `PageHeader` or use `BackLink` (see **Mobile chrome** in `docs/architecture.md`).
2. Settings-style sections use the shared `SectionNavDropdown` on every breakpoint; never a vertical nav rail or in-header tabs.
3. Pass timestamps as `Date.now()` numbers from Server Components; Client Components accept `currentTime: number` and never call `Date.now()`/`new Date()` during render (see **Date Serialization**).
4. If the page shows status posts, render them through the shared `Posts`/`Post` components and turn actions on with `currentActor` + `showActions` — never a bespoke post/action row or per-status action callbacks (see **Status Posts & Actions**).
5. All client-side data calls go through named functions in `lib/client.ts` (lint-enforced).
6. Add component tests (`/** @vitest-environment jsdom */` docblock) and verify the page in a real browser (see **Local Manual / Browser Testing**); screenshots in the PR are not required.
7. Run the Definition of Done gate.

<a id="agents-design-library-sync"></a>

## Design Library Sync

The Sketch design library is the visual source of truth for Activities.next. It lives in a separate repository, [`llun/sketch`](https://github.com/llun/sketch), checked out on the maintainer's Mac at `/Users/llun/Documents/llun/sketch`:

- `Activities.next/Activities.next.sketch` is the library: Brand, Colors, Type, Spacing, Emails, Symbols, the Components pages, Templates, and the Mobile and Fitness redesign System pages. It is registered in Sketch as the "Activities.next" library.
- `Activities.next/Screens/` holds the redesign screens: `Activities.next Screens.sketch` is the editable source, `images/<page-slug>/<frameId>.png` are its exported frames, and `index.html` with `manifest.js` is a static viewer that lists every screen with its page, frame name and layer id in the Sketch file.

When a change alters what users see, update the design in the same task:

1. **Decide whether it is a design change.** It is when the change adds or changes a design token (color, type, spacing, radius, motion), a shared component or its states, a page layout, or a screen state such as loading, empty or error. Pure logic, data or copy-only fixes that keep the existing design do not need a Sketch update.
2. **Always update `Activities.next.sketch`.** Edit the affected swatches, text styles, symbols, component pages or System notes so the library matches the shipped UI, then save the document (Sketch keeps unsaved edits in memory, so an unsaved file commits nothing).
3. **Regenerate screens when needed.** If the change adds a screen or changes how an existing one looks, update its Light and Dark frames in `Activities.next/Screens/Activities.next Screens.sketch`, export the frames to `Activities.next/Screens/images/<page-slug>/<frameId>.png` (`@2x` for frames 800px wide or narrower), and add or update their entries in `manifest.js` so the viewer shows them.
4. **Commit and push the sketch repository.** Commit on `main` in `/Users/llun/Documents/llun/sketch` with a message that names the design change and links the Activities.next PR, then `git push origin main`. Design changes do not need a pull request in `llun/sketch`. The Activities.next code change itself still follows the normal PR flow.
5. **Never skip it silently.** If the Mac or Sketch is unreachable, or the push fails, finish the code change and say exactly what is left (which file, which pages or screens) in the PR description and to the person you are working with.

<a id="agents-documentation-maintenance"></a>

## Documentation Maintenance

- **Docs are part of the change.** Any PR that changes behavior described in `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `REVIEW.md`, or `docs/` MUST update those documents in the same PR. Stale guidance is a bug: these files are the operating manual for both humans and AI agents, and past drift produced broken commands and examples (e.g. docs still saying "Jest" long after the Vitest migration, and Docker examples that could not start).
- Before opening a PR, grep the repo's Markdown for every command, script, route, environment variable, table, flag, or convention your change renames, removes, or reshapes — `grep -rn "<old-name>" *.md docs/` — and fix every hit.
- Common triggers and the docs they touch:
  - `package.json` scripts, tooling, hooks (husky/lint-staged), or CI workflow changes → `AGENTS.md` (Build/Test and Commit sections) and `CONTRIBUTING.md`
  - Environment variables added/removed/renamed, or defaults/validation changed → `docs/environment-variables.md` and `.env.example` (plus any setup guide that shows the variable)
  - API routes added/moved, or HTTP methods changed → `docs/architecture.md` and the relevant feature guide (e.g. `docs/fitness-file-storage.md`)
  - Knex migrations → regenerate both schema dumps (see Database Backends & Local Setup)
  - `scripts/` utilities added or changed → `docs/maintenance.md` (and the feature guide that lists them)
  - Deployment, Docker, or runtime-config changes → `README.md`, `docs/setup.md`, and the database setup guides
  - New or changed coding conventions and patterns → the matching `AGENTS.md` section and the `REVIEW.md` checklist
  - Visual design changes (tokens, components, layouts, screen states) → `Activities.next.sketch` and, when screens change, `Activities.next/Screens/` in the `llun/sketch` repository (see Design Library Sync)
  - Changes to AGENTS.md rules themselves → `AGENTS.md` (which `CLAUDE.md` symlinks to) and the PR checklist in `.github/PULL_REQUEST_TEMPLATE.md`
- Keep `docs/` durable and general-purpose (see Project Structure): update the reference docs in place; do not add change-specific writeups.

<a id="agents-commit-pull-request-guidelines"></a>

## Commit & Pull Request Guidelines

- **Work reaches `main` as a pull request**: commit to the feature branch, push it, and open a PR. Nothing is merged by committing to `main` directly (Definition of Done item 1), and the review loop below has no PR to attach to until this has happened.
- Commit messages must start with one of these prefixes followed by a short imperative description:
  - `none:` to mark that commit as no-release unless another commit in the range requests a higher bump
  - `major:` for breaking changes (a major release requires a human maintainer to apply the `release:major` label)
  - `minor:` for backwards-compatible new features (minor version bump)
  - `fix:`, `feat:`, `chore:`, `refactor:`, `test:`, `docs:`, etc. for everything else (patch version bump)
- PRs should include a clear summary, linked issues (if any), test results, and notes for config/migrations.
- Screenshots or clips for UI changes are optional and not required.
- **Never put production or operational SQL in PR descriptions** (or anywhere committed in the repo). One-off database mutations for a deployment — hotfix `UPDATE`/`INSERT`/`DELETE` statements, data backfills, or any copy-pasteable production runbook — must not live in the PR body. Describe **what** operational change is needed and **why** in prose, and deliver the actual SQL through the deployment runbook or a private ops channel instead. This targets operational/runbook SQL — it does **not** restrict application query code: Knex query-builder calls and `knex.raw`/`whereRaw` in `lib/` are normal application code and unaffected. The database files that legitimately live in the repo, all under `migrations/`, are the Knex migrations (JavaScript/TypeScript that define schema changes — not raw `.sql`) and the reference schema dumps (`migrations/schema.sql`, `migrations/schema.sqlite.sql`); illustrative SQL in the `docs/` setup and maintenance guides (e.g. `docs/postgresql-setup.md` and the schema-dump steps) is also fine. This keeps environment-specific identifiers, hostnames, and runbooks out of the public Git history.

### Version Bump Prefixes

**Do NOT manually change the `version` field in `package.json`.** A CI workflow automatically bumps the version based on commit message prefixes after merge. Manual version changes in PRs will conflict with the automated workflow.

The version-bump workflow reads commit prefixes to determine the next semver version. Use these prefixes to control version bumping:

| Prefix               | Version bump    | When to use                                                                                                                  |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `none:`              | None            | For internal-only changes that do not require a release (e.g. documentation, CI configuration)                               |
| `major:`             | Major (`X.0.0`) | Breaking change approved by a human maintainer with the `release:major` label. Without that label, it produces a minor bump. |
| `minor:`             | Minor (`x.Y.0`) | New backwards-compatible features users can opt into (e.g. new endpoint, new UI page, new optional config)                   |
| _(any other prefix)_ | Patch (`x.y.Z`) | Bug fixes, refactors, chores, docs, tests — anything that doesn't change the public-facing contract                          |

#### Squash-merge and PR titles

PRs are **squash-merged**, so the **PR title becomes the commit subject** on `main`. The workflow checks the commit subject first, then falls back to scanning the commit body (which contains the individual commit messages).

**To ensure a minor version bump, the PR title MUST start with `minor:`.** A `major:` title produces a major bump only after a human maintainer applies the `release:major` label to the feature PR. Agents must never apply this label. Without it, `major:` produces a minor bump. The tag workflow independently verifies that approval on the source PR. For example:

```text
minor: add hashtag timeline support        ← PR title → minor bump
major: remove legacy v1 API endpoints      ← PR title + human `release:major` label → major bump
feat: fix button alignment                 ← PR title → patch bump (default)
```

If the PR title uses a generic prefix (e.g. `feat:`) but an individual commit inside the PR uses `minor:`, the workflow will also detect it from the squash-merge body. However, **setting the PR title is the most reliable approach** since it is always the commit subject.

Commits that change only files under `.github/` are also treated as no-bump by default, unless the commit message explicitly uses `major:` or `minor:`.
When the repository has no version tag yet, the workflow still bootstraps `v1.0.0` regardless of commit history.

After a merge to `main`, the version-bump workflow opens an auto-merging `Bump version to vX.Y.Z` PR from the reserved `version-bump/main` branch — leave that branch and PR alone. The merged bump commit is tagged by `tag-version.yml`, and `package.yml` builds and publishes multi-arch Docker images (tagged `main`) to GHCR and Docker Hub on every push to `main`. The sync to the production deployment does **not** follow each merge: `sync-main-to-prod-dispatch.yml` runs once a day at 01:17 UTC (fixed in UTC, so 02:17/03:17 Netherlands time across DST) and dispatches the newest of the last 30 `main` commits on which CI, Package and CodeQL all succeeded, skipping the day with a warning if none has. A merge whose checks have not finished by 01:17 UTC waits for the next run. To ship sooner, run activities.prod's `sync-upstream.yml` by hand, or run `sync-main-to-prod-dispatch.yml` by hand to apply the same selection now.

Examples:

```text
none: update internal CI docs without cutting a release
chore: tweak GitHub Actions cache keys              ← no bump if the commit only changes `.github/`
major: remove legacy v1 API endpoints      ← major only with a human `release:major` label; otherwise minor
minor: add support for S3 media storage
fix: correct timestamp parsing in ActivityPub inbox   ← patch
chore: update dependencies                            ← patch
```

- **Before committing**, always run:
  1. `yarn run prettier --write .` to format all files.
  2. `yarn lint` to ensure no linting errors—**must be green before commit**.
  3. `yarn typecheck` to ensure no type errors—**must be green before commit**.
  4. `yarn build` to ensure no build errors—**must be green before commit**.
  5. `yarn test` to ensure no test errors—**must be green before commit**.
- A husky pre-commit hook (`.husky/pre-commit`) runs on every commit: first `lint-staged` (configured in `package.json`), which runs `prettier --write` on the staged files and re-stages the formatted result, then `yarn lint`, which blocks the commit on lint errors. It does **not** run build or tests — run those yourself per the checklist above.
- The `prettier` / `prettier:check` package scripts only cover `app migrations lib lint`; the trailing `.` in `yarn run prettier --write .` is what extends formatting to the whole tree. CI's format gate (`yarn prettier:check`) does not check `scripts/`, `docs/`, or `.github/`.
- The **sub-agent code-review loop below is the project's review process.** The `gemini-code-assist` bot has been **removed** and no external review bot currently runs on PRs, so do **not** post `/gemini review` (or any other bot trigger) and do not wait on a bot. `REVIEW.md` at the repo root is the project's review checklist and documents recurring reviewer false-flags (e.g. claims that `vi.importMock` does not exist) — read it before acting on review feedback.

<a id="agents-code-review-loop-sub-agents"></a>

## Code Review Loop (Sub-Agents)

**Once a PR is ready, drive a sub-agent code-review loop before treating the work as done, and re-run it every time an agent makes further changes to that PR.** "Ready" means the branch is pushed, the PR is open, and the local pre-commit gate (prettier → lint → typecheck → build → test) is green. This is a required step for every PR an agent produces, not an optional polish pass — with one exception, **When sub-agents are unavailable** below.

### Fan out sub-agents to review the whole change

- Spawn **sub-agents** (the Task/Agent tool, or the `code-review` skill) to review **all** of the PR's code — correctness bugs plus the project invariants in this file and `REVIEW.md`, security, tests, and style. Use `REVIEW.md` as the checklist. For a sizeable diff, fan several sub-agents out in parallel across different files/dimensions instead of a single pass, then consolidate their findings. Each reviewer must be a **separate sub-agent that did not write the change** (never the main thread, and never the implementer reviewing its own work). The main thread chooses each reviewer's model and effort explicitly per the table in [AGENTS.md](AGENTS.md#working-with-sub-agents-always); fixes go to a separate implementer sub-agent.
- **Post every finding as a comment on the PR** — an inline review comment anchored to the offending file and line wherever possible, not just a summary in chat. The `code-review` skill's `--comment` flag posts inline comments directly; otherwise open a pending review with `pull_request_review_write` (method `create`), attach comments with `add_comment_to_pending_review`, and submit with `pull_request_review_write` (method `submit_pending`). The PR threads are the source of truth for what still needs addressing.

### Address → reply → resolve, in rounds

For every open review comment (from your sub-agents or from a bot):

1. **Address it** — make the fix on the branch, or, for a false positive / won't-fix, decide that explicitly and be ready to justify it. Commit and push.
2. **Reply** on the comment thread with what changed (or why no change is warranted) via `add_reply_to_pull_request_comment`.
3. **Mark it resolved** via `resolve_review_thread`.

After clearing a batch, **run the sub-agent review again** — fixes can introduce new problems. **Repeat until a full round surfaces no new issues that need addressing, or you reach a maximum of 20 rounds**, whichever comes first. Note the round number as you go so the cap stays visible, and stop early the moment a clean round produces nothing actionable.

### Review bots

- **No external review bot currently runs on PRs.** The `gemini-code-assist` bot has been removed, so do **not** post `/gemini review` (or any other bot trigger) and do **not** wait for a bot review — the sub-agent rounds above are the whole review.
- If an automated review bot is reintroduced later, loop it in the same way: after addressing a round, re-request its review, treat its comments exactly like your own findings (address → reply → resolve), and give it up to 20 minutes to respond before continuing — but until then, don't wait on a bot that isn't there.

### When sub-agents are unavailable

Some sessions cannot spawn sub-agents at all: the harness exposes no Task/Agent tool, the operator's session configuration forbids calling it ("do not call the Agent tool unless the user requested it" and similar), or the user has said not to. **In that case the loop is not required, and you must not stall the work waiting for it.** The exception is narrow and mechanical — it fires on _inability_, never on the change looking small, the diff looking obvious, or the gate being green. Those are the conditions under which a review is cheap, not the conditions under which it is unnecessary.

What still holds when the exception fires:

- **Review the diff yourself, in one pass, against `REVIEW.md` and this file.** The exception is about _who_ reviews, not _whether_ the work is reviewed. A single careful self-review is worth far more than nothing, and it is the whole review in this mode.
- **Say so explicitly**, in the PR body and in the handoff to the user: the loop did not run, and why. A skipped review that nobody can see is indistinguishable from a review that found nothing — which is precisely the failure this rule exists to prevent. Never describe the work as fully reviewed, and never imply rounds ran that did not.
- **The loop is still owed.** Offer to run it the moment sub-agents are available — the user can lift the restriction for the session, or run `/code-review` themselves. If a later session on the same PR _can_ spawn sub-agents, run the loop there before the PR merges.

Everything else about the PR is unchanged: the Definition of Done, the pre-commit gate, and the documentation and schema-dump rules all still apply in full.

### Done when

A full sub-agent review round yields no new actionable comments, or you have run 20 rounds. Every thread you touched should be replied-to and resolved before you stop. Where the exception above applies, you are done when the self-review is complete and the skipped loop is disclosed on the PR.

<a id="review-style-imports-tests"></a>

## Style, imports & tests

- TypeScript + React, 2-space indent; Prettier (no semicolons, single quotes,
  import sorting) is clean. Unused vars are `_`-prefixed.
- Each test checks one behaviour at the layer that owns it (see
  [Testing Guidelines](#agents-testing-guidelines)). Watch for a parent
  re-testing its child's behaviour, a real-time sleep, and a route test re-proving
  OAuth scope or 401 when the route belongs in `routeScopeWiring.test.ts`.
- Absolute imports (`@/lib/...`) for anything outside the current directory;
  same-directory `./` only, no `../`. The same rule applies to `vi.mock(...)`
  paths.
- Tests are co-located, named `*.test.ts(x)`. `describe`/`it` names are plain
  descriptive text — no `#`/`.` sigil — and read as behavior statements.
  Input/expected-only variations use a table-driven `it.each([...])`.
- A test that needs to control **when** an awaited call settles imports
  `createDeferred` from `@/lib/testing/deferred` rather than hand-rolling another
  promise-with-exposed-resolve helper (the same eight lines had been copied into
  four files under three names). Its promise stays pending until the test settles
  it — a `Promise.resolve(value)` stand-in collapses the pending render and the
  settled one into the same `act()` flush, so the assertion about the in-flight
  state passes whether or not the code under test is correct. `PostBox
attachment ref guard` is exactly that: it passed with the bug present until
  the two picker batches were sequenced.
- A test that shows a client component hydrates the server's HTML without a
  mismatch calls `hydrateServerHtml` from `@/lib/testing/hydrateServerHtml`
  rather than repeating the `renderToString` / `hydrateRoot` / `act()`
  boilerplate, and calls the `unmount()` it returns in a `finally` — an
  abandoned root keeps its effects' timers and listeners alive into later tests.
- A test for a React `cache()`d helper stands a request scope up with
  `runInReactCacheScope` from `@/lib/testing/reactCacheScope` and swaps that
  module's `serverCache` in via `vi.mock('react', …)`. Vitest resolves React's
  client build, whose `cache` is a hard passthrough — only the `react-server`
  build memoizes, and only inside a scope — so a test that calls the helper
  twice and expects one query reads two and proves nothing either way. Scopes are
  sequential: React's dispatcher is a single mutable global, so a nested or
  concurrent scope throws instead of pretending to isolate.
- **`vi.restoreAllMocks()` does not reset a `vi.fn()` a `vi.mock` factory
  created** — it only iterates the spies `vi.spyOn` registered. A module mocked
  as `vi.mock('@/path', () => ({ fn: vi.fn() }))` keeps its implementation and
  its call history across the whole file, so reset each export explicitly in
  `beforeEach`. A lone `vi.mocked(fn).mockReset()` at the top of one test is the
  tell: that test noticed the leak and worked around it instead of fixing the
  hook.
- **No test may depend on which test in its file ran first.** Flag tests that
  queue `mock…Once` values under a `beforeEach` that relies on
  `vi.clearAllMocks()` alone (it keeps the queue), a test that mutates rows a
  `beforeAll` seeded for the whole file, and a test that reads state "the
  previous case" left. Shuffled runs (`--sequence.shuffle --sequence.seed=<n>`)
  catch what CI's fixed order cannot.
- **`toHaveBeenCalledWith` is "was ever called", not "was the only call".** A
  once-per-run summary asserted that way passes when it is logged once per row,
  because the last row's cumulative totals are correct. Pin the count by
  filtering `mock.calls` and asserting the list with `toEqual`, over a fixture
  where the wrong placement logs twice. Same blind spot for a hardcoded page
  size: at fixture scale one big batch and several small ones are
  indistinguishable by result, so paging needs the SELECTs counted off knex's
  `query` event.
- Tests run on **Vitest** (`vi.*`, not `jest.*`). To read a mocked module and
  configure it, prefer **`vi.importMock<T>('@/path')`** over
  `(await import('@/path')) as unknown as T`. `vi.importMock` is purpose-built,
  returns a typed `MaybeMockedDeep<T>` (no `as unknown as` cast needed), and
  always yields the mock; bare `await import()` returns the real module unless it
  is separately `vi.mock`'d. (Some review bots wrongly flag `vi.importMock` as
  non-existent — it is a valid, documented Vitest API.)
- **But "always yields the mock" stops holding once a factory AWAITS
  `importOriginal()`** — the shape a partial mock takes whenever one export has
  to stay real. Then `vi.importMock` measurably returns the **original**
  module: the export is real, callable, and a different object from the mock
  the module under test received, so `vi.mocked()` on it configures and asserts
  nothing while calling it runs the real implementation. Flag a `vi.importMock`
  whose factory awaits `importOriginal()`; the static import is the mock there.
  Do not flag it merely for being `async` — a factory that never calls
  `importOriginal` returns the mock like any sync one, so that heuristic
  over-reports.

<a id="review-docs-hygiene"></a>

## Docs hygiene

- `docs/` is durable, general-purpose reference only. No implementation plans,
  design docs, PR/task-specific writeups, gap analyses, or screenshots, and no
  `docs/plans/`, `docs/specs/`, `docs/pr-screenshots/` scratch dirs — that belongs
  in the PR description.
- The diff updates every doc its behavior change makes stale (see
  `AGENTS.md` → Documentation Maintenance): commands/scripts/tooling →
  `AGENTS.md` + `CONTRIBUTING.md`; env vars → `docs/environment-variables.md` +
  `.env.example`; routes → `docs/architecture.md` + feature guides; deployment →
  `README.md` + setup guides; conventions → `AGENTS.md` + this checklist. Grep
  the repo's Markdown for identifiers the diff renames or removes.

<a id="review-commits-versioning"></a>

## Commits & versioning

- Every commit subject starts with a conventional prefix (`fix:`, `feat:`,
  `chore:`, `refactor:`, `test:`, `docs:`, `none:`, `minor:`, `major:`).
- `version` in `package.json` is never edited by hand — CI bumps it from prefixes.
- For a `minor` bump the **PR title** carries the prefix (PRs squash-merge, so the
  title is the commit subject). A `major:` PR becomes a major release only when a
  human maintainer applies the `release:major` label; agents must never apply it.
  Without the label, it becomes a minor release. `.github/`-only changes are no-bump
  unless explicitly `minor:` or `major:`.
- Pre-commit gate is green in order: `yarn run prettier --write .`, `yarn lint`,
  `yarn typecheck`, `yarn build`, `yarn test`.
- All required CI status checks pass (`All Tests`, `Lint and Prettier`, `Build`,
  and `CI Success`).

<a id="review-ci-checklist"></a>

## CI checklist

- Branch protection on `main` requires four status checks: `All Tests`,
  `Lint and Prettier`, `Build`, and `CI Success`.
- `CI Success` is required and fail-closed over lint (`Lint and Prettier`),
  typecheck (`Type Check`), build (`Build`), tests (`All Tests`), PostgreSQL database tests
  (`PostgreSQL Database Tests`), and schema dump checks (`SQLite Schema Dump Sync` and `PostgreSQL Schema Dump Sync`).
  A failure in any upstream check blocks merging via `CI Success`.
