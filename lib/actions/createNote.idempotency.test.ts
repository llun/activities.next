import {
  createNoteFromUserInput,
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
import type { Actor } from '@/lib/types/domain/actor'
import type { CustomEmojiData } from '@/lib/types/domain/customEmoji'
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
  ) =>
    // Written directly: setIdempotencyKeyState moves only a 'publishing' key.
    db
      .updateTable('idempotency_keys')
      .set({ state })
      .where('actorId', '=', actorId)
      .where('key', '=', name)
      .where('statusId', '=', statusId)
      .execute()

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

  it('fails a replay as a kept post when answering it fails unexpectedly', async () => {
    const statusId = await createKeyedNote('replay-claim-fails')
    await setState('replay-claim-fails', statusId, 'publish_failed')
    vi.spyOn(database, 'claimIdempotencyKeyPublish').mockRejectedValueOnce(
      new Error('database gone')
    )

    await expect(
      resolveExistingIdempotentStatus({
        database,
        actorId,
        idempotency: {
          key: 'replay-claim-fails',
          contentHash: 'hash-replay-claim-fails'
        }
      })
    ).rejects.toBeInstanceOf(StatusPublishFailedError)
    await expect(stateOf('replay-claim-fails')).resolves.toBe('publish_failed')
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

  // Another process's retry does not see this process's in-flight create.
  const forgetInFlight = (statusId: string) =>
    trackInFlightStatusCreation(statusId)()

  // A create whose emoji step (a completion step) waits on `emojis`, and the
  // id of the status it claimed the key for, once it reaches that step.
  const startSlowCreate = async (name: string) => {
    const emojis = createDeferred<CustomEmojiData[]>()
    const emojiSpy = vi
      .spyOn(database, 'getCustomEmojis')
      .mockReturnValueOnce(emojis.promise)
    const actor = (await database.getActorFromId({ id: actorId })) as Actor
    const create = createNoteFromUserInput({
      text: name,
      currentActor: actor,
      idempotency: { key: name, contentHash: `hash-${name}` },
      database
    })
    create.catch(() => undefined)
    await vi.waitFor(() => expect(emojiSpy).toHaveBeenCalled())
    const claim = await database.getIdempotencyKey({ actorId, key: name })
    return { create, emojis, statusId: claim!.statusId }
  }

  const retry = (name: string) =>
    resolveExistingIdempotentStatus({
      database,
      actorId,
      idempotency: { key: name, contentHash: `hash-${name}` }
    })

  it('sends the post once when a retry takes over a slow create that then finishes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { create, emojis, statusId } = await startSlowCreate('slow-create')
    forgetInFlight(statusId)
    vi.setSystemTime(Date.now() + IDEMPOTENCY_PENDING_STALE_MS)

    await expect(retry('slow-create')).resolves.toMatchObject({ id: statusId })
    expect(mockPublish).toHaveBeenCalledTimes(1)

    emojis.resolve([])
    await expect(create).resolves.toMatchObject({ id: statusId })
    expect(mockPublish).toHaveBeenCalledTimes(1)
    await expect(stateOf('slow-create')).resolves.toBe('complete')
  })

  it('keeps a post a retry has sent when its slow create then fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { create, emojis, statusId } = await startSlowCreate('slow-fails')
    forgetInFlight(statusId)
    vi.setSystemTime(Date.now() + IDEMPOTENCY_PENDING_STALE_MS)
    await expect(retry('slow-fails')).resolves.toMatchObject({ id: statusId })

    emojis.reject(new Error('Emoji lookup failed'))
    // The post stays, so the request fails as a kept post (503), never as the
    // route's 400, which would let the client post it again under a new key.
    await expect(create).rejects.toBeInstanceOf(StatusPublishFailedError)

    expect(mockPublish).toHaveBeenCalledTimes(1)
    await expect(
      database.getStatus({ statusId, withReplies: false })
    ).resolves.toMatchObject({ id: statusId })
    await expect(stateOf('slow-fails')).resolves.toBe('complete')
    await expect(retry('slow-fails')).resolves.toMatchObject({ id: statusId })
    expect(mockPublish).toHaveBeenCalledTimes(1)
  })

  const failingCreate = (name: string) => {
    vi.spyOn(database, 'getCustomEmojis').mockRejectedValueOnce(
      new Error('Emoji lookup failed')
    )
    return database.getActorFromId({ id: actorId }).then((actor) =>
      createNoteFromUserInput({
        text: name,
        currentActor: actor as Actor,
        idempotency: { key: name, contentHash: `hash-${name}` },
        database
      })
    )
  }

  it('discards a create whose completion step fails and fails with that error', async () => {
    await expect(failingCreate('discarded-create')).rejects.toThrow(
      'Emoji lookup failed'
    )
    await expect(
      database.getIdempotencyKey({ actorId, key: 'discarded-create' })
    ).resolves.toBeNull()
  })

  it('fails as a kept post when the discard of a failed create fails', async () => {
    vi.spyOn(database, 'discardUnpublishedStatus').mockRejectedValueOnce(
      new Error('database gone')
    )
    await expect(failingCreate('kept-create')).rejects.toBeInstanceOf(
      StatusPublishFailedError
    )
    const claim = await database.getIdempotencyKey({
      actorId,
      key: 'kept-create'
    })
    expect(claim).toMatchObject({ state: 'pending' })
    await expect(
      database.getStatus({ statusId: claim!.statusId, withReplies: false })
    ).resolves.toMatchObject({ id: claim!.statusId })
  })

  it('queues the job once for concurrent retries of a failed publish, and marks the key complete only once the queue accepts it', async () => {
    const statusId = await createKeyedNote('concurrent-retries')
    await setState('concurrent-retries', statusId, 'publish_failed')
    const accepted = createDeferred<void>()
    mockPublish.mockReturnValueOnce(accepted.promise)

    const first = load('concurrent-retries', statusId)
    await vi.waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1))
    await expect(stateOf('concurrent-retries')).resolves.toBe('publishing')
    // The other retry finds the key taken and the queue not yet answered.
    await expect(load('concurrent-retries', statusId)).rejects.toBeInstanceOf(
      IdempotencyInProgressError
    )

    accepted.resolve()
    await expect(first).resolves.toMatchObject({ id: statusId })
    await expect(stateOf('concurrent-retries')).resolves.toBe('complete')
    await expect(load('concurrent-retries', statusId)).resolves.toMatchObject({
      id: statusId
    })
    expect(mockPublish).toHaveBeenCalledTimes(1)
  })

  it.each([
    { state: 'complete', outcome: 'the status' },
    { state: 'pending', outcome: IdempotencyInProgressError },
    { state: 'publishing', outcome: IdempotencyInProgressError },
    { state: 'publish_failed', outcome: StatusPublishFailedError },
    { state: null, outcome: null }
  ] as const)(
    'answers a retry whose claim another request beat, by the key’s new state $state',
    async ({ state, outcome }) => {
      const name = `claim-lost-${state ?? 'gone'}`
      const statusId = await createKeyedNote(name)
      await setState(name, statusId, 'publish_failed')
      // Another request moves the key between this retry's read and claim.
      vi.spyOn(database, 'claimIdempotencyKeyPublish').mockImplementationOnce(
        async () => {
          if (state) await setState(name, statusId, state)
          else {
            await db
              .deleteFrom('idempotency_keys')
              .where('actorId', '=', actorId)
              .where('key', '=', name)
              .execute()
          }
          return false
        }
      )

      const result = load(name, statusId)

      if (outcome === 'the status') {
        await expect(result).resolves.toMatchObject({ id: statusId })
      } else if (outcome === null) {
        await expect(result).resolves.toBeNull()
      } else {
        await expect(result).rejects.toBeInstanceOf(outcome)
      }
      expect(mockPublish).not.toHaveBeenCalled()
    }
  )

  it('returns null, not 410, when the create is discarded between the key and status reads', async () => {
    const statusId = await createKeyedNote('discard-race')
    const getStatus = database.getStatus.bind(database)
    vi.spyOn(database, 'getStatus').mockImplementationOnce(async (params) => {
      await database.discardUnpublishedStatus({
        actorId,
        statusId,
        idempotencyKey: 'discard-race'
      })
      return getStatus(params)
    })

    await expect(load('discard-race', statusId)).resolves.toBeNull()
  })
})
