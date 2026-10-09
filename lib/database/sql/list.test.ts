import {
  createLocalAccount,
  withFreshDatabase
} from '@/lib/database/sql/listTestHelpers'
import { Timeline } from '@/lib/services/timelines/types'
import { EXTERNAL_ACTORS, TEST_DOMAIN } from '@/lib/stub/const'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('ListDatabase', () => {
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
