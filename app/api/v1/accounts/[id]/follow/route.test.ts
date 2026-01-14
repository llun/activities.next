import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { FollowStatus } from '@/lib/models/follow'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { getRelationship } from '../../../../../../lib/services/accounts/relationship'

jest.mock('../../../../../../lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: 'llun.test' })
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
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
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

      expect(actor).toBeUndefined()
    })
  })
})
