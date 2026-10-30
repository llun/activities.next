# Independent CI flake analysis

Revision inspected: `4853a3a2640b0f6eac0a6342c725ebf68af4672b` (latest main supplied), 2026-10-30. Read-only; no tracked changes, commits, network tools or delegated work. Historical revisions were read with local `git show`, not checked out. Only this report is intentionally written. Tests use Node 24, the required network-blocking preload, and `--no-cache`.

## Evidence and conclusions

The inventory was read in full. It contains names/run IDs but **not assertion diffs or full stack traces for most tests**, despite being described as exact errors. Historical source and fixing diffs provide strong evidence for most entries. A passing current test is corroboration, not a reproduction of the old failure. Push and pull_request runs may test different trees; different outcomes between them alone do not establish flakiness.

Most named test failures have already been addressed on main. Two inventory classifications are wrong: the added-domain account redirect expectation is a deterministic integration mismatch; the migration comparison is a deterministic PostgreSQL deparser/round-trip mismatch. Remaining work includes lifecycle hardening for DraftsProvider, expensive credential fixture setup, and CI scheduling/recovery. Provider-internal infrastructure causes cannot be established from these logs alone.

Line references below are at the inspected HEAD unless a revision is explicitly prefixed. Proposed mutations are verification instructions, **not changes made during this investigation**.

## 1. CI infrastructure

### Abandoned PostgreSQL shard: run 41071657730 / PR 2688

**Observed:** supplied job metadata says queued, no runner, no logs, and All Tests received `abandoned`; the companion merge-ref run succeeded. Workflow `.github/workflows/ci.yml:166-174` schedules the two PG shards; `:369-385` requires both matrix job results to be success. Thus All Tests failed correctly: the required execution never occurred. CI Success repeats this at `:450-476`.

**Root cause/confidence:** high confidence this was scheduler/runner allocation failure rather than a PostgreSQL assertion. The exact GitHub service fault is unknown. Duplicate runs increase allocation pressure, but there is no evidence proving they caused this particular abandonment. Keep All Tests and its fail-closed semantics; do not turn `abandoned`, skipped, cancelled or missing into success, or substitute the sibling event's result.

**Permanent mitigation:** change push to `branches: [main]`, retaining `pull_request` (and `workflow_dispatch` if manual diagnostics are desired). Preserve merge-ref testing and the required names All Tests, Lint and Prettier, Build. This removes redundant head-branch CI jobs for PRs; main still validates pushes. `.github/workflows/ci.yml:19-21` currently accepts every push and PR, and `:30-32` uses `github.ref`: `refs/heads/x` and `refs/pull/N/merge` are distinct, so concurrency does not deduplicate them. Preserve per-PR cancellation of superseded PR runs. For long main runs, decide explicitly whether main cancellation is desired.

**Recovery policy:** safest under the constraint "a code failure must never be retried into green" is no generic automatic failed-job retry. A trusted operator/controller may rerun only a job proven never to have executed code (this queued/no-runner/no-steps case), recording the attempt and refusing if any executable check in the recovery scope failed. All Tests stays red until the missing execution actually passes. Such a controller must not execute PR code with elevated credentials. Timeout/SIGHUP alone are insufficient proof for automatic recovery.

**Proof:** validate event matrix (main push runs; feature push does not; same-repo and fork PR do). Exercise aggregate inputs success/failure/cancelled/skipped/abandoned/missing: only all-success may pass. Inject a failing assertion and confirm exactly one test execution and a red aggregate. Simulate a never-started job separately and prove only that job is eligible for recovery. Do not relax branch protection.

### Four exit-129 shards (38840511676, 38871319949 twice, 38887834104)

**Observed:** inventory reports abrupt status 129 after test output and no summary. 129 is conventionally 128 + SIGHUP (signal 1), but an exit code alone does not identify the sender or prove a GitHub outage. Current shard command is `ci.yml:139-148`; all jobs use hosted `ubuntu-latest`. No evidence here identifies OOM, a test assertion, cancellation propagation, Yarn parent death, or runner loss as the exact cause.

**Why intermittent:** external signal/process lifecycle or load-dependent termination is plausible; exact trigger unproven. **Confidence:** high on abrupt termination class; low on ultimate cause. Do not label all four confirmed runner failures or auto-retry 129. In particular OOM usually has a different signal; no OOM evidence was supplied.

**Fix/mitigation:** bounded job timeouts, reduce duplicate scheduling, retain fail-fast:false, record Node/Yarn/runner-image versions and attempt, upload partial per-file reports when the runner survives, capture process signal/exit and available memory diagnostics. A runner lost before uploads needs GitHub-side investigation. Pin a supported runner image after verification to make the Ubuntu label migration an explicit change, not a speculative cure.

**Proof:** in an isolated future diagnostic job send HUP to a harmless test-process wrapper and verify the workflow stays red, records termination and does not retry. Compare the diagnostic signature with a deliberate assertion exit 1 and an externally cancelled run. No production run was altered here.

### YN0001 write ECANCELED during install (39819301293)

