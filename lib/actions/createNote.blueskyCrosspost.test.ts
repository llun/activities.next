import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import {
  CROSSPOST_BLUESKY_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  PUBLISH_SCHEDULED_STATUS_JOB_NAME
} from '@/lib/jobs/names'
import { publishScheduledStatusJob } from '@/lib/jobs/publishScheduledStatusJob'
import { isBlueskyAllowed } from '@/lib/services/bluesky/policy'
import { getQueue } from '@/lib/services/queue'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { ScheduledStatusParams } from '@/lib/types/mastodon/scheduledStatus'
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
})
