import {
  loadIdempotentStatus,
  resolveExistingIdempotentStatus,
  trackInFlightStatusCreation
} from '@/lib/actions/createNote'
import { IdempotencyDeletedError } from '@/lib/database/domains/idempotency/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('idempotent status lookup', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const actorId = 'https://llun.test/users/inflight'

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await database.createActor({
      actorId,
      username: 'inflight',
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'pub',
      privateKey: 'priv',
      createdAt: Date.now()
    })
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const createKeyedNote = async (name: string) => {
    const statusId = `${actorId}/statuses/${name}`
    await database.createNoteWithResult({
      id: statusId,
      url: statusId,
      actorId,
      text: name,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      idempotency: { key: name, contentHash: `hash-${name}` }
    })
    return statusId
  }

  it('waits for an in-process create of the keyed status before returning it', async () => {
    const statusId = await createKeyedNote('in-flight')
    const finish = trackInFlightStatusCreation(statusId)
    let settled = false
    const lookup = resolveExistingIdempotentStatus({
      database,
      actorId,
      idempotency: { key: 'in-flight', contentHash: 'hash-in-flight' }
    }).finally(() => {
      settled = true
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    finish()
    await expect(lookup).resolves.toMatchObject({ id: statusId })
  })

  it('returns null when the create discarded both its status and its key', async () => {
    const statusId = await createKeyedNote('discarded')
    await database.discardUnpublishedStatus({
      actorId,
      statusId,
      idempotencyKey: 'discarded'
    })

    await expect(
      loadIdempotentStatus({ database, actorId, key: 'discarded', statusId })
    ).resolves.toBeNull()
    await expect(
      database.getIdempotencyKey({ actorId, key: 'discarded' })
    ).resolves.toBeNull()
  })

  it('throws IdempotencyDeletedError when the key outlived its deleted status', async () => {
    const statusId = await createKeyedNote('deleted')
    await database.deleteStatus({ statusId })

    await expect(
      loadIdempotentStatus({ database, actorId, key: 'deleted', statusId })
    ).rejects.toBeInstanceOf(IdempotencyDeletedError)
  })
})
