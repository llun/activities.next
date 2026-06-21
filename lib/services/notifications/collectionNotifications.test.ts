import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  notifyAddedToCollection,
  notifyCollectionUpdated
} from '@/lib/services/notifications/collectionNotifications'
import { TEST_DOMAIN } from '@/lib/stub/const'

const withFreshDatabase = async (test: (db: Database) => Promise<void>) => {
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

const actor = async (database: Database, username: string) => {
  const found = await database.getActorFromUsername({
    username,
    domain: TEST_DOMAIN
  })
  if (!found) throw new Error(`${username} not created`)
  return found
}

const notificationsFor = (database: Database, actorId: string) =>
  database.getNotifications({ actorId, limit: 40 })

describe('collection notifications', () => {
  it('notifies newly-added local members, skipping the owner and remotes', async () => {
    await withFreshDatabase(async (database) => {
      for (const name of ['owner', 'alice']) {
        await createLocalAccount(database, name)
      }
      const owner = await actor(database, 'owner')
      const alice = await actor(database, 'alice')
      const remoteId = 'https://remote.example/users/bob'

      await notifyAddedToCollection(database, {
        collectionId: 'col-1',
        ownerActorId: owner.id,
        addedActorIds: [alice.id, owner.id, remoteId]
      })

      const aliceNotifications = await notificationsFor(database, alice.id)
      expect(aliceNotifications).toHaveLength(1)
      expect(aliceNotifications[0].type).toBe('added_to_collection')
      expect(aliceNotifications[0].sourceActorId).toBe(owner.id)

      // Owner is never self-notified; the remote member is not notified locally.
      expect(await notificationsFor(database, owner.id)).toHaveLength(0)
      expect(await notificationsFor(database, remoteId)).toHaveLength(0)
    })
  })

  it('notifies members on a collection_update', async () => {
    await withFreshDatabase(async (database) => {
      for (const name of ['owner', 'alice']) {
        await createLocalAccount(database, name)
      }
      const owner = await actor(database, 'owner')
      const alice = await actor(database, 'alice')

      await notifyCollectionUpdated(database, {
        collectionId: 'col-1',
        ownerActorId: owner.id,
        memberActorIds: [alice.id]
      })

      const aliceNotifications = await notificationsFor(database, alice.id)
      expect(aliceNotifications).toHaveLength(1)
      expect(aliceNotifications[0].type).toBe('collection_update')
      expect(aliceNotifications[0].sourceActorId).toBe(owner.id)
    })
  })
})
