import { randomUUID } from 'node:crypto'

import { statusReactionQueries } from '@/lib/database/domains/statusReaction/queries'
import {
  type TestDatabaseTable,
  databaseBeforeAll
} from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { withStaleFirstRead } from '@/lib/database/testing/staleRead'
import { Database } from '@/lib/database/types'
import { MAX_REACTIONS_PER_ACTOR } from '@/lib/services/statuses/reactionLimits'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Distinct timestamps: reaction rollups are ordered by first-reaction time, and
// SQLite stores the column with millisecond resolution.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('StatusReactionDatabase', () => {
  const { actors, statuses } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const replyAuthorId = actors.replyAuthor.id
  const extraActorId = actors.extra.id
  const emptyActorId = actors.empty.id
  const testDb = createTestDatabase()
  const table: TestDatabaseTable = [
    [testDb.backend, testDb.database, testDb.prepare]
  ]

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

      it('row-locks the statuses row, not the actor reactions it counts', async () => {
        // The lock is what serialises a burst of distinct reactions on
        // PostgreSQL. SQLite has no row locks and rejects FOR UPDATE, so no
        // result-based test can see the lock go: read the statements the call
        // sent. Record WHICH table each lock targets: a lock moved onto the
        // status_reactions read locks zero rows for a first reaction, so it
        // serialises nothing, yet still says FOR UPDATE.
        const statements: string[] = []
        const record = ({ sql }: { sql: string }) => statements.push(sql)
        testDb.knex.on('query', record)
        try {
          await database.createStatusReaction({
            statusId: statuses.primary.post,
            actorId: extraActorId,
            name: '🔒'
          })
        } finally {
          testDb.knex.removeListener('query', record)
        }

        const locking = statements.filter((sql) => /\bfor update\b/i.test(sql))
        if (testDb.backend === 'pg') {
          expect(locking).toHaveLength(1)
          expect(locking[0]).toMatch(/\bfrom "statuses"/)
        } else {
          expect(locking).toEqual([])
        }
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
        try {
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
        } finally {
          for (const name of names) {
            await database.deleteStatusReaction({
              statusId,
              actorId: extraActorId,
              name
            })
          }
        }
      })

      it('holds the per-actor cap when distinct reactions race', async () => {
        const statusId = statuses.primary.postWithAttachments
        const names = Array.from(
          { length: MAX_REACTIONS_PER_ACTOR * 3 },
          (_unused, index) => `race-${index}`
        )
        try {
          // Each call reads the actor's existing rows and inserts a different
          // name, so only the status row lock keeps them from all seeing room.
          await Promise.all(
            names.map((name) =>
              database.createStatusReaction({
                statusId,
                actorId: extraActorId,
                name
              })
            )
          )

          const rollups = await database.getStatusReactionRollups({
            statusIds: [statusId]
          })
          expect(rollups).toHaveLength(MAX_REACTIONS_PER_ACTOR)
        } finally {
          for (const name of names) {
            await database.deleteStatusReaction({
              statusId,
              actorId: extraActorId,
              name
            })
          }
        }
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
        const capNames = Array.from(
          { length: MAX_REACTIONS_PER_ACTOR },
          (_unused, i) => `precap-${i}`
        )
        try {
          for (const name of capNames) {
            await database.createStatusReaction({
              statusId,
              actorId: extraActorId,
              name
            })
          }
          expect(
            await database.createStatusReaction({
              statusId,
              actorId: extraActorId,
              name: 'over-the-cap'
            })
          ).toBeFalse()
        } finally {
          for (const name of capNames) {
            await database.deleteStatusReaction({
              statusId,
              actorId: extraActorId,
              name
            })
          }
        }
      })

      it('counts the cap per actor, not per status', async () => {
        const statusId = statuses.primary.postWithAttachments
        const capNames = Array.from(
          { length: MAX_REACTIONS_PER_ACTOR },
          (_unused, i) => `cap-per-actor-${i}`
        )
        try {
          for (const name of capNames) {
            await database.createStatusReaction({
              statusId,
              actorId: extraActorId,
              name
            })
          }
          await database.createStatusReaction({
            statusId,
            actorId: replyAuthorId,
            name: '🙌'
          })

          const rollups = await database.getStatusReactionRollups({
            statusIds: [statusId]
          })
          expect(rollups.map((rollup) => rollup.name)).toContain('🙌')
        } finally {
          for (const name of capNames) {
            await database.deleteStatusReaction({
              statusId,
              actorId: extraActorId,
              name
            })
          }
          await database.deleteStatusReaction({
            statusId,
            actorId: replyAuthorId,
            name: '🙌'
          })
        }
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

    describe('reactions of other statuses, actors and emoji', () => {
      const remoteActor = (name: string) =>
        `https://remote.test/users/reaction-${name}-${randomUUID()}`

      const createStatus = async (name: string) => {
        const statusId = `${primaryActorId}/statuses/reaction-${name}-${randomUUID()}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          text: name,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        return statusId
      }

      const insertReaction = (
        statusId: string,
        actorId: string,
        name: string,
        createdAt: number
      ) =>
        testDb.knex('status_reactions').insert({
          statusId,
          actorId,
          name,
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt)
        })

      it('counts the per-actor cap on each status separately', async () => {
        const full = await createStatus('cap-full')
        const empty = await createStatus('cap-empty')
        const actorId = remoteActor('cap')
        for (let index = 0; index < MAX_REACTIONS_PER_ACTOR; index += 1) {
          await expect(
            database.createStatusReaction({
              statusId: full,
              actorId,
              name: `cap-${index}`
            })
          ).resolves.toBe(true)
        }

        await expect(
          database.createStatusReaction({
            statusId: full,
            actorId,
            name: 'one-too-many'
          })
        ).resolves.toBe(false)
        await expect(
          database.createStatusReaction({
            statusId: empty,
            actorId,
            name: 'one-too-many'
          })
        ).resolves.toBe(true)
        // The same name on the other status is not a repeat either.
        await expect(
          database.createStatusReaction({
            statusId: empty,
            actorId,
            name: 'cap-0'
          })
        ).resolves.toBe(true)
      })

      it('stores a reaction once when a concurrent request stores it after the check', async () => {
        const statusId = await createStatus('concurrent')
        const actorId = remoteActor('concurrent')
        await database.createStatusReaction({ statusId, actorId, name: '🏁' })
        // The reaction is not seen by the check, as if the other request
        // stored it just after the check ran.
        const racing = withStaleFirstRead(
          testDb.db,
          'status_reactions',
          () => []
        )

        await expect(
          statusReactionQueries.createStatusReaction(racing, {
            statusId,
            actorId,
            name: '🏁'
          })
        ).resolves.toBe(true)

        await expect(
          database.getStatusReactionActors({ statusId })
        ).resolves.toHaveLength(1)
      })

      it('treats a name another actor used on the status as new', async () => {
        const statusId = await createStatus('shared-name')
        const first = remoteActor('shared-first')
        const second = remoteActor('shared-second')

        await expect(
          database.createStatusReaction({
            statusId,
            actorId: first,
            name: '🍀'
          })
        ).resolves.toBe(true)
        await expect(
          database.createStatusReaction({
            statusId,
            actorId: second,
            name: '🍀'
          })
        ).resolves.toBe(true)
        await expect(
          database.createStatusReaction({
            statusId,
            actorId: first,
            name: '🍀'
          })
        ).resolves.toBe(false)
      })

      it('deletes the reaction on the status asked for and no other', async () => {
        const first = await createStatus('delete-first')
        const second = await createStatus('delete-second')
        const actorId = remoteActor('delete')
        const bystander = remoteActor('delete-bystander')
        for (const statusId of [first, second]) {
          await database.createStatusReaction({ statusId, actorId, name: '🧹' })
        }
        await database.createStatusReaction({
          statusId: first,
          actorId: bystander,
          name: '🧹'
        })

        await expect(
          database.deleteStatusReaction({
            statusId: first,
            actorId,
            name: '🧹'
          })
        ).resolves.toBe(true)

        const rollups = await database.getStatusReactionRollups({
          statusIds: [first, second]
        })
        expect(
          rollups.map(({ statusId, name, count }) => ({
            statusId,
            name,
            count
          }))
        ).toEqual(
          expect.arrayContaining([
            { statusId: first, name: '🧹', count: 1 },
            { statusId: second, name: '🧹', count: 1 }
          ])
        )
        expect(rollups).toHaveLength(2)
        await expect(
          database.getStatusReactionActors({ statusId: first })
        ).resolves.toMatchObject([{ actorId: bystander }])
      })

      it('keeps one rollup per status for the same reaction name', async () => {
        const first = await createStatus('rollup-first')
        const second = await createStatus('rollup-second')
        const actorId = remoteActor('rollup')
        await database.createStatusReaction({
          statusId: first,
          actorId,
          name: '🐝'
        })
        await database.createStatusReaction({
          statusId: second,
          actorId: remoteActor('rollup-other'),
          name: '🐝'
        })
        await database.createStatusReaction({
          statusId: second,
          actorId: remoteActor('rollup-third'),
          name: '🐝'
        })

        const rollups = await database.getStatusReactionRollups({
          statusIds: [first, second],
          currentActorId: actorId
        })
        expect(
          rollups
            .map(({ statusId, count, me }) => ({ statusId, count, me }))
            .sort((a, b) => a.count - b.count)
        ).toEqual([
          { statusId: first, count: 1, me: true },
          { statusId: second, count: 2, me: false }
        ])
      })

      it('orders rollups by first reaction, then by name', async () => {
        const statusId = await createStatus('rollup-order')
        const actorId = remoteActor('rollup-order')
        // Insertion order matches neither the time order nor the name order:
        // b and c react at the same time, a later than both, d earliest.
        await insertReaction(statusId, actorId, 'c', 2_000)
        await insertReaction(statusId, actorId, 'a', 3_000)
        await insertReaction(statusId, actorId, 'd', 1_000)
        await insertReaction(statusId, actorId, 'b', 2_000)

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId]
        })
        expect(rollups.map((rollup) => rollup.name)).toEqual([
          'd',
          'b',
          'c',
          'a'
        ])
      })

      it('uses the earliest reaction of a group as its first reaction time', async () => {
        const statusId = await createStatus('rollup-first-time')
        const early = remoteActor('rollup-early')
        const late = remoteActor('rollup-late')
        await insertReaction(statusId, late, 'x', 9_000)
        await insertReaction(statusId, early, 'y', 5_000)
        await insertReaction(statusId, early, 'x', 1_000)

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId]
        })
        expect(rollups.map((rollup) => [rollup.name, rollup.count])).toEqual([
          ['x', 2],
          ['y', 1]
        ])
      })

      it('lists the reactors of the status asked for, oldest first', async () => {
        const statusId = await createStatus('actors-order')
        const other = await createStatus('actors-other')
        const early = remoteActor('actors-b-early')
        const lateA = remoteActor('actors-a-late')
        const lateB = remoteActor('actors-c-late')
        // Written out of order; the two late reactors share a timestamp and
        // are ranked by actor id.
        await insertReaction(statusId, lateB, 'x', 2_000)
        await insertReaction(other, early, 'x', 500)
        await insertReaction(statusId, lateA, 'x', 2_000)
        await insertReaction(statusId, early, 'y', 1_000)

        const reactors = await database.getStatusReactionActors({ statusId })
        expect(reactors.map((reactor) => reactor.actorId)).toEqual([
          early,
          lateA,
          lateB
        ])
        const named = await database.getStatusReactionActors({
          statusId,
          name: 'x'
        })
        expect(named.map((reactor) => reactor.actorId)).toEqual([lateA, lateB])
        await expect(
          database.getStatusReactionActors({ statusId: other, name: 'y' })
        ).resolves.toEqual([])
      })

      it('shows a disabled local custom emoji as its shortcode only', async () => {
        const statusId = await createStatus('disabled-emoji')
        await database.createCustomEmoji({
          shortcode: 'enabledblob',
          url: 'https://test.llun.dev/emojis/enabledblob.gif',
          staticUrl: 'https://test.llun.dev/emojis/enabledblob.png'
        })
        await database.createCustomEmoji({
          shortcode: 'disabledblob',
          url: 'https://test.llun.dev/emojis/disabledblob.gif',
          staticUrl: 'https://test.llun.dev/emojis/disabledblob.png',
          disabled: true
        })
        const actorId = remoteActor('disabled-emoji')
        await insertReaction(statusId, actorId, 'enabledblob', 1_000)
        await insertReaction(statusId, actorId, 'disabledblob', 2_000)

        const rollups = await database.getStatusReactionRollups({
          statusIds: [statusId]
        })
        expect(rollups).toEqual([
          {
            statusId,
            name: 'enabledblob',
            count: 1,
            me: false,
            url: 'https://test.llun.dev/emojis/enabledblob.gif',
            staticUrl: 'https://test.llun.dev/emojis/enabledblob.png'
          },
          {
            statusId,
            name: 'disabledblob',
            count: 1,
            me: false,
            url: null,
            staticUrl: null
          }
        ])
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
