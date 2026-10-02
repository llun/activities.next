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

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state
  })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('SessionKeepAlive', () => {
  beforeEach(() => {
    vi.mocked(refreshAuthSession).mockReset()
    vi.mocked(refreshAuthSession).mockResolvedValue(undefined)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes the session once when it mounts', () => {
    render(<SessionKeepAlive />)

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })

  it('refreshes again when the tab becomes visible only once the interval has passed', () => {
    render(<SessionKeepAlive />)

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS - 1)
    setVisibility('visible')
    expect(refreshAuthSession).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    setVisibility('visible')
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)
  })

  it('does not refresh when the tab is hidden', () => {
    render(<SessionKeepAlive />)

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS)
    setVisibility('hidden')

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<SessionKeepAlive />)
    unmount()

    vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS)
    setVisibility('visible')

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })
})
