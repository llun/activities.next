import { SENDER_LOCK_NAME, TAB_ID, withSenderLock } from './senderLock'

describe('senderLock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has one id per tab', () => {
    expect(TAB_ID).toBeTruthy()
    expect(typeof TAB_ID).toBe('string')
  })

  it('runs the function directly without navigator.locks', async () => {
    vi.stubGlobal('navigator', {})
    const fn = vi.fn().mockResolvedValue(undefined)

    expect(await withSenderLock(fn)).toBe(true)

    expect(fn).toHaveBeenCalledOnce()
  })

  it('requests the named lock with ifAvailable and runs when granted', async () => {
    const request = vi.fn(
      (
        _name: string,
        _options: unknown,
        callback: (lock: unknown) => unknown
      ) => Promise.resolve(callback({ name: SENDER_LOCK_NAME }))
    )
    vi.stubGlobal('navigator', { locks: { request } })
    const fn = vi.fn().mockResolvedValue(undefined)

    expect(await withSenderLock(fn)).toBe(true)

    expect(request).toHaveBeenCalledWith(
      SENDER_LOCK_NAME,
      { ifAvailable: true },
      expect.any(Function)
    )
    expect(fn).toHaveBeenCalledOnce()
  })

  it('does nothing when another tab holds the lock', async () => {
    const request = vi.fn(
      (
        _name: string,
        _options: unknown,
        callback: (lock: unknown) => unknown
      ) => Promise.resolve(callback(null))
    )
    vi.stubGlobal('navigator', { locks: { request } })
    const fn = vi.fn()

    // False, so the caller knows the pass did not run.
    expect(await withSenderLock(fn)).toBe(false)

    expect(fn).not.toHaveBeenCalled()
  })

  it('rejects when the function fails, so the caller sees the error', async () => {
    const request = vi.fn(
      (
        _name: string,
        _options: unknown,
        callback: (lock: unknown) => unknown
      ) => Promise.resolve(callback({}))
    )
    vi.stubGlobal('navigator', { locks: { request } })

    await expect(
      withSenderLock(() => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom')
  })
})
