/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react'

import { refreshAuthSession } from '@/lib/client'

import {
  SESSION_REFRESH_INTERVAL_MS,
  SessionKeepAlive
} from './session-keep-alive'

vi.mock('@/lib/client', () => ({
  refreshAuthSession: vi.fn()
}))

const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state
  })
}

const changeVisibility = (state: DocumentVisibilityState) => {
  setVisibilityState(state)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('SessionKeepAlive', () => {
  beforeEach(() => {
    vi.mocked(refreshAuthSession).mockReset()
    vi.mocked(refreshAuthSession).mockResolvedValue(undefined)
    setVisibilityState('visible')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    // The override is an own property of `document`; deleting it restores
    // jsdom's prototype getter for the next test.
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('refreshes the session once when it mounts', () => {
    render(<SessionKeepAlive />)

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })

  it('refreshes on the interval while the tab stays visible', () => {
    render(<SessionKeepAlive />)

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS - 1)
    expect(refreshAuthSession).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS)
    expect(refreshAuthSession).toHaveBeenCalledTimes(3)
  })

  it('does not refresh when the tab becomes visible before the interval has passed', () => {
    render(<SessionKeepAlive />)

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS - 1)
    changeVisibility('visible')

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })

  it('skips a tick while hidden and refreshes once the tab becomes visible', () => {
    render(<SessionKeepAlive />)
    setVisibilityState('hidden')

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS)
    expect(refreshAuthSession).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    changeVisibility('visible')
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)

    // That refresh restarts the interval, so returning to the tab again
    // inside it does not refresh a second time.
    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS - 2)
    changeVisibility('hidden')
    changeVisibility('visible')
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)
  })

  it('stops refreshing once unmounted', () => {
    const { unmount } = render(<SessionKeepAlive />)
    unmount()

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS)
    changeVisibility('visible')

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })
})
