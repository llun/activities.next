import { NextRequest } from 'next/server'

import { ERROR_401 } from '@/lib/utils/response'

import { GET, OPTIONS } from './route'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}))

const mockSpan = {
  setAttribute: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
  recordException: vi.fn()
}

vi.mock('@/lib/utils/trace', () => ({
  getTracer: () => ({
    startActiveSpan: (_name: string, fn: (span: typeof mockSpan) => unknown) =>
      fn(mockSpan)
  })
}))

const mockCurrentActor: {
  id: string
  account?: { id: string }
} = {
  id: 'https://llun.test/users/llun',
  account: { id: 'account-1' }
}

const mockDatabase = {
  getStorageUsageForAccount: vi.fn(),
  getMediasWithStatusForAccount: vi.fn()
}

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handler: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<object>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<object> }) =>
      handler(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

const createRouteContext = () => ({
  params: Promise.resolve({})
})

vi.mock('@/lib/services/medias/quota', () => ({
  getQuotaLimit: vi.fn().mockReturnValue(4294967296)
}))

describe('OPTIONS /api/v1/accounts/media', () => {
  it('returns 200 with allowed CORS methods', async () => {
    const req = new NextRequest('https://llun.test/api/v1/accounts/media', {
      method: 'OPTIONS',
      headers: { Origin: 'https://llun.test' }
    })
    const res = await OPTIONS(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://llun.test'
    )
  })
})

describe('GET /api/v1/accounts/media', () => {
  const sampleMediaItem = {
    id: '123',
    actorId: 'https://llun.test/users/llun',
    original: {
      bytes: 1024,
      mimeType: 'image/jpeg',
      metaData: { width: 800, height: 600 }
    },
    thumbnail: {
      bytes: 256,
      mimeType: 'image/jpeg',
      metaData: { width: 200, height: 150 }
    },
    description: 'Sample image',
    statusId: 'status-456'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentActor.account = { id: 'account-1' }
    mockDatabase.getStorageUsageForAccount.mockResolvedValue(1280)
    mockDatabase.getMediasWithStatusForAccount.mockResolvedValue({
      items: [sampleMediaItem],
      total: 1
    })
  })

  it('returns 401 when actor has no account', async () => {
    mockCurrentActor.account = undefined

    const req = new NextRequest('https://llun.test/api/v1/accounts/media')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual(ERROR_401)
    expect(mockDatabase.getStorageUsageForAccount).not.toHaveBeenCalled()
    expect(mockDatabase.getMediasWithStatusForAccount).not.toHaveBeenCalled()
  })

  it('handles default pagination parameters when query is omitted', async () => {
    const req = new NextRequest('https://llun.test/api/v1/accounts/media')
    const res = await GET(req, createRouteContext())

    expect(res.status).toBe(200)
    expect(mockDatabase.getStorageUsageForAccount).toHaveBeenCalledWith({
      accountId: 'account-1'
    })
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 1,
      limit: 25
    })

    const json = await res.json()
    expect(json).toEqual({
      used: 1280,
      limit: 4294967296,
      total: 1,
      page: 1,
      itemsPerPage: 25,
      medias: [
        {
          id: '123',
          actorId: 'https://llun.test/users/llun',
          bytes: 1280,
          mimeType: 'image/jpeg',
          width: 800,
          height: 600,
          description: 'Sample image',
          statusId: 'status-456'
        }
      ]
    })

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 1)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)
  })

  it('passes custom valid page and limit to database, response, and trace attributes', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=2&limit=50'
    )
    const res = await GET(req, createRouteContext())

    expect(res.status).toBe(200)
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 2,
      limit: 50
    })

    const json = await res.json()
    expect(json.page).toBe(2)
    expect(json.itemsPerPage).toBe(50)

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 2)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 50)
  })

  // The parsing rules themselves are covered in pagination.test.ts; this
  // checks the parsed values reach the database, the response and the trace
  // span unchanged (never NaN).
  it.each([
    {
      name: 'malformed page and limit',
      query: '?page=malformed&limit=invalid',
      page: 1,
      limit: 25
    },
    {
      name: 'prefix numeric page and limit',
      query: '?page=3foo&limit=100bar',
      page: 3,
      limit: 100
    },
    {
      name: 'empty page and limit',
      query: '?page=&limit=',
      page: 1,
      limit: 25
    },
    { name: 'negative page', query: '?page=-10', page: 1, limit: 25 },
    { name: 'zero page', query: '?page=0', page: 1, limit: 25 },
    {
      name: 'page above the 10,000 maximum',
      query: '?page=50000',
      page: 10000,
      limit: 25
    },
    { name: 'unsupported limit 10', query: '?limit=10', page: 1, limit: 25 },
    { name: 'unsupported limit 20', query: '?limit=20', page: 1, limit: 25 },
    { name: 'unsupported limit 30', query: '?limit=30', page: 1, limit: 25 },
    { name: 'unsupported limit 75', query: '?limit=75', page: 1, limit: 25 },
    { name: 'unsupported limit 200', query: '?limit=200', page: 1, limit: 25 },
    { name: 'negative limit', query: '?limit=-25', page: 1, limit: 25 },
    // A hash fragment must never leak into the query pagination.
    {
      name: 'limit hidden behind a hash fragment',
      query: '?page=2#heading&limit=100',
      page: 2,
      limit: 25
    }
  ])(
    'passes $name as page $page / limit $limit to db, response, and trace',
    async ({ query, page, limit }) => {
      const req = new NextRequest(
        `https://llun.test/api/v1/accounts/media${query}`
      )
      const res = await GET(req, createRouteContext())

      expect(res.status).toBe(200)
      expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
        accountId: 'account-1',
        page,
        limit
      })

      const json = await res.json()
      expect(json.page).toBe(page)
      expect(json.itemsPerPage).toBe(limit)

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', page)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', limit)
    }
  )

  it('handles media items without thumbnails', async () => {
    mockDatabase.getMediasWithStatusForAccount.mockResolvedValue({
      items: [
        {
          id: '456',
          actorId: 'https://llun.test/users/llun',
          original: {
            bytes: 2048,
            mimeType: 'image/png',
            metaData: { width: 1024, height: 768 }
          },
          description: null,
          statusId: undefined
        }
      ],
      total: 1
    })

    const req = new NextRequest('https://llun.test/api/v1/accounts/media')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.medias[0]).toEqual({
      id: '456',
      actorId: 'https://llun.test/users/llun',
      bytes: 2048,
      mimeType: 'image/png',
      width: 1024,
      height: 768,
      description: null,
      statusId: undefined
    })
  })
})
