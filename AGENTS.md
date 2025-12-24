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
- `yarn test` runs the full Jest suite.
- `yarn test:withoutDatabase` runs tests excluding database-heavy suites.
- `yarn test:database` runs database tests serially.
- `yarn migrate` applies Knex migrations; `yarn migrate:make <name>` creates a new migration.

## Coding Style & Naming Conventions
- TypeScript + React with 2-space indentation.
- Prettier enforces no semicolons, single quotes, and import sorting (`.prettierrc.yml`).
- ESLint (Next + TypeScript) runs via `yarn lint`; unused vars should be prefixed with `_`.
- Tests are co-located with code and named `*.test.ts`/`*.test.tsx`.

## Testing Guidelines
- Jest is configured via `jest.config.js` with SWC transforms.
- Prefer unit tests near `lib/` and route tests near `app/`.
- Use `yarn test:database` when touching database adapters or migrations.

## Commit & Pull Request Guidelines
- Commit messages are short and imperative (examples in history: “Fix build”, “Update dependencies”, “Bump …”).
- PRs should include a clear summary, linked issues (if any), test results, and notes for config/migrations.
- Include screenshots or clips for UI changes.

## Security & Configuration Tips
- Store secrets and instance settings in `config.json` or environment variables; avoid committing secrets.
- Review `docs/setup.md` and the database setup guides before changing auth, host, or database settings.

## Database Backends & Local Setup
- Supported backends: SQLite (`docs/sqlite-setup.md`) and PostgreSQL (`docs/postgresql-setup.md`).
- Local SQLite is the simplest for development; run `yarn migrate` after updating schema or migrations.
- For quick development checks, use `yarn test:withoutDatabase` to skip database tests.
- Docker users should mount a persistent volume to `/opt/activities.next` (see `docs/setup.md`).
