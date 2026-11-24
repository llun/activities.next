import { NextRequest } from 'next/server'

import { startBlueskyOAuth } from '@/lib/services/bluesky/account'
import { headerHost } from '@/lib/services/guards/headerHost'

import { POST } from './route'

const currentActor = { id: 'actor-a', domain: 'social.example' }
const database = {}

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (handle: (req: NextRequest, context: unknown) => unknown) =>
    (req: NextRequest, context: object) =>
      handle(req, { ...context, currentActor, database })
}))
vi.mock('@/lib/services/guards/headerHost', () => ({ headerHost: vi.fn() }))
vi.mock('@/lib/services/bluesky/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bluesky/account')>()),
  startBlueskyOAuth: vi.fn()
}))

const call = (body: unknown) =>
  POST(
    new NextRequest('https://social.example/api/v1/bluesky/account/oauth', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({}) }
  )

describe('POST /api/v1/bluesky/account/oauth', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('passes the served host the request is for, in canonical form', async () => {
    vi.mocked(headerHost).mockReturnValue('Social.Example:443')
    vi.mocked(startBlueskyOAuth).mockResolvedValue(
      'https://auth.example.net/authorize'
    )
    const response = await call({ handle: 'alice.example.com' })
    expect(await response.json()).toEqual({
      url: 'https://auth.example.net/authorize'
    })
    expect(startBlueskyOAuth).toHaveBeenCalledWith(
      database,
      currentActor,
      'alice.example.com',
      'social.example'
    )
  })

  it('refuses a body without a handle', async () => {
    const response = await call({})
    expect(response.status).toBe(400)
    expect(startBlueskyOAuth).not.toHaveBeenCalled()
  })
})
