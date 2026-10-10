import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('IdempotencyDatabase', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  // Each test uses its own actor so the tests don't depend on order.
  const actor = (name: string) => `https://llun.test/users/idempotent-${name}`

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('returns null for a key the actor never saved', async () => {
    const actorId = actor('miss')
    await database.saveIdempotencyKey({
      actorId,
      key: 'saved',
      statusId: 'saved-status'
    })

    await expect(
      database.getIdempotentStatusId({ actorId, key: 'unknown' })
    ).resolves.toBeNull()
  })

  it('keeps the first status recorded for a key', async () => {
    const actorId = actor('first-writer')
    await database.saveIdempotencyKey({
      actorId,
      key: 'post-1',
      statusId: 'status-1'
    })
    // A retry or race recording the same key must not overwrite or throw.
    await database.saveIdempotencyKey({
      actorId,
      key: 'post-1',
      statusId: 'status-2'
    })

    await expect(
      database.getIdempotentStatusId({ actorId, key: 'post-1' })
    ).resolves.toBe('status-1')
  })

  it('scopes keys to the actor', async () => {
    const actorId = actor('scoped')
    const otherActorId = actor('someone-else')
    await database.saveIdempotencyKey({
      actorId: otherActorId,
      key: 'theirs-only',
      statusId: 'their-status'
    })

    await expect(
      database.getIdempotentStatusId({ actorId, key: 'theirs-only' })
    ).resolves.toBeNull()

    // The same key held by both actors resolves to each actor's own status.
    await database.saveIdempotencyKey({
      actorId,
      key: 'theirs-only',
      statusId: 'my-status'
    })
    await expect(
      database.getIdempotentStatusId({ actorId, key: 'theirs-only' })
    ).resolves.toBe('my-status')
    await expect(
      database.getIdempotentStatusId({
        actorId: otherActorId,
        key: 'theirs-only'
      })
    ).resolves.toBe('their-status')
  })
})
