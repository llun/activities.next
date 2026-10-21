import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { PATCH } from './[id]/route'
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
    vi.clearAllMocks()
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

  it('rejects non-admin list requests', async () => {
    mockGetAdminFromSession.mockResolvedValue(null)

    const response = await GET(baseRequest(), { params: Promise.resolve({}) })
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

  it('accepts a position at the 32-bit integer max boundary', async () => {
    const response = await POST(
      baseRequest({
        method: 'POST',
        body: { text: 'Boundary rule', position: 2147483647 }
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const created = await response.json()
    expect(created.position).toBe(2147483647)
  })

  it.each([
    {
      description: 'returns 422 when the text is empty',
      body: { text: '', hint: 'something' }
    },
    {
      description: 'returns 422 when the text exceeds 1000 characters',
      body: { text: 'a'.repeat(1001) }
    },
    {
      description: 'returns 422 when the hint exceeds 2000 characters',
      body: { text: 'ok', hint: 'a'.repeat(2001) }
    },
    {
      description: 'returns 422 when the position is negative',
      body: { text: 'ok', position: -1 }
    },
    {
      description: 'returns 422 when the position exceeds the 32-bit int max',
      body: { text: 'ok', position: 2147483648 }
    }
  ])('$description', async ({ body }) => {
    const response = await POST(baseRequest({ method: 'POST', body }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)
  })

  describe('rules per domain', () => {
    const listRequest = (domain?: string) =>
      new NextRequest(
        `https://llun.test/api/v2/admin/rules${
          domain === undefined ? '' : `?domain=${encodeURIComponent(domain)}`
        }`,
        { headers: { Origin: 'https://llun.test' } }
      )
    const list = async (domain?: string) => {
      const response = await GET(listRequest(domain), {
        params: Promise.resolve({})
      })
      return {
        response,
        rules: (await response.json()) as {
          id: string
          domain: string | null
          text: string
          position: number
        }[]
      }
    }
    const create = (body: object) =>
      POST(baseRequest({ method: 'POST', body }), {
        params: Promise.resolve({})
      })

    it('creates a domain rule that only that domain’s list shows', async () => {
      const server = await (
        await create({ text: 'Server wide', position: 1 })
      ).json()
      const response = await create({
        text: 'Club only',
        domain: 'Club.Llun.Test',
        position: 0
      })
      expect(response.status).toBe(200)
      const own = await response.json()
      expect(own).toMatchObject({ domain: 'club.llun.test', text: 'Club only' })
      expect(server.domain).toBeNull()

      const club = await list('club.llun.test')
      expect(club.response.status).toBe(200)
      expect(club.rules.map((rule) => rule.id)).toEqual([own.id])

      // With no domain the list is the server rules, never a domain's own.
      const serverList = await list()
      expect(serverList.rules.map((rule) => rule.id)).toContain(server.id)
      expect(serverList.rules.map((rule) => rule.id)).not.toContain(own.id)
      expect(serverList.rules.every((rule) => rule.domain === null)).toBe(true)
    })

    it('accepts an added domain, on or off', async () => {
      await database.createServedDomain({ domain: 'run.example' })

      const response = await create({ text: 'Runners', domain: 'run.example' })

      expect(response.status).toBe(200)
      expect((await list('run.example')).rules).toHaveLength(1)
    })

    it('treats a null or blank domain as a server rule', async () => {
      for (const domain of [null, '', '  ']) {
        const response = await create({ text: 'For all', domain })
        expect(response.status).toBe(200)
        expect((await response.json()).domain).toBeNull()
      }
    })

    it.each([
      {
        description: 'the primary domain, which has no rules of its own',
        domain: 'llun.test',
        code: 'primary'
      },
      {
        description: 'a domain this server does not serve',
        domain: 'nowhere.example',
        code: 'unknown'
      },
      {
        description: 'something that is not a domain',
        domain: 'not a domain/path',
        code: 'invalid'
      }
    ])('refuses own rules for $description', async ({ domain, code }) => {
      const created = await create({ text: 'Nope', domain })
      expect(created.status).toBe(422)
      expect(await created.json()).toMatchObject({ code })

      const listed = await list(domain)
      expect(listed.response.status).toBe(422)
    })

    it('updates and reorders a domain rule within its own scope', async () => {
      const first = await (
        await create({ text: 'A', domain: 'club.llun.test', position: 0 })
      ).json()
      const second = await (
        await create({ text: 'B', domain: 'club.llun.test', position: 1 })
      ).json()

      for (const [rule, position] of [
        [first, 1],
        [second, 0]
      ] as const) {
        const response = await PATCH(
          new NextRequest(`https://llun.test/api/v2/admin/rules/${rule.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test',
              Referer: 'https://llun.test/'
            },
            body: JSON.stringify({ position })
          }),
          { params: Promise.resolve({ id: rule.id }) }
        )
        expect(response.status).toBe(200)
        expect((await response.json()).domain).toBe('club.llun.test')
      }

      const club = await list('club.llun.test')
      const texts = club.rules.map((rule) => rule.text)
      expect(texts.indexOf('B')).toBeLessThan(texts.indexOf('A'))
    })
  })
})
