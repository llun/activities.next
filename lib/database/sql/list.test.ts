import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { EXTERNAL_ACTORS, TEST_DOMAIN } from '@/lib/stub/const'
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
})
