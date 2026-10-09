import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { DELETE, OPTIONS } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const database = getTestSQLDatabase()
let mockDatabase: Database | null = database
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
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
  provider: string,
  headers: Record<string, string> = { origin: 'https://llun.test' }
) =>
  new NextRequest(`https://llun.test/api/v1/accounts/providers/${provider}`, {
    method: 'DELETE',
    headers
  })

const del = (provider: string, headers?: Record<string, string>) =>
  DELETE(buildRequest(provider, headers), {
    params: Promise.resolve({ provider })
  })

describe('DELETE /api/v1/accounts/providers/[provider]', () => {
  let account1Id: string
  let account2Id: string

  const providersOf = async (accountId: string) =>
    (await database.getAccountProviders({ accountId }))
      .map((item) => item.provider)
      .sort()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    account1Id = (await database.getAccountFromEmail({
      email: seedActor1.email
    }))!.id
    account2Id = (await database.getAccountFromEmail({
      email: seedActor2.email
    }))!.id
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockDatabase = database
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    // Reset links to: account1 -> github + google, account2 -> github.
    for (const accountId of [account1Id, account2Id]) {
      for (const provider of await providersOf(accountId)) {
        await database.unlinkAccountFromProvider({ accountId, provider })
      }
    }
    await database.linkAccountWithProvider({
      accountId: account1Id,
      provider: 'github',
      providerAccountId: 'gh-1'
    })
    await database.linkAccountWithProvider({
      accountId: account1Id,
      provider: 'google',
      providerAccountId: 'g-1'
    })
    await database.linkAccountWithProvider({
      accountId: account2Id,
      provider: 'github',
      providerAccountId: 'gh-2'
    })
  })

  it('unlinks only the named provider from the signed-in account', async () => {
    const response = await del('github')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    await expect(providersOf(account1Id)).resolves.toEqual(['google'])
    // Another account linked to the same provider is untouched.
    await expect(providersOf(account2Id)).resolves.toEqual(['github'])
  })

  it('succeeds without changes when the provider was never linked', async () => {
    const response = await del('twitter')

    expect(response.status).toBe(200)
    await expect(providersOf(account1Id)).resolves.toEqual(['github', 'google'])
  })

  it('returns 401 and unlinks nothing without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await del('github')

    expect(response.status).toBe(401)
    await expect(providersOf(account1Id)).resolves.toEqual(['github', 'google'])
  })

  it('returns 401 when the session email has no account', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'nobody@llun.test' }
    })

    const response = await del('github')

    expect(response.status).toBe(401)
    await expect(providersOf(account1Id)).resolves.toEqual(['github', 'google'])
  })

  it.each([
    ['no Origin or Referer header', {}],
    ['a cross-site Origin', { origin: 'https://evil.test' }]
  ])('returns 403 and unlinks nothing with %s (CSRF)', async (_t, headers) => {
    const response = await del('github', headers)

    expect(response.status).toBe(403)
    await expect(providersOf(account1Id)).resolves.toEqual(['github', 'google'])
  })

  it('returns 404 when the provider segment is empty', async () => {
    const response = await del('')

    expect(response.status).toBe(404)
    await expect(providersOf(account1Id)).resolves.toEqual(['github', 'google'])
  })

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await del('github')

    expect(response.status).toBe(500)
  })

  it('answers the CORS preflight advertising DELETE', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/accounts/providers/github', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'DELETE'
    )
  })
})
