import { isMainThread } from 'node:worker_threads'

import { withTimeZone } from './withTimeZone'

const currentTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// 2026-05-25 is in summer time, so Europe/Amsterdam is two hours ahead of UTC.
const offsetInMay = () => new Date(2026, 4, 25).getTimezoneOffset()

describe('withTimeZone', () => {
  it('runs in a forked process, which vitest.config.ts routes this file to', () => {
    expect(isMainThread).toBe(true)
  })

  it('moves Date and Intl to the zone for the callback', async () => {
    const seen = await withTimeZone('Europe/Amsterdam', () => ({
      timeZone: currentTimeZone(),
      offset: offsetInMay()
    }))

    expect(seen).toEqual({ timeZone: 'Europe/Amsterdam', offset: -120 })
  })

  it('awaits an async callback before restoring the zone', async () => {
    const seen = await withTimeZone('Asia/Tokyo', async () => {
      await Promise.resolve()
      return offsetInMay()
    })

    expect(seen).toBe(-540)
    expect(currentTimeZone()).toBe('UTC')
  })

  it('restores the zone when the callback throws', async () => {
    await expect(
      withTimeZone('Europe/Amsterdam', () => {
        throw new Error('callback failed')
      })
    ).rejects.toThrow('callback failed')

    expect(process.env.TZ).toBe('UTC')
    expect(currentTimeZone()).toBe('UTC')
    expect(offsetInMay()).toBe(0)
  })

  it('throws instead of running the callback when the zone name is not valid', async () => {
    const callback = vi.fn()

    await expect(withTimeZone('Not/AZone', callback)).rejects.toThrow(
      'could not move the time zone to "Not/AZone"'
    )

    expect(callback).not.toHaveBeenCalled()
    expect(currentTimeZone()).toBe('UTC')
  })
})