**Observed:** inventory's TLS/write cancellation occurred during resolution, before tests. Every job independently runs `yarn install --immutable` (e.g. `ci.yml:137-138,213-214`). **Inference/confidence:** medium-high transport cancellation; the remote endpoint/cancelling party is not identifiable from the abbreviated error. Intermittency follows network transport/service lifecycle, not package assertions.

**Fix:** keep immutable installs. A bounded install-only retry is defensible only for a strict allowlist of positively identified transport errors, with retained first-attempt logs and a short limit/backoff; refuse YN0028, resolver/version/engine/checksum/build-script errors and all test/build/lint failures. A mixed error log must fail closed. Never wrap the entire job/test suite in retry. GitHub/Yarn transport retry at the failing network operation is preferable to restarting successful work. No retry can guarantee external-network availability.

**Proof:** fixture-drive the retry classifier: isolated ECANCELED may retry; ECANCELED plus YN0028 may not; YN0028, a lifecycle-script exit 1 and an assertion failure must run once and fail. Test retry exhaustion. No network experiment was performed.

### Unable to resolve actions/cache@v6 (41057961159)

**Observed:** `ci.yml:91-97` uses the action, and inventory says setup failed before steps. Successful other runs resolve the same action major. This is not evidence that the cache contents or application code are bad. **Confidence:** high setup/action-resolution class; service outage versus transient ref lookup not proven.

**Fix/mitigation:** pin actions to verified immutable commit SHAs, kept current through Dependabot; if cache availability is not worth making setup critical, remove this optional action and build without cache. Pinning removes mutable-ref ambiguity but cannot prevent GitHub download outages. `continue-on-error` on the cache step is not a cure for a workflow that cannot resolve its actions at job setup. Recover only positively identified pre-execution infra failures, under the policy above.

**Proof:** test a cache miss and disabled cache produce identical passing build/budget checks; action SHA existence must be verified outside this offline analysis. Deliberate application build failure remains red. Never retry it based merely on an earlier cache warning.

### Timeouts and additional inventory items

There are no job `timeout-minutes` in the current workflow. Add explicit budgets to every executable and aggregate job; initial proposals are 10 minutes for aggregates, 15 for lint/typecheck, 30 for build/SQLite shards, 45 for PG shards/schema checks, 45 for Docker smoke, then tune from observed successful p99 durations. These are proposed starting ceilings, not measured budgets. Bound individual readiness operations as well. **A job execution timeout does not solve a job waiting in the GitHub queue**; reducing duplicated demand and investigating provider allocation does.

The inventory also has 16 zero-job workflow failures: startup-level unknown, requiring GitHub workflow/check-suite diagnostics; no repository source establishes their cause. Its Docker readiness timeout on `/api/v2/instance` is not enough to declare infrastructure rather than app startup/config failure; retain container stdout/stderr, exit status, health/readiness diagnostics and elapsed stages before increasing a timeout. The `/settings/navigation` build failure (40080980129) reports missing configuration, and bundle/type/lint failures in the inventory are ordinary red checks, not retry candidates. `package.yml` has no reported failures.

## 2. Tests

### 2.1 SignOutDialog — zero drafts (8 failures)

**Observed code:** `SignOutDialog.test.tsx:97-109` subscribes to a module-global drafts event stream. Older code captured every event except `changed`; exact expected sequence at `:307-320` is `['signing-out','signOut']`. Earlier tests create waiting drafts and mount a real DraftsProvider (`:218-254`). Provider drain progress is broadcast at `DraftsProvider.tsx:417-426` and its finally can emit idle at `:440-450`. `draftsChannel.ts:63-65,81-87` notifies the **current** listeners, not the listeners that existed when an async operation began. Clearing the channel at test end (`:105-112`) does not cancel producers.

**Cause/intermittency:** a preceding provider's unfinished queue work can notify the next test and add `queue-progress` to its exact sign-out sequence. Timing of IndexedDB, module loading and queue completion decides which test sees it. High confidence in this mechanism; without original assertion diffs, not proof all eight had the identical extra event. History `779d9b9d4` explicitly changes this collector; independently, the producer/subscriber source makes the race possible.

**Current status/fix:** main filters `queue-progress` as well as `changed`, fixing this assertion's scope. The permanent lifecycle fix is also to make provider shutdown invalidate every continuation and prevent any new drain/timer after unmount, then await quiescence before resetting DB/global fixtures. Filtering is valid for a sign-out-event assertion but is not proof that the producer leak is gone. The count readiness and redirect waits at `:313,317` still use the default Testing Library budget; hold dependencies explicitly and use an intentional integration timeout if cold I/O is the demonstrated bottleneck.

**Proof:** defer a prior provider's drain, unmount it, install the next sign-out subscriber, then resolve the old operation. The sign-out collector should ignore unrelated progress; a separate lifecycle assertion must require no post-unmount drain/state update/timer. Keep the sign-out event ordering and the separately awaited redirect assertion. Run the whole file, not just `-t 'zero drafts'`, to include contamination predecessors. Current network-blocked full-file run passed 19/19 in 1.73s.

