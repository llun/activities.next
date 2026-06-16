import {
  acceptRelayRequest,
  rejectRelayRequest
} from '@/lib/actions/acceptRelayRequest'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

const FOLLOW_ID = 'https://instance.example/relay-follow-1'
const RELAY_ACTOR = 'https://relay.example/actor'

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

const seedPendingRelay = async (database: Database) => {
  const relay = await database.createRelay({
    inboxUrl: 'https://relay.example/inbox'
  })
  await database.updateRelay({
    id: relay.id,
    state: 'pending',
    followActivityId: FOLLOW_ID
  })
  return relay
}

describe('acceptRelayRequest', () => {
  it('marks the relay accepted and records its actor id (object as object)', async () => {
    await withFreshDatabase(async (database) => {
      const relay = await seedPendingRelay(database)

      const updated = await acceptRelayRequest({
        activity: { actor: RELAY_ACTOR, object: { id: FOLLOW_ID } },
        database
      })

      expect(updated?.id).toBe(relay.id)
      expect(updated?.state).toBe('accepted')
      expect(updated?.actorId).toBe(RELAY_ACTOR)
      expect(updated?.lastError).toBeNull()
    })
  })

  it('matches when the relay echoes the Follow id as a bare string', async () => {
    await withFreshDatabase(async (database) => {
      await seedPendingRelay(database)
      const updated = await acceptRelayRequest({
        activity: { actor: RELAY_ACTOR, object: FOLLOW_ID },
        database
      })
      expect(updated?.state).toBe('accepted')
    })
  })

  it('returns null when no subscription matches the Follow id', async () => {
    await withFreshDatabase(async (database) => {
      await seedPendingRelay(database)
      const updated = await acceptRelayRequest({
        activity: { actor: RELAY_ACTOR, object: 'https://other/follow' },
        database
      })
      expect(updated).toBeNull()
    })
  })
})

describe('rejectRelayRequest', () => {
  it('marks the relay rejected and records the error', async () => {
    await withFreshDatabase(async (database) => {
      const relay = await seedPendingRelay(database)
      const updated = await rejectRelayRequest({
        activity: { actor: RELAY_ACTOR, object: { id: FOLLOW_ID } },
        database
      })
      expect(updated?.id).toBe(relay.id)
      expect(updated?.state).toBe('rejected')
      expect(updated?.lastError).toBeTruthy()
    })
  })
})
