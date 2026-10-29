## CONTRIBUTING.md lines 1-1000

### Duplicates
- CONTRIBUTING.md:408-419 ≈ CONTRIBUTING.md:824-828 ≈ CONTRIBUTING.md:1471-1476 — "Branch protection on `main` requires four status checks" + "`CI Success` is fail-closed over all upstream CI checks" stated three times (third occurrence starts in slice at 1471).
- CONTRIBUTING.md:415 ≈ CONTRIBUTING.md:430 — the fail-closed `CI Success` check list (lint/typecheck/build/tests/PG tests/schema dumps) appears verbatim again in the PR Checklist bullet.
- CONTRIBUTING.md:223 (`safeParse`, never `.parse()`, `.max(255)`, empty→null) ≈ CONTRIBUTING.md:482 ≈ CONTRIBUTING.md:1161 ≈ docs/mastodon-api-compatibility.md:1133 ≈ docs/mastodon-api-compatibility.md:1751 — Zod validation rule duplicated five times across two files (grep: `git grep -nF 'never `.parse()`'`).
- CONTRIBUTING.md:201-220 (`apiResponse`/`apiErrorResponse`, CORS endpoints use `apiResponse` for errors too) ≈ AGENTS.md:196-213 ≈ CONTRIBUTING.md:484 ≈ docs/architecture.md:3474-3476 — API response helper rule stated in 3+ places (grep: `apiErrorResponse`).
- CONTRIBUTING.md:186-190 (never `console.*`, migrations/scripts exception, use logger) ≈ AGENTS.md:178-179 ≈ docs/architecture.md:3474-3476 ≈ CONTRIBUTING.md:434 — console/logging rule duplicated four times (grep: `console.*`).
- CONTRIBUTING.md:134-137 (Oxlint two-pass over repo then `scripts/` with `lint/oxlintrc.scripts.json`, one rule) ≈ docs/setup.md:380 — same lint-architecture explanation in both files.
- CONTRIBUTING.md:141-143 ≈ CONTRIBUTING.md:373-377 ≈ CONTRIBUTING.md:428 — `yarn run prettier --write .` + `yarn lint` command block repeated three times in-file.
- CONTRIBUTING.md:285-287 (Vitest, `vi.*` API, "there is no `jest` global") ≈ CONTRIBUTING.md:718-724 — Vitest-vs-jest guidance stated twice in the same file.
- CONTRIBUTING.md:271-290 (PostgreSQL 17 docker container + `TEST_DATABASE_TYPE=pg` env recipe) ≈ CONTRIBUTING.md:866-880 — pg test-harness setup described twice; also near-overlaps the docker postgres recipe at 563-590.
- CONTRIBUTING.md:391 ("update every doc your change makes stale … see AGENTS.md → Documentation Maintenance") ≈ CONTRIBUTING.md:427 (PR Checklist doc bullet) — same doc-sync rule twice in one section pair.
- CONTRIBUTING.md:268-290 (`createTestDatabase` in `lib/database/testing/`, `test_<VITEST_POOL_ID>` per-worker DBs) ≈ CONTRIBUTING.md:866-880 — same harness mechanics twice.

### Stale
- none — checked: all referenced files/scripts/symbols/env vars exist. Specifically verified via `git ls-files`: `.env.example`, `.oxlintrc.json`, `lint/oxlintrc.scripts.json`, `lint/agentsRules.mjs`, `migrations/index.ts`, `migrations/names.ts`, `migrations/schema.sql`, `migrations/schema.sqlite.sql`, `migrations/baseline/`, `lib/database/testUtils.ts`, `lib/database/testing/{createTestDatabase,fixtures,schema,staleRead}.ts`, `lib/database/connection.ts`, `lib/utils/{logger,response}.ts`, `lib/client.ts`, `lib/config/__mocks__/index.ts`, `test/setup/{jest-global,vitest.setup}.ts`, `test/vitest.d.ts`, `lib/testing/{withTimeZone,deferred,reactCacheScope}.ts`, `lib/services/auth/auth.ts`, `lib/services/guards/`, `lib/jobs/{names,index}.ts`, `scripts/database/migrate.ts`, `packages/{cloudtasks,pg,qstash}`, `scripts/{backup,fitness,maintenance,mock}/`, `tsconfig.build.json`, `Dockerfile`, `vitest.config.ts`, `next.config.ts`, `.github/workflows/{ci,package}.yml`, `app/api/v1/fitness/general/regenerate-maps/route.test.ts`, `app/(timeline)/[actor]/profileFollowLookup.test.ts`. Checked in `package.json`: scripts `dev/build/lint/typecheck/test/prettier:check/migrate/migrate:make/migrate:status/migrate:down/migrate:unlock`, `engines.node=24.x`, `packageManager=yarn@4.18.1`, `prettier` config, deps `better-sqlite3`, `jest-fetch-mock`. Checked `.env.example`: `ACTIVITIES_HOST`, `ACTIVITIES_SECRET_PHASE`, `ACTIVITIES_DATABASE_CLIENT`. Checked `.github/workflows/ci.yml`: all eight named check names present (`All Tests`, `Lint and Prettier`, `Build`, `Type Check`, `PostgreSQL Database Tests`, `SQLite Schema Dump Sync`, `PostgreSQL Schema Dump Sync`, `CI Success`); `activities-next-minimal-${{ matrix.slug }}` cache scope in package.yml matches the doc's amd64/arm64 scopes. Checked `vitest.config.ts`: `TZ=UTC` pin at line 20, `LOG_LEVEL: 'silent'`, and the `test.env`-vs-main-process comment the doc describes. Checked `lib/database/testing/staleRead.ts` (`withStaleFirstRead`), `lib/testing/deferred.ts` (`createDeferred`), `lib/testing/reactCacheScope.ts` (`runInReactCacheScope`), `lib/database/testing/createTestDatabase.ts` (`captureQueries`, `onQuery`, `pendingAcquires`), `lib/services/auth/credentialIdentity.test.ts` (`TEST_BCRYPT_COST`), `.oxlintrc.json:173` (date-fns `no-restricted-imports`), `migrations/names.ts:7` (`20261014000000_baseline`).

