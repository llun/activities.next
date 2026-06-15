import { vi } from 'vitest'

// A few third-party test utilities still probe for a global `jest`:
//   - jest-fetch-mock uses `jest.fn` (and `jest.setMock`/`jest.dontMock`).
//   - @testing-library/dom detects fake timers via `typeof jest !== 'undefined'`
//     and then calls `jest.advanceTimersByTime`.
// Forward everything to Vitest's `vi` (bound so methods keep their receiver),
// with node-fetch module (un)mocking as no-ops since the app never uses it.
// Installed before jest-fetch-mock is imported (first entry in setupFiles).
const overrides: Record<string, unknown> = {
  setMock: () => {},
  dontMock: () => {}
}

const jestShim = new Proxy(overrides, {
  get(target, prop: string) {
    if (prop in target) return target[prop]
    const value = (vi as unknown as Record<string, unknown>)[prop]
    return typeof value === 'function' ? value.bind(vi) : value
  },
  has() {
    return true
  }
})

;(globalThis as typeof globalThis & { jest?: unknown }).jest = jestShim
