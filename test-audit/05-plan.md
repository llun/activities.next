# 05 — Test and CI reduction plan (one suite)

Executable plan, no code changes yet. Counts come from `04-judgement/` (59 slices), the strict route-covered rerun `raw/rcu-part00..03.csv`, and `raw/durations.csv`; minutes from `01-ci-inventory.md` (medians of 5 main runs). Estimates are marked as estimates.

## 1. Target state: ONE suite

One Vitest suite (`vitest.config.ts`, `threads` + `forks` projects), backend-parametric, sharded in CI. No unit/route/PG/schema-dump tiers — only two execution environments remain: the sharded suite (SQLite, everything) and one PG-mode run of the same suite's DB-touching files. Docker smoke is the single exception (see §3).

### (a) Backend selection today, and what a backend matrix costs

- Today `test-pg` selects PostgreSQL purely by env: `TEST_DATABASE_TYPE: pg` plus service connection vars (.github/workflows/ci.yml:710-715), then passes 359 hand-written paths to `yarn test --maxWorkers=2` (ci.yml:347-723). The harness does the rest: `createTestDatabase()` defaults to `pg` under that env (lib/database/testing/createTestDatabase.ts:66); every file's `beforeAll` drops/recreates its worker's PG database and replays `migrations/schema.sql` (vitest.config.ts:102-107 raised `hookTimeout` for exactly this).
- A file is PG-capable iff it gets its DB through `createTestDatabase`/`getTestDatabaseConfig` — 324 test files do — or it never opens a DB at all (jsdom component/client tests, backend-indifferent).
- **Running ALL 1,974 files on PG is mechanically feasible** (the suite is parametric end to end) but is the wrong shape: ~1,650 files never touch a DB, so a second run adds zero PG signal; and a minority are SQLite-specific and would fail or assert nothing on PG — `lib/database/getSQLDatabase.test.ts`, `lib/database/scriptDatabase.test.ts`, the SQLite dump/`EXPLAIN` query-plan suites (89 files mention sqlite; most are parametric, the SQLite-only ones need `backend: 'sqlite'` pinning or `skipIf`). 89 files would need an audit before a full matrix.
- **Cost, shards x2 vs test-pg:** today's shards are 4.1–4.6 min each (17 runner-min); a PG shard pays the per-file database recreate on every DB file, est. 6–9 min each, so a full backend matrix costs est. +17–20 runner-min — roughly double today's 10.18-min `test-pg` job for near-zero extra signal.
- **Target instead:** keep 4 SQLite shards (whole suite, unchanged); replace the hand list with a **generated** PG selection of the DB-touching files (a selection script or a `pg` Vitest project keyed on `createTestDatabase` usage; diff its output against `raw/test-pg-files.csv` on landing). Phase A: ~350–400 files, est. 10–12 job min — cost-neutral, the 377-line hand list and its drift risk die. Phase B: shrink to the backend-sensitive set (`lib/database/**` + the media/statuses/auth route and service dirs the old list concentrated on), est. 5–7 job min, wall est. −1.5–2 min (the only measured wall lever is `test-pg`, 2.17 min; 01-ci-inventory).

### (b) Folding the remaining tiers

| Tier today | Fold into | Why |
|---|---|---|
| `schema-dump-check` (SQLite, 0.47 min, ci.yml:725-776) | The suite: one ordinary test (fresh temp SQLite → `yarn migrate` → dump pipeline → diff `migrations/schema.sqlite.sql`), runs in shards | Pure Node work, no service; removes a job and its checkout/install overhead. Assertion unchanged. |
| `schema-dump-check-pg` (1.03 min, ci.yml:777-912) | The suite's PG run: PG17 dump + Kysely type parity as ordinary tests under `TEST_DATABASE_TYPE=pg`; PG14 baseline compat as a step of the PG job (it already runs service containers) | Needs a PG service, which the PG job has; type parity is a compile/diff a test can own. |
| `docker-smoke` (8.32 min, ci.yml:914-947) | **Stays a separate job — stated reason:** it builds minimal/full Docker images and asserts runtime startup, Sharp/native module loading, optional SDK loading, and local PostgreSQL *inside the container*. None of that can execute inside Vitest, and `package.yml` image builds do not assert it (01-ci-inventory). The only non-Vitest tier left. |
| Source-text guard tests (71 files, 02-metrics) | Split: est. ~20 lint-expressible guards become oxlint rules in `lint/agentsRules.mjs` (surface-kit usage, raw `<select>`/`<input type=checkbox>`, Tailwind v3 var syntax, Alert outside Frame, env reads outside `lib/config`, `next.config.ts` source shape, ungated `content-visibility`); the rest stay as ordinary suite tests | The non-convertible ones guard non-JS artifacts no linter sees: workflow YAML (slice 000), CSS text (`test/feed-row-css.test.ts`, 058), the transitive import walk (`test/proxy.test.ts:1019`), the migration registry (`lib/database/migrate/index.test.ts:178`), transaction/visibility call sites (039). They already run in shards — no tier to remove, only the lint-expressible ones move. |