### 2.2 Unhandled window/document undefined after jsdom teardown (5 failures)

**Section dropdown, high confidence:** historical `a83756b8a^:lib/components/section-nav-dropdown.tsx` reads global `document.activeElement` in a delayed reveal and global `window.clearTimeout` in cleanup. A 300ms timer can run after document globals are removed. Current `:140-160` captures the menu element, checks `isConnected`, uses `ownerDocument`, and uses global timer functions. Current `:183-202` stores cleanup and runs it on unmount/reopen; close also clears it. The failure appears only when teardown beats the real timer. Fix is ownership/cancellation plus detached-element guard, not swallowing unhandled exceptions globally.

**DraftsProvider, high confidence lifecycle flaw, medium exact historical attribution:** before `a83756b8a`, successful async drain branches unconditionally called `setDrainFailed(false)` after await. React's DOM update path can read window after jsdom disposal. Current `:404,434` checks the drain AbortSignal. Unmount aborts/increments generation at `:475-481`. **Residual defect:** outer drain finally `:462-465` treats every generation change as a reason to call `drainRef.current()`, including unmount, and there is no mounted guard in `canDrain` (`:315-320`) or `scheduleWake` (`:333-365`). An in-flight run released after cleanup can start a fresh controller/work loop and schedule a wake after the cleanup has already cleared the old one. A generation token distinguishes old data, but here does not distinguish a live replacement from disposal. This can explain continuing stragglers despite the two guarded state writes; it is not dynamically reproduced here.

**Permanent fix:** mounted/live-generation gate checked before beginning work, after await and in finalizers; only a still-mounted replacement generation may request another drain. Invalidate scheduleWake reads; abort outstanding queue work and provide a settled promise for tests to await. Prevent progress publication from stale unmounted generations where it is no longer needed. Cleanup must happen before restoring global mocks/IndexedDB. Avoid merely adding `typeof window` around state updates.

**Proof:** use deferred listDrafts/queue-dependency/drain results, unmount before resolving each, then resolve in both success and error orders. Assert no new list read, progress side effect or timer and zero unhandled rejections. For dropdown capture a ResizeObserver callback, unmount, invoke it and advance 300ms; detached callback must be harmless and no observer/listener remains. Main already contains such dropdown coverage; add corresponding provider lifecycle coverage. Run with normal Vitest unhandled-error failure behavior.

### 2.3 createPollJob — batches hashtag search reindexing (3 failures)

**Observed/cause:** historical `88b63cdbf:lib/jobs/noteTags.ts:170-191` concurrently inserted tags with Promise.all but pushed successes into a shared array **after each insert completed**. PG connections complete in either order. `lib/jobs/createPollJob.test.ts:444-475`, demanding `['#pollone','#polltwo']`. `createPollJob.ts:131-154` awaits persistence then forwards its result, so this is not a missing await on indexing.

**Intermittency/confidence:** high; PG query completion order controls the array, while serialized SQLite commonly hides it. It affects deterministic order, not whether indexing is batched.

**Permanent fix/status:** already fixed by `736ab9b2e`. `noteTags.ts:173-196` returns each mapped result and filters Promise.all's positional output, retaining concurrency, failed-tag skipping and note order. No need to weaken the assertion or serialize all inserts.

**Proof:** replace the real-time delays in the regression with deferred insert promises; resolve the second hashtag before the first and assert input order plus one index call after both settle. Reverting to push-on-completion must fail deterministically. Current whole createPollJob file passed 21/21 (SQLite, 1.28s). PG historical failure was not rerun.

### 2.4 ProfileEditor — tells the person to reload (3 failures)

**Cause/evidence:** `ProfileEditor.tsx:200-210` focuses the error Alert in a passive effect, after the error render. Historical `3a9c3c2ee^:lib/components/settings/profile/ProfileEditor.test.tsx:613-619` immediately asserted activeElement after `findByText`; text existence does not imply passive-effect completion. Current test `:600-621` waits for the actual focus predicate. The reload callback at `:623-626` is not the timing defect identified in that diff.

**Intermittency/confidence:** high; React scheduler/effect flush relative to Testing Library observation changes with load. Fixed in `3a9c3c2ee`, merged via `1ee4be828`.

**Permanent fix/proof:** keep waitFor on focus, not an arbitrary sleep or wholesale timeout increase. In a regression harness, observe text at commit before the passive focus effect runs, prove the immediate assertion fails, then flush effects and assert focus, unsaved edit, disabled Save, Reload invocation. Use deferred save rejection in act for controlled sequencing. Current focused test execution is recorded below.

### 2.5 fitness-files/[id]/primary route (3 failures)

**Observed history:** `05b2c7f:app/api/v1/fitness-files/[id]/primary/route.test.ts:343-350` waited for the first acquire call, advanced fake time once by 16s, then awaited the route. `withImportLock` (`lib/services/fitness-files/importLock.ts:57-62`) alternates a real asynchronous DB acquisition and a fake 250ms sleep. Clock advancement does not complete PostgreSQL I/O. If a later DB response arms a sleep after the advance ended, the request stays pending with nobody advancing it. `1591c67` replaced this with fixed numbers of setImmediate turns per tick (`route.test.ts:155-168` at that revision), which are still not a DB completion barrier.

