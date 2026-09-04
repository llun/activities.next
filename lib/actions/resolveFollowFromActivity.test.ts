import {
  extractFollowIdCandidates,
  extractFollowIdFromUri,
  resolveFollowFromActivity
} from '@/lib/actions/resolveFollowFromActivity'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { FollowStatus } from '@/lib/types/domain/follow'

describe('resolveFollowFromActivity', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  describe('extractFollowIdCandidates', () => {
    it('extracts UUID from path', () => {
      const uuid = '01955ffb-46cb-7833-8a3c-b171f1636c2e'
      const candidates = extractFollowIdCandidates(
        `https://activities.local/follows/${uuid}`
      )
      expect(candidates).toContain(uuid)
    })

    it('extracts UUID from hash fragment', () => {
      const uuid = '01955ffb-46cb-7833-8a3c-b171f1636c2e'
      const candidates = extractFollowIdCandidates(
        `https://activities.local/actors/alice#follows/${uuid}`
      )
      expect(candidates).toContain(uuid)
    })

    it('extracts UUID from hash fragment with trailing /undo', () => {
      const uuid = '01955ffb-46cb-7833-8a3c-b171f1636c2e'
      const candidates = extractFollowIdCandidates(
        `https://activities.local/actors/alice#follows/${uuid}/undo`
      )
      expect(candidates).toContain(uuid)
    })

    it('filters out non-UUID tokens', () => {
      const candidates = extractFollowIdCandidates(
        'https://activities.local/actors/alice#follows/undo'
      )
      expect(candidates).toEqual([])
    })

    it('extracts from non-URL URI string if it contains a UUID', () => {
      const uuid = '01955ffb-46cb-7833-8a3c-b171f1636c2e'
      const candidates = extractFollowIdCandidates(`urn:follow:${uuid}`)
      expect(candidates).toContain(uuid)
    })
  })

  describe('extractFollowIdFromUri', () => {
    it('returns first candidate or null', () => {
      const uuid = '01955ffb-46cb-7833-8a3c-b171f1636c2e'
      expect(
        extractFollowIdFromUri(`https://activities.local/follows/${uuid}`)
      ).toEqual(uuid)
      expect(extractFollowIdFromUri('invalid-non-uuid')).toBeNull()
    })
  })

  describe('resolveFollowFromActivity', () => {
    it('resolves follow by candidate UUID when target actor matches activity.actor', async () => {
      const targetActorId = 'https://somewhere.test/actors/test-target-1'
      const follow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const resolved = await resolveFollowFromActivity({
        activity: {
          actor: targetActorId,
          object: `https://llun.test/${follow.id}`
        },
        database,
        recipientActorId: ACTOR1_ID
      })

      expect(resolved).toBeTruthy()
      expect(resolved?.id).toEqual(follow.id)
    })

    it('rejects candidate UUID resolution if activity.actor does not match follow.targetActorId', async () => {
      const targetActorId = 'https://somewhere.test/actors/test-target-2'
      const follow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const resolved = await resolveFollowFromActivity({
        activity: {
          actor: 'https://attacker.test/actor',
          object: `https://llun.test/${follow.id}`
        },
        database,
        recipientActorId: ACTOR1_ID
      })

      expect(resolved).toBeNull()
    })

    it('resolves follow by embedded Follow object when sender matches target and recipient matches follower', async () => {
      const targetActorId = 'https://somewhere.test/actors/test-target-3'
      const follow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const resolved = await resolveFollowFromActivity({
        activity: {
          actor: targetActorId,
          object: {
            id: `https://somewhere.test/follows/follow-xyz`,
            type: 'Follow',
            actor: ACTOR1_ID,
            object: targetActorId
          }
        },
        database,
        recipientActorId: ACTOR1_ID
      })

      expect(resolved).toBeTruthy()
      expect(resolved?.id).toEqual(follow.id)
    })

    it('rejects embedded Follow object when recipientActorId does not match follow.actorId', async () => {
      const targetActorId = 'https://somewhere.test/actors/test-target-4'
      await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const resolved = await resolveFollowFromActivity({
        activity: {
          actor: targetActorId,
          object: {
            id: `https://somewhere.test/follows/follow-xyz2`,
            type: 'Follow',
            actor: ACTOR1_ID,
            object: targetActorId
          }
        },
        database,
        recipientActorId: ACTOR2_ID
      })

      expect(resolved).toBeNull()
    })

    it('resolves follow via recipientActorId fallback when object is an arbitrary string URI', async () => {
      const targetActorId = 'https://somewhere.test/actors/test-target-5'
      const follow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const resolved = await resolveFollowFromActivity({
        activity: {
          actor: targetActorId,
          object: 'https://somewhere.test/arbitrary-opaque-string'
        },
        database,
        recipientActorId: ACTOR1_ID
      })

      expect(resolved).toBeTruthy()
      expect(resolved?.id).toEqual(follow.id)
    })
  })
})
