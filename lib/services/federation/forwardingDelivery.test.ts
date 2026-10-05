import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { FORWARD_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import {
  MAX_FORWARD_INBOXES_PER_JOB,
  getForwardActivityJobMessages,
  getForwardingTargetLocalActorIds,
  isDirectDelivery,
  isPublicAudience,
  resolveForwardingInboxes,
  shouldForwardActivity
} from '@/lib/services/federation/forwardingDelivery'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

describe('forwardingDelivery', () => {
  const database = getTestSQLDatabase()
  let localActorId: string
  const originalEnv = process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    localActorId = actor1?.id as string
  })

  afterAll(async () => {
    await database.destroy()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING
    } else {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = originalEnv
    }
  })

  describe('isPublicAudience', () => {
    it('returns true when public stream is in to', () => {
      expect(isPublicAudience([ACTIVITY_STREAM_PUBLIC], [])).toBe(true)
    })

    it('returns true when public stream is in cc', () => {
      expect(isPublicAudience([], [ACTIVITY_STREAM_PUBLIC_COMPACT])).toBe(true)
      expect(isPublicAudience([], ['as:Public'])).toBe(true)
      expect(
        isPublicAudience([], ['https://www.w3.org/ns/activitystreams#Public'])
      ).toBe(true)
    })

    it('returns false when no public recipient is present', () => {
      expect(
        isPublicAudience(
          ['https://remote.test/users/bob'],
          ['https://remote.test/users/alice']
        )
      ).toBe(false)
      expect(isPublicAudience([], [])).toBe(false)
      expect(isPublicAudience(null, null)).toBe(false)
    })
  })

  describe('isDirectDelivery', () => {
    const author = 'https://remote.test/users/author'

    it('returns true for direct deliveries where signer matches author', () => {
      expect(
        isDirectDelivery({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: author
          },
          authorActorId: author
        })
      ).toBe(true)
    })

    it('returns false when verifiedSenderActorId is missing', () => {
      expect(
        isDirectDelivery({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {}
          },
          authorActorId: author
        })
      ).toBe(false)
    })

    it('returns false when verifiedSenderActorId does not match author', () => {
      expect(
        isDirectDelivery({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: 'https://other.test/users/forwarder'
          },
          authorActorId: author
        })
      ).toBe(false)
    })

    it('returns false when activityId or message ID indicates a forwarded activity', () => {
      expect(
        isDirectDelivery({
          message: {
            id: 'job-1#forwarded',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: author
          },
          authorActorId: author
        })
      ).toBe(false)

      expect(
        isDirectDelivery({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: author
          },
          authorActorId: author,
          activityId: 'https://remote.test/statuses/1#forwarded'
        })
      ).toBe(false)
    })
  })

  describe('getForwardingTargetLocalActorIds', () => {
    it('identifies local actor from inReplyTo', async () => {
      const localStatusId = `${localActorId}/statuses/parent-status-1`
      await database.createNote({
        id: localStatusId,
        url: localStatusId,
        actorId: localActorId,
        text: 'parent note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const targetIds = await getForwardingTargetLocalActorIds({
        database,
        inReplyTo: localStatusId
      })

      expect(targetIds).toContain(localActorId)
    })

    it('does not include remote status authors from inReplyTo', async () => {
      const remoteAuthor = 'https://remote.test/users/remote-user'
      await database.createActor({
        actorId: remoteAuthor,
        username: 'remote-user',
        domain: 'remote.test',
        inboxUrl: 'https://remote.test/inbox',
        sharedInboxUrl: 'https://remote.test/inbox',
        followersUrl: 'https://remote.test/followers',
        publicKey: 'pubkey',
        createdAt: Date.now()
      })
      const remoteStatusId = `${remoteAuthor}/statuses/status-1`
      await database.createNote({
        id: remoteStatusId,
        url: remoteStatusId,
        actorId: remoteAuthor,
        text: 'remote note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const targetIds = await getForwardingTargetLocalActorIds({
        database,
        inReplyTo: remoteStatusId
      })

      expect(targetIds).not.toContain(remoteAuthor)
    })

    it('identifies local actor mentioned in tags', async () => {
      const targetIds = await getForwardingTargetLocalActorIds({
        database,
        tags: [{ type: 'Mention', href: localActorId }]
      })

      expect(targetIds).toContain(localActorId)
    })

    it('identifies local actor mentioned in to/cc', async () => {
      const targetIds = await getForwardingTargetLocalActorIds({
        database,
        to: [ACTIVITY_STREAM_PUBLIC, localActorId],
        cc: []
      })

      expect(targetIds).toContain(localActorId)
    })
  })

  describe('resolveForwardingInboxes', () => {
    const authorActorId = 'https://author.example/users/author'
    const follower1ActorId = 'https://follower1.example/users/user1'
    const follower2ActorId = 'https://follower2.example/users/user2'
    const followerSameHostActorId = 'https://author.example/users/user3'
    const blockedDomainFollowerId = 'https://blocked.example/users/user4'

    beforeAll(async () => {
      await database.createFollow({
        actorId: follower1ActorId,
        targetActorId: localActorId,
        status: FollowStatus.enum.Accepted,
        inbox: 'https://follower1.example/users/user1/inbox',
        sharedInbox: 'https://follower1.example/inbox'
      })

      await database.createFollow({
        actorId: follower2ActorId,
        targetActorId: localActorId,
        status: FollowStatus.enum.Accepted,
        inbox: 'https://follower2.example/users/user2/inbox',
        sharedInbox: ''
      })

      // Follower on the same host as author
      await database.createFollow({
        actorId: followerSameHostActorId,
        targetActorId: localActorId,
        status: FollowStatus.enum.Accepted,
        inbox: 'https://author.example/users/user3/inbox',
        sharedInbox: ''
      })

      // Follower on a blocked domain
      await database.createFollow({
        actorId: blockedDomainFollowerId,
        targetActorId: localActorId,
        status: FollowStatus.enum.Accepted,
        inbox: 'https://blocked.example/inbox',
        sharedInbox: 'https://blocked.example/inbox'
      })

      await database.createDomainBlock({
        domain: 'blocked.example',
        severity: 'suspend'
      })
    })

    it('resolves remote follower inboxes with sharedInbox preferred and deduplicates', async () => {
      const inboxes = await resolveForwardingInboxes({
        database,
        targetLocalActorIds: [localActorId],
        authorActorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // follower1 sharedInbox should be included
      expect(inboxes).toContain('https://follower1.example/inbox')
      // follower2 personal inbox should be included
      expect(inboxes).toContain('https://follower2.example/users/user2/inbox')
      // follower from same host as author should be excluded
      expect(inboxes).not.toContain('https://author.example/users/user3/inbox')
      // blocked domain inbox should be excluded
      expect(inboxes).not.toContain('https://blocked.example/inbox')
    })

    it('excludes inboxes of explicit recipients in to/cc', async () => {
      const inboxes = await resolveForwardingInboxes({
        database,
        targetLocalActorIds: [localActorId],
        authorActorId,
        to: [ACTIVITY_STREAM_PUBLIC, 'https://follower1.example/inbox'],
        cc: []
      })

      expect(inboxes).not.toContain('https://follower1.example/inbox')
      expect(inboxes).toContain('https://follower2.example/users/user2/inbox')
    })
  })

  describe('shouldForwardActivity', () => {
    const author = 'https://remote.test/users/author'

    it('returns true when enabled, public, and direct delivery', () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'
      expect(
        shouldForwardActivity({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: author
          },
          authorActorId: author,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
      ).toBe(true)
    })

    it('returns false when disabled via config', () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'false'
      expect(
        shouldForwardActivity({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: author
          },
          authorActorId: author,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
      ).toBe(false)
    })

    it('returns false when not public', () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'
      expect(
        shouldForwardActivity({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: author
          },
          authorActorId: author,
          to: ['https://remote.test/users/bob'],
          cc: []
        })
      ).toBe(false)
    })

    it('returns false when not direct delivery', () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'
      expect(
        shouldForwardActivity({
          message: {
            id: 'job-1',
            name: 'CreateNoteJob',
            data: {},
            verifiedSenderActorId: 'https://other.test/users/forwarder'
          },
          authorActorId: author,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
      ).toBe(false)
    })
  })

  describe('getForwardActivityJobMessages', () => {
    const activity = { id: 'https://remote.test/statuses/1#activity' }

    it('splits a large fan-out across bounded job messages', () => {
      const inboxes = Array.from(
        { length: MAX_FORWARD_INBOXES_PER_JOB * 2 + 1 },
        (_, index) => `https://follower${index}.example/inbox`
      )

      const messages = getForwardActivityJobMessages({
        id: 'hash#forward',
        activity,
        inboxes,
        localActorId
      })

      expect(messages.map((message) => message.id)).toEqual([
        'hash#forward',
        'hash#forward-1',
        'hash#forward-2'
      ])
      const chunks = messages.map(
        (message) => (message.data as { inboxes: string[] }).inboxes
      )
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(MAX_FORWARD_INBOXES_PER_JOB)
      }
      expect(chunks.flat()).toEqual(inboxes)
      expect(
        messages.every(
          (message) =>
            message.name === FORWARD_ACTIVITY_JOB_NAME &&
            (message.data as { localActorId: string }).localActorId ===
              localActorId
        )
      ).toBe(true)
    })

    it('keeps a small fan-out in one message under its original id', () => {
      const messages = getForwardActivityJobMessages({
        id: 'hash#forward',
        activity,
        inboxes: ['https://follower.example/inbox']
      })

      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe('hash#forward')
    })
  })
})
