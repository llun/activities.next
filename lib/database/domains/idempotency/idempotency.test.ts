import {
  IDEMPOTENCY_KEY_TTL_MS,
  IdempotencyConflictError,
  IdempotencyDeletedError
} from '@/lib/database/domains/idempotency/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

  it('stores and retrieves contentHash via getIdempotencyKey', async () => {
    const actorId = actor('hash')
    await database.saveIdempotencyKey({
      actorId,
      key: 'hashed-key',
      statusId: 'status-hashed',
      contentHash: 'sha256-abc'
    })

    await expect(
      database.getIdempotencyKey({ actorId, key: 'hashed-key' })
    ).resolves.toMatchObject({
      actorId,
      key: 'hashed-key',
      statusId: 'status-hashed',
      contentHash: 'sha256-abc',
      createdAt: expect.any(Number)
    })
  })

  it('deletes idempotency keys older than 7 days and keeps newer ones', async () => {
    const actorId = actor('cleanup')
    const now = Date.now()
    const eightDaysAgo = new Date(now - IDEMPOTENCY_KEY_TTL_MS - 86_400_000)
    const sixDaysAgo = new Date(now - IDEMPOTENCY_KEY_TTL_MS + 86_400_000)

    await database.saveIdempotencyKey({
      actorId,
      key: 'expired-key',
      statusId: 'status-expired',
      contentHash: 'hash-1',
      createdAt: eightDaysAgo
    })
    await database.saveIdempotencyKey({
      actorId,
      key: 'fresh-key',
      statusId: 'status-fresh',
      contentHash: 'hash-2',
      createdAt: sixDaysAgo
    })

    const deletedCount = await database.deleteExpiredIdempotencyKeys({
      olderThan: new Date(now - IDEMPOTENCY_KEY_TTL_MS)
    })
    expect(deletedCount).toBeGreaterThanOrEqual(1)

    await expect(
      database.getIdempotencyKey({ actorId, key: 'expired-key' })
    ).resolves.toBeNull()
    await expect(
      database.getIdempotencyKey({ actorId, key: 'fresh-key' })
    ).resolves.toMatchObject({
      statusId: 'status-fresh',
      contentHash: 'hash-2'
    })
  })

  it('claims idempotency key atomically inside createNoteWithResult and resolves DB-level duplicates, conflicts, and deleted tombstones', async () => {
    const actorId = actor('tx-claim')
    await database.createActor({
      actorId,
      username: 'idempotent_tx_claim',
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'pub',
      privateKey: 'priv',
      createdAt: Date.now()
    })

    const first = await database.createNoteWithResult({
      id: `${actorId}/statuses/1`,
      url: `${actorId}/statuses/1`,
      actorId,
      text: 'Atomic status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      idempotency: { key: 'atomic-key-1', contentHash: 'hash-atomic-1' }
    })
    expect(first.isNew).toBe(true)
    expect(first.status.id).toBe(`${actorId}/statuses/1`)

    // A second writer racing on the same (actorId, key) with matching hash
    // hits the unique constraint inside the transaction, rolls back its own
    // status row, and returns the winning status with isNew: false.
    const duplicate = await database.createNoteWithResult({
      id: `${actorId}/statuses/2`,
      url: `${actorId}/statuses/2`,
      actorId,
      text: 'Atomic status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      idempotency: { key: 'atomic-key-1', contentHash: 'hash-atomic-1' }
    })
    expect(duplicate.isNew).toBe(false)
    expect(duplicate.status.id).toBe(`${actorId}/statuses/1`)
    await expect(
      database.getStatus({ statusId: `${actorId}/statuses/2` })
    ).resolves.toBeNull()

    // Same key with different contentHash throws IdempotencyConflictError and
    // leaves no second status row behind.
    await expect(
      database.createNoteWithResult({
        id: `${actorId}/statuses/3`,
        url: `${actorId}/statuses/3`,
        actorId,
        text: 'Mutated status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        idempotency: { key: 'atomic-key-1', contentHash: 'hash-different' }
      })
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
    await expect(
      database.getStatus({ statusId: `${actorId}/statuses/3` })
    ).resolves.toBeNull()

    // Deleting the winning status keeps the key tombstone; a retry with the
    // same key throws IdempotencyDeletedError instead of recreating the post.
    await database.deleteStatus({ statusId: `${actorId}/statuses/1` })
    await expect(
      database.createNoteWithResult({
        id: `${actorId}/statuses/4`,
        url: `${actorId}/statuses/4`,
        actorId,
        text: 'Atomic status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        idempotency: { key: 'atomic-key-1', contentHash: 'hash-atomic-1' }
      })
    ).rejects.toBeInstanceOf(IdempotencyDeletedError)
    await expect(
      database.getStatus({ statusId: `${actorId}/statuses/4` })
    ).resolves.toBeNull()
  })
})
