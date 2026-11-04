import { NextRequest } from 'next/server'

import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { MAX_PINNED_STATUSES } from '@/lib/services/mastodon/constants'
import { type Actor } from '@/lib/types/domain/actor'
import { toActivityPubObject } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const ACTOR_ID = 'https://example.com/users/test'
const OTHER_ACTOR_ID = 'https://example.com/users/other'

const mockActor: Actor = {
  id: ACTOR_ID,
  username: 'test',
  domain: 'example.com',
  name: 'Test Actor',
  summary: '',
  followersUrl: `${ACTOR_ID}/followers`,
  inboxUrl: `${ACTOR_ID}/inbox`,
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}

let mockDatabase: ReturnType<typeof createTestDatabase>['database'] | null =
  null

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (
      handle: (...params: unknown[]) => Promise<Response> | Response,
      options?: { allowFederationSigningActor?: boolean }
    ) =>
    (req: NextRequest, query: unknown) => {
      if (!options?.allowFederationSigningActor) {
        return new Response(null, { status: 404 })
      }

      return handle(mockDatabase, mockActor, req, query)
    }
}))

const createRequest = () =>
  new NextRequest('https://example.com/api/users/test/collections/featured', {
    headers: {
      accept:
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    }
  })

describe('GET /api/users/[username]/collections/featured', () => {
  let testDb: ReturnType<typeof createTestDatabase>

  beforeEach(async () => {
    testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    mockDatabase = testDb.database

    await testDb.database.createActor({
      actorId: ACTOR_ID,
      username: 'test',
      domain: 'example.com',
      publicKey: 'public-key',
      privateKey: 'private-key',
      inboxUrl: `${ACTOR_ID}/inbox`,
      sharedInboxUrl: 'https://example.com/inbox',
      followersUrl: `${ACTOR_ID}/followers`,
      createdAt: 1
    })
    await testDb.database.createActor({
      actorId: OTHER_ACTOR_ID,
      username: 'other',
      domain: 'example.com',
      publicKey: 'other-public-key',
      privateKey: 'other-private-key',
      inboxUrl: `${OTHER_ACTOR_ID}/inbox`,
      sharedInboxUrl: 'https://example.com/inbox',
      followersUrl: `${OTHER_ACTOR_ID}/followers`,
      createdAt: 1
    })
  })

  afterEach(async () => {
    mockDatabase = null
    await testDb.destroy()
  })

  const setPinTime = async (
    actorId: string,
    statusId: string,
    pinnedAt: number
  ) => {
    await testDb.db
      .updateTable('status_pins')
      .set({
        createdAt: new Date(pinnedAt),
        updatedAt: new Date(pinnedAt)
      })
      .where('actorId', '=', actorId)
      .where('statusId', '=', statusId)
      .execute()
  }

  it('returns an empty ActivityPub featured collection with NOTE_ACTIVITY_CONTEXT when nothing is pinned', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ username: 'test' })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      '@context': NOTE_ACTIVITY_CONTEXT,
      id: `${ACTOR_ID}/collections/featured`,
      type: 'OrderedCollection',
      totalItems: 0,
      orderedItems: []
    })
  })

  it('returns pinned public and unlisted statuses as full objects newest pin first', async () => {
    const publicNoteId = `${ACTOR_ID}/statuses/public-note`
    const unlistedNoteId = `${ACTOR_ID}/statuses/unlisted-note`
    const publicPollId = `${ACTOR_ID}/statuses/public-poll`

    // Created in order publicNote -> unlistedNote -> publicPoll, but pinned in
    // order unlistedNote (oldest pin) -> publicNote -> publicPoll (newest pin)
    // so pin order differs from status creation order.
    await testDb.database.createNote({
      id: publicNoteId,
      url: publicNoteId,
      actorId: ACTOR_ID,
      text: '<p>Public pinned note</p>',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${ACTOR_ID}/followers`],
      createdAt: Date.UTC(2026, 0, 1)
    })
    await testDb.database.createNote({
      id: unlistedNoteId,
      url: unlistedNoteId,
      actorId: ACTOR_ID,
      text: '<p>Unlisted pinned note</p>',
      to: [`${ACTOR_ID}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC],
      createdAt: Date.UTC(2026, 0, 2)
    })
    await testDb.database.createPoll({
      id: publicPollId,
      url: publicPollId,
      actorId: ACTOR_ID,
      text: '<p>Pinned poll question</p>',
      choices: ['Option A', 'Option B'],
      endAt: Date.UTC(2026, 1, 1),
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${ACTOR_ID}/followers`],
      createdAt: Date.UTC(2026, 0, 3)
    })

    await testDb.database.pinStatus({
      actorId: ACTOR_ID,
      statusId: unlistedNoteId
    })
    await setPinTime(ACTOR_ID, unlistedNoteId, Date.UTC(2026, 0, 10, 1))

    await testDb.database.pinStatus({
      actorId: ACTOR_ID,
      statusId: publicNoteId
    })
    await setPinTime(ACTOR_ID, publicNoteId, Date.UTC(2026, 0, 10, 2))

    await testDb.database.pinStatus({
      actorId: ACTOR_ID,
      statusId: publicPollId
    })
    await setPinTime(ACTOR_ID, publicPollId, Date.UTC(2026, 0, 10, 3))

    const expectedStatuses = await testDb.database.getStatusesByIds({
      statusIds: [publicPollId, publicNoteId, unlistedNoteId],
      withReplies: false
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ username: 'test' })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      '@context': NOTE_ACTIVITY_CONTEXT,
      id: `${ACTOR_ID}/collections/featured`,
      type: 'OrderedCollection',
      totalItems: 3,
      orderedItems: expectedStatuses.map((status) =>
        toActivityPubObject(status)
      )
    })
    expect(
      data.orderedItems.map((item: { type: string }) => item.type)
    ).toEqual(['Question', 'Note', 'Note'])
  })

  it("excludes followers-only, direct, Announce, deleted, and other actors' pins", async () => {
    const publicNoteId = `${ACTOR_ID}/statuses/featured-public`
    const followersOnlyId = `${ACTOR_ID}/statuses/featured-followers`
    const directId = `${ACTOR_ID}/statuses/featured-direct`
    const deletedId = `${ACTOR_ID}/statuses/featured-deleted`
    const otherActorNoteId = `${OTHER_ACTOR_ID}/statuses/other-public`
    const announceId = `${ACTOR_ID}/statuses/featured-announce`

    await testDb.database.createNote({
      id: publicNoteId,
      url: publicNoteId,
      actorId: ACTOR_ID,
      text: '<p>Visible public pin</p>',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${ACTOR_ID}/followers`],
      createdAt: Date.UTC(2026, 0, 1)
    })
    await testDb.database.createNote({
      id: followersOnlyId,
      url: followersOnlyId,
      actorId: ACTOR_ID,
      text: '<p>Followers-only pin</p>',
      to: [`${ACTOR_ID}/followers`],
      cc: [],
      createdAt: Date.UTC(2026, 0, 2)
    })
    await testDb.database.createNote({
      id: directId,
      url: directId,
      actorId: ACTOR_ID,
      text: '<p>Direct pin</p>',
      to: [OTHER_ACTOR_ID],
      cc: [],
      createdAt: Date.UTC(2026, 0, 3)
    })
    await testDb.database.createNote({
      id: deletedId,
      url: deletedId,
      actorId: ACTOR_ID,
      text: '<p>Deleted pin</p>',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: Date.UTC(2026, 0, 4)
    })
    await testDb.database.createNote({
      id: otherActorNoteId,
      url: otherActorNoteId,
      actorId: OTHER_ACTOR_ID,
      text: '<p>Other actor public note</p>',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: Date.UTC(2026, 0, 5)
    })
    await testDb.database.createAnnounce({
      id: announceId,
      actorId: ACTOR_ID,
      originalStatusId: otherActorNoteId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: Date.UTC(2026, 0, 6)
    })

    for (const statusId of [
      publicNoteId,
      followersOnlyId,
      directId,
      deletedId,
      announceId,
      otherActorNoteId
    ]) {
      await testDb.database.pinStatus({ actorId: ACTOR_ID, statusId })
    }
    await testDb.database.pinStatus({
      actorId: OTHER_ACTOR_ID,
      statusId: otherActorNoteId
    })
    await testDb.database.deleteStatus({ statusId: deletedId })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ username: 'test' })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.orderedItems.map((item: { id: string }) => item.id)).toEqual([
      publicNoteId
    ])
    expect(data.totalItems).toBe(1)
    expect(data['@context']).toEqual(NOTE_ACTIVITY_CONTEXT)
  })

  it('bounds served items and totalItems to MAX_PINNED_STATUSES', async () => {
    const statusIds = Array.from(
      { length: MAX_PINNED_STATUSES + 2 },
      (_, index) => `${ACTOR_ID}/statuses/capped-pin-${index}`
    )

    for (const [index, statusId] of statusIds.entries()) {
      await testDb.database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR_ID,
        text: `<p>Pinned item ${index}</p>`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR_ID}/followers`],
        createdAt: Date.UTC(2026, 0, 1) + index * 1000
      })
      await testDb.database.pinStatus({ actorId: ACTOR_ID, statusId })
      await setPinTime(ACTOR_ID, statusId, Date.UTC(2026, 0, 10) + index * 1000)
    }

    const newestFollowersOnlyId = `${ACTOR_ID}/statuses/capped-followers-only`
    await testDb.database.createNote({
      id: newestFollowersOnlyId,
      url: newestFollowersOnlyId,
      actorId: ACTOR_ID,
      text: '<p>Newest followers-only pin</p>',
      to: [`${ACTOR_ID}/followers`],
      cc: [],
      createdAt: Date.UTC(2026, 0, 2)
    })
    await testDb.database.pinStatus({
      actorId: ACTOR_ID,
      statusId: newestFollowersOnlyId
    })
    await setPinTime(ACTOR_ID, newestFollowersOnlyId, Date.UTC(2026, 0, 11))

    const response = await GET(createRequest(), {
      params: Promise.resolve({ username: 'test' })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.totalItems).toBe(MAX_PINNED_STATUSES)
    expect(data.orderedItems.map((item: { id: string }) => item.id)).toEqual(
      [...statusIds].reverse().slice(0, MAX_PINNED_STATUSES)
    )
  })
})
