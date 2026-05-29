# Claude Code – activities.next

**Always read `AGENTS.md` at the start of any task** and follow it for all project rules. If `AGENTS.override.md` is also present in the checkout, read it as well — it takes precedence over `AGENTS.md` wherever the two conflict. Treat `AGENTS.override.md` as a layer applied on top of `AGENTS.md`, not a full replacement.

## Key reminders for this machine

- Always use **Node.js 24** for all node/yarn commands.
- Always use **`yarn`** for package management. Never use `npm install` or any other `npm` commands.
- Always create a **new branch** for changes; commit to that branch.
- Treat `ACTIVITIES_*`, `OTEL_EXPORTER_*`, secrets, and host/database/storage/auth settings as runtime-only deployment config. Do not read them in `next.config.ts` or other build-time Next config; builds must work without real deployment environment variables.
- Keep `next.config.ts` as a thin Next configuration entrypoint. Do not define reusable utility functions, parsing helpers, or shared constants there; move helper logic into an appropriate `lib/` module and import it.
- Do not read `ACTIVITIES_*` or `OTEL_EXPORTER_*` variables directly, and do not define environment variable name constants, outside `lib/config/`. Add or reuse a config utility and import that instead.
- Before committing, run in order:
  1. `yarn run prettier --write .`
  2. `yarn lint`
  3. `yarn build`
  4. `yarn test`
- Start the local dev server with `yarn dev` unless a checkout-specific override says otherwise. The package script binds Next.js to `0.0.0.0`, so only run it on trusted local networks.
- Use the browser to verify any UI changes.
- Creating **test/mock users** for local verification is allowed. Only create them against a local database (see the database rule below) — never against a remote/shared/production database.
- **Local development must use only a local database:** either **SQLite** (e.g. `ACTIVITIES_DATABASE_CLIENT=better-sqlite3` with a local `*.sqlite3` file) when running on `localhost`, or the **PostgreSQL in the docker-compose stack reachable at `activities.local`**. **Never point local dev/tests at the remote database** (e.g. `34.79.77.243` or any non-local `ACTIVITIES_DATABASE_PG_HOST`). Before running migrations, the dev server, or creating users, confirm `ACTIVITIES_DATABASE` / `ACTIVITIES_DATABASE_PG_HOST` resolves to a local target. In a git worktree, do not reuse the main checkout's `.env.local` if it points at a remote DB — write a worktree-local SQLite config instead.
- Activity logs: `fediverse_local-activitynext-dev-1` container; local DB: `postgres` container (docker compose, `activities.local`).
- For major changes: commit → push → open PR to `main`.
- Every commit message must start with a conventional commit prefix: `fix:`, `feat:`, `chore:`, `refactor:`, `test:`, `docs:`, etc.
- Use `none:` to mark a commit as no-release, `major:` for breaking changes, and `minor:` for new backwards-compatible features. `.github/`-only commits are also treated as no-bump unless they explicitly use `major:` or `minor:`. See `AGENTS.md` for the full version bump guide.
- **For `minor` or `major` version bumps, the PR title MUST start with `minor:` or `major:`.** PRs are squash-merged, so the PR title becomes the commit subject on `main` and drives the version-bump workflow. Individual commit prefixes in the body are also scanned as a fallback, but setting the PR title is the most reliable approach.
- **Do NOT** manually change the `version` in `package.json`. A CI workflow handles version bumps automatically based on commit prefixes.
- **Never call `fetch()` directly in React components.** All client-side API calls must be added to `lib/client.ts` as named exported functions and imported from there.
- **Never pass `new Date()` as a prop from a Server Component to a Client Component.** Pass `Date.now()` (a `number`) instead. Client Components should accept `currentTime: number` and call `new Date(currentTime)` internally. This prevents hydration mismatches.
