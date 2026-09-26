import { NextRequest } from 'next/server'

import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { GET } from './route'

let currentHost = 'test.llun.dev'

const mockDb = {
  getFitnessSettings: vi.fn(),
  updateFitnessSettings: vi.fn(),
  deleteFitnessSettings: vi.fn()
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
})
