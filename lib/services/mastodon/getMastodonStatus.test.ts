import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor, getMentionFromActorID } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { getMastodonStatus } from './getMastodonStatus'

describe('#getMastodonStatus', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
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
      id: `${ACTOR1_ID}/statuses/post-1`,
      uri: `${ACTOR1_ID}/statuses/post-1`,
      account: {
        id: ACTOR1_ID,
        username: getMentionFromActorID(ACTOR1_ID).slice(1),
        acct: getMentionFromActorID(ACTOR1_ID, true).slice(1),
        url: ACTOR1_ID,
        created_at: expect.toBeString(),
        last_status_at: expect.toBeString(),
        statuses_count: 3,
        followers_count: 1,
        following_count: 2
      },
      content: 'This is Actor1 post',
      visibility: 'public',
      sensitive: false,
      url: `${ACTOR1_ID}/statuses/post-1`,
      created_at: expect.toBeString(),
      edited_at: expect.toBeString()
    })
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
      id: `${ACTOR2_ID}/statuses/post-3`,
      uri: `${ACTOR2_ID}/statuses/post-3`,
      content: '',
      reblog: {
        id: `${ACTOR2_ID}/statuses/post-2`,
        uri: `${ACTOR2_ID}/statuses/post-2`,
        account: {
          id: ACTOR2_ID,
          username: getMentionFromActorID(ACTOR2_ID).slice(1),
          acct: getMentionFromActorID(ACTOR2_ID, true).slice(1),
          created_at: expect.toBeString(),
          last_status_at: expect.toBeString(),
          statuses_count: 2,
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
})