**Intermittency/confidence:** high for the PG timeout mechanism. The already-primary 200 case has no intrinsic wait; an earlier abandoned pending route can retain/acquire the actor's lock or mutate mocks during the next test. High confidence cascade is possible, medium that it was the exact third failure without its assertion/stack.

**Fix/status:** `6bf52f4a9`, merged by `cd02d2ac6`, waits for an actual empty DB poll before each fake tick. Current `route.test.ts:150-214,380-440` shows the stepper and finally blocks joining pending requests; `:69-74` clears lock residue. A still stronger seam is an injectable sleep/clock or explicit sleep-entered signal, so the test need not infer timer registration with setImmediate. Do not globally fake PG driver's I/O timers to test an application retry timer.

**Proof:** on disposable local PG delay acquire responses 50ms using an unfaked real timer or deferred gate, never elapsed fake time. Release each acquisition, wait for application sleep registration, tick 250ms, repeat beyond the 15s deadline. Assert 409/no mutation and that the next already-primary request passes. Run all route cases sequentially, both backends. Revert to a single 16s advance and gate the second acquisition to deterministically strand the old test. Also force an assertion failure mid-wait and verify finally leaves no pending request/lock. No PG service was started here.

### 2.6 accounts route on an added domain

**Not a demonstrated flake.** The PR head `4935c5f` still returns 307 (`app/api/v1/accounts/route.ts:403` at that revision) and its new test expects 307. Independently, main's `d4763d6fa` changes that successful native form POST redirect to 303. The failing run is pull_request, which tests the merge tree: the head's new test and main's new redirect contract conflict. Local historical diff `8677d594a` changes precisely the added-domain expectation from 307 to 303; current `app/api/v1/accounts/route.test.ts:464-476` expects 303. This explains a passing head push and failing merge-ref run without any timing flake. The exact synthetic merge commit is not retained here, so its combined tree is inferred from these source diffs and the event metadata.

**Confidence:** high on expectation mismatch; inventory's sibling-event comparison alone does not refute it because the merge-ref tree can differ. **Fix/status:** already aligned with the route contract. **Proof:** run this named case with a resolved successful registration; mutate expectation to 307 and it must fail on every run. Cover successful web-form registration on primary and served domains with the same 303 semantics, separately from JSON responses. No asynchronous network call is needed (registration is mocked).

### 2.7 DraftEditor.integration — reply draft closes on send

**Cause/evidence:** text hydration and derived Post enablement occur in different renders. Old test clicked Post after seeing seeded text; a disabled button ignores the click. Current `lib/components/drafts/DraftEditor.integration.test.tsx:162-168,250-271` waits for Post to be enabled through `postWhenReady`. Historical change `33a069f4a` introduced the readiness wait, merged in `22dabafa7`.

**Intermittency/confidence:** high; whether the second render lands before the test's click is scheduler-dependent. No evidence of incorrect reply persistence from this failure.

**Permanent fix/proof:** retain waits on actionable state, keep one click outside waitFor, await send/close/delete outcomes. A deferred epoch/draft read or harness commit observer can expose seeded text while allowPost is still false; assert no send until enabled, then one send and close. Reverting postWhenReady to an immediate click should fail under that controlled ordering. Exercise StrictMode and delayed epoch as well.

### 2.8 PrivacyLocationsEditor — scroll save error into view

**Cause/evidence:** error DOM exists before its passive scrolling effect runs (`PrivacyLocationsEditor.tsx:458-460`). Old test used findByRole then immediately asserted scrollIntoView. Current `PrivacyLocationsEditor.test.tsx:158-179` waits for the actual scroll call, checks exactly once and the correct element. `8b40f2b2b` is the historical fix.

**Intermittency/confidence:** high; passive effect versus DOM observer scheduling. **Permanent fix/proof:** retain effect-aware assertion, with rejected deferred save and explicit act/effect boundary. Mutate back to immediate scroll assertion and force observation before effects; then current wait must pass. Restore the original prototype descriptor in cleanup rather than deleting a pre-existing implementation, for suite isolation. Do not change application scrolling merely to satisfy an early test assertion.

### 2.9 bulkImportJob heartbeat — lost renewal and main-path renewal error

**Cause/evidence:** at `62333b5`, startBlockedRun used up to 50 setImmediate turns as a guess that follow() had been reached, so `finishUnit` could be unset under slow DB execution; renewal completion was guessed with the same loop. Also production heartbeat used a detached async interval with only a boolean in-flight flag, allowing a renewal to finish after run/claim release. Historical `a1205ac23` changes both. Current test `bulkImportJob.test.ts:683-715` awaits unitReached and actual renewal promises. Current production `bulkImportJob.ts:343-363,377-380` tracks the in-flight beat and joins it before releasing the claim.

