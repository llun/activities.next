# Claude Code – activities.next

Follow `AGENTS.md` for all project rules. If an `AGENTS.override.md` file is present in a checkout, it takes precedence where it conflicts.

## Key reminders for this machine

- Always use **Node.js 24** for all node/yarn commands.
- Always use **`yarn`** for package management. Never use `npm install` or any other `npm` commands.
- Always create a **new branch** for changes; commit to that branch.
- Treat `ACTIVITIES_*`, `OTEL_EXPORTER_*`, secrets, host/database/storage/auth settings, and `config.json` as runtime-only deployment config. Do not read them in `next.config.ts` or other build-time Next config; builds must work without real deployment environment variables.
- Before committing, run in order:
  1. `yarn run prettier --write .`
  2. `yarn lint`
  3. `yarn build`
  4. `yarn test`
- Start the local dev server with `yarn dev` unless a checkout-specific override says otherwise. The package script binds Next.js to `0.0.0.0`, so only run it on trusted local networks.
- Use the browser to verify any UI changes.
- Do **not** create test users.
- Activity logs: `fediverse_local-activitynext-dev-1` container; DB: `postgres` container.
- For major changes: commit → push → open PR to `main`.
- Every commit message must start with a conventional commit prefix: `fix:`, `feat:`, `chore:`, `refactor:`, `test:`, `docs:`, etc.
- Use `none:` to mark a commit as no-release, `major:` for breaking changes, and `minor:` for new backwards-compatible features. `.github/`-only commits are also treated as no-bump unless they explicitly use `major:` or `minor:`. See `AGENTS.md` for the full version bump guide.
- **For `minor` or `major` version bumps, the PR title MUST start with `minor:` or `major:`.** PRs are squash-merged, so the PR title becomes the commit subject on `main` and drives the version-bump workflow. Individual commit prefixes in the body are also scanned as a fallback, but setting the PR title is the most reliable approach.
- **Do NOT** manually change the `version` in `package.json`. A CI workflow handles version bumps automatically based on commit prefixes.
- **Never call `fetch()` directly in React components.** All client-side API calls must be added to `lib/client.ts` as named exported functions and imported from there.
- **Never pass `new Date()` as a prop from a Server Component to a Client Component.** Pass `Date.now()` (a `number`) instead. Client Components should accept `currentTime: number` and call `new Date(currentTime)` internally. This prevents hydration mismatches.
