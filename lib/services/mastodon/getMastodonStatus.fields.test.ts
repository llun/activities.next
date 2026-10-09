import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { getMentionFromActorID } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

import { getMastodonStatus, getMastodonStatuses } from './getMastodonStatus'
import { useSeededStatusDatabase } from './getMastodonStatus.testUtils'

// prettier-ignore
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({ host: 'test.llun.dev' })
}))

describe('getMastodonStatus', () => {
  const { database, getActorPublicId } = useSeededStatusDatabase()

  it('returns mastodon status from status model', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus).toMatchObject({
      id: status.publicId,
      uri: `${ACTOR1_ID}/statuses/post-1`,
      account: {
        id: await getActorPublicId(ACTOR1_ID),
        username: getMentionFromActorID(ACTOR1_ID).slice(1),
        acct: getMentionFromActorID(ACTOR1_ID, true).slice(1),
        url: ACTOR1_ID,
        created_at: expect.toBeString(),
        last_status_at: expect.toBeString(),
        statuses_count: expect.any(Number),
        followers_count: 1,
        following_count: 2
      },
      content: '<p>This is Actor1 post</p>',
      visibility: 'public',
      sensitive: false,
      url: `${ACTOR1_ID}/statuses/post-1`,
      created_at: expect.toBeString(),
      edited_at: null
    })
    expect(mastodonStatus).not.toHaveProperty('pinned')
  })

  it('derives pinned state from persisted pins for single status serialization', async () => {
    const statusId = `${ACTOR1_ID}/statuses/mastodon-persisted-pin-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Persisted pin target',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.pinStatus({ actorId: ACTOR1_ID, statusId })
    const status = (await database.getStatus({ statusId })) as Status

    const mastodonStatus = await getMastodonStatus(database, status, ACTOR1_ID)

    expect(mastodonStatus?.pinned).toBe(true)
  })

  it('marks an edited status with edited_at', async () => {
    const statusId = `${ACTOR1_ID}/statuses/mastodon-edited-note`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Original content',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const editedStatus = (await database.updateNote({
      statusId,
      text: 'Edited content',
      summary: null
    })) as Status

    const mastodonStatus = await getMastodonStatus(database, editedStatus)

    expect(mastodonStatus?.edited_at).toBe(
      getISOTimeUTC(editedStatus.updatedAt)
    )
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

    expect(mastodonStatus?.content).toBe('<p>Status with :emoji:</p>')
    expect(mastodonStatus?.content).not.toContain('<img')
    expect(mastodonStatus?.emojis).toEqual([
      {
        shortcode: 'emoji',
        url: 'https://test.host/emoji.png',
        static_url: 'https://test.host/emoji.png',
        visible_in_picker: true,
        category: null
      }
    ])
  })

  it('returns content with HTML formatting', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status

    const mastodonStatus = await getMastodonStatus(database, status)

    expect(mastodonStatus?.content).toMatch(/<p>.*<\/p>/)
    expect(mastodonStatus?.content).toContain('This is Actor1 post')
  })

  it('keeps mastodon content as post text when fitness file is attached', async () => {
    const note = await database.createNote({
      id: `${ACTOR1_ID}/statuses/fitness-content-test`,
      url: `${ACTOR1_ID}/statuses/fitness-content-test`,
      actorId: ACTOR1_ID,
      text: 'Only text should be federated',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: note.id,
      path: 'fitness/fitness-content-test.fit',
      fileName: 'fitness-content-test.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })

    const status = (await database.getStatus({
      statusId: note.id,
      withReplies: false
    })) as Status

    const mastodonStatus = await getMastodonStatus(database, status)

    expect(mastodonStatus?.content).toContain('Only text should be federated')
    expect(mastodonStatus?.content).not.toContain('/api/v1/fitness-files/')
    expect(mastodonStatus?.content).not.toContain('Fitness file')
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

  it('returns every attachment without applying the federation cap', async () => {
    const statusId = `${ACTOR1_ID}/statuses/many-media-attachments`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Ride with a large photo set',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const attachmentCount = 5
    for (let index = 0; index < attachmentCount; index += 1) {
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/png',
        url: `https://${TEST_DOMAIN}/api/v1/files/medias/many-media-${index}.png`,
        width: 150,
        height: 150,
        name: `many-media-${index}.png`
      })
    }

    const status = (await database.getStatus({
      statusId,
      withReplies: false
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus?.media_attachments).toHaveLength(attachmentCount)
  })

  it('returns mastodon announce status', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/post-3`
    })) as Status
    const originalStatus = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/post-2`
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus).toMatchObject({
      id: status.publicId,
      uri: `${ACTOR2_ID}/statuses/post-3`,
      content: '',
      reblog: {
        id: originalStatus.publicId,
        uri: `${ACTOR2_ID}/statuses/post-2`,
        account: {
          id: await getActorPublicId(ACTOR2_ID),
          username: getMentionFromActorID(ACTOR2_ID).slice(1),
          acct: getMentionFromActorID(ACTOR2_ID, true).slice(1),
          created_at: expect.toBeString(),
          last_status_at: expect.toBeString(),
          statuses_count: expect.any(Number),
          followers_count: 2,
          following_count: 1
        },
        content:
          '<p><span class="h-card"><a href="https://test.llun.dev/@test1@llun.test" target="_blank" class="u-url mention" rel="noopener noreferrer">@<span>test1</span></a></span> This is Actor1 post</p>',
        visibility: 'public',
        url: `${ACTOR2_ID}/statuses/post-2`,
        created_at: expect.toBeString(),
        edited_at: null
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
    const parentStatus = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status
    const mastodonStatus = await getMastodonStatus(database, status)
    expect(mastodonStatus).toMatchObject({
      in_reply_to_id: parentStatus.publicId,
      in_reply_to_account_id: await getActorPublicId(ACTOR1_ID)
    })
  })

  it('does not mark a newly created reply as edited', async () => {
    const parentStatus = await database.createNote({
      id: `${ACTOR2_ID}/statuses/mastodon-unedited-parent`,
      url: `${ACTOR2_ID}/statuses/mastodon-unedited-parent`,
      actorId: ACTOR2_ID,
      text: 'Parent for unedited reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const replyStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/mastodon-unedited-reply`,
      url: `${ACTOR1_ID}/statuses/mastodon-unedited-reply`,
      actorId: ACTOR1_ID,
      text: '@test2@llun.test Reply with a linked actor mention',
      reply: parentStatus.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR2_ID]
    })

    const mastodonStatus = await getMastodonStatus(database, replyStatus)

    expect(mastodonStatus).toMatchObject({
      in_reply_to_id: parentStatus.publicId,
      in_reply_to_account_id: await getActorPublicId(ACTOR2_ID),
      edited_at: null
    })
    expect(mastodonStatus?.content).toContain('class="u-url mention"')
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
      id: pollStatus.publicId,
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
        id: await getActorPublicId(ACTOR2_ID),
        username: 'test2',
        acct: 'test2@llun.test',
        url: ACTOR2_ID
      })
    })

    it('falls back to the legacy id for a mention whose actor is not stored', async () => {
      const unknownActorId = 'https://unknown.test/users/stranger'
      const statusWithMention = await database.createNote({
        id: `${ACTOR1_ID}/statuses/mention-unknown-actor`,
        url: `${ACTOR1_ID}/statuses/mention-unknown-actor`,
        actorId: ACTOR1_ID,
        text: '@stranger@unknown.test Hello!',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId: statusWithMention.id,
        type: 'mention',
        name: '@stranger@unknown.test',
        value: unknownActorId
      })
      const statusWithTags = (await database.getStatus({
        statusId: statusWithMention.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.mentions[0]).toMatchObject({
        id: urlToId(unknownActorId),
        url: unknownActorId
      })
    })

    it('resolves every mention on a page with a single batch lookup', async () => {
      const first = await database.createNote({
        id: `${ACTOR1_ID}/statuses/mention-batch-1`,
        url: `${ACTOR1_ID}/statuses/mention-batch-1`,
        actorId: ACTOR1_ID,
        text: '@test2@llun.test Hello!',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const second = await database.createNote({
        id: `${ACTOR1_ID}/statuses/mention-batch-2`,
        url: `${ACTOR1_ID}/statuses/mention-batch-2`,
        actorId: ACTOR1_ID,
        text: '@test3@llun.test Hello!',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId: first.id,
        type: 'mention',
        name: '@test2@llun.test',
        value: ACTOR2_ID
      })
      await database.createTag({
        statusId: second.id,
        type: 'mention',
        name: '@test3@llun.test',
        value: ACTOR3_ID
      })
      const statuses = (await Promise.all([
        database.getStatus({ statusId: first.id, withReplies: false }),
        database.getStatus({ statusId: second.id, withReplies: false })
      ])) as Status[]
      const getActorPublicIds = vi.spyOn(database, 'getActorPublicIds')

      try {
        const mastodonStatuses = await getMastodonStatuses(database, statuses)

        expect(getActorPublicIds).toHaveBeenCalledTimes(1)
        expect(getActorPublicIds).toHaveBeenCalledWith({
          actorIds: [ACTOR2_ID, ACTOR3_ID]
        })
        expect(mastodonStatuses.map(({ mentions }) => mentions[0].id)).toEqual([
          await getActorPublicId(ACTOR2_ID),
          await getActorPublicId(ACTOR3_ID)
        ])
      } finally {
        getActorPublicIds.mockRestore()
      }
    })
  })

  describe('public id emission fallbacks', () => {
    // Rolling deploys and AP-derived domain objects can carry a null publicId,
    // so the legacy colon encoding stays the permanent fallback at every
    // emission site.
    it('emits the legacy colon id for a status with no publicId', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const legacyStatus = { ...status, publicId: null } as Status

      const mastodonStatus = await getMastodonStatus(database, legacyStatus)

      expect(mastodonStatus?.id).toBe(urlToId(status.id))
      expect(mastodonStatus?.uri).toBe(status.id)
    })

    it('emits the legacy colon poll id for a poll with no publicId', async () => {
      const pollStatus = await database.createPoll({
        id: `${ACTOR1_ID}/statuses/legacy-poll`,
        url: `${ACTOR1_ID}/statuses/legacy-poll`,
        actorId: ACTOR1_ID,
        text: 'Legacy poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Option 1', 'Option 2'],
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })
      const legacyPoll = { ...pollStatus, publicId: null } as Status

      const mastodonStatus = await getMastodonStatus(database, legacyPoll)

      expect(mastodonStatus?.poll?.id).toBe(urlToId(pollStatus.id))
    })

    it.each([
      {
        description: 'a reply parent whose author row could not be hydrated',
        hydrateAuthor: false
      },
      {
        description: 'a reply parent whose author predates the backfill',
        hydrateAuthor: true
      }
    ])('emits legacy reply ids for $description', async ({ hydrateAuthor }) => {
      const parent = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const reply = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/reply-1`
      })) as Status
      const legacyParent = {
        ...parent,
        publicId: null,
        actor:
          hydrateAuthor && parent.actor
            ? { ...parent.actor, publicId: null }
            : null
      } as Status

      const mastodonStatus = await getMastodonStatus(
        database,
        reply,
        undefined,
        { replyStatusCache: new Map([[parent.id, legacyParent]]) }
      )

      expect(mastodonStatus?.in_reply_to_id).toBe(urlToId(parent.id))
      expect(mastodonStatus?.in_reply_to_account_id).toBe(urlToId(ACTOR1_ID))
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

  describe('replies_count', () => {
    it('returns correct replies_count for status with replies', async () => {
      const parentStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/replies-count-test-parent`,
        url: `${ACTOR1_ID}/statuses/replies-count-test-parent`,
        actorId: ACTOR1_ID,
        text: 'Parent status for replies count',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createNote({
        id: `${ACTOR2_ID}/statuses/replies-count-test-child`,
        url: `${ACTOR2_ID}/statuses/replies-count-test-child`,
        actorId: ACTOR2_ID,
        text: 'Reply status',
        reply: parentStatus.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const status = (await database.getStatus({
        statusId: parentStatus.id
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.replies_count).toBe(1)
    })
  })

  describe('bookmarked flag', () => {
    it('returns bookmarked=false when no current actor has bookmarked the status', async () => {
      const statusId = `${ACTOR1_ID}/statuses/bookmarked-flag-false`
      const status = await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Not bookmarked',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.bookmarked).toBe(false)
    })

    it('returns bookmarked=true when the current actor bookmarked the status', async () => {
      const statusId = `${ACTOR1_ID}/statuses/bookmarked-flag-true`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Bookmarked by current actor',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createBookmark({ actorId: ACTOR2_ID, statusId })

      const status = (await database.getStatus({
        statusId,
        currentActorId: ACTOR2_ID
      })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR2_ID
      )

      expect(mastodonStatus?.bookmarked).toBe(true)
    })

    it('returns bookmarked=true on an announce and nested original when the original status is bookmarked', async () => {
      const originalStatusId = `${ACTOR1_ID}/statuses/bookmarked-announce-original`
      await database.createNote({
        id: originalStatusId,
        url: originalStatusId,
        actorId: ACTOR1_ID,
        text: 'Bookmarked original',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const announce = await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/bookmarked-announce`,
        actorId: ACTOR2_ID,
        originalStatusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createBookmark({
        actorId: ACTOR2_ID,
        statusId: originalStatusId
      })

      const status = (await database.getStatus({
        statusId: announce!.id,
        currentActorId: ACTOR2_ID
      })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR2_ID
      )

      expect(mastodonStatus?.bookmarked).toBe(true)
      expect(mastodonStatus?.reblog?.bookmarked).toBe(true)
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
        statusId: announceStatus!.id
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
        statusId: announceStatus!.id
      })) as Status

      // Read as the original's author, who may see it.
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR1_ID
      )

      // The visibility should be 'private' from the original status
      expect(mastodonStatus?.visibility).toBe('private')
    })

    // The Announce wrapper being public says nothing about the status it
    // boosts. A public boost of a followers-only note must not serialize that
    // note to a viewer who could not read it directly.
    describe('a public boost of a status the viewer cannot read', () => {
      const originalId = `${ACTOR1_ID}/statuses/hidden-original-for-reblog`
      const announceId = `${ACTOR2_ID}/statuses/announce-hidden-original`

      beforeAll(async () => {
        await database.createNote({
          id: originalId,
          url: originalId,
          actorId: ACTOR1_ID,
          text: 'Followers-only secret',
          to: [`${ACTOR1_ID}/followers`],
          cc: []
        })
        await database.createAnnounce({
          id: announceId,
          actorId: ACTOR2_ID,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${ACTOR2_ID}/followers`],
          originalStatusId: originalId
        })
      })

      const getAnnounce = async () =>
        (await database.getStatus({ statusId: announceId })) as Status

      it('is dropped for an anonymous viewer', async () => {
        expect(
          await getMastodonStatus(database, await getAnnounce())
        ).toBeNull()
      })

      it('is dropped for a signed-in viewer who does not follow the author', async () => {
        expect(
          await getMastodonStatus(database, await getAnnounce(), ACTOR3_ID)
        ).toBeNull()
      })

      it('is dropped from a batch while readable statuses are kept', async () => {
        const publicStatus = (await database.getStatus({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })) as Status

        const result = await getMastodonStatuses(
          database,
          [await getAnnounce(), publicStatus],
          ACTOR3_ID
        )

        expect(result.map((status) => status.uri)).toEqual([publicStatus.id])
      })

      it('is still serialized for a viewer who may read the original', async () => {
        const mastodonStatus = await getMastodonStatus(
          database,
          await getAnnounce(),
          ACTOR1_ID
        )

        expect(mastodonStatus?.reblog?.uri).toBe(originalId)
      })
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

      // Advertises nothing, because the renderer cannot render it either: a
      // name whose inner part is itself `:emoji:` is not a shortcode, and
      // `content` leaves the text alone. This list used to strip every colon
      // with a local regex and report `emoji`, handing clients a shortcode that
      // appears nowhere in the content it arrived with. No implementation sends
      // doubled colons; what matters is that the two sides agree.
      expect(mastodonStatus?.emojis).toHaveLength(0)
    })

    // The names that DO arrive from the wider fediverse, all of which the
    // renderer resolves, so the API must advertise them too.
    it.each([
      { description: 'a hyphen', name: ':poi-love:', shortcode: 'poi-love' },
      { description: 'one character', name: ':c:', shortcode: 'c' },
      { description: 'non-ASCII', name: ':afiŝo:', shortcode: 'afiŝo' }
    ])(
      'advertises a shortcode with $description',
      async ({ name, shortcode }) => {
        const status = await database.createNote({
          id: `${ACTOR1_ID}/statuses/emoji-${shortcode}`,
          url: `${ACTOR1_ID}/statuses/emoji-${shortcode}`,
          actorId: ACTOR1_ID,
          text: `Status with ${name}`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await database.createTag({
          statusId: status.id,
          type: 'emoji',
          name,
          value: 'https://test.host/emoji.png'
        })

        const mastodonStatus = await getMastodonStatus(
          database,
          (await database.getStatus({
            statusId: status.id,
            withReplies: false
          })) as Status
        )

        expect(mastodonStatus?.emojis).toHaveLength(1)
        expect(mastodonStatus?.emojis[0].shortcode).toBe(shortcode)
      }
    )

    // A remote `Emoji` tag's name is stored verbatim, so this is a name that
    // can really arrive. Relaying it would hand a client attacker-controlled
    // markup in a field some clients substitute into HTML themselves.
    it('advertises nothing for a name shaped like markup', async () => {
      const status = await database.createNote({
        id: `${ACTOR1_ID}/statuses/emoji-markup`,
        url: `${ACTOR1_ID}/statuses/emoji-markup`,
        actorId: ACTOR1_ID,
        text: 'Status with a hostile emoji tag',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId: status.id,
        type: 'emoji',
        name: '<a href="https://evil.test/">',
        value: 'https://test.host/emoji.png'
      })

      const mastodonStatus = await getMastodonStatus(
        database,
        (await database.getStatus({
          statusId: status.id,
          withReplies: false
        })) as Status
      )

      expect(mastodonStatus?.emojis).toHaveLength(0)
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
  describe('link preview card', () => {
    const linkedUrl = 'https://example.com/mastodon-card'

    const seedCard = async (statusId: string) => {
      const urlHash = `hash-${urlToId(statusId)}`
      await database.upsertLinkPreview({
        urlHash,
        url: linkedUrl,
        title: 'A serialized article',
        description: 'Card body',
        siteName: 'Example',
        imageUrl: 'https://cdn.example.com/a.png',
        imageWidth: 1200,
        imageHeight: 630,
        fetchStatus: 'completed'
      })
      await database.linkStatusLinkPreview({ statusId, urlHash })
    }

    it('serializes the stored card into the Mastodon card field', async () => {
      const statusId = `${ACTOR1_ID}/statuses/card-1`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: `Read ${linkedUrl}`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await seedCard(statusId)

      const status = await database.getStatus({ statusId })
      const mastodonStatus = await getMastodonStatus(database, status as Status)

      expect(mastodonStatus?.card).toMatchObject({
        url: linkedUrl,
        title: 'A serialized article',
        description: 'Card body',
        provider_name: 'Example',
        image: 'https://cdn.example.com/a.png',
        width: 1200,
        height: 630,
        type: 'link'
      })
      // Never remote markup for a client to inject.
      expect(mastodonStatus?.card?.html).toBe('')
      expect(mastodonStatus?.card?.embed_url).toBe('')
    })

    it('serializes null for a status with no card', async () => {
      const statusId = `${ACTOR1_ID}/statuses/card-none`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'No links here',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const status = await database.getStatus({ statusId })
      const mastodonStatus = await getMastodonStatus(database, status as Status)

      expect(mastodonStatus?.card).toBeNull()
    })

    // The boost wrapper is not the thing with the link; the card belongs to the
    // status it wraps, matching how media_attachments is handled.
    it('keeps the boost wrapper cardless and carries the card on the reblog', async () => {
      const originalId = `${ACTOR1_ID}/statuses/card-boosted`
      await database.createNote({
        id: originalId,
        url: originalId,
        actorId: ACTOR1_ID,
        text: `Read ${linkedUrl}`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await seedCard(originalId)

      const announceId = `${ACTOR2_ID}/statuses/card-announce`
      await database.createAnnounce({
        id: announceId,
        actorId: ACTOR2_ID,
        originalStatusId: originalId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const status = await database.getStatus({ statusId: announceId })
      const mastodonStatus = await getMastodonStatus(database, status as Status)

      expect(mastodonStatus?.card).toBeNull()
      expect(mastodonStatus?.reblog?.card).toMatchObject({
        title: 'A serialized article'
      })
    })
  })
})