**Intermittency/confidence:** high; event-loop turns are not SQL completion, and lease renewal duration varies. Both named failures (`:756-768,838-859`) depend on that shared helper and sequencing.

**Permanent fix/status:** existing deferred entry/renewal joins are the correct direction. Add try/finally around blocked-run tests so failed assertions always release the unit, settle the run and restore clock; success-only finishUnit calls can still leave work alive on assertion failure.

**Proof:** gate follow-entry behind a deferred database call and delay it beyond 50 event-loop turns; old helper returns prematurely, new helper cannot. Gate the heartbeat renewal, finish work, assert releaseBulkImportRun and run settlement wait for that renewal. Resolve false and reject main-path renewal separately and assert no checkpoint/publication, cleared timer, released claim where appropriate. Revert the await-beat in production to prove the teardown guard detects it.

### 2.10 accountExports pagination — list members across lists, pageSize=1

**Cause/evidence:** `lib/database/domains/list/queries.ts:78-86` assigns real wall-clock createdAt and randomUUID; `:127-138` orders by createdAt then id. Two fast list creations can tie to the millisecond and random IDs decide the order. Historical test at `a01f0c8` assumed List 1 then List 2. `453adaa4e` pins distinct fixture timestamps; current `accountExports.test.ts:626-638` retains that fix. Current assertion at `:640-643` additionally sorts lines because current export traversal is keyset/id order (`accountExports.ts:62-67`), not an insertion-order promise.

**Intermittency/confidence:** high; fast SQLite is especially likely to tie, and random IDs choose either order. Not evidence of lost pages.

**Permanent fix/proof:** use intentional timestamps/IDs when order is contractual; otherwise compare exact membership independent of order while still checking count/no duplicates and page traversal. Force identical createdAt and reverse-lexicographic IDs in a fixture: the historical insertion-order assertion must fail deterministically. Current export must include both members exactly once with pageSize=1. Add tied-sort-key pagination coverage so fixing fixture order does not mask a cursor bug.

### 2.11 GalleryAllMediaView — deselect day including unloaded picks

**Cause/evidence:** historical `3a9c3c2:lib/components/gallery/useDaySelection.ts:237-238` updates selectedRef in a passive effect. Test at that revision `GalleryAllMediaView.test.tsx:2608-2614` sees the committed "3 selected" DOM then immediately clicks Deselect day. `deselectDay` reads selectedRef to calculate removals; an unflushed effect leaves the old empty selection, making removal a no-op. Undo and room capacity have the same stale-ref window. Current `useDaySelection.ts:238-241` uses useLayoutEffect; room is similarly synchronized. `:761-769` shows the removal decision. Historical fix `cf215b6f7` was merged in `1ee4be828`.

**Intermittency/confidence:** high; commit/observer/next-click timing relative to passive effects. This is a production stale-ref race exposed by a fast interaction, not a test to fix by waiting an arbitrary extra turn.

**Permanent fix/proof:** preserve synchronization before the next observable interaction (layout effect or equivalent fresh-state design). Do not weaken the fast interaction test. In a hook/component harness trigger the next action immediately after a commit, before passive effects, with selected items including one unloaded tile; assert all three removed and Undo restores all three. Reverting selectedRef/room updates to passive effects must make that ordering fail. Current full-file test result is recorded below.

### 2.12 credentialIdentity timeout under load

**Evidence limit:** this item is in the task but has no run ID, named timed-out case, duration or stack in the supplied inventory. I cannot identify its exact historical timeout from that file.

**Observed source:** every test registration helper (`credentialIdentity.test.ts:96-109`) calls real registerAccount. That service (`registerAccount.ts:17,116-119`) generates a 4096-bit RSA pair (`lib/utils/signature.ts:155-167`) and hashes at bcrypt cost 10. The test's cost-4 constant (`credentialIdentity.test.ts:16-18`) only covers direct password-reset/change fixtures; it does not reduce registration key generation or its password cost. Node crypto/bcrypt work competes for worker-pool/CPU resources across tests. RSA prime search has a variable tail. Current timeout is 30s (`vitest.config.ts:100`), not a guarantee against oversubscription.

**Root-cause confidence:** high that these are unnecessary, expensive identity-test setup operations; medium that their variable latency caused the reported timeout, because the actual timeout evidence is missing. Import/auth initialization or DB setup must also be timed before declaring crypto the exclusive cause.

**Permanent fix:** seed a real database identity with a fixed valid test RSA key and bcrypt cost-4 hash, or locally mock only signature.generateKeyPair for these identity tests and replace registration's hashing with a test-specific real cost-4 wrapper. Preserve real bcrypt.compare and the Better Auth/database path being tested; do not mock authentication into success or reduce production strength. Keep a focused registration/crypto integration test and bound worker concurrency. Prefer one suite-local precomputed fixture over regenerating a key per registration.

**Proof:** instrument stage durations (registration lookups, keygen, hash, auth import and handler) in a temporary future harness; run repeated whole-file executions under controlled concurrency. A deterministic fixture regression can replace keygen with a never-resolving gate: identity tests should still finish if they no longer use unrelated keygen; the dedicated registration test should correctly wait/fail. A fixture-shape guard must show valid PEM and successful real compare against cost-4 hash. Avoid claiming a changed timeout alone fixes the cause.

