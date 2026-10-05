import { NextRequest } from 'next/server'

import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { GET } from './route'

let currentHost = 'test.llun.dev'

const mockDb = {
  getFitnessSettings: vi.fn(),
  updateFitnessSettings: vi.fn(),
  deleteFitnessSettings: vi.fn(),
  consumeFitnessOauthState: vi.fn()
}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: currentHost })
}))

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (handler: (...args: unknown[]) => unknown) => (req: NextRequest) =>
      handler(req, {
        currentActor: { id: ACTOR1_ID },
        database: mockDb
      })
}))

vi.mock('@/lib/utils/traceApiRoute', () => ({
  traceApiRoute: (_name: string, handler: unknown) => handler
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('@/lib/utils/timingSafeStringEqual', () => ({
  timingSafeStringEqual: (a: string, b: string) => a === b
}))

vi.mock('@/lib/services/strava/webhookSubscription', () => ({
  ensureWebhookSubscription: vi.fn().mockResolvedValue({ success: true })
}))

describe('Strava OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentHost = 'test.llun.dev'
  })

  it('redirects with error when error param is present', async () => {
    const req = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/strava/callback?error=access_denied'
    )
    const res = (await GET(req, {
      params: Promise.resolve({})
    })) as Response
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://test.llun.dev/fitness/connections/strava?error=authorization_failed'
    )
  })

  it('uses http protocol when host starts with localhost', async () => {
    currentHost = 'localhost:3000'
    const req = new NextRequest(
      'http://localhost:3000/api/v1/fitness/strava/callback?error=access_denied'
    )
    const res = (await GET(req, {
      params: Promise.resolve({})
    })) as Response
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/fitness/connections/strava?error=authorization_failed'
    )
  })

  it('redirects with no_code error when code param is missing', async () => {
    const req = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/strava/callback?state=valid-state'
    )
    const res = (await GET(req, {
      params: Promise.resolve({})
    })) as Response
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://test.llun.dev/fitness/connections/strava?error=no_code'
    )
  })

  it('redirects with not_configured when settings are missing credentials', async () => {
    mockDb.getFitnessSettings.mockResolvedValue(null)
    const req = new NextRequest(
      'https://test.llun.dev/api/v1/fitness/strava/callback?code=abc&state=valid-state'
    )
    const res = (await GET(req, {
      params: Promise.resolve({})
    })) as Response
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://test.llun.dev/fitness/connections/strava?error=not_configured'
    )
  })

  // The state is the callback's only CSRF proof, so it must be single use. The
  // old code tried to clear it with `undefined`, which updateFitnessSettings
  // skips, leaving it valid for its whole 10-minute window.
  describe('OAuth state consumption', () => {
    const fetchMock = vi.fn()
    let storedState: string | null

    beforeEach(() => {
      storedState = 'valid-state'
      const settings = () => ({
        id: 'settings-id',
        actorId: ACTOR1_ID,
        serviceType: 'strava',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        webhookToken: 'webhook-token',
        oauthState: 'valid-state',
        oauthStateExpiry: Date.now() + 60_000
      })
      mockDb.getFitnessSettings.mockImplementation(async () => settings())
      // Mirrors the SQL implementation: clears the state only when it still
      // matches, and reports whether it did.
      mockDb.consumeFitnessOauthState.mockImplementation(
        async ({ state }: { state: string }) => {
          if (storedState !== state) return false
          storedState = null
          return true
        }
      )
      fetchMock.mockReset().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              access_token: 'access',
              refresh_token: 'refresh',
              expires_at: 2_000_000_000,
              athlete: { id: 1 }
            }),
            { status: 200 }
          )
      )
      vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const callback = (code: string) =>
      GET(
        new NextRequest(
          `https://test.llun.dev/api/v1/fitness/strava/callback?code=${code}&state=valid-state`
        ),
        { params: Promise.resolve({}) }
      ) as Promise<Response>

    it('refuses a second callback that replays the same state', async () => {
      const first = await callback('first-code')
      expect(first.headers.get('location')).toBe(
        'https://test.llun.dev/fitness/connections/strava?success=true'
      )

      const replay = await callback('attacker-code')
      expect(replay.headers.get('location')).toBe(
        'https://test.llun.dev/fitness/connections/strava?error=invalid_state'
      )
      // The replayed code never reaches Strava, so it cannot replace the
      // connection's tokens.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(mockDb.updateFitnessSettings).toHaveBeenCalledTimes(1)
    })
  })
})
