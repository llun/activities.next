import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { StatusPublishFailedError } from '@/lib/database/domains/idempotency/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { SEND_NOTE_JOB_NAME, SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusPoll, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { isPublicId } from '@/lib/utils/publicId'

enableFetchMocks()

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

const mockPublish = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish, runsInline: false })
}))

const findPoll = (statuses: Status[], text: string): StatusPoll | undefined =>
  statuses.find(
    (s): s is StatusPoll =>
      s.type === StatusType.enum.Poll && s.text.includes(text)
  )

describe('Create poll action', () => {
  const { database, prepare } = createTestDatabase()
  let actor1: Actor
  let actor2: Actor

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    actor2 = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    vi.clearAllMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  describe('createPollFromUserInput', () => {
    it('queues Create and a deduplicated delayed expiration Update only once for an idempotent create', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now())
      const endAt = Date.now() + 60_000
      const params = {
        text: 'Choose a color',
        currentActor: actor1,
        choices: ['Red', 'Blue'],
        database,
        endAt,
        idempotency: { key: 'federated-poll', contentHash: 'poll-hash' }
      }
      const status = await createPollFromUserInput(params)
      expect(status).toBeTruthy()
      expect(mockPublish).toHaveBeenNthCalledWith(1, {
        id: getHashFromString(status!.id),
        name: SEND_NOTE_JOB_NAME,
        data: { actorId: actor1.id, statusId: status!.id }
      })
      expect(mockPublish).toHaveBeenNthCalledWith(2, {
        id: getHashFromString(`${status!.id}#poll-closed/${endAt}`),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: { actorId: actor1.id, statusId: status!.id },
        delaySeconds: expect.any(Number)
      })
      const delay = mockPublish.mock.calls[1][0].delaySeconds
      expect(delay).toBe(61)
      expect((await createPollFromUserInput(params))?.id).toBe(status!.id)
      expect(mockPublish).toHaveBeenCalledTimes(2)
    })

    it('keeps the poll and completes creation when queuing the close update fails', async () => {
      const error = new Error('Delayed queue unavailable')
      mockPublish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error)
      const log = vi.spyOn(logger, 'error')
      try {
        const status = await createPollFromUserInput({
          text: 'Saved despite scheduler outage',
          currentActor: actor1,
          choices: ['Red', 'Blue'],
          database,
          endAt: Date.now() + 60_000
        })
        expect(status).toBeTruthy()
        expect(
          await database.getStatus({ statusId: status!.id })
        ).toMatchObject({ id: status!.id })
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({ statusId: status!.id, err: error })
        )
      } finally {
        log.mockRestore()
      }
    })

    it('defaults the language to the actor posting language, and keeps an explicit one', async () => {
      try {
        await database.updateActor({
          actorId: actor1.id,
          defaultLanguage: 'fil'
        })
        const defaulted = await createPollFromUserInput({
          text: 'Poll with a default language',
          currentActor: actor1,
          choices: ['Yes', 'No'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000
        })
        expect((defaulted as StatusPoll | null)?.language).toBe('fil')

        const explicit = await createPollFromUserInput({
          text: 'Poll with an explicit language',
          currentActor: actor1,
          choices: ['Yes', 'No'],
          language: 'zh-TW',
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000
        })
        expect((explicit as StatusPoll | null)?.language).toBe('zh-TW')
      } finally {
        await database.updateActor({ actorId: actor1.id, defaultLanguage: '' })
      }
    })

    it('fails as a kept post when the discard of a failed create fails', async () => {
      vi.mocked(addStatusToTimelines).mockRejectedValueOnce(
        new Error('timeline write failed')
      )
      vi.spyOn(database, 'discardUnpublishedStatus').mockRejectedValueOnce(
        new Error('database gone')
      )
      await expect(
        createPollFromUserInput({
          text: 'Kept poll after a failed discard',
          currentActor: actor1,
          choices: ['Yes', 'No'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          idempotency: { key: 'kept-poll', contentHash: 'hash-kept-poll' }
        })
      ).rejects.toBeInstanceOf(StatusPublishFailedError)
      const statuses = await database.getActorStatuses({ actorId: actor1.id })
      expect(
        findPoll(statuses, 'Kept poll after a failed discard')
      ).toBeDefined()
    })

    it('discards a failed create and fails with its error', async () => {
      vi.mocked(addStatusToTimelines).mockRejectedValueOnce(
        new Error('timeline write failed')
      )
      await expect(
        createPollFromUserInput({
          text: 'Discarded poll',
          currentActor: actor1,
          choices: ['Yes', 'No'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          idempotency: {
            key: 'discarded-poll',
            contentHash: 'hash-discarded-poll'
          }
        })
      ).rejects.toThrow('timeline write failed')
      const statuses = await database.getActorStatuses({ actorId: actor1.id })
      expect(findPoll(statuses, 'Discarded poll')).toBeUndefined()
    })

    it('creates a poll with correct recipients', async () => {
      const createdPoll = await createPollFromUserInput({
        text: 'What is your favorite color?',
        currentActor: actor1,
        choices: ['Red', 'Blue', 'Green'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = findPoll(statuses, 'What is your favorite color?')

      expect(poll).toBeDefined()
      expect(createdPoll?.id).toBe(poll?.id)
      expect(poll?.to).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.cc).toContain(`${actor1.id}/followers`)
    })

    it('mints the new status URI tail from a v7 publicId', async () => {
      const createdPoll = await createPollFromUserInput({
        text: 'New poll URI tail',
        currentActor: actor1,
        choices: ['Yes', 'No'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      expect(createdPoll?.publicId).toBeTruthy()
      expect(isPublicId(createdPoll?.publicId as string)).toBe(true)
      expect(createdPoll?.id).toBe(
        `${actor1.id}/statuses/${createdPoll?.publicId}`
      )
    })

    it('forces sensitive to true when the creating actor is sensitized', async () => {
      const sensitizedActor = { ...actor1, sensitizedAt: Date.now() }
      const createdPoll = await createPollFromUserInput({
        text: 'A sensitized poll',
        sensitive: false,
        currentActor: sensitizedActor,
        choices: ['Yes', 'No'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      if (!createdPoll || createdPoll.type !== StatusType.enum.Poll) {
        throw new Error('Expected a poll status')
      }
      expect(createdPoll.sensitive).toBe(true)
    })

    it('stores a content-detected language that overrides a mislabeled declared language', async () => {
      const createdPoll = await createPollFromUserInput({
        text: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร',
        currentActor: actor1,
        choices: ['ใช่', 'ไม่ใช่'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000,
        language: 'en'
      })

      if (!createdPoll || createdPoll.type !== StatusType.enum.Poll) {
        throw new Error('Expected a poll status')
      }
      expect(createdPoll.language).toBe('en')
      expect(createdPoll.detectedLanguage).toBe('th')
    })

    it('returns null for direct polls without explicit recipients', async () => {
      const createdPoll = await createPollFromUserInput({
        text: 'Private poll without a recipient',
        currentActor: actor1,
        choices: ['Red', 'Blue'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000,
        visibility: 'direct'
      })

      expect(createdPoll).toBeNull()
    })

    it('stores content warning text as poll summary', async () => {
      await createPollFromUserInput({
        text: 'Choose the culprit',
        summary: 'Mystery spoilers',
        currentActor: actor1,
        choices: ['Butler', 'Gardener'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = findPoll(statuses, 'Choose the culprit')

      expect(poll?.summary).toBe('Mystery spoilers')
    })

    it('creates a poll with mentions in cc', async () => {
      await createPollFromUserInput({
        text: `@${actor2.username}@${actor2.domain} What do you think?`,
        currentActor: actor1,
        choices: ['Yes', 'No'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = findPoll(statuses, 'What do you think?')

      expect(poll).toBeDefined()
      expect(poll?.to).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.cc).toContain(ACTOR2_ID)
    })

    it('creates a poll as reply with correct recipients', async () => {
      // Use actor2's post-2 which exists in seed data
      const replyStatusId = `${actor2.id}/statuses/post-2`

      await createPollFromUserInput({
        text: 'Poll reply',
        replyStatusId,
        currentActor: actor1,
        choices: ['Option A', 'Option B'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = findPoll(statuses, 'Poll reply')

      expect(poll).toBeDefined()
      expect(poll?.reply).toBe(replyStatusId)
      expect(poll?.to).toContain(ACTIVITY_STREAM_PUBLIC)
    })

    it('creates poll with end time', async () => {
      const endAt = Date.now() + 48 * 60 * 60 * 1000

      await createPollFromUserInput({
        text: 'Timed poll',
        currentActor: actor1,
        choices: ['Now', 'Later'],
        database,
        endAt
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = findPoll(statuses, 'Timed poll')

      expect(poll).toBeDefined()
    })

    describe('visibility support', () => {
      it('creates private poll with correct recipients', async () => {
        await createPollFromUserInput({
          text: 'Private poll question',
          currentActor: actor1,
          choices: ['Yes', 'No'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          visibility: 'private'
        })

        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        const poll = findPoll(statuses, 'Private poll question')

        expect(poll).toBeDefined()
        expect(poll?.to).toContain(`${actor1.id}/followers`)
        expect(poll?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
        expect(poll?.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
      })

      it('creates unlisted poll with Public in cc', async () => {
        await createPollFromUserInput({
          text: 'Unlisted poll question',
          currentActor: actor1,
          choices: ['A', 'B'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          visibility: 'unlisted'
        })

        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        const poll = findPoll(statuses, 'Unlisted poll question')

        expect(poll).toBeDefined()
        expect(poll?.to).toContain(`${actor1.id}/followers`)
        expect(poll?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
        expect(poll?.cc).toContain(ACTIVITY_STREAM_PUBLIC)
      })

      it('creates direct poll with explicit recipients in to only', async () => {
        await createPollFromUserInput({
          text: `@${actor2.username}@${actor2.domain} Direct poll`,
          currentActor: actor1,
          choices: ['Yes', 'No'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          visibility: 'direct'
        })

        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        const poll = findPoll(statuses, 'Direct poll')

        expect(poll).toBeDefined()
        expect(poll?.to).toEqual([ACTOR2_ID])
        expect(poll?.cc).toEqual([])
      })

      it('rejects a direct poll reply to a non-direct status without an explicit recipient', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/public-parent-direct-poll-no-recipient`,
          url: `${actor1.id}/statuses/public-parent-direct-poll-no-recipient`,
          actorId: 'https://remote.test/actors/public-poll-parent',
          text: 'Public poll parent',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${actor1.id}/followers`]
        })

        const poll = await createPollFromUserInput({
          text: 'quiet direct poll reply',
          currentActor: actor1,
          replyStatusId: parentStatus.id,
          visibility: 'direct',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          database
        })

        expect(poll).toBeNull()
      })

      it('addresses a direct poll reply to the parent author and the accounts its text mentions', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/direct-parent-poll-recipients`,
          url: `${actor1.id}/statuses/direct-parent-poll-recipients`,
          actorId: 'https://remote.test/actors/poll-sender',
          text: 'Direct parent for poll',
          to: [actor1.id, 'https://remote.test/actors/poll-primary'],
          cc: ['https://remote.test/actors/poll-copied']
        })

        await createPollFromUserInput({
          text: '@test2@llun.test Poll reply with one mention',
          currentActor: actor1,
          replyStatusId: parentStatus.id,
          choices: ['Yes', 'No'],
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          database
        })

        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        const poll = findPoll(statuses, 'Poll reply with one mention')

        expect(poll).toBeDefined()
        expect(poll?.to.sort()).toEqual(
          [ACTOR2_ID, 'https://remote.test/actors/poll-sender'].sort()
        )
        expect(poll?.cc).toEqual([])
      })

      it('refuses a poll reply whose parent no longer exists', async () => {
        const poll = await createPollFromUserInput({
          text: 'Poll reply to a deleted post',
          currentActor: actor1,
          replyStatusId: `${ACTOR2_ID}/statuses/deleted-poll-parent`,
          choices: ['Yes', 'No'],
          endAt: Date.now() + 24 * 60 * 60 * 1000,
          database
        })

        expect(poll).toBeNull()
        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        expect(
          findPoll(statuses, 'Poll reply to a deleted post')
        ).toBeUndefined()
      })

      it('inherits visibility from private reply status', async () => {
        // Create a private status to reply to
        const privateStatus = await database.createNote({
          id: `${actor1.id}/statuses/private-for-poll-reply`,
          url: `${actor1.id}/statuses/private-for-poll-reply`,
          actorId: actor1.id,
          text: 'Private status for poll reply',
          to: [`${actor1.id}/followers`],
          cc: []
        })

        await createPollFromUserInput({
          text: 'Poll reply to private',
          replyStatusId: privateStatus.id,
          currentActor: actor1,
          choices: ['Option 1', 'Option 2'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000
        })

        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        const poll = findPoll(statuses, 'Poll reply to private')

        expect(poll).toBeDefined()
        // Should inherit private visibility - no Public in to or cc
        expect(poll?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
        expect(poll?.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
      })

      it('stores only the parent author as a mention tag when the poll reply names nobody', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/direct-parent-poll-mention-tags`,
          url: `${actor1.id}/statuses/direct-parent-poll-mention-tags`,
          actorId: 'https://remote.test/actors/direct-poll-sender',
          text: 'Direct parent for poll with multiple recipients',
          to: [actor1.id, ACTOR2_ID],
          cc: [ACTOR3_ID]
        })

        await createPollFromUserInput({
          text: 'Poll reply without rementioning everyone',
          replyStatusId: parentStatus.id,
          currentActor: actor1,
          choices: ['Yes', 'No'],
          database,
          endAt: Date.now() + 24 * 60 * 60 * 1000
        })

        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        const poll = findPoll(
          statuses,
          'Poll reply without rementioning everyone'
        )
        const mentionValues = (
          await database.getTags({ statusId: poll?.id || '' })
        )
          .filter((tag) => tag.type === 'mention')
          .map((tag) => tag.value)

        expect(poll).toBeDefined()
        expect(poll?.to).toEqual([parentStatus.actorId])
        expect(mentionValues).toEqual([parentStatus.actorId])
      })
    })
  })
})
