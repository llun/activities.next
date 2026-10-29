# Findings: CONTRIBUTING.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

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

## CONTRIBUTING.md lines 1001-1477

Slice = second half of the "Contributor workflow reference" (Testing Guidelines tail, Known failure classes, Local Manual/Browser Testing, Task Recipes, Design Library Sync, Documentation Maintenance, Commit & PR Guidelines, Code Review Loop, Style/imports/tests, Docs hygiene, Commits & versioning, CI checklist).

### Duplicates
- CONTRIBUTING.md:1161 ≈ CONTRIBUTING.md:223, 492 (also docs/mastodon-api-compatibility.md:1133, AGENTS.md:255) — "safeParse, never .parse()" rule, 4+ statements.
- CONTRIBUTING.md:1162 ≈ docs/mastodon-api-compatibility.md:1120 — resolveStatusIdParam/resolveActorIdParam id rule restated.
- CONTRIBUTING.md:1240, 1256, 1264, 1284 ≈ 1459 (also AGENTS.md:234) — the `release:major` human-label rule appears 5× in this slice alone (bullet, table row, prose, example, checklist).
- CONTRIBUTING.md:1290-1295 ≈ CONTRIBUTING.md:128-137, 377, 429 (also AGENTS.md:10, 226) — the five-step pre-commit gate, 4th copy.
- CONTRIBUTING.md:1296 ≈ CONTRIBUTING.md:128 — husky/lint-staged pre-commit hook description, near-verbatim.
- CONTRIBUTING.md:1298 ≈ CONTRIBUTING.md:1335 — "gemini-code-assist removed / no review bot / don't post /gemini review", twice in the same section pair.
- CONTRIBUTING.md:1053 ≈ CONTRIBUTING.md:1369 (also 1165) — table-driven `it.each` guidance, near-verbatim.
- CONTRIBUTING.md:1416-1436 ≈ CONTRIBUTING.md:897-915 — `vi.importMock` guidance (including the importOriginal caveat) duplicated nearly verbatim within the same file.
- CONTRIBUTING.md:1371-1379 ≈ CONTRIBUTING.md:960-968 — `createDeferred` guidance + the same PostBox war story, twice.
- CONTRIBUTING.md:1385-1389 ≈ CONTRIBUTING.md:973-983 — `runInReactCacheScope` guidance, twice.
- CONTRIBUTING.md:1464-1475 ≈ CONTRIBUTING.md:410-415, 430, 824-829 — required CI checks / `CI Success` fail-closed list, 4th and 5th copies.
- CONTRIBUTING.md:1174 ≈ docs/setup.md:396-409 (also CONTRIBUTING.md:522-535, 822; AGENTS.md:12; REVIEW.md:38) — regenerate both schema dumps + Kysely types rule.
- CONTRIBUTING.md:1157-1166 ≈ CONTRIBUTING.md:489-495 — "Adding a Mastodon-style API endpoint" vs first-half "Adding a New API Endpoint": same recipe, two versions.
- CONTRIBUTING.md:1169-1177 ≈ CONTRIBUTING.md:504-535 (also docs/setup.md:385, docs/maintenance.md:1344) — migration recipe: migrate:make, register in index.ts/names.ts, regenerate dumps.
- CONTRIBUTING.md:1262, 1272 ≈ 1457 — squash-merge / "PR title is the commit subject" rule, twice in-slice.
- CONTRIBUTING.md:1237-1242 ≈ CONTRIBUTING.md:98-108 — commit-prefix list; first half has a simpler stale-ish variant without the version-bump semantics.
- CONTRIBUTING.md:1437-1451 ("Docs hygiene") ≈ CONTRIBUTING.md:1217-1234 ("Documentation Maintenance") — same triggers→docs mapping stated twice, ~15 lines apart in spirit and both in/near this slice.
- CONTRIBUTING.md:1188 ≈ docs/architecture.md:1285-1295 — PageHeader / max-w-content / no-per-page-width rules restated from the architecture guide.
- CONTRIBUTING.md:1092-1104 ≈ docs/quickstart.md:44-59 — ACTIVITIES_INSECURE_AUTH local sign-in gotcha duplicated.
- CONTRIBUTING.md:1125-1127 ≈ docs/maintenance.md:516-539 — createMockUser/createMockStatuses usage duplicated.
- Whole-section: "Commits & versioning" (1452-1468) is a compressed re-statement of "Commit & Pull Request Guidelines" (1235-1301) — prefixes, version field, squash-merge, pre-commit gate, CI checks all repeated.