### 2.13 migration baseline — twice on SHA 2adff5c

**Genuine deterministic mismatch, high confidence; not a flake.** `lib/database/migrate/index.test.ts:258-292` runs **all migrations**, reads schema text, recreates the database, loads the committed current dump, and compares text. The test name "baseline" is misleading: failure need not be in the frozen baseline. `:71-80` reads pg_indexes.indexdef and constraint definitions.

At `2adff5c`, new migration `migrations/20261024100100_add_account_archives.ts:64-67` defines a partial index with varchar status IN ('queued','running'). Its dump prints an ANY(array) expression with varchar/text casts. Re-loading and deparsing that dump does not preserve identical expression text. Historical `fb5ad3b92` replaces IN with two OR-ed equalities and regenerates both dumps; inspect its diff for the exact expression. The defect is in a textual schema-round-trip invariant, not proof that PostgreSQL's logically equivalent index predicate changes behavior.

**Why two failures:** same tree/PG path reproducibly violates the comparison; there is no established random trigger. SQLite uses different schema rendering and can pass. A succeeding later SHA does not make the earlier mismatch flaky.

**Permanent fix/status:** already uses explicit equalities that round-trip, with regenerated SQLite/PG dumps. Keep schema drift/type checks. A future general schema comparator may canonicalize proven-equivalent expressions, but blindly stripping casts weakens a valuable guard and should not replace this narrow fix.

**Proof:** in a disposable local PG database apply the historical migration, inspect indexdef, dump/reload, inspect again and compare. Then repeat the fixed migration on supported PG versions. Run only the baseline named test using the network-blocked command below and local test DB variables. No schema files were changed and no PG instance was started here.

## 3. Dependabot / Yarn workspaces

### Nodemailer YN0028 (22 jobs, one broken update on two events)

**Observed:** `package.json:6-8` defines one Yarn project with `packages/*`; `:170` pins Yarn 4.18.1. There is one root yarn.lock and no workspace-local lockfiles. `.github/dependabot.yml:3-6` already configures npm updates at `/`; it is not six independent package projects. The six manifests are cloudtasks, nodemailer, pg, qstash, resend and ses. Current `yarn.lock:16-21` has a soft workspace entry whose dependency descriptor must match `packages/nodemailer/package.json:8`; the hard package resolution is at `yarn.lock:6211-6213`.

The supplied 22 failures are **not 22 intermittent installs**: they are the same inconsistent commit fanned out over 11 jobs and two events. Immutable installation correctly refused to rewrite the lock. The merged fix `d08f6e835` changes all three relevant pieces: package manifest, the root lock's `@activities/nodemailer@workspace:packages/nodemailer` dependency descriptor, and the hard nodemailer version/resolution/checksum. Changing only the hard package entry is insufficient.

**Confidence:** high for manifest/root-lock inconsistency and deterministic failure. The actual failed object `c017582` is not present locally (`git show` reports invalid object), and no complete lockfile diff or Dependabot updater log is supplied. Consequently I cannot establish whether this was a Dependabot workspace-updater defect, stale concurrent update, or an incomplete generated/manual commit. The path in a Dependabot branch name does not prove it ran with the wrong project root.

**Permanent functional fix:** every dependency bump in **any** `packages/*/package.json` must regenerate the **root** Yarn lock using the pinned Yarn version, including workspace soft entries and resolved packages, and pass a root immutable install before publication. Preserve the root workspace model; do not create child lockfiles or disable immutable checks. Existing better-auth/react/AWS groups address coordinated versions/type compatibility, not a guarantee that workspace lock serialization is correct. The cooldown is unrelated to YN0028.

**Dependabot YAML answer — evidence limit:** no non-disabling YAML-only change is established from the available evidence. In particular, I would **not claim that replacing the current `directory: '/'` with `directories: ['/', '/packages/*']` is a proven fix**: Yarn workspaces already belong to the root project, and treating them as additional projects can generate overlapping update work without repairing a missed workspace descriptor. Nor would an unrelated all-dependencies group guarantee a correct lockfile. A root-scoped group containing all workspace dependencies can reduce independently proposed coupled updates, but it is not proof against this failure class.

If the requirement is literally to stop these workspace version PRs immediately until the updater is verified, an explicit temporary `ignore` policy in the existing npm block can suppress the union of workspace dependency names:

```yaml
    # Temporary containment; disables these automatic updates, not a lockfile fix.
    ignore:
      - dependency-name: '@google-cloud/tasks'
      - dependency-name: 'nodemailer'
      - dependency-name: '@types/nodemailer'
      - dependency-name: 'pg'
      - dependency-name: '@types/pg'
      - dependency-name: '@upstash/qstash'
      - dependency-name: 'resend'
      - dependency-name: '@aws-sdk/client-ses'
```

