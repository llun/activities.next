import {
  emojiReactionRequest,
  getReactionContent,
  undoEmojiReactionRequest
} from '@/lib/actions/emojiReaction'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { EmojiReact, Like } from '@/lib/types/activitypub'
import { NotificationType } from '@/lib/types/database/operations'

const REMOTE_ACTOR = 'https://remote.test/users/reactor'

const emojiReactActivity = (
  overrides: Partial<EmojiReact> & { object: string }
): EmojiReact => ({
  id: `${REMOTE_ACTOR}#emoji-reactions/1`,
  type: 'EmojiReact',
  actor: REMOTE_ACTOR,
  ...overrides
})

describe('getReactionContent', () => {
  it.each([
    {
      description: 'prefers _misskey_reaction over content',
      activity: { content: '❤', _misskey_reaction: '🔥' },
      expected: '🔥'
    },
    {
      description: 'falls back to content',
      activity: { content: '🔥' },
      expected: '🔥'
    },
    {
      description: 'trims surrounding whitespace',
      activity: { content: ' 🔥 ' },
      expected: '🔥'
    },
    {
      description: 'returns null for a plain Like',
      activity: {},
      expected: null
    },
    {
      description: 'returns null for whitespace-only content',
      activity: { content: '   ' },
      expected: null
    },
    {
      description: 'returns null for over-long content',
      activity: { content: 'x'.repeat(200) },
      expected: null
    }
  ])('$description', ({ activity, expected }) => {
    expect(getReactionContent(activity)).toEqual(expected)
  })
})

