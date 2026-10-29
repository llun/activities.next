# Test and CI redundancy audit: data drop

Data only. Nothing in the repo was changed or deleted. Taken from `origin/main` at f56da43ed on 2026-10-29. This branch (`test-audit/data`) is never merged.

| File | Slice | Who |
|---|---|---|
| [01-ci-inventory.md](01-ci-inventory.md) | CI jobs, runtimes (last 5 main runs), overlaps | Codex Luna |
| [02-metrics.md](02-metrics.md) | Per-file metrics, durations, guard list | GLM-5.3-flash |
| [03-coverage-overlap.md](03-coverage-overlap.md) | Per-test-file v8 coverage containment | Codex Luna |
| [04-judgement/NNN.md](04-judgement/) | Trivial / duplicate / guard findings for each slice (file:line) | GLM-5.3-flash, 59 slices |
| `slices/NNN.txt`, `slices/BRIEF*.md` | Which files went into each judgement slice, and the brief each worker got | Orchestrator |
| `raw/` | `test-metrics.{csv,json}`, `durations.csv`, `vitest.json`, `coverage-lines.jsonl.gz`, `coverage-overlap.csv`, `test-pg-files.csv`, `ci-runs.json`, `gh/` (raw `gh run view` JSON) | |
| `scripts/` | `test-metrics.mjs`, `durations.mjs`, `coverage-per-file.mjs`, `coverage-overlap.mjs` | |

## Headline numbers

- **Suite:** 1,974 test files, 23.6k cases, 57.8k expects, 3,395 `vi.mock` calls. The full local run had 31,988 tests. 2 failed, both zip streaming cases (`lib/jobs/exportAccountArchiveJob.test.ts`, `lib/services/accountArchive/zipFormat.test.ts`).
- **CI (main, median of 5 runs):** 10.5 min wall time, 39.5 runner-minutes. Heaviest jobs: `test-pg` 10.2 min, `docker-smoke` 8.3 min, test shards 4.1–4.6 min each.
- **`test-pg` re-runs 359 test files (18% of the suite) that the SQLite shards already run.** It is the only job whose removal or merge shortens wall time (about 2.2 min) and the biggest runner-minute item.
- **Judgement findings (GLM, each confirmed by reading the test):** 241 trivial, 463 duplicate and 81 guard items.
- **Coverage containment** (app/api, lib/services, lib/database only, shared test-DB baseline removed): 1,234 pairs where a lib unit test's distinctive lines are 90% or more inside a route test, plus 298 same-directory pairs. These are candidates only: the same lines covered does not mean the same assertions are made.

| Area | Files | Trivial | Duplicates | Guards |
|---|---:|---:|---:|---:|
| lib/components | 361 | 79 | 119 | 23 |
| lib/services | 377 | 34 | 137 | 6 |
| app/api | 327 | 26 | 62 | 2 |
| app/(timeline) | 266 | 41 | 43 | 10 |
| lib/database | 228 | 13 | 43 | 12 |
| lib/utils | 96 | 15 | 17 | 4 |
| lib/client | 90 | 12 | 12 | 3 |
| lib/jobs | 69 | 6 | 9 | 0 |
| lib/types, lib/activities, lib/config | 95 | 7 | 9 | 3 |
| app root + lib/actions (slice 018) | 39 | 0 | 1 | 3 |
| .github, test/, lint, scripts | 33 | 8 | 11 | 15 |

The areas are approximate: each slice is counted under the directory of its first file, and file counts include a few double-counted boundary files.

## Caveats

- Per-file coverage ran only for app/api, lib/services and lib/database (889 of 891 files; `lib/services/accountArchive/objectStore.test.ts` and `sourceFiles.test.ts` failed under coverage). lib/components, app/(timeline), lib/jobs, lib/utils and the rest have no coverage data, so their duplicates come from reading only.
- Many "duplicates" are guard-wrapper tests that re-run a shared case table, for example the same-origin checks in AdminApiGuard, AuthenticatedGuard and OAuthGuard. Those tests also prove each guard is wired up. Cutting them needs a wiring test such as `app/api/routeScopeWiring.test.ts`.
- One slice summary (014) was corrected by hand: GLM had put two "keep" notes under Guards.
- The guard detector in `02-metrics.md` flags 71 files. Some of those use `fs` for temp-dir fixtures, not for reading source; the judgement slices separate the two.
