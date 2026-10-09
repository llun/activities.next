import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'

/**
 * Registers the migrated, seeded in-memory database every getMastodonStatus
 * suite reads from. Call it inside the top-level `describe`.
 */
export const useSeededStatusDatabase = () => {
  const database = getTestSQLDatabase()

  // publicIds are minted at insert and are random per run, so every expectation
  // reads the id back off the stored row instead of hard-coding a literal.
  const getActorPublicId = async (actorId: string) => {
    const publicIds = await database.getActorPublicIds({ actorIds: [actorId] })
    return publicIds.get(actorId)
  }

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  return { database, getActorPublicId }
}
