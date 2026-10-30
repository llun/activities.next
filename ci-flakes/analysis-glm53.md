# CI flake root-cause analysis — llun/activities.next (GLM-4.7 view)

Scope: two weeks of CI failures (2026-10-16 → 2026-10-30), repo at main 4853a3a26.
Method: read `ci-flakes/failures.md` in full, read `.github/workflows/ci.yml`, `.github/dependabot.yml`, `AGENTS.md`, and the source + test of every flaky item. No test executions were run in this session (time budget); every "how to prove" below is a concrete command or mutation to run afterwards. Observed vs inferred is separated per item; confidence stated per item.

---

## 1. CI infrastructure

### 1.1 PR #2688 run 41071657730 — "PostgreSQL Tests (shard 1/2)" queued → abandoned

**Observed** (from failures.md, PR #2688 section): job id 124117186439 stayed `queued`, `runner_name: none`, never completed; logs 404. `All Tests` (ci.yml `test` job) then printed `A required CI job did not succeed (got: abandoned)` and failed, as did `CI Success`. The `pull_request` run 41071823326 on the same SHA was fully green.

**Root cause**: GitHub-hosted runner allocation failure. The job never started (no runner was ever assigned), so no code ran. The failure is then *manufactured by the workflow's fail-closed aggregate*: `.github/workflows/ci.yml` `test` job loops over `needs.test-shards.result` + `needs.test-pg.result` and fails on any result `!= "success"` — including `abandoned`, a result that can only mean "the runner never ran the code".

**Why intermittent**: runner-pool starvation on GitHub's side. Amplifiers in this repo (observed in ci.yml):
- `on: push` (all branches) **and** `on: pull_request` — every PR commit launches the full 10-job workflow twice concurrently (the two events have different refs — `heads/branch` vs the merge ref — so the `concurrency` group `github.workflow-${{ github.ref }}` does not dedupe them; failures.md shows ~1,339 runs/2 weeks, 237 cancelled).
- No job sets `timeout-minutes`, so a hung job (e.g. the 10-17 docker readiness timeout) holds a runner for up to the 360-min default, worsening pool pressure.

**Permanent fix** (keeps `All Tests` required; never retries a code failure):
1. `on: push: branches: [main]` + `on: pull_request:` — PR branches run exactly once (merge ref), main keeps its post-merge push run. Halves runner demand and eliminates the "push red / pull_request green on the same SHA" divergence that produced this red head commit.
2. Add `timeout-minutes` to every job (e.g. lint/typecheck 30, build 45, test shards 90, pg shards 90, docker 60, aggregates 5) so hung jobs release runners fast.
3. Keep the aggregate fail-closed. For `abandoned` specifically (a job that provably executed zero steps), an auto-retry is safe by definition: add a small `if: always()` step in `All Tests` that detects `abandoned` upstream results and re-dispatches only those jobs (or just document "re-run failed jobs" for humans). A code `failure` result must never be re-dispatched — the loop must key on the result value, not on "the run is red".

**How to prove**: after the trigger change, `gh api repos/.../actions/runs --paginate -f event=pull_request` + `event=push` should show ~1 run per PR commit instead of 2; runner-starvation abandons should drop ~2x. Deterministic mutation for the aggregate: temporarily set one shard's `if:` to `false()` (result `skipped`) — `All Tests` must still fail, proving fail-closed behavior is preserved.

**Confidence**: cause of this run: high (the job never started — that is only ever infra). Fix effectiveness: medium-high (halving demand reduces but cannot eliminate GitHub pool incidents).

### 1.2 4x shard exit 129 (SIGHUP)

**Observed**: all four on 2026-10-16 (runs 38840511676, 38871319949 ×2, 38887834104), `Run test shard` step, "Job process exited 129 (SIGHUP) after last step output; no error line". None since 10-16.

**Root cause (inferred)**: 129 = 128 + SIGHUP. The runner sent SIGHUP to the job's process group after the last output — the signature of a GitHub runner/session teardown (known platform-side incidents kill the step process this way), not of the test code (a test crash produces a Vitest summary and a non-zero Vitest exit, both absent here). All four in one day, then never again, matches a platform incident window (the same window as the "ubuntu-latest will migrate to Ubuntu 26 on October 19" annotation churn).

**Why intermittent**: external; nothing in the repo schedule correlates (different branches, different SHAs, all four shards' code passed on sibling runs).

**Permanent fix**: none possible in-repo for the SIGHUP itself. Mitigations: `timeout-minutes` (bounds damage), and treat "exit 129 with no test summary" as infra in triage (re-run is safe: no test verdict was produced). A guard that helps distinguish: make the shard step write a sentinel file on success (`touch /tmp/shard-ok`) and add a final step that fails with a distinct message if the sentinel is missing — turns "mystery 129" into a diagnosable class.

**How to prove**: nothing to reproduce locally; the sentinel-step change makes the next occurrence self-classifying.

**Confidence**: medium-high on "platform-side, not repo code" (the no-summary + single-day clustering is strong); low on the precise platform mechanism.

### 1.3 1x YN0001 ECANCELED during `yarn install`

**Observed**: run 39819301293, `Install dependencies`, "YN0001 write ECANCELED (SSL destruction) during resolution".

**Root cause (inferred)**: transient network failure between the runner and the npm registry mid-resolution; the TLS stream was destroyed, Yarn propagated ECANCELED. One occurrence in ~1,339 runs.

**Why intermittent**: external network blip; the same install step passes in every other run.

**Permanent fix**: make the install step idempotently retryable — retrying an install is not "retrying a code failure" (the lockfile is frozen; `--immutable` either installs or doesn't):
```yaml
- name: Install dependencies
  run: yarn install --immutable || (sleep 20 && yarn install --immutable)
```
Optionally set `npmRegistryServer`/`networkConcurrency` tuning in `.yarnrc.yml` if it recurs.

**How to prove**: stress with a flaky proxy in a fork (drop 1 in 50 TLS connections) — the retry step turns the run green where the current one fails.

**Confidence**: high that it is a transient network error (the YN0001/ECANCELED text is unambiguous); high that a retry is safe under `--immutable`.

### 1.4 1x "unable to resolve action `actions/cache@v6`"

**Observed**: run 41057961159, `Set up job`, "Workflow file error: unable to resolve action actions/cache@v6 (set-up job; no steps ran)". The same `uses: actions/cache@v6` line (ci.yml `build` job, "Cache Next.js build" step) resolves fine in every other run.

**Root cause (inferred)**: transient failure resolving the action ref from the marketplace/GitHub's action store at job-setup time (the tag exists; the workflow is unchanged between the failing and passing runs).

**Why intermittent**: external resolution blip; one occurrence.

**Permanent fix**: pin the action to an immutable commit SHA (`uses: actions/cache@<full-sha> # v6`) — resolution of a SHA does not depend on ref listing. Dependabot's `github-actions` ecosystem (dependabot.yml) keeps bumping the comment-pinned SHA, so it stays current.

**How to prove**: after pinning, grep CI logs for "unable to resolve" over the next two weeks (expect zero); the mutation proof is not available locally since the failure is in GitHub's resolver.

**Confidence**: medium-high (transient resolution is the only explanation consistent with the same workflow passing before and after).

### 1.5 Suite-wide CI-infra guards

- `timeout-minutes` on every job (today: none — a hung job burns a runner for 6 h).
- `push` restricted to `main` (today: all branches, doubling every PR).
- Aggregate jobs stay fail-closed on `failure`/`cancelled`/`skipped`; only `abandoned` (zero steps executed) may be auto-retried, keyed on the result string.
- Pin `actions/*` to SHAs.
- Retry wrapper on `yarn install --immutable` only.

---

## 2. Flaky tests

Common context (observed): shards run ~690 files / 4 with `NODE_OPTIONS=--max-old-space-size=8192` on 2-core-ish shared runners; the pg shards run 414 files with `--maxWorkers=2` against a containerized PostgreSQL. The dominant flake mechanism across the suite is **Vitest/testing-library default timeouts (1 s `waitFor`/`findBy*`, 5 s test timeout) racing chains that include cold dynamic `import()`, fake-indexeddb roundtrips, or real DB roundtrips under load**. Several files already carry local acknowledgements of exactly this (e.g. SignOutDialog.test.tsx:335-338 "can outlast the default 1s on a loaded machine", DraftEditor.integration.test.tsx "polling … beats a fixed sleep under load").

### 2.1 SignOutDialog "signs out with zero drafts" (8x) — highest confidence item

**Observed**: `lib/components/sign-out/SignOutDialog.test.tsx:307-322`. The test clicks Sign out then:
```ts
await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))   // default 1000 ms
expect(events).toEqual(['signing-out', 'signOut'])
expect(clearAllOfflineData).toHaveBeenCalledTimes(1)
```
The chain it waits on (`lib/components/sign-out/useSignOut.ts:26-70`): broadcast → `clearAllOfflineData()` → mocked `authClient.signOut` → `onSuccess` → `markPurgePending` → **cold dynamic `import('@/lib/client/drafts')`** → `purgeAccountDrafts()` (fake-indexeddb open + writes) → `window.location.href = '/auth/signin'` (stubbed `assign`).

**Root cause (inferred, high confidence)**: the `waitFor` at test line 321 uses the default 1 s timeout while the redirect is the *tail* of a chain whose dominant cost is the first-time dynamic import of the drafts module plus IndexedDB work. The file itself documents this exact load class and raised the count lookups to `COUNT_TIMEOUT_MS = 5000` (lines 78, 335-338, 352-355) — but not this `waitFor`.

**Why intermittent**: only fails when the worker is cold/loaded enough that import + IDB exceeds 1 s; 8 hits across unrelated branches and SHAs, always shard 2 (the file's shard), including on dependabot branches that touch nothing relevant — the load-dependence signature.

**Permanent fix**: pass `{ timeout: COUNT_TIMEOUT_MS }` to that `waitFor` (and to the sibling sign-out tests' `waitFor`s that still default). Better: assert on a deterministic completion signal (e.g. await `getAccountEpoch`/purge-marker) rather than wall-clock polling.

**How to prove**: (a) stress: `NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" yarn vitest run lib/components/sign-out/SignOutDialog.test.tsx --repeat=25` while the machine is loaded (`stress`-class CPU contention); expect intermittent failures today, zero after the timeout fix. (b) Deterministic mutation: add `await new Promise(r => setTimeout(r, 1500))` inside the mocked `onSuccess` before `assign` — the current test fails 100%, the fixed one passes.

**Confidence**: high on mechanism (default-1s `waitFor` vs cold-import chain); the exact failing assertion is inferred (failure logs only name the test).

### 2.2 Unhandled "window/document is not defined" after jsdom teardown (5x)

**Observed**: `lib/components/drafts/DraftsProvider.tsx:356-360` schedules a real `setTimeout` whose callback runs `drainRef.current()` (the send-queue drain); `lib/components/section-nav-dropdown.tsx:157-160` schedules a 300 ms `setTimeout(() => { reveal(); stop() }, 300)`. Both files' guards check DOM liveness (`menuEl.isConnected`, wake tokens), not environment liveness. Signature in failures.md: unhandled `ReferenceError: window/document is not defined` after jsdom teardown attributed to these two files' timers.

**Root cause (inferred, medium-high confidence)**: a timer or an in-flight async continuation (the drain's promise chain, or the reveal callback) outlives the test file's jsdom environment. Vitest tears down the per-file jsdom globals after the last test; when the callback then executes, `window`/`document` are gone and the callback (or jsdom internals it touches) throws an unhandled `ReferenceError`, which Vitest reports as an unhandled error and fails the shard. The components' own cleanup (`clearWake` on unmount, `stop()` on steering events) clears *pending* timers, but cannot stop a callback that already started or an async chain mid-flight when the file ends.

**Why intermittent**: it requires a queued draft (drain scheduled) or an open section menu (300 ms reveal pending) at the exact moment the file finishes — i.e. the last test in a worker must have left the queue mid-drain. Under load, drains take longer, so the straddle probability rises; 5 hits across main, docs and version-bump branches with unrelated diffs.

**Permanent fix** (two layers):
1. Test-level (deterministic): in `test/setup/vitest.setup.ts` add an `afterEach` that, for jsdom projects, runs `vi.runOnlyPendingTimers()`-equivalent quiescence or at minimum fails loudly *at the responsible test* (today the error surfaces after the file, unattributed). Concretely: wrap `setTimeout`/`setInterval` in the setup file to track pending handles per test and clear them in `afterEach` — a timer can then never leak past the file boundary.
2. Component-level (defensive): make the drain entry and `reveal()` no-op when the global is gone (`if (typeof window === 'undefined' || typeof document === 'undefined') return`) — the same philosophy as the existing `!menuEl.isConnected` guard, extended to the teardown case.

**How to prove**: deterministic mutation: in a scratch copy, mount `DraftsProvider` with one queued draft, end the test without awaiting the drain, and force `vi.useRealTimers()` + environment teardown — reproduces the ReferenceError. After the setup-file guard, the same mutation fails the *responsible test* with a clear message instead of poisoning the shard.

**Confidence**: medium-high on the mechanism (timer/async continuation outliving jsdom teardown); medium on which of the two files dominates (failures.md names both).

### 2.3 createPollJob "batches hashtag search reindexing" (3x)

**Observed**: `lib/jobs/createPollJob.test.ts:444-476` spies `database.indexHashtagSearchDocuments` and asserts `toHaveBeenCalledTimes(1)` with `{ hashtags: ['#pollone', '#polltwo'] }`. Production path: `lib/jobs/createPollJob.ts:133-156` — `persistNoteTags` returns `affectedHashtags`, then one call `indexHashtagSearchDocuments({ hashtags: affectedHashtags })` (line 152). The reindex itself (`lib/database/domains/search/hashtags.ts:196-262`) runs inside `inTransaction` with `selectInChunks(..., 1)` FOR UPDATE locking.

**Root cause (inferred, medium confidence)**: two candidate mechanisms, both pg-shard-specific:
- (a) The single batched call is correct in the code, but the *transaction* it opens takes row locks one-at-a-time on `search_documents`; on the shared pg service (`--maxWorkers=2`, 414 files) a concurrent test file touching `search_documents` can block this transaction long enough that the test's 5 s default timeout fires (the assertion never runs) — a lock-wait timeout, not a wrong call count.
- (b) `persistNoteTags`'s batching degrades (two calls) under some tag-creation ordering. I rate (b) lower: the batching is structural (one call after `Promise.all`), not timing-dependent.

**Why intermittent**: only on the PostgreSQL shards; requires concurrent lock contention or slow I/O on the shared service.

**Permanent fix**: give this test (and the pg-shard integration tests generally) an explicit generous `timeout` (e.g. 30 s) so DB latency under contention cannot fail the suite; if (b) is ever observed as `expected 1, received 2`, the fix belongs in `persistNoteTags` — but assert the call *arguments* (`toHaveBeenCalledWith`) which is already there, and drop nothing.

**How to prove**: stress: run the file against pg with a concurrent lock-holder (open a transaction holding `search_documents` locks from a scratch script) — today the test times out intermittently; with the raised timeout it passes. Deterministic mutation: wrap the spy's call in a 6 s delay → fails today, passes with the raised timeout.

**Confidence**: medium. Mechanism (a) vs (b) unresolved without the actual assertion output from runs 39063412276/39067115932/39068462120.

### 2.4 ProfileEditor "tells the person to reload" (3x)

**Observed**: `lib/components/settings/profile/ProfileEditor.test.tsx:589-633`. After a mocked 409, the test does a chain of synchronous assertions (`saveButton()).toBeDisabled()`, `getByText(...)`), then:
```ts
await waitFor(() => expect(document.activeElement).toBe(...closest('[tabindex]')))
```
with the default 1 s timeout, and the comment "Focus moves to the Alert … from an effect that can run after the text appears."

**Root cause (inferred, medium-high confidence)**: the focus `waitFor` (line ~617) races a passive focus effect behind the default 1 s timeout. Everything before it is synchronous once `findByText` resolves, so the flake is either this `waitFor` timing out under load, or — secondary — `vi.stubGlobal('location', { ...window.location, reload })` (line ~593): spreading jsdom's `Location` copies no own enumerable properties, so the stub is a hollow object; if any code in the chain reads `location.href`/`origin` before `reload` is called, behavior differs by timing path.

**Why intermittent**: the focus effect runs after paint; under shard-4 load the effect can land >1 s after the text appears.

**Permanent fix**: `{ timeout: 5000 }` on that `waitFor` (matching the file's other load-aware timeouts), and stub `location` with a minimal explicit object (`{ reload, href: 'https://example.test/...' }`) instead of spreading `window.location`.

**How to prove**: stress `--repeat=25` under CPU load; deterministic mutation: delay the component's focus effect by 1.5 s (scratch patch) → fails today, passes fixed.

**Confidence**: medium-high on the `waitFor`-under-load mechanism; medium on the location-stub side channel.

### 2.5 fitness-files/[id]/primary route tests (3x)

**Observed**: `app/api/v1/fitness-files/[id]/primary/route.test.ts:380-412` ("answers 409 … when an import holds the lock for the whole wait") uses `vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })`, starts the request, then `await waitForPollStart(acquire)` and `advanceUntilSettled(pending, emptyPolls)` stepping 250 ms polls past a 15 s deadline. `:444-459` ("answers 200 for the file that already is the primary") is the no-lock fast path asserting `mockPublish` not called and flags `[true, false]`.

**Root cause (inferred, medium-high confidence)**: the 409 test mixes fake timers (`Date`, `setTimeout`) with **real async DB roundtrips** (pg service: `acquireImportLock`, `flags()` reads). `advanceUntilSettled` can only advance timers; it cannot make the real DB respond. If a poll's DB call is still in flight when the advancing loop outruns it, the route's internal deadline arithmetic (built on faked `Date`) and the real I/O interleave differently than on a quiet machine — the response resolves late (test timeout) or the wait ends one poll early (assertion mismatch). The 200-already-primary test (1x) shares the file's `beforeEach` pg state; its failure is most plausibly the 5 s default test timeout under a loaded pg service rather than logic.

**Why intermittent**: only on pg shards; requires I/O latency to interleave with the faked clock.

**Permanent fix**: drive the lock-wait with a controllable clock *and* a controllable DB: mock `acquireImportLock` at the route boundary for the wait-window tests (the lock semantics have their own dedicated test at :370), or gate each `advanceTimersByTimeAsync` step on the previous poll's DB promise having settled (`await vi.advanceTimersByTimeAsync(250); await waitForPollStart(...)` per poll). Raise the file's test timeout.

**How to prove**: stress against pg with artificial latency (scratch wrapper adding 100 ms per query) → intermittent failures today; deterministic mutation: make `acquireImportLock`'s mock resolve after a real 200 ms delay → the current advancing loop fails deterministically, the gated version passes.

**Confidence**: medium-high on the fake-clock/real-I/O interleaving class; medium on which assertion actually failed (logs only name the test).

### 2.6 accounts route "registers on that domain when its sign-ups are open" (1x)

**Observed**: `app/api/v1/accounts/route.test.ts:464-477` (web-form variant; a Bearer variant at :958). It mocks `getServedDomain` and `registerAccount`, posts the form, asserts 303 + `host: 'run.example'`. The neighboring test (:479-497) documents the real hazard: a **stale served-domains snapshot** refreshed on a timer (`SERVED_DOMAIN_REFRESH_MS`), with `vi.useFakeTimers({ toFake: ['Date'] })` used to age the snapshot.

**Root cause (inferred, medium confidence)**: the route consults a cached/process-level served-domains snapshot with a time-based refresh. The test at :464 mocks the *query* but not the snapshot age; if the worker's snapshot was populated by an earlier test in the same file (or a leak across tests via module state) and its refresh deadline interacts with the real clock, the route can take the stale-snapshot path and answer from the wrong domain state. One occurrence in the window.

**Permanent fix**: make the snapshot state deterministic per test — reset the module-level cache in `beforeEach` (the file already has `resetServedDomainsForTests()`; call it in the web-form describe's setup too) and pin `Date` where the refresh boundary matters.

**How to prove**: deterministic mutation: run the stale-snapshot test before this one without a cache reset → should reproduce the 1-off failure; after adding the reset, order-independence holds (`--sequence.shuffle` if available, or a file-order permutation).

**Confidence**: medium — the exact failure mode is inferred from the file's own stale-snapshot comments; I did not see the failing assertion.

### 2.7 DraftEditor.integration "seeds StatusReplyBox from a reply draft and closes on send" (1x)

**Observed**: `lib/components/drafts/DraftEditor.integration.test.tsx:250-274`: three default-timeout (1 s) polls in a row — `waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))`, `waitFor(() => expect(onClose).toHaveBeenCalled())`, `waitFor(async () => expect(await getDraft(...)).toBeUndefined())` — while the file's own helpers elsewhere use `{ timeout: 5000 }` with the comment "polling for the stored state beats a fixed sleep under load" (lines ~292-297).

**Root cause (inferred, high confidence)**: same class as 2.1 — the send→close→purge chain includes the drafts dynamic import, fake-indexeddb writes and the composer's lazy imports; under shard-3 load one of the three 1 s `waitFor`s times out. The file already knows the correct pattern and applies it 40 lines below.

**Permanent fix**: use the file's 5 s timeout on those three `waitFor`s (or a shared `waitForStored`-style helper).

**How to prove**: `--repeat=25` under load; deterministic mutation: 1.1 s delay inside `createNoteMock` → fails today, passes fixed.

**Confidence**: high on mechanism, same caveat on which of the three waits fired.

### 2.8 PrivacyLocationsEditor "scrolls the save error into view" (1x)

**Observed**: `lib/components/privacy-locations/PrivacyLocationsEditor.test.tsx:158-184`. It globally patches `Element.prototype.scrollIntoView = scrollIntoView`, then:
```ts
await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }))
expect(scrollIntoView).toHaveBeenCalledTimes(1)
expect(scrollIntoView.mock.contexts[0]).toBe(alert.parentElement)
```
with the comment "The scroll runs in a passive effect, which React may flush after findByRole resolves".

**Root cause (inferred, medium-high confidence)**: the mock is installed on `Element.prototype` for the whole test — *any* scroll in the document counts. The `toHaveBeenCalledTimes(1)` and `contexts[0]` assertions therefore fail if anything else scrolls (focus management, another effect, a leaked component from a previous test still mounted during this test's first ticks) before or after the alert's own scroll. Intermittent because the extra scroll only happens when a leaked render/effect from a prior test flushes inside this test's window.

**Permanent fix**: scope the spy to the alert element (spy on the specific container's `scrollIntoView` via `vi.spyOn(alert.parentElement, 'scrollIntoView')` once the alert exists), or filter calls: assert `scrollIntoView.mock.calls.filter(([el]) => el === alert.parentElement)` — and keep the `waitFor` with a raised timeout.

**How to prove**: deterministic mutation: in a scratch copy, have the component's focus effect also call `someOtherEl.scrollIntoView()` — the current assertions fail deterministically; the scoped version passes.

**Confidence**: medium-high on the "extra caller on the shared prototype mock" mechanism; the 1 s `waitFor` under load is the alternative (both fixed by the same change).

### 2.9 bulkImportJob heartbeat (2 tests, 1 day each side of a push/pull_request pair)

**Observed**: `lib/jobs/bulkImportJob.test.ts:681-860`. The heartbeat describe uses `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })` (line ~684) — note `setTimeout` and promises stay real — a blocked unit (`follow` returns a promise the test resolves manually), a `tick(BULK_IMPORT_HEARTBEAT_MS)` helper, and `settle()`. Both failing tests assert `expect(renew).toHaveBeenCalledTimes(1)` right after one `tick`, and `expect(vi.getTimerCount()).toBe(0)` at the end.

**Root cause (inferred, medium-high confidence)**: fake-timer/real-promise interleaving. `tick` advances the interval, but the heartbeat's `renewBulkImportRun` promise resolves on the **real** microtask/macrotask queue; if the runner is loaded, the renewal's continuation (which may schedule or clear the next interval, and run the run's cleanup) hasn't run by the time the synchronous `expect(renew).toHaveBeenCalledTimes(1)`... — more precisely the risk is the *tail*: `finishUnit(); await settle(); await run` then `expectNothingWritten()` including `vi.getTimerCount()).toBe(0)`. If `settle()` doesn't flush enough real event-loop turns under load, the interval's clear or the run's final checkpoint is still pending → count ≠ 0 or written-state mismatch.

**Why intermittent**: depends on how many real turns the promises need; under CPU contention the fixed `settle()` budget is exceeded. The two failures were the two heartbeat tests on the two sibling runs of the same SHA (push + pull_request of 62333b5) — consistent with a load-sensitive helper rather than a code bug.

**Permanent fix**: make `settle()` deterministic — poll until `run` resolves and `vi.getTimerCount() === 0` with a generous timeout, instead of a fixed number of turns; and assert `renew` call counts *after* awaiting the run, not between timer ticks.

**How to prove**: stress `--repeat=25` with CPU load; deterministic mutation: add one extra `await Promise.resolve()`-chained real macrotask (`setTimeout(...,0)` chain) inside the heartbeat renewal → the fixed-turn `settle()` fails deterministically; the polling `settle()` passes.

**Confidence**: medium-high on the class (fixed-flush vs load); medium on the exact assertion that fired.

### 2.10 accountExports "pages through list members across multiple lists with pageSize = 1" (1x)

**Observed**: `lib/services/exports/accountExports.test.ts:600-641`. The test creates two lists, then explicitly rewrites their `createdAt` to `new Date(1000)` / `new Date(2000)` with the comment: "Lists created in the same millisecond tie on createdAt, and getLists then orders them by random id. Give them distinct creation times so the expected order follows the ordering rule (createdAt, then id)."

**Root cause (inferred, medium-high confidence)**: keyset pagination with a non-unique sort key. With `pageSize = 1`, paging is only correct if the sort key is totally ordered; a createdAt tie makes page membership depend on the secondary (random-ish id) order, so a page can skip or duplicate a row. The visible comment shows this exact flake was already hit and *partially* fixed by de-duplicating createdAt in this test — but the underlying hazard lives in `getLists`/export pagination: any future test (or real usage) with same-millisecond rows pages incorrectly. The 10-24 failure predates or escapes the guard (the failure run 40112223033 is from branch claude/project-thread-e4qcjc; the guard may have been added after).

**Permanent fix**: make the production ordering deterministic — `orderBy('createdAt')` then `orderBy('id')` in the paginated list query (and every keyset cursor built on it), so ties are impossible by construction rather than by test fixture.

**How to prove**: deterministic mutation: delete the two `createdAt` rewrites in the test (restoring the same-millisecond tie) — against the current query this should reproduce the skip/duplicate intermittently; with the id tie-breaker in the query it passes always. Also a direct unit test: two rows, identical `createdAt`, `pageSize = 1`, expect both rows across two pages.

**Confidence**: medium-high on the tie/ordering mechanism; medium on whether the 10-24 failure was this vs a load timeout (the fixture comment is strong circumstantial evidence the authors saw this exact flake).

### 2.11 GalleryAllMediaView "deselects the day including picks no loaded tile knows" (1x)

**Observed**: `app/(timeline)/gallery/media/GalleryAllMediaView.test.tsx:2714-2760`. Flow: Select day → `waitFor(() => expect(bar()).toHaveTextContent('3 selected'))` (default 1 s) → Deselect day → `waitFor '0 selected'` → `expect(getGalleryMediaIdsMock).toHaveBeenCalledTimes(2)` and `toHaveBeenLastCalledWith(...)`.

**Root cause (inferred, medium confidence)**: two coupled hazards: (a) both `waitFor`s use the default 1 s while the select/deselect handlers `await` the mocked `getGalleryMediaIds` promise and then update a large selection state — under load the second `waitFor` can time out; (b) the exact mock call count (`toHaveBeenCalledTimes(2)`) is brittle: any re-render that re-queries ids (e.g. a re-render caused by the toast/announcement state added in the same feature, or React re-running the effect under StrictMode-like conditions in the test renderer) makes it 3.

**Why intermittent**: requires the extra render or the slow promise resolution; 1 hit.

**Permanent fix**: assert on the *last* call's arguments and on the selection bar text (behavior), not the global call count; raise the `waitFor` timeouts to the file's load-aware value.

**How to prove**: deterministic mutation: make `getGalleryMediaIdsMock` resolve after 1.1 s → current test fails at the first `waitFor`; fixed test passes. For (b): force one extra effect run → count assertion fails, behavior assertions hold.

**Confidence**: medium; the exact failing assertion is unknown.

### 2.12 credentialIdentity test timing out under load

**Observed**: `lib/services/auth/credentialIdentity.test.ts` — the suite boots a real better-auth instance (`getAuth(BASE_URL)` + `auth.handler(new Request(...))` per sign-in, lines 55-77), a real test database in `beforeAll` (line 142), and bcrypt hashing (lines 200-258, `TEST_BCRYPT_COST` = lowest cost, line 16-17).

**Root cause (inferred, medium-high confidence)**: each test performs full better-auth sign-in HTTP handling — request parsing, credential lookup, bcrypt.compare, session creation, DB roundtrips — against the test database (on pg shards, over TCP to the service container). Under a loaded shard this exceeds Vitest's default 5 s test timeout. The file sets no per-test/hook timeouts.

**Permanent fix**: raise the timeout for this file (`it(..., { timeout: 15000 })` or a describe-level `timeout`), or reduce per-test work (one `getAuth` instance in `beforeAll` instead of per sign-in — line 63 re-imports per call, cached but still). The bcrypt cost is already minimal, so the cost is I/O + framework overhead.

**How to prove**: stress: run the file concurrently with CPU load (`--repeat=10` plus external load) — intermittent 5 s timeouts today; deterministic mutation: `--testTimeout=200` makes it fail every run today and still pass with the raised per-file timeout.

**Confidence**: medium-high on the "real auth handler + DB I/O vs default 5 s timeout" mechanism; the task brief itself describes it as "timing out under load", which matches.

### 2.13 migrate baseline "loads the baseline" (2x on the same SHA) — genuine, not flaky

**Observed**: `lib/database/migrate/index.test.ts:258-291` migrates an empty database, then loads the reference dump (`migrations/schema.sql` / `schema.sqlite.sql`) into a fresh database and requires the two schemas to be **exactly equal**. Both failures are on SHA 2adff5c (runs 40101136337 push + 40101175823 pull_request, 2026-10-24 14:08, branch claude/project-thread-e4qcjc — the account-archive PR). Branch history (observed in git): 2adff5c is a mid-PR commit ("Fix account archive export review round 2…"); later commits on the same branch include `8b544aa96 fix: update tests and the PostgreSQL dump for import storage` and `a83637ad6 none: regenerate schema dumps for the combined migrations`.

**Verdict: genuine at that commit, not flaky.** The test is a deterministic schema diff; the branch had added migrations without regenerating the PostgreSQL dump at 2adff5c, and the PR itself fixed the dump before merge. Both events failing on the same SHA is what a deterministic failure looks like; a load-flake failing both sibling runs of one SHA is unlikely, and no other run of that SHA passed.

**Why it could still be worth hardening (inferred)**: the pg path calls `recreatePgDatabase(...)` (line ~271) — DROP/CREATE DATABASE on the shared service. If two test files ever share the recreated database name, that is a latent concurrency flake. Worth verifying names are per-file.

**Permanent fix**: none needed for the 2 failures (the process worked: the PR fixed its dump). Guard: the CI schema-drift steps in ci.yml already catch this class at the job level; the test is the second net.

**How to prove**: check out 2adff5c and run the file — it should fail deterministically on both sqlite and pg; the branch's dump-regeneration commit should turn it green.

**Confidence**: high on "genuine at 2adff5c" (deterministic test + both events failed + the branch's own later dump-fix commits); medium on the exact field that differed (not verified by execution).

---

## 3. Dependabot — 22x YN0028 "frozen lockfile would be modified" (nodemailer)

**Observed**:
- All 22 failures are on branch `dependabot/npm_and_yarn/packages/nodemailer/nodemailer-10.1.4` (2026-10-23, runs 40039874552 push + 40039881717 pull_request), at the `Install dependencies` step (`yarn install --immutable`), every job.
- failures.md records the mismatch as "nodemailer 10.1.2 vs 10.1.4 entry": on the Dependabot branch, `packages/nodemailer/package.json` asked for 10.1.4 while `yarn.lock` still described 10.1.2 → YN0028, `--immutable` refuses, install fails.
- The later Dependabot PR #2654 (`ad8eb56ea`, 2026-10-29, "bump nodemailer from 10.1.4 to 10.2.1") **did** update both required places in `yarn.lock` (verified in the commit diff): the workspace block `@activities/nodemailer@workspace:packages/nodemailer` → `nodemailer: "npm:10.2.1"` (yarn.lock:21) **and** the standalone `"nodemailer@npm:10.2.1"` entry with checksum (yarn.lock:6211). That branch's CI passed.
- Current `.github/dependabot.yml` has a single npm entry with `directory: '/'` — yet the failing branch name embeds `packages/nodemailer`, i.e. Dependabot resolved the workspace manifest under the root config and bumped the dependency there.

**Root cause (inferred, medium-high confidence)**: Dependabot's yarn-workspace lockfile update for the 10.1.4 PR was incomplete — it edited the workspace manifest (`packages/nodemailer/package.json`) without correctly updating the root `yarn.lock` (most plausibly it updated the standalone `nodemailer@npm:` entry but not the workspace block's `dependencies:` mapping, or neither). Yarn Berry's `--immutable` then correctly refused (YN0028). This is a known Dependabot yarn-workspace weakness; the 10.2.1 PR shows the updater performing the complete two-part edit, i.e. the bug is on Dependabot's side and was not reproducible a week later.

**The dependabot.yml change that stops these PRs for every workspace in packages/**: since the updater cannot be trusted to regenerate the root lockfile for workspace-manifest bumps, stop Dependabot from bumping workspace-only dependencies on its own, and let a human (or a grouped update that includes the root) own them. Concretely, in the single npm update block:

```yaml
    allow:
      # Only bump dependencies the root manifest owns. Dependabot's yarn
      # workspace lockfile updates are unreliable: a bump to a packages/*
      # manifest can ship without the matching root yarn.lock edit and every
      # job then fails YN0028 at `yarn install --immutable` (nodemailer
      # 10.1.4, 2026-10-23, 22 failed jobs). Workspace deps are bumped by
      # hand (or by a grouped PR) together with the lockfile.
      - dependency-name: '*'
        dependency-type: 'direct:production'
```
…combined with `ignore` entries for the deps that live only in `packages/*` manifests (`nodemailer`, `resend`, `ses`, `@google-cloud/tasks`, `pg`, `@upstash/qstash` — the exact set is what `packages/*/package.json` `dependencies` lists and the root does not). The essential property: **no Dependabot PR may change a `packages/*` manifest without also changing `yarn.lock`** — either by excluding those bumps, or (if workspace bumps should stay automated) by adding a CI pre-check that fails such a PR instantly at the install step it already fails at, which is what happens today; the config change above is what prevents the PR from existing at all.

Alternative (weaker) mitigation if workspace bumps must stay automated: none exists purely in dependabot.yml that guarantees lockfile correctness — `versioning-strategy` options (`lockfile-only`, `widen`, …) do not repair an updater that skips the workspace block. This is worth stating plainly: the reliable lever is `allow`/`ignore` scoping.

**How to prove**: after the change, no `dependabot/npm_and_yarn/packages/...` branches should appear (check branch list over the next cycle); root-manifest bumps (e.g. the better-auth group) still open and still pass `yarn install --immutable`. Deterministic reproduction of the failure class: hand-edit `packages/nodemailer/package.json` to a version absent from `yarn.lock` and run `yarn install --immutable` — YN0028 every time.

**Confidence**: high on the mismatch mechanics (verified in the #2654 diff what a *correct* update looks like; failures.md records the 10.1.2-vs-10.1.4 mismatch); medium on Dependabot's precise internal failure (its 10.1.4 branch diff was not fetchable in this session — no network); medium-high that `allow`/`ignore` scoping is the only dependable dependabot.yml-level fix.

---

## Suite-wide guards (stop new flakes of the same class)

1. **Timeout floor for async UI tests.** The dominant class (2.1, 2.4, 2.7, 2.11, and friends) is default 1 s `waitFor`/`findBy` racing cold dynamic imports + fake-indexeddb under shard load. Guard: a lint/test-setup rule that bans bare `waitFor(...)`/`findBy*` without an explicit `{ timeout }` in jsdom projects (an Oxlint agentsRules-style check, like the existing `lib/components/tailwindCssVariableSyntax.test.ts` pattern-test approach), or a setup that patches testing-library defaults to 5 s for the jsdom project. Files already carry the institutional knowledge ("can outlast the default 1s on a loaded machine") — the guard turns it from convention to enforcement.
2. **Per-test/hook timeouts for DB-integration files.** pg-shard files doing real I/O (2.3, 2.5, 2.12) need describe-level timeouts ≥ 15-30 s; guard with a `test/vitest.config.test.ts`-style check or a projects-level `testTimeout` for the pg project.
3. **Timer-leak detection in the vitest setup.** For the post-teardown `ReferenceError` class (2.2): track `setTimeout`/`setInterval` handles per test in `test/setup/vitest.setup.ts`, clear them in `afterEach`, and fail the *owning* test if a handle outlives it. Today the shard pays for a leak in whichever file finishes last.
4. **Deterministic ordering for keyset pagination.** Any paginated query whose cursor sorts on a non-unique column (`createdAt` without `id`) is a latent flake (2.10). Guard: a test that pages two same-timestamp rows with `pageSize = 1` and requires both rows; better, a lint/review rule that every `orderBy` used by a cursor has a unique tie-breaker.
5. **No shared-prototype mock spies.** `Element.prototype.scrollIntoView = vi.fn()` (2.8) counts every caller in the document. Guard: review rule / Oxlint plugin rule preferring `vi.spyOn(target, 'method')` on the specific element.
6. **Fake-timer tests must gate on real I/O.** Where `vi.useFakeTimers` coexists with real DB promises (2.5, 2.9), require each timer advance to await the outstanding real promise (a `tick`/`settle` helper that polls rather than flushes a fixed number of turns).
7. **CI-side**: `timeout-minutes` everywhere, `push` on main only, aggregates fail-closed with `abandoned`-only auto-retry, `actions/*` pinned to SHAs, install retry. These shrink the infra classes (1.1-1.4) and the runner pressure that amplifies every load-sensitive test above.
8. **Flake bookkeeping**: the repo already documents known failure classes in CONTRIBUTING.md ("Known failure classes") — add the two classes found here (default-timeout-vs-cold-import; timer-leak-past-teardown) so the next agent triages them in one lookup.

## Not finished / caveats

- No test file was executed (time budget); all "how to prove" commands are specified but not run. Mechanisms for 2.3, 2.6, 2.9, 2.11 are inferred from code + failure counts, not from a reproduced failure — the exact failing assertion in each log was not available to me.
- The Dependabot 10.1.4 branch diff could not be inspected (no network); the incomplete-lockfile-edit conclusion rests on failures.md's recorded mismatch plus the verified correct #2654 diff.
- The 2x "no error line found" runs (39030227533 docker readiness, 40080980129 build prerender) were not deep-dived; the docker one is a readiness-timeout infra class, the build one matches the documented prerender config class.
- The 16 zero-job `version-bump/main` pull_request failures were not root-caused (no logs exist); noted as startup-level, non-gating.
