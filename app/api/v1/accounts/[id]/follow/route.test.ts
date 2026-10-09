import fetchMock from 'jest-fetch-mock'
import { NextRequest } from 'next/server'

import { follow } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { JRD_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { MockWebfinger } from '@/lib/stub/webfinger'
import { FollowStatus } from '@/lib/types/domain/follow'
import { urlToId } from '@/lib/utils/urlToId'

import { POST as followAccount } from './route'

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

// Federation side effects are not under test here; stub the network-touching
// pieces so the route exercises only its body parsing and persistence.
vi.mock('@/lib/activities', () => ({
  follow: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi
    .fn()
    .mockImplementation(({ actorId }: { actorId: string }) => ({
      id: actorId,
      type: 'Person',
      preferredUsername: 'remote-user',
      publicKey: {
        id: `${actorId}#main-key`,
        owner: actorId,
        publicKeyPem:
          '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
      }
    }))
}))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(null)
}))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn().mockResolvedValue(true)
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
    vi.clearAllMocks()
    ;(getActorPerson as jest.Mock).mockReset()
    // Recording a new remote actor asks its host for its WebFinger.
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    ;(getActorPerson as jest.Mock).mockImplementation(
      ({ actorId }: { actorId: string }) => ({
        id: actorId,
        type: 'Person',
        preferredUsername: 'remote-user',
        inbox: `${actorId}/inbox`,
        endpoints: { sharedInbox: 'https://remote.test/inbox' },
        publicKey: {
          id: `${actorId}#main-key`,
          owner: actorId,
          publicKeyPem:
            '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
        }
      })
    )
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

    // Clients sometimes send a JSON content type with no body at all.
    it.each([
      { title: 'no body is sent', headers: {} as Record<string, string> },
      {
        title: 'the JSON body is empty',
        headers: { 'Content-Type': 'application/json' }
      }
    ])(
      'defaults to reblogs=true/notify=false when $title',
      async ({ title, headers }) => {
        const targetActorId = await createFollowTargetActor(
          `follow-default-${title.replace(/\W+/g, '-')}`
        )

        const response = await followAccount(
          new NextRequest(
            `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/follow`,
            {
              method: 'POST',
              headers: { Origin: 'https://llun.test', ...headers }
            }
          ),
          { params: Promise.resolve({ id: urlToId(targetActorId) }) }
        )

        expect(response.status).toBe(200)
        const relationship = await response.json()
        expect(relationship.showing_reblogs).toBe(true)
        expect(relationship.notifying).toBe(false)
        const stored = await database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId
        })
        expect(stored).not.toBeNull()
      }
    )

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

    it('records an unrecorded remote actor in the database when following', async () => {
      const targetActorId = 'https://remote.test/users/unrecorded-remote'
      // The mocked actor document names itself `remote-user`, so the host
      // confirms that handle for this id.
      fetchMock.mockResponse(async () => ({
        status: 200,
        headers: JRD_JSON_HEADERS,
        body: JSON.stringify(
          MockWebfinger({
            account: 'remote-user@remote.test',
            userUrl: targetActorId
          })
        )
      }))

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
      expect(relationship.requested).toBe(true)

      const actor = await database.getActorFromId({ id: targetActorId })
      expect(actor).not.toBeNull()
      expect(actor?.username).toBe('remote-user')
      expect(actor?.domain).toBe('remote.test')
    })

    // getActorPerson accepts a document whose id names another origin (it
    // re-fetches that id), but recordActorIfNeeded refuses to store it. The
    // follow must not be created for an actor this instance has no row for.
    it('returns 404 and creates no follow when the target cannot be recorded', async () => {
      const targetActorId = 'https://remote.test/users/moved-away'
      ;(getActorPerson as jest.Mock).mockImplementation(() => ({
        id: 'https://elsewhere.test/users/moved-away',
        type: 'Person',
        preferredUsername: 'moved-away',
        inbox: 'https://elsewhere.test/users/moved-away/inbox'
      }))

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

      expect(response.status).toBe(404)
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId
        })
      ).resolves.toBeNull()
      expect(follow).not.toHaveBeenCalled()
    })

    // An alias URL records under the id the actor's origin names; the follow
    // must point at that row, not at the alias.
    it('follows the recorded actor id when the target is a same-origin alias', async () => {
      const aliasId = 'https://remote.test/@alias-target'
      const canonicalId = 'https://remote.test/users/alias-target'
      ;(getActorPerson as jest.Mock).mockImplementation(() => ({
        id: canonicalId,
        type: 'Person',
        preferredUsername: 'alias-target',
        inbox: `${canonicalId}/inbox`
      }))

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${encodeURIComponent(aliasId)}/follow`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: aliasId }) }
      )

      expect(response.status).toBe(200)
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId: canonicalId
        })
      ).resolves.not.toBeNull()
      expect(vi.mocked(follow).mock.calls[0]?.[2]).toBe(canonicalId)
    })
    // The client names the account by an alias while this account already
    // follows the canonical id the alias records under: that is a preference
    // update on the existing follow, not a second follow.
    it('updates the existing canonical follow when the target is an alias of it', async () => {
      const canonicalId = await createFollowTargetActor('alias-followed')
      const aliasId = 'https://remote.test/@alias-followed'
      await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId: canonicalId,
        status: FollowStatus.enum.Accepted,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: 'https://llun.test/inbox',
        reblogs: true
      })
      ;(getActorPerson as jest.Mock).mockImplementation(() => ({
        id: canonicalId,
        type: 'Person',
        preferredUsername: 'alias-followed',
        inbox: `${canonicalId}/inbox`
      }))

      const response = await followAccount(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${encodeURIComponent(aliasId)}/follow`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reblogs: false })
          }
        ),
        { params: Promise.resolve({ id: aliasId }) }
      )

      expect(response.status).toBe(200)
      expect(follow).not.toHaveBeenCalled()
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId: aliasId
        })
      ).resolves.toBeNull()
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId: canonicalId
        })
      ).resolves.toMatchObject({
        status: FollowStatus.enum.Accepted,
        reblogs: false
      })
    })
  })

  describe('Account lookup', () => {
    it('returns undefined for non-existent actor', async () => {
      const actor = await database.getActorFromUsername({
        username: 'nonexistent',
        domain: 'llun.test'
      })

      expect(actor).toBeNull()
    })
  })
})
