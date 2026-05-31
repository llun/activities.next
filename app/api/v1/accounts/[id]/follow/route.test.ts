import { NextRequest } from 'next/server'

import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { FollowStatus } from '@/lib/types/domain/follow'
import { urlToId } from '@/lib/utils/urlToId'

import { POST as followAccount } from './route'

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

// Federation side effects are not under test here; stub the network-touching
// pieces so the route exercises only its body parsing and persistence.
jest.mock('@/lib/activities', () => ({
  follow: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: jest.fn().mockResolvedValue({ id: 'remote-person' })
}))
jest.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: jest.fn().mockResolvedValue(null)
}))
jest.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: jest.fn().mockResolvedValue(true)
}))

/**
 * Tests for Mastodon-compatible account action endpoints
 *
 * API Reference: https://docs.joinmastodon.org/methods/accounts/
 *
 * These tests verify:
 * - POST /api/v1/accounts/:id/follow - Returns Relationship
 * - POST /api/v1/accounts/:id/unfollow - Returns Relationship
 * - POST /api/v1/accounts/:id/block - Returns Relationship
 * - POST /api/v1/accounts/:id/unblock - Returns Relationship
 * - POST /api/v1/accounts/:id/mute - Returns Relationship
 * - POST /api/v1/accounts/:id/unmute - Returns Relationship
 * - GET /api/v1/accounts/lookup?acct= - Returns Account
 */
