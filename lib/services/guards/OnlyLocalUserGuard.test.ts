import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabase } from '../../database/testUtils'
import { seedDatabase } from '../../stub/database'
import { seedActor1 } from '../../stub/seed/actor1'
import { OnlyLocalUserGuard } from './OnlyLocalUserGuard'

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('../../database', () => ({
  getDatabase: () => mockDatabase
}))

describe('OnlyLocalUserGuard', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  const createRequest = (host = 'llun.test') => {
    return new NextRequest('https://llun.test/api/test', {
      method: 'GET',
      headers: {
        host
      }
    })
  }

  const mockHandler = jest.fn().mockImplementation(() => {
    return NextResponse.json({ success: true }, { status: 200 })
  })

  beforeEach(() => {
    mockHandler.mockClear()
  })

  describe('with valid local user', () => {
    it('calls handler for local user', async () => {
      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, {
        params: Promise.resolve({ username: seedActor1.username })
      })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })
  })

  describe('with invalid user', () => {
    it('returns 404 when user not found', async () => {
      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, {
        params: Promise.resolve({ username: 'nonexistent' })
      })

      expect(response.status).toBe(404)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })

  describe('without database', () => {
    it('returns 500 when database unavailable', async () => {
      const originalDb = mockDatabase
      mockDatabase = null

      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, {
        params: Promise.resolve({ username: seedActor1.username })
      })

      expect(response.status).toBe(500)
      expect(mockHandler).not.toHaveBeenCalled()

      mockDatabase = originalDb
    })
  })
})
