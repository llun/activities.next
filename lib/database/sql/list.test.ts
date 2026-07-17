import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { Timeline } from '@/lib/services/timelines/types'
import { EXTERNAL_ACTORS, TEST_DOMAIN } from '@/lib/stub/const'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ListRepliesPolicy } from '@/lib/types/domain/list'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

const createLocalAccount = (database: Database, username: string) =>
  database.createAccount({
    email: `${username}@${TEST_DOMAIN}`,
    username,
    passwordHash: 'hash',
    domain: TEST_DOMAIN,
    privateKey: `privateKey-${username}`,
    publicKey: `publicKey-${username}`
  })

// Replies-policy scenarios: a list member (memberFollowed) authors one reply of
// each kind. The PARENT's author is what the policy filters on.
type ReplyScenario =
  | 'nonReply'
  | 'selfReply'
  | 'replyToOwner'
  | 'replyToMember'
  | 'replyToFollowed'
  | 'replyToStranger'
  | 'replyToAbsent'

const ALL_REPLY_SCENARIOS: ReplyScenario[] = [
  'nonReply',
  'selfReply',
  'replyToOwner',
  'replyToMember',
  'replyToFollowed',
  'replyToStranger',
  'replyToAbsent'
]

const setupRepliesPolicyFixture = async (
  database: Database,
  repliesPolicy: ListRepliesPolicy
) => {
  for (const username of [
    'owner',
    'memberFollowed',
    'memberUnfollowed',
    'followedNonMember',
    'stranger'
  ]) {
    await createLocalAccount(database, username)
  }
  const actor = async (username: string) => {
    const found = await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })
    if (!found) throw new Error(`${username} not created`)
    return found
  }
  const owner = await actor('owner')
  const memberFollowed = await actor('memberFollowed')
  const memberUnfollowed = await actor('memberUnfollowed')
  const followedNonMember = await actor('followedNonMember')
  const stranger = await actor('stranger')

  // Owner follows memberFollowed and followedNonMember (Accepted).
  for (const target of [memberFollowed, followedNonMember]) {
    await database.createFollow({
      actorId: owner.id,
      targetActorId: target.id,
      status: FollowStatus.enum.Accepted,
      inbox: `${target.id}/inbox`,
      sharedInbox: `${target.id}/inbox`
    })
  }

  const note = async (actorId: string, localId: string, reply = '') => {
    const id = `${actorId}/statuses/${localId}`
    await database.createNote({
      id,
      url: id,
      actorId,
      text: 'reply policy candidate',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply
    })
    return id
  }

  // Parent statuses authored by each kind of actor.
  const parentSelf = await note(memberFollowed.id, 'parent-self')
  const parentOwner = await note(owner.id, 'parent-owner')
  const parentMember = await note(memberUnfollowed.id, 'parent-member')
  const parentFollowed = await note(followedNonMember.id, 'parent-followed')
  const parentStranger = await note(stranger.id, 'parent-stranger')
  const absentParent = `https://nowhere.${TEST_DOMAIN}/statuses/missing`

  // Reply candidates, all authored by a list member so they reach the join.
  const ids: Record<ReplyScenario, string> = {
    nonReply: await note(memberFollowed.id, 'non-reply'),
    selfReply: await note(memberFollowed.id, 'self-reply', parentSelf),
    replyToOwner: await note(memberFollowed.id, 'reply-owner', parentOwner),
    replyToMember: await note(memberFollowed.id, 'reply-member', parentMember),
    replyToFollowed: await note(
      memberFollowed.id,
      'reply-followed',
      parentFollowed
    ),
    replyToStranger: await note(
      memberFollowed.id,
      'reply-stranger',
      parentStranger
    ),
    replyToAbsent: await note(memberFollowed.id, 'reply-absent', absentParent)
  }

  const list = await database.createList({
    actorId: owner.id,
    title: 'Reply policy list',
    repliesPolicy
  })
  await database.addListAccounts({
    listId: list.id,
    actorId: owner.id,
    targetActorIds: [memberFollowed.id, memberUnfollowed.id]
  })

  const timeline = await database.getListTimeline({
    listId: list.id,
    actorId: owner.id
  })
  return { ids, timelineIds: new Set(timeline.map((status) => status.id)) }
}

