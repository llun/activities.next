import { backfillListTimelineForMembers } from '@/lib/database/sql/list'
import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Small constants so the cap and the page boundary are reachable with a handful
// of rows; the production values only differ in size.
vi.mock('@/lib/services/timelines/types', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/services/timelines/types')>()
  return {
    ...actual,
    LIST_MEMBER_BACKFILL_MAX_POSTS: 7,
    LIST_MEMBER_BACKFILL_BATCH_SIZE: 3
  }
})

describe('backfillListTimelineForMembers member cap', () => {
  const { database, instance } = getTestSQLDatabaseWithInstance()

  const localActor = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: 'hash',
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    const actor = await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })
    if (!actor) throw new Error(`${username} not created`)
    return actor
  }

  const createNotes = async (
    actorId: string,
    prefix: string,
    count: number,
    timestampOf: (index: number) => number
  ) => {
    const ids: string[] = []
    for (let index = 0; index < count; index++) {
      const id = `${actorId}/statuses/${prefix}-${String(index).padStart(2, '0')}`
      await database.createNote({
        id,
        url: id,
        actorId,
        text: id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: timestampOf(index)
      })
      ids.push(id)
    }
    return ids
  }

  const storedStatusIds = async (ownerId: string, listId: string) => {
    const rows = await instance('timelines')
      .where({ actorId: ownerId, timeline: `list:${listId}` })
      .select('statusId')
    return rows.map((row) => row.statusId as string).sort()
  }

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('materializes only the newest posts of a member, paging through the rest', async () => {
    const owner = await localActor('backfill-owner')
    const member = await localActor('backfill-member')
    const startedAt = Date.UTC(2026, 0, 1)
    // 12 posts, pairs sharing a timestamp so the id tie-breaker is exercised
    // across a 3-row page boundary.
    const ids = await createNotes(
      member.id,
      'post',
      12,
      (index) => startedAt + Math.floor(index / 2) * 1000
    )

    await backfillListTimelineForMembers({
      database: instance,
      listId: 'cap-list',
      ownerId: owner.id,
      targetActorIds: [member.id]
    })

    // The seven newest (by createdAt, then id): no duplicates or gaps across
    // pages, and nothing older than the cap.
    expect(await storedStatusIds(owner.id, 'cap-list')).toEqual(
      ids.slice(-7).sort()
    )
  })

  it('backfills everything when the member has fewer posts than the cap', async () => {
    const owner = await localActor('backfill-owner-small')
    const member = await localActor('backfill-member-small')
    const ids = await createNotes(
      member.id,
      'small',
      4,
      (index) => Date.UTC(2026, 0, 1) + index * 1000
    )

    await backfillListTimelineForMembers({
      database: instance,
      listId: 'small-list',
      ownerId: owner.id,
      targetActorIds: [member.id]
    })

    expect(await storedStatusIds(owner.id, 'small-list')).toEqual(ids.sort())
  })
})
