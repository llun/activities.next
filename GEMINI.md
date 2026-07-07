# Gemini agents – activities.next

**Read `AGENTS.md` at the repository root before doing anything**, and follow it for all project rules. If `AGENTS.override.md` exists in the checkout, read it too — it takes precedence over `AGENTS.md` wherever the two conflict (a layer on top, not a replacement).

Key gates (full details and the task recipes are in `AGENTS.md`):

- Node.js 24 and `yarn` only — never use `npm` commands.
- Create a new branch for changes; never commit to `main`.
- Before committing, run in order: `yarn run prettier --write .`, `yarn lint`, `yarn build`, `yarn test` — all must pass.
- Commit subjects and PR titles start with a conventional prefix (`fix:`, `feat:`, `chore:`, `none:`, `minor:`, `major:`). Never edit `version` in `package.json`.
- Update every document your change makes stale in the same PR (`AGENTS.md` → Documentation Maintenance).
- If you add/edit/remove a migration, regenerate BOTH `migrations/schema.sql` and `migrations/schema.sqlite.sql`.
