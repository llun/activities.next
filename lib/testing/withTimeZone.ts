import { isMainThread } from 'node:worker_threads'

/**
 * Runs `callback` with the process's time zone moved to `timeZone`, then puts
 * the previous zone back. For the rare test whose subject must not depend on
 * the machine's zone and can only be shown not to by running it in a non-UTC
 * one — the suite itself is pinned to UTC (`vitest.config.ts`).
 *
 * Node applies an assignment to `process.env.TZ` on the main thread only: on a
 * worker thread the variable changes and `Date` keeps its zone, so the test
 * would pass without having tested anything. `vitest.config.ts` therefore
 * routes every test file that imports this helper to its forked-process
 * project, and the helper throws if the zone did not move rather than run the
 * callback in the wrong one.
 *
 * Pass an exact-case IANA name. An alias (`Asia/Kolkata`) works because the
 * applied zone is compared with the canonical form of the request; case
 * variants, offsets and the bare `GMT` are not read by Node's `TZ` and are
 * rejected. The helper imports nothing from the project (only `node:`
 * builtins), so a bare worker can load it through Node's type stripping.
 */
export const withTimeZone = async <T>(
  timeZone: string,
  callback: () => T | Promise<T>
): Promise<T> => {
  // Throws a RangeError for a name Intl does not recognise. It has to run
  // before TZ is assigned, so a bad name leaves the process's zone alone.
  const canonicalTimeZone = new Intl.DateTimeFormat('en-US', {
    timeZone
  }).resolvedOptions().timeZone

  const originalTimeZone = process.env.TZ
  process.env.TZ = timeZone

  try {
    const appliedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (appliedTimeZone !== canonicalTimeZone) {
      throw new Error(
        `withTimeZone could not move the time zone to "${timeZone}" (it is "${appliedTimeZone}"). ` +
          (isMainThread
            ? 'Node reads process.env.TZ only as an exact-case IANA name ' +
              '(Europe/Amsterdam, not europe/amsterdam; UTC, not GMT) and ' +
              'ignores an offset such as +05:30.'
            : 'This file is running on a worker thread, where Node ignores process.env.TZ: ' +
              'vitest.config.ts routes a test file to the forked-process project when it ' +
              'imports lib/testing/withTimeZone.')
      )
    }
    return await callback()
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTimeZone
    }
  }
}
