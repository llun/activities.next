import { Actor } from '@/lib/models/actor'
import { getSQLStorage } from '@/lib/storage/sql'
import { mockRequests } from '@/lib/stub/activities'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { seedStorage } from '@/lib/stub/storage'
import { getMentions } from '@/lib/utils/text/getMentions'

describe('#getMentions', () => {
  const storage = getSQLStorage({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined
  let actor2: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor1 = await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor2 = await storage.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns empty array for text with no mentions', async () => {
    if (!actor1) fail('Actor1 is required')
    expect(
      await getMentions({
        text: 'Text without mentions',
        currentActor: actor1
      })
    ).toEqual([])
  })

  it('returns Mentions from text', async () => {
    if (!actor1) fail('Actor1 is required')
    const mentions = await getMentions({
      text: '@llun@somewhere.test @test1@llun.test Test mentions',
      currentActor: actor1
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
    if (!actor1) fail('Actor1 is required')
    const mentions = await getMentions({
      text: '@test2 Hello',
      currentActor: actor1
    })
    expect(mentions).toContainValue({
      type: 'Mention',
      href: actor2?.id,
      name: `@test2`
    })
  })

  it('returns no mentions if it cannot fetch user', async () => {
    if (!actor1) fail('Actor1 is required')
    const mentions = await getMentions({
      text: '@notexist@else Hello',
      currentActor: actor1
    })
    expect(mentions).toHaveLength(0)
  })

  it('returns single mentions if mentions more than once', async () => {
    if (!actor1) fail('Actor1 is required')

    const mentions = await getMentions({
      text: '@llun@somewhere.test @llun@somewhere.test Test mentions',
      currentActor: actor1
    })
    expect(mentions).toHaveLength(1)
    expect(mentions).toContainValue({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
  })

  it('adds reply actor into mention', async () => {
    if (!actor1) fail('Actor1 is required')
    if (!actor2) fail('Actor2 is required')

    const status = await storage.getStatus({
      statusId: `${actor2.id}/statuses/post-2`
    })

    const mentions = await getMentions({
      text: '@llun@somewhere.test @llun@somewhere.test Test mentions',
      currentActor: actor1,
      replyStatus: status
    })
    expect(mentions).toHaveLength(2)
    expect(mentions).toContainValue({
      type: 'Mention',
      href: `https://somewhere.test/actors/llun`,
      name: '@llun@somewhere.test'
    })
    expect(mentions).toContainValue({
      type: 'Mention',
      href: actor2.id,
      name: actor2.getMention(true)
    })
  })
})
