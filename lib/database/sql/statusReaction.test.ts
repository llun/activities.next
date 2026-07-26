import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { MAX_REACTIONS_PER_ACTOR } from '@/lib/services/statuses/reactionLimits'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

// Distinct timestamps: reaction rollups are ordered by first-reaction time, and
// SQLite stores the column with millisecond resolution.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('StatusReactionDatabase', () => {
  const { actors, statuses } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const replyAuthorId = actors.replyAuthor.id
  const extraActorId = actors.extra.id
  const emptyActorId = actors.empty.id
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

    describe('createStatusReaction', () => {
      it('stores a reaction and is idempotent per (status, actor, name)', async () => {
        const statusId = statuses.primary.post
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '👍'
        })
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '👍'
        })

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId],
          currentActorId: primaryActorId
        })
        expect(rollups).toEqual([
          {
            statusId,
            name: '👍',
            count: 1,
            me: true,
            url: null,
            staticUrl: null
          }
        ])
      })

      it('does nothing when the status does not exist', async () => {
        await database.createStatusReaction({
          statusId: 'https://nonexistent.status/id',
          actorId: primaryActorId,
          name: '👍'
        })

        const rollups = await database.getStatusReactionRollups({
          statusIds: ['https://nonexistent.status/id']
        })
        expect(rollups).toEqual([])
      })

      it('keeps distinct reactions from one actor on one status', async () => {
        const statusId = statuses.primary.secondPost
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '🎉'
        })
        await tick()
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '🔥'
        })

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId]
        })
        expect(rollups.map((rollup) => rollup.name)).toEqual(['🎉', '🔥'])
      })

      it('drops inserts beyond the per-actor-per-status cap', async () => {
        const statusId = statuses.primary.postWithAttachments
        const names = Array.from(
          { length: MAX_REACTIONS_PER_ACTOR + 3 },
          (_unused, index) => `cap-${index}`
        )
        for (const name of names) {
          await database.createStatusReaction({
            statusId,
            actorId: extraActorId,
            name
          })
        }

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId]
        })
        expect(rollups).toHaveLength(MAX_REACTIONS_PER_ACTOR)
        // The cap drops the overflow rather than evicting earlier reactions.
        expect(rollups.map((rollup) => rollup.name).sort()).toEqual(
          names.slice(0, MAX_REACTIONS_PER_ACTOR).sort()
        )
      })

      it.each([
        {
          description: 'a first-time reaction reports that it stored a row',
          setup: false,
          expected: true
        },
        {
          description: 'a repeat of the same reaction reports no change',
          setup: true,
          expected: false
        }
      ])('$description', async ({ setup, expected }) => {
        const statusId = statuses.replyAuthor.announcePrimary
        const name = setup ? 'repeat' : 'first-time'
        if (setup) {
          await database.createStatusReaction({
            statusId,
            actorId: emptyActorId,
            name
          })
        }

        expect(
          await database.createStatusReaction({
            statusId,
            actorId: emptyActorId,
            name
          })
        ).toBe(expected)
      })

      it('reports no change for an unknown status or past the cap', async () => {
        expect(
          await database.createStatusReaction({
            statusId: 'https://nonexistent.status/id',
            actorId: emptyActorId,
            name: '👍'
          })
        ).toBeFalse()

        const statusId = statuses.primary.postWithAttachments
        expect(
          await database.createStatusReaction({
            statusId,
            actorId: extraActorId,
            name: 'over-the-cap'
          })
        ).toBeFalse()
      })

      it('counts the cap per actor, not per status', async () => {
        const statusId = statuses.primary.postWithAttachments
        await database.createStatusReaction({
          statusId,
          actorId: replyAuthorId,
          name: '🙌'
        })

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId]
        })
        expect(rollups.map((rollup) => rollup.name)).toContain('🙌')
      })
    })

    describe('getStatusReactionRollups', () => {
      const statusId = statuses.replyAuthor.replyToPrimary

      beforeAll(async () => {
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '🚀'
        })
        await tick()
        await database.createStatusReaction({
          statusId,
          actorId: replyAuthorId,
          name: '🚀'
        })
        await tick()
        await database.createStatusReaction({
          statusId,
          actorId: replyAuthorId,
          name: '😀'
        })
      })

      it('groups by status and name with count, me and first-reaction order', async () => {
        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId],
          currentActorId: primaryActorId
        })
        expect(rollups).toEqual([
          {
            statusId,
            name: '🚀',
            count: 2,
            me: true,
            url: null,
            staticUrl: null
          },
          {
            statusId,
            name: '😀',
            count: 1,
            me: false,
            url: null,
            staticUrl: null
          }
        ])
      })

      it('resolves local custom emoji urls from customEmojis and keeps remote urls from the row', async () => {
        const localStatusId = statuses.replyAuthor.mentionReplyToPrimary
        await database.createCustomEmoji({
          shortcode: 'partyparrot',
          url: 'https://test.llun.dev/emojis/partyparrot.gif',
          staticUrl: 'https://test.llun.dev/emojis/partyparrot.png'
        })
        await database.createStatusReaction({
          statusId: localStatusId,
          actorId: primaryActorId,
          name: 'partyparrot'
        })
        await tick()
        await database.createStatusReaction({
          statusId: localStatusId,
          actorId: replyAuthorId,
          name: 'blobcat@remote.test',
          url: 'https://remote.test/emojis/blobcat.png'
        })

        const rollups = await database.getStatusReactionRollups({
          statusIds: [localStatusId]
        })
        expect(rollups).toEqual([
          {
            statusId: localStatusId,
            name: 'partyparrot',
            count: 1,
            me: false,
            url: 'https://test.llun.dev/emojis/partyparrot.gif',
            staticUrl: 'https://test.llun.dev/emojis/partyparrot.png'
          },
          {
            statusId: localStatusId,
            name: 'blobcat@remote.test',
            count: 1,
            me: false,
            url: 'https://remote.test/emojis/blobcat.png',
            staticUrl: 'https://remote.test/emojis/blobcat.png'
          }
        ])
      })

      it('returns an empty array for empty statusIds', async () => {
        const rollups = await database.getStatusReactionRollups({
          statusIds: []
        })
        expect(rollups).toEqual([])
      })

      it.each([
        {
          description: 'me is false without currentActorId',
          actorId: undefined
        },
        { description: 'me is false for a non-reactor', actorId: emptyActorId }
      ])('$description', async ({ actorId }) => {
        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId],
          currentActorId: actorId
        })
        expect(rollups.every((rollup) => rollup.me === false)).toBeTrue()
      })
    })

    describe('getStatusReactionActors', () => {
      const statusId = statuses.poll.status

      beforeAll(async () => {
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '💯'
        })
        await tick()
        await database.createStatusReaction({
          statusId,
          actorId: replyAuthorId,
          name: '💯'
        })
        await tick()
        await database.createStatusReaction({
          statusId,
          actorId: replyAuthorId,
          name: '👀'
        })
      })

      it('returns every reactor for the status oldest first', async () => {
        const reactors = await database.getStatusReactionActors({ statusId })
        expect(reactors.map((reactor) => reactor.actorId)).toEqual([
          primaryActorId,
          replyAuthorId,
          replyAuthorId
        ])
        expect(reactors.map((reactor) => reactor.name)).toEqual([
          '💯',
          '💯',
          '👀'
        ])
        reactors.forEach((reactor) => {
          expect(typeof reactor.createdAt).toBe('number')
        })
      })

      it('restricts to a single reaction name when given one', async () => {
        const reactors = await database.getStatusReactionActors({
          statusId,
          name: '👀'
        })
        expect(reactors).toHaveLength(1)
        expect(reactors[0].actorId).toEqual(replyAuthorId)
      })

      it('returns an empty array for a status without reactions', async () => {
        const reactors = await database.getStatusReactionActors({
          statusId: 'https://nonexistent.status/id'
        })
        expect(reactors).toEqual([])
      })
    })

    describe('deleteStatusReaction', () => {
      const statusId = statuses.replyAuthor.announceOwn

      it('removes exactly the named reaction for that actor', async () => {
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '🥳'
        })
        await tick()
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '🤝'
        })
        await tick()
        await database.createStatusReaction({
          statusId,
          actorId: replyAuthorId,
          name: '🥳'
        })

        await database.deleteStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '🥳'
        })

        // 🥳 survives through the other actor, and its first-reaction time is now
        // the surviving row's — so it sorts after 🤝.
        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId],
          currentActorId: primaryActorId
        })
        expect(rollups).toEqual([
          {
            statusId,
            name: '🤝',
            count: 1,
            me: true,
            url: null,
            staticUrl: null
          },
          {
            statusId,
            name: '🥳',
            count: 1,
            me: false,
            url: null,
            staticUrl: null
          }
        ])
      })

      it('reports whether a row was actually removed', async () => {
        expect(
          await database.deleteStatusReaction({
            statusId,
            actorId: emptyActorId,
            name: '🥳'
          })
        ).toBeFalse()

        await database.createStatusReaction({
          statusId,
          actorId: emptyActorId,
          name: '🫶'
        })
        expect(
          await database.deleteStatusReaction({
            statusId,
            actorId: emptyActorId,
            name: '🫶'
          })
        ).toBeTrue()
      })
    })
  })
})