## 2. Deletion rules (strict evidence rule)

- **R1 Trivial → delete.** Asserts only rendered presence, fixed class lists, constants, structure — no behaviour (the 241 `04-judgement` Trivial bullets). Re-read each bullet in the PR; keep any that turns out to assert behaviour.
- **R2 Route-covered unit → delete/trim only where the strict rerun says so** (`raw/rcu-part00..03.csv`): delete a case only when a specific route-test line ASSERTS the same output — name the asserting line (`coveringRouteTest` column) in the PR description. Coverage containment (`raw/coverage-overlap.csv`) is a candidate signal, not evidence.
- **R3 Keep pure-logic units with edge-case tables** the route test does not exercise (error tables, boundaries, unicode/empty inputs). The strict rerun kept 32 files / 240 cases outright for exactly this reason.
- **R4 One behaviour, one layer** (CONTRIBUTING.md:991-996 mandates this). Same-behaviour copies keep one test, at the owning layer.
- **R5 Per-route 401/scope → delete the route's copy** once the route is pinned in `EXPECTED` in `app/api/v1/routeScopeWiring.test.ts` (CONTRIBUTING.md:997-1008). Never delete the wiring test.
- **R6 Guards → convert then delete** (see §3 table). Non-lint-expressible guards stay.
- **Discount on flash duplicates (important):** the 463 `04-judgement` Duplicates were judged by GLM-5.3-flash under a looser standard; the strict rerun cut the flash "remove" estimate for route-covered files roughly in half (part01: 196 → 91 cases; part03: 154 → 109). This plan therefore uses the strict verdicts verbatim where they exist (lib/services, lib/database route-covered files) and applies a **50% discount** to flash duplicate bullets outside that set: est. ~140 of 286 bullets survive as real removals. Every duplicate-removal PR must name the asserting line on the other side or the case stays.

Rule conflicts: CONTRIBUTING.md:991-1008 already mandates de-duplication — the plan executes existing policy. AGENTS.md:10 (DoD gate green) applies to every PR. AGENTS.md:158/173/318 and CONTRIBUTING.md:1180 name tests that must survive (as lint rules or behaviour tests), listed in §5.

## 3. Strict route-covered rerun (raw/rcu-part00..03.csv)

111 lib unit files whose lines are contained in a route test, re-judged under the strict rule (delete only when a route-test line asserts the same output). Supersedes the looser `raw/rcu-rejected/*.flash.csv` verdicts (which, e.g., deleted email-template tests the route never asserts).

| Directory | Files | Verdict | Cases | Keep | Removed |
|---|---:|---|---:|---:|---:|
| lib/services | 93 | 5 delete, 64 trim, 24 keep | 901 | 582 | 319 |
| lib/database | 18 | 10 trim, 8 keep | 183 | 143 | 40 |
| **Total** | **111** | **5 delete, 74 trim, 32 keep** | **1,084** | **725** | **359** |

Whole-file deletions: `lib/services/accountImport/serialize.test.ts`, `lib/services/accounts/getMuteExpiresAt.test.ts`, `lib/services/accounts/profile.test.ts`, `lib/services/domains/domainScope.test.ts`, `lib/services/fitness-files/statusFitnessFiles.test.ts`.

## 4. Sequenced PRs (smallest risk first)

Verification default: full DoD gate green. For R2 PRs also run `node test-audit/scripts/coverage-per-file.mjs <dirs>` before/after (script lives on the `test-audit/data` branch — carry it in the working tree, do not commit); no source file may lose its last covering test. Coverage data exists only for app/api, lib/services, lib/database.