This is intentionally labelled containment, not the desired permanent updating solution. It also affects a root dependency of the same name, and a new workspace/dependency requires updating the union. Security-update policy is a separate repository setting and must be checked rather than assumed covered by version-update containment. I have not applied this policy. The requested **verified, continuing-update dependabot.yml prevention remains unresolved** without reproducing the original updater behavior.

**Proof of a real fix:** replay the updater against the failed manifest/root-lock pair with the proposed config, then run root `yarn install --immutable` for the generated PR before considering it valid. Repeat with at least one dependency bump from each workspace, including dev dependencies and an AWS dependency that also participates in a group. Require no new nested yarn.lock and inspect each changed workspace's soft-entry descriptor. Mutation: change a workspace's package version constraint while leaving its root soft-entry descriptor old; immutable install must deterministically fail YN0028. Repair through root Yarn and verify immutable succeeds. Keep YN0028 on the no-retry list. These install/updater experiments were **not run** because external network use is forbidden here and the failing commit is unavailable.

## Suite-wide guards

1. **Async work must have an owner and a join.** Use a test-visible deferred/gate for reaching an async stage, await operations started by timers, abort/dispose on unmount, and await settled work before resetting mocks, globals, channels or DBs. Add an unmount-before-resolution matrix for DraftsProvider. Catch-and-ignore of unhandled errors or filtering unrelated events is not a lifecycle assertion.
2. **Separate fake application time from real I/O.** Advance only after the application enters its sleep/lease stage. Use injectable clock/sleep or deferred completion, not a budget of setImmediate turns. Assert both sides of timeout/lease boundaries and no owned timers remain after cleanup. Always restore timers in finally. Do not globally drain every pending timer: that can execute new work and mask a leak.
3. **Assert the state the next action needs.** Enabled button before clicking; focus/scroll predicate for passive effects; clicks outside waitFor so polling cannot submit repeatedly. Distinguish legitimate effect-aware tests from production stale-state races (Gallery must support the fast next click).
4. **Deliberate fixture ordering.** Pin clocks and IDs only where order is contractual; test tied keys explicitly. Promise.all positional results preserve input order, shared pushes do not. Test reverse completion with deferred promises, not real sleeps. Avoid random UUID ordering assumptions in page assertions.
5. **Use cheap valid cryptographic fixtures.** Fixed valid keys and cost-4 bcrypt hashes for tests not about key generation/hashing strength; preserve real verification. Keep security-strength behavior in dedicated tests. Measure setup/import versus action time, cap concurrency based on CPU/DB capacity, and keep file-level isolation.
6. **Deny unintended network at the suite boundary.** Current `test/setup/vitest.setup.ts:13-15` defaults fetch mocks to real passthrough, so local tests can unknowingly depend on external services. Use the proven preload or equivalent default-deny network guard in CI, allowing only explicitly provisioned loopback databases/services. Assert mocks were actually used. Do not mistake network blocking failures for application flakes.
7. **Preserve hard error signals.** Leave Vitest unhandled-error failures enabled; no retries/allow-failure on tests, no catching all failures into success. Upload original assertion diffs, test file/name, seed, durations, exit/signal and worker identity. A zero-code queued infrastructure failure is not the same as a timed-out test.
8. **Stress must fail on the first failure.** Use repeated focused files and reproducible seeds in a diagnostic lane, not automatic CI retries that report only the last pass. Include full-file runs for order/leak suspects; focused `-t` runs omit predecessor contamination. Track first-attempt failures even after an authorized infrastructure rerun.
9. **Cross-backend and schema round-trip coverage.** PG poll/lease tests must use real local PG as well as SQLite; retain migrations-versus-dump checks and supported-PG-version coverage. Do not normalize away semantic schema differences merely to suppress deparser noise. Generate the Kysely types whenever schema changes.
10. **Workflow/Dependabot policy checks.** Guard exact required job names and fail-closed aggregate behavior, one PR event path, explicit job timeouts, immutable installs and retry exclusions. Validate root workspace/lock consistency for all manifests; a guard that only mentions nodemailer misses the class. Preserve coordinated auth/React/AWS update groups.

## Reproduction and verification commands

