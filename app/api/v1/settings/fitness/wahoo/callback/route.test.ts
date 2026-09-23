import { NextRequest } from 'next/server'

import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const mockDb = {
  getFitnessSettings: vi.fn(),
  consumeFitnessOauthState: vi.fn(),
  getWahooSettingsByWebhookToken: vi.fn(),
  updateFitnessSettings: vi.fn()
}
const mockExchangeWahooCode = vi.fn()
const mockGetWahooUser = vi.fn()

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'test.llun.dev' })
}))
vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (handler: (...args: unknown[]) => unknown) => (req: NextRequest) =>
      handler(req, {
        currentActor: { id: ACTOR1_ID },
        database: mockDb
      })
}))
vi.mock('@/lib/services/wahoo/api', () => ({
  WAHOO_OAUTH_SCOPES: 'user_read workouts_read offline_data',
  exchangeWahooCode: (...args: unknown[]) => mockExchangeWahooCode(...args),
  getWahooUser: (...args: unknown[]) => mockGetWahooUser(...args)
}))
vi.mock('@/lib/services/wahoo/urls', () => ({
  getWahooCallbackUrl: () =>
    'https://test.llun.dev/api/v1/settings/fitness/wahoo/callback'
}))

describe('Wahoo OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.getFitnessSettings.mockResolvedValue({
      id: 'settings-1',
      actorId: ACTOR1_ID,
      serviceType: 'wahoo',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      webhookToken: 'webhook-token',
      oauthState: 'oauth-state',
      credentialVersion: 0
    })
    mockDb.consumeFitnessOauthState.mockResolvedValue(true)
    mockDb.getWahooSettingsByWebhookToken.mockResolvedValue(null)
    mockExchangeWahooCode.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      scope: 'user_read workouts_read offline_data'
    })
    mockGetWahooUser.mockResolvedValue({ id: 1234 })
  })

  it('reports an account already connected when concurrent callbacks collide on the binding index', async () => {
    mockDb.updateFitnessSettings.mockRejectedValueOnce(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505'
        }
      )
    )

    const response = await GET(
      new NextRequest(
        'https://test.llun.dev/api/v1/settings/fitness/wahoo/callback?code=one-time-code&state=oauth-state'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://test.llun.dev/fitness/wahoo?error=wahoo_account_already_connected'
    )
    expect(mockDb.updateFitnessSettings).toHaveBeenCalledTimes(1)
  })
})
