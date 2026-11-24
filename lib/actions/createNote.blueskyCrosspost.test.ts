import {
  createNoteFromUserInput,
  resolveExistingIdempotentStatus
} from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import {
  IDEMPOTENCY_PENDING_STALE_MS,
  StatusPublishFailedError
} from '@/lib/database/domains/idempotency/types'
import {
  CROSSPOST_BLUESKY_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  PUBLISH_SCHEDULED_STATUS_JOB_NAME,
  SEND_NOTE_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { publishScheduledStatusJob } from '@/lib/jobs/publishScheduledStatusJob'
import { isBlueskyAllowed } from '@/lib/services/bluesky/policy'
import { getQueue } from '@/lib/services/queue'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { ScheduledStatusParams } from '@/lib/types/mastodon/scheduledStatus'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { useCreateNoteFixtures } from './createNote.testUtils'

vi.mock('@/lib/services/federation/federatedRedirect', () => ({
  isFederatedRedirect: vi.fn(async () => true)
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined),
    runsInline: false
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

vi.mock('@/lib/services/bluesky/policy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isBlueskyAllowed: vi.fn()
}))

describe('Bluesky cross-post hooks of new posts', () => {
  const { database, actors } = useCreateNoteFixtures()
  let actor: Actor

  const rowOf = (status: { id: string } | null) =>
    database.getBlueskyCrosspost({ statusId: status!.id })
  const crosspostJobs = () =>
    vi
      .mocked(getQueue().publish)
      .mock.calls.filter(([job]) => job.name === CROSSPOST_BLUESKY_JOB_NAME)

  beforeAll(async () => {
    actor = actors.actor1
    await database.saveBlueskyAccount({
      actorId: actor.id,
      did: `did:plc:${'a'.repeat(24)}`,
      handle: 'me.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
  })

  beforeEach(() => {
    vi.mocked(isBlueskyAllowed).mockResolvedValue(true)
  })

  it("queues a public note by the account's default and keeps a switched-off one here", async () => {
    const byDefault = await createNoteFromUserInput({
      text: 'Default goes',
      currentActor: actor,
      database
    })
    await expect(rowOf(byDefault)).resolves.toMatchObject({
      state: 'pending'
    })
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${byDefault!.id}#bluesky-crosspost`),
      name: CROSSPOST_BLUESKY_JOB_NAME,
      data: { statusId: byDefault!.id }
    })

    const off = await createNoteFromUserInput({
      text: 'Switched off',
      currentActor: actor,
      database,
      blueskyCrosspost: false
    })
    await expect(rowOf(off)).resolves.toBeNull()
  })

  it('leaves a fitness post to its processing job, carrying the choice along', async () => {
    const fitnessFile = await database.createFitnessFile({
      actorId: actor.id,
      path: `fitness/${Date.now()}-bluesky-ride.fit`,
      fileName: 'bluesky-ride.fit',
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 2048
    })

    const status = await createNoteFromUserInput({
      text: 'Ride',
      currentActor: actor,
      database,
      fitnessFileId: fitnessFile!.id,
      blueskyCrosspost: true
    })

    await expect(rowOf(status)).resolves.toBeNull()
    expect(crosspostJobs()).toHaveLength(0)
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(status!.id),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId: status!.id,
        fitnessFileId: fitnessFile!.id,
        blueskyCrosspost: true
      }
    })
  })

  it('keeps a followers-only note, a refused server and an unlinked author here', async () => {
    const privateNote = await createNoteFromUserInput({
      text: 'Followers only',
      currentActor: actor,
      database,
      visibility: 'private',
      blueskyCrosspost: true
    })
    vi.mocked(isBlueskyAllowed).mockResolvedValue(false)
    const refused = await createNoteFromUserInput({
      text: 'Refused',
      currentActor: actor,
      database
    })
    vi.mocked(isBlueskyAllowed).mockResolvedValue(true)
    const unlinked = await createNoteFromUserInput({
      text: 'Not linked',
      currentActor: actors.actor2,
      database,
      blueskyCrosspost: true
    })

    await expect(rowOf(privateNote)).resolves.toBeNull()
    await expect(rowOf(refused)).resolves.toBeNull()
    await expect(rowOf(unlinked)).resolves.toBeNull()
    expect(crosspostJobs()).toHaveLength(0)
  })

  it('queues a public poll unless it is switched off', async () => {
    const poll = await createPollFromUserInput({
      text: 'Which one?',
      choices: ['A', 'B'],
      currentActor: actor,
      database,
      endAt: Date.now() + 60_000
    })
    const off = await createPollFromUserInput({
      text: 'Not this one',
      choices: ['A', 'B'],
      currentActor: actor,
      database,
      endAt: Date.now() + 60_000,
      blueskyCrosspost: false
    })

    await expect(rowOf(poll)).resolves.toMatchObject({ state: 'pending' })
    await expect(rowOf(off)).resolves.toBeNull()
  })

  it('publishes a scheduled post with the choice it was scheduled with', async () => {
    const params = (
      text: string,
      bluesky_crosspost?: boolean | null
    ): ScheduledStatusParams => ({
      text,
      poll: null,
      media_ids: null,
      sensitive: null,
      spoiler_text: null,
      visibility: 'public',
      in_reply_to_id: null,
      language: null,
      application_id: null,
      scheduled_at: null,
      idempotency: null,
      with_rate_limit: false,
      ...(bluesky_crosspost !== undefined ? { bluesky_crosspost } : {})
    })
    const publish = async (
      text: string,
      choice?: boolean | null,
      poll = false
    ) => {
      const scheduled = await database.createScheduledStatus({
        actorId: actor.id,
        scheduledAt: Date.now() - 1_000,
        params: {
          ...params(text, choice),
          ...(poll
            ? {
                poll: {
                  options: ['A', 'B'],
                  expires_in: 3600,
                  multiple: false,
                  hide_totals: false
                }
              }
            : {})
        }
      })
      await publishScheduledStatusJob(database, {
        id: `job-${text}`,
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: scheduled.id }
      })
      const statuses = await database.getActorStatuses({ actorId: actor.id })
      return statuses.find(
        (status) => 'text' in status && status.text.includes(text)
      ) as Status
    }

    const off = await publish(`Scheduled off ${Date.now()}`, false)
    const byDefault = await publish(`Scheduled default ${Date.now()}`, null)
    const pollOff = await publish(
      `Scheduled poll off ${Date.now()}`,
      false,
      true
    )

    await expect(rowOf(off)).resolves.toBeNull()
    await expect(rowOf(pollOff)).resolves.toBeNull()
    await expect(rowOf(byDefault)).resolves.toMatchObject({
      state: 'pending'
    })
  })

  it('enqueues the Bluesky cross-post on idempotent note recovery and honors the request choice', async () => {
    // 1. Stale pending create (crash between saving status and claiming cross-post).
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const startTime = new Date('2026-11-24T12:00:00.000Z').getTime()
      vi.setSystemTime(startTime)

      const staleStatusId = `${actor.id}/statuses/idem-stale-note`
      await database.createNoteWithResult({
        id: staleStatusId,
        url: staleStatusId,
        actorId: actor.id,
        text: 'Recovered note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        idempotency: { key: 'idem-stale-note', contentHash: 'hash-stale-note' }
      })

      vi.setSystemTime(startTime + IDEMPOTENCY_PENDING_STALE_MS)
      const recovered = await createNoteFromUserInput({
        text: 'Recovered note',
        currentActor: actor,
        database,
        idempotency: { key: 'idem-stale-note', contentHash: 'hash-stale-note' },
        blueskyCrosspost: true
      })

      expect(recovered?.id).toBe(staleStatusId)
      expect(recovered?.blueskyCrosspost).toEqual({
        state: 'pending',
        url: null,
        error: null
      })
      await expect(rowOf(recovered)).resolves.toMatchObject({
        state: 'pending'
      })
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(staleStatusId),
        name: SEND_NOTE_JOB_NAME,
        data: { actorId: actor.id, statusId: staleStatusId }
      })
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${staleStatusId}#bluesky-crosspost`),
        name: CROSSPOST_BLUESKY_JOB_NAME,
        data: { statusId: staleStatusId }
      })

      // 2. Recovery with blueskyCrosspost: false must not claim or queue.
      vi.mocked(getQueue().publish).mockClear()
      vi.setSystemTime(startTime)
      const optedOutId = `${actor.id}/statuses/idem-stale-note-off`
      await database.createNoteWithResult({
        id: optedOutId,
        url: optedOutId,
        actorId: actor.id,
        text: 'Recovered opt-out note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        idempotency: {
          key: 'idem-stale-note-off',
          contentHash: 'hash-stale-note-off'
        }
      })

      vi.setSystemTime(startTime + IDEMPOTENCY_PENDING_STALE_MS)
      const recoveredOff = await createNoteFromUserInput({
        text: 'Recovered opt-out note',
        currentActor: actor,
        database,
        idempotency: {
          key: 'idem-stale-note-off',
          contentHash: 'hash-stale-note-off'
        },
        blueskyCrosspost: false
      })

      expect(recoveredOff?.id).toBe(optedOutId)
      await expect(rowOf(recoveredOff)).resolves.toBeNull()
      expect(crosspostJobs()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an existing cross-post row in any state untouched on idempotent recovery and never queues a second job', async () => {
    for (const state of ['pending', 'posting', 'posted', 'failed'] as const) {
      vi.mocked(getQueue().publish).mockClear()
      const key = `idem-existing-${state}`
      const statusId = `${actor.id}/statuses/${key}`
      await database.createNoteWithResult({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        text: `Existing ${state}`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        idempotency: { key, contentHash: `hash-${key}` }
      })
      await database.claimIdempotencyKeyPublish({
        actorId: actor.id,
        key,
        statusId
      })
      await database.setIdempotencyKeyState({
        actorId: actor.id,
        key,
        statusId,
        state: 'publish_failed'
      })

      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      const uri = `at://did:plc:${'a'.repeat(24)}/app.bsky.feed.post/3k${state}`
      if (state === 'posting') {
        await database.beginBlueskyCrosspostAttempt({ statusId })
      } else if (state === 'posted') {
        const attemptId = await database.beginBlueskyCrosspostAttempt({
          statusId
        })
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: attemptId!,
          uri,
          cid: 'bafyexisting'
        })
      } else if (state === 'failed') {
        await database.markBlueskyCrosspostFailedIfAttemptable({
          statusId,
          error: 'already failed'
        })
      }

      const recovered = await resolveExistingIdempotentStatus({
        database,
        actorId: actor.id,
        idempotency: { key, contentHash: `hash-${key}` },
        blueskyCrosspost: true
      })

      expect(recovered?.id).toBe(statusId)
      expect(crosspostJobs()).toHaveLength(0)
      const row = await database.getBlueskyCrosspost({ statusId })
      expect(row?.state).toBe(state)
      if (state === 'posted') {
        expect(row?.uri).toBe(uri)
      }
    }
  })

  it('enqueues the Bluesky cross-post on idempotent poll recovery and honors blueskyCrosspost: false', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const startTime = new Date('2026-11-24T13:00:00.000Z').getTime()
      vi.setSystemTime(startTime)

      const pollId = `${actor.id}/statuses/idem-stale-poll`
      await database.createPollWithResult({
        id: pollId,
        url: pollId,
        actorId: actor.id,
        text: 'Recovered poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: startTime + 3600_000,
        idempotency: { key: 'idem-stale-poll', contentHash: 'hash-stale-poll' }
      })

      vi.setSystemTime(startTime + IDEMPOTENCY_PENDING_STALE_MS)
      const recovered = await createPollFromUserInput({
        text: 'Recovered poll',
        choices: ['Yes', 'No'],
        currentActor: actor,
        database,
        endAt: startTime + 3600_000,
        idempotency: { key: 'idem-stale-poll', contentHash: 'hash-stale-poll' },
        blueskyCrosspost: true
      })

      expect(recovered?.id).toBe(pollId)
      await expect(rowOf(recovered)).resolves.toMatchObject({
        state: 'pending'
      })
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(pollId),
        name: SEND_NOTE_JOB_NAME,
        data: { actorId: actor.id, statusId: pollId }
      })
      expect(getQueue().publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_UPDATE_NOTE_JOB_NAME,
          data: { actorId: actor.id, statusId: pollId }
        })
      )
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${pollId}#bluesky-crosspost`),
        name: CROSSPOST_BLUESKY_JOB_NAME,
        data: { statusId: pollId }
      })

      // Opt-out poll recovery.
      vi.mocked(getQueue().publish).mockClear()
      vi.setSystemTime(startTime)
      const pollOffId = `${actor.id}/statuses/idem-stale-poll-off`
      await database.createPollWithResult({
        id: pollOffId,
        url: pollOffId,
        actorId: actor.id,
        text: 'Recovered poll off',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: startTime + 3600_000,
        idempotency: {
          key: 'idem-stale-poll-off',
          contentHash: 'hash-stale-poll-off'
        }
      })

      vi.setSystemTime(startTime + IDEMPOTENCY_PENDING_STALE_MS)
      const recoveredOff = await createPollFromUserInput({
        text: 'Recovered poll off',
        choices: ['Yes', 'No'],
        currentActor: actor,
        database,
        endAt: startTime + 3600_000,
        idempotency: {
          key: 'idem-stale-poll-off',
          contentHash: 'hash-stale-poll-off'
        },
        blueskyCrosspost: false
      })

      expect(recoveredOff?.id).toBe(pollOffId)
      await expect(rowOf(recoveredOff)).resolves.toBeNull()
      expect(crosspostJobs()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers a publish-failed idempotent note cleanly without pre-failing its Bluesky cross-post', async () => {
    vi.mocked(getQueue().publish).mockRejectedValueOnce(
      new Error('Queue temporarily unavailable')
    )
    const idempotency = {
      key: 'idem-publish-failed-bsky',
      contentHash: 'hash-publish-failed-bsky'
    }

    await expect(
      createNoteFromUserInput({
        text: 'Queue blip post',
        currentActor: actor,
        database,
        idempotency,
        blueskyCrosspost: true
      })
    ).rejects.toBeInstanceOf(StatusPublishFailedError)

    const claim = await database.getIdempotencyKey({
      actorId: actor.id,
      key: idempotency.key
    })
    expect(claim?.state).toBe('publish_failed')
    expect(
      await database.getBlueskyCrosspost({ statusId: claim!.statusId })
    ).toBeNull()

    vi.mocked(getQueue().publish).mockClear()
    const recovered = await createNoteFromUserInput({
      text: 'Queue blip post',
      currentActor: actor,
      database,
      idempotency,
      blueskyCrosspost: true
    })

    expect(recovered?.id).toBe(claim!.statusId)
    await expect(rowOf(recovered)).resolves.toMatchObject({ state: 'pending' })
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${claim!.statusId}#bluesky-crosspost`),
      name: CROSSPOST_BLUESKY_JOB_NAME,
      data: { statusId: claim!.statusId }
    })
  })

  it('carries blueskyCrosspost on PROCESS_FITNESS_FILE_JOB_NAME during idempotent fitness note recovery', async () => {
    const fitnessFile = await database.createFitnessFile({
      actorId: actor.id,
      path: `fitness/${Date.now()}-idem-bluesky-ride.fit`,
      fileName: 'idem-bluesky-ride.fit',
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 2048
    })
    const key = 'idem-fitness-bsky'
    const statusId = `${actor.id}/statuses/${key}`
    await database.createNoteWithResult({
      id: statusId,
      url: statusId,
      actorId: actor.id,
      text: 'Fitness recovery',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      idempotency: { key, contentHash: 'hash-fitness-bsky' }
    })
    await database.updateFitnessFileStatus(fitnessFile!.id, statusId)
    await database.claimIdempotencyKeyPublish({
      actorId: actor.id,
      key,
      statusId
    })
    await database.setIdempotencyKeyState({
      actorId: actor.id,
      key,
      statusId,
      state: 'publish_failed'
    })

    const recovered = await resolveExistingIdempotentStatus({
      database,
      actorId: actor.id,
      idempotency: { key, contentHash: 'hash-fitness-bsky' },
      blueskyCrosspost: true
    })

    expect(recovered?.id).toBe(statusId)
    expect(crosspostJobs()).toHaveLength(0)
    expect(await rowOf(recovered)).toBeNull()
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(statusId),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId,
        fitnessFileId: fitnessFile!.id,
        blueskyCrosspost: true
      }
    })
  })
})
