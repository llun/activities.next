import { recordActorIfNeeded } from '@/lib/actions/utils'
import { follow } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { ingestCollectionMemberJob } from '@/lib/jobs/ingestCollectionMemberJob'
import { INGEST_COLLECTION_MEMBER_JOB_NAME } from '@/lib/jobs/names'
import { getFederationSigningActorId } from '@/lib/services/federation/instanceActor'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'

vi.mock('@/lib/activities', () => ({
  follow: vi.fn()
}))
vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))
vi.mock('@/lib/activities/getActorPosts', () => ({
  getActorPosts: vi.fn()
}))
vi.mock('@/lib/actions/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/actions/utils')>()),
  recordActorIfNeeded: vi.fn()
}))

const mockFollow = follow as jest.MockedFunction<typeof follow>
const mockGetActorPerson = getActorPerson as jest.MockedFunction<
  typeof getActorPerson
>
const mockGetActorPosts = getActorPosts as jest.MockedFunction<
  typeof getActorPosts
>
const mockRecordActorIfNeeded = recordActorIfNeeded as jest.MockedFunction<
  typeof recordActorIfNeeded
>

// Minimal Note-shaped status the job persists. Only the fields the job reads
// are meaningful; the rest are filler to satisfy the union type.
const noteStatus = (overrides: Partial<Status>): Status =>
  ({
    type: StatusType.enum.Note,
    id: `${EXTERNAL_ACTOR1}/statuses/1`,
    actorId: EXTERNAL_ACTOR1,
    actor: null,
    url: `${EXTERNAL_ACTOR1}/statuses/1`,
    text: 'hello world',
    summary: null,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    reply: '',
    edits: [],
    replies: [],
    isLocalActor: false,
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }) as Status

describe('ingestCollectionMemberJob', () => {
  const database = getTestSQLDatabase()
  let signingActorId: string

  const runJob = (memberActorId: string) =>
    ingestCollectionMemberJob(database, {
      id: 'ingest-job',
      name: INGEST_COLLECTION_MEMBER_JOB_NAME,
      data: { memberActorId }
    })

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    // Bootstraps (and persists) the headless instance actor at TEST_DOMAIN.
    await database.getFederationSigningActor()
    signingActorId = getFederationSigningActorId(TEST_DOMAIN)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    mockFollow.mockReset().mockResolvedValue(true)
    mockGetActorPerson
      .mockReset()
      .mockResolvedValue({ id: EXTERNAL_ACTOR1 } as never)
    mockGetActorPosts.mockReset().mockResolvedValue({
      statusesCount: 0,
      statuses: [],
      nextPageUrl: null,
      prevPageUrl: null
    })
    mockRecordActorIfNeeded
      .mockReset()
      .mockResolvedValue({ id: EXTERNAL_ACTOR1 } as never)
  })

  it('follows a newly-added remote member and backfills their notes', async () => {
    const statusId = `${EXTERNAL_ACTOR1}/statuses/backfill-1`
    mockGetActorPosts.mockResolvedValue({
      statusesCount: 1,
      statuses: [noteStatus({ id: statusId, url: statusId })],
      nextPageUrl: null,
      prevPageUrl: null
    })

    await runJob(EXTERNAL_ACTOR1)

    expect(mockFollow).toHaveBeenCalledTimes(1)
    const createdFollow = await database.getAcceptedOrRequestedFollow({
      actorId: signingActorId,
      targetActorId: EXTERNAL_ACTOR1
    })
    expect(createdFollow).toMatchObject({
      actorId: signingActorId,
      targetActorId: EXTERNAL_ACTOR1,
      status: FollowStatus.enum.Requested
    })

    const backfilled = await database.getStatus({ statusId })
    expect(backfilled).toMatchObject({ id: statusId, text: 'hello world' })
  })

  it('is a no-op for a local member (no follow, no backfill)', async () => {
    const localMember = `https://${TEST_DOMAIN}/users/localUser`

    await runJob(localMember)

    expect(mockFollow).not.toHaveBeenCalled()
    expect(mockGetActorPosts).not.toHaveBeenCalled()
  })

  it('does not follow when there is no federation signing actor', async () => {
    const freshDatabase = getTestSQLDatabase()
    await freshDatabase.migrate()
    await seedDatabase(freshDatabase)
    try {
      vi.spyOn(freshDatabase, 'getFederationSigningActor').mockResolvedValue(
        null
      )

      await ingestCollectionMemberJob(freshDatabase, {
        id: 'ingest-job',
        name: INGEST_COLLECTION_MEMBER_JOB_NAME,
        data: { memberActorId: EXTERNAL_ACTOR1 }
      })

      expect(mockFollow).not.toHaveBeenCalled()
    } finally {
      await freshDatabase.destroy()
    }
  })

  it("surfaces a backfilled note in the owner's collection feed", async () => {
    // Isolated DB so this test's follow/collection state can't collide with the
    // shared-DB cases above (an existing follow would short-circuit the job).
    const freshDatabase = getTestSQLDatabase()
    await freshDatabase.migrate()
    await seedDatabase(freshDatabase)
    try {
      await freshDatabase.getFederationSigningActor()
      // A distinct remote member at its own host, recorded so createNote can
      // resolve the author.
      const memberActorId = 'https://remote.example/users/curated'
      await freshDatabase.createActor({
        actorId: memberActorId,
        username: 'curated',
        domain: 'remote.example',
        inboxUrl: `${memberActorId}/inbox`,
        sharedInboxUrl: 'https://remote.example/inbox',
        followersUrl: `${memberActorId}/followers`,
        publicKey: 'publicKey',
        createdAt: Date.now()
      })
      mockGetActorPerson.mockResolvedValue({ id: memberActorId } as never)
      mockRecordActorIfNeeded.mockResolvedValue({ id: memberActorId } as never)

      const collection = await freshDatabase.createCollection({
        actorId: ACTOR1_ID,
        title: 'Curated people',
        publicFeed: true
      })
      await freshDatabase.addCollectionMembers({
        id: collection.id,
        actorId: ACTOR1_ID,
        targetActorIds: [memberActorId]
      })

      const statusId = 'https://remote.example/users/curated/statuses/1'
      mockGetActorPosts.mockResolvedValue({
        statusesCount: 1,
        statuses: [
          noteStatus({ id: statusId, url: statusId, actorId: memberActorId })
        ],
        nextPageUrl: null,
        prevPageUrl: null
      })

      await ingestCollectionMemberJob(freshDatabase, {
        id: 'ingest-job',
        name: INGEST_COLLECTION_MEMBER_JOB_NAME,
        data: { memberActorId }
      })

      const ownerFeed = await freshDatabase.getCollectionTimeline({
        id: collection.id,
        actorId: ACTOR1_ID,
        projection: 'owner'
      })
      expect(ownerFeed.map((status) => status.id)).toContain(statusId)
    } finally {
      await freshDatabase.destroy()
    }
  })

  it('skips a member the instance actor already follows', async () => {
    // Pre-create the follow so the idempotency guard short-circuits.
    await database.createFollow({
      actorId: signingActorId,
      targetActorId: EXTERNAL_ACTOR1,
      status: FollowStatus.enum.Accepted,
      inbox: `${signingActorId}/inbox`,
      sharedInbox: `https://${TEST_DOMAIN}/inbox`
    })

    await runJob(EXTERNAL_ACTOR1)

    expect(mockFollow).not.toHaveBeenCalled()
    expect(mockGetActorPosts).not.toHaveBeenCalled()
  })
})
