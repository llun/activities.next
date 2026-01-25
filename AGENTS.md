# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the Next.js App Router UI and API routes (see `app/api/` and route groups like `app/(nosidebar)/`).
- `lib/` hosts core domain logic, database access, services, jobs, and shared utilities.
- `migrations/` holds Knex migration files used for SQL backends.
- `public/` serves static assets; `uploads/` and `data/` are used for local storage in some deployments.
- `docs/` includes setup and database-specific guides; `scripts/` includes repo utilities.
- Configuration files live at the repo root (for example `config.json` and `config.*.json`).

## Build, Test, and Development Commands

- `yarn dev` runs the local Next.js development server.
- `yarn build` builds the production app; `yarn start` serves it.
- `yarn lint` runs ESLint across the workspace.
- `yarn test` runs the full Jest suite (all tests run in parallel with SQLite in-memory databases).
- `yarn migrate` applies Knex migrations; `yarn migrate:make <name>` creates a new migration.

## Coding Style & Naming Conventions

- TypeScript + React with 2-space indentation.
- Prettier enforces no semicolons, single quotes, and import sorting (`.prettierrc.yml`).
- ESLint (Next + TypeScript) runs via `yarn lint`; unused vars should be prefixed with `_`.
- Tests are co-located with code and named `*.test.ts`/`*.test.tsx`.

## Logging Guidelines

- **NEVER** use `console.log`, `console.warn`, `console.error`, or any `console.*` methods in committed code.
- Script files in `scripts/` are an exception and may use `console.*` for CLI output.
- For server-side code (API routes, services, jobs, models, lib utilities), use the logger from `@/lib/utils/logger`:
  ```typescript
  import { logger } from '@/lib/utils/logger'

  logger.info({ message: 'Something happened' })
  logger.warn({ message: 'Warning message' })
  logger.error({ message: 'Error occurred' })
  ```
- **Do NOT** use logger in React components or client-side code—logging is for server-side only.

## API Response Guidelines

- Always use `apiResponse` and `apiErrorResponse` from `@/lib/utils/response` for API route responses.
- **Do NOT** use `Response.json()` directly in API routes.
- Example usage:

  ```typescript
  import {
    StatusCode,
    apiErrorResponse,
    apiResponse
  } from '@/lib/utils/response'

  // Success response
  return apiResponse({ data: result })

  // Error response
  return apiErrorResponse(StatusCode.NotFound)
  ```

## Testing Guidelines

- Jest is configured via `jest.config.js` with SWC transforms.
- Prefer unit tests near `lib/` and route tests near `app/`.
- All tests run in parallel using isolated SQLite in-memory databases.

## Commit & Pull Request Guidelines

- Commit messages are short and imperative (examples in history: “Fix build”, “Update dependencies”, “Bump …”).
- PRs should include a clear summary, linked issues (if any), test results, and notes for config/migrations.
- Include screenshots or clips for UI changes.- **Before committing**, always run:
  1. `yarn run prettier --write .` to format all files.
  2. `yarn lint` to ensure no linting errors—**must be green before commit**.

## Security & Configuration Tips

- Store secrets and instance settings in `config.json` or environment variables; avoid committing secrets.
- Review `docs/setup.md` and the database setup guides before changing auth, host, or database settings.

## Database Backends & Local Setup

- Supported backends: SQLite (`docs/sqlite-setup.md`) and PostgreSQL (`docs/postgresql-setup.md`).
- Local SQLite is the simplest for development; run `yarn migrate` after updating schema or migrations.
- Tests use isolated SQLite in-memory databases for fast, parallel execution.
- Docker users should mount a persistent volume to `/opt/activities.next` (see `docs/setup.md`).

## Database Compatibility Guidelines

- **All database operations must work with both SQLite and PostgreSQL** (and potentially other SQL backends like MySQL).
- Use Knex query builder for all database operations—avoid raw SQL unless absolutely necessary.
- When writing raw SQL, ensure syntax is compatible across all supported databases.
- Avoid database-specific features unless wrapped with conditional logic for each backend.
- Test migrations and queries against SQLite (used in tests) to catch compatibility issues early.
- Use standard SQL types and avoid vendor-specific extensions (e.g., use `text` instead of PostgreSQL's `varchar[]`).
