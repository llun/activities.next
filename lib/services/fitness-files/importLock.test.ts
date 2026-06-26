import { Database } from '@/lib/database/types'
import { withImportLock } from '@/lib/services/fitness-files/importLock'

const makeDatabase = (
  acquireImportLock: Database['acquireImportLock'],
  releaseImportLock: Database['releaseImportLock'] = vi
    .fn()
    .mockResolvedValue(true)
): Database =>
  ({
    acquireImportLock,
    releaseImportLock
  }) as unknown as Database

describe('withImportLock', () => {
  it('runs fn while holding the lock and releases it afterwards', async () => {
    const release = vi.fn().mockResolvedValue(true)
    const database = makeDatabase(
      vi.fn().mockResolvedValue({ token: 'token-1' }),
      release
    )

    const result = await withImportLock(database, 'strava-import:actor-1', () =>
      Promise.resolve('done')
    )

    expect(result).toBe('done')
    expect(release).toHaveBeenCalledWith({
      lockKey: 'strava-import:actor-1',
      token: 'token-1'
    })
  })

  it('releases the lock even when fn throws', async () => {
    const release = vi.fn().mockResolvedValue(true)
    const database = makeDatabase(
      vi.fn().mockResolvedValue({ token: 'token-2' }),
      release
    )

    await expect(
      withImportLock(database, 'strava-import:actor-1', () =>
        Promise.reject(new Error('boom'))
      )
    ).rejects.toThrow('boom')

    expect(release).toHaveBeenCalledWith({
      lockKey: 'strava-import:actor-1',
      token: 'token-2'
    })
  })

  it('waits until the lock frees up, then proceeds under it', async () => {
    const acquire = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ token: 'token-3' })
    const release = vi.fn().mockResolvedValue(true)
    const database = makeDatabase(acquire, release)
    const fn = vi.fn().mockResolvedValue('ok')

    const result = await withImportLock(database, 'k', fn, {
      pollIntervalMs: 1,
      maxWaitMs: 1_000
    })

    expect(result).toBe('ok')
    expect(acquire).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith({ lockKey: 'k', token: 'token-3' })
  })

  it('proceeds without the lock after the wait budget and does not release', async () => {
    const acquire = vi.fn().mockResolvedValue(null)
    const release = vi.fn()
    const database = makeDatabase(acquire, release)
    const fn = vi.fn().mockResolvedValue('fallback')

    const result = await withImportLock(database, 'k', fn, {
      pollIntervalMs: 1,
      maxWaitMs: 3
    })

    expect(result).toBe('fallback')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
  })
})
