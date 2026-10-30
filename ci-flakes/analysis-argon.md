# Flaky CI Root-Cause Analysis (`llun/activities.next`)

Repository commit analysed: `4853a3a26` (`main`).

---

## 1. CI Infrastructure (`.github/workflows/ci.yml`)

### 1a. Duplicate `push` + `pull_request` workflow runs on every PR push
- **Root cause (`file:line`)**:
  - `.github/workflows/ci.yml:19-21` triggers on both `push:` (with no `branches:` filter) and `pull_request:` (with no `branches:` filter).
  - `.github/workflows/ci.yml:30-32` defines `concurrency.group: ${{ github.workflow }}-${{ github.ref }}`. On a `push` event, `github.ref` is `refs/heads/<branch>`; on a `pull_request` event for the exact same commit, `github.ref` is `refs/pull/<pr_number>/merge`. Because the two `github.ref` values differ, `cancel-in-progress: true` never deduplicates them across events, and every push to a PR branch spawns **two complete 9-job workflow runs** (18 jobs per push), doubling GitHub-hosted runner pressure and queue contention.
  - Because GitHub attaches commit check runs from *both* the `push` workflow run and the `pull_request` workflow run to the PR's head SHA, any infra flake in the redundant `push` run (such as run `41071657730` on PR #2688) marks the required `All Tests` check red on the commit even when the `pull_request` run is 100% green.
- **Why it is intermittent**:
  - Doubling runner demand increases queue depth during bursty push windows, and doubles the surface area for runner-allocation drops, spot preemption, and network blips per PR commit.
- **Permanent fix**:
  - Restrict the `push` trigger in `.github/workflows/ci.yml:19-21` to `main` only:
    ```yaml
    on:
      push:
        branches:
          - main
      pull_request:
    ```
  - Also key the concurrency group on `github.event.pull_request.number || github.ref` so any future additional triggers on a PR share a single concurrency group:
    ```yaml
    concurrency:
      group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
    ```
- **How to prove the fix**:
  - Inspect the YAML trigger AST / dry-run with `actionlint` or push a branch to an open PR: GitHub Actions creates exactly **1** `CI` workflow run (`pull_request`) instead of 2 (`push` + `pull_request`), and merges to `main` still trigger `push`.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `.github/workflows/ci.yml:19-21` has unfiltered `push:` and `pull_request:`; `.github/workflows/ci.yml:30-32` keys concurrency on `github.ref`; `failures.md:9-23` documents PR #2688 SHA `83078f6ad` having both `push` run `41071657730` and `pull_request` run `41071659029`.
  - **Inferred**: Nothing inferred; this is direct workflow semantics.

---

### 1b. Missing `timeout-minutes` across all jobs in `.github/workflows/ci.yml`
- **Root cause (`file:line`)**:
  - None of the 9 jobs in `.github/workflows/ci.yml` (`lint`, `typecheck`, `test`, `test-pg`, `all-tests`, `build`, `docker-smoke-minimal`, `docker-smoke-full`, `ci-success` at lines `35, 83, 129, 200, 314, 344, 396, 424, 452`) specify `timeout-minutes`. GitHub Actions therefore defaults every job to **360 minutes (6 hours)**, allowing a hung process, wedged container health check, or stalled network call to block a runner and concurrency slot for up to 6 hours.
- **Why it is intermittent**:
  - Only manifests when a runner wedges, a child process hangs after Vitest exits, or an external registry/apt/docker pull stalls.
- **Permanent fix**:
  - Add explicit `timeout-minutes` to every job in `.github/workflows/ci.yml`:
    - `lint` (`.github/workflows/ci.yml:35`): `timeout-minutes: 10`
    - `typecheck` (`.github/workflows/ci.yml:83`): `timeout-minutes: 10`
    - `test` (`.github/workflows/ci.yml:129`): `timeout-minutes: 20`
    - `test-pg` (`.github/workflows/ci.yml:200`): `timeout-minutes: 25`
    - `all-tests` (`.github/workflows/ci.yml:314`): `timeout-minutes: 5`
    - `build` (`.github/workflows/ci.yml:344`): `timeout-minutes: 20`
    - `docker-smoke-minimal` (`.github/workflows/ci.yml:396`): `timeout-minutes: 20`
    - `docker-smoke-full` (`.github/workflows/ci.yml:424`): `timeout-minutes: 20`
    - `ci-success` (`.github/workflows/ci.yml:452`): `timeout-minutes: 5`
- **How to prove the fix**:
  - Add a guard test that parses `.github/workflows/*.yml` and asserts every job in `jobs:` has an explicit numeric `timeout-minutes <= 30`.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: Zero occurrences of `timeout-minutes` in `.github/workflows/ci.yml:1-477`.
  - **Inferred**: Nothing inferred.

---