### History / changelog text
- CONTRIBUTING.md:246-249 — "a legacy pattern from before the `lib/client.ts` rule" (Change*Form components still call `fetch()`); migration-tracker text, belongs in an issue.
- CONTRIBUTING.md:466-467 — "they are the schema the Knex migrations of v1.192.34 left" — version history aside; the durable rule is just "never edit".
- CONTRIBUTING.md:735-742 — "before the pin a date assertion that only held there passed review" + "The bug that prompted it — an `<input type=\"date\">` value" — past-bug narrative.
- CONTRIBUTING.md:805-811 — "the split cut a full run by about a fifth on a 14-core machine … Two faster options were measured and declined: `isolate: false` failed 163 files" — "we tried" benchmark history.
- CONTRIBUTING.md:852-855 — "three review rounds of one PR reported its job suite 'verified on PostgreSQL 17'" — PR-history anecdote.
- CONTRIBUTING.md:895-897 — "some review bots incorrectly claim it does not exist; do not 'fix' it on their say-so" — narrative about past review-bot comments.
- CONTRIBUTING.md:917-919 — "The same eight lines had been reimplemented in four test files under three different names before they were extracted" — origin story.
- CONTRIBUTING.md:921-926 — "PostBox attachment ref guard is the sharpest example … thirteen more tests across `MessagesPage`, `SearchPageClient` and `FitnessHeatmapView` fail outright" — past-bug war story tied to specific test names.
- CONTRIBUTING.md:963-970 — "one had left a route test passing without ever reaching the filter it tests (`app/api/v1/fitness/general/regenerate-maps/route.test.ts` …)" — describes a specific past bug/PR.

### Long sections
- CONTRIBUTING.md:522-687 `#### Updating the reference schema dumps` (166 lines) — procedural recipe; could move to a `docs/` guide or script, leaving a 3-line rule + link here.
- CONTRIBUTING.md:563-644 `##### PostgreSQL — migrations/schema.sql` (82 lines) — sub-recipe of the above; mostly commands, fine in a script/guide.
- CONTRIBUTING.md:713-1000 `## Testing Guidelines` (288 lines in slice; section runs to ~1476) — far over 80; needs splitting into subsections (harness, mocking, timing/zones, isolation); several single bullets exceed 25 lines.
- CONTRIBUTING.md:271-336 `### Running PostgreSQL Database Integration Tests` (66 lines) — under 80 but the 33-file hardcoded test list (292-336) dominates; a glob or `yarn test:pg` script would shrink it to ~10 lines.

### Task/PR-specific
- CONTRIBUTING.md:292-336 — hardcoded list of 33 specific test file paths for the pg harness run; brittle and grows with every pg-relevant suite; should be a glob or package.json script.
- CONTRIBUTING.md:414-420 — two paragraphs of CI build-cache internals (`.next/cache` key composition, lockfile-prefix restore, Docker BuildKit scopes in package.yml); CI-workflow commentary, not contributor guidance.

### Readability
- CONTRIBUTING.md:713-1000 — wall-of-bullets: single bullets of 25-30 lines with nested sub-caveats (e.g. 757-786 worker-threads rule, 866-880 pg harness) that bury the actionable rule under rationale; rationale could be collapsed or moved to comments in `vitest.config.ts`.
- CONTRIBUTING.md:568-590 — the "Heads up on environment isolation" block is a 20-line nested caveat; could compress to "set vars inline; prefix with empty `ACTIVITIES_DATABASE=`; check `env | grep ACTIVITIES_DATABASE` first".
- CONTRIBUTING.md:32-85 + 87-115 — Getting Started / workflow sections are generic open-source boilerplate (fork/clone, branch naming, conventional commits) that carries little project-specific weight.
- CONTRIBUTING.md:337-368 "Writing Tests"/"Test Coverage" ≈ generic advice (AAA, descriptive names, coverage) that overlaps the far more specific Testing Guidelines section.

### Slice summary
Lines 1-478 are a conventional contributing guide (setup, style, PR process, project structure); lines 487-687 are a long but mostly durable migration/schema-dump recipe; lines 707-1000 begin the migrated "Contributor workflow reference" (Testing Guidelines), which is the heaviest section — dense, anecdote-laden, and duplicated against AGENTS.md/docs. Biggest wins: collapse the 3x-repeated CI-check/CI-Success text, move the schema-dump recipe to a script or docs guide, split Testing Guidelines into subsections and strip its past-PR narratives, and replace the 33-file pg test list with a script. No stale references found in this slice.
