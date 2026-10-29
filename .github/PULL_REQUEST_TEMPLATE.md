<!-- Title rule: PRs are squash-merged, so the PR title becomes the commit
subject on main and MUST start with a conventional prefix. `minor:` in the TITLE
triggers an automated minor bump; `major:` triggers a major bump only when a
human maintainer has applied the `release:major` label (agents must never apply
it); `none:` requests no release. See
[Commit & Pull Request Guidelines](CONTRIBUTING.md#agents-commit-pull-request-guidelines). -->

## Summary

<!-- What changed and why. Link issues with "Fixes #123" / "Relates to #456". -->

## Screenshots

<!-- Optional for UI changes (not required). Delete this section if not
providing screenshots or for changes with no visual surface. -->

## Checklist

- [ ] `yarn run prettier --write .`, `yarn lint`, `yarn typecheck`, `yarn build`, and `yarn test` all pass locally, run in that order
- [ ] Reviewed by separate sub-agent reviewer(s) until clean or 20 rounds (CONTRIBUTING.md → Code Review Loop), or the skipped loop and the reason are disclosed in this description
- [ ] Docs updated: I grepped `*.md` and `docs/` for every command, env var, route, script, or convention this PR renames, removes, or reshapes (AGENTS.md → Documentation Maintenance)
- [ ] If migrations changed: BOTH `migrations/schema.sql` and `migrations/schema.sqlite.sql` are regenerated in this PR
- [ ] If the design changed: `Activities.next.sketch` (and any affected redesign screens) is updated, and the Interactive prototype is regenerated after merge, committed, pushed and published (`scripts/publish.sh`) in `llun/sketch` (CONTRIBUTING.md → Design Library Sync)
- [ ] `version` in `package.json` is untouched (CI bumps it from commit prefixes)
- [ ] No production or operational SQL in this description (schema changes live in `migrations/` only)
