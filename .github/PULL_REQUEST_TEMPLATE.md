<!-- Title rule: PRs are squash-merged, so the PR title becomes the commit
subject on main. It MUST start with a conventional prefix. Use `minor:` or
`major:` in the TITLE to trigger those version bumps; `none:` for no release.
See AGENTS.md → Commit & Pull Request Guidelines. -->

## Summary

<!-- What changed and why. Link issues with "Fixes #123" / "Relates to #456". -->

## Screenshots

<!-- Required for UI changes (before/after where useful). Delete this section
for changes with no visual surface. -->

## Checklist

- [ ] `yarn run prettier --write .`, `yarn lint`, `yarn build`, and `yarn test` all pass locally, run in that order
- [ ] Docs updated: I grepped `*.md` and `docs/` for every command, env var, route, script, or convention this PR renames, removes, or reshapes (AGENTS.md → Documentation Maintenance)
- [ ] If migrations changed: BOTH `migrations/schema.sql` and `migrations/schema.sqlite.sql` are regenerated in this PR
- [ ] `version` in `package.json` is untouched (CI bumps it from commit prefixes)
- [ ] No production or operational SQL in this description (schema changes live in `migrations/` only)
