import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { BlockedFederationDomainError, recordActorIfNeeded } from './utils'

const mockGetActorPerson = vi.fn()

vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: (...params: unknown[]) => mockGetActorPerson(...params)
}))

describe('recordActorIfNeeded', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects actors from blocked domains before fetching them', async () => {
    await database.createDomainBlock({
      domain: 'blocked-record.test',
      severity: 'suspend'
    })

    await expect(
      recordActorIfNeeded({
        actorId: 'https://blocked-record.test/users/alice',
        database
      })
    ).rejects.toThrow(BlockedFederationDomainError)
  })

  it('refreshes the persisted actor type for stale remote actors', async () => {
    const sql = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(sql)
    await database.migrate()

    try {
      const actorId = 'https://remote-service.test/users/service'
      const oldTime = new Date(Date.now() - 4 * 86_400_000)
      await database.createActor({
        actorId,
        type: 'Person',
        username: 'service',
        domain: 'remote-service.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://remote-service.test/inbox',
        publicKey: 'old-public-key',
        createdAt: oldTime.getTime()
      })
      await sql('actors').where('id', actorId).update({ updatedAt: oldTime })

      mockGetActorPerson.mockResolvedValue({
        id: actorId,
        type: 'Service',
        preferredUsername: 'service',
        followers: `${actorId}/followers`,
        inbox: `${actorId}/inbox`,
        outbox: `${actorId}/outbox`,
        publicKey: {
          id: `${actorId}#main-key`,
          owner: actorId,
          publicKeyPem: 'new-public-key'
        },
        endpoints: {
          sharedInbox: 'https://remote-service.test/inbox'
        }
      })

      const actor = await recordActorIfNeeded({ actorId, database })

      expect(actor?.type).toBe('Service')
      await expect(
        database.getActorFromId({ id: actorId })
      ).resolves.toMatchObject({
        type: 'Service',
        publicKey: 'new-public-key'
      })
    } finally {
      await database.destroy()
    }
  })
})
