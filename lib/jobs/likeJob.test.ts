import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { likeJob } from '@/lib/jobs/likeJob'
import { LIKE_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

const REMOTE_ACTOR = 'https://remote.test/users/liker'
const OTHER_ACTOR = 'https://other.test/users/mallory'

describe('likeJob', () => {
  const { statuses } = DatabaseSeed
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  const run = (data: unknown, verifiedSenderActorId = REMOTE_ACTOR) =>
    likeJob(database, {
      id: 'job-1',
      name: LIKE_JOB_NAME,
      data,
      verifiedSenderActorId
    })

  const like = (statusId: string, actor = REMOTE_ACTOR) => ({
    id: `${actor}#likes/${encodeURIComponent(statusId)}`,
    type: 'Like',
    actor,
    object: statusId
  })

  it('stores a favourite of a local status exactly once', async () => {
    const statusId = statuses.primary.post
    const before = await database.getLikeCount({ statusId })

    await run(like(statusId))
    await run(like(statusId))

    expect(await database.getLikeCount({ statusId })).toBe(before + 1)
    expect(
      await database.isActorLikedStatus({ actorId: REMOTE_ACTOR, statusId })
    ).toBe(true)
  })

  it('does not double count a Like already stored by the personal inbox', async () => {
    const statusId = statuses.primary.secondPost
    await database.createLike({ actorId: REMOTE_ACTOR, statusId })
    const before = await database.getLikeCount({ statusId })

    await run(like(statusId))

    expect(await database.getLikeCount({ statusId })).toBe(before)
  })

  it('removes the favourite on Undo(Like)', async () => {
    const statusId = statuses.primary.post
    const activity = like(statusId, OTHER_ACTOR)
    await run(activity, OTHER_ACTOR)
    expect(
      await database.isActorLikedStatus({ actorId: OTHER_ACTOR, statusId })
    ).toBe(true)

    await run(
      {
        id: `${activity.id}/undo`,
        type: 'Undo',
        actor: OTHER_ACTOR,
        object: activity
      },
      OTHER_ACTOR
    )

    expect(
      await database.isActorLikedStatus({ actorId: OTHER_ACTOR, statusId })
    ).toBe(false)
  })

  it('ignores a Like of a remote or unknown object', async () => {
    const statusId = 'https://remote.test/users/someone/statuses/1'

    await run(like(statusId))

    expect(await database.getLikeCount({ statusId })).toBe(0)
    expect(
      await database.isActorLikedStatus({ actorId: REMOTE_ACTOR, statusId })
    ).toBe(false)
  })

  it('ignores a Like whose actor is not the verified sender', async () => {
    const statusId = statuses.primary.post

    await run(like(statusId, OTHER_ACTOR), REMOTE_ACTOR)

    expect(
      await database.isActorLikedStatus({ actorId: OTHER_ACTOR, statusId })
    ).toBe(false)
  })
})
