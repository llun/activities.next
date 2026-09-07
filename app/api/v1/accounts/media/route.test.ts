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

  it('defaults malformed or non-numeric page and limit and prevents NaN from reaching database or trace', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=malformed&limit=invalid'
    )
    const res = await GET(req, createRouteContext())

    expect(res.status).toBe(200)

    // Verify database receives finite numbers, never NaN
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 1,
      limit: 25
    })

    const json = await res.json()
    expect(json.page).toBe(1)
    expect(json.itemsPerPage).toBe(25)
    expect(Number.isNaN(json.page)).toBe(false)
    expect(Number.isNaN(json.itemsPerPage)).toBe(false)

    // Verify trace attributes receive finite numbers, never NaN
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 1)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)
  })

  it('accepts prefix numeric page and limit values', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=3foo&limit=100bar'
    )
    const res = await GET(req, createRouteContext())

    expect(res.status).toBe(200)
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 3,
      limit: 100
    })

    const json = await res.json()
    expect(json.page).toBe(3)
    expect(json.itemsPerPage).toBe(100)

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 3)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 100)
  })

  it('handles empty parameter values by falling back to defaults across db, response, and trace', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=&limit='
    )
    const res = await GET(req, createRouteContext())

    expect(res.status).toBe(200)
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 1,
      limit: 25
    })

    const json = await res.json()
    expect(json.page).toBe(1)
    expect(json.itemsPerPage).toBe(25)

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 1)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)
  })

  it('clamps out-of-bounds page inputs with parity across db, response, and trace', async () => {
    // Negative page
    vi.clearAllMocks()
    const reqNegative = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=-10'
    )
    const resNegative = await GET(reqNegative, createRouteContext())
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 1,
      limit: 25
    })
    const jsonNegative = await resNegative.json()
    expect(jsonNegative.page).toBe(1)
    expect(jsonNegative.itemsPerPage).toBe(25)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 1)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)

    // Zero page
    vi.clearAllMocks()
    const reqZero = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=0'
    )
    const resZero = await GET(reqZero, createRouteContext())
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 1,
      limit: 25
    })
    const jsonZero = await resZero.json()
    expect(jsonZero.page).toBe(1)
    expect(jsonZero.itemsPerPage).toBe(25)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 1)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)

    // Above max page (10,000)
    vi.clearAllMocks()
    const reqHuge = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=50000'
    )
    const resHuge = await GET(reqHuge, createRouteContext())
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 10000,
      limit: 25
    })
    const jsonHuge = await resHuge.json()
    expect(jsonHuge.page).toBe(10000)
    expect(jsonHuge.itemsPerPage).toBe(25)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 10000)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)
  })

  it('defaults unsupported limits to 25 with parity across db, response, and trace', async () => {
    const unsupported = [10, 20, 30, 75, 200, -25]
    for (const limit of unsupported) {
      vi.clearAllMocks()
      const req = new NextRequest(
        `https://llun.test/api/v1/accounts/media?limit=${limit}`
      )
      const res = await GET(req, createRouteContext())
      expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
        accountId: 'account-1',
        page: 1,
        limit: 25
      })
      const json = await res.json()
      expect(json.page).toBe(1)
      expect(json.itemsPerPage).toBe(25)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 1)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)
    }
  })

  it('isolates URL hash fragments from query pagination', async () => {
    // Hash fragment should never leak into query pagination
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media?page=2#heading&limit=100'
    )
    const res = await GET(req, createRouteContext())
    expect(mockDatabase.getMediasWithStatusForAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      page: 2,
      limit: 25
    })
    const json = await res.json()
    expect(json.page).toBe(2)
    expect(json.itemsPerPage).toBe(25)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('page', 2)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('limit', 25)
  })

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
