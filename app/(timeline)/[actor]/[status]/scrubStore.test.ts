/** @vitest-environment jsdom */
import { createScrubStore } from './scrubStore'

describe('scrubStore', () => {
  it('notifies subscribers of a change, and only of a change', () => {
    const store = createScrubStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set(12)
    store.set(12)
    expect(store.get()).toBe(12)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.set(null)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
