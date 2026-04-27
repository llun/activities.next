import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { BlockedFederationDomainError, recordActorIfNeeded } from './utils'

describe('recordActorIfNeeded', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
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
})
