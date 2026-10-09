import { createLocalAccount } from '@/lib/database/sql/listTestHelpers'
import { decreaseCounterValue } from '@/lib/database/sql/utils/counter'
import { selectFollowTargetActorIds } from '@/lib/database/sql/utils/followTargetActorIds'
import { isSQLiteClient } from '@/lib/database/sql/utils/knex'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import { LIST_OWNER_BACKFILL_MAX_POSTS } from '@/lib/services/timelines/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { createDeferred } from '@/lib/testing/deferred'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ListRepliesPolicy } from '@/lib/types/domain/list'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { isDirectStatus } from '@/lib/utils/directStatus'

// Pass-throughs, so a race test can hold one side of a race at a known point
// (mockImplementationOnce) while every other call runs the real helper.
vi.mock(
  '@/lib/database/sql/utils/followTargetActorIds',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/database/sql/utils/followTargetActorIds')
      >()
    return {
      ...actual,
      selectFollowTargetActorIds: vi.fn(actual.selectFollowTargetActorIds)
    }
  }
)
vi.mock('@/lib/database/sql/utils/counter', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/database/sql/utils/counter')>()
  return { ...actual, decreaseCounterValue: vi.fn(actual.decreaseCounterValue) }
})

describe('ListDatabase membership and eligibility', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  // Runs on every configured backend (TEST_DATABASE_TYPE=pg included): the
  // list-eligibility filter and the pending-member gate are SQL the two
  // backends must agree on. The database is shared across these tests, so each
  // one uses its own actors.
  describe.each(table)('membership and eligibility (%s)', (_, database) => {
    const localActor = async (username: string) => {
      await createLocalAccount(database, username)
      const actor = await database.getActorFromUsername({
        username,
        domain: TEST_DOMAIN
      })
      if (!actor) throw new Error(`${username} not created`)
      return actor
    }

    const note = (
      actorId: string,
      localId: string,
      to: string[],
      {
        cc = [],
        createdAt,
        reply
      }: { cc?: string[]; createdAt?: number; reply?: string } = {}
    ) =>
      database.createNote({
        id: `${actorId}/statuses/${localId}`,
        url: `${actorId}/statuses/${localId}`,
        actorId,
        text: localId,
        to,
        cc,
        ...(createdAt === undefined ? {} : { createdAt }),
        ...(reply === undefined ? {} : { reply })
      })

    const listTimelineIds = async (
      listId: string,
      ownerId: string,
      limit?: number
    ) =>
      (
        await database.getListTimeline({
          listId,
          actorId: ownerId,
          ...(limit === undefined ? {} : { limit })
        })
      ).map((status) => status.id)

    it('shows the owner’s own posts once they join their own list, but never their direct messages', async () => {
      const owner = await localActor('self-list-owner')
      const stranger = await localActor('self-list-stranger')
      const publicPost = await note(owner.id, 'public', [
        ACTIVITY_STREAM_PUBLIC
      ])
      const followersOnlyPost = await note(owner.id, 'followers-only', [
        `${owner.id}/followers`
      ])
      const directMessage = await note(owner.id, 'direct', [stranger.id])

      const list = await database.createList({
        actorId: owner.id,
        title: 'Including me'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [owner.id]
      })
      expect(
        (
          await database.getListAccounts({
            listId: list.id,
            actorId: owner.id
          })
        ).accounts
      ).toHaveLength(1)

      // Posts written after joining fan in like any member's.
      const laterPost = await note(owner.id, 'later-public', [
        ACTIVITY_STREAM_PUBLIC
      ])
      await database.addStatusToListTimelines({ status: laterPost })
      const laterDirectMessage = await note(owner.id, 'later-direct', [
        stranger.id
      ])
      await database.addStatusToListTimelines({ status: laterDirectMessage })

      const ids = await listTimelineIds(list.id, owner.id)
      expect(ids).toEqual(
        expect.arrayContaining([
          publicPost.id,
          followersOnlyPost.id,
          laterPost.id
        ])
      )
      expect(ids).not.toContain(directMessage.id)
      expect(ids).not.toContain(laterDirectMessage.id)
    })

    it('keeps a member’s direct message to the owner out of the list', async () => {
      const owner = await localActor('dm-list-owner')
      const member = await localActor('dm-list-member')
      await database.createFollow({
        actorId: owner.id,
        targetActorId: member.id,
        status: FollowStatus.enum.Accepted,
        inbox: `${member.id}/inbox`,
        sharedInbox: `${member.id}/inbox`
      })
      const publicPost = await note(member.id, 'public', [
        ACTIVITY_STREAM_PUBLIC
      ])
      // The owner is a recipient, so the visibility filter alone lets both DMs
      // through; both are materialized (one by the add backfill, one by the
      // fan-out), which is what makes this a read-time check.
      const earlierDirectMessage = await note(member.id, 'dm-before-add', [
        owner.id
      ])

      const list = await database.createList({
        actorId: owner.id,
        title: 'Friends'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })
      const laterDirectMessage = await note(member.id, 'dm-after-add', [
        owner.id
      ])
      await database.addStatusToListTimelines({ status: laterDirectMessage })

      const ids = await listTimelineIds(list.id, owner.id)
      expect(ids).toContain(publicPost.id)
      expect(ids).not.toContain(earlierDirectMessage.id)
      expect(ids).not.toContain(laterDirectMessage.id)
    })

    it.each([
      {
        // Friendica names its followers collection /followers/<nick>, so
        // only the author's stored followers URL marks the post as
        // followers-only rather than direct.
        description:
          'keeps followers-only posts whose followers collection lacks the /followers suffix',
        ownerUsername: 'friendica-list-owner',
        authorId: 'https://friendica.test/profile/friend',
        authorUsername: 'friend',
        authorDomain: 'friendica.test',
        storedFollowersUrl: 'https://friendica.test/followers/friend',
        addressedTo: 'https://friendica.test/followers/friend'
      },
      {
        // The stored URL differs from the address, so only getVisibility's
        // own `/followers` suffix test marks the post as followers-only.
        description:
          'keeps followers-only posts addressed to a /followers collection that is not the stored one',
        ownerUsername: 'suffix-list-owner',
        authorId: 'https://suffix.test/users/author',
        authorUsername: 'author',
        authorDomain: 'suffix.test',
        storedFollowersUrl: 'https://suffix.test/collections/author-followers',
        addressedTo: 'https://suffix.test/users/author/followers'
      }
    ])(
      '$description',
      async ({
        ownerUsername,
        authorId,
        authorUsername,
        authorDomain,
        storedFollowersUrl,
        addressedTo
      }) => {
        const owner = await localActor(ownerUsername)
        await database.createActor({
          actorId: authorId,
          username: authorUsername,
          domain: authorDomain,
          inboxUrl: `${authorId}/inbox`,
          sharedInboxUrl: `https://${authorDomain}/inbox`,
          followersUrl: storedFollowersUrl,
          publicKey: 'public-key',
          createdAt: Date.now()
        })
        await database.createFollow({
          actorId: owner.id,
          targetActorId: authorId,
          status: FollowStatus.enum.Accepted,
          inbox: `${authorId}/inbox`,
          sharedInbox: `https://${authorDomain}/inbox`
        })
        const followersOnlyPost = await note(authorId, 'followers-only', [
          addressedTo
        ])

        const list = await database.createList({
          actorId: owner.id,
          title: 'Followers-only'
        })
        await database.addListAccounts({
          listId: list.id,
          actorId: owner.id,
          targetActorIds: [authorId]
        })

        expect(await listTimelineIds(list.id, owner.id)).toContain(
          followersOnlyPost.id
        )
      }
    )

    it('keeps posts addressed to someone else’s followers collection, as Home does', async () => {
      const owner = await localActor('group-cc-list-owner')
      const member = await localActor('group-cc-list-member')
      // The owner is a direct recipient, so the visibility filter lets this
      // through and only the eligibility filter's `/followers` suffix term
      // decides: the collection is neither the author's own nor stored.
      const groupPost = await note(member.id, 'group-cc', [owner.id], {
        cc: ['https://groups.test/g/runners/followers']
      })
      // Home routing treats it as followers-only, not direct.
      expect(isDirectStatus(groupPost)).toBe(false)

      const list = await database.createList({
        actorId: owner.id,
        title: 'Group cc'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      expect(await listTimelineIds(list.id, owner.id)).toContain(groupPost.id)
    })

    it('keeps unlisted posts whose only public address is in cc', async () => {
      const owner = await localActor('unlisted-list-owner')
      const member = await localActor('unlisted-list-member')
      const stranger = await localActor('unlisted-list-stranger')
      // No followers collection in `to`, so only the `cc` recipient row can
      // make this post list-eligible.
      const unlistedPost = await note(member.id, 'unlisted', [stranger.id], {
        cc: [ACTIVITY_STREAM_PUBLIC]
      })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Unlisted'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      expect(await listTimelineIds(list.id, owner.id)).toContain(
        unlistedPost.id
      )
    })

    it.each([
      ['none', ['own-post', 'self-reply']],
      ['list', ['own-post', 'self-reply', 'reply-to-member']],
      [
        'followed',
        [
          'own-post',
          'self-reply',
          'reply-to-member',
          'reply-to-followed',
          'reply-to-stranger',
          'reply-to-absent'
        ]
      ]
    ] as [ListRepliesPolicy, string[]][])(
      'applies repliesPolicy=%s to the owner’s own replies as Mastodon does',
      async (repliesPolicy, visibleNames) => {
        // Mastodon's filter_from_list? hides the owner's replies to anyone
        // but themselves under 'none' and to non-members under 'list'. Under
        // 'followed' it never filters, and filter_from_home returns early for
        // the receiver's own statuses, so every one of them passes, a reply
        // to an unstored parent included.
        const prefix = `own-replies-${repliesPolicy}`
        const owner = await localActor(`${prefix}-owner`)
        const member = await localActor(`${prefix}-member`)
        const followed = await localActor(`${prefix}-followed`)
        const stranger = await localActor(`${prefix}-stranger`)
        for (const target of [member, followed]) {
          await database.createFollow({
            actorId: owner.id,
            targetActorId: target.id,
            status: FollowStatus.enum.Accepted,
            inbox: `${target.id}/inbox`,
            sharedInbox: `${target.id}/inbox`
          })
        }
        const publicAudience = [ACTIVITY_STREAM_PUBLIC]
        const ownPost = await note(owner.id, 'own-post', publicAudience)
        const parentOf = async (authorId: string) =>
          (await note(authorId, 'parent', publicAudience)).id
        const replyTo = async (localId: string, parentId: string) =>
          (await note(owner.id, localId, publicAudience, { reply: parentId }))
            .id
        const ownIds: Record<string, string> = {
          'own-post': ownPost.id,
          'self-reply': await replyTo('self-reply', ownPost.id),
          'reply-to-member': await replyTo(
            'reply-to-member',
            await parentOf(member.id)
          ),
          'reply-to-followed': await replyTo(
            'reply-to-followed',
            await parentOf(followed.id)
          ),
          'reply-to-stranger': await replyTo(
            'reply-to-stranger',
            await parentOf(stranger.id)
          ),
          'reply-to-absent': await replyTo(
            'reply-to-absent',
            'https://absent.test/statuses/gone'
          )
        }

        const list = await database.createList({
          actorId: owner.id,
          title: `Own replies (${repliesPolicy})`,
          repliesPolicy
        })
        await database.addListAccounts({
          listId: list.id,
          actorId: owner.id,
          targetActorIds: [owner.id, member.id]
        })

        const listed = new Set(await listTimelineIds(list.id, owner.id, 50))
        expect(
          Object.entries(ownIds)
            .filter(([, id]) => listed.has(id))
            .map(([name]) => name)
            .sort()
        ).toEqual([...visibleNames].sort())
      }
    )

    it('never treats a boost as a direct message', async () => {
      const owner = await localActor('boost-list-owner')
      const member = await localActor('boost-list-member')
      const original = await note(member.id, 'original', [
        ACTIVITY_STREAM_PUBLIC
      ])
      // Addressed to one person, a boost has neither a public nor a
      // followers recipient; isDirectStatus still never calls a boost direct,
      // so the list must not either.
      const boost = await database.createAnnounce({
        id: `${member.id}/statuses/boost`,
        actorId: member.id,
        to: [owner.id],
        cc: [],
        originalStatusId: original.id
      })
      if (!boost) throw new Error('boost not created')

      const list = await database.createList({
        actorId: owner.id,
        title: 'Boosts'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      expect(await listTimelineIds(list.id, owner.id)).toContain(boost.id)
    })

    it('backfills the owner and another member added in the same call', async () => {
      const owner = await localActor('batch-list-owner')
      const member = await localActor('batch-list-member')
      const memberPost = await note(member.id, 'member-post', [
        ACTIVITY_STREAM_PUBLIC
      ])
      const ownPost = await note(owner.id, 'own-post', [ACTIVITY_STREAM_PUBLIC])

      const list = await database.createList({
        actorId: owner.id,
        title: 'Batch'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [owner.id, member.id]
      })

      expect(await listTimelineIds(list.id, owner.id)).toEqual(
        expect.arrayContaining([memberPost.id, ownPost.id])
      )
    })

    it('keeps the owner on their own list when a self-follow is undone', async () => {
      // No follow backs the owner's own membership, so undoing a follow of
      // themselves must not trigger the unfollow cleanup for it.
      const owner = await localActor('self-follow-owner')
      await database.createFollow({
        actorId: owner.id,
        targetActorId: owner.id,
        status: FollowStatus.enum.Accepted,
        inbox: `${owner.id}/inbox`,
        sharedInbox: `${owner.id}/inbox`
      })
      const ownPost = await note(owner.id, 'public', [ACTIVITY_STREAM_PUBLIC])
      const list = await database.createList({
        actorId: owner.id,
        title: 'Self follow'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [owner.id]
      })

      const follow = await database.getAcceptedOrRequestedFollow({
        actorId: owner.id,
        targetActorId: owner.id
      })
      if (!follow) throw new Error('self-follow not created')
      await database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Undo
      })

      expect(
        (
          await database.getListAccounts({
            listId: list.id,
            actorId: owner.id
          })
        ).accounts
      ).toHaveLength(1)
      expect(await listTimelineIds(list.id, owner.id)).toContain(ownPost.id)
    })

    it('backfills only the owner’s most recent posts other than direct messages', async () => {
      const owner = await localActor('capped-list-owner')
      const stranger = await localActor('capped-list-stranger')
      const startedAt = Date.UTC(2026, 0, 1)
      const postIds: string[] = []
      for (let index = 0; index <= LIST_OWNER_BACKFILL_MAX_POSTS; index++) {
        const post = await note(
          owner.id,
          `post-${index}`,
          [ACTIVITY_STREAM_PUBLIC],
          { createdAt: startedAt + index * 1000 }
        )
        postIds.push(post.id)
      }
      // The newest post is a DM. It must not spend one of the capped slots.
      await note(owner.id, 'newest-dm', [stranger.id], {
        createdAt: startedAt + (LIST_OWNER_BACKFILL_MAX_POSTS + 1) * 1000
      })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Capped'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [owner.id]
      })

      // Newest first: every post except the single oldest one.
      expect(
        await listTimelineIds(
          list.id,
          owner.id,
          LIST_OWNER_BACKFILL_MAX_POSTS + 10
        )
      ).toEqual(postIds.slice(1).reverse())
    })

    // Mastodon ≥ 4.2 lets an account the owner has only requested to follow
    // join a list; its posts reach the list once the request is accepted.
    describe('pending members', () => {
      const follow = (
        actorId: string,
        targetActorId: string,
        status: FollowStatus
      ) =>
        database.createFollow({
          actorId,
          targetActorId,
          status,
          inbox: `${targetActorId}/inbox`,
          sharedInbox: `${targetActorId}/inbox`
        })
      const publicNote = (actorId: string, localId: string) =>
        note(actorId, localId, [ACTIVITY_STREAM_PUBLIC])
      // A post written once the list is set up, which only the new-status
      // fan-out can bring in.
      const publish = async (actorId: string, localId: string) => {
        const status = await publicNote(actorId, localId)
        await database.addStatusToListTimelines({ status })
        return status
      }
      const createListWith = async (
        ownerId: string,
        title: string,
        memberIds: string[]
      ) => {
        const list = await database.createList({ actorId: ownerId, title })
        await database.addListAccounts({
          listId: list.id,
          actorId: ownerId,
          targetActorIds: memberIds
        })
        return list
      }
      const listIdsHolding = async (ownerId: string, memberId: string) =>
        (
          await database.getListsWithAccount({
            actorId: ownerId,
            targetActorId: memberId
          })
        ).map((list) => list.id)
      const sortedTimelineIds = async (listId: string, ownerId: string) =>
        [...(await listTimelineIds(listId, ownerId))].sort()

      it('keeps a pending member on the list but out of its feed', async () => {
        const owner = await localActor('pending-owner')
        const pending = await localActor('pending-member')
        const followed = await localActor('pending-followed')
        await follow(owner.id, pending.id, FollowStatus.enum.Requested)
        await follow(owner.id, followed.id, FollowStatus.enum.Accepted)
        await publicNote(pending.id, 'before-add')
        const followedEarlier = await publicNote(followed.id, 'before-add')

        const list = await createListWith(owner.id, 'Pending', [
          pending.id,
          followed.id
        ])
        await publish(pending.id, 'after-add')
        const followedLater = await publish(followed.id, 'after-add')

        expect(await listIdsHolding(owner.id, pending.id)).toEqual([list.id])
        expect(await sortedTimelineIds(list.id, owner.id)).toEqual(
          [followedEarlier.id, followedLater.id].sort()
        )
      })

      it('holds a pending member’s posts back only from the owner still waiting', async () => {
        const waitingOwner = await localActor('waiting-owner')
        const followingOwner = await localActor('waiting-following-owner')
        const member = await localActor('waiting-member')
        await follow(waitingOwner.id, member.id, FollowStatus.enum.Requested)
        await follow(followingOwner.id, member.id, FollowStatus.enum.Accepted)
        const waitingList = await createListWith(waitingOwner.id, 'Waiting', [
          member.id
        ])
        const followingList = await createListWith(
          followingOwner.id,
          'Following',
          [member.id]
        )

        const post = await publish(member.id, 'post')

        expect(
          await listTimelineIds(followingList.id, followingOwner.id)
        ).toEqual([post.id])
        expect(await listTimelineIds(waitingList.id, waitingOwner.id)).toEqual(
          []
        )
      })

      it('keeps the owner’s own posts flowing while a follow of themselves is pending', async () => {
        // Nothing stops an owner following themselves, and a locked account's
        // follow of itself stays pending. The owner's membership of their own
        // list never rides on a follow, so it must not hold their posts back.
        const owner = await localActor('pending-self-owner')
        await follow(owner.id, owner.id, FollowStatus.enum.Requested)
        const list = await createListWith(owner.id, 'Me', [owner.id])

        const post = await publish(owner.id, 'after-add')

        expect(await listTimelineIds(list.id, owner.id)).toEqual([post.id])
      })

      it('brings a pending member’s posts into each of the owner’s lists once the request is accepted', async () => {
        const owner = await localActor('accepted-owner')
        const otherOwner = await localActor('accepted-other-owner')
        const member = await localActor('accepted-member')
        const request = await follow(
          owner.id,
          member.id,
          FollowStatus.enum.Requested
        )
        await follow(otherOwner.id, member.id, FollowStatus.enum.Requested)
        const beforeAdd = await publicNote(member.id, 'before-add')
        const lists = [
          await createListWith(owner.id, 'First', [member.id]),
          await createListWith(owner.id, 'Second', [member.id])
        ]
        const otherList = await createListWith(otherOwner.id, 'Other', [
          member.id
        ])
        const whilePending = await publish(member.id, 'while-pending')

        await database.updateFollowStatus({
          followId: request.id,
          status: FollowStatus.enum.Accepted
        })
        const afterAccept = await publish(member.id, 'after-accept')

        for (const list of lists) {
          expect(await sortedTimelineIds(list.id, owner.id)).toEqual(
            [beforeAdd.id, whilePending.id, afterAccept.id].sort()
          )
        }
        // The other owner is still waiting on a request of their own.
        expect(await listTimelineIds(otherList.id, otherOwner.id)).toEqual([])
      })

      it.each([
        {
          description: 'rejected while pending',
          key: 'rejected-pending',
          from: FollowStatus.enum.Requested,
          to: FollowStatus.enum.Rejected
        },
        {
          description: 'withdrawn while pending',
          key: 'withdrawn-pending',
          from: FollowStatus.enum.Requested,
          to: FollowStatus.enum.Undo
        },
        {
          // How a remote account removes a follower.
          description: 'rejected after it was accepted',
          key: 'rejected-accepted',
          from: FollowStatus.enum.Accepted,
          to: FollowStatus.enum.Rejected
        }
      ])(
        'drops the member from the owner’s lists when the follow is $description',
        async ({ key, from, to }) => {
          const owner = await localActor(`${key}-owner`)
          const member = await localActor(`${key}-member`)
          const relationship = await follow(owner.id, member.id, from)
          await publicNote(member.id, 'post')
          const lists = [
            await createListWith(owner.id, 'First', [member.id]),
            await createListWith(owner.id, 'Second', [member.id])
          ]

          await database.updateFollowStatus({
            followId: relationship.id,
            status: to
          })

          expect(await listIdsHolding(owner.id, member.id)).toEqual([])
          for (const list of lists) {
            expect(await listTimelineIds(list.id, owner.id)).toEqual([])
          }
        }
      )

      it('keeps a membership a newer request backs when a stale request is rejected', async () => {
        const owner = await localActor('stale-reject-owner')
        const member = await localActor('stale-reject-member')
        const withdrawn = await follow(
          owner.id,
          member.id,
          FollowStatus.enum.Requested
        )
        await database.updateFollowStatus({
          followId: withdrawn.id,
          status: FollowStatus.enum.Undo
        })
        await follow(owner.id, member.id, FollowStatus.enum.Requested)
        const list = await createListWith(owner.id, 'Re-requested', [member.id])

        // The account's Reject of the withdrawn request arrives late; the
        // inbox resolves a Reject to its follow row by id, whatever its status.
        await database.updateFollowStatus({
          followId: withdrawn.id,
          status: FollowStatus.enum.Rejected
        })

        expect(await listIdsHolding(owner.id, member.id)).toEqual([list.id])
      })
    })
  })
})

