import { getDatabase } from '@/lib/database'
import { getSubscription } from '@/lib/services/strava/webhookSubscription'

import { listStravaWebhooks } from './listStravaWebhooks'

jest.mock('@next/env', () => ({
  loadEnvConfig: jest.fn()
}))

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn()
}))

jest.mock('@/lib/services/strava/webhookSubscription', () => ({
  getSubscription: jest.fn()
}))

const mockGetDatabase = jest.mocked(getDatabase)
const mockGetSubscription = jest.mocked(getSubscription)

describe('listStravaWebhooks', () => {
  const mockDatabase = {
    getActorFromUsername: jest.fn(),
    getFitnessSettings: jest.fn()
  }
  let consoleErrorSpy: jest.SpyInstance
  let consoleLogSpy: jest.SpyInstance

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    mockGetDatabase.mockReset()
    mockGetSubscription.mockReset()
    mockDatabase.getActorFromUsername.mockReset()
    mockDatabase.getFitnessSettings.mockReset()

    mockGetDatabase.mockReturnValue(mockDatabase)
    mockDatabase.getActorFromUsername.mockResolvedValue({ id: 'actor-id' })
    mockDatabase.getFitnessSettings.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret'
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('returns non-zero when getSubscription throws', async () => {
    mockGetSubscription.mockRejectedValueOnce(new Error('Unauthorized'))

    const exitCode = await listStravaWebhooks(['@ride@example.com'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching Strava subscription:',
      expect.any(Error)
    )
  })

  it('returns zero when the subscription lookup succeeds', async () => {
    const subscription = {
      id: 1,
      callback_url: 'https://example.com/webhook/strava',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z'
    }
    mockGetSubscription.mockResolvedValueOnce(subscription)

    const exitCode = await listStravaWebhooks(['@ride@example.com'])

    expect(exitCode).toBe(0)
    expect(consoleLogSpy).toHaveBeenCalledWith('Webhook Subscription Found:')
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify(subscription, null, 2)
    )
  })
})