describe('emojiReactionRequest', () => {
  const { actors, statuses } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    it('stores a unicode reaction against the status', async () => {
      const statusId = statuses.primary.post
      await emojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: '🔥' }),
        database
      })

      const rollups = await database.getStatusReactionRollups({
        statusIds: [statusId]
      })
      expect(rollups).toContainEqual({
        statusId,
        name: '🔥',
        count: 1,
        me: false,
        url: null,
        staticUrl: null
      })
    })

    it('never records a reaction as a favourite', async () => {
      const statusId = statuses.primary.secondPost
      await emojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: '👍' }),
        database
      })

      expect(
        await database.isActorLikedStatus({
          statusId,
          actorId: REMOTE_ACTOR
        })
      ).toBeFalse()
      expect(await database.getLikeCount({ statusId })).toBe(0)
    })

    it('namespaces a remote custom emoji as shortcode@domain and stores the tag icon url', async () => {
      const statusId = statuses.primary.postWithAttachments
      await emojiReactionRequest({
        activity: emojiReactActivity({
          object: statusId,
          content: ':blobcat:',
          tag: [
            {
              type: 'Emoji',
              name: ':blobcat:',
              icon: {
                type: 'Image',
                mediaType: 'image/png',
                url: 'https://remote.test/emoji/blobcat.png'
              }
            }
          ]
        }),
        database
      })

      const rollups = await database.getStatusReactionRollups({
        statusIds: [statusId]
      })
      expect(rollups).toContainEqual({
        statusId,
        name: 'blobcat@remote.test',
        count: 1,
        me: false,
        url: 'https://remote.test/emoji/blobcat.png',
        staticUrl: 'https://remote.test/emoji/blobcat.png'
      })
    })

    it.each([
      {
        description: 'the icon url host does not match the sender domain',
        url: 'https://attacker.test/emoji/blobcat.png'
      },
      {
        description: 'the icon url is not http(s)',
        url: 'javascript:alert(1)'
      },
      {
        description: 'the icon url is unparseable',
        url: 'not a url'
      }
    ])(
      'stores the reaction without a url when $description',
      async ({ url }) => {
        const statusId = statuses.replyAuthor.replyToPrimary
        const actor = `https://remote.test/users/spoofer-${encodeURIComponent(url)}`
        await emojiReactionRequest({
          activity: {
            ...emojiReactActivity({ object: statusId }),
            actor,
            content: ':spoofed:',
            tag: [
              {
                type: 'Emoji',
                name: ':spoofed:',
                icon: { type: 'Image', mediaType: 'image/png', url }
              }
            ]
          },
          database
        })

        const reactors = await database.getStatusReactionActors({
          statusId,
          name: 'spoofed@remote.test'
        })
        expect(reactors.map((reactor) => reactor.actorId)).toContain(actor)

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId]
        })
        const rollup = rollups.find(
          (entry) => entry.name === 'spoofed@remote.test'
        )
        expect(rollup?.url).toBeNull()
      }
    )

    it('keeps an already-namespaced shortcode as sent', async () => {
      const statusId = statuses.replyAuthor.mentionReplyToPrimary
      await emojiReactionRequest({
        activity: emojiReactActivity({
          object: statusId,
          content: ':blobfox@third.test:'
        }),
        database
      })

      const reactors = await database.getStatusReactionActors({ statusId })
      expect(reactors.map((reactor) => reactor.name)).toContain(
        'blobfox@third.test'
      )
    })

    it('reads a Misskey Like carrying _misskey_reaction', async () => {
      const statusId = statuses.poll.status
      const activity: Like = {
        id: `${REMOTE_ACTOR}#likes/misskey`,
        type: 'Like',
        actor: REMOTE_ACTOR,
        object: statusId,
        content: '🎉',
        _misskey_reaction: '🎉'
      }
      await emojiReactionRequest({ activity, database })

      const reactors = await database.getStatusReactionActors({
        statusId,
        name: '🎉'
      })
      expect(reactors).toHaveLength(1)
    })

    it('resolves the status id from an embedded object', async () => {
      const statusId = statuses.replyAuthor.announceOwn
      await emojiReactionRequest({
        activity: {
          ...emojiReactActivity({ object: statusId }),
          object: { id: statusId } as never,
          content: '🥰'
        },
        database
      })

      const reactors = await database.getStatusReactionActors({
        statusId,
        name: '🥰'
      })
      expect(reactors).toHaveLength(1)
    })

    it('creates an emoji_reaction notification for the status author with the reaction name', async () => {
      const statusId = statuses.primary.post
      await emojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: '💜' }),
        database
      })

      const notifications = await database.getNotifications({
        actorId: actors.primary.id,
        limit: 20,
        types: [NotificationType.enum.emoji_reaction]
      })
      const notification = notifications.find(
        (entry) => entry.reactionName === '💜'
      )
      expect(notification).toMatchObject({
        type: NotificationType.enum.emoji_reaction,
        sourceActorId: REMOTE_ACTOR,
        statusId,
        reactionName: '💜',
        groupKey: `emoji_reaction:${statusId}:💜`
      })
    })

    it('does not notify the author when they react to their own status', async () => {
      const statusId = statuses.primary.secondPost
      await emojiReactionRequest({
        activity: {
          ...emojiReactActivity({ object: statusId }),
          actor: actors.primary.id,
          content: '🙃'
        },
        database
      })

      const notifications = await database.getNotifications({
        actorId: actors.primary.id,
        limit: 50,
        types: [NotificationType.enum.emoji_reaction]
      })
      expect(
        notifications.some((entry) => entry.reactionName === '🙃')
      ).toBeFalse()
    })

    it.each([
      { description: 'empty content is dropped', reaction: '   ' },
      { description: 'over-long content is dropped', reaction: 'x'.repeat(200) }
    ])('$description', async ({ reaction }) => {
      const statusId = statuses.replyAuthor.announcePrimary
      await emojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: reaction }),
        database
      })

      const reactors = await database.getStatusReactionActors({ statusId })
      expect(reactors).toEqual([])
    })
  })
})

describe('undoEmojiReactionRequest', () => {
  const { statuses } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    it('removes exactly the undone reaction', async () => {
      const statusId = statuses.primary.post
      await emojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: '🔥' }),
        database
      })
      await emojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: '💧' }),
        database
      })

      await undoEmojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: '🔥' }),
        database
      })

      const reactors = await database.getStatusReactionActors({ statusId })
      expect(reactors.map((reactor) => reactor.name)).toEqual(['💧'])
    })

    it('does nothing for an activity without a reaction', async () => {
      const statusId = statuses.primary.secondPost
      await emojiReactionRequest({
        activity: emojiReactActivity({ object: statusId, content: '🎈' }),
        database
      })

      await undoEmojiReactionRequest({
        activity: emojiReactActivity({ object: statusId }),
        database
      })

      const reactors = await database.getStatusReactionActors({ statusId })
      expect(reactors.map((reactor) => reactor.name)).toEqual(['🎈'])
    })
  })
})
