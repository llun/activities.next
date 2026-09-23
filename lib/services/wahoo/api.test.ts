import { Database } from '@/lib/database/types'
import { FitnessSettings } from '@/lib/types/database/fitnessSettings'

import { exchangeWahooCode, requestWahoo } from './api'

const mockSafeRemoteFetch = vi.fn()
vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: (...args: unknown[]) => mockSafeRemoteFetch(...args)
}))

const settings = (
  overrides: Partial<FitnessSettings> = {}
): FitnessSettings => ({
  id: 'wahoo-settings-1',
  actorId: 'actor-1',
  serviceType: 'wahoo',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessToken: 'old-access-token',
  refreshToken: 'old-refresh-token',
  tokenExpiresAt: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

describe('exchangeWahooCode', () => {
  beforeEach(() => {
    mockSafeRemoteFetch.mockReset()
  })

  it('rejects an incomplete token response', async () => {
    mockSafeRemoteFetch.mockResolvedValue({ statusCode: 200, body: '{}' })

    await expect(
      exchangeWahooCode({
        code: 'code',
        redirectUri: 'https://example.test/callback',
        clientId: 'client-id',
        clientSecret: 'client-secret'
      })
    ).rejects.toThrow('Invalid Wahoo token response')
  })
})

describe('requestWahoo', () => {
  beforeEach(() => {
    mockSafeRemoteFetch.mockReset()
  })

  it('stores the rotated refresh token before using the refreshed access token', async () => {
    const mockDb = {
      acquireImportLock: vi.fn().mockResolvedValue({ token: 'lock-token' }),
      releaseImportLock: vi.fn().mockResolvedValue(undefined),
      getFitnessSettings: vi.fn().mockResolvedValue(settings()),
      updateFitnessSettings: vi.fn().mockResolvedValue(settings())
    } as unknown as Database
    mockSafeRemoteFetch
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          scope: 'user_read workouts_read offline_data'
        })
      })
      .mockResolvedValueOnce({ statusCode: 200, body: '{"id":1}' })

    await expect(requestWahoo(mockDb, settings(), '/v1/user')).resolves.toEqual(
      { id: 1 }
    )

    expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wahoo-settings-1',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        grantedScopes: 'user_read workouts_read offline_data',
        connectionError: null
      })
    )
    expect(mockSafeRemoteFetch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer new-access-token'
        })
      })
    )
    expect(mockDb.releaseImportLock).toHaveBeenCalledWith({
      lockKey: 'wahoo-refresh:wahoo-settings-1',
      token: 'lock-token'
    })
  })

  it('does not refresh when settings no longer refer to the same connection', async () => {
    const mockDb = {
      acquireImportLock: vi.fn().mockResolvedValue({ token: 'lock-token' }),
      releaseImportLock: vi.fn().mockResolvedValue(undefined),
      getFitnessSettings: vi.fn().mockResolvedValue(null),
      updateFitnessSettings: vi.fn()
    } as unknown as Database

    await expect(requestWahoo(mockDb, settings(), '/v1/user')).rejects.toThrow(
      'Wahoo connection was removed'
    )
    expect(mockSafeRemoteFetch).not.toHaveBeenCalled()
    expect(mockDb.updateFitnessSettings).not.toHaveBeenCalled()
  })
})
