# Follow-up flakes: migrate SQLite, fediverseInterop, routeMap (Opus analysis)

I checked all three at `origin/main` c7105d3 and reproduced each failure locally. The tree is unchanged.

**1. `lib/database/migrate/index.test.ts` (SQLite): a slow disk, not a lock or a hang. Confidence: high**
- **No wait path exists.**
  - `withSqliteRunLock` reads the lock row once and throws straight away (`lib/database/migrate/index.ts:179-180, 211`). There is no poll or retry.
  - Each test gets its own file inside a `mkdtemp` folder (`index.test.ts:186, 206`), and `afterEach` destroys the connection (`:215`). No second connection is opened in these tests, so better-sqlite3's busy timeout never comes into play.
  - The file uses no fake timers.
- **The tests finished; they did not hang.** They took 49370 ms and 48395 ms against a 30000 ms limit. A real hang would report about 30000 ms. Vitest (`withTimeout`, the #2920 comment in `vitest/dist/chunks/run.BPv-BBRv.js:3299`) flags a test that resolves after its deadline. So the worker thread got no timer turn for over 19 s, which is what synchronous better-sqlite3 calls blocked in fsync look like.
- **The job log points at the disk:**
  - On that runner, `yarn install`'s Link step took **53.8 s**. Green shard-4 jobs (124176563397, 124169298640) took 6–7 s.
  - In the slow window, the median file ran at 1.06× its green time, so CPU was fine. The two files that write real files were the outliers: migrate at 21× and `lib/services/medias/localFile.test.ts` at 8.7× (7045 ms against 809 ms).
- **What these tests write:** strace shows 416 fsyncs and 133 journal unlinks for the 4 empty-database tests. With `journal_mode=DELETE`, every commit creates the journal file, fsyncs and unlinks it.
- **Why the earlier pragma test misled:** fsync costs about 60 µs on a healthy disk, so going from 70 ms to 52 ms measured the wrong situation.
- **Reproduced:** `strace -f -e inject=fsync:delay_exit=250000 -e inject=fdatasync:delay_exit=250000 yarn vitest run lib/database/migrate/index.test.ts -t "an empty database"` gives the same signature: 33.6 s, 35.7 s and 36.7 s, all "Test timed out in 30000ms". Under the same injection, the existing in-memory test takes 268 ms. A 40-commit better-sqlite3 script takes 40 s with default pragmas and 49 ms with `journal_mode=MEMORY; synchronous=OFF`.
- **Fix:** run every test that doesn't need a file on `:memory:` (`getTestDatabaseConfig('sqlite')`). Keep a file only for the tests that open a second connection on it ("refuses a second run…", "keeps the lock a killed run left…"), and set `PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF` there.
- **Proof:** the same strace injection run 10 times; every run should stay under 5 s.
- **The ordering question is a test problem, not a production bug.**
  - Kysely records `new Date().toISOString()` (millisecond precision) and sorts ties by name (`node_modules/kysely/dist/migration/migrator.js:488-492, 575`). `readExecutedMigrations` matches that with `order by timestamp asc, name asc` (`status.ts:43`).
  - Within one run, pending migrations run in name order, so a tie sorts the same as the run order.
  - A tie across runs needs two separate `yarn migrate` processes in the same millisecond, which can't happen in practice.
  - The test at `:626` runs twice back-to-back. Once runs got fast, the two landed in the same millisecond.
  - **Test fix:** `vi.useFakeTimers({ toFake: ['Date'] })`, then `vi.setSystemTime(t)` before the first run and `t + 1000` before the second.
  - **Optional:** pass a binary `nameComparator` to the Migrator so its tie-break matches SQL `name asc` exactly. `localeCompare` and binary order disagree on `_` against digits.

**2. `app/api/inbox/fediverseInterop.test.ts:261`: real 4096-bit RSA key generation. Confidence: high**
- Each test starts with a new database that has no instance actor. The misskey actor isn't seeded either, so `recordActorIfNeeded` (`lib/actions/utils.ts:327-328`) calls `getFederationSigningActor` → `createSigningActor`, which runs `generateKeyPair` (`lib/database/domains/actor/federationSigner.ts:106`, 4096-bit at `lib/utils/signature.ts:157`).
- That runs on the libuv threadpool, which every worker thread in the process shares. On an idle machine, 20 key generations took 52 to 1377 ms. With CPUs heavily oversubscribed (load average ~87) and the pool queued, 30 s is reachable.
- Locally, tests that make a key take 0.5–3.5 s; tests that don't take 74–340 ms.
- **Fix:** in `test/setup/vitest.setup.ts`, mock `generateKeyPair` across the suite to return `MOCK_PUBLIC_KEY`/`MOCK_PRIVATE_KEY` from `lib/stub/actor.ts`. That key is already encrypted with the tests' `MOCK_SECRET_PHASES`. `signature.test.ts` would opt out with `vi.importActual`.
- **Proof:** a spy asserting `generateKeyPair` is never called in this file. Then 20 repeated runs on one core (`taskset -c 0`, plus busy loops) should keep every test under about 300 ms.

**3. `FitnessStatusDetail.routeMap.test.tsx` "route privacy hint": a 1 s `waitFor` limit. Confidence: high**
- `renderWithGlMap` waits with `waitFor(() => expect(MapConstructor).toHaveBeenCalled())` (`:191`), which gives up after Testing Library's default 1000 ms. Nothing in setup configures `asyncUtilTimeout`.
- Before the map is built, several render and effect cycles have to finish: the fitness-files fetch, the route-data fetch, then the `ActivityMapPanel` effect's `await loadModule()` (`ActivityMapPanel.tsx:431`). There's no dynamic import on this path.
- When it's idle, the first, cold test needs 260 ms.
- **Reproduced:** on one core shared with 6 busy loops, "adds an invisible wide hit layer" failed after 2587 ms with exactly "expected "vi.fn()" to be called at least once".
- **Fix:** take the arbitrary 1 s limit out. Have `MapConstructor` resolve a deferred promise when it's called, and `await act(() => constructed)`. The wait is then bounded only by the 30 s test limit.
- **Note:** `plan.md:739` rejected a suite-wide `asyncUtilTimeout` because no observed failure called for it. This is that failure, so the decision is worth revisiting as a backstop.
- **Proof:** the same one-core command, 20 runs, with zero failures.