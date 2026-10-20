import {
  loadIdempotentStatus,
  resolveExistingIdempotentStatus,
  settleAll,
  trackInFlightStatusCreation
} from '@/lib/actions/createNote'
import {
  IDEMPOTENCY_PENDING_STALE_MS,
  IdempotencyDeletedError,
  IdempotencyInProgressError,
  type IdempotencyKeyState,
  StatusPublishFailedError
} from '@/lib/database/domains/idempotency/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { createDeferred } from '@/lib/testing/deferred'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish, runsInline: false })
}))

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('settleAll', () => {
  it('rejects with the first failure only after every sibling has settled', async () => {
    const slow = createDeferred<void>()
    let settled = false
    const all = settleAll([
      Promise.reject(new Error('first failure')),
      slow.promise
    ]).finally(() => {
      settled = true
    })
    all.catch(() => undefined)

    await flushMicrotasks()
    expect(settled).toBe(false)

    slow.resolve()
    await expect(all).rejects.toThrow('first failure')
  })
})

describe('idempotent status lookup', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb
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

  beforeEach(() => {
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  // Claims `name` as a key in the 'pending' state, as a create does.
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

  const setState = (
    name: string,
    statusId: string,
    state: IdempotencyKeyState
  ) => database.setIdempotencyKeyState({ actorId, key: name, statusId, state })

  const stateOf = async (name: string) =>
    (await database.getIdempotencyKey({ actorId, key: name }))?.state

  const load = (name: string, statusId: string) =>
    loadIdempotentStatus({ database, actorId, key: name, statusId })

  it('waits for an in-process create of the keyed status before reading it', async () => {
    const statusId = await createKeyedNote('in-flight')
    const finish = trackInFlightStatusCreation(statusId)
    const keySpy = vi.spyOn(database, 'getIdempotencyKey')
    const statusSpy = vi.spyOn(database, 'getStatus')

    const lookup = resolveExistingIdempotentStatus({
      database,
      actorId,
      idempotency: { key: 'in-flight', contentHash: 'hash-in-flight' }
    })
    await keySpy.mock.results[0]?.value
    await flushMicrotasks()
    expect(statusSpy).not.toHaveBeenCalled()

    // The create writes its key state before it stops being in flight.
    await setState('in-flight', statusId, 'complete')
    finish()
    await expect(lookup).resolves.toMatchObject({ id: statusId })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns a complete key’s status without queueing anything', async () => {
    const statusId = await createKeyedNote('complete')
    await setState('complete', statusId, 'complete')

    await expect(load('complete', statusId)).resolves.toMatchObject({
      id: statusId
    })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('queues the job again with the same id when the publish failed, then marks the key complete', async () => {
    const statusId = await createKeyedNote('publish-failed')
    await setState('publish-failed', statusId, 'publish_failed')

    await expect(load('publish-failed', statusId)).resolves.toMatchObject({
      id: statusId
    })
    expect(mockPublish).toHaveBeenCalledWith({
      id: getHashFromString(statusId),
      name: SEND_NOTE_JOB_NAME,
      data: { actorId, statusId }
    })
    await expect(stateOf('publish-failed')).resolves.toBe('complete')
  })

  it('throws StatusPublishFailedError and keeps the key publish_failed when the queue refuses again', async () => {
    const statusId = await createKeyedNote('publish-fails-again')
    await setState('publish-fails-again', statusId, 'publish_failed')
    mockPublish.mockRejectedValueOnce(new Error('Queue unavailable'))

    await expect(load('publish-fails-again', statusId)).rejects.toBeInstanceOf(
      StatusPublishFailedError
    )
    await expect(stateOf('publish-fails-again')).resolves.toBe('publish_failed')
    await expect(
      database.getStatus({ statusId, withReplies: false })
    ).resolves.toMatchObject({ id: statusId })
  })

  it('answers 409 for a pending key until it is IDEMPOTENCY_PENDING_STALE_MS old, then sends the post', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const claimedAt = new Date('2026-10-20T10:00:00.000Z').getTime()
    vi.setSystemTime(claimedAt)
    const statusId = await createKeyedNote('pending')

    vi.setSystemTime(claimedAt + IDEMPOTENCY_PENDING_STALE_MS - 1)
    await expect(load('pending', statusId)).rejects.toBeInstanceOf(
      IdempotencyInProgressError
    )
    expect(mockPublish).not.toHaveBeenCalled()
    await expect(stateOf('pending')).resolves.toBe('pending')

    vi.setSystemTime(claimedAt + IDEMPOTENCY_PENDING_STALE_MS)
    await expect(load('pending', statusId)).resolves.toMatchObject({
      id: statusId
    })
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getHashFromString(statusId),
        name: SEND_NOTE_JOB_NAME
      })
    )
    await expect(stateOf('pending')).resolves.toBe('complete')
  })

  it('re-queues the fitness job for a fitness post whose publish failed', async () => {
    const statusId = await createKeyedNote('fitness')
    const fitnessFile = await database.createFitnessFile({
      actorId,
      fileName: 'ride.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024,
      path: 'fitness/idempotency-ride.fit'
    })
    await database.updateFitnessFileStatus(fitnessFile!.id, statusId)
    await setState('fitness', statusId, 'publish_failed')

    await load('fitness', statusId)

    expect(mockPublish).toHaveBeenCalledWith({
      id: getHashFromString(statusId),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId, statusId, fitnessFileId: fitnessFile!.id }
    })
  })

  it('marks a stale pending poll complete without queueing a job', async () => {
    const statusId = `${actorId}/statuses/stale-poll`
    await database.createPollWithResult({
      id: statusId,
      url: statusId,
      actorId,
      text: 'Stale poll',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      choices: ['Yes', 'No'],
      endAt: Date.now() + 60 * 60 * 1000,
      idempotency: { key: 'stale-poll', contentHash: 'hash-stale-poll' }
    })
    await db
      .updateTable('idempotency_keys')
      .set({ createdAt: new Date(Date.now() - IDEMPOTENCY_PENDING_STALE_MS) })
      .where('actorId', '=', actorId)
      .where('key', '=', 'stale-poll')
      .execute()

    await expect(load('stale-poll', statusId)).resolves.toMatchObject({
      id: statusId
    })
    expect(mockPublish).not.toHaveBeenCalled()
    await expect(stateOf('stale-poll')).resolves.toBe('complete')
  })

  it('returns null when the create discarded both its status and its key', async () => {
    const statusId = await createKeyedNote('discarded')
    await database.discardUnpublishedStatus({
      actorId,
      statusId,
      idempotencyKey: 'discarded'
    })

    await expect(load('discarded', statusId)).resolves.toBeNull()
    await expect(
      database.getIdempotencyKey({ actorId, key: 'discarded' })
    ).resolves.toBeNull()
  })

  it('throws IdempotencyDeletedError when the key outlived its deleted status', async () => {
    const statusId = await createKeyedNote('deleted')
    await database.deleteStatus({ statusId })

    await expect(load('deleted', statusId)).rejects.toBeInstanceOf(
      IdempotencyDeletedError
    )
  })
})
