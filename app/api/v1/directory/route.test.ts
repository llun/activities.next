import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getLocalMastodonActors: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'local.test' })
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OptionalOAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor
      })
}))

describe('GET /api/v1/directory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getLocalMastodonActors.mockResolvedValue([])
  })

  it.each([
    {
      description: 'clamps a limit above the cap of 80 down to 80',
      query: '?limit=100',
      expectedLimit: 80
    },
    {
      description: 'clamps a limit of 0 up to the minimum of 1',
      query: '?limit=0',
      expectedLimit: 1
    }
  ])('$description', async ({ query, expectedLimit }) => {
    const response = await GET(
      new NextRequest(`https://local.test/api/v1/directory${query}`),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getLocalMastodonActors).toHaveBeenCalledWith(
      expect.objectContaining({ limit: expectedLimit })
    )
  })

  it.each([
    {
      description: 'defaults order to active',
      query: '',
      expectedOrder: 'active'
    },
    {
      description: 'passes through order=new',
      query: '?order=new',
      expectedOrder: 'new'
    },
    {
      description: 'passes through order=active',
      query: '?order=active',
      expectedOrder: 'active'
    }
  ])('$description', async ({ query, expectedOrder }) => {
    const response = await GET(
      new NextRequest(`https://local.test/api/v1/directory${query}`),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getLocalMastodonActors).toHaveBeenCalledWith(
      expect.objectContaining({ order: expectedOrder })
    )
  })

  it('rejects an unknown order value', async () => {
    const response = await GET(
      new NextRequest('https://local.test/api/v1/directory?order=bogus'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(mockDatabase.getLocalMastodonActors).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'includes remote actors by default (local=false)',
      query: '',
      expectedLocal: false
    },
    {
      description: 'restricts to local actors when local=true',
      query: '?local=true',
      expectedLocal: true
    },
    {
      description:
        'coerces a garbage local value to false instead of rejecting',
      query: '?local=banana',
      expectedLocal: false
    }
  ])('$description', async ({ query, expectedLocal }) => {
    const response = await GET(
      new NextRequest(`https://local.test/api/v1/directory${query}`),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getLocalMastodonActors).toHaveBeenCalledWith(
      expect.objectContaining({ local: expectedLocal })
    )
  })
})
