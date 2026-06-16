import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

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

describe('createRelay', () => {
  it('creates a relay in the idle state with null discovery fields', async () => {
    await withFreshDatabase(async (database) => {
      const relay = await database.createRelay({
        inboxUrl: 'https://relay.example/inbox'
      })

      expect(relay.id).toBeTruthy()
      expect(relay.inboxUrl).toBe('https://relay.example/inbox')
      expect(relay.actorId).toBeNull()
      expect(relay.state).toBe('idle')
      expect(relay.followActivityId).toBeNull()
      expect(relay.lastError).toBeNull()
      expect(typeof relay.createdAt).toBe('number')
      expect(typeof relay.updatedAt).toBe('number')

      expect(await database.getRelays()).toEqual([relay])
    })
  })

  it('rejects a duplicate inboxUrl', async () => {
    await withFreshDatabase(async (database) => {
      await database.createRelay({ inboxUrl: 'https://relay.example/inbox' })
      await expect(
        database.createRelay({ inboxUrl: 'https://relay.example/inbox' })
      ).rejects.toThrow()
    })
  })
})

describe('updateRelay', () => {
  it('updates only the provided fields and bumps updatedAt', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createRelay({
        inboxUrl: 'https://relay.example/inbox'
      })

      const updated = await database.updateRelay({
        id: created.id,
        state: 'pending',
        followActivityId: 'https://example.com/activities/follow-1'
      })

      expect(updated).not.toBeNull()
      expect(updated?.state).toBe('pending')
      expect(updated?.followActivityId).toBe(
        'https://example.com/activities/follow-1'
      )
      expect(updated?.actorId).toBeNull()
      expect(updated?.createdAt).toBe(created.createdAt)
    })
  })

  it('clears a column when null is passed', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createRelay({
        inboxUrl: 'https://relay.example/inbox'
      })
      await database.updateRelay({ id: created.id, lastError: 'boom' })

      const cleared = await database.updateRelay({
        id: created.id,
        lastError: null
      })
      expect(cleared?.lastError).toBeNull()
    })
  })

  it('returns null for an unknown id', async () => {
    await withFreshDatabase(async (database) => {
      expect(
        await database.updateRelay({ id: 'unknown', state: 'accepted' })
      ).toBeNull()
    })
  })
})

describe('getRelayByActorId', () => {
  it('resolves a relay by its discovered actor id', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createRelay({
        inboxUrl: 'https://relay.example/inbox'
      })
      await database.updateRelay({
        id: created.id,
        actorId: 'https://relay.example/actor',
        state: 'accepted'
      })

      const found = await database.getRelayByActorId({
        actorId: 'https://relay.example/actor'
      })
      expect(found?.id).toBe(created.id)

      expect(
        await database.getRelayByActorId({ actorId: 'https://other/actor' })
      ).toBeNull()
    })
  })
})

describe('getAcceptedRelays', () => {
  it('returns only relays in the accepted state', async () => {
    await withFreshDatabase(async (database) => {
      const accepted = await database.createRelay({
        inboxUrl: 'https://a.example/inbox'
      })
      await database.updateRelay({ id: accepted.id, state: 'accepted' })

      const pending = await database.createRelay({
        inboxUrl: 'https://b.example/inbox'
      })
      await database.updateRelay({ id: pending.id, state: 'pending' })

      const relays = await database.getAcceptedRelays()
      expect(relays.map((relay) => relay.id)).toEqual([accepted.id])
    })
  })
})

describe('getRelayByInboxUrl', () => {
  it('resolves a relay by inbox url and returns null when unknown', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createRelay({
        inboxUrl: 'https://relay.example/inbox'
      })
      const found = await database.getRelayByInboxUrl({
        inboxUrl: 'https://relay.example/inbox'
      })
      expect(found?.id).toBe(created.id)
      expect(
        await database.getRelayByInboxUrl({ inboxUrl: 'https://nope/inbox' })
      ).toBeNull()
    })
  })
})

describe('deleteRelay', () => {
  it('removes the relay and returns false for an unknown id', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createRelay({
        inboxUrl: 'https://relay.example/inbox'
      })
      expect(await database.deleteRelay({ id: created.id })).toBe(true)
      expect(await database.getRelays()).toEqual([])
      expect(await database.deleteRelay({ id: 'no-such-id' })).toBe(false)
    })
  })
})
