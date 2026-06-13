import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { DELETE, PATCH } from './[id]/route'
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

describe('/api/v2/admin/announcements', () => {
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
    new NextRequest('https://llun.test/api/v2/admin/announcements', {
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

  it('rejects non-admin GET requests', async () => {
    mockGetAdminFromSession.mockResolvedValue(null)
    const response = await GET(baseRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(403)
  })

  it('rejects non-admin POST requests', async () => {
    mockGetAdminFromSession.mockResolvedValue(null)
    const response = await POST(
      baseRequest({ method: 'POST', body: { text: 'Hello' } }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(403)
  })

  it('rejects non-admin PATCH requests', async () => {
    mockGetAdminFromSession.mockResolvedValue(null)
    const response = await PATCH(
      baseRequest({ method: 'PATCH', body: { text: 'Hello' } }),
      { params: Promise.resolve({ id: 'missing' }) }
    )
    expect(response.status).toBe(403)
  })

  it('rejects non-admin DELETE requests', async () => {
    mockGetAdminFromSession.mockResolvedValue(null)
    const response = await DELETE(baseRequest({ method: 'DELETE' }), {
      params: Promise.resolve({ id: 'missing' })
    })
    expect(response.status).toBe(403)
  })

  it('creates a published announcement, lists it, updates the text, and deletes it', async () => {
    const postResponse = await POST(
      baseRequest({
        method: 'POST',
        body: { text: 'Scheduled maintenance', published: true }
      }),
      { params: Promise.resolve({}) }
    )
    expect(postResponse.status).toBe(200)
    const created = await postResponse.json()
    expect(typeof created.id).toBe('string')
    expect(created.id.length).toBeGreaterThan(0)
    expect(created.text).toBe('Scheduled maintenance')
    expect(created.published).toBe(true)

    const listResponse = await GET(baseRequest(), {
      params: Promise.resolve({})
    })
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json()
    const entry = list.find((item: { id: string }) => item.id === created.id)
    expect(entry).toBeTruthy()
    expect(entry.text).toBe('Scheduled maintenance')

    const patchResponse = await PATCH(
      baseRequest({ method: 'PATCH', body: { text: 'Maintenance complete' } }),
      { params: Promise.resolve({ id: created.id }) }
    )
    expect(patchResponse.status).toBe(200)
    const patched = await patchResponse.json()
    expect(patched.text).toBe('Maintenance complete')

    const deleteResponse = await DELETE(baseRequest({ method: 'DELETE' }), {
      params: Promise.resolve({ id: created.id })
    })
    expect(deleteResponse.status).toBe(200)

    const remaining = await database.getAnnouncements()
    expect(remaining.find((item) => item.id === created.id)).toBeUndefined()
  })

  it('returns 422 when the text is empty', async () => {
    const response = await POST(
      baseRequest({ method: 'POST', body: { text: '   ' } }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
  })

  it('returns 422 when the text exceeds 5000 characters', async () => {
    const response = await POST(
      baseRequest({ method: 'POST', body: { text: 'a'.repeat(5001) } }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
  })

  it('returns 404 when updating an unknown announcement', async () => {
    const response = await PATCH(
      baseRequest({ method: 'PATCH', body: { text: 'Updated' } }),
      { params: Promise.resolve({ id: 'does-not-exist' }) }
    )
    expect(response.status).toBe(404)
  })

  it('returns 404 when deleting an unknown announcement', async () => {
    const response = await DELETE(baseRequest({ method: 'DELETE' }), {
      params: Promise.resolve({ id: 'does-not-exist' })
    })
    expect(response.status).toBe(404)
  })
})
