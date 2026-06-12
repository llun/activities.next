import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret',
    allowEmails: []
  })
}))

const params = { params: Promise.resolve({}) }

describe('GET /api/v1/instance/rules', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  it('returns stored rules as Mastodon Rule entities in position order', async () => {
    const second = await database.createInstanceRule({
      text: 'Be kind to each other',
      hint: 'Harassment is not tolerated',
      position: 2
    })
    const first = await database.createInstanceRule({
      text: 'No spam',
      hint: '',
      position: 1
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/rules'),
      params
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([
      { id: first.id, text: 'No spam', hint: '' },
      {
        id: second.id,
        text: 'Be kind to each other',
        hint: 'Harassment is not tolerated'
      }
    ])
  })

  it('returns an error when the database is unavailable', async () => {
    mockDatabase = null
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance/rules'),
        params
      )
      expect(response.status).toBe(500)
    } finally {
      mockDatabase = database
    }
  })

  it('returns a JSON 500 when loading rules throws', async () => {
    const spy = jest
      .spyOn(database, 'getInstanceRules')
      .mockRejectedValueOnce(new Error('connection lost'))
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance/rules'),
        params
      )
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: 'Failed to load rules'
      })
    } finally {
      spy.mockRestore()
    }
  })
})
