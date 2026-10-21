import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { DELETE, PATCH } from './[id]/route'
import { GET, POST } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi
    .fn()
    .mockResolvedValue({ user: { email: 'admin@llun.test' } })
}))

const mockGetAdminFromSession = vi.fn()
vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: () => mockGetAdminFromSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    trustedHosts: ['club.llun.test'],
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
    vi.clearAllMocks()
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

  describe('announcements per domain', () => {
    const call = <T extends typeof POST | typeof PATCH>(
      handler: T,
      method: string,
      body: object,
      id?: string
    ) =>
      handler(baseRequest({ method, body }), {
        params: Promise.resolve(id ? { id } : {})
      } as never)

    it('creates for every domain by default and for a named served domain', async () => {
      const everywhere = await (
        await call(POST, 'POST', { text: 'For all' })
      ).json()
      expect(everywhere.domain).toBeNull()

      const response = await call(POST, 'POST', {
        text: 'For the club',
        domain: 'CLUB.llun.test'
      })
      expect(response.status).toBe(200)
      const club = await response.json()
      expect(club.domain).toBe('club.llun.test')

      // The primary is a valid audience: an announcement may be for it alone.
      const primary = await (
        await call(POST, 'POST', {
          text: 'For the primary',
          domain: 'llun.test'
        })
      ).json()
      expect(primary.domain).toBe('llun.test')

      const ids = async (query = '') => {
        const listed = await GET(
          new NextRequest(
            `https://llun.test/api/v2/admin/announcements${query}`,
            { headers: { Origin: 'https://llun.test' } }
          ),
          { params: Promise.resolve({}) }
        )
        expect(listed.status).toBe(200)
        return (await listed.json()).map((item: { id: string }) => item.id)
      }
      expect(await ids()).toEqual(
        expect.arrayContaining([everywhere.id, club.id, primary.id])
      )
      expect(await ids('?domain=club.llun.test')).toEqual([club.id])
      expect(await ids('?domain=llun.test')).toEqual([primary.id])
    })

    it('accepts an added domain, on or off', async () => {
      await database.createServedDomain({ domain: 'run.example' })

      const response = await call(POST, 'POST', {
        text: 'Runners',
        domain: 'run.example'
      })

      expect(response.status).toBe(200)
      expect((await response.json()).domain).toBe('run.example')
    })

    it.each([
      { domain: 'nowhere.example', code: 'unknown' },
      { domain: 'not a domain/path', code: 'invalid' }
    ])('refuses $code domain on create', async ({ domain, code }) => {
      const response = await call(POST, 'POST', { text: 'Nope', domain })
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code })
    })

    it('refuses an unserved domain in the list filter', async () => {
      const listed = await GET(
        new NextRequest(
          'https://llun.test/api/v2/admin/announcements?domain=nowhere.example',
          { headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({}) }
      )
      expect(listed.status).toBe(422)
    })

    it('moves an announcement between audiences and keeps it when no domain is sent', async () => {
      const created = await (
        await call(POST, 'POST', { text: 'Move me', domain: 'club.llun.test' })
      ).json()

      const kept = await (
        await call(PATCH, 'PATCH', { text: 'Moved?' }, created.id)
      ).json()
      expect(kept.domain).toBe('club.llun.test')

      const everywhere = await (
        await call(PATCH, 'PATCH', { domain: null }, created.id)
      ).json()
      expect(everywhere.domain).toBeNull()

      const refused = await call(
        PATCH,
        'PATCH',
        { domain: 'nowhere.example' },
        created.id
      )
      expect(refused.status).toBe(422)
      expect(
        (await database.getAnnouncement({ id: created.id }))?.domain
      ).toBeNull()
    })
  })
})
