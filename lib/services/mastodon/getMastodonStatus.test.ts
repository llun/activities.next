import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getMentionFromActorID } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
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

  it('returns mastodon status with poll data for Poll type', async () => {
    const pollStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/poll-1`,
      url: `${ACTOR1_ID}/statuses/poll-1`,
      actorId: ACTOR1_ID,
      text: 'This is a poll question',
      to: [],
      cc: []
    })

    const modifiedStatus = {
      ...pollStatus,
      type: StatusType.enum.Poll,
      choices: [
        {
          statusId: `${ACTOR1_ID}/statuses/poll-1`,
          title: 'Option 1',
          totalVotes: 5,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          statusId: `${ACTOR1_ID}/statuses/poll-1`,
          title: 'Option 2',
          totalVotes: 3,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      endAt: Date.now() + 24 * 60 * 60 * 1000
    }

    const mastodonStatus = await getMastodonStatus(
      database,
      modifiedStatus as Status
    )

    expect(mastodonStatus).not.toBeNull()
    expect(mastodonStatus?.poll).toMatchObject({
      id: urlToId(`${ACTOR1_ID}/statuses/poll-1`),
      options: [
        {
          title: 'Option 1',
          votes_count: 5
        },
        {
          title: 'Option 2',
          votes_count: 3
        }
      ],
      votes_count: 8,
      expired: false,
      multiple: false
    })
  })

  describe('visibility derivation', () => {
    it('returns public visibility when to contains Public', async () => {
      const publicStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/public-vis-test`,
        url: `${ACTOR1_ID}/statuses/public-vis-test`,
        actorId: ACTOR1_ID,
        text: 'Public visibility test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const mastodonStatus = await getMastodonStatus(database, publicStatus)
      expect(mastodonStatus?.visibility).toBe('public')
    })

    it('returns public visibility when to contains as:Public', async () => {
      const publicStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/public-vis-test-2`,
        url: `${ACTOR1_ID}/statuses/public-vis-test-2`,
        actorId: ACTOR1_ID,
        text: 'Public visibility test 2',
        to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const mastodonStatus = await getMastodonStatus(database, publicStatus)
      expect(mastodonStatus?.visibility).toBe('public')
    })

    it('returns unlist visibility when cc contains Public but to does not', async () => {
      const unlistStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/unlist-vis-test`,
        url: `${ACTOR1_ID}/statuses/unlist-vis-test`,
        actorId: ACTOR1_ID,
        text: 'Unlist visibility test',
        to: [`${ACTOR1_ID}/followers`],
        cc: [ACTIVITY_STREAM_PUBLIC]
      })

      const mastodonStatus = await getMastodonStatus(database, unlistStatus)
      expect(mastodonStatus?.visibility).toBe('unlisted')
    })

    it('returns private visibility when only followers URL is present', async () => {
      const privateStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/private-vis-test`,
        url: `${ACTOR1_ID}/statuses/private-vis-test`,
        actorId: ACTOR1_ID,
        text: 'Private visibility test',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, privateStatus)
      expect(mastodonStatus?.visibility).toBe('private')
    })

    it('returns direct visibility when to contains specific users only', async () => {
      const directStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/direct-vis-test`,
        url: `${ACTOR1_ID}/statuses/direct-vis-test`,
        actorId: ACTOR1_ID,
        text: 'Direct visibility test',
        to: [ACTOR2_ID],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, directStatus)
      expect(mastodonStatus?.visibility).toBe('direct')
    })
  })

  describe('mentions extraction', () => {
    it('extracts mentions from tags into mentions array', async () => {
      const statusWithMention = await database.createNote({
        id: `${ACTOR1_ID}/statuses/mention-test`,
        url: `${ACTOR1_ID}/statuses/mention-test`,
        actorId: ACTOR1_ID,
        text: '@test2@llun.test Hello!',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createTag({
        statusId: statusWithMention.id,
        type: 'mention',
        name: '@test2@llun.test',
        value: ACTOR2_ID
      })

      const statusWithTags = (await database.getStatus({
        statusId: statusWithMention.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.mentions).toHaveLength(1)
      expect(mastodonStatus?.mentions[0]).toMatchObject({
        id: urlToId(ACTOR2_ID),
        username: 'test2',
        acct: 'test2@llun.test',
        url: ACTOR2_ID
      })
    })
  })

  describe('emojis extraction', () => {
    it('extracts custom emojis from tags into emojis array', async () => {
      const statusWithEmoji = await database.createNote({
        id: `${ACTOR1_ID}/statuses/emoji-array-test`,
        url: `${ACTOR1_ID}/statuses/emoji-array-test`,
        actorId: ACTOR1_ID,
        text: 'Status with :custom_emoji:',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createTag({
        statusId: statusWithEmoji.id,
        type: 'emoji',
        name: ':custom_emoji:',
        value: 'https://test.host/custom_emoji.png'
      })

      const statusWithTags = (await database.getStatus({
        statusId: statusWithEmoji.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.emojis).toHaveLength(1)
      expect(mastodonStatus?.emojis[0]).toMatchObject({
        shortcode: 'custom_emoji',
        url: 'https://test.host/custom_emoji.png',
        static_url: 'https://test.host/custom_emoji.png',
        visible_in_picker: true,
        category: null
      })
    })
  })

  describe('hashtags extraction', () => {
    it('extracts hashtags from tags into tags array', async () => {
      const statusWithHashtag = await database.createNote({
        id: `${ACTOR1_ID}/statuses/hashtag-test`,
        url: `${ACTOR1_ID}/statuses/hashtag-test`,
        actorId: ACTOR1_ID,
        text: 'Status with #testing',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createTag({
        statusId: statusWithHashtag.id,
        type: 'hashtag',
        name: '#testing',
        value: `https://${TEST_DOMAIN}/tags/testing`
      })

      const statusWithTags = (await database.getStatus({
        statusId: statusWithHashtag.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.tags).toHaveLength(1)
      expect(mastodonStatus?.tags[0]).toMatchObject({
        name: 'testing',
        url: `https://${TEST_DOMAIN}/tags/testing`
      })
    })
  })

  describe('sensitive flag', () => {
    it('sets sensitive to true when spoiler_text is present', async () => {
      const sensitiveStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/sensitive-test`,
        url: `${ACTOR1_ID}/statuses/sensitive-test`,
        actorId: ACTOR1_ID,
        text: 'This is a sensitive post',
        summary: 'Content Warning',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, sensitiveStatus)

      expect(mastodonStatus?.sensitive).toBe(true)
      expect(mastodonStatus?.spoiler_text).toBe('Content Warning')
    })

    it('sets sensitive to false when no spoiler_text', async () => {
      const normalStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/not-sensitive-test`,
        url: `${ACTOR1_ID}/statuses/not-sensitive-test`,
        actorId: ACTOR1_ID,
        text: 'This is a normal post',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, normalStatus)

      expect(mastodonStatus?.sensitive).toBe(false)
      expect(mastodonStatus?.spoiler_text).toBe('')
    })
  })

  describe('reblogs_count', () => {
    it('returns correct reblogs_count for status with announces', async () => {
      // Create original status
      const originalStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/reblog-count-test`,
        url: `${ACTOR1_ID}/statuses/reblog-count-test`,
        actorId: ACTOR1_ID,
        text: 'This will be reblogged',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Create an announce/reblog of it
      await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/reblog-1`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: originalStatus.id
      })

      const status = (await database.getStatus({
        statusId: originalStatus.id
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.reblogs_count).toBe(1)
    })

    it('returns 0 reblogs_count for status without announces', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      // This status has no announces so reblogs_count should be 0
      expect(mastodonStatus?.reblogs_count).toBe(0)
    })
  })

  describe('text field', () => {
    it('includes plain text source in text field', async () => {
      const statusWithMarkdown = await database.createNote({
        id: `${ACTOR1_ID}/statuses/text-field-test`,
        url: `${ACTOR1_ID}/statuses/text-field-test`,
        actorId: ACTOR1_ID,
        text: 'Plain text with **markdown**',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(
        database,
        statusWithMarkdown
      )

      expect(mastodonStatus?.text).toBe('Plain text with **markdown**')
    })
  })

  describe('announce/reblog visibility', () => {
    it('uses original status visibility for Announce statuses', async () => {
      // Create an unlisted original status
      const unlistedStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/unlisted-for-reblog`,
        url: `${ACTOR1_ID}/statuses/unlisted-for-reblog`,
        actorId: ACTOR1_ID,
        text: 'Unlisted status to be reblogged',
        to: [`${ACTOR1_ID}/followers`],
        cc: [ACTIVITY_STREAM_PUBLIC]
      })

      // Create an announce of the unlisted status with public to/cc
      const announceStatus = await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/announce-unlisted`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR2_ID}/followers`],
        originalStatusId: unlistedStatus.id
      })

      const status = (await database.getStatus({
        statusId: announceStatus.id
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      // The visibility should be 'unlisted' from the original status, not 'public' from the announce
      expect(mastodonStatus?.visibility).toBe('unlisted')
      expect(mastodonStatus?.reblog?.visibility).toBe('unlisted')
    })

    it('uses original status visibility for private status reblogs', async () => {
      // Create a private original status
      const privateStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/private-for-reblog`,
        url: `${ACTOR1_ID}/statuses/private-for-reblog`,
        actorId: ACTOR1_ID,
        text: 'Private status to be reblogged',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      // Create an announce of the private status
      const announceStatus = await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/announce-private`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: privateStatus.id
      })

      const status = (await database.getStatus({
        statusId: announceStatus.id
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      // The visibility should be 'private' from the original status
      expect(mastodonStatus?.visibility).toBe('private')
    })
  })

  describe('emoji shortcode edge cases', () => {
    it('handles emoji with multiple leading colons', async () => {
      const statusWithEmoji = await database.createNote({
        id: `${ACTOR1_ID}/statuses/multi-colon-emoji-1`,
        url: `${ACTOR1_ID}/statuses/multi-colon-emoji-1`,
        actorId: ACTOR1_ID,
        text: 'Status with ::emoji::',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createTag({
        statusId: statusWithEmoji.id,
        type: 'emoji',
        name: '::emoji::',
        value: 'https://test.host/emoji.png'
      })

      const statusWithTags = (await database.getStatus({
        statusId: statusWithEmoji.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.emojis).toHaveLength(1)
      expect(mastodonStatus?.emojis[0].shortcode).toBe('emoji')
    })

    it('handles emoji without colons', async () => {
      const statusWithEmoji = await database.createNote({
        id: `${ACTOR1_ID}/statuses/no-colon-emoji`,
        url: `${ACTOR1_ID}/statuses/no-colon-emoji`,
        actorId: ACTOR1_ID,
        text: 'Status with emoji',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createTag({
        statusId: statusWithEmoji.id,
        type: 'emoji',
        name: 'emoji_no_colons',
        value: 'https://test.host/emoji.png'
      })

      const statusWithTags = (await database.getStatus({
        statusId: statusWithEmoji.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.emojis).toHaveLength(1)
      expect(mastodonStatus?.emojis[0].shortcode).toBe('emoji_no_colons')
    })
  })
})
