import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType, toActivityPubObject } from '@/lib/types/domain/status'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

enableFetchMocks()

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: jest.fn()
}))

describe('Custom emoji status federation', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    await database.createCustomEmoji({
      shortcode: 'blobcat',
      url: 'https://example.com/emojis/blobcat.png',
      staticUrl: 'https://example.com/emojis/blobcat.png'
    })
    await database.createCustomEmoji({
      shortcode: 'hidden',
      url: 'https://example.com/emojis/hidden.png',
      staticUrl: 'https://example.com/emojis/hidden.png',
      visibleInPicker: false
    })
    await database.createCustomEmoji({
      shortcode: 'gone',
      url: 'https://example.com/emojis/gone.png',
      staticUrl: 'https://example.com/emojis/gone.png',
      disabled: true
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('persists an emoji tag for each known shortcode in the text', async () => {
    const status = await createNoteFromUserInput({
      currentActor: actor1,
      text: 'hello :blobcat: and :unknown:',
      database
    })
    if (!status || status.type !== StatusType.enum.Note) {
      throw new Error('Expected a note status')
    }

    const emojiTags = status.tags.filter((tag) => tag.type === 'emoji')
    expect(emojiTags).toHaveLength(1)
    expect(emojiTags[0]).toMatchObject({
      name: ':blobcat:',
      value: 'https://example.com/emojis/blobcat.png'
    })
  })

  it('federates the emoji tag as an ActivityPub Emoji object in the Note', async () => {
    const status = await createNoteFromUserInput({
      currentActor: actor1,
      text: 'party :blobcat:',
      database
    })
    if (!status) throw new Error('Expected a status')

    const note = getNoteFromStatus(status)
    const tags = Array.isArray(note?.tag) ? note?.tag : [note?.tag]
    expect(tags).toContainEqual(
      expect.objectContaining({
        type: 'Emoji',
        name: ':blobcat:',
        icon: expect.objectContaining({
          type: 'Image',
          url: 'https://example.com/emojis/blobcat.png'
        })
      })
    )
  })

  it('resolves hand-typed non-picker emoji but ignores disabled emoji', async () => {
    const status = await createNoteFromUserInput({
      currentActor: actor1,
      text: 'mix :hidden: :gone:',
      database
    })
    if (!status) throw new Error('Expected a status')

    const emojiNames = status.tags
      .filter((tag) => tag.type === 'emoji')
      .map((tag) => tag.name)
    expect(emojiNames).toContain(':hidden:')
    expect(emojiNames).not.toContain(':gone:')
  })

  it('federates the emoji tag as an Emoji object in a poll Question', async () => {
    const status = await createPollFromUserInput({
      currentActor: actor1,
      text: 'vote with :blobcat:',
      choices: ['yes', 'no'],
      endAt: 4102444800000,
      database
    })
    if (!status) throw new Error('Expected a poll status')

    const question = toActivityPubObject(status)
    const tags = Array.isArray(question.tag) ? question.tag : [question.tag]
    expect(tags).toContainEqual(
      expect.objectContaining({
        type: 'Emoji',
        name: ':blobcat:',
        icon: expect.objectContaining({
          type: 'Image',
          url: 'https://example.com/emojis/blobcat.png'
        })
      })
    )
  })

  it('re-syncs emoji tags when a note is edited', async () => {
    const status = await createNoteFromUserInput({
      currentActor: actor1,
      text: 'first :blobcat:',
      database
    })
    if (!status) throw new Error('Expected a status')

    const updated = await updateNoteFromUserInput({
      statusId: status.id,
      currentActor: actor1,
      text: 'edited without emoji',
      database,
      publish: false
    })
    expect(updated).not.toBeNull()

    const tags = await database.getTags({ statusId: status.id })
    expect(tags.filter((tag) => tag.type === 'emoji')).toHaveLength(0)
  })

  it('adds emoji tags when an edit introduces a new shortcode', async () => {
    const status = await createNoteFromUserInput({
      currentActor: actor1,
      text: 'plain text',
      database
    })
    if (!status) throw new Error('Expected a status')
    expect(
      (await database.getTags({ statusId: status.id })).filter(
        (tag) => tag.type === 'emoji'
      )
    ).toHaveLength(0)

    const updated = await updateNoteFromUserInput({
      statusId: status.id,
      currentActor: actor1,
      text: 'now with :blobcat:',
      database,
      publish: false
    })

    const tags = await database.getTags({ statusId: status.id })
    const emojiTags = tags.filter((tag) => tag.type === 'emoji')
    expect(emojiTags).toHaveLength(1)
    expect(emojiTags[0].name).toBe(':blobcat:')

    // The returned status (used for the optimistic client render + timeline
    // cache) must already include the re-synced emoji tag.
    expect(updated?.tags.filter((tag) => tag.type === 'emoji')).toEqual([
      expect.objectContaining({ name: ':blobcat:' })
    ])
  })
})
