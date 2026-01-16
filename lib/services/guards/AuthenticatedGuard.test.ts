import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabase } from '../../database/testUtils'
import { Actor } from '../../models/actor'
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

// Mock cookies from next/headers
const mockCookieValue: { value?: string } = {}
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockImplementation(() =>
    Promise.resolve({
      get: (name: string) => {
        if (name === 'activities.actor-id') {
          return mockCookieValue.value
            ? { value: mockCookieValue.value }
            : undefined
        }
        return undefined
      }
    })
  )
}))

// Mock config
jest.mock('../../config', () => ({
  getConfig: () => ({
    allowEmails: []
  })
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
    mockHandler.mockClear()
    mockCookieValue.value = undefined
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

  describe('with sub-actor selection', () => {
    let primaryActor: Actor
    let subActorId: string

    beforeAll(async () => {
      // Get the primary actor
      const actor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      if (!actor) throw new Error('Actor not found')
      primaryActor = actor

      // Create a sub-actor for the same account
      subActorId = await database.createActorForAccount({
        accountId: actor.account!.id,
        username: 'subactor',
        domain: 'llun.test',
        publicKey: 'subactor-public-key',
        privateKey: 'subactor-private-key'
      })
    })

    it('uses the primary actor when no cookie is set', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = undefined

      let capturedActor: Actor | undefined
      const handler = jest.fn().mockImplementation((_req, context) => {
        capturedActor = context.currentActor
        return NextResponse.json({ success: true }, { status: 200 })
      })

      const guard = AuthenticatedGuard(handler)
      const req = createRequest()
      await guard(req, { params: Promise.resolve({}) })

      expect(handler).toHaveBeenCalled()
      expect(capturedActor?.id).toBe(primaryActor.id)
    })

    it('uses the sub-actor when cookie is set to sub-actor id', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = subActorId

      let capturedActor: Actor | undefined
      const handler = jest.fn().mockImplementation((_req, context) => {
        capturedActor = context.currentActor
        return NextResponse.json({ success: true }, { status: 200 })
      })

      const guard = AuthenticatedGuard(handler)
      const req = createRequest()
      await guard(req, { params: Promise.resolve({}) })

      expect(handler).toHaveBeenCalled()
      expect(capturedActor?.id).toBe(subActorId)
      expect(capturedActor?.username).toBe('subactor')
    })

    it('falls back to primary actor when cookie contains invalid actor id', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = 'invalid-actor-id'

      let capturedActor: Actor | undefined
      const handler = jest.fn().mockImplementation((_req, context) => {
        capturedActor = context.currentActor
        return NextResponse.json({ success: true }, { status: 200 })
      })

      const guard = AuthenticatedGuard(handler)
      const req = createRequest()
      await guard(req, { params: Promise.resolve({}) })

      expect(handler).toHaveBeenCalled()
      expect(capturedActor?.id).toBe(primaryActor.id)
    })
  })
})