### Stale
- none — verified: `app/api/v1/routeScopeWiring.test.ts`, `lib/services/guards/OAuthGuard.testUtils.ts` (`stubAccessTokenLookup` present), `app/api/v1/preferences/route.test.ts`, `app/api/v1/notifications/clear/route.scopes.test.ts`, `lib/database/testing/schema.ts`, `app/(timeline)/MainPageTimeline.test.tsx`, `scripts/run.cjs`, `scripts/mock/createMock{User,Statuses}.ts`, `migrations/migration.stub`, `migrations/schema{,.sqlite}.sql`, `lib/config/envAccess.test.ts`, `lib/config/envDocumentation.test.ts`, `lib/testing/{deferred,hydrateServerHtml,reactCacheScope}.ts`, `lib/utils/crypto.test.ts`, `test/setup/vitest.setup.ts`, `scripts/fitness/repairFailedFitnessImports.ts`, `.github/workflows/{tag-version,package,sync-main-to-prod-dispatch,version-bump}.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.env.example`, `docs/{architecture,maintenance,setup,environment-variables,fitness-file-storage}.md`, `lib/client.ts` — all via `git ls-files` / `git grep`; package.json scripts `prettier`, `prettier:check`, `lint`, `typecheck`, `build`, `test`, `migrate`, `migrate:make`, `dev` all exist; Node 24 matches `engines`. Anchors checked: `docs/setup.md` "Keeping the reference schema dumps in sync"/"Regenerating the Kysely DB types", `docs/maintenance.md#create-web-vitals-fixtures`, `docs/architecture.md` "Mobile chrome"/"Page Header & Sub-Navigation"/"Date Serialization", `docs/mastodon-api-compatibility.md` "Client-Facing Entity IDs"/"Zod Validation in API Routes", AGENTS.md "Runtime Configuration Guidelines" — all resolve. Not verifiable from this repo: `activities.prod`'s `sync-upstream.yml` and the `llun/sketch` repo/path (1200) — external/private.
- CONTRIBUTING.md:1199-1200 — `/Users/llun/Documents/llun/sketch` — checked: machine-specific absolute path to a private repo; not stale per se but not durable, portable documentation.

### History / changelog text
- CONTRIBUTING.md:1076 — "\"Shard 4 OOM\" in CI was ... not a heap leak" — past-incident forensics (useful lesson, written as history).
- CONTRIBUTING.md:1078 — "Worker SIGABRT in production is heatmap fan-out × Cloud Run concurrency" — past-production-incident narrative.
- CONTRIBUTING.md:1298 — "The gemini-code-assist bot has been removed" — removal history; repeated at 1335.
- CONTRIBUTING.md:1313 — "Nearly every serious finding after round 1 in past PRs was a regression" — past-PR narrative framing a durable rule.
- CONTRIBUTING.md:1314-1321 — named past-incident walk-throughs (completedAt scan, sendNoteJob/sendUpdateNoteJob leak, verifiedAt DEFAULT) — war stories doubling as review heuristics.
- CONTRIBUTING.md:1372 — "the same eight lines had been copied into four files under three names" — history of the duplication.
- CONTRIBUTING.md:1377-1379 — "it passed with the bug present until the two picker batches were sequenced" — past-bug narrative (duplicates 968).
- CONTRIBUTING.md:1422-1423 — "(Some review bots wrongly flag vi.importMock as non-existent)" — reference to removed reviewers' behavior.

### Long sections
- CONTRIBUTING.md:713-1151 `Testing Guidelines` (~439 lines; slice portion 1001-1151) — far over 80; mixes durable testing rules with tooling walkthroughs and the Known-failure/Local-testing subsections; should be split or moved to docs/.
- CONTRIBUTING.md:1356-1436 `Style, imports & tests` (81 lines) — just over 80; testing-hygiene bullets duplicate Testing Guidelines content and could merge into it.

### Task/PR-specific
- CONTRIBUTING.md:1314-1321 — review heuristics illustrated only by named one-off PR incidents; the durable rule is one line, the rest is case history.
- CONTRIBUTING.md:1145-1151 — hydration-mismatch reproduction recipe (Playwright clock override) tied to one past timestamp bug; candidate for a docs/ guide.
- CONTRIBUTING.md:1082-1151 — Local Manual/Browser Testing is a verified runbook (fine), but it is environment-personal (maintainer's flow) and duplicates docs/quickstart.md setup steps.

### Readability
- CONTRIBUTING.md:1001-1031 — a single bullet ~30 lines long on routeScopeWiring with nested parentheticals and exceptions; nearly impossible to scan.
- CONTRIBUTING.md:1263-1288 — the version-bump rule is stated three ways (prose, table, two example blocks) within 25 lines; could lose one prose pass and one example block.
- CONTRIBUTING.md:1290-1298 — pre-commit bullets are walls of text (1297 packs five separate facts into one sentence).
- CONTRIBUTING.md:1375-1387 — mock-reset bullet buries the rule inside a 60-word parenthetical about mutation testing.
- Repeated "never/always" emphasis (`never`, `must`, `MUST`, bold) throughout 1235-1477; the same prohibitions are re-asserted in 3-5 places (see Duplicates).

### Slice summary
This slice is the agent-facing workflow reference: testing rules tail, task recipes, design-library sync, commit/PR/versioning rules, the sub-agent review loop, and style/checklist sections. It is heavily self-duplicating (pre-commit gate, CI list, release:major, squash-merge, vi.importMock/createDeferred guidance each appear 2-5×, much of it duplicating lines 1-706 and docs/setup.md), and the Code Review Loop + Style sections carry the most history/war-story text. Roughly 30-40% of the slice is restatement or narrative that could be deleted by keeping one canonical statement per rule; the Task Recipes and Local Testing runbooks are the most durable parts and could move to docs/.

