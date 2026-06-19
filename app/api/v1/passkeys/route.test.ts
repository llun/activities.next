import { NextRequest } from 'next/server'

import { GET } from './route'

type PasskeyRow = {
  id: string
  name: string | null
  rpID: string | null
  deviceType: string
  backedUp: number | boolean
  createdAt: string | Date
  aaguid: string | null
}

let mockRows: PasskeyRow[] = []
let capturedUserId: unknown

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockActor: { account: { id: string } | null } | null = null
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: () => Promise.resolve(mockActor)
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => ({}),
  getKnex: () => () => ({
    where: (_field: string, value: unknown) => {
      capturedUserId = value
      return {
        select: () => ({
          orderBy: () => Promise.resolve(mockRows)
        })
      }
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
    capturedUserId = undefined
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
        backedUp: 1,
        createdAt: '2026-04-12T00:00:00.000Z',
        aaguid: 'aaguid-1'
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(capturedUserId).toBe('account-1')
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
        backedUp: 0,
        createdAt: '2026-05-03T00:00:00.000Z',
        aaguid: null
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(body[0].domain).toBe('primary.example')
    expect(body[0].backedUp).toBe(false)
    expect(body[0].name).toBeNull()
  })

  it('serializes a Date createdAt to an ISO string', async () => {
    mockRows = [
      {
        id: 'pk3',
        name: 'Key',
        rpID: 'primary.example',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: new Date('2026-06-01T10:11:12.000Z'),
        aaguid: null
      }
    ]

    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    const body = await response.json()

    expect(body[0].createdAt).toBe('2026-06-01T10:11:12.000Z')
  })
})
