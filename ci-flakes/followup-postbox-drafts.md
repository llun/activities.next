# post-box.drafts "Saved to Drafts" flake (Opus analysis)

**Root cause (high confidence on the mechanism, reproduced; medium-high that the slow step is the cold import)**

1. **The "4000 ms" timeout is counted on the fake clock.** `beforeEach` fakes `setTimeout` (`post-box.drafts.test.tsx:192`). `test/setup/jest-global.ts:26` installs a `jest` shim, so `@testing-library/dom` sees the fake timers and takes its fake-timer path (`node_modules/@testing-library/dom/dist/wait-for.js:39-76`). On that path the overall timeout is a fake `setTimeout`, and each loop does `jest.advanceTimersByTime(50)` inside `act`, which yields roughly one `setImmediate` turn. So `configure({ asyncUtilTimeout: 4000 })` (`:186`) is really about 80 event-loop turns, which is only a few hundred real ms. The comment on that line ("loaded machine") is wrong under fake timers.
2. **The chain to "Saved to Drafts" has a step that runs off-thread and doesn't speed up with turns.** The chain is: `send.reject` → `keep`/`handOff` → `saveNow` (fake-indexeddb, in-thread, `setImmediate`) → `notifySavedToDrafts` → `setSaved` → the `next/dynamic` `SavedToDraftsNote` (`DraftsProvider.tsx:118-124`, rendered at `:640`). The test at `:352` is the first in the file to mount that note, so `import('@/lib/components/drafts/SavedToDraftsNote')` is cold. That module is fetched and transformed by Vitest's main thread over RPC, and under load with 4 workers that request queues up. The test at `:386` runs next and waits on the same pending loader promise, so both fail. The later identical waits (`:647`, `:730`) find the module cached and pass.

**Reproduction.** Done on a scratch copy; the repo was not touched. CPU contention (10 busy loops plus vitest pinned to one core with `taskset`) passed 3 of 3: it slows the worker and the transforms equally, so it doesn't change the ratio. A real delay in the note's loader (`node:timers/promises` `setTimeout(N)` before the `import()`) does reproduce it:
- 0 ms: 65/65 pass. The note appears after 150–250 fake ms, about 35 real ms.
- 300 ms: `:352` fails with exactly `Unable to find an element with the text: Saved to Drafts`, after about 395 ms of real time. The 4 s budget runs out in under 0.4 s.
- 800 ms: both tests fail, which is exactly the pair you saw.

**PR #2691 doesn't change this.** `liveRef` only guards drain, wake and broadcast work after unmount. These tests rerender rather than unmount, and the note comes from `setSaved` plus the lazy import, which `liveRef` doesn't touch.

**Permanent fix (not a timeout bump)**
1. Warm the lazy module in the test file, the same way `post-box-media.testUtils.tsx:25-30` already does for `MediaDetailsDialog`: `beforeAll(async () => { await import('@/lib/components/drafts/SavedToDraftsNote') })`.
2. For outcomes that need no clock, wait in real time and hold the fake clock still. Add a helper (`realSetTimeout` is already at `:61`):
   ```ts
   const findInRealTime = async (text: string, timeout = 10_000) => {
     const deadline = performance.now() + timeout
     for (;;) {
       const el = screen.queryByText(text); if (el) return el
       if (performance.now() > deadline) return screen.getByText(text)
       await act(() => new Promise<void>((r) => realSetTimeout(r, 20)))
     }
   }
   ```
   Use it at `:377`, `:417`, `:647` and `:730`. With it, the note showed up at fake=0, so this chain needs no fake time. That also makes the assertion stricter: the note's 6 s auto-dismiss (`SavedToDraftsNote.tsx:17,46`) can't fire during the wait.
   - With the helper, both tests pass even with a 3000 ms loader delay (65/65).
   - The longer-term option is CONTRIBUTING.md:352: install fake timers only around the action that arms the timer. That would mean restructuring the file that #2686 just sped up.

**Proof command.** Make the loader in `DraftsProvider.tsx:118-124` read `import('node:timers/promises').then((t) => t.setTimeout(Number(process.env.NOTE_DELAY ?? 0))).then(() => import('@/lib/components/drafts/SavedToDraftsNote'))`, then run `NOTE_DELAY=800 unshare -rn npx vitest run lib/components/post-box/post-box.drafts.test.tsx`. Main fails these 2 tests and the fix passes. Then run without the mutation using `--repeat=20`.

**Other tests in the file with the same pattern.** Every `findBy*`/`waitFor` in the file (e.g. `waitForSaved` at `:140`, the `storedDrafts()` polls) has the same turn-counted budget. Only the four "Saved to Drafts" waits also depend on an off-thread step, and only the first two are cold when the file runs in order. Run with `-t` to isolate `:647` or `:730` and they would be cold too. "Couldn’t save to Drafts" (`:669`) uses `NotSavedToDraftsNote`, which is statically imported, so it isn't exposed.

The instrumented scratch copy is at `/tmp/claude-0/-home-user/76e3cb58-dd24-51b8-9043-a99b6e67db38/scratchpad/repo`.