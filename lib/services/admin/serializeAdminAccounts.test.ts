import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { hydrateAdminAccounts } from '@/lib/services/admin/serializeAdminAccounts'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { EXTERNAL_ACTOR1, seedExternal1 } from '@/lib/stub/seed/external1'
import { Mastodon } from '@/lib/types/activitypub'
import { urlToId } from '@/lib/utils/urlToId'

const LOCAL_USERNAME = 'adminuser'
const LOCAL_ACTOR_ID = `https://${TEST_DOMAIN}/users/${LOCAL_USERNAME}`

const byId = (
  accounts: Mastodon.AdminAccount[],
  id: string
): Mastodon.AdminAccount | undefined =>
  accounts.find((account) => account.id === id)

describe('hydrateAdminAccounts', () => {
  const withDatabase = async (
    test: (params: {
      database: Database
      instance: ReturnType<typeof getTestSQLDatabaseWithInstance>['instance']
    }) => Promise<void>
  ) => {
    const { database, instance } = getTestSQLDatabaseWithInstance()
    await database.migrate()
    try {
      await test({ database, instance })
    } finally {
      await database.destroy()
    }
  }

  it('serializes a local admin actor with a nulled domain, admin role and moderation flags', async () => {
    await withDatabase(async ({ database, instance }) => {
      const accountId = await database.createAccount({
        email: `${LOCAL_USERNAME}@${TEST_DOMAIN}`,
        username: LOCAL_USERNAME,
        passwordHash: 'hash',
        domain: TEST_DOMAIN,
        privateKey: 'private',
        publicKey: 'public'
      })
      await instance('accounts')
        .where('id', accountId)
        .update({ role: 'admin' })
      await database.setActorSuspended({
        actorId: LOCAL_ACTOR_ID,
        suspended: true
      })

      const records = await database.getAdminAccounts({ limit: 100 })
      const entities = await hydrateAdminAccounts(database, records)
      const entity = byId(entities, urlToId(LOCAL_ACTOR_ID))

      expect(entity).toBeDefined()
      expect(entity?.domain).toBeNull()
      expect(entity?.email).toBe(`${LOCAL_USERNAME}@${TEST_DOMAIN}`)
      expect(entity?.suspended).toBe(true)
      expect(entity?.approved).toBe(true)
      expect(entity?.confirmed).toBe(true)
      expect(entity?.role?.name).toBe('Admin')
      expect(entity?.account.id).toBe(urlToId(LOCAL_ACTOR_ID))
    })
  })

  it('serializes a remote actor with its qualified domain, empty email and null role', async () => {
    await withDatabase(async ({ database }) => {
      await database.createActor(seedExternal1)

      const records = await database.getAdminAccounts({ limit: 100 })
      const entities = await hydrateAdminAccounts(database, records)
      const entity = byId(entities, urlToId(EXTERNAL_ACTOR1))

      expect(entity).toBeDefined()
      expect(entity?.domain).toBe('llun.dev')
      expect(entity?.email).toBe('')
      expect(entity?.role).toBeNull()
      // Remote actors have no registration state; treated as approved.
      expect(entity?.approved).toBe(true)
      expect(entity?.suspended).toBe(false)
    })
  })
})
