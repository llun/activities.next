import { NextRequest } from 'next/server'

import type { AccountPasskey } from '@/lib/types/database/operations'

import { GET } from './route'

let mockRows: AccountPasskey[] = []
let capturedAccountId: unknown

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockActor: {
  account: {
    id: string
    disabledAt?: number | null
    verificationCode?: string | null
    emailVerified?: boolean
  } | null
  suspendedAt?: number | null
} | null = null
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: () => Promise.resolve(mockActor)
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => ({
    getAccountPasskeys: ({ accountId }: { accountId: string }) => {
      capturedAccountId = accountId
      return Promise.resolve(mockRows)
    }
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://primary.example'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'primary.example',
    secretPhase: 'test-secret'
  })
}))

const createRequest = () =>
  new NextRequest('https://primary.example/api/v1/passkeys')

describe('GET /api/v1/passkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRows = []
    capturedAccountId = undefined
    mockActor = { account: { id: 'account-1' } }
    mockGetServerSession.mockResolvedValue({ user: { email: 'a@example.com' } })
  })

  it('redirects to sign-in when there is no session', async () => {
    mockGetServerSession.mockResolvedValue(null)
    mockActor = null

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(307)
  })

  it('returns the passkeys for the signed-in account scoped by userId', async () => {
    mockRows = [
      {
        id: 'pk1',
        name: 'Laptop',
        rpID: 'second.example',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: Date.parse('2026-04-12T00:00:00.000Z'),
        aaguid: 'aaguid-1'
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(capturedAccountId).toBe('account-1')
    expect(body).toEqual([
      {
        id: 'pk1',
        name: 'Laptop',
        domain: 'second.example',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        aaguid: 'aaguid-1'
      }
    ])
  })

  it('attributes a null rpID (pre-multi-domain) to the primary host', async () => {
    mockRows = [
      {
        id: 'pk2',
        name: null,
        rpID: null,
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: Date.parse('2026-05-03T00:00:00.000Z'),
        aaguid: null
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(body[0].domain).toBe('primary.example')
    expect(body[0].backedUp).toBe(false)
    expect(body[0].name).toBeNull()
  })

  // The query reads a SQLite zone-less `YYYY-MM-DD HH:MM:SS` value as UTC
  // (see getAccountPasskeys in lib/database/domains/account/accountRouteQueries.test.ts),
  // so the route only has to format the epoch milliseconds it gets back.
  it('serializes the createdAt of a zone-less SQLite value as ISO UTC', async () => {
    mockRows = [
      {
        id: 'pk4',
        name: 'Key',
        rpID: 'primary.example',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: Date.UTC(2026, 3, 12, 8, 9, 10),
        aaguid: null
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(body[0].createdAt).toBe('2026-04-12T08:09:10.000Z')
  })

  it('reports a createdAt that is not a date as null instead of failing the list', async () => {
    mockRows = [
      {
        id: 'pk5',
        name: 'Key',
        rpID: 'primary.example',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: Number.NaN,
        aaguid: null
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject([
      { id: 'pk5', createdAt: null }
    ])
  })

  it('serializes the createdAt of a PostgreSQL timestamp to an ISO string', async () => {
    mockRows = [
      {
        id: 'pk3',
        name: 'Key',
        rpID: 'primary.example',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: Date.parse('2026-06-01T10:11:12.000Z'),
        aaguid: null
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body[0].createdAt).toBe('2026-06-01T10:11:12.000Z')
  })

  it('returns 403 when actor is suspended', async () => {
    mockActor = {
      account: { id: 'account-1' },
      suspendedAt: Date.now()
    }

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 when account is disabled', async () => {
    mockActor = {
      account: { id: 'account-1', disabledAt: Date.now() }
    }

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 when account confirmation is pending', async () => {
    mockActor = {
      account: {
        id: 'account-1',
        verificationCode: 'pending-code',
        emailVerified: false
      }
    }

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})
