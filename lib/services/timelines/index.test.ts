import { randomBytes } from 'crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_FOLLOWER_URL, ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_FOLLOWERS
} from '@/lib/stub/seed/external1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { addStatusToTimelines } from '.'
import { Timeline } from './types'

describe('addStatusToTimelines', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  test('it adds status to local users main timeline', async () => {
    const id = randomBytes(16).toString('hex')
    const status = await database.createNote({
      id: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      url: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      actorId: EXTERNAL_ACTOR1,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [EXTERNAL_ACTOR1_FOLLOWERS],
      text: 'message to followers'
    })
    await addStatusToTimelines(database, status)
    const mainTimeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    expect(mainTimeline).toHaveLength(1)
  })

  test('it adds announce to main timeline for following local actor', async () => {
    // Actor3 follows Actor2. Announce from Actor2 of Actor1/post-1 (Actor3 doesn't
    // follow Actor1, so the original is not already in Actor3's main timeline).
    const id = randomBytes(16).toString('hex')
    const announce = await database.createAnnounce({
      id: `${ACTOR2_ID}/statuses/${id}/activity`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR2_FOLLOWER_URL],
      originalStatusId: `${ACTOR1_ID}/statuses/post-1`
    })
    if (!announce) fail('Announce must be defined')
    await addStatusToTimelines(database, announce)

    const mainTimeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR3_ID
    })
    expect(mainTimeline.some((s) => s.id === announce.id)).toBe(true)
  })

  test('it creates a mention notification for the mentioned actor', async () => {
    // External actor mentions Actor3 directly. Actor3 is in `to` so it is
    // discovered as a local recipient and the mention tag triggers the
    // remote reply/mention notification side effect (the mention timeline
    // itself was removed).
    const id = randomBytes(16).toString('hex')
    const status = await database.createNote({
      id: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      url: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      actorId: EXTERNAL_ACTOR1,
      to: [ACTOR3_ID],
      cc: [EXTERNAL_ACTOR1_FOLLOWERS],
      text: 'Hello @test3@llun.test'
    })
    await database.createTag({
      statusId: status.id,
      name: '@test3',
      value: ACTOR3_ID,
      type: 'mention'
    })
    await addStatusToTimelines(database, status)

    const notifications = await database.getNotifications({
      actorId: ACTOR3_ID,
      limit: 100
    })
    const mentionNotification = notifications.find(
      (notification) => notification.statusId === status.id
    )
    expect(mentionNotification).toBeDefined()
    expect(mentionNotification?.type).toBe('mention')
    expect(mentionNotification?.sourceActorId).toBe(EXTERNAL_ACTOR1)
  })

  test('it routes direct statuses only to the direct timeline', async () => {
    const id = randomBytes(16).toString('hex')
    const status = await database.createNote({
      id: `${ACTOR2_ID}/statuses/direct-${id}`,
      url: `${ACTOR2_ID}/statuses/direct-${id}`,
      actorId: ACTOR2_ID,
      to: [ACTOR1_ID],
      cc: [],
      text: 'direct timeline message @test1@llun.test'
    })
    await database.createTag({
      statusId: status.id,
      name: '@test1',
      value: ACTOR1_ID,
      type: 'mention'
    })
    await addStatusToTimelines(database, status)

    const directTimeline = await database.getTimeline({
      timeline: Timeline.DIRECT,
      actorId: ACTOR1_ID
    })
    const mainTimeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })

    expect(directTimeline.some((s) => s.id === status.id)).toBe(true)
    expect(mainTimeline.some((s) => s.id === status.id)).toBe(false)
  })

  test('it skips timelines when recipient blocks the status actor', async () => {
    await database.createBlock({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR2_ID,
      uri: `${ACTOR3_ID}#blocks/${randomBytes(8).toString('hex')}`
    })
    const id = randomBytes(16).toString('hex')
    const status = await database.createNote({
      id: `${ACTOR2_ID}/statuses/${id}`,
      url: `${ACTOR2_ID}/statuses/${id}`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR2_FOLLOWER_URL],
      text: 'blocked message'
    })

    await addStatusToTimelines(database, status)

    const mainTimeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR3_ID
    })
    expect(mainTimeline.some((s) => s.id === status.id)).toBe(false)
  })

  test('it skips direct conversation memberships when recipient blocks the sender', async () => {
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID,
      uri: `${ACTOR1_ID}#blocks/${randomBytes(8).toString('hex')}`
    })
    const id = randomBytes(16).toString('hex')
    const status = await database.createNote({
      id: `${ACTOR2_ID}/statuses/blocked-direct-${id}`,
      url: `${ACTOR2_ID}/statuses/blocked-direct-${id}`,
      actorId: ACTOR2_ID,
      to: [ACTOR1_ID],
      cc: [],
      text: 'direct to blocker @test1@llun.test'
    })
    await database.createTag({
      statusId: status.id,
      name: '@test1',
      value: ACTOR1_ID,
      type: 'mention'
    })

    await addStatusToTimelines(database, status)

    const recipientConversations = await database.getDirectConversations({
      actorId: ACTOR1_ID
    })
    expect(
      recipientConversations.some(
        (conversation) => conversation.lastStatus.id === status.id
      )
    ).toBe(false)
    const directTimeline = await database.getTimeline({
      timeline: Timeline.DIRECT,
      actorId: ACTOR1_ID
    })
    expect(directTimeline.some((s) => s.id === status.id)).toBe(false)
  })

  test('it still records the main timeline when the collection fan-out fails', async () => {
    const id = randomBytes(16).toString('hex')
    const status = await database.createNote({
      id: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      url: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      actorId: EXTERNAL_ACTOR1,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [EXTERNAL_ACTOR1_FOLLOWERS],
      text: 'message despite collection failure'
    })

    const collectionSpy = vi
      .spyOn(database, 'addStatusToCollectionTimelines')
      .mockRejectedValue(
        new Error('relation "collection_members" does not exist')
      )

    // A failure materializing the rebuildable collection feed must not abort
    // status creation and lose the post.
    await expect(
      addStatusToTimelines(database, status)
    ).resolves.toBeUndefined()
    expect(collectionSpy).toHaveBeenCalled()

    const mainTimeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    expect(mainTimeline.some((s) => s.id === status.id)).toBe(true)

    collectionSpy.mockRestore()
  })

  test('it still records the main timeline when the list fan-out fails', async () => {
    const id = randomBytes(16).toString('hex')
    const status = await database.createNote({
      id: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      url: `${EXTERNAL_ACTOR1}/statuses/${id}`,
      actorId: EXTERNAL_ACTOR1,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [EXTERNAL_ACTOR1_FOLLOWERS],
      text: 'message despite list failure'
    })

    const listSpy = vi
      .spyOn(database, 'addStatusToListTimelines')
      .mockRejectedValue(new Error('relation "list_timeline" does not exist'))

    await expect(
      addStatusToTimelines(database, status)
    ).resolves.toBeUndefined()
    expect(listSpy).toHaveBeenCalled()

    const mainTimeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    expect(mainTimeline.some((s) => s.id === status.id)).toBe(true)

    listSpy.mockRestore()
  })

  test('it skips timelines when a followed actor announces a blocked author', async () => {
    const id = randomBytes(16).toString('hex')
    const originalStatus = await database.createNote({
      id: `${ACTOR2_ID}/statuses/original-${id}`,
      url: `${ACTOR2_ID}/statuses/original-${id}`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR2_FOLLOWER_URL],
      text: 'blocked original'
    })
    const announce = await database.createAnnounce({
      id: `${ACTOR4_ID}/statuses/announce-${id}`,
      actorId: ACTOR4_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${ACTOR4_ID}/followers`],
      originalStatusId: originalStatus.id
    })
    if (!announce) fail('Announce must be defined')

    await addStatusToTimelines(database, announce)

    const mainTimeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR3_ID
    })
    expect(mainTimeline.some((s) => s.id === announce.id)).toBe(false)
  })
})
