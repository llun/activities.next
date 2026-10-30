import { Database } from '@/lib/database/types'
import {
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  withImportLock
} from '@/lib/services/fitness-files/importLock'

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
  it('uses the production wait defaults', () => {
    expect(DEFAULT_MAX_WAIT_MS).toBe(15 * 1000)
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(250)
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
