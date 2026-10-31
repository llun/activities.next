/**
 * @vitest-environment jsdom
 */
import {
  ONLINE_CONNECTION_SNAPSHOT,
  PROBE_BACKOFF_MS,
  PROBE_TIMEOUT_MS,
  getConnectionSnapshot,
  onConnectionRestored,
  probeNow,
  reportRequestFailure,
  resetConnectionForTesting,
  subscribeConnection
} from '@/lib/client/connection'
import { checkServerHealth } from '@/lib/client/health'

vi.mock('@/lib/client/health', () => ({ checkServerHealth: vi.fn() }))

const mockHealth = vi.mocked(checkServerHealth)

const setOnLine = (value: boolean) => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}
const setVisibility = (value: 'visible' | 'hidden') => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value)
}

// A health check that never answers until its signal aborts.
const hangUntilAborted = ({ signal }: { signal?: AbortSignal } = {}) =>
  new Promise<boolean>((_resolve, reject) => {
    signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError'))
    )
  })

describe('connection store', () => {
  beforeEach(() => {
    resetConnectionForTesting()
    mockHealth.mockReset()
    setOnLine(true)
    setVisibility('visible')
  })

  afterEach(() => {
    resetConnectionForTesting()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts online and keeps the same snapshot object when a probe succeeds', async () => {
    mockHealth.mockResolvedValue(true)
    const before = getConnectionSnapshot()

    await probeNow()

    expect(before).toBe(ONLINE_CONNECTION_SNAPSHOT)
    expect(getConnectionSnapshot()).toBe(before)
  })

  it('is offline when the probe fails with navigator.onLine false', async () => {
    mockHealth.mockRejectedValue(new TypeError('Failed to fetch'))
    setOnLine(false)

    reportRequestFailure(new TypeError('Load failed'))
    await probeNow()

    expect(getConnectionSnapshot().state).toBe('offline')
  })

  it('is unreachable when the probe fails with navigator.onLine true', async () => {
    mockHealth.mockRejectedValue(new TypeError('Failed to fetch'))

    reportRequestFailure(new TypeError('Failed to fetch'))
    await probeNow()

    expect(getConnectionSnapshot().state).toBe('unreachable')
  })

  it('is unreachable when /health answers non-ok', async () => {
    mockHealth.mockResolvedValue(false)

    await probeNow()

    expect(getConnectionSnapshot().state).toBe('unreachable')
  })

  it('stays online when a failed request triggers a probe that succeeds', async () => {
    mockHealth.mockResolvedValue(true)

    reportRequestFailure({ status: 503 })
    await probeNow()

    expect(mockHealth).toHaveBeenCalledTimes(1)
    expect(getConnectionSnapshot().state).toBe('online')
  })

  it.each([
    ['a TypeError', new TypeError('Load failed')],
    ['an AbortError', new DOMException('aborted', 'AbortError')],
    ['a TimeoutError', new DOMException('slow', 'TimeoutError')],
    ['a 502', { status: 502 }],
    ['a 503', { status: 503 }],
    ['a 504', { status: 504 }]
  ])('reportRequestFailure probes on %s', async (_label, error) => {
    mockHealth.mockResolvedValue(true)

    reportRequestFailure(error)
    await probeNow()

    expect(mockHealth).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a 400', { status: 400 }],
    ['a 404', { status: 404 }],
    ['a plain Error', new Error('boom')],
    ['a string', 'nope'],
    ['null', null]
  ])('reportRequestFailure ignores %s', async (_label, error) => {
    mockHealth.mockResolvedValue(true)

    reportRequestFailure(error)
    await Promise.resolve()

    expect(mockHealth).not.toHaveBeenCalled()
  })

  it('probeNow joins a probe that is already in flight', async () => {
    mockHealth.mockResolvedValue(true)

    const first = probeNow()
    const second = probeNow()
    await Promise.all([first, second])

    expect(second).toBe(first)
    expect(mockHealth).toHaveBeenCalledTimes(1)
  })

  it('schedules the next probe on the backoff, one millisecond either side', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    subscribeConnection(() => {})
    const start = Date.now()

    await probeNow()
    expect(getConnectionSnapshot().nextProbeAt).toBe(
      start + PROBE_BACKOFF_MS[0]
    )
    expect(mockHealth).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(PROBE_BACKOFF_MS[0] - 1)
    expect(mockHealth).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockHealth).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(PROBE_BACKOFF_MS[1] - 1)
    expect(mockHealth).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockHealth).toHaveBeenCalledTimes(3)
  })

  it('repeats the last backoff value and resets it after a success', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    subscribeConnection(() => {})
    await probeNow()
    for (const delay of PROBE_BACKOFF_MS.slice(0, -1)) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    const calls = mockHealth.mock.calls.length
    const last = PROBE_BACKOFF_MS[PROBE_BACKOFF_MS.length - 1]

    await vi.advanceTimersByTimeAsync(last - 1)
    expect(mockHealth).toHaveBeenCalledTimes(calls)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockHealth).toHaveBeenCalledTimes(calls + 1)
    await vi.advanceTimersByTimeAsync(last - 1)
    expect(mockHealth).toHaveBeenCalledTimes(calls + 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockHealth).toHaveBeenCalledTimes(calls + 2)

    mockHealth.mockResolvedValue(true)
    await probeNow()
    mockHealth.mockResolvedValue(false)
    const start = Date.now()
    await probeNow()

    expect(getConnectionSnapshot().nextProbeAt).toBe(
      start + PROBE_BACKOFF_MS[0]
    )
  })

  it('does not schedule a probe while the tab is hidden, and probes at once when it is visible again', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    setVisibility('hidden')
    const unsubscribe = subscribeConnection(() => {})

    await probeNow()

    expect(getConnectionSnapshot().state).toBe('unreachable')
    expect(getConnectionSnapshot().nextProbeAt).toBeNull()
    await vi.advanceTimersByTimeAsync(
      PROBE_BACKOFF_MS[PROBE_BACKOFF_MS.length - 1]
    )
    expect(mockHealth).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(mockHealth).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('stops the scheduled probe when the tab is hidden', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    const unsubscribe = subscribeConnection(() => {})
    await probeNow()

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(PROBE_BACKOFF_MS[0] * 2)

    expect(mockHealth).toHaveBeenCalledTimes(1)
    expect(getConnectionSnapshot().nextProbeAt).toBeNull()
    unsubscribe()
  })

  it('resumes probing when a subscriber attaches while visible, disconnected and idle', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    const first = subscribeConnection(() => {})
    await probeNow()
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    first() // last subscriber: probing and listeners stop while hidden
    setVisibility('visible') // no listener sees this
    mockHealth.mockClear()

    const second = subscribeConnection(() => {})
    await vi.advanceTimersByTimeAsync(0)

    expect(mockHealth).toHaveBeenCalledTimes(1)
    second()
  })

  it('does not probe at subscribe while online, or while a timer is already pending', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    const first = subscribeConnection(() => {})
    first()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockHealth).not.toHaveBeenCalled()

    const second = subscribeConnection(() => {})
    await probeNow() // down with a timer scheduled
    mockHealth.mockClear()
    const third = subscribeConnection(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(mockHealth).not.toHaveBeenCalled()
    second()
    third()
  })

  it('does not probe on visibilitychange while online', async () => {
    const unsubscribe = subscribeConnection(() => {})

    document.dispatchEvent(new Event('visibilitychange'))

    expect(mockHealth).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('fires onConnectionRestored once per transition back to online', async () => {
    const restored = vi.fn()
    const off = onConnectionRestored(restored)
    mockHealth.mockResolvedValue(true)
    await probeNow()
    expect(restored).not.toHaveBeenCalled()

    mockHealth.mockResolvedValue(false)
    await probeNow()
    mockHealth.mockResolvedValue(true)
    await probeNow()
    await probeNow()

    expect(restored).toHaveBeenCalledTimes(1)
    off()
    mockHealth.mockResolvedValue(false)
    await probeNow()
    mockHealth.mockResolvedValue(true)
    await probeNow()
    expect(restored).toHaveBeenCalledTimes(1)
  })

  it('aborts a probe that takes PROBE_TIMEOUT_MS and reports unreachable', async () => {
    vi.useFakeTimers()
    mockHealth.mockImplementation(hangUntilAborted)

    const probe = probeNow()
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1)
    expect(getConnectionSnapshot().state).toBe('online')

    await vi.advanceTimersByTimeAsync(1)
    await probe

    expect(getConnectionSnapshot().state).toBe('unreachable')
  })

  it('marks the snapshot as probing while Retry is in flight, then clears it', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    await probeNow()
    mockHealth.mockImplementation(hangUntilAborted)

    const retry = probeNow()
    expect(getConnectionSnapshot().probing).toBe(true)
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)
    await retry

    expect(getConnectionSnapshot().probing).toBe(false)
  })

  it('notifies subscribers when the snapshot changes, not when it does not', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConnection(listener)
    mockHealth.mockResolvedValue(true)

    await probeNow()
    expect(listener).not.toHaveBeenCalled()

    mockHealth.mockResolvedValue(false)
    await probeNow()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('probes on the browser online and offline events while subscribed, and stops after the last unsubscribe', async () => {
    mockHealth.mockResolvedValue(true)
    const unsubscribe = subscribeConnection(() => {})

    window.dispatchEvent(new Event('offline'))
    await probeNow()
    window.dispatchEvent(new Event('online'))
    await probeNow()
    expect(mockHealth).toHaveBeenCalledTimes(2)

    unsubscribe()
    window.dispatchEvent(new Event('online'))
    await Promise.resolve()

    expect(mockHealth).toHaveBeenCalledTimes(2)
  })

  it('probes once at subscribe only when the browser already says it is offline', async () => {
    mockHealth.mockResolvedValue(true)
    const first = subscribeConnection(() => {})
    expect(mockHealth).not.toHaveBeenCalled()
    first()

    mockHealth.mockRejectedValue(new TypeError('Failed to fetch'))
    setOnLine(false)
    const second = subscribeConnection(() => {})
    await probeNow()

    expect(mockHealth).toHaveBeenCalledTimes(1)
    expect(getConnectionSnapshot().state).toBe('offline')
    second()
  })

  it('clears the scheduled probe when the last subscriber leaves', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    const stop = subscribeConnection(() => {})

    await probeNow()

    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(getConnectionSnapshot().nextProbeAt).toBeNull()
  })

  it('keeps the scheduled probe while a restored listener still observes', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    const stop = subscribeConnection(() => {})
    const stopRestored = onConnectionRestored(() => {})

    await probeNow()

    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(1)
    stopRestored()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the abort timer of a probe in flight when the last subscriber leaves', async () => {
    vi.useFakeTimers()
    mockHealth.mockImplementation(hangUntilAborted)
    const stop = subscribeConnection(() => {})
    void probeNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(0)
    // An abandoned probe must not change state.
    expect(getConnectionSnapshot()).toEqual(ONLINE_CONNECTION_SNAPSHOT)
  })

  it('clears the abort timer of a probe in flight on reset', async () => {
    vi.useFakeTimers()
    mockHealth.mockImplementation(hangUntilAborted)
    void probeNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(1)
    resetConnectionForTesting()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not re-arm a probe with no observers, and resumes when a subscriber attaches', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    reportRequestFailure(new TypeError('network'))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(getConnectionSnapshot().nextProbeAt).toBeNull()
    expect(getConnectionSnapshot().state).toBe('unreachable')
    await vi.advanceTimersByTimeAsync(
      PROBE_BACKOFF_MS[PROBE_BACKOFF_MS.length - 1]
    )
    expect(mockHealth).toHaveBeenCalledTimes(1)
    subscribeConnection(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(mockHealth).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('resumes probing when a restored listener attaches while disconnected', async () => {
    vi.useFakeTimers()
    mockHealth.mockResolvedValue(false)
    reportRequestFailure(new TypeError('network'))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(getConnectionSnapshot().nextProbeAt).toBeNull()
    expect(getConnectionSnapshot().state).toBe('unreachable')
    await vi.advanceTimersByTimeAsync(
      PROBE_BACKOFF_MS[PROBE_BACKOFF_MS.length - 1]
    )
    expect(mockHealth).toHaveBeenCalledTimes(1)
    onConnectionRestored(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(mockHealth).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
  })
})
