import { act, screen } from '@testing-library/react'
import { vi } from 'vitest'

// The suite fakes setTimeout; this one stays real.
const realSetTimeout = globalThis.setTimeout

/**
 * Waits for text in real time while a fake clock stands still. Testing
 * Library's `findByText`/`waitFor` budget is counted on the fake clock (each
 * poll advances it, roughly one event-loop turn per tick), so it can run out
 * in well under a real second on a loaded machine — too tight for the real
 * IndexedDB work a save's completion is. Only for suites that install fake
 * timers.
 *
 * `advancePerPoll` also moves the fake clock per poll, for a wait whose work
 * is armed as a fake timer that must fire along the way: a save the provider
 * refused while its epoch was still loading is re-armed as a debounce, which
 * no amount of real time alone will run. An advancing poll already yields a
 * real event-loop turn per `act`, so it needs no 20 ms pad; a standing-still
 * poll keeps the pad so a failure path does not spin hot.
 */
export const findInRealTime = async (
  text: string,
  {
    timeout = 10_000,
    advancePerPoll = 0
  }: { timeout?: number; advancePerPoll?: number } = {}
) => {
  const deadline = performance.now() + timeout
  const pad = advancePerPoll ? 0 : 20
  for (;;) {
    const el = screen.queryByText(text)
    if (el) return el
    if (performance.now() > deadline) return screen.getByText(text)
    await act(async () => {
      if (advancePerPoll) await vi.advanceTimersByTimeAsync(advancePerPoll)
      await new Promise<void>((r) => realSetTimeout(r, pad))
    })
  }
}