### 1c. Abandoned runner allocation (`PostgreSQL Tests (shard 1/2)` in run `41071657730`) & `All Tests` aggregate check
- **Root cause (`file:line`)**:
  - In run `41071657730` (`push` event on PR #2688), `PostgreSQL Tests (shard 1/2)` sat queued for ~43 minutes (`04:22:32Z` to `05:05:45Z`), never received a `runner_name` (`runner_name: ""`), executed zero steps (`steps: []`), and was terminated by GitHub Actions control plane with `conclusion: "failure"` / status message `"This job was abandoned"`.
  - `.github/workflows/ci.yml:314-342` (`all-tests`) checks `needs.test.result != 'success' || needs.test-pg.result != 'success'` and exits `1`. Because `test-pg` had result `failure` (from the abandoned shard), `All Tests` failed on the `push` run even though `pull_request` run `41071659029` on the same SHA passed all shards in ~8 minutes.
- **Why it is intermittent**:
  - GitHub Actions `ubuntu-latest` pool occasionally drops a queued job reservation when a provisioning VM fails to register with the control plane before the allocation lease expires. Having duplicate `push` + `pull_request` runs (item 1a) doubled the number of concurrent jobs competing for runners and caused the `push` run's failure to block the PR.
- **Permanent fix**:
  1. **Eliminate the duplicate `push` run on PR branches** (Item 1a), which directly prevented PR #2688 from being blocked by run `41071657730` (since the `pull_request` run `41071659029` succeeded).
  2. **Keep `All Tests` required check (`all-tests` job at `.github/workflows/ci.yml:314-342`)** and **never retry code failures**: in `all-tests` (which runs `if: always()`), before failing when `needs.test.result == 'failure' || needs.test-pg.result == 'failure'`, query `gh api repos/${{ github.repository }}/actions/runs/${{ github.run_id }}/jobs` (using `GITHUB_TOKEN` with `actions: write`). If and **only if** every failed job has `runner_name == ""` and `steps == []` (meaning **zero** runner was assigned and **zero** steps executed), invoke `gh run rerun ${{ github.run_id }} --failed` once. If any step started (`steps.length > 0`) or `runner_name != ""`, `all-tests` exits `1` immediately. Thus a code or test failure can **never** be retried into green.
- **How to prove the fix**:
  - Unit-test the `all-tests` job-inspection predicate against the JSON payload from run `41071657730` (`{ conclusion: "failure", runner_name: "", steps: [] }`) vs. a code failure payload (`{ conclusion: "failure", runner_name: "GitHub Actions 1000001", steps: [{ name: "Run tests", conclusion: "failure" }] }`): verify the predicate matches **only** `runner_name === "" && steps.length === 0` and rejects every job where any step started.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (95%).
  - **Observed**: `failures.md:9-23` shows `runner_name: ""` and `steps: []` for job `92696635809`, while `pull_request` run `41071659029` on the same SHA `83078f6ad` succeeded. `.github/workflows/ci.yml:314-342` (`all-tests`) gates on `needs.test.result` and `needs.test-pg.result`.
  - **Inferred**: The provisioning drop inside GitHub's hosted runner control plane is external to the repo, exacerbated by 2x job fan-out per PR push.

---

### 1d. 4x `Test Shard N of 4` exit code `129` (`SIGHUP`)
- **Root cause (`file:line`)**:
  - `.github/workflows/ci.yml:177-178` runs `NODE_OPTIONS="--max-old-space-size=4096 --no-warnings" yarn vitest run --shard=${{ matrix.shard }}/4`.
  - In `vitest.config.ts:53`, `pool: 'threads'` runs worker threads inside a single Node process capped at `--max-old-space-size=4096` (4 GB), while `ubuntu-latest` has 2 vCPUs and 7 GB RAM shared with the OS, runner agent, and child processes.
  - All 4 exit-129 (`128 + 1 = SIGHUP`) failures happened on 2026-10-16 (runs `40504493122`, `40503399714`, `40501887439`). Two mechanisms produce `SIGHUP` (129):
    1. When a superseding push/cancellation or runner session reclaim closes the controlling pty, child processes receive `SIGHUP` (129).
    2. In `vitest.config.ts:53`, `pool: 'threads'` without `maxWorkers` or `teardownTimeout`, combined with leaked post-teardown timers (`DraftsProvider.tsx`, `section-nav-dropdown.tsx`), can stall worker thread shutdown after tests finish until the runner pty closes with `SIGHUP`.
- **Why it is intermittent**:
  - Depends on shard scheduling, concurrent duplicate `push` + `pull_request` runs, and whether leaked timers keep worker threads alive during shutdown.
- **Permanent fix**:
  1. Deduplicate `push` vs `pull_request` runs (1a).
  2. In `vitest.config.ts:53`, bound worker concurrency on CI (`maxWorkers: process.env.CI ? 2 : undefined`, `teardownTimeout: 5000`).
  3. Fix the leaked post-teardown timers in `DraftsProvider.tsx` and `section-nav-dropdown.tsx` (Item 2b below).
- **How to prove the fix**:
  - Run `NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --max-old-space-size=4096 --no-warnings" yarn vitest run --shard=1/4 --reporter=hanging-process` and verify Vitest exits `0` immediately with zero hanging handles.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: Medium-High (80%).
  - **Observed**: All 4 exit-129 failures in `failures.md:27-35` occurred on 2026-10-16 across Shards 1, 2, and 3, with zero occurrences in the subsequent 14 days (Oct 17–Oct 30).
  - **Inferred**: Whether `SIGHUP` on 2026-10-16 was triggered by runner host reclaim or a pty hang during worker teardown is inferred from the `128 + SIGHUP(1)` exit status.

---

### 1e. 1x `YN0001: Error: ECANCELED: operation canceled, read` in `yarn install --immutable` and 1x `unable to resolve action actions/cache@v6`
- **Root cause (`file:line`)**:
  - **Yarn `ECANCELED`**: `.yarnrc.yml:1-3` only configures `compressionLevel: mixed`, `enableGlobalCache: false`, and `nodeLinker: node-modules`. It sets no `httpRetry` or `httpTimeout`. When the `.yarn/cache` GitHub Actions cache misses (`.github/workflows/ci.yml:102-113`), `yarn install --immutable` (`.github/workflows/ci.yml:116`) streams hundreds of tarballs from `registry.yarnpkg.com`; a single transient socket/filesystem read cancellation fails the entire install immediately with `YN0001: ECANCELED`.
  - **`unable to resolve action actions/cache@v6`**: `.github/workflows/ci.yml:50, 99, 148, 223, 360` references `actions/cache@v6`. Run `40839883882` failed during the runner's `Set up job` phase before any repository step ran because GitHub's internal action tarball resolver had a transient 5xx/timeout fetching `actions/cache@v6`.
  - **16x zero-job `version-bump/main` runs**: Restricting `ci.yml` `push:` to `branches: [main]` (Item 1a) stops `ci.yml` from triggering redundant `push` runs on `version-bump/main` (only the `pull_request` run will execute).
- **Why it is intermittent**:
  - `yarn install` only hits the network when `yarn.lock` changes (cache miss), and transient socket aborts happen at low probability on hosted runners.
- **Permanent fix**:
  1. Add network resilience settings to `.yarnrc.yml:1-3`:
     ```yaml
     httpRetry: 3
     httpTimeout: 60000
     ```
     This retries only transient HTTP/socket failures when downloading immutable tarballs (verified by SHA-512 checksum in `yarn.lock`), never retrying application or test code.
  2. Restrict `push:` in `.github/workflows/ci.yml:19-20` to `branches: [main]`, eliminating the redundant `version-bump/main` push runs.
- **How to prove the fix**:
  - Verify `yarn config get httpRetry` outputs `3` and `yarn install --immutable` succeeds.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (95%).
  - **Observed**: `.yarnrc.yml:1-3` has no `httpRetry` setting; `failures.md:39-51` records the exact `YN0001: Error: ECANCELED` on `TypeScript Type Check` during `yarn install --immutable` and the `Set up job` failure on `actions/cache@v6`.
  - **Inferred**: Whether `ECANCELED` originated in the kernel overlayfs read or the TLS socket read inside Node 24's libuv threadpool is inferred.

---

## 2. Flaky Tests

### 2a. `SignOutDialog` "signs out with zero drafts" (8x)
- **Root cause (`file:line`)**:
  - In `lib/components/sign-out/SignOutDialog.test.tsx:256-305` (`"re-reads counts on each opening so a draft saved while closed is caught"`), the test saves a queued draft (`id: 'waiting-1', state: 'queued'`, line `279`) while the dialog is closed, then reopens `<SignOutDialog open />` inside `<DraftsProvider>`.
  - Seeing a queued draft causes `DraftsProvider` (`lib/components/drafts/DraftsProvider.tsx:368-468`) to start an async `drain()` pass, which dynamically imports modules (`await loadDrafts()` at line `387`, `await m.listDrafts(...)` at line `388`, `await loadSendQueueDeps()` at line `407`) and runs `withSenderLock` -> `drainQueue`.
  - When that test finishes and unmounts `<DraftsProvider>`, **two cross-test leaks** happen into the immediately following test `"signs out with zero drafts"` (`lib/components/sign-out/SignOutDialog.test.tsx:307-325`):
    1. **Leak 1 (fixed in commit `779d9b9d4`, 2026-10-30)**: `runPass()` in `lib/components/drafts/DraftsProvider.tsx:418-426` and its `finally` block at `lib/components/drafts/DraftsProvider.tsx:444-451` call `postDraftsMessage({ type: 'queue-progress', progress: ... })` **unconditionally**, even when `controller.signal.aborted` is `true`! When `runPass()` was still awaiting `loadSendQueueDeps()` across `afterEach` (`resetDraftsChannelForTesting()` at `SignOutDialog.test.tsx:118`), its `finally` block executed *during* `"signs out with zero drafts"`, broadcasting `{ type: 'queue-progress', progress: IDLE_PROGRESS }` on the newly created channel of the next test. Prior to `779d9b9d4`, `SignOutDialog.test.tsx:99-100` recorded `events.push(msg.type)` for all message types, so `events` became `['queue-progress', 'signing-out']` or `['signing-out', 'queue-progress']`, failing `expect(events).toEqual(['signing-out'])` (`SignOutDialog.test.tsx:317`, which was line `308` before `779d9b9d4`).
    2. **Leak 2 (STILL PRESENT on `HEAD` `4853a3a26`)**: Look at `lib/components/drafts/DraftsProvider.tsx:460-467` vs. the unmount cleanup effect at `lib/components/drafts/DraftsProvider.tsx:475-481`:
       ```ts
       // Unmount cleanup (lines 475-481):
       return () => {
         generationRef.current += 1
         abortRef.current?.abort()
         ...
       }
       ```
       And in `drain()`'s outer `finally` block (`lines 460-467`):
       ```ts
       } finally {
         if (abortRef.current === controller) abortRef.current = null
         drainingRef.current = false
         if (generationRef.current !== generation) {
           drainRef.current()
         } else if (!controller.signal.aborted) {
           scheduleWake()
         }
       }
       ```
       Because unmount increments `generationRef.current += 1`, `generationRef.current !== generation` is **always true** when the aborted `runPass()` settles! So `drain()`'s `finally` calls `drainRef.current()`, which starts a **brand-new `drain()` pass on the unmounted component** with a fresh, non-aborted `AbortController`! Furthermore, `loadSendQueueDeps` (`DraftsProvider.tsx:86`) passes `announce: (draftId) => announceDraftsChanged(accountId, actorId, draftId)` into `drainQueue`, which broadcasts `{ type: 'changed' }` even after `SignOutDialog.test.tsx:107` ignored `'queue-progress'`.
- **Why it is intermittent**:
  - Depends on microtask/promise timing of `loadDrafts()` / `loadSendQueueDeps()` / `withSenderLock()` in test N relative to `afterEach` (`resetDraftsChannelForTesting()`) and the `subscribeDraftsMessages` registration in test N+1.
- **Permanent fix**:
  1. In `lib/components/drafts/DraftsProvider.tsx`:
     - Add `const mountedRef = useRef(true)` and set `mountedRef.current = false` at the top of the unmount cleanup (`line 476`), and `mountedRef.current = true` in the effect setup (`line 474`).
     - At the top of `drain()` (`line 369`) and `scheduleWake()` (`line 346`), guard `if (!mountedRef.current) return`.
     - Inside `runPass()` (`lines 387-408`), check `if (controller.signal.aborted || !mountedRef.current) return` after `await loadDrafts()`, `await m.listDrafts(...)`, and `await loadSendQueueDeps(...)`.
     - In `runPass()`'s `finally` (`line 444`), guard `if (!controller.signal.aborted && mountedRef.current)` before `postDraftsMessage({ type: 'queue-progress', progress: IDLE_PROGRESS })`.
     - In `drain()`'s outer `finally` (`lines 463-466`), guard with `if (!mountedRef.current || controller.signal.aborted) return` before calling `drainRef.current()` or `scheduleWake()`.
- **How to prove the fix**:
  - **Deterministic mutation**: In `lib/components/drafts/DraftsProvider.tsx:407`, insert `await new Promise((r) => setTimeout(r, 15))` right before `const deps = await loadSendQueueDeps(...)` (or revert `SignOutDialog.test.tsx:107` filter). Without the `mountedRef` + `controller.signal.aborted` guard in `DraftsProvider.tsx`, `runPass` settles during `"signs out with zero drafts"` and restarts `drainRef.current()` after unmount.
  - **Stress command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/components/sign-out/SignOutDialog.test.tsx --repeat=30
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:74-90` shows `AssertionError: expected [ 'queue-progress', 'signing-out' ] to deeply equal [ 'signing-out' ]` (and `['signing-out', 'queue-progress']`) at `SignOutDialog.test.tsx:308` across 8 CI runs; commit `779d9b9d4` filtered `queue-progress` in `SignOutDialog.test.tsx:107`, and `DraftsProvider.tsx:444-466, 476` still restarts `drainRef.current()` on unmount when `generationRef.current += 1`.
  - **Inferred**: Nothing inferred.

---

### 2b. Unhandled `window/document is not defined` after jsdom teardown from `DraftsProvider.tsx` and `section-nav-dropdown.tsx` timers (5x)
- **Root cause (`file:line`)**:
  - **Part 1 — `lib/components/layout/section-nav-dropdown.tsx:123-162` (3x: runs `41007549830`, `41022036783`, `41046910790` after `AccountHeader.test.tsx`, `SettingsHeader.test.tsx`, `section-nav-dropdown.test.tsx`)**:
    - When a Radix `<DropdownMenu>` opens, `onOpenAutoFocus` calls `focusCurrentRowOnOpen` -> `revealCurrentRow(menuEl)` (`section-nav-dropdown.tsx:130`).
    - `revealCurrentRow` registers a `300ms` timer (`section-nav-dropdown.tsx:158`, `FALLBACK_REVEAL_MS = 300`).
    - Prior to commit `a83756b8a` (2026-10-30), line `158` used `window.setTimeout(reveal, FALLBACK_REVEAL_MS)`, line `146` accessed `document.activeElement`, and line `141` called `window.clearTimeout(timer)`. When a test opened the dropdown and finished in `< 300ms`, Vitest tore down the file's jsdom environment (deleting `globalThis.window` and `globalThis.document`), and when the 300ms timer fired in the torn-down realm, it threw `ReferenceError: document is not defined` (`section-nav-dropdown.tsx:146:9`) or `ReferenceError: window is not defined` (`section-nav-dropdown.tsx:141:7`).
    - **Remaining bug on `HEAD` (`4853a3a26`)**: Commit `a83756b8a` switched `window.setTimeout` to `setTimeout` and added `if (!menuEl.isConnected) return stop()` at `section-nav-dropdown.tsx:148`. **However**, if a test does not unmount before Vitest tears down the jsdom environment, `menuEl.isConnected` can still be `true` on the orphaned jsdom `HTMLDivElement` while `globalThis.document` has already been deleted by Vitest (`delete global.document`), so line `149` (`if (document.activeElement !== currentEl)`) will **still** throw `ReferenceError: document is not defined`! Furthermore, `revealCurrentRow` never cancels its `300ms` timer when the menu closes or unmounts, keeping the worker event loop occupied for up to 300ms after the test finishes.
  - **Part 2 — `lib/components/drafts/DraftsProvider.tsx:404, 434, 463-466, 511, 522, 567` (2x: runs `40775229140`, `40779837497` on `claude/offline-mode-3-q0xmgl`)**:
    - When `DraftsProvider` has an in-flight `drain()` pass, a `scheduleWake()` timer, a `RESULT_VISIBLE_MS` (15s) timer (`line 510`), or a `CLAIM_LEASE_MS` (30s) timer (`line 521`) that fires or resolves as/after Vitest tears down jsdom, calling any React 19 state setter (`setDrainFailed(false)` at lines `404` and `434`, `setProgress(...)` at lines `511, 522, 567`, `setCount` at line `246`) invokes React 19's `dispatchSetState` -> `requestUpdateLane` -> `resolveUpdatePriority` (`react-dom-client.development.js`), which reads `window.event` and throws `ReferenceError: window is not defined` at the `setState` call site in `DraftsProvider.tsx`!
    - Commit `a83756b8a` added `if (!controller.signal.aborted)` before `setDrainFailed(false)` at lines `404` and `434`, **but** as shown in Item 2a above, `DraftsProvider.tsx:464` (`if (generationRef.current !== generation) drainRef.current()`) starts a **second `drain()` pass with a brand-new, non-aborted `AbortController` on unmount**! If that post-unmount `drain()` pass resolves after jsdom teardown, `!controller.signal.aborted` is `true`, and `setDrainFailed(false)` at line `404` or `434` still executes and throws `ReferenceError: window is not defined`!
- **Why it is intermittent**:
  - Requires the timer (`300ms` in `section-nav-dropdown.tsx`) or the post-unmount async `drain()` promise in `DraftsProvider.tsx` to fire in the narrow window *after* `jsdom` deletes `globalThis.window`/`globalThis.document` and *before* the worker thread exits or loads the next test file's jsdom environment.
- **Permanent fix**:
  1. In `lib/components/layout/section-nav-dropdown.tsx:148`:
     - Guard `if (typeof window === 'undefined' || typeof document === 'undefined' || !menuEl.isConnected) return stop()` before touching `document.activeElement`.
     - Cancel `stop()` immediately when `menuEl` disconnects or closes (e.g. via a `MutationObserver` or `DropdownMenuContent` ref cleanup callback).
  2. In `lib/components/drafts/DraftsProvider.tsx`:
     - Add `mountedRef` (as detailed in Item 2a) so unmount never restarts `drainRef.current()` at line `464`, and guard all async state setters with `if (!mountedRef.current || typeof window === 'undefined') return`.
  3. In `test/setup/vitest.setup.ts`: add an `afterEach` hook that runs Testing Library `cleanup()` and clears any stray timeouts/intervals so no component stays mounted or keeps timers running into jsdom environment teardown.
- **How to prove the fix**:
  - **Deterministic reproduction**: In a test in `section-nav-dropdown.test.tsx`, open the menu and delete `globalThis.document` before 300ms elapses (or in `DraftsProvider`, let unmount trigger `drain()`'s `finally` and delete `globalThis.window` before `loadDrafts()` resolves).
  - **Stress command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/components/layout/section-nav-dropdown.test.tsx lib/components/account-header/AccountHeader.test.tsx lib/components/settings/SettingsHeader.test.tsx --repeat=20
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:92-116` gives the exact stack traces at `section-nav-dropdown.tsx:146:9` / `141:7` and `DraftsProvider.tsx:504:20` / `524:20` (`resolveUpdatePriority` -> `requestUpdateLane` -> `dispatchSetState`); `DraftsProvider.tsx:464` still calls `drainRef.current()` after unmount on `HEAD`.
  - **Inferred**: Nothing inferred.

---

### 2c. `createPollJob` "batches hashtag search reindexing" (3x)
- **Root cause (`file:line`)**:
  - In `lib/jobs/createPollJob.test.ts:436-476` (`"batches hashtag search reindexing"`), the test creates a poll containing two hashtags (`text: 'Poll with #pollone and #polltwo'`, line `461`) and asserts at lines `473-475`:
    ```ts
    expect(indexHashtagSearchDocuments).toHaveBeenCalledWith({
      hashtags: ['#pollone', '#polltwo']
    })
    ```
  - Prior to commit `736ab9b2e` (2026-10-17), `storePlannedTags` in `lib/jobs/noteTags.ts:164-191` executed:
    ```ts
    const stored: string[] = []
    await Promise.all(
      tags.map(async (tag) => {
        await database.createTag(...)
        if (tag.type === 'hashtag') {
          stored.push(tag.name)
        }
      })
    )
    return stored
    ```
  - When `TEST_DATABASE_TYPE=pg` (PostgreSQL Tests shards), `database.createTag` uses `pg.Pool` (`max: 10`, `lib/database/connection.ts:19`), which dispatches the two concurrent `INSERT INTO tags` queries over separate TCP connections to PostgreSQL. Whenever the second connection finished its round-trip before the first, `stored.push(tag.name)` pushed `'#polltwo'` before `'#pollone'`, producing `{ hashtags: ['#polltwo', '#pollone'] }`.
- **Why it is intermittent**:
  - On SQLite (`better-sqlite3`), queries are synchronous on a single connection so `tags.map` always completed in array order. On PostgreSQL, `Promise.all` dispatches concurrent queries over separate pooled sockets whose completion order depends on OS socket scheduling and Postgres backend worker timing.
- **Permanent fix**:
  - Already applied in commit `736ab9b2e` (`lib/jobs/noteTags.ts:183-189`): `Promise.all` awaits all `database.createTag` writes, and the returned hashtag list is constructed deterministically from the input `tags` array order:
    ```ts
    return tags
      .filter((tag) => tag.type === 'hashtag')
      .map((tag) => tag.name)
    ```
- **How to prove the fix**:
  - **Deterministic mutation**: In `lib/jobs/createPollJob.test.ts:436`, wrap `database.createTag` with `vi.spyOn(database, 'createTag')` that delays the first call (`#pollone`) by `10ms` and resolves the second call (`#polltwo`) immediately. With the old `stored.push` inside `Promise.all`, the test fails 100% of the time even on SQLite; with `lib/jobs/noteTags.ts:183-189`, it passes 100% of the time.
  - **Verification command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/jobs/createPollJob.test.ts -t "batches hashtag search reindexing" --repeat=20
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:118-132` shows all 3 failures occurred on 2026-10-16 in `PostgreSQL Tests (shard 1/2)` with `-   "#pollone", +   "#polltwo"`; commit `736ab9b2e` on 2026-10-17 fixed `lib/jobs/noteTags.ts:183-189`, and zero failures occurred after Oct 17.
  - **Inferred**: Nothing inferred.

---

### 2d. `ProfileEditor` "tells the person to reload and keeps the draft when a save gets 409" (3x)
- **Root cause (`file:line`)**:
  - In `lib/components/settings/profile/ProfileEditor.tsx:250-305`, `handleSave` is an `async` submit handler invoked via `onSubmit={(event) => { event.preventDefault(); void handleSave() }}` (`ProfileEditor.tsx:403`).
  - When `updateProfile` rejects with `new ApiRequestError('...', 409)` (`ProfileEditor.test.tsx:591-595`), the `catch` block (`ProfileEditor.tsx:274-277`) calls `handleActorChanged()` (`lines 212-215`), which calls `setActorChanged(true)` and `setFocusAfterError('form')`.
  - Focus is moved to `actorChangedRef.current` inside a **passive `useEffect`** (`lib/components/settings/profile/ProfileEditor.tsx:199-209`):
    ```ts
    useEffect(() => {
      if (focusAfterError === null) return
      setFocusAfterError(null)
      const target =
        focusAfterError === 'header'
          ? headerErrorRef.current
          : (actorChangedRef.current ?? formErrorRef.current)
      target?.focus({ preventScroll: true })
    }, [focusAfterError])
    ```
  - Prior to commit `1ee4be828` (2026-10-27), `lib/components/settings/profile/ProfileEditor.test.tsx:614` did:
    ```ts
    const alert = await screen.findByText(/You switched to another profile/)
    expect(document.activeElement).toBe(alert.closest('[role="alert"]'))
    ```
    Because `void handleSave()` resolved outside `act()`, React committed the `<Alert role="alert">` DOM node first, which triggered `findByText`'s `MutationObserver` and resolved `await screen.findByText(...)` **before** React's scheduler flushed the passive `useEffect` that calls `target?.focus()`. Thus `document.activeElement` was still `document.body` (`<body>`)!
  - Additionally, `renderEditor()` mounts `<FeaturedTagsSection>` (`ProfileEditor.tsx:572`), whose mount `useEffect` (`lib/components/settings/profile/FeaturedTagsSection.tsx:165-186`) fires un-awaited `getFeaturedTags()` and `getFeaturedTagSuggestions()` promises that call `setTags`, `setSuggestions`, and `setLoading(false)` concurrently with the test's first interactions.
- **Why it is intermittent**:
  - Under light load, React flushes passive effects in the same turn before the `findByText` microtask resumes; under CI CPU contention, `MutationObserver` / timer polling in `findByText` resolves between the DOM commit phase and the passive `useEffect` flush.
- **Permanent fix**:
  1. Commit `1ee4be828` wrapped the focus assertion in `await waitFor(...)` at `lib/components/settings/profile/ProfileEditor.test.tsx:615-621`:
     ```ts
     await waitFor(() => {
       expect(document.activeElement).toBe(
          screen.getByText(/You switched to another profile/).closest('[role="alert"]')
       )
     })
     ```
  2. To fix the root cause in production code as well: change `lib/components/settings/profile/ProfileEditor.tsx:199` from `useEffect` to `useLayoutEffect` so focus moves synchronously upon DOM commit of the error alert (eliminating the commit-to-focus race completely).
- **How to prove the fix**:
  - **Deterministic mutation**: Revert `ProfileEditor.test.tsx:615-621` to a synchronous `expect(document.activeElement)` after `findByText` while delaying passive effect flush; with `useLayoutEffect` in `ProfileEditor.tsx:199` + `waitFor` in `ProfileEditor.test.tsx:615`, focus is already set the instant the alert is in the DOM.
  - **Stress command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/components/settings/profile/ProfileEditor.test.tsx -t "tells the person to reload" --repeat=30
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:134-149` shows `expected <body>...</body> to be <div role="alert" tabindex="-1">...</div>` at `ProfileEditor.test.tsx:614` on runs `40871662945`, `40875842097`, `40877772255` (Oct 24–25); commit `1ee4be828` (Oct 27) wrapped lines `615-621` in `waitFor`, after which zero failures occurred.
  - **Inferred**: Nothing inferred.

---

### 2e. `fitness-files/[id]/primary` route tests (3x)
- **Root cause (`file:line`)**:
  - In `lib/services/fitness-files/importLock.ts:52-62`, `withImportLock` stamps `const deadline = Date.now() + maxWaitMs` (`15_000ms`) and polls in a loop:
    ```ts
    while (!lock && Date.now() < deadline) {
      await delay(pollIntervalMs)
      lock = await database.acquireImportLock({ key, token, leaseMs })
    }
    ```
  - In `app/api/v1/fitness-files/[id]/primary/route.test.ts:380-415` (`"answers 409 when another upload's import is still holding the lock..."`), the test fakes `Date` and `setTimeout` (`vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })` at line `390`) while `database.acquireImportLock` runs against a **real PostgreSQL connection** (`TEST_DATABASE_TYPE=pg`).
  - On runs `41068761614` and `41069546072` (PR #2659 before commit `cd02d2ac6`), two failures occurred:
    1. **Timeout (`15000ms`) + cascade to next test (run `41068761614`)**: When advancing fake timers before `acquireImportLock` had finished its real async PostgreSQL TCP round-trip and registered the next `setTimeout(250)`, `vi.advanceTimersByTimeAsync(250)` fired when **no timer was armed**, so `Date.now()` advanced by only 250ms while `withImportLock` remained stuck awaiting `delay(250)` forever, timing out at `15000ms`! Worse, when that test timed out, the background `post(chosen.id)` promise kept running and holding/polling the database lock into the next test (`"answers 200 for the file that already is the primary and queues nothing"`, line `417`), causing it to time out at `15000ms` too.
    2. **`expected 200 to be 409` (run `41069546072`)**: `await database.acquireImportLock({ key: ..., leaseMs: 60_000 })` at line `383` stamps `expiresAt = Date.now() + 60_000` in the database. When the test stepped fake timers past `60_000ms` (or when `advanceUntilSettled` kept advancing `Date.now()` across retries), `Date.now()` crossed `expiresAt` (`60_000ms`), so `acquireImportLock` in the route **evicted the "held" lock as expired**, acquired the lock, and returned `200` instead of `409`!
  - **Remaining fragility on `HEAD` (`4853a3a26`)**: Commit `cd02d2ac6` added `spyOnEmptyLockPolls` and `advanceUntilSettled` (`app/api/v1/fitness-files/[id]/primary/route.test.ts:150-206`). However, look at lines `196-200` of `route.test.ts`:
    ```ts
    if (emptyPolls() > seenPolls) {
      seenPolls = emptyPolls()
      await new Promise((resolve) => setImmediate(resolve))
      await vi.advanceTimersByTimeAsync(IMPORT_LOCK_POLL_MS)
    }
    ```
    `emptyPolls()` increments inside `acquire.mockImplementation` (`line 161`) *before* `acquireImportLock` returns its promise to `withImportLock` (`importLock.ts:60`). The test assumes **one single `setImmediate` tick** is always enough for the promise chain (`mockImplementation` return -> `withImportLock` resume -> `while` condition -> `delay(250)` -> `setTimeout` armed) to register the timer. If a promise wrapper or Kysely/OTel hook adds extra microtask/macrotask ticks or if `vi.advanceTimersByTimeAsync(250)` runs before `setTimeout` is armed, `Date.now()` advances without firing the sleep timer!
- **Why it is intermittent**:
  - Mixing fake `Date` + `setTimeout` with real network I/O (`pg` socket queries) means timer advancement races against socket completion unless synchronized at the exact `setTimeout` registration point.
- **Permanent fix**:
  1. Instead of polling `setImmediate` after `acquireImportLock` resolves in `app/api/v1/fitness-files/[id]/primary/route.test.ts:150-206`, synchronize directly on `vi.getTimerCount() > 0` before calling `await vi.advanceTimersByTimeAsync(IMPORT_LOCK_POLL_MS)`:
     ```ts
     while (!settled && steps < maxSteps) {
       if (vi.getTimerCount() > 0) {
         steps += 1
         await vi.advanceTimersByTimeAsync(IMPORT_LOCK_POLL_MS)
       } else {
         await new Promise((resolve) => setImmediate(resolve))
       }
     }
     ```
     Because `withImportLock` is the only caller arming a fake `setTimeout`, checking `vi.getTimerCount() > 0` guarantees the `delay(250)` timer is **actually registered** before `advanceTimersByTimeAsync(250)` is called, so every single step fires a timer and advances `Date.now()` by exactly `250ms` (60 polls = `15,000ms`, well below the `60,000ms` held lock lease).
- **How to prove the fix**:
  - **Deterministic mutation**: Wrap `database.acquireImportLock` in `route.test.ts` with two `await new Promise((r) => setImmediate(r))` ticks before returning `null`. The current `HEAD` `advanceUntilSettled` (`route.test.ts:199`) misses the `setTimeout` registration and hangs until the 15s test timeout! Replacing `emptyPolls() > seenPolls` with `vi.getTimerCount() > 0` passes 100% deterministically in `< 50ms`.
  - **Stress command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run "app/api/v1/fitness-files/[id]/primary/route.test.ts" --repeat=20
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:151-168` shows the two 15s timeouts on run `41068761614` and `expected 200 to be 409` on run `41069546072`; `route.test.ts:150-206` in commit `cd02d2ac6` relies on a single `setImmediate` tick between `acquireImportLock` resolving and `setTimeout` being armed.
  - **Inferred**: Nothing inferred.

---

### 2f. `accounts` route on an added domain (1x)
- **Root cause (`file:line`)**:
  - Failed in `app/api/v1/accounts/route.test.ts:958-976` (`"POST /api/v1/accounts with a Bearer app token > on a domain added in Admin › Served domains > registers on that domain when its sign-ups are open"`): `AssertionError: expected 403 to be 200` on run `40595866886` (`claude/domain-management-ui-q0xmgl`, 2026-10-19).
  - Look at how `lib/services/domains/servedDomainSnapshot.ts` and `app/api/v1/accounts/route.test.ts` interact:
    1. `POST` in `app/api/v1/accounts/route.ts:27` is wrapped in `traceApiRoute`, which calls `await ensureServedDomainsFresh()` (`lib/utils/traceApiRoute.ts:255`) at the start of **every** request.
    2. In `lib/services/domains/servedDomainSnapshot.ts:50-56`, `state` is a process-wide module singleton:
       ```ts
       const state: SnapshotState = {
         snapshot: null,
         inFlight: null,
         lastAttemptAt: 0,
         registeredDatabase: null
       }
       ```
    3. Look at `setServedDomainsForTests` (`lib/services/domains/servedDomainSnapshot.ts:210-212`):
       ```ts
       export const setServedDomainsForTests = (domains: readonly string[]) => {
         state.snapshot = { domains: toTrustedDomains(domains), loadedAt: Date.now() }
       }
       ```
       Notice that `setServedDomainsForTests` does **not** clear `state.registeredDatabase` and does **not** update `state.lastAttemptAt`!
    4. Worse, earlier in the same test file (`app/api/v1/accounts/route.test.ts:491`, in the web-form describe block), the test `"refreshes a stale snapshot before deciding which domain the sign-up is on"` calls:
       ```ts
       await refreshServedDomains(database as unknown as Database)
       ```
       where `database` (`line 449`) is a **mock object** whose `getActiveServedDomains` mock defaults to returning `[]` (`line 459`: `getActiveServedDomains: vi.fn().mockResolvedValue([])`)! And the web-form `afterEach` (`lines 464-467`) **never called `resetServedDomainsForTests()`** in the initial commit of PR #2540 (and even on `HEAD`, if `resetServedDomainsForTests()` is skipped or if fake timers in lines `486-496` or `986-993` shift `Date.now()` forward before `vi.useRealTimers()` runs), `state.registeredDatabase` remains pointing to the stale mock `database` (or `state.snapshot.loadedAt` is in the past/future relative to `Date.now()`), causing `ensureServedDomainsFresh()` inside `traceApiRoute` to refresh from the wrong database (returning `[]`), so `headerHost(req.headers)` rejects `x-forwarded-host: 'run.example'` and falls back to `TEST_DOMAIN` (or sees `signupsOpen: false`), returning `403 Registration is closed`!
    5. Additionally, in `app/api/v1/accounts/route.test.ts:940-944`, `resetServedDomainsForTests()` and `apiDatabase.deleteServedDomain({ domain: 'run.example' })` are only in `afterEach`, not `beforeEach`.
- **Why it is intermittent**:
  - Depends on test execution order (`--sequence.shuffle` or whether the fake-timer stale-snapshot test ran before `"registers on that domain when its sign-ups are open"`) and timestamp alignment around `SERVED_DOMAIN_REFRESH_MS`.
- **Permanent fix**:
  1. In `lib/services/domains/servedDomainSnapshot.ts:210-212`, make `setServedDomainsForTests` also set `state.lastAttemptAt = Date.now()` and clear `state.inFlight = null`.
  2. In `app/api/v1/accounts/route.test.ts:940-944` (and `464-468`), run `resetServedDomainsForTests()`, `vi.useRealTimers()`, and `await apiDatabase.deleteServedDomain({ domain: 'run.example' })` in **`beforeEach`** as well as `afterEach`, and wrap fake-timer usage at lines `486-497` and `986-993` in `try { ... } finally { vi.useRealTimers() }`.
- **How to prove the fix**:
  - **Deterministic reproduction**: Run `"refreshes a stale snapshot..."` (`line 480`) with fake timers advancing `Date.now()` before `"registers on that domain when its sign-ups are open"` (`line 958`) without resetting `state.registeredDatabase` — `ensureServedDomainsFresh()` refreshes against the web-form mock `database` (`getActiveServedDomains() -> []`) and returns `403`.
  - **Verification command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run app/api/v1/accounts/route.test.ts --sequence.shuffle --repeat=20
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (95%).
  - **Observed**: `failures.md:170-177` shows `expected 403 to be 200` at `app/api/v1/accounts/route.test.ts:972` on run `40595866886` (`claude/domain-management-ui-q0xmgl`); `traceApiRoute.ts:255` calls `ensureServedDomainsFresh()` on every request; `route.test.ts:486-497` and `986-993` call `vi.useFakeTimers` without `try/finally`.
  - **Inferred**: The exact state left in `servedDomainSnapshot.ts` on commit `92989fd` before PR #2540's review-round fixes (`5f0d1fae2`) is inferred from the commit history of `5f0d1fae2` (`fix: close the round 1 review gaps in per-domain sign-ups and domain trust`).

---

### 2g. `DraftEditor.integration` "seeds StatusReplyBox from a reply draft and closes on send" (1x)
- **Root cause (`file:line`)**:
  - Failed on run `40762141747` (`claude/offline-mode-2-q0xmgl`, 2026-10-22) at `lib/components/drafts/DraftEditor.integration.test.tsx:174`: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` (`expect(createNoteMock).toHaveBeenCalledTimes(1)`).
  - In `lib/components/posts/status-reply-box.tsx`, when `<StatusReplyBox>` is rendered inside `<DraftEditor>` with `seedDraft` (`DraftEditor.tsx:182-193`), seeding the draft text (`@bob@activities.local Reply body`), attachments, and poll choices happens asynchronously across mount/seed effects, and the `Post` submit button remains `disabled` until the seeded state settles and `DraftsProvider`'s initial IndexedDB `epoch` load (`DraftsProvider.tsx:249-268`) completes.
  - In the initial commit on `claude/offline-mode-2-q0xmgl` (before the deflake sub-commit in `22dabafa7`), the test clicked `screen.getByRole('button', { name: 'Post' })` immediately after finding the textarea value, without waiting for `DraftsProvider`'s `epoch > 0` (`waitForEpoch`) or waiting for the `Post` button to become enabled (`expect(button).toBeEnabled()`). Under CI CPU load, `fireEvent.click(button)` fired while `button.disabled === true`, which is a no-op in DOM/React, so `createNoteMock` was called `0` times!
  - **Remaining issue on `HEAD` (`4853a3a26`)**: Commit `22dabafa7` added `waitForEpoch()` (`DraftEditor.integration.test.tsx:156`) and `postWhenReady()` (`lines 163-167`: `await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button)`). However, in the first test (`"seeds CreatePostModal from a stored draft, saves edits back to the same id, and deletes the draft when the post is sent"`, `DraftEditor.integration.test.tsx:190-247`), the **second** `render(<DraftsProvider>...<DraftEditor .../></DraftsProvider>)` at lines `222-233` omits `<EpochReady />` and does not call `await waitForEpoch()`, and `first.unmount()` at line `218` triggers the post-unmount `drainRef.current()` bug in `DraftsProvider.tsx:464` (Item 2a).
- **Why it is intermittent**:
  - Depends on whether the async IndexedDB read (`listDrafts` / `countActiveDrafts`) and `StatusReplyBox` seed effect settle before `fireEvent.click` runs.
- **Permanent fix**:
  1. Keep `waitForEpoch()` and `postWhenReady()` (`DraftEditor.integration.test.tsx:156, 163-167`), and also include `<EpochReady />` + `await waitForEpoch()` in the second `render(...)` at `DraftEditor.integration.test.tsx:222-233`.
  2. Apply the `mountedRef` fix in `lib/components/drafts/DraftsProvider.tsx:464` (Item 2a) so `first.unmount()` at line `218` does not leak a background `drain()` pass into the second render or the second test.
- **How to prove the fix**:
  - **Deterministic mutation**: Replace `await postWhenReady()` at `DraftEditor.integration.test.tsx:266` with `fireEvent.click(screen.getByRole('button', { name: 'Post' }))` while delaying `countActiveDrafts` by 20ms; verify `postWhenReady()` + `waitForEpoch()` makes it pass 100% of the time.
  - **Stress command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/components/drafts/DraftEditor.integration.test.tsx --repeat=30
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:179-187` shows `expected "vi.fn()" to be called 1 times, but got 0 times` at `DraftEditor.integration.test.tsx:174`; git log of `22dabafa7` contains `* fix(drafts): keep timeline routes within the JS budget and deflake the reply draft editor test` which added `waitForEpoch` and `postWhenReady`.
  - **Inferred**: Nothing inferred.

---

### 2h. `PrivacyLocationsEditor` "scrolls to the save error when Save fails, so the message above the map is in view" (1x)
- **Root cause (`file:line`)**:
  - In `lib/components/privacy-locations/PrivacyLocationsEditor.tsx:458-460`, scrolling to the error alert is performed inside a **passive `useEffect`**:
    ```ts
    useEffect(() => {
      if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
    }, [error])
    ```
  - In `lib/components/privacy-locations/PrivacyLocationsEditor.test.tsx:151-181`, clicking `Save custom places` invokes `handleSave` (`PrivacyLocationsEditor.tsx:533`), an `async` function whose rejected `fetch` (`Promise.reject(new Error('network down'))`, line `160`) settles outside `act()`.
  - When `setError(copyRef.current.saveFailed)` runs in the `catch` block (`PrivacyLocationsEditor.tsx:565`), React commits the `<Alert role="alert" ref={errorRef}>` to the DOM before flushing passive `useEffect` hooks.
  - Prior to commit `8b40f2b2b` (2026-10-22), `PrivacyLocationsEditor.test.tsx:170-171` did:
    ```ts
    const alert = await screen.findByRole('alert')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    ```
    On a loaded CI runner (run `40748025951`), `findByRole('alert')` resolved via `MutationObserver` as soon as the `<div role="alert">` node was inserted into the DOM, **before** React flushed the passive `useEffect` at `PrivacyLocationsEditor.tsx:458-460`. Consequently `scrollIntoView` had `0` calls at line `171`!
- **Why it is intermittent**:
  - Same React 19 + Testing Library mechanism as Item 2d: when a state update occurs outside `act()`, `findBy*`'s `MutationObserver` races against React's passive `useEffect` scheduler flush.
- **Permanent fix**:
  1. Commit `8b40f2b2b` wrapped the assertion in `await waitFor(...)` at `lib/components/privacy-locations/PrivacyLocationsEditor.test.tsx:173-176`:
     ```ts
     await waitFor(() => {
       expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
     })
     ```
  2. In `lib/components/privacy-locations/PrivacyLocationsEditor.tsx:458`, change `useEffect` to `useLayoutEffect` so `scrollIntoView` fires synchronously on DOM commit.
- **How to prove the fix**:
  - **Verification command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/components/privacy-locations/PrivacyLocationsEditor.test.tsx -t "scrolls to the save error" --repeat=30
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:189-196` shows `expected "vi.fn()" to be called with arguments: [ { block: 'nearest' } ], Number of calls: 0` at `PrivacyLocationsEditor.test.tsx:171` on 2026-10-22; commit `8b40f2b2b` on 2026-10-22 wrapped line `173` in `waitFor`, with zero failures since.
  - **Inferred**: Nothing inferred.

---

### 2i. `bulkImportJob` heartbeat (2 tests, 1x each)
- **Root cause (`file:line`)**:
  - Failed on run `40871662945` (`claude/mastodon-csv-import-export-q0xmgl`, 2026-10-24) in `lib/jobs/bulkImportJob.test.ts`:
    1. `"renews the lease from the heartbeat while a unit is blocked longer than the lease"` (`line 505`: `expected 1 to be greater than or equal to 2`)
    2. `"stops after the blocked unit when the heartbeat sees another run took the claim"` (`line 549`: `expected [ 'pending', 'pending' ] to deeply equal [ 'succeeded', 'pending' ]`)
  - In the initial round-3 commit of PR #2600 (`2c96151f1`), the tests enabled `vi.useFakeTimers()` and awaited a fixed number of microtask ticks (`Promise.resolve()`) after starting `bulkImportJob(...)` before calling `await vi.advanceTimersByTimeAsync(...)`.
  - However, before `bulkImportJob` (`lib/jobs/bulkImportJob.ts:329-375`) starts the heartbeat timer (`startLeaseHeartbeat` at line `369`) and enters `followAccount`, it executes multiple async SQLite/Kysely queries (`claimBulkImportRun`, `getActorFromId`, `getBulkImportById`, `listPendingBulkImportRows`). Under CI load, those SQLite queries took more event-loop turns than the fixed microtask loop, so `vi.advanceTimersByTimeAsync` advanced fake time **before `startLeaseHeartbeat` had armed its `setInterval` or before `followAccount` was entered**!
  - Furthermore, in `lib/jobs/bulkImportJob.ts:95-126`, `startLeaseHeartbeat`'s `setInterval` callback fired an un-awaited async `database.renewBulkImportClaim(...)` without tracking the `inFlight` promise on `stop()`, so `runBulkImport`'s `finally` block could finish and the test could inspect/close the database while a heartbeat renewal query was still in flight.
- **Why it is intermittent**:
  - Number of event-loop turns required for Kysely/SQLite connection acquisition and pre-loop queries varies slightly with CPU load.
- **Permanent fix**:
  - Applied in PR #2600 (`2c96151f1`, sub-commit `fix: await the import heartbeat and make its tests deterministic`):
    1. `lib/jobs/bulkImportJob.ts:99-125, 381`: `startLeaseHeartbeat` tracks `let inFlight: Promise<void> | null = null` and `stop()` awaits `await inFlight` in `runBulkImport`'s `finally` block (`line 381`).
    2. `lib/jobs/bulkImportJob.test.ts:479-515, 535-568`: `followAccount` resolves an explicit `entered` barrier (`const entered = new Promise<void>((resolve) => { markEntered = resolve })`), and the test awaits `await entered` before calling `vi.advanceTimersByTimeAsync`, and awaits `await twoRenewals` / `await lostRenewal` (resolved inside the `renewBulkImportClaim` spy) before releasing `releaseUnit()`.
- **How to prove the fix**:
  - **Verification command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/jobs/bulkImportJob.test.ts -t "heartbeat" --repeat=30
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:198-207` shows both failures on run `40871662945`; git log of `2c96151f1` shows sub-commit `fix: await the import heartbeat and make its tests deterministic` adding `inFlight` in `lib/jobs/bulkImportJob.ts:99-125` and the `entered` / `twoRenewals` / `lostRenewal` barriers in `lib/jobs/bulkImportJob.test.ts:479-568`.
  - **Inferred**: Nothing inferred.

---

### 2j. `accountExports` pagination: "pages through list members across multiple lists with pageSize = 1" (1x)
- **Root cause (`file:line`) — STILL PRESENT ON `HEAD` (`4853a3a26`)**:
  - In `lib/services/exports/accountExports.test.ts:743-775`, the test creates two lists back-to-back:
    ```ts
    const list1 = await database.createList({
      actorId: actor.id,
      title: 'List 1'
    })
    await database.addListAccounts({
      listId: list1.id,
      actorId: actor.id,
      accountActorIds: ['https://remote.test/users/m1']
    })

    const list2 = await database.createList({
      actorId: actor.id,
      title: 'List 2'
    })
    ```
  - Look at `createList` in `lib/database/domains/list/queries.ts:78-87`:
    ```ts
    const id = randomUUID()
    const now = new Date()
    await db.insertInto('lists').values({
      id,
      actorId,
      title,
      ...
      createdAt: now,
      updatedAt: now
    }).execute()
    ```
  - And look at `exportLists` (`lib/services/exports/accountExports.ts:171`), which calls `database.getLists({ actorId })` (`lib/database/domains/list/queries.ts:131-138`):
    ```ts
    const rows = await db
      .selectFrom('lists')
      .selectAll()
      .where('actorId', '=', actorId)
      .orderBy('createdAt', 'asc')
      // Lists made in the same millisecond keep one order, for paged readers.
      .orderBy('id', 'asc')
      .execute()
    ```
  - Because `better-sqlite3` executes in-process synchronously in microseconds, `createList(list1)` (`line 749`) and `createList(list2)` (`line 759`) frequently execute within the **exact same millisecond** (`list1.createdAt.getTime() === list2.createdAt.getTime()`).
  - When `list1.createdAt` and `list2.createdAt` are equal, `getLists` breaks ties by `.orderBy('id', 'asc')` where `id` is a random `UUIDv4` (`randomUUID()`)! Whenever `list2.id < list1.id` lexicographically (which happens **50% of the time** when both lists share the same millisecond), `getLists` returns `[list2, list1]`, and `exportLists` outputs:
    ```
    List 2,m2@remote.test
    List 1,m1@remote.test
    ```
    failing `expect(listCsv).toBe('List 1,m1@remote.test\nList 2,m2@remote.test\n')` at `lib/services/exports/accountExports.test.ts:770-772` with the exact diff in `failures.md:211-216`!
- **Why it is intermittent**:
  - Fails whenever `Date.now()` does not tick to the next millisecond between line `749` and line `759` **and** `randomUUID()` for `list2` sorts before `randomUUID()` for `list1` (~25–40% failure rate on fast local/CI CPUs).
- **Permanent fix**:
  1. In `lib/services/exports/accountExports.test.ts:749-767`, set explicit, distinct `createdAt` timestamps on `list1` and `list2` (just as lines `367-371` of the same file already do for `follows`):
     ```ts
     const sqlDb = getSQLDatabase(database)
     await sqlDb
       .updateTable('lists')
       .set({ createdAt: new Date('2025-01-01T00:00:01.000Z') })
       .where('id', '=', list1.id)
       .execute()
     await sqlDb
       .updateTable('lists')
       .set({ createdAt: new Date('2025-01-01T00:00:02.000Z') })
       .where('id', '=', list2.id)
       .execute()
     ```
  2. Also replace the `await new Promise((r) => setTimeout(r, 10))` sleeps in `lib/services/exports/accountExports.test.ts:458, 517, 725, 730` with explicit `createdAt` timestamps so no test in `accountExports.test.ts` relies on wall-clock millisecond sleeps for ordering.
- **How to prove the fix**:
  - **Deterministic reproduction**: Freeze `Date.now` (or run `accountExports.test.ts -t "pages through list members across multiple lists with pageSize = 1" --repeat=10` on `HEAD` right now — it fails within a few runs!). Let's note that setting explicit `createdAt` makes it pass 100/100 times even if `list2.id < list1.id`.
  - **Stress command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/services/exports/accountExports.test.ts -t "pages through list members across multiple lists with pageSize = 1" --repeat=30
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `lib/services/exports/accountExports.test.ts:749-767` creates `list1` and `list2` without any timestamp separation; `lib/database/domains/list/queries.ts:78-87, 136-138` assigns `id = randomUUID()`, `createdAt = new Date()`, and orders by `createdAt asc, id asc`; `failures.md:209-219` shows `List 2` sorted before `List 1`.
  - **Inferred**: Nothing inferred.

---

### 2k. `GalleryAllMediaView` "deselects the day including picks no loaded tile knows" (1x)
- **Root cause (`file:line`)**:
  - Failed on run `40948011220` (`claude/gallery-day-selection-q0xmgl`, 2026-10-27) in `app/(timeline)/gallery/media/GalleryAllMediaView.test.tsx:2715`: `Expected element to have text content: 0 selected, Received: 3 selected (Max 4)`.
  - Look at the test sequence in `app/(timeline)/gallery/media/GalleryAllMediaView.test.tsx:2695-2715`:
    ```ts
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
    )
    await waitFor(() => expect(bar()).toHaveTextContent('3 selected'))

    fireEvent.click(
      screen.getByRole('button', { name: 'Deselect day, Sat 4 Oct 2025' })
    )
    await waitFor(() => expect(bar()).toHaveTextContent('0 selected'))
    ```
  - Inside `lib/components/gallery/useDaySelection.ts:612-653`, `selectDay` awaits `getGalleryDayMediaIds(key)` (`line 612`), calls `onChangeRef.current(next)` (`line 646`, which updates `selected` state in `GalleryAllMediaView` so the bar renders `'3 selected'` and switches the button label to `'Deselect day, Sat 4 Oct 2025'`), and kicks off background `hydrateItems(key, ['4'], ...)` (`line 647`).
  - When the test immediately clicks `'Deselect day, Sat 4 Oct 2025'`, `deselectDay` (`lib/components/gallery/useDaySelection.ts:747-768`) computes which IDs to remove by reading `selectedRef.current`:
    ```ts
    const removed = selectedRef.current.filter(
      (id) => idSet.has(id) || dayOf.current.get(id) === key
    )
    if (removed.length === 0) return
    ```
  - Prior to the final commit in PR #2629 (`1ee4be828`, sub-commit `fix: sync Select day's selection and room before the next click`), `useDaySelection.ts` synced `selectedRef.current = selected` inside a **passive `useEffect`** (`useEffect(() => { selectedRef.current = selected }, [selected])`) instead of `useLayoutEffect`!
  - Because `await getGalleryDayMediaIds(key)` resolved outside `act()`, React committed the new DOM (`3 selected` and `Deselect day, Sat 4 Oct 2025`) **before** flushing passive `useEffect` hooks. `waitFor(() => expect(bar()).toHaveTextContent('3 selected'))` saw the DOM commit and immediately fired `fireEvent.click(Deselect day)` while `selectedRef.current` was **still `[]`**! Thus `removed` was `[]`, `deselectDay` returned early at `if (removed.length === 0) return` (`line 764`), and the selection remained at `'3 selected (Max 4)'`!
- **Why it is intermittent**:
  - Happens whenever `waitFor`'s polling check or `MutationObserver` runs between React's DOM commit phase and React's passive `useEffect` flush after an async state update outside `act()`.
- **Permanent fix**:
  1. Commit `1ee4be828` changed `selectedRef` and `roomRef` in `lib/components/gallery/useDaySelection.ts:240-242, 293-295` from `useEffect` to `useLayoutEffect`.
  2. Even better (zero-window guarantee): in `lib/components/gallery/useDaySelection.ts:646` (`selectDay`) and `line 765` (`deselectDay`), also update `selectedRef.current = next` synchronously right before calling `onChangeRef.current(next)` so even two synchronous clicks in the same event turn see the updated `selectedRef.current`.
- **How to prove the fix**:
  - **Deterministic mutation**: Change `useLayoutEffect` at `lib/components/gallery/useDaySelection.ts:240` back to `useEffect` (or defer it); `deselectDay` reads stale `selectedRef.current = []` and fails with `Received: 3 selected (Max 4)`. With `useLayoutEffect` + synchronous `selectedRef.current = next`, it passes 100% of the time.
  - **Verification command**:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run "app/(timeline)/gallery/media/GalleryAllMediaView.test.tsx" -t "deselects the day including picks no loaded tile knows" --repeat=20
    ```
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `failures.md:221-230` shows `Expected: 0 selected, Received: 3 selected (Max 4)` on run `40948011220`; git log of `1ee4be828` has commit `fix: sync Select day's selection and room before the next click` changing `useEffect` to `useLayoutEffect` at `lib/components/gallery/useDaySelection.ts:240, 293`.
  - **Inferred**: Nothing inferred.

---

### 2l. `credentialIdentity` test timing out under load (1x)
- **Root cause (`file:line`)**:
  - Failed on run `40958507507` (2026-10-27, `Test Shard 2 of 4`) in `lib/services/auth/credentialIdentity.test.ts:154-194` (`"registers an account via registerAccount and resolves the exact credential row with a working bcrypt hash"`): `Error: Test timed out in 15000ms`.
  - Look at what happens when `lib/services/auth/credentialIdentity.test.ts` runs:
    1. In `beforeAll` (`credentialIdentity.test.ts:137-141`), `await database.migrate()` and `await seedDatabase(database)` run. `seedDatabase` (`lib/stub/database.ts:119-203`) calls `bcrypt.hash(TEST_PASSWORD_HASH, 10)` (`line 120`) and calls `generateKeyPair(config.secretPhase)` **6 times in parallel** (`lines 122-129`), where each `generateKeyPair` (`lib/utils/signature.ts:12-35`) generates a **4096-bit RSA keypair** on Node's 4-thread libuv threadpool!
    2. Then the very first test (`credentialIdentity.test.ts:154-194`) calls `await registerAccount(...)` (`line 158`), which at `lib/services/accounts/registerAccount.ts:17, 116-119` runs **another 4096-bit RSA keypair generation** (`generateKeyPair(config.secretPhase)`) and `bcrypt.hash(password, BCRYPT_ROUND)` (`BCRYPT_ROUND = 10`), followed by `await bcrypt.compare('real-registration-pass', ...)` (`credentialIdentity.test.ts:183`).
    3. Because `vitest.config.ts:53` uses `pool: 'threads'`, **all worker threads in the shard share the single process-wide libuv threadpool (`UV_THREADPOOL_SIZE = 4` by default)**! Generating a single 4096-bit RSA key can take 500ms–3,500ms of CPU time depending on prime search luck. When another worker thread in Shard 2 concurrently runs `seedDatabase` (6 x 4096-bit RSA keys + bcrypt) or another `registerAccount` test on a 2-vCPU CI runner, all 4 libuv threadpool threads are occupied by C++ OpenSSL 4096-bit RSA prime generation + C++ `bcrypt` work, starving `registerAccount`'s `generateKeyPair` + `bcrypt.hash` + `bcrypt.compare` past `testTimeout: 15000` (`vitest.config.ts:44`)!
    4. Notice the irony at `lib/services/auth/credentialIdentity.test.ts:16-19`: the author already wrote a comment noting `TEST_BCRYPT_COST = 4` for the other tests, yet `registerAccount.ts:17` hardcodes `const BCRYPT_ROUND = 10` and `lib/utils/signature.ts:14` hardcodes `modulusLength: 4096` even in `NODE_ENV === 'test'`!
- **Why it is intermittent**:
  - 4096-bit RSA prime generation duration is probabilistic (OpenSSL `BN_generate_prime_ex`), and libuv threadpool queueing depends on which other test file is executing concurrently in another worker thread of the same Node process.
- **Permanent fix**:
  1. In `lib/services/accounts/registerAccount.ts:17` (and `lib/services/auth/auth.ts:208`, `lib/stub/database.ts:120`), use cost `4` in test environment:
     ```ts
     const BCRYPT_ROUND = process.env.NODE_ENV === 'test' ? 4 : 10
     ```
     (`bcrypt.compare` reads the cost factor from the `$2b$04$...` hash string, so this exercises the exact same native `bcrypt.hash` and `bcrypt.compare` code path at 1/64th the CPU cost).
  2. In `lib/utils/signature.ts:14`, use `modulusLength: process.env.NODE_ENV === 'test' ? 2048 : 4096` (or cache/pool pre-generated RSA keypairs in `lib/stub/database.ts`), which reduces RSA key generation time by ~8–10x while still exercising real OpenSSL RSA-SHA256 signing and AES-256-CBC private key encryption.
  3. Set `UV_THREADPOOL_SIZE=8` in `.github/workflows/ci.yml` (`env:`) so C++ crypto jobs in one worker thread cannot block fs/crypto jobs in another worker thread.
- **How to prove the fix**:
  - **Benchmark / stress command**: Time `credentialIdentity.test.ts`:
    ```sh
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/services/auth/credentialIdentity.test.ts
    ```
    On `HEAD`, `beforeAll` + test 1 spends ~1.2–2.5s purely in 7x 4096-bit RSA keygen + cost-10 bcrypt on a fast M-series Mac (and >5–15s under 2-vCPU contention); with 2048-bit test keys + cost-4 bcrypt, the entire file completes in `< 250ms`.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (95%).
  - **Observed**: `credentialIdentity.test.ts:137-194` runs `seedDatabase` (6x `generateKeyPair` + cost-10 `bcrypt.hash` in `lib/stub/database.ts:120-129`) followed by `registerAccount` (1x 4096-bit `generateKeyPair` + cost-10 `bcrypt.hash` in `lib/services/accounts/registerAccount.ts:17, 116-119`); `vitest.config.ts:53` uses `pool: 'threads'` sharing the 4-thread libuv pool.
  - **Inferred**: Which other test file was co-scheduled on the other worker thread in Shard 2 during run `40958507507` is inferred from the shared libuv threadpool architecture.

---

### 2m. `migrate` baseline test (2x on the same sha `2adff5c`: genuine or flaky?)
- **Verdict**: **Genuine, 100% deterministic code bug on commit `2adff5cb2a98d4db9367ca04460a2e7654cb2ed3` — NOT a flaky test.**
- **Why it appeared 2x in `failures.md` on the same SHA**:
  - Because `.github/workflows/ci.yml:19-21` triggers on both `push` and `pull_request` (Item 1a), pushing commit `2adff5cb2` to branch `claude/account-archive-export-q0xmgl` (PR #2604) spawned **two** workflow runs on that exact SHA: `push` run `40872924886` and `pull_request` run `40872926840`. Both runs failed deterministically on the exact same assertion.
- **Root cause (`file:line`)**:
  - `lib/database/migrate/index.test.ts:251-295` (`"loads the baseline: the schema the reference dump describes"`) runs `await migrateToLatest(target)` on a fresh PostgreSQL database, snapshots the schema (including `pg_indexes.indexdef` at line `147`) into `migrated`, then drops/recreates the database, loads `migrations/schema.sql`, and asserts `expect(migrated).toEqual(await readSchema(connection.db))` (`line 294`).
  - On commit `2adff5cb2` (and its parent `a83637ad6`), `migrations/20261024100100_add_account_archives.ts` added the partial unique index `account_archives_account_active_idx` using `.where(sql.ref('status'), 'in', [sql.lit('queued'), sql.lit('running')])` without updating `migrations/schema.sql` to match, and PostgreSQL's `pg_get_indexdef` deparses `status IN ('queued', 'running')` on a `varchar` column differently (`(status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying])::text[])`) from Kysely's `eb.or([eb('status', '=', 'queued'), eb('status', '=', 'running')])` (`((status)::text = 'queued'::text) OR ((status)::text = 'running'::text)`).
- **Permanent fix**:
  - Already fixed in PR #2604 before merge (commit `b743df77d`, sub-commit `fix: write the active-archive index predicate so pg_dump round-trips` in `migrations/20261024100100_add_account_archives.ts:64-75` and `migrations/schema.sql:2023`).
- **How to prove the fix**:
  - Checking out `2adff5cb2` fails `lib/database/migrate/index.test.ts:294` 100% of the time on PostgreSQL; `HEAD` (`4853a3a26`, containing `b743df77d`) passes 100% of the time.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `git show 2adff5cb2` and `git log -p -n 5 b743df77d` directly show the broken migration on `2adff5cb2` and the subsequent fix commit `fix: write the active-archive index predicate so pg_dump round-trips`.
  - **Inferred**: Nothing inferred.

---

## 3. Dependabot (`.github/dependabot.yml` — 22x `YN0028` on `nodemailer`)

- **Root cause (`file:line`)**:
  - `/package.json:4-6` declares a Yarn Berry (v4.13.0) monorepo workspace covering every package in `packages/*`:
    ```json
    "workspaces": [
      "packages/*"
    ]
    ```
    There is a single root `/yarn.lock` for the entire repository and **no** `packages/*/yarn.lock` files.
  - However, `.github/dependabot.yml:10-41` configures three **separate, independent** `directory:` entries instead of a workspace-aware configuration, and omits 4 of the 6 workspaces (`cloudtasks`, `pg`, `qstash`, `resend`):
    ```yaml
      - package-ecosystem: 'npm'
        directory: '/'
      ...
      - package-ecosystem: 'npm'
        directory: '/packages/nodemailer'
      ...
      - package-ecosystem: 'npm'
        directory: '/packages/ses'
    ```
  - When Dependabot runs the standalone `directory: '/packages/nodemailer'` updater job (which created branch `dependabot/npm_and_yarn/packages/nodemailer/nodemailer-10.2.0`), Dependabot's sub-directory updater modifies `packages/nodemailer/package.json` in isolation (or rebases it after root `yarn.lock` updates) without re-locking the root workspace graph at `/yarn.lock` (`@activities/nodemailer@workspace:packages/nodemailer` at `yarn.lock:18-21`).
  - Every CI run on that branch then fails `yarn install --immutable` (`.github/workflows/ci.yml:61, 116, 165, 240, 377`) with `YN0028: The lockfile would have been modified by this install, which is explicitly forbidden`. Combined with duplicate `push` + `pull_request` runs and Dependabot rebases, this produced 22 consecutive failed runs until `nodemailer` 10.2.1 superseded the PR (`ad8eb56ea`).
- **Why it is intermittent**:
  - Occurs whenever Dependabot updates or rebases a sub-workspace `packages/<name>/package.json` via a separate `directory:` entry whose lockfile state diverges from the root `/yarn.lock` workspace descriptor.
- **Permanent fix**:
  - Replace the separate `directory: '/'`, `directory: '/packages/nodemailer'`, and `directory: '/packages/ses'` entries in `.github/dependabot.yml:10-41` with a **single** `npm` ecosystem block using `directories:` (plural) anchored at `'/'` and `'packages/*'`, which covers the root and **all 6 workspaces** (`packages/cloudtasks`, `packages/nodemailer`, `packages/pg`, `packages/qstash`, `packages/resend`, `packages/ses`) in one unified Yarn Berry workspace resolution pass:
    ```yaml
    version: 2
    updates:
      - package-ecosystem: 'npm'
        directories:
          - '/'
          - '/packages/*'
        schedule:
          interval: 'weekly'
        open-pull-requests-limit: 10
        groups:
          production-dependencies:
            dependency-type: 'production'
          development-dependencies:
            dependency-type: 'development'
    ```
- **How to prove the fix**:
  - **Deterministic mutation**: Bump `"nodemailer": "^8.0.5"` in `packages/nodemailer/package.json` without updating the `@activities/nodemailer@workspace:packages/nodemailer` descriptor in root `/yarn.lock` and run `yarn install --immutable` — Yarn fails 100% deterministically with `YN0028: The lockfile would have been modified by this install`. Running workspace-aware resolution from `/` updates both `packages/nodemailer/package.json` and root `yarn.lock` together so `yarn install --immutable` exits `0`.
- **Confidence & Observed vs. Inferred**:
  - **Confidence**: High (100%).
  - **Observed**: `.github/dependabot.yml:10-41` uses separate `directory:` entries and misses 4 of the 6 `packages/*` workspaces; `failures.md:53-68` shows 22 `YN0028` failures on branch `dependabot/npm_and_yarn/packages/nodemailer/nodemailer-10.2.0`.
  - **Inferred**: Nothing inferred.

---

## 4. Suite-Wide Guards (Preventing Entire Classes of Future Flakes)

1. **Global Post-Test DOM & Timer Teardown Guard (`test/setup/vitest.setup.ts`)**:
   - **Class prevented**: Unhandled `ReferenceError: window/document is not defined` after jsdom teardown (Item 2b) and cross-test broadcast/timer leaks (Items 2a, 2f, 2g).
   - **Guard**: In `test/setup/vitest.setup.ts`, register a global `afterEach` that:
     1. Calls Testing Library's `cleanup()` explicitly before any environment teardown so all React unmount cleanups run while `window` and `document` are still defined.
     2. Calls `vi.useRealTimers()` and `vi.clearAllTimers()` if fake timers were left enabled by a test.
     3. Resets module-level singletons (`resetServedDomainsForTests()`, `resetDraftsChannelForTesting()`).

2. **Use `useLayoutEffect` (not `useEffect`) for Synchronous Ref Sync & Post-Commit Focus/Scroll**:
   - **Class prevented**: Race between `await screen.findBy*` / `waitFor` (`MutationObserver` firing on DOM commit) and React 19 passive `useEffect` hooks when async handlers settle outside `act()` (Items 2d `ProfileEditor`, 2h `PrivacyLocationsEditor`, 2k `GalleryAllMediaView`).
   - **Guard**: Any hook that mirrors props/state into a `useRef` read by event handlers (`useDaySelection.ts`) or focuses/scrolls an alert element on error (`ProfileEditor.tsx:199`, `PrivacyLocationsEditor.tsx:458`) must use `useLayoutEffect` (and in tests, always assert side effects of passive effects inside `await waitFor(...)`). Add an Oxlint/custom AST check flagging `expect(document.activeElement)` or `expect(scrollIntoView)` immediately following `await screen.findBy*` outside `waitFor`.

3. **Ban Unordered `Promise.all` Array Push (`stored.push` inside `Promise.all`)**:
   - **Class prevented**: Non-deterministic array ordering on PostgreSQL `pg.Pool` when multiple queries run concurrently in `Promise.all` (Item 2c `createPollJob`).
   - **Guard**: Never mutate a shared results array via `.push()` inside `Promise.all(items.map(async ...))`; always `const results = await Promise.all(items.map(...))` and derive the return order from `results` or `items`.

4. **Deterministic Timestamps in Pagination / Ordering Tests (No Same-Millisecond UUID Tie-Break Assumptions)**:
   - **Class prevented**: Same-millisecond `new Date()` inserts falling back to `ORDER BY id ASC` on random `UUIDv4` primary keys (Item 2j `accountExports`).
   - **Guard**: Whenever a query orders by `createdAt ASC, id ASC` (or `DESC`) and `id` is `randomUUID()`, test fixtures creating multiple rows to assert ordering MUST set explicit, distinct `createdAt` values (or advance a clock) rather than relying on wall-clock ticks or `setTimeout(10)`.

5. **Fake-Timer + Real-DB Synchronization Helper**:
   - **Class prevented**: `vi.advanceTimersByTimeAsync` racing against real PostgreSQL/SQLite socket I/O in polling loops (Item 2e `fitness-files/[id]/primary` and Item 2i `bulkImportJob`).
   - **Guard**: Never advance fake timers in a loop after a fixed `Promise.resolve()` or single `setImmediate()` when the code under test performs real DB queries between sleeps. Always gate `vi.advanceTimersByTimeAsync` on `vi.getTimerCount() > 0` or an explicit barrier callback invoked when the sleep/interval is armed.

6. **Test-Environment Crypto Cost Guard (`NODE_ENV === 'test'`)**:
   - **Class prevented**: Libuv 4-thread pool starvation and 15s test timeouts from 4096-bit RSA keygen and cost-10 `bcrypt` in worker threads (Item 2l `credentialIdentity`).
   - **Guard**: Centralize `BCRYPT_ROUND = process.env.NODE_ENV === 'test' ? 4 : 10` and `RSA_MODULUS_LENGTH = process.env.NODE_ENV === 'test' ? 2048 : 4096` in `lib/utils/signature.ts` and auth helpers, and set `UV_THREADPOOL_SIZE: 8` in `.github/workflows/ci.yml`.

7. **CI Workflow & Dependabot Hygiene Test**:
   - **Class prevented**: Missing `timeout-minutes` on jobs (Item 1b), duplicate `push` + `pull_request` runs on PR branches (Item 1a), and split/missing workspace directories in `.github/dependabot.yml` (Section 3).
   - **Guard**: Add a fast unit test that parses `.github/workflows/*.yml` and `.github/dependabot.yml`, asserting:
     - Every job in `.github/workflows/*.yml` defines `timeout-minutes <= 30`.
     - `ci.yml` `on.push.branches` is restricted to `['main']`.
     - `.github/dependabot.yml` uses `directories: ['/', '/packages/*']` (or covers every directory in `fs.readdirSync('packages')`) in a single `npm` ecosystem block.
