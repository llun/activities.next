# Codex Sol review of 05-plan.md

Reviewer: GPT-6.1 Sol (high effort) via Codex. Codex quota was 69% weekly and 99% for the five-hour window when it ran. It worked read-only in a single pass with no sub-agents and made 14 tool calls. The text below is its answer verbatim.

---

## 1. Disagreements

- **The proposed PG selector would omit existing coverage.** The 324 direct helper-name matches are reproducible, but **107 of today's 359 PG-selected files contain neither helper name**. For example, `lib/database/domains/media/media.test.ts:10` uses `getTestDatabaseTable`, which reaches `createTestDatabase` through `lib/database/testUtils.ts:19–21`. Including two wrapper names raises the candidate set to 429 files, with further indirect users remaining. The "~1,650 files never touch a DB" claim and Phase A's 350–400-file estimate are therefore unsupported (`05-plan.md:12–15`).

- **The SQLite-specific examples are misclassified.** `lib/database/getSQLDatabase.test.ts:85–90` uses a mock Kysely instance; `lib/database/scriptDatabase.test.ts:83–98` explicitly enables a real PostgreSQL case in PG mode. Blanket SQLite pinning or exclusion would lose that case (`05-plan.md:13`).

- **At least two strict verdicts fail their own assertion-equivalence rule.**
  - Deleting `lib/services/accountImport/serialize.test.ts:27–49` loses exact ISO timestamp and default-progress assertions. The cited route checks assert report/status subsets (`app/api/v1/account/imports/route.test.ts:815–846`). Another route assertion pins output keys at `:209`, but not those values.
  - `lib/services/accounts/profileFields.test.ts:10–24` supplies index 1 before index 0, proving sorting. Its proposed replacement supplies indices in ascending order (`app/api/v1/accounts/profile/route.test.ts:233–239`), so insertion-order output would still pass.

  Recheck `raw/rcu-part00.csv:22` and `raw/rcu-part01.csv:3`; do not execute these CSVs verbatim.

- **"Trivial" includes real behavior.** The Histogram test checks accessibility exposure, including exactly one image role (`lib/components/photo-editor/Histogram.test.tsx:94–100`), despite its classification in `04-judgement/027.md:11`. The queue-worker startup test proves refresher wiring (`scripts/maintenance/runQueueWorker.test.ts:33–38`), despite `04-judgement/057.md:7`. R1 needs explicit accessibility and wiring exceptions.

- **One guard description reverses the requirement.** `04-judgement/032.md:16` says Alerts must sit inside Frames. The actual guard prohibits that nesting (`lib/components/surface/alertOutsideFrame.test.ts:7–16,105–122`). Conversion must follow source behavior.

- **The arithmetic matches; the units and savings need correction.** The CSVs total 111 files, 1,084 → 725 "cases," and 359 removals. However, these are declaration counts, not expanded test counts (`02-metrics.md:10`): `getMuteExpiresAt.test.ts:4–15` alone expands one declaration into two tests. The measured 10.55 wall minutes, 39.53 runner-minutes and 10.18-minute PG job match the inventory (`01-ci-inventory.md:17,54`). Folding schema jobs cannot save their entire 1.5 minutes while retaining their work; only eliminated overhead is saved (`05-plan.md:65`).

## 2. Risks and missing verification

- **The prescribed coverage rerun can silently reuse old results.** The script resumes from existing output and skips recorded filenames (`test-audit/scripts/coverage-per-file.mjs:23–44`). It also records failures without explicitly failing the overall process (`:94–113`). Require separate clean before/after datasets, matching revisions, complete successful runs, and comparison of covered statements and branches—not merely "every source file still has coverage."

- **Scope deduplication needs the complete exception list.** Preserve the real-guard read/write canaries, `AuthenticatedGuard` checks, custom session checks, and routes guarded inside their handlers. `EXPECTED` membership alone is insufficient (`CONTRIBUTING.md:1010–1022`). The plan's protected list omits the two canaries.

- **Phase B's directory shortlist is not evidence of backend independence.** Queries execute through jobs and services outside database/media/status/auth directories. Require an explicit omission rationale and verified backend selection. Some helpers silently force SQLite even under PG environment variables (`lib/database/testUtils.ts:48–52,82–89`).

- **Schema folding must preserve more than dump equality.** Both jobs verify migration registration/execution counts (`.github/workflows/ci.yml:747–755,838–846`). Preserve fresh databases, normalization, generated-type parity, and PG14's migration-and-dump check (`:886–911`). The existing PG test job supplies only PG17 (`:318`); another service must be added. Ordinary harness databases load dumps and cannot establish migration parity.

- **Lint conversion needs configuration parity.** `*.config.ts` and `scripts/**` are currently ignored by the main lint configuration (`.oxlintrc.json:29–32`). The environment guard scans root entrypoints and a migration script (`lib/config/envAccess.test.ts:8–12`). Add positive, negative, exception, and actual-config fixtures before deleting guards.

- Fix or reproduce the two archive failures before using a green baseline. After CI restructuring, verify `CI Success` still fails on failed, skipped, or cancelled dependencies (`.github/workflows/ci.yml:948–978`).

## 3. Cut further / simplify

- **Remove duplicate CI triggering before cutting backend signal.** CI runs on every branch push and every PR, with concurrency keyed by ref (`.github/workflows/ci.yml:18–31`). Consider pushes to `main` plus PR events, retaining merge-ref testing. This relinquishes automatic checks on branches without PRs; the supplied data does not establish a measured saving.

- **Remove the intermediate `All Tests` aggregator**, letting `CI Success` depend directly on the shard matrix. It currently only checks another job's result (`.github/workflows/ci.yml:149–169`). This requires updating branch protection, which currently requires its name (`CONTRIBUTING.md:1471–1472`). Savings are small, but the workflow becomes simpler.

- **Shard the generated PG selection before narrowing it.** Two bounded PG shards could reduce the critical path while retaining backend coverage. Measure the additional setup cost; Docker smoke then becomes a likely wall-time floor.

- **For further test reduction, consolidate duplicated implementations first.** The script-parser findings describe separate parser copies (`04-judgement/057.md:11`). Sharing the parser could remove repeated tests safely; deleting tests while retaining independent implementations would not.

- Keep Docker runtime assertions. The categorical claim that they "cannot execute inside Vitest" is false—the verifier invokes subprocesses (`scripts/maintenance/verifyDockerImages.ts:52–59`). Nevertheless, retaining a separate packaging job is practical. Moving its invocation into Vitest changes organization, not cost.

## 4. PR ordering

1. Establish a reproducible passing baseline and reliable coverage comparison.
2. Move **PG selection generation and sharding** forward as a separate PR, preserving the existing selection. Defer Phase B.
3. Land narrowly reviewed trivial deletions and OAuth duplicate removals, preserving exceptions.
4. Apply corrected route-covered reductions, then remaining duplicates; require assertion mappings for every removal.
5. Convert guards incrementally, deleting each only after equivalent lint enforcement passes.
6. Fold schema jobs separately, preserving every assertion. Measure savings afterward.

Keep backend-scope reductions separate from workflow consolidation so failures remain attributable.

## 5. Verdict

The direction is sound, but this is not yet an executable deletion plan. Backend selection and measured CI timings check out, and the mute-expiry deletion has convincing equivalent route assertions (`app/api/v1/mutes/route.test.ts:155–173`). However, the PG selector is incomplete, sampled strict verdicts lose assertions, and "trivial" includes accessibility and operational wiring. Approve consolidation and evidence-based pruning after correcting those gaps; treat removal totals and runtime savings as provisional. This was a static, read-only review; no tests were run.
