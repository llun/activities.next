import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { ACTOR2_ID } from '../stub/seed/actor2'
import { ACTOR3_ID } from '../stub/seed/actor3'
import { seedStorage } from '../stub/storage'
import { mainTimelineRule } from './main'
import { Timeline } from './types'

describe('#mainTimelineRule', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns main timeline name for the currentActor status', async () => {
    const actor = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await storage.createNote({
      id: `${ACTOR3_ID}/statuses/post-1`,
      url: `${ACTOR3_ID}/statuses/post-1`,
      actorId: ACTOR3_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor?.followersUrl],
      text: 'This is self status'
    })
    expect(
      await mainTimelineRule({ storage, currentActor: actor, status })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for the non-following actor', async () => {
    const actor = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = (await storage.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status
    expect(
      await mainTimelineRule({ storage, currentActor: actor, status })
    ).toBeNull()
  })

  it('returns main timeline for following actor status', async () => {
    const actor = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await storage.createNote({
      id: `${ACTOR2_ID}/statuses/to-followers`,
      url: `${ACTOR2_ID}/statuses/to-followers`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor?.followersUrl],
      text: 'This is for following status'
    })
    expect(
      await mainTimelineRule({ storage, currentActor: actor, status })
    ).toEqual(Timeline.MAIN)
  })
})
