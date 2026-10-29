# CI and checks inventory (slice 1)

Snapshot: checkout source as of 2026-10-29. Source references use repository paths and line numbers. Runtime medians use the supplied five-run data under `raw/gh/`; job duration is `completedAt - startedAt`. Per-run totals and source run IDs are included below and summarized in [raw/ci-runs.json](raw/ci-runs.json).

## Checks

| Check / job | Workflow file:line | Trigger | Protects / overlap | Median (min; min–max) |
|---|---|---|---|---:|
| Lint and Prettier | .github/workflows/ci.yml:34-52 | push + pull_request | Oxlint main rules + scripts-only rule; Prettier check. Vitest lint-plugin guard test is complementary and also runs in shards. | 1.67 (1.30–1.78) |
| Type Check | .github/workflows/ci.yml:57-73 | push + pull_request | `tsc --noEmit` against tsconfig.json including tests/scripts. Build overlaps on production-source typing, but build uses tsconfig.build.json and excludes tests. | 0.68 (0.65–0.73) |
| Build + route JS budgets | .github/workflows/ci.yml:75-100 | push + pull_request | Next production build and bundle report `--check`; build typechecks narrower production tsconfig. Docker separately rebuilds image variants. | 1.52 (1.08–2.75) |
| Test Shard 1 of 4 | .github/workflows/ci.yml:118-147 | push + pull_request | SQLite Vitest shard; tests are distributed across four parallel jobs. | 4.10 (3.53–4.90) |
| Test Shard 2 of 4 | .github/workflows/ci.yml:118-147 | push + pull_request | SQLite Vitest shard; tests are distributed across four parallel jobs. | 3.88 (3.23–4.27) |
| Test Shard 3 of 4 | .github/workflows/ci.yml:118-147 | push + pull_request | SQLite Vitest shard; tests are distributed across four parallel jobs. | 4.55 (2.87–4.70) |
| Test Shard 4 of 4 | .github/workflows/ci.yml:118-147 | push + pull_request | SQLite Vitest shard; tests are distributed across four parallel jobs. | 4.57 (2.92–4.67) |
| All Tests aggregator | .github/workflows/ci.yml:149-169 | push + pull_request | Required stable gate for shard matrix; only checks matrix result, no test execution. | 0.05 (0.03–0.07) |
| PostgreSQL Database Tests | .github/workflows/ci.yml:313-723 | push + pull_request | Same explicit files also run in SQLite shards. Incremental coverage is PostgreSQL backend execution, not unique file selection. | 10.18 (7.80–10.80) |
| SQLite Schema Dump Sync | .github/workflows/ci.yml:725-776 | push + pull_request | Fresh SQLite migrations, verifies migration count, regenerates/diffs SQLite schema dump. | 0.47 (0.38–0.48) |
| PostgreSQL Schema Dump Sync | .github/workflows/ci.yml:777-912 | push + pull_request | Fresh PG17 migrations, schema dump, Kysely type parity, and PG14 baseline compatibility. | 1.03 (0.87–1.08) |
| Docker Images Smoke Test | .github/workflows/ci.yml:914-947 | push + pull_request | Builds minimal/full images and exercises runtime startup, v2 instance, Sharp, optional SDK loading, local PostgreSQL query behavior. | 8.32 (7.88–8.53) |
| CI Success aggregator | .github/workflows/ci.yml:948-981 | push + pull_request | Fails unless all upstream jobs succeeded; aggregation only. | 0.05 (0.05–0.18) |

### Other workflow job runtimes (five runs each)