| # | PR | Scope | Est. removals | Est. minutes |
|---|---|---|---|---|
| 1 | Trivial deletions, whole repo | 04-judgement Trivial bullets, all 59 slices | ~220 cases, est. 25–40 whole files (page smokes, skeleton/class-constant renders) | est. −0.5–1 shard min; −1–2 runner-min |
| 2 | Route-covered lib units, strict verdicts | `raw/rcu-part00..03.csv`: 5 files deleted, 74 trimmed (slices 035–053 region) | 359 cases (1,084 → 725); 5 files whole | est. −0.2 shard min; −0.5 runner-min |
| 3 | app/api duplicate 401/scope cases | Duplicates in slices 009–017; keep `routeScopeWiring.test.ts` | est. ~55 of 62 bullets (each route must be in `EXPECTED`) | est. −0.2 shard min |
| 4 | Remaining duplicates, strict rule + 50% discount | Duplicates in slices 000–008, 018–034, 041–058 outside the rcu set (lib/components 119, app/(timeline) 43, lib/client 12, lib/utils 17, lib/jobs 12, rest ~28) | est. ~140 cases, est. 10–20 files trimmed to empty | est. −0.5–1 shard min; −1–2 runner-min |
| 5 | Guard → oxlint conversion | Lint-expressible guards: slices 032, 033, 034, 003, 021, 058, 057 subsets | est. ~20 guards → `lint/agentsRules.mjs` rules + fixtures; the source-scan tests deleted | lint job 1.67 → est. ~1.9; shards est. −0.2 |
| 6 | One-suite CI restructure | ci.yml: replace test-pg hand list (347-723) with generated PG selection; fold both schema-dump jobs (725-912) into the suite/PG job | 377 workflow lines + 2 jobs; Phase B shrinks PG set | Phase A cost-neutral; Phase B est. 10.2 → 5–7 job min, wall est. −1.5–2; dumps fold est. −1.5 runner-min |

PR 6 can land at any point but goes last so the PG job already runs the reduced suite. Phase B of PR 6 needs the SQLite-only files (§1a) pinned to `backend: 'sqlite'` first.

**Totals (estimates):** ~775 cases removed (220 trivial + 359 strict route-covered + ~55 api + ~140 discounted), est. 50–70 whole files, ~20 guards to lint. CI: runner-minutes 39.5 → est. 31–34; wall 10.55 → est. 8.5–9.5 (only Phase B of PR 6 moves wall time; everything else is runner-minutes and shard length, from `raw/durations.csv`: whole suite sums to 8.2 local min).

## 5. Do not cut

- `app/api/v1/routeScopeWiring.test.ts` (:829-833, :1136) — the centralized guard that makes PR 3 safe.
- The 32 keep-verdict files and all `keepLines` in the rcu CSVs — edge-case tables the routes never assert.
- PG execution of DB-touching files (`raw/test-pg-files.csv`): the hand list goes, the PG run stays.
- Schema-dump parity assertions themselves (both backends) — only the jobs around them fold (AGENTS.md:12).
- `docker-smoke` (ci.yml:914-947) — image runtime cannot run inside Vitest (§3).
- Non-lint-expressible guards: `.github/workflows/*.test.ts` YAML/policy guards (000), `test/feed-row-css.test.ts` (058), `test/proxy.test.ts:1019` import walk, `lib/database/kysely/transactionCallSites.test.ts:109`, `lib/database/statusVisibilityCallSites.test.ts:323`, `lib/database/migrate/index.test.ts:178` (039).
- `lint/agentsRules.test.ts` (057) — guards the linter; grows with PR 5.
- Security-shape guards: `accountExport.test.ts:71` secret-column allowlist, `actorDeletionQueries.test.ts:1369` purge ordering (035).
- Real-bug guards, convert-don't-delete: `tailwindCssVariableSyntax` (AGENTS.md:173), `sectionNavPattern` (AGENTS.md:318), `envAccess` (CONTRIBUTING.md:1180), `next.config` behaviour tests (AGENTS.md:158).
- `test/vitest.config.test.ts` TZ pin and the shard job's deliberate `TZ: Pacific/Noumea` (CONTRIBUTING.md:723-744, ci.yml:143-148).
- The 2 failing zip streaming tests (`lib/jobs/exportAccountArchiveJob.test.ts`, `lib/services/accountArchive/zipFormat.test.ts`) — fix, do not delete.

## 6. Open questions

1. Phase B PG scope: `lib/database/**` + media/statuses/auth route dirs, or keep every DB-touching file on PG permanently?
2. Is a full backend matrix (shards x2, est. +17–20 runner-min) ever wanted, or is the generated-subset PG job the end state?
3. PG14 baseline compat: fold as a step of the PG job, or keep `schema-dump-check-pg` until that's proven?
4. docker-smoke: keep both image variants (8.3 min) or trim to the minimal image (est. −3–4 min)?
5. Whole-file deletion for render-smoke page tests, or keep one render smoke per page?
