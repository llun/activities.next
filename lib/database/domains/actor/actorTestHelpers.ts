import { Knex } from 'knex'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  EXTERNAL_ACTORS,
  TEST_DOMAIN,
  TEST_EMAIL,
  TEST_PASSWORD_HASH,
  TEST_USERNAME3
} from '@/lib/stub/const'

export const createSigningAccount = async (
  database: Database,
  username: string,
  {
    domain = TEST_DOMAIN,
    privateKey = `privateKey-${username}`,
    publicKey = `publicKey-${username}`
  }: {
    domain?: string
    privateKey?: string
    publicKey?: string
  } = {}
) =>
  database.createAccount({
    email: `${username}@${domain}`,
    username,
    passwordHash: TEST_PASSWORD_HASH,
    domain,
    privateKey,
    publicKey
  })

// Runs `test` against a freshly migrated database for the given backend and
// destroys it afterwards.
export const createFreshDatabaseRunner =
  (backendName: string) =>
  async (test: (database: Database, instance: Knex) => Promise<void>) => {
    const {
      database: freshDatabase,
      instance,
      prepare
    } = getTestDatabaseWithInstance(true, backendName)
    await prepare()
    await freshDatabase.migrate()
    try {
      await test(freshDatabase, instance)
    } finally {
      await freshDatabase.destroy()
    }
  }

// publicIds are minted at insert and random per run, so expectations read
// them back off the stored row instead of hard-coding a literal.
export const createActorPublicIdReader =
  (database: Database) => async (actorId: string) => {
    const publicIds = await database.getActorPublicIds({
      actorIds: [actorId]
    })
    return publicIds.get(actorId)
  }

// The account and external actor every actor test file starts from.
export const seedActorTestDatabase = async (database: Database) => {
  await database.createAccount({
    email: TEST_EMAIL,
    username: TEST_USERNAME3,
    passwordHash: TEST_PASSWORD_HASH,
    domain: TEST_DOMAIN,
    privateKey: 'privateKey1',
    publicKey: 'publicKey1'
  })

  await database.createActor({
    actorId: EXTERNAL_ACTORS[0].id,
    username: EXTERNAL_ACTORS[0].username,
    domain: EXTERNAL_ACTORS[0].domain,
    followersUrl: EXTERNAL_ACTORS[0].followers_url,
    inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
    sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
    publicKey: 'publicKey',
    createdAt: Date.now()
  })
}