| Workflow / job | Median minutes (min–max) | Run samples |
|---|---:|---|
| `codeql.yml` (.github/workflows/codeql.yml:24-72) / Analyze (javascript) | 12.57 (2.18–13.17) | 40850202124, 40848772211, 40848058743, 40846546919, 40846413318 |
| `package.yml` (.github/workflows/package.yml:9-150) / Build amd64 image | 6.87 (6.70–7.37) | 40850202054, 40848058694, 40846546749, 40844799786, 40765106346 |
| `package.yml` (.github/workflows/package.yml:9-150) / Build arm64 image | 5.73 (5.28–6.23) | 40850202054, 40848058694, 40846546749, 40844799786, 40765106346 |
| `package.yml` (.github/workflows/package.yml:9-150) / Publish Docker Hub manifest | 0.25 (0.22–0.35) | 40850202054, 40848058694, 40846546749, 40844799786, 40765106346 |
| `package.yml` (.github/workflows/package.yml:9-150) / Publish GHCR manifest | 0.27 (0.22–0.30) | 40850202054, 40848058694, 40846546749, 40844799786, 40765106346 |
| `version-bump.yml` (.github/workflows/version-bump.yml:33-150) / Bump Version | 0.00 (0.00–11.27) | 40850202107, 40848058736, 40846546848, 40844799873, 40765106355 |
| `version-bump.yml` (.github/workflows/version-bump.yml:33-150) / Wait for merge batch | 5.13 (5.12–5.77) | 40850202107, 40848058736, 40846546848, 40844799873, 40765106355 |
| `tag-version.yml` (.github/workflows/tag-version.yml:13-57) / Create Version Tag | 0.17 (0.12–0.28) | 40850202002, 40848058697, 40846546834, 40844799817, 40765106401 |
| `sync-main-to-prod-dispatch.yml` (.github/workflows/sync-main-to-prod-dispatch.yml:27-138) / Dispatch Sync Runner | 0.23 (0.22–0.27) | 40800177078, 40614778626, 40434069484, 40255456380, 40151417819 |
| `dependabot-auto-merge.yml` (.github/workflows/dependabot-auto-merge.yml:10-25) / auto-merge | 0.00 (0.00–0.00) | 40848771966, 40846413579, 40845462143, 40843241163, 40838495911 |

### Recent mixed-event CI sample

The latest five CI workflow runs include three `push` and two `pull_request` runs (`raw/gh/list-ci.yml.json`; run IDs 40850202030, 40848772091, 40848058940, 40846547012, 40846413402). This mixed sample differs from the main-only sample above. Its per-job medians are: PostgreSQL Database Tests 10.18 min; Docker Images Smoke Test 7.92; Test Shard 1 4.90; Test Shard 4 4.60; Test Shard 3 4.30; Test Shard 2 4.22; Lint and Prettier 1.77; PostgreSQL Schema Dump Sync 1.03; Build 1.47; Type Check 0.73; SQLite Schema Dump Sync 0.47; each aggregate job 0.05. Full min/max and source data are in `raw/ci-runs.json` → `ciRecentMixedEventSample`.

### Main CI total per run

Wall time is elapsed from earliest job start to latest job completion; summed runner time adds all job durations. Source run IDs are from `raw/gh/list-ci-main.json`.

| Run ID | Started | Wall minutes | Summed runner minutes |
|---:|---|---:|---:|
| 40850202030 | 2026-10-29T09:30:43Z | 8.00 | 37.13 |
| 40848058940 | 2026-10-29T09:14:17Z | 10.55 | 41.52 |
| 40846547012 | 2026-10-29T09:02:39Z | 10.90 | 39.53 |
| 40844799816 | 2026-10-29T08:48:21Z | 10.80 | 41.75 |
| 40765106249 | 2026-10-28T20:38:38Z | 8.77 | 38.08 |

Median across these five runs: **10.55 wall minutes** and **39.53 summed runner-minutes**.
## Vitest and lint guard relationships

`yarn test` is `vitest run` (package.json:17). Vitest includes `**/*.test.{ts,tsx}` with excluded generated/vendor dirs (vitest.config.ts:25-32); the two projects share that set (lines 115-134). Therefore each explicit path in `test-pg` is also part of the SQLite shard suite. `TEST_DATABASE_TYPE=sqlite` is set in the shard job (.github/workflows/ci.yml:138-148); PostgreSQL job runs the same test paths against PostgreSQL by setting up postgres service (lines 316-329) and invoking test list (347-723). This is complementary backend coverage rather than unique file selection.

Lint guard tests are not replaceable by TypeScript: `lint/agentsRules.test.ts` runs actual Oxlint against fixtures and verifies rule diagnostics and repository wiring (lint/agentsRules.test.ts:13-30); `yarn lint` runs Oxlint main config and a dedicated scripts config (package.json:15; lint/oxlintrc.scripts.json:7-24). The plugin covers API response/Zod usage, storage path construction/containment, and component fetch conventions (lint/agentsRules.mjs:358-480). The test is included in Vitest and therefore runs in the shards; it checks lint behavior/wiring, while lint applies rules to production source.