describe('Account Action Endpoints', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  describe('POST /api/v1/accounts/:id/follow body params', () => {
    const createFollowTargetActor = async (suffix: string) => {
      const actorId = `https://remote.test/users/${suffix}`
      await database.createActor({
        actorId,
        username: suffix,
        domain: 'remote.test',
        publicKey: 'key',
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://remote.test/inbox',
        followersUrl: `${actorId}/followers`,
        createdAt: Date.now()
      })
      return actorId
    }

    it('persists reblogs/notify/languages from a JSON body', async () => {
      const targetActorId = await createFollowTargetActor('follow-json')

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              reblogs: false,
              notify: true,
              languages: ['en', 'th']
            })
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      expect(response.status).toBe(200)
      const relationship = await response.json()
      expect(relationship.showing_reblogs).toBe(false)
      expect(relationship.notifying).toBe(true)
      expect(relationship.languages).toEqual(['en', 'th'])

      const stored = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      expect(stored?.reblogs).toBe(false)
      expect(stored?.notify).toBe(true)
      expect(stored?.languages).toEqual(['en', 'th'])
    })

    it('persists params from a urlencoded body (booleans + languages[])', async () => {
      const targetActorId = await createFollowTargetActor('follow-urlencoded')

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'reblogs=false&notify=true&languages[]=en&languages[]=th'
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      expect(response.status).toBe(200)
      const relationship = await response.json()
      expect(relationship.showing_reblogs).toBe(false)
      expect(relationship.notifying).toBe(true)
      expect(relationship.languages).toEqual(['en', 'th'])

      const stored = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      expect(stored?.reblogs).toBe(false)
      expect(stored?.languages).toEqual(['en', 'th'])
    })

    it('defaults to reblogs=true/notify=false when no body is sent', async () => {
      const targetActorId = await createFollowTargetActor('follow-default')

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      expect(response.status).toBe(200)
      const relationship = await response.json()
      expect(relationship.showing_reblogs).toBe(true)
      expect(relationship.notifying).toBe(false)
    })

    it('updates preferences when re-following an existing follow', async () => {
      const targetActorId = await createFollowTargetActor('follow-update')

      await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reblogs: true, notify: false })
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notify: true })
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      expect(response.status).toBe(200)
      const relationship = await response.json()
      // notify updated, reblogs left untouched from the first follow.
      // showing_reblogs reflects the stored preference on the follow row (the
      // value the client set), which the locally-initiated follow keeps in the
      // Requested state until acceptance; it is not gated on acceptance.
      expect(relationship.notifying).toBe(true)
      expect(relationship.showing_reblogs).toBe(true)
    })

    it('clears an existing language filter when languages: [] is sent', async () => {
      const targetActorId = await createFollowTargetActor('follow-clear-langs')

      await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ languages: ['en', 'th'] })
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ languages: [] })
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      expect(response.status).toBe(200)
      const stored = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      expect(stored?.languages).toBeNull()
    })

    it('treats an empty JSON body as a paramless default follow', async () => {
      const targetActorId = await createFollowTargetActor('follow-empty-json')

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            }
            // No body — clients sometimes send a default JSON header anyway.
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      expect(response.status).toBe(200)
      const relationship = await response.json()
      expect(relationship.showing_reblogs).toBe(true)
      const stored = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      expect(stored).not.toBeNull()
    })

    it('updates preferences for an existing follow even when the remote actor is unreachable', async () => {
      const targetActorId = await createFollowTargetActor('follow-offline')

      // First follow succeeds (actor reachable).
      await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notify: false })
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      // Remote actor now unreachable: getActorPerson would fail / return null.
      ;(getActorPerson as jest.Mock).mockResolvedValueOnce(null)

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notify: true })
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      // The preference update must succeed without consulting the network.
      expect(response.status).toBe(200)
      const relationship = await response.json()
      expect(relationship.notifying).toBe(true)
    })

    it('returns 422 for a malformed JSON body', async () => {
      const targetActorId = await createFollowTargetActor('follow-bad-json')

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: '{ broken json'
          }
        ),
        { params: Promise.resolve({ id: urlToId(targetActorId) }) }
      )

      expect(response.status).toBe(422)
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId
        })
      ).resolves.toBeNull()
    })
  })

  describe('getRelationship helper', () => {
    it('returns correct relationship when following', async () => {
      // Create a follow
      await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID,
        status: FollowStatus.enum.Accepted,
        inbox: `${ACTOR2_ID}/inbox`,
        sharedInbox: 'https://llun.test/inbox'
      })

      const actor1 = await database.getActorFromId({ id: ACTOR1_ID })
      const relationship = await getRelationship({
        database,
        currentActor: actor1!,
        targetActorId: ACTOR2_ID
      })

      expect(relationship).toMatchObject({
        id: urlToId(ACTOR2_ID),
        following: true,
        followed_by: expect.toBeBoolean(),
        blocking: false,
        muting: false,
        requested: false
      })
    })

    it('returns requested=true for pending follow', async () => {
      const pendingActorId = `https://llun.test/users/pending-${Date.now()}`
      await database.createActor({
        actorId: pendingActorId,
        username: `pending${Date.now()}`,
        domain: 'llun.test',
        publicKey: 'key',
        inboxUrl: `${pendingActorId}/inbox`,
        sharedInboxUrl: 'https://llun.test/inbox',
        followersUrl: `${pendingActorId}/followers`,
        createdAt: Date.now()
      })

      await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId: pendingActorId,
        status: FollowStatus.enum.Requested,
        inbox: `${pendingActorId}/inbox`,
        sharedInbox: 'https://llun.test/inbox'
      })

      const actor1 = await database.getActorFromId({ id: ACTOR1_ID })
      const relationship = await getRelationship({
        database,
        currentActor: actor1!,
        targetActorId: pendingActorId
      })

      expect(relationship.requested).toBe(true)
      expect(relationship.following).toBe(false)
    })
  })

  describe('Account lookup', () => {
    it('finds local actor by username@domain format', async () => {
      const actor = await database.getActorFromUsername({
        username: 'test1',
        domain: 'llun.test'
      })

      expect(actor).not.toBeNull()
      expect(actor?.username).toBe('test1')
    })

    it('returns undefined for non-existent actor', async () => {
      const actor = await database.getActorFromUsername({
        username: 'nonexistent',
        domain: 'llun.test'
      })

      expect(actor).toBeNull()
    })
  })
})
