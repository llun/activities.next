import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { DELETE, PATCH, PUT } from './route'

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

describe('/api/v2/admin/rules/[id]', () => {
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

  const baseRequest = (id: string, init: { method: string; body?: object }) =>
    new NextRequest(
      `https://llun.test/api/v2/admin/rules/${encodeURIComponent(id)}`,
      {
        method: init.method,
        headers: init.body
          ? {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test',
              Referer: 'https://llun.test/'
            }
          : { Origin: 'https://llun.test' },
        body: init.body ? JSON.stringify(init.body) : undefined
      }
    )

  // Rails `resources` maps update to both PATCH and PUT, so admin clients may
  // send either. Binding PATCH to the same handler reference guarantees both
  // verbs behave identically.
  it('binds PATCH to the same handler as PUT', () => {
    expect(typeof PATCH).toBe('function')
    expect(PATCH).toBe(PUT)
  })

  it('updates the text and position of an existing rule', async () => {
    const rule = await database.createInstanceRule({
      text: 'Original rule',
      hint: 'Original hint',
      position: 1
    })

    const response = await PATCH(
      baseRequest(rule.id, {
        method: 'PATCH',
        body: { text: 'Updated rule', position: 5 }
      }),
      { params: Promise.resolve({ id: rule.id }) }
    )
    expect(response.status).toBe(200)
    const updated = await response.json()
    expect(updated).toEqual({
      id: rule.id,
      text: 'Updated rule',
      hint: 'Original hint',
      position: 5
    })
  })

  it('removes a rule with DELETE', async () => {
    const rule = await database.createInstanceRule({
      text: 'Temporary rule',
      hint: '',
      position: 9
    })

    const response = await DELETE(baseRequest(rule.id, { method: 'DELETE' }), {
      params: Promise.resolve({ id: rule.id })
    })
    expect(response.status).toBe(200)

    const rules = await database.getInstanceRules()
    expect(rules.find((item) => item.id === rule.id)).toBeUndefined()
  })

  it.each([
    {
      description: 'returns 422 when the updated text is empty',
      body: { text: '' }
    },
    {
      description: 'returns 422 when the updated text exceeds 1000 characters',
      body: { text: 'a'.repeat(1001) }
    },
    {
      description: 'returns 422 when the updated position is negative',
      body: { position: -1 }
    },
    {
      description:
        'returns 422 when the updated position exceeds the 32-bit int max',
      body: { position: 2147483648 }
    },
    {
      description: 'returns 422 when the body has no updatable fields',
      body: {}
    }
  ])('$description', async ({ body }) => {
    const rule = await database.createInstanceRule({
      text: 'Guarded rule',
      hint: 'Guarded hint',
      position: 2
    })

    const response = await PATCH(
      baseRequest(rule.id, { method: 'PATCH', body }),
      { params: Promise.resolve({ id: rule.id }) }
    )
    expect(response.status).toBe(422)

    const rules = await database.getInstanceRules()
    expect(rules.find((item) => item.id === rule.id)).toEqual(
      expect.objectContaining({
        text: 'Guarded rule',
        hint: 'Guarded hint',
        position: 2
      })
    )
  })

  it.each([
    {
      description: 'returns 404 when updating an unknown rule',
      handler: PATCH,
      init: { method: 'PATCH', body: { text: 'Updated rule' } }
    },
    {
      description: 'returns 404 when deleting an unknown rule',
      handler: DELETE,
      init: { method: 'DELETE' }
    }
  ])('$description', async ({ handler, init }) => {
    const response = await handler(baseRequest('unknown-rule', init), {
      params: Promise.resolve({ id: 'unknown-rule' })
    })
    expect(response.status).toBe(404)
  })
})
