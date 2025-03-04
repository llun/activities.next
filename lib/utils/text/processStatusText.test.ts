import { getTestSQLDatabase } from '../../database/testUtils'
import { Status } from '../../models/status'
import { TEST_DOMAIN } from '../../stub/const'
import { seedDatabase } from '../../stub/database'
import { ACTOR1_ID } from '../../stub/seed/actor1'
import { ACTOR2_ID } from '../../stub/seed/actor2'
import { getActualStatus, processStatusText } from './processStatusText'

describe('processStatusText', () => {
  const mockHost = TEST_DOMAIN
  const database = getTestSQLDatabase()
  let noteStatus: Status
  let announceStatus: Status

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    noteStatus = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`,
      withReplies: false
    })) as Status

    announceStatus = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/post-3`,
      withReplies: false
    })) as Status
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  describe('getActualStatus', () => {
    it('returns the original status for Announce type', () => {
      const result = getActualStatus(announceStatus)
      expect(result).not.toBe(announceStatus)
      expect(result.id).not.toBe(announceStatus.id)
    })

    it('returns the same status for non-Announce types', () => {
      const result = getActualStatus(noteStatus)
      expect(result).toBe(noteStatus)
      expect(result.id).toBe(noteStatus.id)
    })
  })

  describe('processStatusText', () => {
    it('processes local actor status with markdown conversion', async () => {
      const localStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/markdown-test`,
        url: `${ACTOR1_ID}/statuses/markdown-test`,
        actorId: ACTOR1_ID,
        text: 'Status with **markdown**',
        to: [],
        cc: []
      })

      const result = processStatusText(mockHost, localStatus)

      expect(result).toBe('<p>Status with <strong>markdown</strong></p>')
    })

    it('processes actor status with markdown conversion', () => {
      const result = processStatusText(mockHost, noteStatus)

      expect(result).toBe('<p>This is Actor1 post</p>')
    })

    it('converts emojis to images when tags are present', async () => {
      const statusWithEmoji = await database.createNote({
        id: `${ACTOR1_ID}/statuses/emoji-test`,
        url: `${ACTOR1_ID}/statuses/emoji-test`,
        actorId: ACTOR1_ID,
        text: 'Status with :emoji:',
        to: [],
        cc: []
      })

      await database.createTag({
        statusId: statusWithEmoji.id,
        type: 'emoji',
        name: ':emoji:',
        value: 'https://test.host/emoji.png'
      })

      const statusWithTags = (await database.getStatus({
        statusId: statusWithEmoji.id,
        withReplies: false
      })) as Status

      const result = processStatusText(mockHost, statusWithTags)

      expect(result).toBe(
        '<p>Status with <img class="emoji" src="https://test.host/emoji.png" alt=":emoji:"></img></p>'
      )
    })

    it('processes Announce status by using the original status text', () => {
      const result = processStatusText(mockHost, announceStatus)

      const actualStatus = getActualStatus(announceStatus)
      expect(actualStatus).not.toBe(announceStatus)

      const expectedResult = processStatusText(mockHost, actualStatus)
      expect(result).toBe(expectedResult)
    })

    it('preserves whitespace in the HTML output', async () => {
      const localStatusWithWhitespace = await database.createNote({
        id: `${ACTOR1_ID}/statuses/whitespace-test`,
        url: `${ACTOR1_ID}/statuses/whitespace-test`,
        actorId: ACTOR1_ID,
        text: '  Text with whitespace  ',
        to: [],
        cc: []
      })

      const result = processStatusText(mockHost, localStatusWithWhitespace)
      expect(result).toBe('<p>  Text with whitespace  </p>')
    })
  })
})
