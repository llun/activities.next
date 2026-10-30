# CI flake fix plan, llun/activities.next (merged from Fable, Argon, Astra, GLM 5.3)

Repo state the plan is written against: `origin/main` at `c6647d6` (2026-10-30, PR #2688 merged). Evidence: `failures.md`, the four analyses, the GitHub REST API (PRs #2591/#2592, run 41071657730's abandoned job, run 41080853536 attempt 1's shard-4 log, the zero-job `version-bump/main` runs, job durations of the last six green `main` runs), and the source at `c6647d6`. Nothing was edited, committed or pushed.

## 1. Summary

Two weeks of red CI come from three things, in impact order. (1) **Runner-level failures that nothing in the repo caused but the workflow amplifies**: every PR commit runs CI twice (`push` + `pull_request`, 22 runner-jobs), no job has a timeout, and one queued job that never got a runner (`abandoned`) failed `All Tests` on #2688 while the sibling run was green. (2) **One Dependabot PR that produced 22 red jobs** because GitHub's security-update job ran rooted in `/packages/nodemailer`, where there is no `yarn.lock`, and shipped a manifest-only bump that `yarn install --immutable` must refuse; it will recur for every advisory on a `packages/*` dependency. (3) **Flaky tests**: of the twelve test signatures, seven are already fixed on `main` (verified against the source history) and two were never flakes (deterministic failures of the branch under test). Four need work: the `DraftsProvider` send-queue drain that outlives its unmount (the SignOutDialog assertion and the post-teardown `ReferenceError`, the two most frequent test signatures, share this one cause), the fitness-import lock test that drives real PostgreSQL round-trips with a fake clock, the file-backed SQLite migrate test that pays an fsync per commit on a saturated runner disk, and the credential-identity file whose first test pays cold dynamic imports plus 4096-bit RSA and cost-10 bcrypt inside its own 30 s budget. The plan is three PRs: **A** (workflow + Dependabot config, biggest reduction in red runs, no test changes), **B** (the four live test/production fixes plus two cheap residual guards), **C** (two suite-wide guards that stop new flakes of the "work outlives the test" class, gated on a full-suite validation). No test is retried, skipped or quarantined; every auto re-run is attempt-1-only and only for jobs that provably executed no repository code; the three required check names stay and still fail closed on every PR, Dependabot's and the version-bump bot's included.

## 2. Signature table

Confidence: **high** = the log line and the source agree and the mechanism is named; **medium** = only mechanism consistent with the evidence; **low** = plausible, evidence thin. "Agreed" names analysts whose root cause matches the decision; "overruled" names the analyst whose cause was rejected, with the one-line reason in section 5 or inline.

| # | Signature (count, last seen) | Agreed root cause | Conf. | Analysts | Fix | PR |
|---|---|---|---|---|---|---|
| 1 | `YN0028 frozen lockfile would be modified` (22 jobs, 10-23, #2591) | GitHub security-update job rooted in `/packages/nodemailer` (branch name and PR title carry the directory; `dependabot.yml` has only ever configured `/`, verified in its history); no lockfile there, so the PR changed `packages/nodemailer/package.json` alone (REST: files = 1), while the `/` job's twin #2592 changed `package.json` + `yarn.lock` and merged. Deterministic per PR, recurs per advisory on any `packages/*` dependency. | high | Fable, Astra (mechanics), GLM (mechanics); **overruled Argon** (claimed `dependabot.yml` has per-package `directory` entries: it never did) and GLM's `allow`/`ignore` on the `/` entry (that would also stop the correct root-job bumps) | Per-workspace `dependabot.yml` entries that ignore everything, so the security job for those manifests opens nothing; the `/` job keeps bumping with the lockfile; npm schedule daily so an advisory fix lands within a day | A |
| 2 | `PostgreSQL Tests (shard 1/2)` queued, never started, `All Tests` got `abandoned` (1, #2688 run 41071657730) | GitHub never assigned a runner (REST: `status: queued`, `runner_name: null`, `steps: 0`, `conclusion: null` after the run completed); `All Tests` correctly failed closed; the `pull_request` run of the same SHA was green. Double runs per commit double the queue load. | high | all four | Run CI once per commit (`push` on `main` only); attempt-1-only auto re-run of runs whose every failed job never executed repository code (this case) | A |
| 3 | `Process completed with exit code 129` after the last `✓`, no Vitest summary (4, all 10-16) | SIGHUP from the runner session, one-day incident, none since. Not re-runnable automatically: the step did execute repository code (a test could send itself SIGHUP), so it is not provable infra. | medium (class), low (platform mechanism) | all four on "platform", Astra on "no auto-retry"; **overruled Argon** (vitest `maxWorkers`/`teardownTimeout` changes: no evidence a teardown hang preceded the signal; the log shows tests still completing) | `timeout-minutes` bounds the damage; documented triage rule only | A (docs) |
| 4 | `YN0001 write ECANCELED (SSL destruction)` in `yarn install` (1) | Transport error 3.8 s into resolution; `.yarnrc.yml` sets no `httpRetry`/`httpTimeout`. | high | all four | `httpRetry: 5`, `httpTimeout: 120000`; one shared install step that retries only on a transport-error allowlist and never on `YN0028` | A |
| 5 | `unable to resolve action actions/cache@v6` in Set up job (1) | GitHub action-resolution service; no step ran. | high (class) | all four | Covered by the infra-only re-run (failed step ⊆ {Set up job}); SHA-pinning rejected (section 5) | A |
| 6 | 16 `pull_request` runs on `version-bump/main` with zero jobs, `failure` (non-gating) | REST shows each such run is created at the bot's force-push and is followed ~2 min later by a green run of the same SHA: GitHub reports "This run likely failed because of a workflow file issue" (startup failure before job creation), and `version-bump.yml`'s existing `CHECK_KICK_ATTEMPT` close/reopen re-fires the run, which passes. The kick is the cure, already in place. | medium | Fable (startup failure); corrected: Fable's C6 (skip the kick) would remove the thing that heals it, so it is dropped | None; documented as a known non-gating class | A (docs) |
| 7 | `SignOutDialog > signs out with zero drafts` (8 jobs, last 10-30 02:31, all SHAs before #2677) | A `DraftsProvider` mounted by an earlier test is still draining a queued draft when the next test subscribes; `postDraftsMessage` notifies the *current* listeners. #2677 filters `queue-progress` in the test, but the producer still runs after unmount: the unmount cleanup bumps `generationRef`, and `drain()`'s outer `finally` treats "generation changed" as "hand over to the next generation" and calls `drainRef.current()` again, starting a fresh, non-aborted pass on the unmounted provider (`DraftsProvider.tsx`, the `finally` of the `void (async () => …)` in `drain`). | high | Fable, Astra, Argon (Argon found the restart); **overruled GLM** (1 s `waitFor` on the redirect: the logged assertion is the `events` array with an extra `queue-progress`, not a timeout) | Live-gate in `DraftsProvider`; `cleanup()` first in the two test files; remove the `queue-progress` filter so the straggler cannot hide; lifecycle test | B |
| 8 | Unhandled `ReferenceError: window/document is not defined` after jsdom teardown (5) | (a) `section-nav-dropdown.tsx` 300 ms reveal timer read globals after teardown: fixed by #2665, 4 of 5 SHAs predate it. (b) run 40997432182 (contains #2665): the `DraftsProvider` restart from row 7 reaches `setDrainFailed` after the file's jsdom is gone; React 19 reads `window.event` in `dispatchSetState`. | high | Fable, Astra, Argon; GLM's `typeof window` guards rejected (section 5) | Row 7's fix; suite guard in C | B, C |
| 9 | `fitness-files/[id]/primary` 409 / 200 tests (3, PostgreSQL) | `withImportLock` alternates a real DB round-trip with a 250 ms sleep for 15 s; the test fakes `Date`+`setTimeout` and steps the clock per observed empty poll, 60 real pg round-trips plus `vi.waitFor` polling per test; on a slow pg shard the 30 s budget is reachable, a timed-out route then leaks into the next test (the `200` failure saw `mockPublish` called with `retryingMapFailure: true` from the previous test's deferred swap). | high | Fable, Astra; Argon/GLM agree on the class (fake clock vs real I/O); **overruled Argon's fix** (`vi.getTimerCount() > 0` gate: the harness comment already says pg-pool arms fake timers of its own, so the count cannot identify the route's sleep) | Shorten the real wait for this file by wrapping `withImportLock` in a module mock (`maxWaitMs: 600`, `pollIntervalMs: 50`); delete the fake clock and the stepper | B |
| 10 | `lib/database/migrate/index.test.ts` "loads the baseline" (2, same SHA `2adff5c`, PostgreSQL) | Deterministic: the branch's `migrations/schema.sql` lagged its new partial-index migration (deparsed `IN` vs `OR`); fixed in that PR before merge; shard 1's drift check catches a recurrence. **Not a flake.** | high | all four | none | — |
| 11 | Same file, SQLite, run 41080853536 attempt 1 (new evidence): `loads the baseline` and `records the baseline once` timed out at 30 s (49.4 s and 48.4 s measured), the other 31 tests of the file normal (0.6–1 s), every other file in the shard at normal pace, the shard's second-slowest file 18 s | Only this file writes a **file-backed** SQLite database (`os.tmpdir()`, better-sqlite3 defaults: `journal_mode=DELETE`, `synchronous=FULL`); each migration's transaction and the lock-row writes fsync, and the slow window is the shard's first ~100 s when four workers import and transform ~500 files (`import 29%, transform 11%` of the run). An fsync-latency storm confined to the one fsync-ing file explains a 100× slowdown that ends abruptly while CPU-bound files keep their pace. | medium-high | Fable (mechanism; its "302 autocommits" detail was wrong: the baseline runs in one transaction, `runner.ts` opens one per migration); the others did not see this run | `PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF` on every file-backed test connection in that file, kept only if the measurement in B3 shows the gain | B |
| 12 | `credentialIdentity.test.ts` time-outs under load (in the brief; no run in the two-week inventory) | The first test pays, inside its 30 s budget: `await import('@/lib/services/auth/auth')` (better-auth inlined and transformed on first use), `registerAccount` = 4096-bit RSA keygen + bcrypt cost 10, on the libuv threadpool shared by every worker thread of the process. `TEST_BCRYPT_COST = 4` covers only the fixtures the test hashes itself. | medium (no log) | Fable, Astra, Argon on the cost; **corrected Argon** (`seedDatabase` with six keygens is not called by this file) and GLM (raising the file's timeout) | Static imports; mock `generateKeyPair` with the stub key; a `passwordHash` seam mocked to cost 4 | B |
| 13 | `createPollJob > batches hashtag search reindexing` (3, 10-17) | `storePlannedTags` pushed names on insert completion; pg pool completion order. Fixed by #2599-era `736ab9b` (positional `Promise.all`), and `lib/jobs/noteTags.test.ts:152` already pins the order with out-of-order completion. | high | Fable, Astra, Argon; **overruled GLM** (lock-wait timeout: the log is an array-order diff) | none | — |
| 14 | `ProfileEditor > tells the person to reload` (3, 10-24..27, SHAs before #2629) | Passive focus effect vs `findByText`; the test now waits for focus inside `waitFor`. Fixed. Fable's component guard (`if (!target) return`) is dropped: `handleActorChanged`'s two setters batch into one commit, so the effect never runs before the alert exists. | high | Astra, Argon; GLM's 1 s theory not needed | none | — |
| 15 | `GalleryAllMediaView > deselects the day…` (1, SHA `3a9c3c2`) | Log (fetched): the failing step is **Undo** after Deselect day (`expected "3 selected", received "0 selected…"`, test line 2633 at that SHA); at `3a9c3c2` `useDaySelection.ts:237` synced `selectedRef` in a passive `useEffect`, so Undo read a stale ref; `main` uses `useLayoutEffect` (#2629). Fixed. | high | Astra, Argon (mechanism; Argon misread which step failed); Fable (low) corrected by the log | none | — |
| 16 | `accountExports > pages through list members … pageSize = 1` (1) | Same-millisecond `createdAt`, random-UUID tie-break; the test now pins distinct `createdAt` and compares sorted lines; `getLists` already orders by `(createdAt, id)`. Fixed. | high | all four | none | — |
| 17 | `bulkImportJob > heartbeat` (2, same SHA `62333b5`) | Old harness polled a fixed number of turns for the mocked `follow`; replaced by an awaited `unitReached` barrier and tracked heartbeat renewals. Fixed. | high | all four | Residual: `try/finally` so an assertion failure still releases the unit and joins the run | B |
| 18 | `POST /api/v1/accounts … registers on that domain` (1, `pull_request` only) | Merge-ref divergence: the branch expected 307, `main` had changed the redirect to 303 (`expected 303 to be 307` in the log); the `push` run of the branch head passed. **Not a flake.** | high | Fable, Astra; **overruled Argon and GLM** (served-domains snapshot leak: contradicted by the logged assertion) | Triage rule in docs | A (docs) |
| 19 | `PrivacyLocationsEditor > scrolls the save error` (1), `DraftEditor.integration > seeds StatusReplyBox` (1) | Assertions that followed `findBy*` synchronously / clicked a still-disabled button; both tests now wait for the state the next step needs. Fixed. | high | all four (GLM's shared-prototype spy theory unneeded) | none | — |
| 20 | Bundle budget (6), better-auth / aws-sdk type errors (12), lint `process is not defined` (5), `/settings/navigation` prerender config (1), Docker verify readiness (1) | Genuine code failures of their branches; the dependency ones are already covered by the `better-auth` and `aws-sdk` Dependabot groups (#2651). | high | all four | none | — |

## 3. Pull requests

Order: A, then B, then C. A and B are independent (A touches `.github/`, `.yarnrc.yml` and docs; B touches `lib/`, `app/` tests and docs); C depends on B (the `DraftsProvider` fix must land before the timer guard, or the guard flags its leak in several files).

Every PR follows `CONTRIBUTING.md`: feature branch; `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`; docs in the same PR; conventional subject; review loop.

**Network-blocked proof runs.** Every test proof below runs with all outgoing network blocked. On the maintainer's Mac the preload exists: `NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings"`. Elsewhere, write this preload to the scratch directory (not the repo) and `--require` it; loopback stays open for the local PostgreSQL:

```js
// block-network.cjs: refuse every non-loopback connection (http/1, http/2, net, fetch).
const net = require('node:net'), http2 = require('node:http2')
const loopback = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '::1'
const origConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const opts = typeof args[0] === 'object' ? args[0] : { host: args[1] }
  if (!loopback(opts.host)) throw new Error(`network blocked: ${opts.host}`)
  return origConnect.apply(this, args)
}
const origH2 = http2.connect
http2.connect = (authority, ...rest) => {
  if (!loopback(new URL(String(authority)).hostname)) throw new Error(`network blocked: ${authority}`)
  return origH2(authority, ...rest)
}
const origFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (!loopback(new URL(url, 'http://localhost').hostname)) return Promise.reject(new Error(`network blocked: ${url}`))
  return origFetch(input, init)
}
```

`repeat` helper used by the proofs (stops at the first failure):

```sh
repeat() { n=$1; shift; for i in $(seq 1 "$n"); do yarn vitest run "$@" --maxWorkers=1 || return 1; done; }
```

CPU/disk load for stress runs: `stress-ng --cpu 4 --io 2 --hdd 1 --timeout 600s &` (Linux; on macOS `yes > /dev/null & yes > /dev/null & yes > /dev/null & yes > /dev/null &` for CPU and `dd if=/dev/zero of=/tmp/dd.bin bs=1m count=20000 &` for disk, killed afterwards).

---

### PR A — `ci: run CI once per commit, bound every job, re-run only infrastructure failures, keep Dependabot off workspace manifests`

Scope: `.github/workflows/ci.yml`, new `.github/actions/install/action.yml`, new `.github/workflows/ci-rerun.yml`, new `.github/scripts/classify-ci-rerun.mjs`, new tests `.github/workflows/ci.test.ts` and `.github/workflows/ci-rerun.test.ts`, `.yarnrc.yml`, `.github/dependabot.yml`, `CONTRIBUTING.md`, `docs/setup.md`. No `lib/`/`app/` change.

#### A1. `.github/workflows/ci.yml` triggers

Replace lines 19–21:

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

Rewrite the header comment's first sentence: "Runs once per commit: on pull requests (the merge ref) and on pushes to `main`; `workflow_dispatch` runs it on a branch without a PR." Keep `concurrency` as is (`github.ref` is now unique per PR; `cancel-in-progress` still kills superseded PR runs).

Why this is safe for the other workflows (checked at `c6647d6`): `version-bump.yml` reads check runs on the bump PR's head SHA (the `pull_request` run attaches them; its newest-check-run dedupe is unchanged) and its close/reopen kick still re-fires a `pull_request` run; `sync-main-to-prod-dispatch.yml` lists CI runs with `event: 'push'` on `main`, which keep running; `package.yml`, `tag-version.yml`, `codeql.yml` have their own `main` triggers; `dependabot-auto-merge.yml` is `pull_request_target` and only runs `gh pr merge --auto`. Dependabot and the version-bump bot both open PRs, so their commits still get the three required checks. `.github/workflows/version-bump.test.ts` and `sync-main-to-prod.test.ts` read only their own workflows and keep passing.

#### A2. `timeout-minutes` and a pinned image on every job

Add under each job's `runs-on` (values are ≥ 2× the slowest of the last six green `main` runs, measured by REST: lint 86 s, typecheck 66 s, build 96 s, SQLite shards 880 s, PostgreSQL shards 988 s, Docker 892 s):

| job id | `timeout-minutes` |
|---|---|
| `lint-prettier`, `typecheck` | 15 |
| `build` | 20 |
| `test-shards` | 30 |
| `test-pg` | 40 |
| `docker-smoke-minimal`, `docker-smoke-full` | 40 |
| `test`, `ci-success` | 5 |

Change every `runs-on: ubuntu-latest` in `ci.yml` (9 occurrences) and in the new `ci-rerun.yml` to `runs-on: ubuntu-24.04` (the `ubuntu-latest` label is migrating to Ubuntu 26 under the suite; `package.yml` already pins `ubuntu-24.04-arm` for arm64; leave `package.yml`'s amd64 `ubuntu-latest` and the other workflows alone, they are not in scope). Add a comment above the first job: "Pinned: `ubuntu-latest` is migrating to Ubuntu 26; move deliberately."

#### A3. One install step with a transport-only retry

New file `.github/actions/install/action.yml`:

```yaml
name: Install dependencies
description: >-
  `yarn install --immutable`, retried only for a transport error (a registry
  socket reset, timeout or TLS cancellation: YN0001 with a network error
  code). A lockfile that would change (YN0028), a failing build script, a
  checksum or resolver error is a code error and runs once.
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -uo pipefail
        log=$(mktemp)
        for attempt in 1 2 3; do
          yarn install --immutable 2>&1 | tee "$log"
          status=${PIPESTATUS[0]}
          [ "$status" -eq 0 ] && exit 0
          if grep -q 'YN0028' "$log"; then
            echo "::error::yarn.lock would change (YN0028): commit the regenerated lockfile. Not retried."
            exit "$status"
          fi
          if ! grep -q 'YN0001' "$log" || ! grep -Eq 'ECANCELED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|ERR_SSL|ERR_TLS' "$log"; then
            echo "::error::yarn install failed with a non-transport error. Not retried."
            exit "$status"
          fi
          [ "$attempt" -eq 3 ] && exit "$status"
          echo "::warning::yarn install hit a transport error (attempt $attempt); retrying in $((attempt * 15))s"
          sleep $((attempt * 15))
        done
```

In `ci.yml`, replace all nine `- name: Install dependencies` / `run: yarn install --immutable` pairs with:

```yaml
      - name: Install dependencies
        uses: ./.github/actions/install
```

(The step name stays `Install dependencies`; the `Checkout`, `Enable corepack` and `Use Node.js 24` steps before it are unchanged.)

`.yarnrc.yml` (append):

```yaml
# Registry transport retries for CI: a tarball download that resets mid-stream
# is retried by Yarn before the install step gives up.
httpRetry: 5
httpTimeout: 120000
```

#### A4. Infrastructure-only automatic re-run

New `.github/scripts/classify-ci-rerun.mjs` (ESM, no dependencies, same style as `select-sync-commit.mjs`):

```js
// Decides whether a failed CI run may be re-run automatically. Only a run in
// which every failed job provably executed no repository code qualifies: a
// job that never got a runner (queued/abandoned), or whose only failed steps
// are the runner's own setup steps. Any failed step that runs code from the
// checkout (install, lint, build, test, docker) blocks the re-run, whatever
// its log says, so a code failure is never retried into green.
export const AGGREGATE_JOBS = new Set(['All Tests', 'CI Success'])
export const INFRASTRUCTURE_STEPS = new Set([
  'Set up job',
  'Initialize containers',
  'Checkout',
  'Use Node.js 24'
])

export const classifyRun = (jobs) => {
  const failed = jobs.filter(
    (job) =>
      !AGGREGATE_JOBS.has(job.name) &&
      job.conclusion !== 'success' &&
      job.conclusion !== 'skipped'
  )
  if (failed.length === 0) return { rerun: false, reason: 'no failed job outside the aggregates' }
  for (const job of failed) {
    const steps = job.steps ?? []
    if (job.status !== 'completed' && !job.runner_name && steps.length === 0) continue // never started
    if (job.conclusion === 'cancelled') return { rerun: false, reason: `${job.name} was cancelled` }
    const failedSteps = steps.filter((step) => step.conclusion === 'failure').map((step) => step.name)
    if (failedSteps.length > 0 && failedSteps.every((name) => INFRASTRUCTURE_STEPS.has(name))) continue
    return {
      rerun: false,
      reason: `${job.name} failed in ${failedSteps.length ? failedSteps.join(', ') : 'an unknown step'}`
    }
  }
  return { rerun: true, reason: `every failed job never ran repository code: ${failed.map((job) => job.name).join(', ')}` }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { readFileSync, appendFileSync } = await import('node:fs')
  const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const result = classifyRun(jobs)
  console.log(`${result.rerun ? 'RERUN' : 'KEEP'}: ${result.reason}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `rerun=${result.rerun}\nreason=${result.reason}\n`)
}
```

New `.github/workflows/ci-rerun.yml`:

```yaml
name: CI Re-run

# Re-runs the failed jobs of a CI run, once, when every failed job is an
# infrastructure failure: a job GitHub never gave a runner to (reported as
# `abandoned` to All Tests, as on PR #2688) or one whose only failed step is
# the runner's own setup (an action that could not be resolved). Decided by
# .github/scripts/classify-ci-rerun.mjs from the jobs API; a failed install,
# lint, build, test or docker step blocks it. `workflow_run` executes this
# file from `main` with the repository token and never checks out or runs
# the PR's code; the re-run itself keeps the original event's permissions.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]

permissions:
  actions: write
  contents: read

jobs:
  rerun:
    name: Re-run infrastructure failures
    if: >-
      github.event.workflow_run.conclusion == 'failure' &&
      github.event.workflow_run.run_attempt == 1
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    env:
      GH_TOKEN: ${{ github.token }}
      RUN_ID: ${{ github.event.workflow_run.id }}
      REPO: ${{ github.repository }}
    steps:
      - name: Checkout the classifier (from main, never the PR)
        uses: actions/checkout@v7
        with:
          sparse-checkout: .github/scripts
          persist-credentials: false
      - name: Classify the failed jobs
        id: classify
        run: |
          set -euo pipefail
          gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/jobs?per_page=100" --jq '.jobs[]' | jq -s '.' > /tmp/jobs.json
          node .github/scripts/classify-ci-rerun.mjs /tmp/jobs.json
      - name: Re-run the failed jobs
        if: steps.classify.outputs.rerun == 'true'
        run: gh run rerun "$RUN_ID" --repo "$REPO" --failed
```

New `.github/workflows/ci-rerun.test.ts` (mirrors `sync-main-to-prod.test.ts`): import `classifyRun` and assert
- the #2688 shape `{ name: 'PostgreSQL Tests (shard 1/2)', status: 'queued', conclusion: null, runner_name: null, steps: [] }` plus failed `All Tests`/`CI Success` → `rerun: true`;
- a `Set up job`-only failure (`status: 'completed', conclusion: 'failure', runner_name: 'GitHub Actions 7', steps: [{ name: 'Set up job', conclusion: 'failure' }]`) → `rerun: true`;
- a job with `steps: [{ name: 'Set up job', conclusion: 'success' }, { name: 'Run test shard', conclusion: 'failure' }]` → `rerun: false` with the step named;
- an abandoned job **and** a code failure in the same run → `rerun: false`;
- `conclusion: 'cancelled'` → `rerun: false`;
- a completed failure with no failed step at all (a `timeout-minutes` kill) → `rerun: false`;
- `readFileSync('.github/workflows/ci-rerun.yml')` contains `run_attempt == 1`, `--failed`, `workflow_run`, does **not** contain `ref:` or `github.event.workflow_run.head_sha` (never checks out the PR).

New `.github/workflows/ci.test.ts` (text assertions, no YAML dependency):
- `on:` block equals exactly `on:\n  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch:\n`;
- the number of `^    timeout-minutes: \d+$` lines equals the number of jobs (`^  [a-z-]+:\n    name: ` matches, 9);
- no `ubuntu-latest` in the file;
- `name: All Tests`, `name: Lint and Prettier`, `name: Build` present, and both aggregate jobs keep `if [ "$result" != "success" ]`;
- every `name: Install dependencies` is followed by `uses: ./.github/actions/install` and the file contains no bare `run: yarn install --immutable`;
- `permissions:\n  contents: read` and no `actions: write` in `ci.yml`.

#### A5. Dependabot

`.github/dependabot.yml`: change the npm `/` entry's `schedule.interval` to `'daily'` (comment: "daily so a security fix from the `/` job lands within a day; the per-workspace entries below carry no updates of their own"), and append before the `github-actions` entry:

```yaml
  # Yarn workspaces share the single yarn.lock at the root, so only the `/`
  # entry above may bump a workspace's dependencies. GitHub's Dependabot
  # security updates run one job per manifest the dependency graph indexes
  # and use the entry whose directory matches it; a job rooted in a workspace
  # folder finds no lockfile and opens a PR that edits package.json alone,
  # which `yarn install --immutable` refuses on every job (PR #2591, 22 red
  # jobs, 2026-10-23; its root-job twin #2592 updated the lockfile and
  # merged). `ignore: '*'` also applies to security updates, so these entries
  # make the workspace jobs open nothing; `open-pull-requests-limit: 0` turns
  # their version updates off. Add an entry when a workspace is added.
  - package-ecosystem: 'npm'
    directory: '/packages/cloudtasks'
    schedule: { interval: 'monthly' }
    open-pull-requests-limit: 0
    ignore:
      - dependency-name: '*'
  - package-ecosystem: 'npm'
    directory: '/packages/nodemailer'
    schedule: { interval: 'monthly' }
    open-pull-requests-limit: 0
    ignore:
      - dependency-name: '*'
  - package-ecosystem: 'npm'
    directory: '/packages/pg'
    schedule: { interval: 'monthly' }
    open-pull-requests-limit: 0
    ignore:
      - dependency-name: '*'
  - package-ecosystem: 'npm'
    directory: '/packages/qstash'
    schedule: { interval: 'monthly' }
    open-pull-requests-limit: 0
    ignore:
      - dependency-name: '*'
  - package-ecosystem: 'npm'
    directory: '/packages/resend'
    schedule: { interval: 'monthly' }
    open-pull-requests-limit: 0
    ignore:
      - dependency-name: '*'
  - package-ecosystem: 'npm'
    directory: '/packages/ses'
    schedule: { interval: 'monthly' }
    open-pull-requests-limit: 0
    ignore:
      - dependency-name: '*'
```

Add to `.github/workflows/ci.test.ts`: for every directory in `packages/*` (via `readdirSync('packages')`), `.github/dependabot.yml` contains `directory: '/packages/<name>'` followed within the same entry by `dependency-name: '*'` (a new workspace without its entry fails the test).

#### A6. Docs (same PR)

- `CONTRIBUTING.md` → "CI Status Checks": triggers (`pull_request` + `push` to `main` + `workflow_dispatch`, one run per commit), the per-job timeouts, the pinned image, the shared install action and what it retries, `ci-rerun.yml` and its exact rule, the Dependabot workspace entries. Line 403 ("on every push and PR") → "on every pull request and push to `main`". Line 132's paragraph: mention that the bump PR's first `pull_request` run can fail at startup with no jobs and the workflow's close/reopen kick re-fires it (non-gating).
- `CONTRIBUTING.md` → "Known failure classes", add:
  - **A red `All Tests` whose upstream job is `abandoned`/`queued` with no runner is GitHub runner allocation, not code**; `ci-rerun.yml` re-runs it once; if it happened on attempt 2, re-run by hand.
  - **`Process completed with exit code 129` after the last `✓` with no Vitest summary is the runner's SIGHUP** (one-day incident on 2026-10-16); not auto re-run because the step ran repository code; re-run by hand after checking the log has no `FAIL`.
  - **`YN0028` on a Dependabot branch whose name contains `packages/` is a security-update job rooted in a workspace** (see `dependabot.yml`); close it, the `/` job's twin PR carries the lockfile.
  - **A `pull_request`-only failure whose `push` sibling is green is merge-ref divergence first** (the PR branch's test vs `main`'s changed contract, e.g. the 303/307 accounts redirect), not a flake.
  - **A zero-job `failure` run on `version-bump/main`** is the startup failure the version-bump kick heals; ignore it.
- `docs/setup.md:411`: "on every push/PR" → "on every pull request and push to `main`".
- `ci.yml` header comment as in A1.

#### A7. Proof

- `yarn test .github/workflows` passes (the two new guard tests plus the existing ones).
- `act`-free check of the trigger: open the PR; GitHub creates exactly one `CI` run for the PR commit (`gh run list --workflow ci.yml --branch <branch>` shows `pull_request` only). After merge, `gh run list --workflow ci.yml --branch main --event push` shows the `main` run.
- Install retry: locally, `YARN_HTTP_RETRY=0 YARN_NPM_REGISTRY_SERVER=https://127.0.0.1:9 bash -c 'cd $(mktemp -d) && cp -r <repo>/{package.json,yarn.lock,.yarnrc.yml,packages} . && bash <repo>/.github/actions/install/run.sh'` is not possible with a composite action; instead extract the script body into the scratch directory and run it once against an unreachable registry (expect three attempts, exit non-zero) and once after editing `packages/nodemailer/package.json` to a version absent from `yarn.lock` (expect one attempt and the YN0028 error line). Revert the edit.
- Re-run rule: the unit test above is the proof; the live check is `workflow_dispatch` on the PR branch is not needed. After merge, the first `abandoned` occurrence shows a `CI Re-run` run with `RERUN:` in its log and attempt 2 on the CI run.
- Dependabot: after merge, Insights → Dependency graph → Dependabot lists a job per `packages/*` manifest with no PR; the next advisory on a workspace package produces exactly one PR, from the `/` job, touching `yarn.lock`.

Commit/PR title: `ci: run CI once per commit, bound every job, re-run only infrastructure failures and keep Dependabot off workspace manifests`

---

### PR B — `fix: stop the send-queue drain after unmount and remove the fake clock, fsync and crypto costs from the flaky tests`

Scope: `lib/components/drafts/DraftsProvider.tsx` and its test, `lib/components/sign-out/SignOutDialog.test.tsx`, `app/api/v1/fitness-files/[id]/primary/route.test.ts`, `lib/database/migrate/index.test.ts`, `lib/services/auth/credentialIdentity.test.ts`, new `lib/services/auth/passwordHash.ts` (+ test), `lib/services/auth/auth.ts`, `lib/services/accounts/registerAccount.ts`, `app/api/v1/accounts/password/route.ts`, `app/api/v1/accounts/password/reset/route.ts`, `lib/services/accounts/migration/outgoingMove.ts`, `lib/stub/actor.ts`, `lib/jobs/bulkImportJob.test.ts`, `CONTRIBUTING.md`.

#### B1. `DraftsProvider`: a pass that ends after unmount does nothing

`lib/components/drafts/DraftsProvider.tsx`, inside `DraftsProvider`:

1. After `const stalledRef = …` add:

```ts
  // Whether the provider is mounted. A drain pass is a detached promise
  // chain over IndexedDB and fetch; one that settles after unmount (a test
  // file's teardown, a page change) must not set state, broadcast or start
  // another pass: the broadcast lands in whatever is listening by then.
  const liveRef = useRef(false)
  // The phase the last progress broadcast reported, for the unmount idle.
  const lastPhaseRef = useRef<SendQueueProgress['phase']>('idle')
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])
```

2. `scheduleWake`: first statement `if (!liveRef.current) return` (before `clearWake()`), and in its `.then((drafts) => {` add `if (!liveRef.current) return` right after the existing `if (token !== wakeToken.current) return`.

3. `drain`: first statement `if (!liveRef.current) return`.

4. `runPass`: after `const controller = new AbortController()` add

```ts
      // True once this pass may no longer touch the provider.
      const stale = () =>
        controller.signal.aborted ||
        !liveRef.current ||
        generationRef.current !== generation
```

   then: after `const m = await loadDrafts()` insert `if (stale()) return`; after the `const drafts = (await m.listDrafts(…)).filter(…)` statement insert `if (stale()) return`; replace both `if (!controller.signal.aborted) setDrainFailed(false)` with `if (!stale()) setDrainFailed(false)`; after `const deps = await loadSendQueueDeps(m, accountId, actorId)` insert `if (stale()) return`; in `onProgress`, before `last.phase = next.phase`, insert `if (!liveRef.current) return`, and after `last.phase = next.phase` add `lastPhaseRef.current = next.phase`; in `catch`, replace `if (!controller.signal.aborted) setDrainFailed(true)` with `if (!stale()) setDrainFailed(true)`; in `finally`, change the condition to `if (last.phase === 'sending' && liveRef.current) {` and, inside that block after the `postDraftsMessage(...)` call, add `lastPhaseRef.current = 'idle'`.

5. The outer `finally` of the `void (async () => { … })()` in `drain`: replace its body with

```ts
        drainingRef.current = false
        if (!liveRef.current) return
        if (generationRef.current !== generation) drainRef.current()
        else scheduleWake()
```

6. The unmount/account-change cleanup effect (`useEffect(() => () => { generationRef.current += 1; abortRef.current?.abort(); clearWake() }, [accountId, actorId, clearWake])`): after `abortRef.current?.abort()` add

```ts
        // A send in flight is abandoned with this provider; other tabs must
        // not keep showing "Sending", and the broadcast goes out now, while
        // this provider still exists, not from the pass's finally later.
        if (lastPhaseRef.current === 'sending') {
          lastPhaseRef.current = 'idle'
          postDraftsMessage({ type: 'queue-progress', accountId, actorId, progress: IDLE_PROGRESS })
        }
```

Behaviour kept: a live provider still re-drains on account change (generation handover), still schedules wakes, still broadcasts idle after an aborted send (now synchronously from the cleanup instead of asynchronously from the pass).

#### B2. Tests for B1

`lib/components/drafts/DraftsProvider.test.tsx`:
- `import { act, cleanup, render, … } from '@testing-library/react'` (add `cleanup`); make `cleanup()` the **first** statement of the file's `afterEach` (unmount before the IndexedDB factory and channel are reset).
- Add, in the top-level `describe`, using the file's existing helpers (`installFakeBroadcastChannel`, `setDraftsIndexedDBFactory`, `saveDraft`, the `draft` factory of `SignOutDialog.test.tsx` copied if the file has none) and `createDeferred` from `@/lib/testing/deferred` and `import * as draftsModule from '@/lib/client/drafts'`:

```ts
  it('does nothing once unmounted: a drain pass that settles after unmount neither restarts, broadcasts nor schedules', async () => {
    await saveDraft(draft({ id: 'queued-1', queue: { state: 'waiting', queuedAt: 10, attempts: 0 } }), { expectedRevision: 0, epoch: 0 })
    const listDrafts = createDeferred<DraftRecord[]>()
    const listSpy = vi.spyOn(draftsModule, 'listDrafts').mockReturnValue(listDrafts.promise)
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const { unmount } = renderProvider()   // the file's render helper with accountId/actorId
    await vi.waitFor(() => expect(listSpy).toHaveBeenCalled())
    const received: string[] = []
    subscribeDraftsMessages((message) => received.push(message.type))
    unmount()
    const armedBefore = setTimeoutSpy.mock.calls.length
    listDrafts.resolve([])   // the pass continues after unmount
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(listSpy).toHaveBeenCalledTimes(1)   // no second pass (the old finally restarted one)
    expect(received).toEqual([])
    // Only this test's own 50ms sleep was armed after unmount.
    expect(setTimeoutSpy.mock.calls.length - armedBefore).toBe(1)
  })
```

  If the file mocks `@/lib/client/drafts` wholesale rather than importing it, use the mock's `listDrafts` instead of the spy; the three assertions are the test.

`lib/components/sign-out/SignOutDialog.test.tsx`:
- add `cleanup` to the RTL import and call `cleanup()` as the first statement of `afterEach`;
- in `beforeEach`, change the listener to `if (message.type !== 'changed') events.push(message.type)` and reduce its comment to: "`changed` is every save; everything else, including a stray `queue-progress` from a provider an earlier test left draining, lands in `events` and fails the exact assertions below."

#### B3. Proof for B1/B2

- Mutation 1: with B1 reverted and B2 in place, the new `DraftsProvider` test fails on `listSpy` call count (2) deterministically.
- Mutation 2: with B1 reverted, add `await new Promise((r) => setTimeout(r, 200))` before `const deps = await loadSendQueueDeps(…)` in `runPass`; `repeat 10 lib/components/sign-out/SignOutDialog.test.tsx` fails with an extra `queue-progress` in `events`. Remove the mutation.
- Stress, with the fix: `repeat 30 lib/components/sign-out/SignOutDialog.test.tsx lib/components/drafts/DraftsProvider.test.tsx lib/components/drafts/DraftsProvider.queue.test.tsx lib/components/drafts/DraftEditor.integration.test.tsx` under CPU load; no failure and no "Unhandled Errors" block.

#### B4. Fitness import lock tests: real short waits instead of a fake clock

`app/api/v1/fitness-files/[id]/primary/route.test.ts`:

1. After the `vi.mock('next/headers', …)` block add:

```ts
// The route waits for the import lock with 250ms polls for 15s, each poll a
// real database round-trip. These tests shorten that wait instead of faking
// the clock: a fake clock stepped around real PostgreSQL I/O was the flake
// (CONTRIBUTING.md, Known failure classes). ttlMs and failOnTimeout stay
// whatever the route passes.
const TEST_LOCK_WAIT = { maxWaitMs: 600, pollIntervalMs: 50 }
vi.mock('@/lib/services/fitness-files/importLock', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/services/fitness-files/importLock')>()
  return {
    ...actual,
    withImportLock: (
      ...[database, lockKey, fn, options]: Parameters<typeof actual.withImportLock>
    ) => actual.withImportLock(database, lockKey, fn, { ...options, ...TEST_LOCK_WAIT })
  }
})
```

2. Delete `spyOnEmptyLockPolls`, `advanceUntilSettled`, `waitForPollStart` and their comments; delete `vi.useRealTimers()` from `afterEach` (keep the lock-row cleanup and `vi.restoreAllMocks()`).

3. Rewrite the two wait tests:

```ts
  it('answers 409, changing nothing, when an import holds the lock for the whole wait', async () => {
    const { oldPrimary, chosen } = await createPair()
    const lockKey = `fitness-import:${ACTOR1_ID}`
    const held = await database.acquireImportLock({ lockKey, ttlMs: 10 * 60 * 1000 })
    expect(held).not.toBeNull()
    try {
      const response = await post(chosen.id)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: 'Another import is updating this activity. Try again in a moment.'
      })
      expect(await flags(oldPrimary.id, chosen.id)).toEqual([true, false])
      expect(mockPublish).not.toHaveBeenCalled()
    } finally {
      await database.releaseImportLock({ lockKey, token: held!.token })
    }
  })

  it('succeeds once the lock frees up within the wait', async () => {
    const { oldPrimary, chosen } = await createPair()
    const lockKey = `fitness-import:${ACTOR1_ID}`
    const held = await database.acquireImportLock({ lockKey, ttlMs: 60_000 })
    const pending = post(chosen.id)
    try {
      // Three or four polls in, well inside the 600ms test wait.
      await new Promise((resolve) => setTimeout(resolve, 150))
      await database.releaseImportLock({ lockKey, token: held!.token })
      const response = await pending
      expect(response.status).toBe(200)
      expect(await flags(oldPrimary.id, chosen.id)).toEqual([false, true])
    } finally {
      await database.releaseImportLock({ lockKey, token: held!.token }).catch(() => undefined)
      await pending.catch(() => undefined)
    }
  })
```

The TTL test (`holds the import lock across an inline job…`) is unchanged: `acquire.mock.calls[0][0]` still equals `{ lockKey, ttlMs: 5 * 60 * 1000 }` because the mock passes the route's options through. The real 15 s / 250 ms defaults stay covered by `lib/services/fitness-files/importLock.test.ts`.

Proof: SQLite `repeat 20 'app/api/v1/fitness-files/[id]/primary/route.test.ts'`; PostgreSQL (local, disposable: `TEST_DATABASE_TYPE=pg TEST_DATABASE_HOST=127.0.0.1 …`) `repeat 20` of the same file with `--maxWorkers=2` while `lib/database/migrate/index.test.ts` runs in a second terminal against the same server; the file must take < 5 s per run. Mutation: in `importLock.ts` make `withImportLock` `return fn()` as its first line; the 409 test fails deterministically (`expected 409, got 200`). Remove the mutation.

#### B5. File-backed SQLite in `lib/database/migrate/index.test.ts`: no fsync

Add after the `let … config` declarations:

```ts
// The migrate tests are the suite's only file-backed SQLite databases (two
// tests open a second connection to the same file for the lock cases).
// better-sqlite3's defaults (journal_mode=DELETE, synchronous=FULL) fsync
// every commit, and on a CI runner whose disk is saturated by four workers
// importing the suite that stretched two of these tests past 30s (run
// 41080853536). Durability is irrelevant to a throwaway database.
const withoutFsync = async (handle: DatabaseConnection) => {
  if (backend === 'pg') return
  await handle.executeScript(
    'PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF;'
  )
}
```

(use the connection handle type `createDatabaseConnection` returns, imported from `@/lib/database/connection`). Call `await withoutFsync(connection)` right after `connection = createDatabaseConnection(config)` in `beforeEach` and after the `createDatabaseConnection` at the "the schema the test databases load" step (the `:memory:` one needs nothing but is harmless), and `await withoutFsync(other)` after each `const other = createDatabaseConnection(config)` (two places).

Keep-or-drop rule (mechanical): before the change, run `yarn vitest run lib/database/migrate/index.test.ts --maxWorkers=1 --reporter=verbose` five times and note the median duration of `loads the baseline`; apply the change and repeat. Keep the change if the median drops by ≥ 30 %, or if on Linux `strace -f -c -e trace=fsync,fdatasync yarn vitest run lib/database/migrate/index.test.ts --maxWorkers=1` shows > 100 calls before and < 20 after. Otherwise revert B5 and say so in the PR. Stress proof (Linux): `stress-ng --io 4 --hdd 2 --timeout 300s &` then `repeat 10 lib/database/migrate/index.test.ts`; every run under 15 s.

#### B6. `credentialIdentity.test.ts`: pay the cold imports and crypto outside the test budget

1. New `lib/services/auth/passwordHash.ts`:

```ts
import bcrypt from 'bcrypt'

/** bcrypt cost for every stored password hash. */
export const BCRYPT_COST = 10

export const hashPassword = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_COST)

/** Reads the cost from the hash itself, so a lower-cost test hash compares too. */
export const comparePassword = (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash)
```

   with `passwordHash.test.ts` (round trip; a wrong password is false; the hash starts with `$2b$10$`).

2. Use it: `lib/services/auth/auth.ts:208-210` → `hash: hashPassword, verify: ({ password, hash }) => comparePassword(password, hash)` (keep the existing parameter shape of the `verify` callback as the file has it); `lib/services/accounts/registerAccount.ts` → delete `BCRYPT_ROUND` and the `bcrypt` import, `hashPassword(password)`; `app/api/v1/accounts/password/route.ts` lines 56 and 71, `app/api/v1/accounts/password/reset/route.ts:78`, `lib/services/accounts/migration/outgoingMove.ts:85` → `comparePassword`/`hashPassword`, removing their `bcrypt` imports. Run `yarn typecheck`; if a test of those routes mocks `bcrypt` directly, leave it (the seam imports `bcrypt`, so the mock still applies).

3. `lib/stub/actor.ts`: `export const MOCK_PUBLIC_KEY` and `export const MOCK_PRIVATE_KEY` (lines 4 and 19; the values are unchanged).

4. `lib/services/auth/credentialIdentity.test.ts`:
   - replace the two dynamic imports with static ones (`import { getAuth } from '@/lib/services/auth/auth'`, `import { registerAccount } from '@/lib/services/accounts/registerAccount'`) and simplify `getAuthInstance`/`register` accordingly (the hoisted `holder` + `vi.mock` pattern already supports static imports, because the mocks read `holder.testDb` lazily);
   - add `import { MOCK_PRIVATE_KEY, MOCK_PUBLIC_KEY } from '@/lib/stub/actor'` and the two mocks:

```ts
// Registration generates a 4096-bit RSA key and hashes at cost 10 on the
// libuv threadpool every worker thread shares; neither is what these tests
// check. A fixed key and a cost-4 hash (compare reads the cost from the
// hash) keep the first test inside its budget on a loaded runner.
vi.mock('@/lib/utils/signature', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/signature')>()),
  generateKeyPair: async () => ({ publicKey: MOCK_PUBLIC_KEY, privateKey: MOCK_PRIVATE_KEY })
}))
vi.mock('@/lib/services/auth/passwordHash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/auth/passwordHash')>()
  const bcrypt = (await import('bcrypt')).default
  return { ...actual, hashPassword: (password: string) => bcrypt.hash(password, 4) }
})
```

   (`vi.mock` is hoisted; the key constants are read when the factory runs, after imports, which is fine. If the hoisting complains about `MOCK_*`, move the two constants into a `vi.hoisted(() => …)` block that `require`s them is not possible in ESM; instead inline the import inside the factory: `const { MOCK_PUBLIC_KEY, MOCK_PRIVATE_KEY } = await import('@/lib/stub/actor')`.)

Proof: `yarn vitest run lib/services/auth/credentialIdentity.test.ts --reporter=verbose` before/after: the first test drops from seconds to < 500 ms and the file from ~6 s to < 2 s locally. Stress: `repeat 10 lib/services/auth/credentialIdentity.test.ts` under `stress-ng --cpu 8`; no test above 5 s. Mutation: remove the `passwordHash` mock; the per-test time returns.

#### B7. `bulkImportJob.test.ts` heartbeat residual

In the three tests that call `startBlockedRun()` and then `tick(...)` with an expectation between (`stops quietly…`, `carries on when a heartbeat renewal throws once…`, `fails the run with the renewal error…`), wrap everything after `const { run, finishUnit } = await startBlockedRun()` in `try { … } finally { finishUnit(); await settle(); await run.catch(() => undefined) }`, moving the existing `finishUnit(); await settle(); await run` (or `await outcome`) into the `try` body unchanged (calling `finishUnit` twice resolves the same promise and is harmless). Proof: temporarily change `expect(renew).toHaveBeenCalledTimes(1)` to `(2)` in one test; the test fails but the following tests in the file still pass and no "driver has already been destroyed" error appears. Revert.

#### B8. Docs (same PR)

`CONTRIBUTING.md` → "Known failure classes", add:
- **A broadcast or state update from a `DraftsProvider` (or any provider with a detached async loop) landing in the next test is a pass that outlived its unmount.** The provider gates every step after an `await` on `liveRef`; a test file that mounts it calls `cleanup()` first in `afterEach` so unmount precedes the IndexedDB/channel reset.
- **A fake clock around real database I/O (`vi.useFakeTimers` with `pg`) is a flake by construction**: advance only inside the application's own sleep, or shorten the real wait through the module boundary as `fitness-files/[id]/primary/route.test.ts` does.
- **A file-backed SQLite test database fsyncs every commit**; set `journal_mode = MEMORY` and `synchronous = OFF` on it (`lib/database/migrate/index.test.ts`), or use `:memory:`.
- **A test whose first `it` pays a cold dynamic import, a 4096-bit keygen or a cost-10 bcrypt is at the mercy of the shared threadpool**; import statically, use the stub key and the `passwordHash` seam.
- **Same-millisecond `createdAt` with a random-id tie-break** orders randomly; pin timestamps when order is contractual (`accountExports.test.ts`).
- **Pushing results into a shared array inside `Promise.all` orders by pg completion**; derive order from the input (`noteTags.ts`).

Commit/PR title: `fix: stop the drafts send-queue drain after unmount and remove the fake clock, fsync and crypto costs from the flaky tests`

---

### PR C — `test: unmount before a file's own teardown and fail the test that leaves a long timer armed`

Scope: `vitest.config.ts`, `test/setup/vitest.setup.ts`, `test/vitest.config.test.ts` (or a new `test/vitest.setup.test.ts`), `CONTRIBUTING.md`. Lands after B.

#### C1. Hook order

`vitest.config.ts`, inside `test:` next to `testTimeout`:

```ts
    // Hooks run in definition order, "after" hooks included. With Vitest's
    // default ('stack', after-hooks reversed) a file's own afterEach ran
    // before the afterEach(cleanup) @testing-library/react registers at
    // import, so a test's IndexedDB/channel/global reset ran while its React
    // tree was still mounted and the tree's async work then landed in the
    // next test. Nested suites are unaffected: a child's after-hooks still
    // run before its parent's.
    sequence: { hooks: 'list' },
```

#### C2. Timer guard (jsdom files only)

Append to `test/setup/vitest.setup.ts`:

```ts
// A timer that is still armed when a jsdom test ends outlives its component
// (React cleanups clear theirs on unmount, which runs before this hook under
// `sequence.hooks: 'list'`). It fires after the file's jsdom is torn down and
// throws `window/document is not defined` as an unhandled error that fails
// the shard without naming the test. Fail the test instead, with the stack
// that armed the timer. Timers under LONG_TIMER_MS are left alone: Radix,
// next/link and React itself arm 0–1ms timers that settle on their own.
const LONG_TIMER_MS = 100
if (typeof window !== 'undefined') {
  type Armed = { delay: number; stack: string }
  const armed = new Map<ReturnType<typeof setTimeout>, Armed>()
  const nativeSetTimeout = globalThis.setTimeout
  const nativeClearTimeout = globalThis.clearTimeout
  let guarding = false
  const guardedSetTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = nativeSetTimeout(
      (...callbackArgs: unknown[]) => {
        armed.delete(id)
        if (typeof handler === 'function') handler(...callbackArgs)
      },
      delay,
      ...args
    )
    if (guarding && (delay ?? 0) >= LONG_TIMER_MS) {
      armed.set(id, { delay: delay ?? 0, stack: new Error().stack ?? '' })
    }
    return id
  }) as typeof setTimeout
  guardedSetTimeout.__promisify__ = nativeSetTimeout.__promisify__
  globalThis.setTimeout = guardedSetTimeout
  globalThis.clearTimeout = ((id) => {
    armed.delete(id as ReturnType<typeof setTimeout>)
    return nativeClearTimeout(id)
  }) as typeof clearTimeout

  beforeEach(() => {
    armed.clear()
    guarding = true
  })
  afterEach(() => {
    guarding = false
    if (armed.size === 0) return
    const leaked = [...armed.values()]
    for (const id of armed.keys()) nativeClearTimeout(id)
    armed.clear()
    throw new Error(
      `${leaked.length} timer(s) of ≥${LONG_TIMER_MS}ms still armed when the test ended; clear them on unmount or await them:\n` +
        leaked.map((timer) => `- ${timer.delay}ms armed at ${timer.stack}`).join('\n')
    )
  })
}
```

Fake timers: `vi.useFakeTimers()` replaces `globalThis.setTimeout` for the test and restores the guarded one on `vi.useRealTimers()`; fake timers are never recorded (the fake implementation does not call the guarded function), which is correct, since a fake timer cannot fire after teardown.

Add a test next to `test/vitest.config.test.ts` (new `test/vitest.setup.test.ts`, `@vitest-environment jsdom`): `window.setTimeout === globalThis.setTimeout` (so `window.setTimeout` callers are covered); a 0 ms timer left armed does not fail the next hook; a `setTimeout(() => {}, 500)` cleared with `clearTimeout` before the test ends does not fail; and, using a nested `describe` whose own `afterEach` catches the guard's error, that a 500 ms timer left armed makes the guard throw with `still armed`.

#### C3. Validation and the mechanical keep-or-shrink rule

1. Run the full gate (`yarn test`) with C1 alone. Any file that fails only because its own `afterEach` now runs after RTL's `cleanup` is fixed by moving the needed statements into an explicit `afterEach` **placed before** the file's first `render` import is not possible; instead the file sets `sequence.hooks` per file is not supported either, so: fix the file by calling what it needs inside `afterEach` **before** anything that depends on the mounted tree, or by moving an assertion out of `afterEach` into the test. If more than 10 files fail, drop C1, keep C2, and report the list.
2. Run the full gate with C1 + C2. Count the files the timer guard fails (its message starts with "timer(s) of"). If ≤ 10, fix each at the source: a component timer not cleared on unmount gets its cleanup (production bug, same class as #2665), a test's own polling timer is awaited. If 11–30, raise `LONG_TIMER_MS` to 1000 and recount; if still > 10, drop C2 and report the file list in the PR description. Never fix a file by lowering the guard's reach for it alone.
3. Then `repeat 3` of the full suite on SQLite (`yarn vitest run --maxWorkers=4`) and the PostgreSQL list (`node scripts/run.cjs scripts/maintenance/listPostgresTestFiles.ts | xargs yarn vitest run --maxWorkers=2`) green.

Proof of the class: revert B1 on a scratch branch with C in place; `yarn vitest run lib/components/drafts/DraftsProvider.test.tsx` fails the lifecycle test; with C1 alone (no C2), `repeat 10 lib/components/sign-out/SignOutDialog.test.tsx` is green even without B2's `cleanup()` lines (ordering alone unmounts first). For C2: in a scratch jsdom test, mount a component that arms `setTimeout(() => document.title, 300)` without cleanup and end the test; the guard names the test and the arming line.

#### C4. Docs

`CONTRIBUTING.md` → "Testing Guidelines": one paragraph on hook order (`sequence.hooks: 'list'`, unmount before the file's teardown; a file needing something before unmount does it inside the test) and the timer guard (what it flags, `LONG_TIMER_MS`, how to fix: clear on unmount or await). "Known failure classes": **"N timer(s) of ≥100ms still armed when the test ended" is the guard that replaced the post-teardown `ReferenceError: window/document is not defined`**; the stack names the arming line.

Commit/PR title: `test: run after-hooks in definition order and fail the test that leaves a long timer armed`

## 4. Needs Maythee

1. **Only if the Dependabot entries of A5 do not stop the workspace jobs** (verify after the first advisory or in Insights → Dependency graph → Dependabot: a job for `packages/<x>/package.json` that still opens a PR): Settings → Code security and analysis → **disable "Dependabot security updates"** (keep "Dependabot alerts"); the daily `/` version-update job then carries every fix. This session could not read the setting (the token lacks `security_events`), so the plan relies on the documented behaviour that `ignore` applies to security updates.
2. **Branch protection**: nothing to change; the required checks `All Tests`, `Lint and Prettier`, `Build` keep their names. If the `CI Re-run` workflow is ever required, do not: it is informational.
3. **`actions/cache@v6` resolution failures and SIGHUPs** are GitHub-side; if the SIGHUP class returns after A, open a GitHub support ticket with run ids (the plan deliberately does not auto re-run them).

## 5. Rejected proposals (one line each)

- Argon: per-package `directory` entries exist in `dependabot.yml` / replace with `directories: ['/', '/packages/*']` — the file never had them, and listing workspaces as extra projects creates exactly the lockfile-less jobs that broke.
- GLM: `allow: direct:production` + `ignore` on the `/` entry — would also stop the root job's correct, lockfile-carrying bumps (#2592, #2654).
- Astra: containment `ignore` list of workspace dependency names on the `/` entry — same objection, and it does not touch the security-update job rooted in the workspace.
- Argon: re-run from inside `All Tests` with `actions: write` — the PR-context token is read-only for Dependabot and fork PRs and `ci.yml` is `contents: read` by design; `workflow_run` on `main` is the privileged, code-free place.
- Fable: auto re-run of `exit 129` runs by log grep — the step ran repository code; a test can SIGHUP itself; not provably infra.
- Fable C6: skip the version-bump close/reopen kick — the kick is what heals the zero-job startup failures (REST timeline).
- Astra/GLM: pin actions to commit SHAs — one occurrence, resolution of a SHA depends on the same service; covered by the re-run rule; adds churn to every Dependabot actions bump.
- Argon: `maxWorkers: 2` / `teardownTimeout` in `vitest.config.ts` for the SIGHUPs — no evidence of a teardown hang; halves shard parallelism.
- GLM: raise `waitFor`/test timeouts (SignOutDialog, ProfileEditor, DraftEditor, createPollJob, credentialIdentity) — timeouts are not a fix; every one of those failures had a logged non-timeout cause or is fixed at the source.
- Fable S2/GLM: suite-wide `asyncUtilTimeout: 3000` — a blanket timeout raise with no observed failure it would have prevented.
- Fable S3: `unstubGlobals: true`, central `vi.useRealTimers()` — breaks files that stub in `beforeAll`; no observed failure.
- GLM/Argon: `typeof window === 'undefined'` guards in components — hides the leak instead of ending the work; the live-gate and the timer guard end it.
- Argon: `useLayoutEffect` for ProfileEditor/PrivacyLocations focus and scroll — the tests already wait for the effect; changing paint timing for a test is not warranted.
- Fable: ProfileEditor effect guard `if (!target) return` — the two setters batch into one commit; no path reaches the effect without the alert.
- Argon: `UV_THREADPOOL_SIZE=8`, `NODE_ENV === 'test'` branches for bcrypt cost and RSA size in production code — environment-dependent crypto strength in production modules; the seam + test mocks give the same speed without it.
- Astra: default-deny network in `vitest.setup.ts` — right direction, but mass churn (the suite's passthrough fetch is relied on by many route tests); the proofs use the preload instead; revisit separately.
- GLM: production `orderBy('id')` tie-breaker for lists — already present in `getLists`.
- Argon/Astra: `vi.getTimerCount() > 0` gate for the lock test — pg-pool arms fake timers of its own (the harness says so); the fake clock is removed instead.
- Fable T10: per-file `asyncUtilTimeout` for `DraftEditor.integration` — the failure was a disabled-button click, fixed by `postWhenReady`.
- Argon: `concurrency.group` keyed on the PR number — redundant once `push` is `main`-only.
- Fable (f): fold `typecheck` into lint, docker jobs path-filtered — load reduction without a failure behind it; out of scope.
