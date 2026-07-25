import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { emojiReactionJob } from '@/lib/jobs/emojiReactionJob'
import { EMOJI_REACTION_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

const REMOTE_ACTOR = 'https://remote.test/users/reactor'

describe('emojiReactionJob', () => {
  const { statuses } = DatabaseSeed
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  const run = (data: unknown, verifiedSenderActorId = REMOTE_ACTOR) =>
    emojiReactionJob(database, {
      id: 'job-1',
      name: EMOJI_REACTION_JOB_NAME,
      data,
      verifiedSenderActorId
    })

  const reactionNames = async (statusId: string) =>
    (await database.getStatusReactionActors({ statusId })).map(
      (reactor) => reactor.name
    )

  it.each([
    {
      description: 'an EmojiReact',
      activity: {
        id: `${REMOTE_ACTOR}#emoji-reactions/1`,
        type: 'EmojiReact',
        actor: REMOTE_ACTOR,
        object: DatabaseSeed.statuses.primary.post,
        content: '🔥'
      },
      expected: '🔥'
    },
    {
      description: 'a Misskey Like carrying the reaction',
      activity: {
        id: `${REMOTE_ACTOR}#likes/1`,
        type: 'Like',
        actor: REMOTE_ACTOR,
        object: DatabaseSeed.statuses.primary.post,
        content: '🎉',
        _misskey_reaction: '🎉'
      },
      expected: '🎉'
    }
  ])(
    'stores the reaction from $description',
    async ({ activity, expected }) => {
      await run(activity)

      expect(await reactionNames(statuses.primary.post)).toContain(expected)
    }
  )

  it('removes the reaction on an Undo of the rendered activity', async () => {
    const statusId = statuses.primary.secondPost
    const like = {
      id: `${REMOTE_ACTOR}#likes/undo`,
      type: 'Like',
      actor: REMOTE_ACTOR,
      object: statusId,
      content: '💧',
      _misskey_reaction: '💧'
    }
    await run(like)
    expect(await reactionNames(statusId)).toEqual(['💧'])

    await run({
      id: `${REMOTE_ACTOR}#undo/1`,
      type: 'Undo',
      actor: REMOTE_ACTOR,
      object: like
    })

    expect(await reactionNames(statusId)).toEqual([])
  })

  it.each([
    {
      description: 'the activity actor differs from the verified sender',
      data: {
        id: `${REMOTE_ACTOR}#emoji-reactions/spoof`,
        type: 'EmojiReact',
        actor: 'https://evil.example/users/mallory',
        object: DatabaseSeed.statuses.primary.postWithAttachments,
        content: '😈'
      }
    },
    {
      description: 'the activity is a plain Like',
      data: {
        id: `${REMOTE_ACTOR}#likes/plain`,
        type: 'Like',
        actor: REMOTE_ACTOR,
        object: DatabaseSeed.statuses.primary.postWithAttachments
      }
    },
    {
      description: 'the payload is not a reaction activity',
      data: { id: 'x', type: 'Follow' }
    }
  ])('stores nothing when $description', async ({ data }) => {
    await run(data)

    expect(await reactionNames(statuses.primary.postWithAttachments)).toEqual(
      []
    )
  })
})
