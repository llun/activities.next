# Claude Code – activities.next

Follow `AGENTS.md` and `AGENTS.override.md` for all project rules.
`AGENTS.override.md` takes precedence over `AGENTS.md` where they conflict.

## Key reminders for this machine

- Always use **Node.js 24** for all node/yarn commands.
- Always create a **new branch** for changes; commit to that branch.
- Before committing, run in order:
  1. `yarn run prettier --write .`
  2. `yarn lint`
  3. `yarn build`
  4. `yarn test`
- Start the local dev server via the script in `AGENTS.override.md`.
- Use the browser to verify any UI changes.
- Login: username `llun` / email `llun@activities.local` / password `1password;` at https://activities.local
- ActivityPub peer account: `null@llun.dev` at https://mastodon.local
- Do **not** create test users.
- Activity logs: `fediverse_local-activitynext-dev-1` container; DB: `postgres` container.
- For major changes: commit → push → open PR to `main`.
- When creating a PR, always prefix the PR title with `fix: `.
