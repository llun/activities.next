import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'

enableFetchMocks()

/**
 * Registers the seeded in-memory database and fetch mocks every createNote
 * suite starts from. Call it inside the top-level `describe`; the suite's own
 * file must still `vi.mock` the queue, timelines and notification alerts.
 */
export const useCreateNoteFixtures = () => {
  const database = getTestSQLDatabase()
  const mockSendNotificationAlerts =
    sendNotificationAlerts as jest.MockedFunction<typeof sendNotificationAlerts>
  const actors = {} as { actor1: Actor; actor2: Actor }

  const clearSettledNotificationAlerts = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    mockSendNotificationAlerts.mockClear()
  }

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actors.actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    actors.actor2 = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    vi.clearAllMocks()
  })

  return {
    database,
    actors,
    mockSendNotificationAlerts,
    clearSettledNotificationAlerts
  }
}
