import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabase } from '../../database/testUtils'
import { seedDatabase } from '../../stub/database'
import { seedActor1 } from '../../stub/seed/actor1'

import { AuthenticatedGuard } from './AuthenticatedGuard'

// Mock next-auth session
const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('../../database', () => ({
  getDatabase: () => mockDatabase
}))

describe('AuthenticatedGuard', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockReset()
  })

  const createRequest = () => {
    return new NextRequest('https://llun.test/api/test', {
      method: 'GET'
    })
  }

  const mockHandler = jest.fn().mockImplementation(() => {
    return NextResponse.json({ success: true }, { status: 200 })
  })

  describe('with valid session', () => {
    it('calls handler for authenticated user', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })
  })

  describe('without session', () => {
    it('redirects to signin when no session', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/signin')
    })

    it('redirects to signin when session has no email', async () => {
      mockGetServerSession.mockResolvedValue({
        user: {}
      })

      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/signin')
    })

    it('redirects to signin when email not found in database', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: 'nonexistent@example.com' }
      })

      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/signin')
    })
  })

  describe('without database', () => {
    it('redirects to signin when database unavailable', async () => {
      const originalDb = mockDatabase
      mockDatabase = null
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/signin')

      mockDatabase = originalDb
    })
  })
})
