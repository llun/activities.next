# GitHub Copilot Instructions

This file configures GitHub Copilot to follow the project's coding standards and guidelines.

## Primary Reference

Always refer to and follow the guidelines in [AGENTS.md](../AGENTS.md) for all coding decisions.

## Quick Reference (from AGENTS.md)

### Logging

- **NEVER** use `console.log` or any `console.*` methods in committed code (scripts in `scripts/` are an exception).
- Use `import { logger } from '@/lib/utils/logger'` for all server-side logging.
- Do NOT use logger in React components or client-side code.

### API Responses

- Always use `apiResponse` and `apiErrorResponse` from `@/lib/utils/response`.
- **Do NOT** use `Response.json()` directly in API routes.

### Workflow

- Use Node.js 24 and `yarn` only — never `npm` commands.
- Create a new branch for changes; never commit to `main`.
- Commit subjects and PR titles start with a conventional prefix (`fix:`, `feat:`, `chore:`, `none:`, `minor:`, `major:`). Never edit `version` in `package.json`.
- Update every document your change makes stale in the same PR (AGENTS.md → Documentation Maintenance).
- If you add/edit/remove a migration, regenerate BOTH `migrations/schema.sql` and `migrations/schema.sqlite.sql`.

### Before Committing

1. Run `yarn run prettier --write .` to format code.
2. Run `yarn lint` and ensure it passes with no errors.
3. Run `yarn build` and ensure it passes with no errors.
4. Run `yarn test` and ensure it passes with no errors.

### Database Operations

- All database operations must work with SQLite and PostgreSQL, and should avoid assumptions that break MySQL-compatible Knex clients where possible.
- Use Knex query builder; avoid raw SQL unless necessary.
- Avoid database-specific features unless they include backend-specific fallback logic.

### Code Style

- TypeScript + React with 2-space indentation.
- No semicolons, single quotes (enforced by Prettier).
- Prefix unused variables with `_`.

For complete guidelines, see [AGENTS.md](../AGENTS.md).
