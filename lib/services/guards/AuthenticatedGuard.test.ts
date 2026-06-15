import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import { AuthenticatedGuard } from './AuthenticatedGuard'

// Mock auth session
const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// Mock cookies from next/headers
const mockCookieValue: { value?: string } = {}
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() =>
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
vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    allowEmails: []
  }),
  getBaseURL: () => 'https://llun.test'
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

  const createRequest = (
    method: string = 'GET',
    headers: Record<string, string> = {}
  ) => {
    return new NextRequest('https://llun.test/api/test', {
      method,
      headers
    })
  }

  const mockHandler = vi.fn().mockImplementation(() => {
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

  describe('same-origin proof for state-changing requests', () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
    })

    it('rejects a mutation without an Origin or Referer header', async () => {
      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest('POST')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('rejects a mutation with a cross-site Origin header', async () => {
      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest('POST', { Origin: 'https://attacker.test' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('allows a mutation with a same-origin Origin header', async () => {
      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest('POST', { Origin: 'https://llun.test' })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    it('allows a mutation with a same-origin Referer header', async () => {
      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest('POST', {
        Referer: 'https://llun.test/settings'
      })
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    it('does not require same-origin proof for GET requests', async () => {
      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest('GET')
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
      expect(response.headers.get('location')).toContain('/auth/signin')
    })

    it('redirects to signin when session has no email', async () => {
      mockGetServerSession.mockResolvedValue({
        user: {}
      })

      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/auth/signin')
    })

    it('redirects to signin when email not found in database', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: 'nonexistent@example.com' }
      })

      const guard = AuthenticatedGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/auth/signin')
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
      expect(response.headers.get('location')).toContain('/auth/signin')

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
      const handler = vi.fn().mockImplementation((_req, context) => {
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
      const handler = vi.fn().mockImplementation((_req, context) => {
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
      const handler = vi.fn().mockImplementation((_req, context) => {
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