Source-reading tests found include `test/next.config.test.ts` (checks build/runtime config source constraints at lines 264-300), `test/proxy.test.ts` (walks static imports to protect Edge boundary at lines 995-1030), `app/globals.scrollPadding.test.ts` (CSS source parsing, lines 1-19), `test/feed-row-overlays.test.ts` and `test/feed-row-css.test.ts` (source scans, lines 1-6 and 43-77), and `lint/agentsRules.test.ts` (tests plugin/config wiring). These are not simply source rules already enforced by TS; some are actual runtime architecture/config invariants, while lint-plugin tests guard the linter itself. No identified test has demonstrable full duplication with TypeScript alone.

### PostgreSQL `test-pg` file list

The explicit PostgreSQL selection contains **359 paths**; each also matches Vitest's configured `**/*.test.{ts,tsx}` include, so all 359 run in SQLite shards too (Vitest config `vitest.config.ts:25-32`; shard job `.github/workflows/ci.yml:138-147`; PostgreSQL list `.github/workflows/ci.yml:347-723`). The exact list is in [raw/test-pg-files.csv](raw/test-pg-files.csv), with columns `path`, `alsoInShards`, and `pgOnlyBehaviour`. The backend delta for each file is executing its assertions against PostgreSQL; the workflow file list alone does not establish which individual assertions are PostgreSQL-exclusive. **Exceptions: none** in file inclusion; no listed path falls outside the Vitest glob.

## Trigger duplication and workflow overlap

`ci.yml` and `codeql.yml` both run on `push` and `pull_request` (.github/workflows/ci.yml:18-20; .github/workflows/codeql.yml:14-20). For a PR commit pushed to its branch, GitHub may produce both branch-push and PR-event runs; there is no workflow-level path filter or deduplication shown in these files. CI explicitly tests the PR merge ref according to its comments (.github/workflows/ci.yml:13-16), so the two events can represent different refs/merge states rather than guaranteed same-commit duplicate work. The supplied CI run lists expose event and branch but not head SHA (`raw/gh/list-ci.yml.json`), so same-commit duplication cannot be confirmed from these artifacts.

Package runs on main pushes and builds publishable multi-architecture images (.github/workflows/package.yml:3-8, 9-88), while docker-smoke builds and runs minimal/full images (.github/workflows/ci.yml:914-947). This is meaningful build overlap, but smoke covers local runtime/content checks and package covers publication/manifests.

## Consolidation candidates

The table ranks checks by measured median runner time as an upper-bound saving if removed entirely. These are **not safe drop recommendations**: each check provides a distinct backend, packaging, security, or compatibility signal. Wall-time reduction is measured from sampled jobs with fan-in jobs excluded; parallelism means it is smaller than runner-minute savings. Source durations are in `raw/ci-runs.json`; five source run IDs are listed in the totals table above.

| Candidate to evaluate | Evidence and measured potential | Estimated savings if removed (runner; median CI wall) | Coverage tradeoff |
|---|---|---:|---|
| `test-pg` | 10.18 median job minutes, range 7.80–10.80; same 359 paths also execute in SQLite. `.github/workflows/ci.yml:313-723`; file list CSV above. | **10.18; 2.17 min** | Loses PostgreSQL execution. Consider only if a PostgreSQL mode is retained inside the unified suite; regrouping alone saves no work. |
| `docker-smoke` | 8.32 median job minutes, range 7.88–8.53; `.github/workflows/ci.yml:914-947`. | **8.32; 0.00 min** | Loses image startup/content, Sharp, optional workspace, and local-PG runtime checks. Package builds do not demonstrate those checks. |
| `schema-dump-check-pg` | 1.03 median job minutes, range 0.87–1.08; `.github/workflows/ci.yml:777-912`. | **1.03; 0.00 min** | Loses PG17 schema/type drift and PG14 baseline compatibility. Could consolidate setup with SQLite dump job only if both backend assertions remain. |
| `typecheck` | 0.68 median job minutes, range 0.65–0.73; `.github/workflows/ci.yml:57-73`. | **0.68; 0.00 min** | Not redundant with `next build`, which checks the narrower build tsconfig and excludes tests/scripts (`.github/workflows/ci.yml:54-56`). Retain unless equivalent all-file checking is moved. |
| `schema-dump-check` | 0.47 median job minutes, range 0.38–0.48; `.github/workflows/ci.yml:725-776`. | **0.47; 0.00 min** | Loses SQLite schema dump parity. Combining with PG dump job may reduce duplicate setup, but net savings are not measured; preserve the parity assertion. |

These estimates are observed job-duration medians, not predicted savings from a refactor. Measured wall reduction is zero for most candidates because another parallel check remained the critical path in the sampled runs. The only candidate with nonzero median wall reduction was `test-pg` (2.17 min).
