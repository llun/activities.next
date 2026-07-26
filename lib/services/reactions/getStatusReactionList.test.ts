import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getStatusReactionList } from '@/lib/services/reactions/getStatusReactionList'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'

describe('getStatusReactionList', () => {
  const database = getTestSQLDatabase()
  const statusId = `${ACTOR1_ID}/statuses/post-1`
  let author: Actor
  let reactor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    author = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    reactor = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor

    await database.createStatusReaction({
      statusId,
      actorId: ACTOR1_ID,
      name: '🔥'
    })
    await database.createStatusReaction({
      statusId,
      actorId: ACTOR2_ID,
      name: '🔥'
    })
    await database.createStatusReaction({
      statusId,
      actorId: ACTOR2_ID,
      name: '🎉'
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns every reaction with its accounts', async () => {
    const reactions = await getStatusReactionList({
      database,
      currentActor: author,
      statusId
    })

    expect(reactions).toHaveLength(2)
    const fire = reactions?.find((entry) => entry.name === '🔥')
    expect(fire).toMatchObject({ name: '🔥', count: 2, me: true })
    expect(fire?.accounts).toHaveLength(2)
  })

  it('restricts to one emoji when given a name', async () => {
    const reactions = await getStatusReactionList({
      database,
      currentActor: reactor,
      statusId,
      name: '🎉'
    })

    expect(reactions).toHaveLength(1)
    expect(reactions?.[0]).toMatchObject({ name: '🎉', count: 1, me: true })
    expect(reactions?.[0].accounts).toHaveLength(1)
  })

  it('reports me false for an anonymous reader', async () => {
    const reactions = await getStatusReactionList({
      database,
      currentActor: null,
      statusId
    })

    expect(reactions?.every((entry) => entry.me === false)).toBeTrue()
  })

  it('resolves accounts whose url is a profile url rather than the actor uri', async () => {
    // Some actors serve `/@name` as their `url`; keying the account map on
    // `url` alone drops them and the reactor silently disappears.
    const accounts = await database.getMastodonActorsFromIds({
      ids: [ACTOR1_ID, ACTOR2_ID]
    })
    vi.spyOn(database, 'getMastodonActorsFromIds').mockResolvedValueOnce(
      accounts.map((account) => ({ ...account, url: 'https://llun.test/@x' }))
    )

    const reactions = await getStatusReactionList({
      database,
      currentActor: author,
      statusId
    })

    expect(
      reactions?.find((entry) => entry.name === '🔥')?.accounts
    ).toHaveLength(2)
  })

  it('returns null for a status that cannot be read', async () => {
    const reactions = await getStatusReactionList({
      database,
      currentActor: author,
      statusId: 'https://nonexistent.status/id'
    })

    expect(reactions).toBeNull()
  })

  it('returns an empty list for a status with no reactions', async () => {
    const reactions = await getStatusReactionList({
      database,
      currentActor: author,
      statusId: `${ACTOR1_ID}/statuses/post-2`
    })

    expect(reactions).toEqual([])
  })
})
