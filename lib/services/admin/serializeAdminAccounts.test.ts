import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  hydrateAdminAccounts,
  resolveAdminAccountRecord
} from '@/lib/services/admin/serializeAdminAccounts'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { EXTERNAL_ACTOR1, seedExternal1 } from '@/lib/stub/seed/external1'
import { Mastodon } from '@/lib/types/activitypub'
import { generatePublicId } from '@/lib/utils/publicId'
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

      const publicIds = await database.getActorPublicIds({
        actorIds: [LOCAL_ACTOR_ID]
      })
      const publicId = publicIds.get(LOCAL_ACTOR_ID) as string
      const records = await database.getAdminAccounts({ limit: 100 })
      const entities = await hydrateAdminAccounts(database, records)
      const entity = byId(entities, publicId)

      expect(entity).toBeDefined()
      expect(entity?.domain).toBeNull()
      expect(entity?.email).toBe(`${LOCAL_USERNAME}@${TEST_DOMAIN}`)
      expect(entity?.suspended).toBe(true)
      expect(entity?.approved).toBe(true)
      expect(entity?.confirmed).toBe(true)
      expect(entity?.role?.name).toBe('Admin')
      // The admin entity id and the embedded public Account id are the same
      // value, which is what keeps the publicAccountById join working.
      expect(entity?.account.id).toBe(publicId)
    })
  })

  it('reports an account awaiting e-mail confirmation as unconfirmed', async () => {
    // `confirmed` used to read `verifiedAt`, which carries
    // DEFAULT CURRENT_TIMESTAMP and so was non-null for every account — so it
    // answered `true` for exactly the accounts a moderator would be looking at
    // because they cannot sign in.
    await withDatabase(async ({ database }) => {
      await database.createAccount({
        email: `${LOCAL_USERNAME}@${TEST_DOMAIN}`,
        username: LOCAL_USERNAME,
        domain: TEST_DOMAIN,
        passwordHash: 'hash',
        privateKey: 'private',
        publicKey: 'public',
        verificationCode: 'pending-confirmation-code'
      })

      const publicIds = await database.getActorPublicIds({
        actorIds: [LOCAL_ACTOR_ID]
      })
      const publicId = publicIds.get(LOCAL_ACTOR_ID) as string
      const records = await database.getAdminAccounts({ limit: 100 })
      const entities = await hydrateAdminAccounts(database, records)
      const entity = byId(entities, publicId)

      expect(entity).toBeDefined()
      expect(entity?.confirmed).toBe(false)
    })
  })

  it('falls back to the legacy id for an actor that predates the backfill', async () => {
    await withDatabase(async ({ database, instance }) => {
      await database.createAccount({
        email: `${LOCAL_USERNAME}@${TEST_DOMAIN}`,
        username: LOCAL_USERNAME,
        passwordHash: 'hash',
        domain: TEST_DOMAIN,
        privateKey: 'private',
        publicKey: 'public'
      })
      await instance('actors')
        .where('id', LOCAL_ACTOR_ID)
        .update({ publicId: null })

      const records = await database.getAdminAccounts({ limit: 100 })
      const entities = await hydrateAdminAccounts(database, records)
      const entity = byId(entities, urlToId(LOCAL_ACTOR_ID))

      expect(entity).toBeDefined()
      expect(entity?.account.id).toBe(urlToId(LOCAL_ACTOR_ID))
    })
  })

  it('serializes a remote actor with its qualified domain, empty email and null role', async () => {
    await withDatabase(async ({ database }) => {
      await database.createActor(seedExternal1)

      const publicIds = await database.getActorPublicIds({
        actorIds: [EXTERNAL_ACTOR1]
      })
      const records = await database.getAdminAccounts({ limit: 100 })
      const entities = await hydrateAdminAccounts(database, records)
      const entity = byId(entities, publicIds.get(EXTERNAL_ACTOR1) as string)

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

describe('resolveAdminAccountRecord', () => {
  const { database } = getTestSQLDatabaseWithInstance()

  beforeAll(async () => {
    await database.migrate()
    await database.createAccount({
      email: `${LOCAL_USERNAME}@${TEST_DOMAIN}`,
      username: LOCAL_USERNAME,
      passwordHash: 'hash',
      domain: TEST_DOMAIN,
      privateKey: 'private',
      publicKey: 'public'
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('resolves the colon-form id to its AdminAccountRecord', async () => {
    const record = await resolveAdminAccountRecord(
      database,
      urlToId(LOCAL_ACTOR_ID)
    )
    expect(record?.actor.id).toBe(LOCAL_ACTOR_ID)
  })

  it('resolves the publicId form to its AdminAccountRecord', async () => {
    const actor = await database.getActorFromId({ id: LOCAL_ACTOR_ID })
    if (!actor?.publicId) {
      throw new Error('seeded actor is missing a publicId')
    }

    const record = await resolveAdminAccountRecord(database, actor.publicId)
    expect(record?.actor.id).toBe(LOCAL_ACTOR_ID)
  })

  it('returns null for an unknown publicId', async () => {
    const record = await resolveAdminAccountRecord(database, generatePublicId())
    expect(record).toBeNull()
  })

  it('returns null for an undecodable legacy id', async () => {
    const record = await resolveAdminAccountRecord(database, 'apurl_%%%')
    expect(record).toBeNull()
  })
})
