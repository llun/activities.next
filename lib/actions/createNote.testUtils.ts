import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'

enableFetchMocks()

/**
 * Registers the seeded test database and fetch mocks every createNote
 * suite starts from. Call it inside the top-level `describe`; the suite's own
 * file must still `vi.mock` the queue, timelines and notification alerts.
 */
export const useCreateNoteFixtures = () => {
  // Honours TEST_DATABASE_TYPE, so the suites run on PostgreSQL in CI.
  const { database, prepare } = createTestDatabase()
  const mockSendNotificationAlerts =
    sendNotificationAlerts as jest.MockedFunction<typeof sendNotificationAlerts>
  const actors = {} as { actor1: Actor; actor2: Actor }

  // createNote dispatches each reply and mention alert after a
  // fire-and-forget `getActorFromId`. On SQLite that read settles within a
  // macrotask; on PostgreSQL it is a network round trip. The lookups are
  // tracked so a test can wait for every alert in flight before it asserts.
  const pendingActorLookups = new Set<Promise<unknown>>()
  const getActorFromId = database.getActorFromId
  database.getActorFromId = (params) => {
    const lookup = getActorFromId(params)
    pendingActorLookups.add(lookup)
    lookup
      .finally(() => pendingActorLookups.delete(lookup))
      .catch(() => undefined)
    return lookup
  }

  const settleNotificationAlerts = async () => {
    while (pendingActorLookups.size > 0) {
      await Promise.allSettled([...pendingActorLookups])
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const clearSettledNotificationAlerts = async () => {
    await settleNotificationAlerts()
    mockSendNotificationAlerts.mockClear()
  }

  beforeAll(async () => {
    await prepare()
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
    settleNotificationAlerts,
    clearSettledNotificationAlerts
  }
}