describe('addListAccounts with requireFollowOrRequest', () => {
  // The raw Knex instance is what lets a race test see that one side is
  // blocked, so this suite uses getTestDatabaseWithInstance (which honours
  // TEST_DATABASE_TYPE like getTestDatabaseTable) on a database of its own.
  const { database, instance, prepare } = getTestDatabaseWithInstance(true)

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    // mockReset restores each pass-through's real implementation and drops
    // any Once a failed test left unconsumed.
    vi.mocked(selectFollowTargetActorIds).mockReset()
    vi.mocked(decreaseCounterValue).mockReset()
  })

  const localActor = async (username: string) => {
    await createLocalAccount(database, username)
    const actor = await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })
    if (!actor) throw new Error(`${username} not created`)
    return actor
  }
  const follow = (
    actorId: string,
    targetActorId: string,
    status: FollowStatus
  ) =>
    database.createFollow({
      actorId,
      targetActorId,
      status,
      inbox: `${targetActorId}/inbox`,
      sharedInbox: `${targetActorId}/inbox`
    })
  const publicNote = (actorId: string, localId: string) =>
    database.createNote({
      id: `${actorId}/statuses/${localId}`,
      url: `${actorId}/statuses/${localId}`,
      actorId,
      text: localId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
  const listIdsHolding = async (ownerId: string, memberId: string) =>
    (
      await database.getListsWithAccount({
        actorId: ownerId,
        targetActorId: memberId
      })
    ).map((list) => list.id)
  const listTimelineIds = async (listId: string, ownerId: string) =>
    (await database.getListTimeline({ listId, actorId: ownerId })).map(
      (status) => status.id
    )

  // True once another connection is stuck: on PostgreSQL a backend waiting on
  // a row lock, on SQLite a caller queued for its single connection.
  const isAnotherConnectionWaiting = async () => {
    if (isSQLiteClient(instance)) {
      return instance.client.pool.numPendingAcquires() > 0
    }
    const { rows } = await instance.raw<{ rows: { waiting: number }[] }>(
      `select count(*)::int as waiting from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`
    )
    return rows[0].waiting > 0
  }
  // Resolves when `operation` settles or is seen blocked, whichever is first.
  const settledOrBlocked = async (operation: Promise<unknown>) => {
    let settled = false
    const done = operation.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    const blocked = (async () => {
      while (!settled) {
        if (await isAnotherConnectionWaiting()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })()
    await Promise.race([done, blocked])
    settled = true
  }

  it('adds the owner and accounts they follow or asked to follow', async () => {
    const owner = await localActor('require-owner')
    const followed = await localActor('require-followed')
    const requested = await localActor('require-requested')
    await follow(owner.id, followed.id, FollowStatus.enum.Accepted)
    await follow(owner.id, requested.id, FollowStatus.enum.Requested)
    const list = await database.createList({ actorId: owner.id, title: 'Ok' })

    const result = await database.addListAccounts({
      listId: list.id,
      actorId: owner.id,
      targetActorIds: [owner.id, followed.id, requested.id],
      requireFollowOrRequest: true
    })

    expect(result).toEqual({ unrelatedActorIds: [] })
    for (const memberId of [owner.id, followed.id, requested.id]) {
      expect(await listIdsHolding(owner.id, memberId)).toEqual([list.id])
    }
  })

  it.each([
    { description: 'was never followed', key: 'never', ended: undefined },
    {
      description: 'had its request withdrawn',
      key: 'undone',
      ended: FollowStatus.enum.Undo
    },
    {
      description: 'rejected the request',
      key: 'rejected',
      ended: FollowStatus.enum.Rejected
    }
  ])('adds nobody when one account $description', async ({ key, ended }) => {
    const owner = await localActor(`${key}-unrelated-owner`)
    const other = await localActor(`${key}-unrelated-other`)
    const followed = await localActor(`${key}-unrelated-followed`)
    const unrelated = await localActor(`${key}-unrelated-member`)
    await follow(owner.id, followed.id, FollowStatus.enum.Accepted)
    // Someone else's follow of the account says nothing about the owner's.
    await follow(other.id, unrelated.id, FollowStatus.enum.Accepted)
    if (ended) {
      const relationship = await follow(
        owner.id,
        unrelated.id,
        FollowStatus.enum.Requested
      )
      await database.updateFollowStatus({
        followId: relationship.id,
        status: ended
      })
    }
    const list = await database.createList({
      actorId: owner.id,
      title: 'Unrelated'
    })

    const result = await database.addListAccounts({
      listId: list.id,
      actorId: owner.id,
      targetActorIds: [followed.id, unrelated.id, unrelated.id],
      requireFollowOrRequest: true
    })

    expect(result).toEqual({ unrelatedActorIds: [unrelated.id] })
    expect(await listIdsHolding(owner.id, followed.id)).toEqual([])
    expect(await listIdsHolding(owner.id, unrelated.id)).toEqual([])
  })

  // The check runs first and the follow ends before the insert: the ending
  // must wait for the insert and then remove the membership it made.
  it.each([
    {
      description: 'the member rejects the request',
      key: 'race-reject',
      from: FollowStatus.enum.Requested,
      to: FollowStatus.enum.Rejected
    },
    {
      description: 'the owner withdraws the request',
      key: 'race-withdraw',
      from: FollowStatus.enum.Requested,
      to: FollowStatus.enum.Undo
    },
    {
      description: 'the owner unfollows',
      key: 'race-unfollow',
      from: FollowStatus.enum.Accepted,
      to: FollowStatus.enum.Undo
    }
  ])(
    'leaves no membership behind when $description between the check and the insert',
    async ({ key, from, to }) => {
      const owner = await localActor(`${key}-owner`)
      const member = await localActor(`${key}-member`)
      const relationship = await follow(owner.id, member.id, from)
      await publicNote(member.id, 'post')
      const list = await database.createList({
        actorId: owner.id,
        title: 'Race'
      })

      // Hold the add right after its relationship check has run.
      const { selectFollowTargetActorIds: realSelect } = await vi.importActual<
        typeof import('@/lib/database/sql/utils/followTargetActorIds')
      >('@/lib/database/sql/utils/followTargetActorIds')
      const checked = createDeferred<void>()
      const resume = createDeferred<void>()
      vi.mocked(selectFollowTargetActorIds).mockImplementationOnce(
        async (...args) => {
          const actorIds = await realSelect(...args)
          checked.resolve()
          await resume.promise
          return actorIds
        }
      )

      const adding = database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id],
        requireFollowOrRequest: true
      })
      await checked.promise
      const ending = database.updateFollowStatus({
        followId: relationship.id,
        status: to
      })
      await settledOrBlocked(ending)
      resume.resolve()
      await Promise.all([adding, ending])

      expect(await listIdsHolding(owner.id, member.id)).toEqual([])
      expect(await listTimelineIds(list.id, owner.id)).toEqual([])
    }
  )

  // The follow is already ending when the check runs: the check must wait for
  // it and then refuse the account instead of reading the old status.
  it('refuses an account whose follow is being undone while it checks', async () => {
    const owner = await localActor('race-undoing-owner')
    const member = await localActor('race-undoing-member')
    const relationship = await follow(
      owner.id,
      member.id,
      FollowStatus.enum.Accepted
    )
    const list = await database.createList({
      actorId: owner.id,
      title: 'Undoing'
    })

    // Hold the undo after it has updated the follow row, before it commits.
    const { decreaseCounterValue: realDecrease } = await vi.importActual<
      typeof import('@/lib/database/sql/utils/counter')
    >('@/lib/database/sql/utils/counter')
    const updated = createDeferred<void>()
    const resume = createDeferred<void>()
    vi.mocked(decreaseCounterValue).mockImplementationOnce(async (...args) => {
      updated.resolve()
      await resume.promise
      return realDecrease(...args)
    })

    const ending = database.updateFollowStatus({
      followId: relationship.id,
      status: FollowStatus.enum.Undo
    })
    await updated.promise
    const adding = database.addListAccounts({
      listId: list.id,
      actorId: owner.id,
      targetActorIds: [member.id],
      requireFollowOrRequest: true
    })
    await settledOrBlocked(adding)
    resume.resolve()
    const [result] = await Promise.all([adding, ending])

    expect(result).toEqual({ unrelatedActorIds: [member.id] })
    expect(await listIdsHolding(owner.id, member.id)).toEqual([])
  })
})
