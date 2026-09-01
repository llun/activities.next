import { enableFetchMocks } from 'jest-fetch-mock'

import { getActorCollections } from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { JOBS } from '@/lib/jobs'
import { followTimelineBackfillJob } from '@/lib/jobs/followTimelineBackfillJob'
import { FOLLOW_TIMELINE_BACKFILL_JOB_NAME } from '@/lib/jobs/names'
import { Timeline } from '@/lib/services/timelines/types'
import { mockRequests } from '@/lib/stub/activities'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))
vi.mock('@/lib/activities/getActorCollections', () => ({
  getActorCollections: vi.fn()
}))

describe('followTimelineBackfillJob', () => {
  const database = getTestSQLDatabase()
  let newcomerCounter = 0

  const createFollowedRemoteActor = async () => {
    newcomerCounter++
    const domain = `newcomer${newcomerCounter}.test`
    const actorId = `https://${domain}/users/alice`
    await database.createActor({
      actorId,
      username: 'alice',
      domain,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`,
      followersUrl: `${actorId}/followers`,
      publicKey: 'publicKey',
      createdAt: Date.now()
    })
    await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: actorId,
      status: FollowStatus.enum.Accepted,
      inbox: `${ACTOR1_ID}/inbox`,
      sharedInbox: TEST_SHARED_INBOX
    })
    vi.mocked(getActorPerson).mockResolvedValue({
      id: actorId,
      outbox: `${actorId}/outbox`
    } as never)
    return actorId
  }

  const outboxNote = (
    actorId: string,
    n: number,
    overrides: Record<string, unknown> = {}
  ) => ({
    id: `${actorId}/statuses/${n}`,
    type: 'Note',
    attributedTo: actorId,
    published: new Date(1700000000000 + n * 60_000).toISOString(),
    content: `<p>post ${n}</p>`,
    url: `${actorId}/statuses/${n}`,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`${actorId}/followers`],
    ...overrides
  })

  const outboxCreate = (note: Record<string, unknown>) => ({
    id: `${note.id}/activity`,
    type: 'Create',
    actor: note.attributedTo,
    published: note.published,
    to: note.to,
    cc: note.cc,
    object: note
  })

  const mockOutbox = (items: unknown[]) => {
    vi.mocked(getActorCollections).mockResolvedValue({
      page: {
        type: 'OrderedCollectionPage',
        orderedItems: items
      },
      totalItems: items.length
    } as never)
  }

  const storeNote = (
    actorId: string,
    n: number,
    overrides: Record<string, unknown> = {}
  ) =>
    database.createNote({
      id: `${actorId}/statuses/${n}`,
      url: `${actorId}/statuses/${n}`,
      actorId,
      text: `<p>post ${n}</p>`,
      summary: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${actorId}/followers`],
      reply: '',
      createdAt: 1700000000000 + n * 60_000,
      ...overrides
    })

  const runJob = (
    targetActorIdOrFollower: string,
    maybeTargetActorId?: string
  ) => {
    const actorId = maybeTargetActorId ? targetActorIdOrFollower : ACTOR1_ID
    const targetActorId = maybeTargetActorId ?? targetActorIdOrFollower
    return followTimelineBackfillJob(database, {
      id: 'backfill-job',
      name: FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
      data: { actorId, targetActorId }
    })
  }

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
    vi.mocked(getActorPerson).mockReset()
    vi.mocked(getActorCollections).mockReset()
  })

  it('registered', () => {
    expect(JOBS[FOLLOW_TIMELINE_BACKFILL_JOB_NAME]).toBe(
      followTimelineBackfillJob
    )
  })

  it('BACKFILL happy path: fresh remote actor with reply and parent note', async () => {
    const actorId = await createFollowedRemoteActor()
    const note1 = outboxNote(actorId, 1)
    const note2 = outboxNote(actorId, 2, { inReplyTo: note1.id })
    mockOutbox([outboxCreate(note2), outboxCreate(note1)])

    await runJob(actorId)

    expect(await database.getStatus({ statusId: note1.id })).toBeTruthy()
    expect(await database.getStatus({ statusId: note2.id })).toBeTruthy()

    const timeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    const ids = timeline.map((s) => s.id)
    expect(ids).toContain(note1.id)
    expect(ids).toContain(note2.id)
  })

  it('does not fetch once statuses exist', async () => {
    const actorId = await createFollowedRemoteActor()
    const note1 = outboxNote(actorId, 1)
    const note2 = outboxNote(actorId, 2, { inReplyTo: note1.id })
    mockOutbox([outboxCreate(note2), outboxCreate(note1)])

    await runJob(actorId)

    vi.mocked(getActorPerson).mockReset()
    vi.mocked(getActorCollections).mockReset()

    await runJob(actorId)

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(getActorCollections).not.toHaveBeenCalled()

    const timeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    const ids = timeline.map((s) => s.id)
    expect(ids.filter((id) => id === note1.id)).toHaveLength(1)
    expect(ids.filter((id) => id === note2.id)).toHaveLength(1)
  })

  it('forged attribution: drops note attributed to foreign actor', async () => {
    const actorId = await createFollowedRemoteActor()
    const genuine = outboxNote(actorId, 1)
    const forged = outboxNote('https://third.test/users/mallory', 2)
    mockOutbox([outboxCreate(forged), outboxCreate(genuine)])

    await runJob(actorId)

    expect(await database.getStatus({ statusId: genuine.id })).toBeTruthy()
    expect(await database.getStatus({ statusId: forged.id })).toBeNull()
  })

  it('announce skipped: does not store announced status', async () => {
    const actorId = await createFollowedRemoteActor()
    const note = outboxNote(actorId, 1)
    const announcedUrl = 'https://third.test/statuses/999'
    const announceItem = {
      id: `${actorId}/statuses/announce-1`,
      type: 'Announce',
      actor: actorId,
      published: new Date().toISOString(),
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${actorId}/followers`],
      object: announcedUrl
    }
    mockOutbox([announceItem, outboxCreate(note)])

    await runJob(actorId)

    expect(await database.getStatus({ statusId: note.id })).toBeTruthy()
    expect(await database.getStatus({ statusId: announcedUrl })).toBeNull()
  })

  it('followers-only skipped, unlisted kept', async () => {
    const actorId = await createFollowedRemoteActor()
    const followersOnly = outboxNote(actorId, 1, {
      to: [`${actorId}/followers`],
      cc: []
    })
    const unlisted = outboxNote(actorId, 2, {
      to: [`${actorId}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    const publicNote = outboxNote(actorId, 3)
    mockOutbox([
      outboxCreate(publicNote),
      outboxCreate(unlisted),
      outboxCreate(followersOnly)
    ])

    await runJob(actorId)

    expect(await database.getStatus({ statusId: followersOnly.id })).toBeNull()
    expect(await database.getStatus({ statusId: unlisted.id })).toBeTruthy()
    expect(await database.getStatus({ statusId: publicNote.id })).toBeTruthy()
  })

  it('caps backfill at 20 statuses', async () => {
    const actorId = await createFollowedRemoteActor()
    const notes = Array.from({ length: 25 }, (_, i) =>
      outboxNote(actorId, i + 1)
    )
    const items = notes.map(outboxCreate).reverse()
    mockOutbox(items)

    await runJob(actorId)

    expect(
      await database.getStatus({ statusId: `${actorId}/statuses/25` })
    ).toBeTruthy()
    expect(
      await database.getStatus({ statusId: `${actorId}/statuses/6` })
    ).toBeTruthy()
    expect(
      await database.getStatus({ statusId: `${actorId}/statuses/5` })
    ).toBeNull()
  })

  it('resilience: ignores invalid or non-embedded items without throwing', async () => {
    const actorId = await createFollowedRemoteActor()
    const note = outboxNote(actorId, 1)
    mockOutbox([
      'https://ignored.test/url-only-item',
      { type: 'Create', actor: actorId, object: 'not-embedded' },
      outboxCreate(note)
    ])

    await expect(runJob(actorId)).resolves.not.toThrow()
    expect(await database.getStatus({ statusId: note.id })).toBeTruthy()
  })

  it('handles unavailable outbox gracefully', async () => {
    const actorId = await createFollowedRemoteActor()
    vi.mocked(getActorCollections).mockResolvedValue(null)

    await expect(runJob(actorId)).resolves.not.toThrow()
  })

  it('MERGE remote: merges stored statuses into follower timeline without fetching', async () => {
    const actorId = await createFollowedRemoteActor()
    const note = await storeNote(actorId, 1)
    vi.mocked(getActorPerson).mockReset()
    vi.mocked(getActorCollections).mockReset()

    await runJob(actorId)

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(getActorCollections).not.toHaveBeenCalled()

    const timeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    expect(timeline.map((s) => s.id)).toContain(note.id)
  })

  it('MERGE respects mainTimelineRule: drops replies with missing parents', async () => {
    const actorId = await createFollowedRemoteActor()
    const note = await storeNote(actorId, 1, {
      reply: 'https://missing.test/statuses/999'
    })

    await runJob(actorId)

    const timeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    expect(timeline.map((s) => s.id)).not.toContain(note.id)
  })

  it('MERGE skips direct status', async () => {
    const actorId = await createFollowedRemoteActor()
    const note = await storeNote(actorId, 1, {
      to: [ACTOR1_ID],
      cc: []
    })

    await runJob(actorId)

    const timeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    expect(timeline.map((s) => s.id)).not.toContain(note.id)
  })

  it('MERGE local target: merges stored note without network fetch', async () => {
    await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID,
      status: FollowStatus.enum.Accepted,
      inbox: `${ACTOR1_ID}/inbox`,
      sharedInbox: TEST_SHARED_INBOX
    })
    const note = await storeNote(ACTOR2_ID, 901)
    vi.mocked(getActorPerson).mockReset()

    await runJob(ACTOR1_ID, ACTOR2_ID)

    expect(getActorPerson).not.toHaveBeenCalled()
    const timeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    expect(timeline.map((s) => s.id)).toContain(note.id)
  })

  it('MERGE is idempotent: running twice creates single timeline entry', async () => {
    const actorId = await createFollowedRemoteActor()
    const note = await storeNote(actorId, 1)

    await runJob(actorId)
    await runJob(actorId)

    const timeline = await database.getTimeline({
      timeline: Timeline.MAIN,
      actorId: ACTOR1_ID
    })
    const ids = timeline.map((s) => s.id)
    expect(ids.filter((id) => id === note.id)).toHaveLength(1)
  })
})
