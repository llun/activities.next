/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from '@testing-library/react'

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

const changeVisibility = async (state: DocumentVisibilityState) => {
  setVisibilityState(state)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

const triggerOnline = async () => {
  await act(async () => {
    window.dispatchEvent(new Event('online'))
  })
}

const advanceTime = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

const renderComponent = async () => {
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(<SessionKeepAlive />)
  })
  return result!
}

describe('SessionKeepAlive', () => {
  beforeEach(() => {
    vi.mocked(refreshAuthSession).mockReset()
    vi.mocked(refreshAuthSession).mockResolvedValue(true)
    setVisibilityState('visible')
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    // The override is an own property of `document`; deleting it restores
    // jsdom's prototype getter for the next test.
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('refreshes the session once when it mounts', async () => {
    await renderComponent()

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })

  it('refreshes on the interval while the tab stays visible', async () => {
    await renderComponent()

    await advanceTime(SESSION_REFRESH_INTERVAL_MS - 1)
    expect(refreshAuthSession).toHaveBeenCalledTimes(1)

    await advanceTime(1)
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)

    await advanceTime(SESSION_REFRESH_INTERVAL_MS)
    expect(refreshAuthSession).toHaveBeenCalledTimes(3)
  })

  it('does not refresh when the tab becomes visible before the interval has passed', async () => {
    await renderComponent()

    await advanceTime(SESSION_REFRESH_INTERVAL_MS - 1)
    await changeVisibility('visible')

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })

  it('skips a tick while hidden and refreshes once the tab becomes visible', async () => {
    await renderComponent()
    setVisibilityState('hidden')

    await advanceTime(SESSION_REFRESH_INTERVAL_MS)
    expect(refreshAuthSession).toHaveBeenCalledTimes(1)

    await advanceTime(1)
    await changeVisibility('visible')
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)

    // That refresh resets the refresh window, so returning to the tab again
    // inside it does not refresh a second time.
    await advanceTime(SESSION_REFRESH_INTERVAL_MS - 2)
    await changeVisibility('hidden')
    await changeVisibility('visible')
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)
  })

  it('immediately retries on the online event when initial mount refresh failed', async () => {
    vi.mocked(refreshAuthSession).mockResolvedValueOnce(false)
    await renderComponent()

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)

    // Since initial refresh failed, lastRefreshAt is still 0.
    // When the browser reconnects (online event), it should refresh immediately!
    vi.mocked(refreshAuthSession).mockResolvedValueOnce(true)
    await triggerOnline()

    expect(refreshAuthSession).toHaveBeenCalledTimes(2)

    // Now that it succeeded, another online event within the interval does not trigger another refresh
    await triggerOnline()
    expect(refreshAuthSession).toHaveBeenCalledTimes(2)
  })

  it('does not refresh on the online event when tab is hidden', async () => {
    vi.mocked(refreshAuthSession).mockResolvedValueOnce(false)
    await renderComponent()
    setVisibilityState('hidden')

    await triggerOnline()
    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })

  it('stops refreshing once unmounted', async () => {
    const { unmount } = await renderComponent()
    unmount()

    await advanceTime(SESSION_REFRESH_INTERVAL_MS)
    await changeVisibility('visible')
    await triggerOnline()

    expect(refreshAuthSession).toHaveBeenCalledTimes(1)
  })
})
