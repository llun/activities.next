import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor, getMention } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { getMentions } from '@/lib/utils/text/getMentions'

describe('#getMentions', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined
  let actor2: Actor | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor2 = await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns empty array for text with no mentions', async () => {
    expect(
      await getMentions({
        text: 'Text without mentions',
        currentActor: actor1 as Actor,
        replyStatus: null
      })
    ).toEqual([])
  })

  it('returns Mentions from text', async () => {
    const mentions = await getMentions({
      text: '@llun@somewhere.test @test1@llun.test Test mentions',
      currentActor: actor1 as Actor,
      replyStatus: null
    })
    expect(mentions).toHaveLength(2)
    expect(mentions[0]).toEqual({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
    expect(mentions[1]).toEqual({
      type: 'Mention',
      href: ACTOR1_ID,
      name: '@test1@llun.test'
    })
  })

  it('returns mention with hostname the same as actor when mention without hostname', async () => {
    const mentions = await getMentions({
      text: '@test2 Hello',
      currentActor: actor1 as Actor,
      replyStatus: null
    })
    expect(mentions).toContainEqual({
      type: 'Mention',
      href: actor2?.id,
      name: `@test2`
    })
  })

  it('returns no mentions if it cannot fetch user', async () => {
    const mentions = await getMentions({
      text: '@notexist@else Hello',
      currentActor: actor1 as Actor,
      replyStatus: null
    })
    expect(mentions).toHaveLength(0)
  })

  it('returns single mentions if mentions more than once', async () => {
    const mentions = await getMentions({
      text: '@llun@somewhere.test @llun@somewhere.test Test mentions',
      currentActor: actor1 as Actor,
      replyStatus: null
    })
    expect(mentions).toHaveLength(1)
    expect(mentions).toContainEqual({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
  })

  it('adds reply actor into mention', async () => {
    const status = await database.getStatus({
      statusId: `${actor2?.id}/statuses/post-2`
    })

    const mentions = await getMentions({
      text: '@llun@somewhere.test @llun@somewhere.test Test mentions',
      currentActor: actor1 as Actor,
      replyStatus: status
    })
    expect(mentions).toHaveLength(2)
    expect(mentions).toContainEqual({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
    expect(mentions).toContainEqual({
      type: 'Mention',
      href: actor2?.id,
      name: getMention(actor2 as Actor, true)
    })
  })
})
