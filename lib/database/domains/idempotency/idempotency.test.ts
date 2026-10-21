import {
  IDEMPOTENCY_KEY_TTL_MS,
  IDEMPOTENCY_PENDING_STALE_MS,
  IdempotencyConflictError,
  IdempotencyDeletedError
} from '@/lib/database/domains/idempotency/types'
import { statusHydrationFor } from '@/lib/database/domains/status/queries'
import { createNoteWithResult } from '@/lib/database/domains/status/writes'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('IdempotencyDatabase', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

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

  it("reads and claims only the asking actor's key row", async () => {
    const actorA = actor('isolation-a')
    const actorB = actor('isolation-b')
    await database.saveIdempotencyKey({
      actorId: actorA,
      key: 'shared-key',
      statusId: 'status-a',
      contentHash: 'hash-a'
    })
    await database.saveIdempotencyKey({
      actorId: actorB,
      key: 'shared-key',
      statusId: 'status-b',
      contentHash: 'hash-b'
    })

    await expect(
      database.getIdempotencyKey({ actorId: actorA, key: 'shared-key' })
    ).resolves.toMatchObject({ statusId: 'status-a', contentHash: 'hash-a' })
    await expect(
      database.getIdempotencyKey({ actorId: actorB, key: 'shared-key' })
    ).resolves.toMatchObject({ statusId: 'status-b', contentHash: 'hash-b' })

    // Even a status id both rows name (the claim also filters on it) is
    // claimed only for the actor that asked.
    await database.saveIdempotencyKey({
      actorId: actorA,
      key: 'same-status-key',
      statusId: 'status-both'
    })
    await database.saveIdempotencyKey({
      actorId: actorB,
      key: 'same-status-key',
      statusId: 'status-both'
    })
    // saveIdempotencyKey stores a legacy 'complete' key; a create's is pending.
    await db
      .updateTable('idempotency_keys')
      .set({ state: 'pending' })
      .where('key', '=', 'same-status-key')
      .execute()
    await expect(
      database.claimIdempotencyKeyPublish({
        actorId: actorA,
        key: 'same-status-key',
        statusId: 'status-both'
      })
    ).resolves.toBe(true)
    await expect(
      database.getIdempotencyKey({ actorId: actorA, key: 'same-status-key' })
    ).resolves.toMatchObject({ state: 'publishing' })
    await expect(
      database.getIdempotencyKey({ actorId: actorB, key: 'same-status-key' })
    ).resolves.toMatchObject({ state: 'pending' })
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
      state: 'complete',
      createdAt: expect.any(Number)
    })
  })

  it('claims a status create key as pending and moves it only while it is bound to that status', async () => {
    const actorId = actor('state')
    await database.createActor({
      actorId,
      username: 'idempotent_state',
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'pub',
      privateKey: 'priv',
      createdAt: Date.now()
    })
    const statusId = `${actorId}/statuses/state`
    await database.createNoteWithResult({
      id: statusId,
      url: statusId,
      actorId,
      text: 'Stateful status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      idempotency: { key: 'state-key', contentHash: 'hash-state' }
    })
    await expect(
      database.getIdempotencyKey({ actorId, key: 'state-key' })
    ).resolves.toMatchObject({ statusId, state: 'pending' })

    await database.setIdempotencyKeyState({
      actorId,
      key: 'state-key',
      statusId: `${actorId}/statuses/other`,
      state: 'complete'
    })
    await expect(
      database.getIdempotencyKey({ actorId, key: 'state-key' })
    ).resolves.toMatchObject({ state: 'pending' })

    // Nor while no request holds it to publish.
    await database.setIdempotencyKeyState({
      actorId,
      key: 'state-key',
      statusId,
      state: 'publish_failed'
    })
    await expect(
      database.getIdempotencyKey({ actorId, key: 'state-key' })
    ).resolves.toMatchObject({ state: 'pending' })

    await database.claimIdempotencyKeyPublish({
      actorId,
      key: 'state-key',
      statusId
    })
    await database.setIdempotencyKeyState({
      actorId,
      key: 'state-key',
      statusId,
      state: 'publish_failed'
    })
    await expect(
      database.getIdempotencyKey({ actorId, key: 'state-key' })
    ).resolves.toMatchObject({ state: 'publish_failed' })
  })

  it("moves only the asking actor's key row to a new state", async () => {
    const actorA = actor('state-a')
    const actorB = actor('state-b')
    for (const actorId of [actorA, actorB]) {
      await database.saveIdempotencyKey({
        actorId,
        key: 'state-shared',
        statusId: 'status-state-both'
      })
    }
    await db
      .updateTable('idempotency_keys')
      .set({ state: 'publishing' })
      .where('key', '=', 'state-shared')
      .execute()

    await database.setIdempotencyKeyState({
      actorId: actorA,
      key: 'state-shared',
      statusId: 'status-state-both',
      state: 'publish_failed'
    })

    await expect(
      database.getIdempotencyKey({ actorId: actorA, key: 'state-shared' })
    ).resolves.toMatchObject({ state: 'publish_failed' })
    await expect(
      database.getIdempotencyKey({ actorId: actorB, key: 'state-shared' })
    ).resolves.toMatchObject({ state: 'publishing' })
  })

  const createKeyedActor = async (name: string) => {
    const actorId = actor(name)
    await database.createActor({
      actorId,
      username: `idempotent_${name.replaceAll('-', '_')}`,
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'pub',
      privateKey: 'priv',
      createdAt: Date.now()
    })
    return actorId
  }

  const keyedNote = (actorId: string, name: string, key: string) => ({
    id: `${actorId}/statuses/${name}`,
    url: `${actorId}/statuses/${name}`,
    actorId,
    text: `Keyed ${key}`,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    idempotency: { key, contentHash: `hash-${key}` }
  })

  it('lets exactly one of the create and its retries take the key to publish', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const actorId = await createKeyedActor('claim-publish')
      const claim = (key: string, statusId: string, retry = false) =>
        database.claimIdempotencyKeyPublish({
          actorId,
          key,
          statusId,
          staleBefore: retry
            ? new Date(Date.now() - IDEMPOTENCY_PENDING_STALE_MS)
            : undefined
        })
      const stateOf = async (key: string) =>
        (await database.getIdempotencyKey({ actorId, key }))?.state

      const pending = keyedNote(actorId, 'pending', 'claim-pending')
      await database.createNoteWithResult(pending)
      // Not for another status, nor for a retry while the claim is fresh.
      await expect(
        claim('claim-pending', `${actorId}/statuses/other`)
      ).resolves.toBe(false)
      await expect(claim('claim-pending', pending.id, true)).resolves.toBe(
        false
      )
      // The create's own request takes it to 'publishing' once.
      const takenAt = Date.now()
      await expect(claim('claim-pending', pending.id)).resolves.toBe(true)
      await expect(stateOf('claim-pending')).resolves.toBe('publishing')
      await expect(claim('claim-pending', pending.id)).resolves.toBe(false)
      // A retry takes a 'publishing' key only once it is stale, then once.
      vi.setSystemTime(takenAt + IDEMPOTENCY_PENDING_STALE_MS - 1)
      await expect(claim('claim-pending', pending.id, true)).resolves.toBe(
        false
      )
      vi.setSystemTime(takenAt + IDEMPOTENCY_PENDING_STALE_MS)
      await expect(claim('claim-pending', pending.id, true)).resolves.toBe(true)
      await expect(claim('claim-pending', pending.id, true)).resolves.toBe(
        false
      )
      await expect(claim('claim-pending', pending.id)).resolves.toBe(false)

      // A retry takes a stale 'pending' key, once.
      const abandoned = keyedNote(actorId, 'abandoned', 'claim-abandoned')
      const createdAt = Date.now()
      await database.createNoteWithResult(abandoned)
      vi.setSystemTime(createdAt + IDEMPOTENCY_PENDING_STALE_MS - 1)
      await expect(claim('claim-abandoned', abandoned.id, true)).resolves.toBe(
        false
      )
      vi.setSystemTime(createdAt + IDEMPOTENCY_PENDING_STALE_MS)
      await expect(claim('claim-abandoned', abandoned.id, true)).resolves.toBe(
        true
      )
      await expect(claim('claim-abandoned', abandoned.id, true)).resolves.toBe(
        false
      )
      await expect(claim('claim-abandoned', abandoned.id)).resolves.toBe(false)

      // A retry takes a 'publish_failed' key whatever its age; the create's
      // own request does not.
      await database.setIdempotencyKeyState({
        actorId,
        key: 'claim-abandoned',
        statusId: abandoned.id,
        state: 'publish_failed'
      })
      await expect(claim('claim-abandoned', abandoned.id)).resolves.toBe(false)
      await expect(claim('claim-abandoned', abandoned.id, true)).resolves.toBe(
        true
      )
      await expect(stateOf('claim-abandoned')).resolves.toBe('publishing')

      // Nothing takes a 'complete' key.
      await database.setIdempotencyKeyState({
        actorId,
        key: 'claim-abandoned',
        statusId: abandoned.id,
        state: 'complete'
      })
      vi.setSystemTime(Date.now() + IDEMPOTENCY_PENDING_STALE_MS)
      await expect(claim('claim-abandoned', abandoned.id, true)).resolves.toBe(
        false
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a late queue answer from a request whose key a retry took over and completed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const actorId = await createKeyedActor('late-answer')
      const note = keyedNote(actorId, 'late', 'late-answer-key')
      await database.createNoteWithResult(note)
      const stateOf = async () =>
        (await database.getIdempotencyKey({ actorId, key: 'late-answer-key' }))
          ?.state
      // Request A takes the key, then its queue call hangs past the stale
      // window, so retry B takes the key over and the queue accepts B's job.
      const takenAt = Date.now()
      await expect(
        database.claimIdempotencyKeyPublish({
          actorId,
          key: 'late-answer-key',
          statusId: note.id
        })
      ).resolves.toBe(true)
      vi.setSystemTime(takenAt + IDEMPOTENCY_PENDING_STALE_MS)
      const staleBefore = new Date(Date.now() - IDEMPOTENCY_PENDING_STALE_MS)
      await expect(
        database.claimIdempotencyKeyPublish({
          actorId,
          key: 'late-answer-key',
          statusId: note.id,
          staleBefore
        })
      ).resolves.toBe(true)
      await database.setIdempotencyKeyState({
        actorId,
        key: 'late-answer-key',
        statusId: note.id,
        state: 'complete'
      })

      // A's queue call then fails: its late write must not move the key back.
      await database.setIdempotencyKeyState({
        actorId,
        key: 'late-answer-key',
        statusId: note.id,
        state: 'publish_failed'
      })
      await expect(stateOf()).resolves.toBe('complete')
      await expect(
        database.claimIdempotencyKeyPublish({
          actorId,
          key: 'late-answer-key',
          statusId: note.id,
          staleBefore
        })
      ).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an unpublished status whose key a retry has taken over', async () => {
    const actorId = await createKeyedActor('discard-taken')
    const note = keyedNote(actorId, 'taken', 'discard-taken-key')
    await database.createNoteWithResult(note)
    await database.claimIdempotencyKeyPublish({
      actorId,
      key: 'discard-taken-key',
      statusId: note.id,
      staleBefore: new Date(Date.now() + 1_000)
    })

    await expect(
      database.discardUnpublishedStatus({
        actorId,
        statusId: note.id,
        idempotencyKey: 'discard-taken-key'
      })
    ).resolves.toBe(false)

    await expect(
      database.getStatus({ statusId: note.id, withReplies: false })
    ).resolves.toMatchObject({ id: note.id })
    await expect(
      database.getIdempotencyKey({ actorId, key: 'discard-taken-key' })
    ).resolves.toMatchObject({ statusId: note.id, state: 'publishing' })
  })

  it('fails a lost key claim with its unique error, not 410, when the winner is discarded after its key was read', async () => {
    const actorId = await createKeyedActor('dup-discarded')
    const winner = keyedNote(actorId, 'winner', 'dup-discarded-key')
    await database.createNoteWithResult(winner)
    const hydration = statusHydrationFor(db)
    // The winner's discard commits between the loser's key and status reads.
    const racingHydration = {
      ...hydration,
      getStatus: async (params: Parameters<typeof hydration.getStatus>[0]) => {
        if (params.statusId === winner.id) {
          await database.discardUnpublishedStatus({
            actorId,
            statusId: winner.id,
            idempotencyKey: 'dup-discarded-key'
          })
        }
        return hydration.getStatus(params)
      }
    }

    const error = await createNoteWithResult(
      db,
      racingHydration,
      keyedNote(actorId, 'loser', 'dup-discarded-key')
    ).catch((caught: unknown) => caught)

    expect(error).not.toBeInstanceOf(IdempotencyDeletedError)
    expect(isUniqueConstraintError(error)).toBe(true)
    await expect(
      database.getStatus({
        statusId: `${actorId}/statuses/loser`,
        withReplies: false
      })
    ).resolves.toBeNull()
  })

  it('discards an unpublished status without deleting a key bound to another status', async () => {
    const actorId = actor('discard-scope')
    await database.saveIdempotencyKey({
      actorId,
      key: 'shared-key',
      statusId: `${actorId}/statuses/kept`
    })

    await database.discardUnpublishedStatus({
      actorId,
      statusId: `${actorId}/statuses/discarded`,
      idempotencyKey: 'shared-key'
    })

    await expect(
      database.getIdempotentStatusId({ actorId, key: 'shared-key' })
    ).resolves.toBe(`${actorId}/statuses/kept`)
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

  it('stamps the claim with the request time, so a backdated status keeps its key past the TTL sweep', async () => {
    const actorId = actor('backdated')
    await database.createActor({
      actorId,
      username: 'idempotent_backdated',
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'pub',
      privateKey: 'priv',
      createdAt: Date.now()
    })
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000

    await database.createNoteWithResult({
      id: `${actorId}/statuses/note`,
      url: `${actorId}/statuses/note`,
      actorId,
      text: 'Backdated note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: thirtyDaysAgo,
      idempotency: { key: 'backdated-note', contentHash: 'hash-note' }
    })
    await database.createPollWithResult({
      id: `${actorId}/statuses/poll`,
      url: `${actorId}/statuses/poll`,
      actorId,
      text: 'Backdated poll',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      choices: ['a', 'b'],
      endAt: Date.now() + 86_400_000,
      createdAt: thirtyDaysAgo,
      idempotency: { key: 'backdated-poll', contentHash: 'hash-poll' }
    })

    await database.deleteExpiredIdempotencyKeys()

    await expect(
      database.getIdempotencyKey({ actorId, key: 'backdated-note' })
    ).resolves.toMatchObject({ statusId: `${actorId}/statuses/note` })
    await expect(
      database.getIdempotencyKey({ actorId, key: 'backdated-poll' })
    ).resolves.toMatchObject({ statusId: `${actorId}/statuses/poll` })
  })

  it('purges keys past the 7-day TTL by default', async () => {
    const actorId = actor('default-ttl')
    const now = Date.now()
    await database.saveIdempotencyKey({
      actorId,
      key: 'eight-days',
      statusId: 'status-eight-days',
      createdAt: now - 8 * 86_400_000
    })
    await database.saveIdempotencyKey({
      actorId,
      key: 'six-days',
      statusId: 'status-six-days',
      createdAt: now - 6 * 86_400_000
    })

    await database.deleteExpiredIdempotencyKeys()

    await expect(
      database.getIdempotencyKey({ actorId, key: 'eight-days' })
    ).resolves.toBeNull()
    await expect(
      database.getIdempotencyKey({ actorId, key: 'six-days' })
    ).resolves.toMatchObject({ statusId: 'status-six-days' })
  })

  it('claims idempotency key atomically inside createPollWithResult and resolves duplicates and conflicts', async () => {
    const actorId = actor('poll-claim')
    await database.createActor({
      actorId,
      username: 'idempotent_poll_claim',
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'pub',
      privateKey: 'priv',
      createdAt: Date.now()
    })
    const poll = (n: number, contentHash: string) => ({
      id: `${actorId}/statuses/${n}`,
      url: `${actorId}/statuses/${n}`,
      actorId,
      text: 'Atomic poll',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      choices: ['a', 'b'],
      endAt: Date.now() + 86_400_000,
      idempotency: { key: 'poll-key', contentHash }
    })

    const first = await database.createPollWithResult(poll(1, 'hash-poll'))
    expect(first.isNew).toBe(true)
    await expect(
      database.getIdempotencyKey({ actorId, key: 'poll-key' })
    ).resolves.toMatchObject({
      statusId: `${actorId}/statuses/1`,
      contentHash: 'hash-poll'
    })

    const duplicate = await database.createPollWithResult(poll(2, 'hash-poll'))
    expect(duplicate.isNew).toBe(false)
    expect(duplicate.status.id).toBe(`${actorId}/statuses/1`)
    await expect(
      database.getStatus({ statusId: `${actorId}/statuses/2` })
    ).resolves.toBeNull()

    await expect(
      database.createPollWithResult(poll(3, 'hash-other'))
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
    await expect(
      database.getStatus({ statusId: `${actorId}/statuses/3` })
    ).resolves.toBeNull()
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
