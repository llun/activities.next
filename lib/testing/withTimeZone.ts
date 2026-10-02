/**
 * Runs `callback` with the process's time zone moved to `timeZone`, then puts
 * the previous zone back. For the rare test whose subject must not depend on
 * the machine's zone and can only be shown not to by running it in a non-UTC
 * one — the suite itself is pinned to UTC (`vitest.config.ts`).
 *
 * Node applies an assignment to `process.env.TZ` on the main thread only: on a
 * worker thread the variable changes and `Date` keeps its zone, so the test
 * would pass without having tested anything. `vitest.config.ts` therefore
 * routes every test file that calls this helper to its forked-process project,
 * and the helper throws if the zone did not move rather than run the callback
 * in the wrong one.
 */
export const withTimeZone = async <T>(
  timeZone: string,
  callback: () => T | Promise<T>
): Promise<T> => {
  const originalTimeZone = process.env.TZ
  process.env.TZ = timeZone

  try {
    const appliedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (appliedTimeZone !== timeZone) {
      throw new Error(
        `withTimeZone could not move the time zone to "${timeZone}" (it is "${appliedTimeZone}"). ` +
          'Either the name is not an IANA time zone, or this file is running on a worker thread, ' +
          'where Node ignores process.env.TZ: vitest.config.ts routes a test file to the forked-process ' +
          'project when its source contains a `withTimeZone(` call.'
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