describe('ListDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  it('creates, reads, updates and deletes a list', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      if (!owner) throw new Error('owner not created')

      const created = await database.createList({
        actorId: owner.id,
        title: 'Friends'
      })
      expect(created.title).toBe('Friends')
      expect(created.repliesPolicy).toBe('list')
      expect(created.exclusive).toBe(false)

      const lists = await database.getLists({ actorId: owner.id })
      expect(lists).toHaveLength(1)

      const updated = await database.updateList({
        id: created.id,
        actorId: owner.id,
        title: 'Close Friends',
        repliesPolicy: 'followed',
        exclusive: true
      })
      expect(updated?.title).toBe('Close Friends')
      expect(updated?.repliesPolicy).toBe('followed')
      expect(updated?.exclusive).toBe(true)

      const deleted = await database.deleteList({
        id: created.id,
        actorId: owner.id
      })
      expect(deleted).toBe(true)
      expect(await database.getLists({ actorId: owner.id })).toHaveLength(0)
    })
  })

  it('scopes lists to their owner', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'other')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const other = await database.getActorFromUsername({
        username: 'other',
        domain: TEST_DOMAIN
      })
      if (!owner || !other) throw new Error('actors not created')

      const list = await database.createList({
        actorId: owner.id,
        title: 'Owner list'
      })

      // Another actor cannot read or delete a list they do not own.
      expect(
        await database.getList({ id: list.id, actorId: other.id })
      ).toBeNull()
      expect(
        await database.deleteList({ id: list.id, actorId: other.id })
      ).toBe(false)
    })
  })

  it('adds, lists and removes member accounts idempotently', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      if (!owner) throw new Error('owner not created')

      await database.createActor({
        actorId: EXTERNAL_ACTORS[0].id,
        username: EXTERNAL_ACTORS[0].username,
        domain: EXTERNAL_ACTORS[0].domain,
        followersUrl: EXTERNAL_ACTORS[0].followers_url,
        inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        publicKey: 'remote-public-key',
        createdAt: Date.now()
      })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Following'
      })

      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [EXTERNAL_ACTORS[0].id]
      })
      // Repeated add is a no-op.
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [EXTERNAL_ACTORS[0].id]
      })

      const members = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id
      })
      expect(members.accounts).toHaveLength(1)
      expect(members.accounts[0].id).toBeDefined()
      expect(members.nextMaxId).not.toBeNull()

      const withAccount = await database.getListsWithAccount({
        actorId: owner.id,
        targetActorId: EXTERNAL_ACTORS[0].id
      })
      expect(withAccount).toHaveLength(1)
      expect(withAccount[0].id).toBe(list.id)

      await database.removeListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [EXTERNAL_ACTORS[0].id]
      })
      expect(
        (await database.getListAccounts({ listId: list.id, actorId: owner.id }))
          .accounts
      ).toHaveLength(0)
    })
  })

  it('does not leak or mutate another owner list members', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'other')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const other = await database.getActorFromUsername({
        username: 'other',
        domain: TEST_DOMAIN
      })
      if (!owner || !other) throw new Error('actors not created')

      await database.createActor({
        actorId: EXTERNAL_ACTORS[0].id,
        username: EXTERNAL_ACTORS[0].username,
        domain: EXTERNAL_ACTORS[0].domain,
        followersUrl: EXTERNAL_ACTORS[0].followers_url,
        inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        publicKey: 'remote-public-key',
        createdAt: Date.now()
      })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Owner list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [EXTERNAL_ACTORS[0].id]
      })

      // Another actor passing the same listId must see nothing and must not be
      // able to remove the real owner's members (defensive owner scoping).
      expect(
        (await database.getListAccounts({ listId: list.id, actorId: other.id }))
          .accounts
      ).toHaveLength(0)
      await database.removeListAccounts({
        listId: list.id,
        actorId: other.id,
        targetActorIds: [EXTERNAL_ACTORS[0].id]
      })
      expect(
        (await database.getListAccounts({ listId: list.id, actorId: owner.id }))
          .accounts
      ).toHaveLength(1)
    })
  })

  it('returns statuses from list members in the list timeline', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      const statusId = `${member.id}/statuses/1`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: member.id,
        text: 'hello from a list member',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Timeline list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      const statuses = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id
      })
      expect(statuses.map((status) => status.id)).toContain(statusId)
    })
  })

  it('shows posts published after a member is added (new-status fan-out)', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      // Add the member to the list BEFORE any post exists, so the row can only
      // appear via the new-status fan-out (addStatusToListTimelines), not the
      // add-account backfill.
      const list = await database.createList({
        actorId: owner.id,
        title: 'Fan-out list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      const statusId = `${member.id}/statuses/after-add`
      const status = await database.createNote({
        id: statusId,
        url: statusId,
        actorId: member.id,
        text: 'posted after being added to the list',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.addStatusToListTimelines({ status })

      const statuses = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id
      })
      expect(statuses.map((item) => item.id)).toContain(statusId)
    })
  })

  it('removes a member’s posts from the list timeline when the member is removed', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      const statusId = `${member.id}/statuses/1`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: member.id,
        text: 'hello from a list member',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const list = await database.createList({
        actorId: owner.id,
        title: 'Timeline list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })
      expect(
        (
          await database.getListTimeline({ listId: list.id, actorId: owner.id })
        ).map((status) => status.id)
      ).toContain(statusId)

      await database.removeListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })
      expect(
        await database.getListTimeline({ listId: list.id, actorId: owner.id })
      ).toHaveLength(0)
    })
  })

  it('drops the materialized feed when the list is deleted', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      const statusId = `${member.id}/statuses/1`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: member.id,
        text: 'hello from a list member',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const list = await database.createList({
        actorId: owner.id,
        title: 'Timeline list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      await database.deleteList({ id: list.id, actorId: owner.id })

      // The list and its materialized rows are gone; reading by the same id
      // returns nothing rather than stale posts.
      expect(
        await database.getListTimeline({ listId: list.id, actorId: owner.id })
      ).toHaveLength(0)
    })
  })

  it('removes a member from the owner’s lists when the owner unfollows them', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      await database.createFollow({
        actorId: owner.id,
        targetActorId: member.id,
        status: FollowStatus.enum.Accepted,
        inbox: `${member.id}/inbox`,
        sharedInbox: `${member.id}/inbox`
      })
      const statusId = `${member.id}/statuses/1`
      const status = await database.createNote({
        id: statusId,
        url: statusId,
        actorId: member.id,
        text: 'hello from a followed list member',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      // Also place the member's post in the owner's HOME feed, so we can prove
      // the unfollow purge is scoped to list partitions and never touches home.
      await database.createTimelineStatus({
        actorId: owner.id,
        status,
        timeline: Timeline.MAIN
      })
      const list = await database.createList({
        actorId: owner.id,
        title: 'Timeline list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })
      expect(
        (
          await database.getListTimeline({ listId: list.id, actorId: owner.id })
        ).map((item) => item.id)
      ).toContain(statusId)

      // Unfollowing flips the follow to Undo through the canonical chokepoint,
      // which must drop the member from the owner's lists and the materialized
      // feed (Mastodon parity).
      const follow = await database.getAcceptedOrRequestedFollow({
        actorId: owner.id,
        targetActorId: member.id
      })
      if (!follow) throw new Error('follow not created')
      await database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Undo
      })

      expect(
        (await database.getListAccounts({ listId: list.id, actorId: owner.id }))
          .accounts
      ).toHaveLength(0)
      expect(
        await database.getListTimeline({ listId: list.id, actorId: owner.id })
      ).toHaveLength(0)
      // The home feed must be untouched by the list purge.
      expect(
        (
          await database.getTimeline({
            timeline: Timeline.MAIN,
            actorId: owner.id
          })
        ).map((item) => item.id)
      ).toContain(statusId)
    })
  })

  it('excludes member statuses the owner cannot see from the list timeline', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      const publicId = `${member.id}/statuses/public`
      await database.createNote({
        id: publicId,
        url: publicId,
        actorId: member.id,
        text: 'public post',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      // A direct post addressed to someone other than the owner must not leak
      // into the owner's list timeline.
      const directId = `${member.id}/statuses/direct`
      await database.createNote({
        id: directId,
        url: directId,
        actorId: member.id,
        text: 'secret to a stranger',
        to: ['https://stranger.example/users/x'],
        cc: []
      })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Visibility list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      const ids = (
        await database.getListTimeline({ listId: list.id, actorId: owner.id })
      ).map((status) => status.id)
      expect(ids).toContain(publicId)
      expect(ids).not.toContain(directId)
    })
  })

  it('applies visibility before the limit so a hidden run cannot strand visible posts', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      // One visible post, then two newer non-visible posts. If visibility were
      // applied only after LIMIT, fetching the newest two would yield only the
      // hidden pair and return an empty page, stranding the visible post.
      const visibleId = `${member.id}/statuses/0-visible`
      await database.createNote({
        id: visibleId,
        url: visibleId,
        actorId: member.id,
        text: 'visible',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      for (const suffix of ['1-direct', '2-direct']) {
        const directId = `${member.id}/statuses/${suffix}`
        await database.createNote({
          id: directId,
          url: directId,
          actorId: member.id,
          text: 'hidden',
          to: ['https://stranger.example/users/x'],
          cc: []
        })
      }

      const list = await database.createList({
        actorId: owner.id,
        title: 'Limit list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      const statuses = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id,
        limit: 2
      })
      expect(statuses.map((status) => status.id)).toEqual([visibleId])
    })
  })

  it('hydrates the owner action state in the list timeline', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      const statusId = `${member.id}/statuses/liked`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: member.id,
        text: 'like me',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      // The owner has acted on the member's post; the list timeline must reflect
      // it (the timeline is hydrated for the owner, who is the viewer).
      await database.createLike({ actorId: owner.id, statusId })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Action state list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      const statuses = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id
      })
      const liked = statuses.find((status) => status.id === statusId)
      expect(liked).toBeDefined()
      expect((liked as { isActorLiked?: boolean }).isActorLiked).toBe(true)
    })
  })

  it('counts members per list and scopes counts to the owner', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'other')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const other = await database.getActorFromUsername({
        username: 'other',
        domain: TEST_DOMAIN
      })
      if (!owner || !other) throw new Error('actors not created')

      await database.createActor({
        actorId: EXTERNAL_ACTORS[0].id,
        username: EXTERNAL_ACTORS[0].username,
        domain: EXTERNAL_ACTORS[0].domain,
        followersUrl: EXTERNAL_ACTORS[0].followers_url,
        inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
        publicKey: 'remote-public-key',
        createdAt: Date.now()
      })

      const populated = await database.createList({
        actorId: owner.id,
        title: 'Populated'
      })
      const empty = await database.createList({
        actorId: owner.id,
        title: 'Empty'
      })
      await database.addListAccounts({
        listId: populated.id,
        actorId: owner.id,
        targetActorIds: [EXTERNAL_ACTORS[0].id]
      })

      const counts = await database.getListAccountCounts({
        actorId: owner.id,
        listIds: [populated.id, empty.id]
      })
      expect(counts).toEqual({ [populated.id]: 1, [empty.id]: 0 })

      // Another owner sees no memberships for the same list ids.
      const otherCounts = await database.getListAccountCounts({
        actorId: other.id,
        listIds: [populated.id, empty.id]
      })
      expect(otherCounts).toEqual({ [populated.id]: 0, [empty.id]: 0 })

      // Empty input returns an empty map without a query.
      expect(
        await database.getListAccountCounts({ actorId: owner.id, listIds: [] })
      ).toEqual({})
    })
  })

  it.each([
    ['none', ['nonReply', 'selfReply', 'replyToOwner']],
    ['list', ['nonReply', 'selfReply', 'replyToOwner', 'replyToMember']],
    ['followed', ['nonReply', 'selfReply', 'replyToOwner', 'replyToFollowed']]
  ] as [ListRepliesPolicy, ReplyScenario[]][])(
    'honors repliesPolicy=%s in the list timeline',
    async (repliesPolicy, visibleScenarios) => {
      await withFreshDatabase(async (database) => {
        const { ids, timelineIds } = await setupRepliesPolicyFixture(
          database,
          repliesPolicy
        )
        for (const scenario of ALL_REPLY_SCENARIOS) {
          expect(timelineIds.has(ids[scenario])).toBe(
            visibleScenarios.includes(scenario)
          )
        }
      })
    }
  )

  it('applies block and mute filtering to the list timeline', async () => {
    await withFreshDatabase(async (database) => {
      const usernames = [
        'mod-owner',
        'mod-clean',
        'mod-blocked',
        'mod-blocked-by',
        'mod-muted',
        'mod-muted-expired',
        'mod-muted-by'
      ]
      for (const username of usernames)
        await createLocalAccount(database, username)
      const actor = async (username: string) => {
        const found = await database.getActorFromUsername({
          username,
          domain: TEST_DOMAIN
        })
        if (!found) throw new Error(`${username} not created`)
        return found
      }
      const owner = await actor('mod-owner')
      const clean = await actor('mod-clean')
      const blocked = await actor('mod-blocked')
      const blockedBy = await actor('mod-blocked-by')
      const muted = await actor('mod-muted')
      const mutedExpired = await actor('mod-muted-expired')
      const mutedBy = await actor('mod-muted-by')

      const post = async (author: { id: string }, localId: string) => {
        const id = `${author.id}/statuses/${localId}`
        await database.createNote({
          id,
          url: id,
          actorId: author.id,
          text: `moderation ${localId}`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        return id
      }
      const cleanId = await post(clean, 'clean')
      const blockedId = await post(blocked, 'blocked')
      const blockedById = await post(blockedBy, 'blocked-by')
      const mutedId = await post(muted, 'muted')
      const mutedExpiredId = await post(mutedExpired, 'muted-expired')
      const mutedById = await post(mutedBy, 'muted-by')

      const list = await database.createList({
        actorId: owner.id,
        title: 'Moderation list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [
          clean.id,
          blocked.id,
          blockedBy.id,
          muted.id,
          mutedExpired.id,
          mutedBy.id
        ]
      })

      // Owner blocks `blocked`; `blockedBy` blocks owner (reverse direction).
      await database.createBlock({
        actorId: owner.id,
        targetActorId: blocked.id,
        uri: `${owner.id}/blocks/blocked`
      })
      await database.createBlock({
        actorId: blockedBy.id,
        targetActorId: owner.id,
        uri: `${blockedBy.id}/blocks/owner`
      })
      // Owner mutes `muted` indefinitely, and `mutedExpired` with a past expiry.
      await database.createMute({
        actorId: owner.id,
        targetActorId: muted.id,
        notifications: true,
        endsAt: null
      })
      await database.createMute({
        actorId: owner.id,
        targetActorId: mutedExpired.id,
        notifications: true,
        endsAt: Date.now() - 60_000
      })
      // `mutedBy` mutes the owner — mutes are one-directional, so this must NOT
      // hide their posts from the owner's list (unlike blocks).
      await database.createMute({
        actorId: mutedBy.id,
        targetActorId: owner.id,
        notifications: true,
        endsAt: null
      })

      const ids = (
        await database.getListTimeline({ listId: list.id, actorId: owner.id })
      ).map((status) => status.id)

      // Active blocks (either direction) and active mutes are hidden.
      expect(ids).not.toContain(blockedId)
      expect(ids).not.toContain(blockedById)
      expect(ids).not.toContain(mutedId)
      // Unmoderated members, expired mutes, and reverse-only mutes still show.
      expect(ids).toContain(cleanId)
      expect(ids).toContain(mutedExpiredId)
      expect(ids).toContain(mutedById)
    })
  })

  it('hides a member reblog of a blocked or muted original author', async () => {
    await withFreshDatabase(async (database) => {
      const usernames = [
        'rb-owner',
        'rb-member',
        'rb-blocked',
        'rb-muted',
        'rb-clean'
      ]
      for (const username of usernames)
        await createLocalAccount(database, username)
      const actor = async (username: string) => {
        const found = await database.getActorFromUsername({
          username,
          domain: TEST_DOMAIN
        })
        if (!found) throw new Error(`${username} not created`)
        return found
      }
      const owner = await actor('rb-owner')
      const member = await actor('rb-member')
      const blocked = await actor('rb-blocked')
      const muted = await actor('rb-muted')
      const clean = await actor('rb-clean')

      // Original posts authored by the (to-be) blocked/muted/clean accounts.
      const original = async (author: { id: string }, localId: string) => {
        const id = `${author.id}/statuses/${localId}`
        await database.createNote({
          id,
          url: id,
          actorId: author.id,
          text: `original ${localId}`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        return id
      }
      const origBlocked = await original(blocked, 'orig-blocked')
      const origMuted = await original(muted, 'orig-muted')
      const origClean = await original(clean, 'orig-clean')

      // The list member boosts each original post.
      const announce = async (localId: string, originalStatusId: string) => {
        const id = `${member.id}/statuses/${localId}`
        await database.createAnnounce({
          id,
          actorId: member.id,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId
        })
        return id
      }
      const annBlocked = await announce('ann-blocked', origBlocked)
      const annMuted = await announce('ann-muted', origMuted)
      const annClean = await announce('ann-clean', origClean)

      const list = await database.createList({
        actorId: owner.id,
        title: 'Reblog moderation list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })
      await database.createBlock({
        actorId: owner.id,
        targetActorId: blocked.id,
        uri: `${owner.id}/blocks/rb-blocked`
      })
      await database.createMute({
        actorId: owner.id,
        targetActorId: muted.id,
        notifications: true,
        endsAt: null
      })

      const ids = (
        await database.getListTimeline({ listId: list.id, actorId: owner.id })
      ).map((status) => status.id)

      // A boost is hidden when its ORIGINAL author is blocked/muted, matching
      // the home feed's getRelevantStatusActorIds behaviour.
      expect(ids).not.toContain(annBlocked)
      expect(ids).not.toContain(annMuted)
      expect(ids).toContain(annClean)
    })
  })

  it('returns an empty page when the pagination cursor status is gone', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      const statusId = `${member.id}/statuses/1`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: member.id,
        text: 'a list member post',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const list = await database.createList({
        actorId: owner.id,
        title: 'Cursor list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      // A deleted/unknown cursor must terminate pagination with an empty page,
      // not silently drop the cursor and re-return the newest page (a loop).
      const page = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id,
        maxStatusId: `${member.id}/statuses/deleted-cursor`
      })
      expect(page).toEqual([])
    })
  })

  it('paginates with a valid max_id cursor (older statuses only)', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      // Three posts, oldest → newest by createdAt.
      const ids: string[] = []
      for (let i = 1; i <= 3; i++) {
        const id = `${member.id}/statuses/${i}`
        await database.createNote({
          id,
          url: id,
          actorId: member.id,
          text: `post ${i}`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          createdAt: 1000 * i
        })
        ids.push(id)
      }
      const [older, middle, newer] = ids

      const list = await database.createList({
        actorId: owner.id,
        title: 'Pagination list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      // Newest-first with no cursor.
      const firstPage = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id
      })
      expect(firstPage.map((status) => status.id)).toEqual([
        newer,
        middle,
        older
      ])

      // max_id at the middle returns only the strictly-older page.
      const olderPage = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id,
        maxStatusId: middle
      })
      expect(olderPage.map((status) => status.id)).toEqual([older])
    })
  })

  it('distinguishes min_id (adjacent page) from since_id (newest slice)', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      if (!owner || !member) throw new Error('actors not created')

      // Five posts, oldest → newest by createdAt.
      const ids: string[] = []
      for (let i = 1; i <= 5; i++) {
        const id = `${member.id}/statuses/${i}`
        await database.createNote({
          id,
          url: id,
          actorId: member.id,
          text: `post ${i}`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          createdAt: 1000 * i
        })
        ids.push(id)
      }
      const [oldest, second, middle, fourth, newest] = ids

      const list = await database.createList({
        actorId: owner.id,
        title: 'Cursor list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      // since_id: the two NEWEST statuses above the cursor.
      const sincePage = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id,
        sinceStatusId: oldest,
        limit: 2
      })
      expect(sincePage.map((status) => status.id)).toEqual([newest, fourth])

      // min_id: the two OLDEST statuses above the cursor (the adjacent page),
      // returned newest-first — a different slice than since_id.
      const minPage = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id,
        minStatusId: oldest,
        limit: 2
      })
      expect(minPage.map((status) => status.id)).toEqual([middle, second])
    })
  })

  it('getListAccounts distinguishes min_id (adjacent page) from since_id (newest slice)', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      if (!owner) throw new Error('owner not created')

      const list = await database.createList({
        actorId: owner.id,
        title: 'Members list'
      })

      // Five members, oldest → newest by membership createdAt. addListAccounts
      // stamps one createdAt per call, so add them one per call with a small gap
      // to give each row a distinct, ordered createdAt (the id tie-break is a
      // random UUID and can't order them chronologically on its own).
      const usernames = ['m1', 'm2', 'm3', 'm4', 'm5']
      for (const username of usernames) {
        await createLocalAccount(database, username)
        const member = await database.getActorFromUsername({
          username,
          domain: TEST_DOMAIN
        })
        if (!member) throw new Error(`${username} not created`)
        await database.addListAccounts({
          listId: list.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      // Full page is newest-first; nextMaxId is the oldest member's (m1)
      // membership-row id — the cursor both pagination kinds page above.
      const full = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id
      })
      expect(full.accounts.map((account) => account.username)).toEqual([
        'm5',
        'm4',
        'm3',
        'm2',
        'm1'
      ])
      const cursor = full.nextMaxId
      if (!cursor) throw new Error('expected a cursor for m1')

      // since_id: the two NEWEST members above the cursor.
      const sincePage = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id,
        sinceId: cursor,
        limit: 2
      })
      expect(sincePage.accounts.map((account) => account.username)).toEqual([
        'm5',
        'm4'
      ])

      // min_id: the two OLDEST members above the cursor (the adjacent page),
      // returned newest-first — a different slice than since_id.
      const minPage = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id,
        minId: cursor,
        limit: 2
      })
      expect(minPage.accounts.map((account) => account.username)).toEqual([
        'm3',
        'm2'
      ])
    })
  })

  it('getListAccounts returns an empty page for an unresolvable min_id cursor', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      if (!owner) throw new Error('owner not created')
      const list = await database.createList({
        actorId: owner.id,
        title: 'Members list'
      })
      for (const username of ['m1', 'm2', 'm3']) {
        await createLocalAccount(database, username)
        const member = await database.getActorFromUsername({
          username,
          domain: TEST_DOMAIN
        })
        if (!member) throw new Error(`${username} not created`)
        await database.addListAccounts({
          listId: list.id,
          actorId: owner.id,
          targetActorIds: [member.id]
        })
      }

      // A min_id whose membership row was removed (or a foreign id) must
      // terminate pagination with an empty page — matching getListTimeline —
      // rather than dropping the filter and returning the OLDEST members (the
      // wrong end of the list under the ascending min_id order).
      const page = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id,
        minId: 'does-not-exist',
        limit: 2
      })
      expect(page.accounts).toEqual([])
      expect(page.nextMaxId).toBeNull()
      expect(page.prevMinId).toBeNull()
    })
  })

  it('paginates from a cursor that exists but is not in the list partition', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'owner')
      await createLocalAccount(database, 'member')
      await createLocalAccount(database, 'other')
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      const member = await database.getActorFromUsername({
        username: 'member',
        domain: TEST_DOMAIN
      })
      const other = await database.getActorFromUsername({
        username: 'other',
        domain: TEST_DOMAIN
      })
      if (!owner || !member || !other) throw new Error('actors not created')

      // Member posts at createdAt 1000/2000/3000.
      const memberIds: string[] = []
      for (let i = 1; i <= 3; i++) {
        const id = `${member.id}/statuses/${i}`
        await database.createNote({
          id,
          url: id,
          actorId: member.id,
          text: `member ${i}`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          createdAt: 1000 * i
        })
        memberIds.push(id)
      }
      const [m1000, m2000] = memberIds

      // A non-member status that exists in `statuses` but is never materialized
      // into the list partition, at a createdAt between the member posts.
      const outsiderId = `${other.id}/statuses/outsider`
      await database.createNote({
        id: outsiderId,
        url: outsiderId,
        actorId: other.id,
        text: 'not on the list',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: 2500
      })

      const list = await database.createList({
        actorId: owner.id,
        title: 'Fallback cursor list'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: [member.id]
      })

      // The cursor resolves from `statuses` (not the partition), so it has no row
      // id — pagination must fall back to a strict createdAt compare without
      // emitting an invalid empty Knex group, returning only strictly-older
      // member posts.
      const page = await database.getListTimeline({
        listId: list.id,
        actorId: owner.id,
        maxStatusId: outsiderId
      })
      expect(page.map((status) => status.id)).toEqual([m2000, m1000])
    })
  })
})

describe('getListAccounts', () => {
  it('returns every member without pagination when limit is 0', async () => {
    await withFreshDatabase(async (database) => {
      for (const username of ['listowner', 'member1', 'member2', 'member3']) {
        await createLocalAccount(database, username)
      }
      const owner = await database.getActorFromUsername({
        username: 'listowner',
        domain: TEST_DOMAIN
      })
      if (!owner) throw new Error('owner not created')
      const memberIds: string[] = []
      for (const username of ['member1', 'member2', 'member3']) {
        const member = await database.getActorFromUsername({
          username,
          domain: TEST_DOMAIN
        })
        if (!member) throw new Error(`${username} not created`)
        memberIds.push(member.id)
      }
      const list = await database.createList({
        actorId: owner.id,
        title: 'Everyone'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: owner.id,
        targetActorIds: memberIds
      })

      const limited = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id,
        limit: 2
      })
      expect(limited.accounts).toHaveLength(2)

      const all = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id,
        limit: 0
      })
      expect(all.accounts).toHaveLength(3)
    })
  })
})