All test commands in this investigation used the following form. This function is a reusable **future** repeat command (it writes no test source and stops at the first failure); run only listed files, never substitute the full suite:

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
repeat_file() {
  test_file="$1"
  shift
  for iteration in $(seq 1 30); do
    NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" \
      yarn vitest run "$test_file" --maxWorkers=1 --no-cache "$@" || return $?
  done
}
repeat_file lib/components/sign-out/SignOutDialog.test.tsx
repeat_file lib/components/drafts/DraftsProvider.test.tsx
repeat_file lib/components/drafts/DraftsProvider.queue.test.tsx
repeat_file lib/components/section-nav-dropdown.test.tsx
repeat_file lib/jobs/createPollJob.test.ts
repeat_file lib/jobs/noteTags.test.ts
repeat_file lib/components/settings/profile/ProfileEditor.test.tsx -t 'tells the person to reload'
repeat_file 'app/api/v1/fitness-files/[id]/primary/route.test.ts'
repeat_file app/api/v1/accounts/route.test.ts -t 'on an added domain'
repeat_file lib/components/drafts/DraftEditor.integration.test.tsx
repeat_file lib/components/privacy-locations/PrivacyLocationsEditor.test.tsx -t 'scrolls the save error'
repeat_file lib/jobs/bulkImportJob.test.ts -t heartbeat
repeat_file lib/services/exports/accountExports.test.ts
repeat_file 'app/(timeline)/gallery/media/GalleryAllMediaView.test.tsx' -t 'deselects the day including'
repeat_file lib/services/auth/credentialIdentity.test.ts
```

For PG-specific proofs, provision a **disposable local-only** PG separately; set TEST_DATABASE_TYPE=pg, TEST_DATABASE_HOST=127.0.0.1 and explicit local port/user/password for the same network-blocked commands. Do not point at shared/remote databases or run concurrent independent Vitest processes against the same worker database names. The migration comparison command is:

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
NODE_OPTIONS="--require /Users/llun/Documents/llun/ci-flakes/tools/block-network.cjs --no-warnings" \
  yarn vitest run lib/database/migrate/index.test.ts --maxWorkers=1 --no-cache -t 'loads the baseline'
```

Set the local PG variables before that command; its default SQLite run is not proof of PG expression round-tripping. The deferred mutations described per item are stronger evidence than repeated fast passes. They require a future authorized edit/test harness; none were applied to tracked files here.

## Execution evidence (current HEAD only)

Observed initial network-blocked runs:

| File / filter | Result | Wall time |
|---|---:|---:|
| SignOutDialog.test.tsx, entire file | 19 passed | 1.73s |
| createPollJob.test.ts, entire file, default SQLite | 21 passed | 1.28s |
| GalleryAllMediaView.test.tsx, entire file | 93 passed | 4.77s |
| credentialIdentity.test.ts, entire file, default SQLite | 9 passed | 5.91s |
| ProfileEditor.test.tsx, reload case | 1 passed, 67 skipped by filter | 1.36s |

Additional executions and final limitations are appended below. No pass above proves a historical intermittent failure impossible. No full suite, build, migration CLI, dev server, external network, or mutation experiment was run.


Additional network-blocked runs, all at the same HEAD with `--maxWorkers=1 --no-cache`:

| File / filter | Result | Wall time |
|---|---:|---:|
| fitness-files/[id]/primary/route.test.ts, entire file, SQLite | 30 passed | 3.16s |
| bulkImportJob.test.ts, heartbeat filter, SQLite | 6 passed, 32 skipped by filter | 3.29s |
| accountExports.test.ts, entire file, SQLite | 17 passed | 3.01s |
| DraftEditor.integration.test.tsx, entire file | 9 passed | 10.93s |
| PrivacyLocationsEditor.test.tsx, scroll case | 1 passed, 12 skipped by filter | 0.959s |
| accounts/route.test.ts, added-domain group | 3 passed, 37 skipped by filter | 0.686s |
| section-nav-dropdown.test.tsx, entire file | 33 passed | 2.92s |
| DraftsProvider.queue.test.tsx, entire file | 44 passed | 4.98s |

Total observed: **13 focused file invocations, 286 tests passed**, no failed test or unhandled error reported. Node was verified as v24.15.0; Vitest reported v5.0.5. Some independent file invocations ran concurrently (default SQLite only), which is modest host contention, not a controlled stress proof. No repeated-run or mutation success is claimed.

Two additional test-harness gaps observed during final verification: `DraftsProvider.queue.test.tsx:131-142` uses two real 15ms sleeps as a generic settle helper, so its green result does not prove every producer is quiescent. `section-nav-dropdown.test.tsx:412-454` uses a real 350ms sleep after unmount; current cleanup can cancel the callback before its detached-document guard is exercised. Replace these with explicit completion barriers and a captured late callback/fake-clock test, respectively, consistent with the suite-wide guards.

## Outstanding evidence / work not completed

- Exact provider-side cause of SIGHUP/queued abandonment/action resolution/zero-job startup failures; the available evidence locates failure boundaries but not the GitHub internal fault. Docker readiness also needs original container diagnostics before classification.
- CredentialIdentity's historical timeout attribution: no run ID or timed-out operation is in the inventory; expensive RSA/bcrypt fixture setup is traced, but the actual timeout stage was not reproduced.
- A **verified Dependabot YAML change that keeps updating all workspaces and prevents malformed lockfiles**: current root config already represents the shared Yarn project, failed commit/updater logs are unavailable, and updater/network experiments were forbidden. Do not represent the containment policy above as that fix.
- PostgreSQL reproductions and deterministic mutations were specified but not executed; no local PG service was provisioned. Historical failures were established through source/history, not by changing this read-only checkout.
- No new fix was implemented. The provider lifecycle concern is source-traced and remains a proposed fix with a deterministic acceptance test, not a delivered repair.

Final repository verification: `git diff --stat` was empty and `git status --short` showed only untracked `ci-flakes-out/`. No tracked file was changed.
