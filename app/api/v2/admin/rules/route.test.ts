import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { GET, POST } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest
    .fn()
    .mockResolvedValue({ user: { email: 'admin@llun.test' } })
}))

const mockGetAdminFromSession = jest.fn()
jest.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: () => mockGetAdminFromSession()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v2/admin/rules', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAdminFromSession.mockResolvedValue({
      id: 'admin',
      email: 'admin@llun.test'
    })
  })

  const baseRequest = (init?: { method?: string; body?: object }) =>
    new NextRequest('https://llun.test/api/v2/admin/rules', {
      method: init?.method ?? 'GET',
      headers: init?.body
        ? {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test',
            Referer: 'https://llun.test/'
          }
        : { Origin: 'https://llun.test' },
      body: init?.body ? JSON.stringify(init.body) : undefined
    })

  it('rejects non-admin requests', async () => {
    mockGetAdminFromSession.mockResolvedValue(null)

    const response = await POST(
      baseRequest({ method: 'POST', body: { text: 'Be kind', hint: '' } }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(403)
  })

  it('creates a rule and lists it with its position', async () => {
    const postResponse = await POST(
      baseRequest({ method: 'POST', body: { text: 'Be kind', hint: '' } }),
      { params: Promise.resolve({}) }
    )
    expect(postResponse.status).toBe(200)
    const created = await postResponse.json()
    expect(created.id).toEqual(expect.any(String))
    expect(created.text).toBe('Be kind')
    expect(created.hint).toBe('')
    expect(created.position).toBe(0)

    const listResponse = await GET(baseRequest(), {
      params: Promise.resolve({})
    })
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json()
    const entry = list.find((item: { id: string }) => item.id === created.id)
    expect(entry).toEqual(created)
  })

  it('returns 422 when the text is empty', async () => {
    const response = await POST(
      baseRequest({ method: 'POST', body: { text: '', hint: 'something' } }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
  })
})
