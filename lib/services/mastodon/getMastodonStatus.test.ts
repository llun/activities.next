import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getMentionFromActorID } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { getMastodonStatus } from './getMastodonStatus'

jest.mock('../../config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: TEST_DOMAIN })
}))

describe('#getMastodonStatus', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  it('returns mastodon status from status model', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus).toMatchObject({
      id: urlToId(`${ACTOR1_ID}/statuses/post-1`),
      uri: `${ACTOR1_ID}/statuses/post-1`,
      account: {
        id: urlToId(ACTOR1_ID),
        username: getMentionFromActorID(ACTOR1_ID).slice(1),
        acct: getMentionFromActorID(ACTOR1_ID, true).slice(1),
        url: ACTOR1_ID,
        created_at: expect.toBeString(),
        last_status_at: expect.toBeString(),
        statuses_count: 3,
        followers_count: 1,
        following_count: 2
      },
      content: '<p>This is Actor1 post</p>',
      visibility: 'public',
      sensitive: false,
      url: `${ACTOR1_ID}/statuses/post-1`,
      created_at: expect.toBeString(),
      edited_at: expect.toBeString()
    })
  })

  it('processes and returns properly formatted content', async () => {
    const markdownStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/markdown-test`,
      url: `${ACTOR1_ID}/statuses/markdown-test`,
      actorId: ACTOR1_ID,
      text: 'Status with **markdown** and <script>alert("xss")</script>',
      to: [],
      cc: []
    })

    markdownStatus.isLocalActor = true

    const mastodonStatus = await getMastodonStatus(database, markdownStatus)

    expect(mastodonStatus?.content).toContain('<strong>markdown</strong>')
  })

  it('processes status with emoji tags correctly', async () => {
    const emojiStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/emoji-test`,
      url: `${ACTOR1_ID}/statuses/emoji-test`,
      actorId: ACTOR1_ID,
      text: 'Status with :emoji:',
      to: [],
      cc: []
    })

    await database.createTag({
      statusId: emojiStatus.id,
      type: 'emoji',
      name: ':emoji:',
      value: 'https://test.host/emoji.png'
    })

    const statusWithTags = (await database.getStatus({
      statusId: emojiStatus.id,
      withReplies: false
    })) as Status

    const mastodonStatus = await getMastodonStatus(database, statusWithTags)

    expect(mastodonStatus?.content).toContain(
      '<img class="emoji" src="https://test.host/emoji.png" alt=":emoji:"></img>'
    )
  })

  it('returns content with HTML formatting', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status

    const mastodonStatus = await getMastodonStatus(database, status)

    expect(mastodonStatus?.content).toMatch(/<p>.*<\/p>/)
    expect(mastodonStatus?.content).toContain('This is Actor1 post')
  })

  it('returns mastodon status with attachments', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-3`
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus).toMatchObject({
      media_attachments: [
        {
          id: expect.toBeString(),
          url: expect.toBeString(),
          preview_url: null,
          remote_url: null,
          description: '',
          blurhash: null,
          type: 'image',
          meta: {
            original: {
              width: 150,
              height: 150,
              size: '150x150',
              aspect: 1
            }
          }
        },
        {
          id: expect.toBeString(),
          url: expect.toBeString(),
          preview_url: null,
          remote_url: null,
          description: '',
          blurhash: null,
          type: 'image',
          meta: {
            original: {
              width: 150,
              height: 150,
              size: '150x150',
              aspect: 1
            }
          }
        }
      ]
    })
  })

  it('returns mastodon announce status', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/post-3`
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus).toMatchObject({
      id: urlToId(`${ACTOR2_ID}/statuses/post-3`),
      uri: `${ACTOR2_ID}/statuses/post-3`,
      content: '',
      reblog: {
        id: urlToId(`${ACTOR2_ID}/statuses/post-2`),
        uri: `${ACTOR2_ID}/statuses/post-2`,
        account: {
          id: urlToId(ACTOR2_ID),
          username: getMentionFromActorID(ACTOR2_ID).slice(1),
          acct: getMentionFromActorID(ACTOR2_ID, true).slice(1),
          created_at: expect.toBeString(),
          last_status_at: expect.toBeString(),
          statuses_count: 4,
          followers_count: 2,
          following_count: 1
        },
        content:
          '<p><span class="h-card"><a href="https://test.llun.dev/@test1@llun.test" target="_blank" class="u-url mention">@<span>test1</span></a></span> This is Actor1 post</p>',
        visibility: 'public',
        url: `${ACTOR2_ID}/statuses/post-2`,
        created_at: expect.toBeString(),
        edited_at: expect.toBeString()
      }
    })
  })

  it('processes mentions correctly in content', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/post-2`
    })) as Status

    const mastodonStatus = await getMastodonStatus(database, status)

    expect(mastodonStatus?.content).toContain('<span class="h-card">')
    expect(mastodonStatus?.content).toContain('class="u-url mention"')
    expect(mastodonStatus?.content).toContain('@<span>test1</span>')
  })

  it('returns mastodon status with in_reply_to information', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/reply-1`
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus).toMatchObject({
      in_reply_to_id: urlToId(`${ACTOR1_ID}/statuses/post-1`),
      in_reply_to_account_id: urlToId(ACTOR1_ID)
    })
  })

  it('returns null when account is not found', async () => {
    const invalidStatus = {
      id: 'invalid/status',
      actorId: 'non-existent-actor',
      type: 'Note',
      text: 'Invalid status'
    } as Status

    const mastodonStatus = await getMastodonStatus(database, invalidStatus)

    expect(mastodonStatus).toBeNull()
  })
})
