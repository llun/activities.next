import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { OPTIONS, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const database = getTestSQLDatabase()
vi.mock('@/lib/database', () => ({
  getDatabase: () => database
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

const buildRequest = (
  body: unknown,
  headers: Record<string, string> = { origin: 'https://llun.test' }
) =>
  new NextRequest('https://llun.test/api/v1/accounts/name', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

const post = (req: NextRequest) => POST(req, { params: Promise.resolve({}) })

describe('POST /api/v1/accounts/name', () => {
  const accountName = async (email: string) =>
    (await database.getAccountFromEmail({ email }))?.name

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const account = await database.getAccountFromEmail({
      email: seedActor1.email
    })
    await database.updateAccountName({
      accountId: account!.id,
      name: 'Original Name'
    })
  })

  it('saves the trimmed name on the signed-in account only', async () => {
    const otherNameBefore = await accountName(seedActor2.email)

    const response = await post(buildRequest({ name: '  New Name  ' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    await expect(accountName(seedActor1.email)).resolves.toBe('New Name')
    await expect(accountName(seedActor2.email)).resolves.toBe(otherNameBefore)
  })

  it.each([
    ['an empty string', ''],
    ['only whitespace', '   ']
  ])('clears the name when given %s', async (_title, name) => {
    const response = await post(buildRequest({ name }))

    expect(response.status).toBe(200)
    await expect(accountName(seedActor1.email)).resolves.toBeNull()
  })

  it('accepts a name of exactly 255 characters', async () => {
    const name = 'a'.repeat(255)

    const response = await post(buildRequest({ name }))

    expect(response.status).toBe(200)
    await expect(accountName(seedActor1.email)).resolves.toBe(name)
  })

  it.each([
    ['longer than 255 characters', { name: 'a'.repeat(256) }],
    ['not a string', { name: 42 }],
    ['missing', {}]
  ])('returns 422 and keeps the name when the name is %s', async (_t, body) => {
    const response = await post(buildRequest(body))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid name' })
    await expect(accountName(seedActor1.email)).resolves.toBe('Original Name')
  })

  it('returns 400 and keeps the name when the body is not JSON', async () => {
    const response = await post(buildRequest('not json'))

    expect(response.status).toBe(400)
    await expect(accountName(seedActor1.email)).resolves.toBe('Original Name')
  })

  it('redirects an unauthenticated request to sign-in without changing any name', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await post(buildRequest({ name: 'Intruder' }))

    expect(response.status).toBe(307)
    await expect(accountName(seedActor1.email)).resolves.toBe('Original Name')
  })

  it('returns 403 and keeps the name when the same-origin proof is missing (CSRF)', async () => {
    const response = await post(buildRequest({ name: 'Forged' }, {}))

    expect(response.status).toBe(403)
    await expect(accountName(seedActor1.email)).resolves.toBe('Original Name')
  })

  it('answers the CORS preflight advertising POST', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/accounts/name', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'POST'
    )
  })
})
