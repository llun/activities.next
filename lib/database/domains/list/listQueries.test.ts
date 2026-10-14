import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import { getMastodonActors } from '@/lib/database/domains/actor/mastodon'
import {
  type ListStatusSource,
  addListAccounts,
  addStatusToListTimelines,
  backfillListTimelineForMembers,
  createList,
  deleteList,
  getList,
  getListAccountCounts,
  getListAccounts,
  getListTimeline,
  getLists,
  getListsWithAccount,
  removeListAccounts,
  updateList
} from '@/lib/database/domains/list/queries'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { listTimelineKey } from '@/lib/services/timelines/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import { type Status, StatusType } from '@/lib/types/domain/status'
import type * as Mastodon from '@/lib/types/mastodon'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Accounts that echo the ids they are asked for, in order.
vi.mock('@/lib/database/domains/actor/mastodon', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/database/domains/actor/mastodon')
  >()),
  getMastodonActors: vi.fn(async (_db: unknown, actorIds: string[]) =>
    actorIds.map((id) => ({ id }) as unknown as Mastodon.Account)
  )
}))

// Small backfill caps so the owner's and a member's caps, and a member's page
// boundary, are reachable with a handful of rows.
vi.mock('@/lib/services/timelines/types', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/services/timelines/types')>()
  return {
    ...actual,
    LIST_OWNER_BACKFILL_MAX_POSTS: 3,
    LIST_MEMBER_BACKFILL_MAX_POSTS: 5,
    LIST_MEMBER_BACKFILL_BATCH_SIZE: 2
  }
})

// Query-level tests for the list domain. Every test uses its own actors and
// lists (a fresh prefix) and puts neighbouring rows next to the ones under
// test — another owner's lists and feed rows, another list of the same owner,
// the owner's home feed — so a dropped predicate shows up as a wrong row. Ids
// that tie on createdAt differ only in a trailing digit, so they sort the same
// under any collation. Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const db = testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
})

afterAll(async () => {
  await testDb.destroy()
})

let prefixCount = 0
const nextPrefix = () => `lq${++prefixCount}`
const BASE = Date.UTC(2026, 0, 1)
const actorIn = (domain: string, name: string) =>
  `https://${domain}/users/${name}`
const { Accepted, Requested } = FollowStatus.enum

// A status facade that echoes what it is asked for, in order.
const statusCalls: [string[], string | undefined][] = []
const statusesSource: ListStatusSource = async (statusIds, currentActorId) => {
  statusCalls.push([statusIds, currentActorId])
  return statusIds.map((id) => ({ id }) as unknown as Status)
}

const seedList = async ({
  id,
  actorId,
  createdAt = BASE,
  repliesPolicy = 'list'
}: {
  id: string
  actorId: string
  createdAt?: number | null
  repliesPolicy?: string
}) => {
  const at = createdAt === null ? null : new Date(createdAt)
  await db
    .insertInto('lists')
    .values({
      id,
      actorId,
      title: `title ${id}`,
      repliesPolicy,
      exclusive: false,
      createdAt: at,
      updatedAt: at
    })
    .execute()
}

const seedMembership = async ({
  id = randomUUID(),
  listId,
  actorId,
  targetActorId,
  createdAt = BASE
}: {
  id?: string
  listId: string
  actorId: string
  targetActorId: string
  createdAt?: number | null
}) => {
  await db
    .insertInto('list_accounts')
    .values({
      id,
      listId,
      actorId,
      targetActorId,
      createdAt: createdAt === null ? null : new Date(createdAt)
    })
    .execute()
  return id
}

const seedStatus = async ({
  id,
  actorId,
  createdAt = BASE,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  reply = '',
  type = StatusType.enum.Note,
  originalStatusId = null
}: {
  id: string
  actorId: string
  createdAt?: number | null
  to?: string[]
  cc?: string[]
  reply?: string | null
  type?: StatusType
  originalStatusId?: string | null
}) => {
  const at = createdAt === null ? null : new Date(createdAt)
  await db
    .insertInto('statuses')
    .values({
      id,
      url: id,
      urlHash: getHashFromString(id),
      actorId,
      type,
      reply,
      replyHash: reply ? getHashFromString(reply) : null,
      originalStatusId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  const recipients = [
    ...to.map((actorId) => ({ actorId, type: 'to' })),
    ...cc.map((actorId) => ({ actorId, type: 'cc' }))
  ]
  if (recipients.length > 0) {
    await db
      .insertInto('recipients')
      .values(
        recipients.map((recipient) => ({
          id: randomUUID(),
          statusId: id,
          ...recipient
        }))
      )
      .execute()
  }
  return id
}

const seedTimelineRow = async ({
  actorId,
  timeline,
  statusId,
  statusActorId,
  createdAt = BASE
}: {
  actorId: string
  timeline: string
  statusId: string
  statusActorId: string
  createdAt?: number | null
}) => {
  const at = createdAt === null ? null : new Date(createdAt)
  await db
    .insertInto('timelines')
    .values({
      actorId,
      timeline,
      statusId,
      statusActorId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
}

const seedFollow = async (
  actorId: string,
  targetActorId: string,
  status: FollowStatus
) => {
  const now = new Date(BASE)
  await db
    .insertInto('follows')
    .values({
      id: randomUUID(),
      actorId,
      actorHost: new URL(actorId).host,
      targetActorId,
      targetActorHost: new URL(targetActorId).host,
      status,
      inbox: `${actorId}/inbox`,
      createdAt: now,
      updatedAt: now
    })
    .execute()
}

const membersOf = async (listId: string) =>
  (
    await db
      .selectFrom('list_accounts')
      .select(['actorId', 'targetActorId'])
      .where('listId', '=', listId)
      .execute()
  )
    .map((row) => `${row.actorId}>${row.targetActorId}`)
    .sort()

const feedOf = async (actorId: string) =>
  (
    await db
      .selectFrom('timelines')
      .select(['timeline', 'statusId'])
      .where('actorId', '=', actorId)
      .execute()
  )
    .map((row) => `${row.timeline}>${row.statusId}`)
    .sort()

const listRow = (id: string) =>
  db.selectFrom('lists').selectAll().where('id', '=', id).executeTakeFirst()

describe('list rows', () => {
  it('creates a list with the defaults and reads it back', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const list = await createList(db, { actorId: owner, title: 'Friends' })
    expect(list).toEqual({
      id: expect.any(String),
      actorId: owner,
      title: 'Friends',
      repliesPolicy: 'list',
      exclusive: false,
      createdAt: expect.any(Number),
      updatedAt: list.createdAt
    })
    expect(await getList(db, { id: list.id, actorId: owner })).toEqual(list)

    const custom = await createList(db, {
      actorId: owner,
      title: 'Custom',
      repliesPolicy: 'none',
      exclusive: true
    })
    expect(await getList(db, { id: custom.id, actorId: owner })).toMatchObject({
      repliesPolicy: 'none',
      exclusive: true
    })
  })

  it('reads a list only for its owner, and the owner’s lists oldest first', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    await seedList({
      id: `${prefix}-b`,
      actorId: owner,
      createdAt: BASE + 2000
    })
    await seedList({
      id: `${prefix}-a`,
      actorId: owner,
      createdAt: BASE + 1000
    })
    await seedList({ id: `${prefix}-c`, actorId: other, createdAt: BASE })

    expect(await getList(db, { id: `${prefix}-c`, actorId: owner })).toBeNull()
    expect(
      (await getLists(db, { actorId: owner })).map((list) => list.id)
    ).toEqual([`${prefix}-a`, `${prefix}-b`])
  })

  it('reads a NULL timestamp as 0', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    await seedList({ id: `${prefix}-a`, actorId: owner, createdAt: null })
    expect(
      await getList(db, { id: `${prefix}-a`, actorId: owner })
    ).toMatchObject({ createdAt: 0, updatedAt: 0 })
  })

  it('updates only the given fields of the owner’s list', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    await seedList({ id: `${prefix}-a`, actorId: owner })
    await seedList({ id: `${prefix}-b`, actorId: owner })

    const updated = await updateList(db, {
      id: `${prefix}-a`,
      actorId: owner,
      repliesPolicy: 'followed'
    })
    expect(updated).toMatchObject({
      id: `${prefix}-a`,
      title: `title ${prefix}-a`,
      repliesPolicy: 'followed',
      exclusive: false
    })
    expect(updated?.updatedAt).toBeGreaterThan(BASE)
    await updateList(db, {
      id: `${prefix}-a`,
      actorId: owner,
      title: 'Renamed',
      exclusive: true
    })
    expect(await listRow(`${prefix}-a`)).toMatchObject({
      title: 'Renamed',
      repliesPolicy: 'followed',
      exclusive: true
    })
    expect(await listRow(`${prefix}-b`)).toMatchObject({
      title: `title ${prefix}-b`,
      updatedAt: BASE
    })

    expect(
      await updateList(db, { id: `${prefix}-b`, actorId: other, title: 'x' })
    ).toBeNull()
    expect((await listRow(`${prefix}-b`))?.title).toBe(`title ${prefix}-b`)
  })

  it('deletes the owner’s list with its members and its feed only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const member = actorIn('m.test', `${prefix}-member`)
    const doomed = `${prefix}-doomed`
    const kept = `${prefix}-kept`
    await seedList({ id: doomed, actorId: owner })
    await seedList({ id: kept, actorId: owner })
    await seedMembership({
      listId: doomed,
      actorId: owner,
      targetActorId: member
    })
    await seedMembership({
      listId: kept,
      actorId: owner,
      targetActorId: member
    })
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    for (const [actorId, timeline] of [
      [owner, listTimelineKey(doomed)],
      [owner, listTimelineKey(kept)],
      [owner, 'main'],
      [other, listTimelineKey(doomed)]
    ]) {
      await seedTimelineRow({
        actorId,
        timeline,
        statusId: post,
        statusActorId: member
      })
    }

    expect(await deleteList(db, { id: doomed, actorId: other })).toBe(false)
    expect(await listRow(doomed)).toBeDefined()
    expect(await membersOf(doomed)).toHaveLength(1)

    expect(await deleteList(db, { id: doomed, actorId: owner })).toBe(true)
    expect(await listRow(doomed)).toBeUndefined()
    expect(await listRow(kept)).toBeDefined()
    expect(await membersOf(doomed)).toEqual([])
    expect(await membersOf(kept)).toEqual([`${owner}>${member}`])
    expect(await feedOf(owner)).toEqual(
      [`${listTimelineKey(kept)}>${post}`, `main>${post}`].sort()
    )
    expect(await feedOf(other)).toEqual([`${listTimelineKey(doomed)}>${post}`])
  })
})

describe('getListAccounts', () => {
  // Members m1..m5 of one list, m2 and m3 added at the same time; neighbours:
  // a member of the owner's other list, and a row on the same list id under
  // another owner.
  const setup = async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const listId = `${prefix}-list`
    const otherList = `${prefix}-other-list`
    const times = [BASE, BASE + 1000, BASE + 1000, BASE + 2000, BASE + 3000]
    const ids: string[] = []
    const members: string[] = []
    for (const [index, createdAt] of times.entries()) {
      const member = actorIn('m.test', `${prefix}-member${index + 1}`)
      members.push(member)
      ids.push(
        await seedMembership({
          id: `${prefix}-m${index + 1}`,
          listId,
          actorId: owner,
          targetActorId: member,
          createdAt
        })
      )
    }
    const otherListRow = await seedMembership({
      id: `${prefix}-m6`,
      listId: otherList,
      actorId: owner,
      targetActorId: actorIn('m.test', `${prefix}-member6`),
      createdAt: BASE + 1500
    })
    const otherOwnerRow = await seedMembership({
      id: `${prefix}-m7`,
      listId,
      actorId: actorIn('home.test', `${prefix}-intruder`),
      targetActorId: actorIn('m.test', `${prefix}-member7`),
      createdAt: BASE + 1500
    })
    return { owner, listId, ids, members, otherListRow, otherOwnerRow }
  }

  it.each([
    { cursor: {}, limit: 40, expected: [5, 4, 3, 2, 1] },
    { cursor: {}, limit: 0, expected: [5, 4, 3, 2, 1] },
    { cursor: {}, limit: 2, expected: [5, 4] },
    { cursor: { maxId: 3 }, limit: 40, expected: [2, 1] },
    { cursor: { maxId: 4 }, limit: 2, expected: [3, 2] },
    { cursor: { sinceId: 2 }, limit: 40, expected: [5, 4, 3] },
    { cursor: { sinceId: 2 }, limit: 1, expected: [5] },
    { cursor: { minId: 2 }, limit: 2, expected: [4, 3] },
    { cursor: { minId: 1, maxId: 5 }, limit: 40, expected: [4, 3, 2] },
    { cursor: { sinceId: 1, maxId: 4 }, limit: 1, expected: [3] }
  ])(
    'pages on (createdAt, id) with $cursor and limit $limit',
    async ({ cursor, limit, expected }) => {
      const s = await setup()
      vi.mocked(getMastodonActors).mockClear()
      const page = await getListAccounts(db, {
        listId: s.listId,
        actorId: s.owner,
        limit,
        ...Object.fromEntries(
          Object.entries(cursor).map(([key, index]) => [key, s.ids[index - 1]])
        )
      })
      expect(page.accounts.map((account) => account.id)).toEqual(
        expected.map((index) => s.members[index - 1])
      )
      // Hydrated once, on the page's rows in page order.
      expect(getMastodonActors).toHaveBeenCalledTimes(1)
      expect(getMastodonActors).toHaveBeenCalledWith(
        db,
        expected.map((index) => s.members[index - 1])
      )
      expect(page.prevMinId).toBe(s.ids[expected[0] - 1])
      expect(page.nextMaxId).toBe(s.ids[expected[expected.length - 1] - 1])
    }
  )

  it('ends with an empty page on an unknown or foreign cursor, and reads nothing of another owner', async () => {
    const s = await setup()
    const empty = { accounts: [], nextMaxId: null, prevMinId: null }
    for (const cursor of [
      { maxId: `${s.ids[0]}-missing` },
      { sinceId: s.otherListRow },
      { minId: s.otherOwnerRow }
    ]) {
      expect(
        await getListAccounts(db, {
          listId: s.listId,
          actorId: s.owner,
          ...cursor
        })
      ).toEqual(empty)
    }
    expect(
      await getListAccounts(db, {
        listId: `${s.listId}-none`,
        actorId: s.owner
      })
    ).toEqual(empty)
  })

  it('pages members without a createdAt on their id only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const listId = `${prefix}-list`
    const members: string[] = []
    const ids: string[] = []
    for (const index of [1, 2, 3]) {
      const member = actorIn('m.test', `${prefix}-member${index}`)
      members.push(member)
      ids.push(
        await seedMembership({
          id: `${prefix}-n${index}`,
          listId,
          actorId: owner,
          targetActorId: member,
          createdAt: null
        })
      )
    }
    await seedMembership({
      id: `${prefix}-n4`,
      listId,
      actorId: owner,
      targetActorId: actorIn('m.test', `${prefix}-member4`),
      createdAt: BASE
    })
    const page = async (cursor: Record<string, string>) =>
      (
        await getListAccounts(db, {
          listId,
          actorId: owner,
          ...cursor
        })
      ).accounts.map((account) => account.id)
    expect(await page({ maxId: ids[1] })).toEqual([members[0]])
    expect(await page({ sinceId: ids[1] })).toEqual([members[2]])
    expect(await page({ minId: ids[0] })).toEqual([members[2], members[1]])
  })
})

describe('getListAccountCounts', () => {
  it('counts the owner’s members of each requested list, 0 for an empty one', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const [a, b, empty, unasked] = ['a', 'b', 'empty', 'unasked'].map(
      (name) => `${prefix}-${name}`
    )
    for (const [listId, count] of [
      [a, 3],
      [b, 1],
      [unasked, 2]
    ] as const) {
      for (let index = 0; index < count; index++) {
        await seedMembership({
          listId,
          actorId: owner,
          targetActorId: actorIn('m.test', `${prefix}-${listId}-${index}`)
        })
      }
    }
    await seedMembership({
      listId: a,
      actorId: actorIn('home.test', `${prefix}-intruder`),
      targetActorId: actorIn('m.test', `${prefix}-intruder-member`)
    })

    expect(
      await getListAccountCounts(db, { actorId: owner, listIds: [a, b, empty] })
    ).toEqual({ [a]: 3, [b]: 1, [empty]: 0 })
    expect(
      await getListAccountCounts(db, { actorId: owner, listIds: [] })
    ).toEqual({})
    // More list ids than one statement may bind on SQLite.
    const many = Array.from(
      { length: 1200 },
      (_, index) => `${prefix}-x${index}`
    )
    const counts = await getListAccountCounts(db, {
      actorId: owner,
      listIds: [...many, a]
    })
    expect(Object.keys(counts)).toHaveLength(1201)
    expect(counts[a]).toBe(3)
  })
})

describe('getListsWithAccount', () => {
  it('returns the owner’s lists holding the account, oldest first', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const member = actorIn('m.test', `${prefix}-member`)
    await seedList({
      id: `${prefix}-b`,
      actorId: owner,
      createdAt: BASE + 2000
    })
    await seedList({
      id: `${prefix}-a`,
      actorId: owner,
      createdAt: BASE + 1000
    })
    await seedList({ id: `${prefix}-c`, actorId: owner, createdAt: BASE })
    await seedList({ id: `${prefix}-d`, actorId: other, createdAt: BASE })
    for (const listId of [`${prefix}-a`, `${prefix}-b`]) {
      await seedMembership({ listId, actorId: owner, targetActorId: member })
    }
    await seedMembership({
      listId: `${prefix}-c`,
      actorId: owner,
      targetActorId: actorIn('m.test', `${prefix}-someone`)
    })
    await seedMembership({
      listId: `${prefix}-d`,
      actorId: other,
      targetActorId: member
    })
    expect(
      (
        await getListsWithAccount(db, { actorId: owner, targetActorId: member })
      ).map((list) => list.id)
    ).toEqual([`${prefix}-a`, `${prefix}-b`])
  })
})

describe('addListAccounts', () => {
  it('adds the members once and backfills their posts, not a pending member’s', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const followed = actorIn('m.test', `${prefix}-followed`)
    const pending = actorIn('m.test', `${prefix}-pending`)
    const listId = `${prefix}-list`
    await seedFollow(owner, followed, Accepted)
    await seedFollow(owner, pending, Requested)
    const followedPost = await seedStatus({
      id: `${followed}/statuses/1`,
      actorId: followed
    })
    await seedStatus({ id: `${pending}/statuses/1`, actorId: pending })

    expect(
      await addListAccounts(db, {
        listId,
        actorId: owner,
        targetActorIds: [followed, pending, followed]
      })
    ).toEqual({ unrelatedActorIds: [] })
    await addListAccounts(db, {
      listId,
      actorId: owner,
      targetActorIds: [followed]
    })
    expect(await membersOf(listId)).toEqual(
      [`${owner}>${followed}`, `${owner}>${pending}`].sort()
    )
    expect(await feedOf(owner)).toEqual([
      `${listTimelineKey(listId)}>${followedPost}`
    ])
    expect(
      await addListAccounts(db, { listId, actorId: owner, targetActorIds: [] })
    ).toEqual({ unrelatedActorIds: [] })
  })

  it('with requireFollowOrRequest adds nobody when one account is unrelated', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const followed = actorIn('m.test', `${prefix}-followed`)
    const requested = actorIn('m.test', `${prefix}-requested`)
    const unrelated = actorIn('m.test', `${prefix}-unrelated`)
    const listId = `${prefix}-list`
    await seedFollow(owner, followed, Accepted)
    await seedFollow(owner, requested, Requested)
    await seedFollow(
      actorIn('home.test', `${prefix}-other`),
      unrelated,
      Accepted
    )

    expect(
      await addListAccounts(db, {
        listId,
        actorId: owner,
        targetActorIds: [followed, unrelated, unrelated],
        requireFollowOrRequest: true
      })
    ).toEqual({ unrelatedActorIds: [unrelated] })
    expect(await membersOf(listId)).toEqual([])

    expect(
      await addListAccounts(db, {
        listId,
        actorId: owner,
        targetActorIds: [owner, followed, requested],
        requireFollowOrRequest: true
      })
    ).toEqual({ unrelatedActorIds: [] })
    expect(await membersOf(listId)).toHaveLength(3)
  })

  it('backfills a member’s posts that have no createdAt, and writes their feed rows without one', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    const undated: string[] = []
    for (const number of [1, 2, 3]) {
      undated.push(
        await seedStatus({
          id: `${member}/statuses/n${number}`,
          actorId: member,
          createdAt: null
        })
      )
    }
    const dated = await seedStatus({
      id: `${member}/statuses/d1`,
      actorId: member,
      createdAt: BASE
    })

    // The old backfill threw a TypeError on the first such post and rolled the
    // whole call back, the membership included.
    expect(
      await addListAccounts(db, {
        listId,
        actorId: owner,
        targetActorIds: [member]
      })
    ).toEqual({ unrelatedActorIds: [] })
    expect(await membersOf(listId)).toEqual([`${owner}>${member}`])

    // The backfill cursor compares the NULL createdAt. SQLite sorts NULL last
    // under DESC: the first page is the dated post and n3, and the cursor
    // (NULL, n3) goes on through n2 and n1, so all four are written. PostgreSQL
    // sorts NULL first: the first page is n3 and n2, and the cursor (NULL, n2)
    // only continues through NULL rows, so n1 is the last and the dated post is
    // never reached.
    const written = testDb.backend === 'pg' ? undated : [...undated, dated]
    expect(await feedOf(owner)).toEqual(
      written.map((id) => `${listTimelineKey(listId)}>${id}`).sort()
    )
    // A NULL stays NULL in the feed row, not 1970.
    const rows = await db
      .selectFrom('timelines')
      .select(['statusId', 'createdAt'])
      .where('actorId', '=', owner)
      .execute()
    expect(rows).toHaveLength(written.length)
    for (const row of rows) {
      expect(row.createdAt).toBe(row.statusId === dated ? BASE : null)
    }
  })
})

describe('backfillListTimelineForMembers', () => {
  it('backfills the owner’s newest list-eligible posts up to the owner cap', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const listId = `${prefix}-list`
    const posts: string[] = []
    // p1 and p2 share a timestamp across the cap: the newer id wins.
    for (const [index, createdAt] of [
      BASE + 1000,
      BASE + 1000,
      BASE + 2000,
      BASE + 3000
    ].entries()) {
      posts.push(
        await seedStatus({
          id: `${owner}/statuses/p${index + 1}`,
          actorId: owner,
          createdAt
        })
      )
    }
    // Newest of all, but a direct message: it must not spend the cap.
    await seedStatus({
      id: `${owner}/statuses/p5`,
      actorId: owner,
      createdAt: BASE + 4000,
      to: [actorIn('m.test', `${prefix}-friend`)]
    })
    await seedStatus({
      id: `${actorIn('m.test', `${prefix}-someone`)}/statuses/p6`,
      actorId: actorIn('m.test', `${prefix}-someone`),
      createdAt: BASE + 3000
    })

    await backfillListTimelineForMembers(db, {
      listId,
      ownerId: owner,
      targetActorIds: [owner]
    })
    expect(await feedOf(owner)).toEqual(
      [posts[1], posts[2], posts[3]]
        .map((id) => `${listTimelineKey(listId)}>${id}`)
        .sort()
    )
  })

  it('backfills a member’s newest posts up to the member cap across pages, with createdAt and author', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    const posts: string[] = []
    // Seven posts, pairs sharing a timestamp across the 2-row page boundary.
    for (let index = 0; index < 7; index++) {
      posts.push(
        await seedStatus({
          id: `${member}/statuses/p${index + 1}`,
          actorId: member,
          createdAt: BASE + Math.floor((index + 1) / 2) * 1000
        })
      )
    }
    await seedStatus({
      id: `${owner}/statuses/own`,
      actorId: owner,
      createdAt: BASE + 9000
    })
    await backfillListTimelineForMembers(db, {
      listId,
      ownerId: owner,
      targetActorIds: [member]
    })
    expect(await feedOf(owner)).toEqual(
      posts
        .slice(2)
        .map((id) => `${listTimelineKey(listId)}>${id}`)
        .sort()
    )
    const row = await db
      .selectFrom('timelines')
      .selectAll()
      .where('statusId', '=', posts[6])
      .executeTakeFirstOrThrow()
    expect(row).toMatchObject({
      actorId: owner,
      statusActorId: member,
      createdAt: BASE + 3000
    })
  })

  it('keeps the owner’s newest posts when their ids sort against time', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const listId = `${prefix}-list`
    // Four posts, the oldest with the highest id (as with ids from another
    // server): the cap of 3 keeps the three newest, o3 to o1, only if the
    // createdAt sort comes before the id sort.
    const posts: string[] = []
    for (let index = 0; index < 4; index++) {
      posts.push(
        await seedStatus({
          id: `${owner}/statuses/o${4 - index}`,
          actorId: owner,
          createdAt: BASE + (index + 1) * 1000
        })
      )
    }
    await backfillListTimelineForMembers(db, {
      listId,
      ownerId: owner,
      targetActorIds: [owner]
    })
    expect(await feedOf(owner)).toEqual(
      posts
        .slice(1)
        .map((id) => `${listTimelineKey(listId)}>${id}`)
        .sort()
    )
  })

  it('keeps the owner’s highest ids among posts that share a createdAt, written out of id order', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const listId = `${prefix}-list`
    // Four posts on one timestamp, inserted 2, 4, 1, 3: the cap of 3 keeps
    // ids 4, 3 and 2 only if the id sort breaks the tie. The database's own
    // scan order (insertion order, or its reverse) would keep id 1.
    const posts: Record<number, string> = {}
    for (const number of [2, 4, 1, 3]) {
      posts[number] = await seedStatus({
        id: `${owner}/statuses/q${number}`,
        actorId: owner,
        createdAt: BASE + 5000
      })
    }
    await backfillListTimelineForMembers(db, {
      listId,
      ownerId: owner,
      targetActorIds: [owner]
    })
    expect(await feedOf(owner)).toEqual(
      [posts[4], posts[3], posts[2]]
        .map((id) => `${listTimelineKey(listId)}>${id}`)
        .sort()
    )
  })

  it('keeps a member’s newest posts across pages when their ids sort against time', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    // Seven posts, the oldest with the highest id: the cap of 5 keeps the five
    // newest, s5 to s1, only if the createdAt sort comes before the id sort.
    const posts: string[] = []
    for (let index = 0; index < 7; index++) {
      posts.push(
        await seedStatus({
          id: `${member}/statuses/s${7 - index}`,
          actorId: member,
          createdAt: BASE + (index + 1) * 1000
        })
      )
    }
    await backfillListTimelineForMembers(db, {
      listId,
      ownerId: owner,
      targetActorIds: [member]
    })
    expect(await feedOf(owner)).toEqual(
      posts
        .slice(2)
        .map((id) => `${listTimelineKey(listId)}>${id}`)
        .sort()
    )
  })

  it('pages through a member’s posts that share a createdAt, written out of id order', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    // Three posts on one timestamp, inserted 3, 1, 2, with pages of 2: the
    // first page ends on id 2 and the second on id 1 only if the id sort breaks
    // the tie. In scan order the first page ends on id 1 and the cursor then
    // skips id 2.
    const posts: string[] = []
    for (const number of [3, 1, 2]) {
      posts.push(
        await seedStatus({
          id: `${member}/statuses/t${number}`,
          actorId: member,
          createdAt: BASE + 5000
        })
      )
    }
    await backfillListTimelineForMembers(db, {
      listId,
      ownerId: owner,
      targetActorIds: [member]
    })
    expect(await feedOf(owner)).toEqual(
      posts.map((id) => `${listTimelineKey(listId)}>${id}`).sort()
    )
  })

  it('backfills nothing for a member the owner only asked to follow', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const pending = actorIn('m.test', `${prefix}-pending`)
    const accepted = actorIn('m.test', `${prefix}-accepted`)
    await seedFollow(owner, pending, Requested)
    // Someone else's pending request does not hold the owner's backfill.
    await seedFollow(
      actorIn('home.test', `${prefix}-other`),
      accepted,
      Requested
    )
    await seedStatus({ id: `${pending}/statuses/1`, actorId: pending })
    const acceptedPost = await seedStatus({
      id: `${accepted}/statuses/1`,
      actorId: accepted
    })
    await backfillListTimelineForMembers(db, {
      listId: `${prefix}-list`,
      ownerId: owner,
      targetActorIds: [pending, accepted]
    })
    expect(await feedOf(owner)).toEqual([
      `${listTimelineKey(`${prefix}-list`)}>${acceptedPost}`
    ])
  })
})

describe('removeListAccounts', () => {
  it('removes the members from this list and their posts from its feed only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const gone = actorIn('m.test', `${prefix}-gone`)
    const stays = actorIn('m.test', `${prefix}-stays`)
    const listId = `${prefix}-list`
    const otherList = `${prefix}-other-list`
    for (const [list, member] of [
      [listId, gone],
      [listId, stays],
      [otherList, gone]
    ]) {
      await seedMembership({
        listId: list,
        actorId: owner,
        targetActorId: member
      })
    }
    const gonePost = await seedStatus({
      id: `${gone}/statuses/1`,
      actorId: gone
    })
    const staysPost = await seedStatus({
      id: `${stays}/statuses/1`,
      actorId: stays
    })
    for (const [timeline, statusId, statusActorId] of [
      [listTimelineKey(listId), gonePost, gone],
      [listTimelineKey(listId), staysPost, stays],
      [listTimelineKey(otherList), gonePost, gone],
      ['main', gonePost, gone]
    ]) {
      await seedTimelineRow({
        actorId: owner,
        timeline,
        statusId,
        statusActorId
      })
    }

    // Not the owner: nothing happens, to the memberships or to the owner's
    // feed (the feed delete is scoped to the caller too, not only by the list's
    // key).
    const feedBefore = await feedOf(owner)
    expect(feedBefore).toHaveLength(4)
    await removeListAccounts(db, {
      listId,
      actorId: actorIn('home.test', `${prefix}-other`),
      targetActorIds: [gone]
    })
    expect(await membersOf(listId)).toHaveLength(2)
    expect(await feedOf(owner)).toEqual(feedBefore)

    await removeListAccounts(db, {
      listId,
      actorId: owner,
      targetActorIds: [gone]
    })
    expect(await membersOf(listId)).toEqual([`${owner}>${stays}`])
    expect(await membersOf(otherList)).toEqual([`${owner}>${gone}`])
    expect(await feedOf(owner)).toEqual(
      [
        `${listTimelineKey(listId)}>${staysPost}`,
        `${listTimelineKey(otherList)}>${gonePost}`,
        `main>${gonePost}`
      ].sort()
    )
  })
})

describe('getListTimeline', () => {
  // Posts s1..s5 by a member in the owner's list feed, s2 and s3 at the same
  // time (s3 materialized after s2, so with the larger row id); neighbours:
  // the owner's other list, another owner's feed under the same list key, and
  // the owner's home feed, each with a row whose createdAt differs from its
  // status's.
  const setup = async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    await seedList({ id: listId, actorId: owner })
    const timeline = listTimelineKey(listId)
    const times = [BASE, BASE + 1000, BASE + 1000, BASE + 2000, BASE + 3000]
    const posts: string[] = []
    for (const [index, createdAt] of times.entries()) {
      const id = await seedStatus({
        id: `${member}/statuses/s${index + 1}`,
        actorId: member,
        createdAt
      })
      posts.push(id)
      await seedTimelineRow({
        actorId: owner,
        timeline,
        statusId: id,
        statusActorId: member,
        createdAt
      })
    }
    const otherListPost = await seedStatus({
      id: `${member}/statuses/s6`,
      actorId: member,
      createdAt: BASE + 5000
    })
    await seedTimelineRow({
      actorId: owner,
      timeline: listTimelineKey(`${prefix}-other-list`),
      statusId: otherListPost,
      statusActorId: member,
      createdAt: BASE + 500
    })
    const otherOwnerPost = await seedStatus({
      id: `${member}/statuses/s7`,
      actorId: member,
      createdAt: BASE + 5000
    })
    await seedTimelineRow({
      actorId: other,
      timeline,
      statusId: otherOwnerPost,
      statusActorId: member,
      createdAt: BASE + 500
    })
    const homePost = await seedStatus({
      id: `${member}/statuses/s8`,
      actorId: member,
      createdAt: BASE + 5000
    })
    await seedTimelineRow({
      actorId: owner,
      timeline: 'main',
      statusId: homePost,
      statusActorId: member,
      createdAt: BASE + 500
    })
    // In no feed: a cursor on it falls back to its own createdAt.
    const purgedPost = await seedStatus({
      id: `${member}/statuses/s9`,
      actorId: member,
      createdAt: BASE + 1000
    })
    return {
      owner,
      listId,
      posts,
      otherListPost,
      otherOwnerPost,
      homePost,
      purgedPost
    }
  }

  it.each([
    { cursor: {}, limit: 20, expected: [5, 4, 3, 2, 1] },
    { cursor: {}, limit: 2, expected: [5, 4] },
    { cursor: { maxStatusId: 3 }, limit: 20, expected: [2, 1] },
    { cursor: { maxStatusId: 4 }, limit: 2, expected: [3, 2] },
    { cursor: { sinceStatusId: 2 }, limit: 20, expected: [5, 4, 3] },
    { cursor: { sinceStatusId: 2 }, limit: 1, expected: [5] },
    { cursor: { minStatusId: 2 }, limit: 2, expected: [4, 3] },
    {
      cursor: { minStatusId: 1, maxStatusId: 5 },
      limit: 20,
      expected: [4, 3, 2]
    },
    { cursor: { sinceStatusId: 1, maxStatusId: 4 }, limit: 1, expected: [3] }
  ])(
    'pages on the feed rows’ (createdAt, id) with $cursor and limit $limit',
    async ({ cursor, limit, expected }) => {
      const s = await setup()
      statusCalls.length = 0
      const statuses = await getListTimeline(db, statusesSource, {
        listId: s.listId,
        actorId: s.owner,
        limit,
        ...Object.fromEntries(
          Object.entries(cursor).map(([key, index]) => [
            key,
            s.posts[index - 1]
          ])
        )
      })
      const expectedIds = expected.map((index) => s.posts[index - 1])
      expect(statuses.map((status) => status.id)).toEqual(expectedIds)
      expect(statusCalls).toEqual([[expectedIds, s.owner]])
    }
  )

  it('falls back to the status’s createdAt for a cursor outside this feed, and ends on an unknown one', async () => {
    const s = await setup()
    const ids = async (cursor: Record<string, string>) =>
      (
        await getListTimeline(db, statusesSource, {
          listId: s.listId,
          actorId: s.owner,
          ...cursor
        })
      ).map((status) => status.id)
    expect(await ids({ maxStatusId: s.purgedPost })).toEqual([s.posts[0]])
    expect(await ids({ sinceStatusId: s.purgedPost })).toEqual([
      s.posts[4],
      s.posts[3]
    ])
    // Rows of another list, another owner and the home feed are not the
    // cursor either: their statuses are newer than the whole feed.
    for (const post of [s.otherListPost, s.otherOwnerPost, s.homePost]) {
      expect(await ids({ maxStatusId: post })).toEqual([...s.posts].reverse())
    }
    statusCalls.length = 0
    expect(await ids({ maxStatusId: `${s.posts[0]}-missing` })).toEqual([])
    expect(await ids({ sinceStatusId: `${s.posts[0]}-missing` })).toEqual([])
    expect(await ids({ sinceStatusId: s.posts[4] })).toEqual([])
    expect(statusCalls).toEqual([])
  })

  it('pages feed rows without a createdAt on their row id only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    const timeline = listTimelineKey(listId)
    const posts: string[] = []
    for (const index of [1, 2, 3]) {
      const id = await seedStatus({
        id: `${member}/statuses/n${index}`,
        actorId: member,
        createdAt: BASE
      })
      posts.push(id)
      await seedTimelineRow({
        actorId: owner,
        timeline,
        statusId: id,
        statusActorId: member,
        createdAt: null
      })
    }
    const dated = await seedStatus({
      id: `${member}/statuses/n4`,
      actorId: member,
      createdAt: BASE
    })
    await seedTimelineRow({
      actorId: owner,
      timeline,
      statusId: dated,
      statusActorId: member,
      createdAt: BASE
    })
    const undated = await seedStatus({
      id: `${member}/statuses/n5`,
      actorId: member,
      createdAt: null
    })
    const ids = async (cursor: Record<string, string>) =>
      (
        await getListTimeline(db, statusesSource, {
          listId,
          actorId: owner,
          ...cursor
        })
      ).map((status) => status.id)
    expect(await ids({ maxStatusId: posts[1] })).toEqual([posts[0]])
    expect(await ids({ sinceStatusId: posts[1] })).toEqual([posts[2]])
    expect(await ids({ minStatusId: posts[0] })).toEqual([posts[2], posts[1]])
    expect(await ids({ sinceStatusId: dated })).toEqual([])
    // Outside the feed, with no createdAt of its own: nothing follows it.
    expect(await ids({ maxStatusId: undated })).toEqual([])
  })

  it('shows only the statuses the owner may read in a list, by its replies policy, without blocked or muted authors', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const unfollowed = actorIn('m.test', `${prefix}-unfollowed`)
    const blocked = actorIn('m.test', `${prefix}-blocked`)
    const muted = actorIn('m.test', `${prefix}-muted`)
    const stranger = actorIn('s.test', `${prefix}-stranger`)
    const listId = `${prefix}-list`
    const timeline = listTimelineKey(listId)
    await seedList({ id: listId, actorId: owner })
    await seedFollow(owner, member, Accepted)
    const now = new Date(BASE)
    await db
      .insertInto('blocks')
      .values({
        id: randomUUID(),
        actorId: owner,
        actorHost: 'home.test',
        targetActorId: blocked,
        targetActorHost: 'm.test',
        uri: `${owner}#blocks/${prefix}`,
        createdAt: now,
        updatedAt: now
      })
      .execute()
    await db
      .insertInto('mutes')
      .values({
        id: randomUUID(),
        actorId: owner,
        actorHost: 'home.test',
        targetActorId: muted,
        targetActorHost: 'm.test',
        notifications: true,
        endsAt: null,
        createdAt: now,
        updatedAt: now
      })
      .execute()
    const ownerPost = await seedStatus({
      id: `${owner}/statuses/own`,
      actorId: owner
    })
    const strangerPost = await seedStatus({
      id: `${stranger}/statuses/1`,
      actorId: stranger
    })
    const blockedPost = await seedStatus({
      id: `${blocked}/statuses/1`,
      actorId: blocked
    })

    const shown: string[] = []
    const hidden: string[] = []
    let minute = 0
    const add = async (
      list: string[],
      params: Parameters<typeof seedStatus>[0]
    ) => {
      minute += 1
      const id = await seedStatus({
        ...params,
        createdAt: BASE + minute * 60_000
      })
      await seedTimelineRow({
        actorId: owner,
        timeline,
        statusId: id,
        statusActorId: params.actorId,
        createdAt: BASE + minute * 60_000
      })
      list.push(id)
    }
    await add(shown, { id: `${member}/statuses/public`, actorId: member })
    // A status stored with no reply column at all is not a reply either.
    await add(shown, {
      id: `${member}/statuses/null-reply`,
      actorId: member,
      reply: null
    })
    await add(shown, {
      id: `${member}/statuses/followers`,
      actorId: member,
      to: [`${member}/followers`]
    })
    await add(shown, {
      id: `${member}/statuses/reply-owner`,
      actorId: member,
      reply: ownerPost
    })
    await add(hidden, {
      id: `${member}/statuses/direct`,
      actorId: member,
      to: [owner]
    })
    await add(hidden, {
      id: `${unfollowed}/statuses/followers`,
      actorId: unfollowed,
      to: [`${unfollowed}/followers`]
    })
    await add(hidden, {
      id: `${member}/statuses/reply-stranger`,
      actorId: member,
      reply: strangerPost
    })
    await add(hidden, { id: `${blocked}/statuses/2`, actorId: blocked })
    await add(hidden, { id: `${muted}/statuses/1`, actorId: muted })
    await add(hidden, {
      id: `${member}/statuses/boost-blocked`,
      actorId: member,
      type: StatusType.enum.Announce,
      originalStatusId: blockedPost
    })

    const ids = (
      await getListTimeline(db, statusesSource, { listId, actorId: owner })
    ).map((status) => status.id)
    expect(ids).toEqual([...shown].reverse())
    expect(ids).not.toContain(hidden[0])

    // The policy is the list's own: under 'none' the member's reply to a
    // stranger stays hidden, under 'followed' a reply to an account the owner
    // follows shows.
    await db
      .updateTable('lists')
      .set({ repliesPolicy: 'none' })
      .where('id', '=', listId)
      .execute()
    expect(
      (
        await getListTimeline(db, statusesSource, { listId, actorId: owner })
      ).map((status) => status.id)
    ).toEqual([...shown].reverse())
    await seedFollow(owner, stranger, Accepted)
    await db
      .updateTable('lists')
      .set({ repliesPolicy: 'followed' })
      .where('id', '=', listId)
      .execute()
    expect(
      (
        await getListTimeline(db, statusesSource, { listId, actorId: owner })
      ).map((status) => status.id)
    ).toEqual([hidden[2], ...[...shown].reverse()])
  })

  it('applies the replies policy of the list it reads, not of another of the owner’s lists', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const followed = actorIn('s.test', `${prefix}-followed`)
    await seedFollow(owner, member, Accepted)
    await seedFollow(owner, followed, Accepted)
    const followedPost = await seedStatus({
      id: `${followed}/statuses/1`,
      actorId: followed
    })
    const reply = await seedStatus({
      id: `${member}/statuses/reply`,
      actorId: member,
      reply: followedPost
    })
    // The owner has only asked to follow this account, which 'followed' does
    // not count.
    const requested = actorIn('s.test', `${prefix}-requested`)
    await seedFollow(owner, requested, Requested)
    const requestedPost = await seedStatus({
      id: `${requested}/statuses/1`,
      actorId: requested
    })
    const replyToRequested = await seedStatus({
      id: `${member}/statuses/reply-requested`,
      actorId: member,
      reply: requestedPost
    })
    // Both lists hold the member's reply to an account the owner follows,
    // which only 'followed' lets through. A policy read that ignored the list
    // id would apply one list's policy to both reads.
    const followedList = `${prefix}-followed`
    const noneList = `${prefix}-none`
    for (const [id, repliesPolicy] of [
      [followedList, 'followed'],
      [noneList, 'none']
    ]) {
      await seedList({ id, actorId: owner, repliesPolicy })
      for (const statusId of [reply, replyToRequested]) {
        await seedTimelineRow({
          actorId: owner,
          timeline: listTimelineKey(id),
          statusId,
          statusActorId: member
        })
      }
    }
    const read = async (listId: string) =>
      (
        await getListTimeline(db, statusesSource, { listId, actorId: owner })
      ).map((status) => status.id)
    expect(await read(followedList)).toEqual([reply])
    expect(await read(noneList)).toEqual([])
  })

  it('breaks a createdAt tie on the feed row id, not on the order the rows were written', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    const timeline = listTimelineKey(listId)
    await seedList({ id: listId, actorId: owner })
    const writeRow = async (
      statusId: string,
      id: number,
      createdAt: number
    ) => {
      await seedStatus({ id: statusId, actorId: member, createdAt })
      await db
        .insertInto('timelines')
        .values({
          id,
          actorId: owner,
          timeline,
          statusId,
          statusActorId: member,
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt)
        })
        .execute()
    }
    // Ids far above what the sequence hands out in a test run. The tied row
    // with the larger id is written first.
    const older = `${member}/statuses/older`
    const larger = `${member}/statuses/larger`
    const smaller = `${member}/statuses/smaller`
    await writeRow(older, 900_000_001, BASE)
    await writeRow(larger, 900_000_003, BASE + 1000)
    await writeRow(smaller, 900_000_002, BASE + 1000)
    const read = async (cursor: { minStatusId?: string }) =>
      (
        await getListTimeline(db, statusesSource, {
          listId,
          actorId: owner,
          ...cursor
        })
      ).map((status) => status.id)
    expect(await read({})).toEqual([larger, smaller, older])
    expect(await read({ minStatusId: older })).toEqual([larger, smaller])
  })
})

describe('addStatusToListTimelines', () => {
  it('fans a status into every list holding its author, except where the owner’s request is pending', async () => {
    const prefix = nextPrefix()
    const author = actorIn('a.test', `${prefix}-author`)
    const someoneElse = actorIn('a.test', `${prefix}-someone`)
    const plain = actorIn('home.test', `${prefix}-plain`)
    const pending = actorIn('home.test', `${prefix}-pending`)
    const following = actorIn('home.test', `${prefix}-following`)
    const pendingElsewhere = actorIn('home.test', `${prefix}-elsewhere`)
    const unrelated = actorIn('home.test', `${prefix}-unrelated`)
    await seedFollow(pending, author, Requested)
    await seedFollow(following, author, Accepted)
    await seedFollow(pendingElsewhere, someoneElse, Requested)
    // The author's own list holds them although their self-follow is pending.
    await seedFollow(author, author, Requested)
    const memberships = [
      [plain, `${prefix}-plain`, author],
      [pending, `${prefix}-pending`, author],
      [following, `${prefix}-following`, author],
      [pendingElsewhere, `${prefix}-elsewhere`, author],
      [author, `${prefix}-own`, author],
      [unrelated, `${prefix}-unrelated`, someoneElse]
    ]
    for (const [owner, listId, member] of memberships) {
      await seedMembership({ listId, actorId: owner, targetActorId: member })
    }
    const createdAt = BASE + 42_000
    const id = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      createdAt
    })
    const status = { id, actorId: author, createdAt } as unknown as Status

    await addStatusToListTimelines(db, { status })
    await addStatusToListTimelines(db, { status })

    const rows = await db
      .selectFrom('timelines')
      .select(['actorId', 'timeline', 'statusActorId', 'createdAt'])
      .where('statusId', '=', id)
      .execute()
    expect(rows.map((row) => `${row.actorId}>${row.timeline}`).sort()).toEqual(
      [
        `${plain}>${listTimelineKey(`${prefix}-plain`)}`,
        `${following}>${listTimelineKey(`${prefix}-following`)}`,
        `${pendingElsewhere}>${listTimelineKey(`${prefix}-elsewhere`)}`,
        `${author}>${listTimelineKey(`${prefix}-own`)}`
      ].sort()
    )
    for (const row of rows) {
      expect(row).toMatchObject({ statusActorId: author, createdAt })
    }
  })
})

// Forces the next matching write on `table` to fail with a database error.
// Returns the function that removes the trigger again.
const failWrite = async (
  table: string,
  event: 'insert' | 'delete',
  column: string,
  value: string
) => {
  const name = `list_queries_fail_${event}_${table}`.toLowerCase()
  const record = event === 'delete' ? 'old' : 'new'
  const literal = `'${value.replaceAll("'", "''")}'`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function list_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db)
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${record}."${column}" = ${literal}) execute function list_queries_fail()`
      )
      .execute(db)
    return () => sql.raw(`drop trigger ${name} on "${table}"`).execute(db)
  }
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${record}."${column}" = ${literal} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db)
  return () => sql.raw(`drop trigger ${name}`).execute(db)
}

const TABLES = [
  'follows',
  'lists',
  'list_accounts',
  'timelines',
  'counters'
] as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    dump[table] = await db.selectFrom(table).selectAll().orderBy('id').execute()
  }
  return dump
}

describe('transactions', () => {
  it('deleteList keeps everything when deleting the list row fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    await seedList({ id: listId, actorId: owner })
    await seedMembership({ listId, actorId: owner, targetActorId: member })
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    await seedTimelineRow({
      actorId: owner,
      timeline: listTimelineKey(listId),
      statusId: post,
      statusActorId: member
    })
    const drop = await failWrite('lists', 'delete', 'id', listId)
    const before = await dumpTables()
    try {
      await expect(
        deleteList(db, { id: listId, actorId: owner })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('addListAccounts keeps nothing when the backfill fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    await seedFollow(owner, member, Accepted)
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    const drop = await failWrite('timelines', 'insert', 'statusId', post)
    const before = await dumpTables()
    try {
      await expect(
        addListAccounts(db, {
          listId,
          actorId: owner,
          targetActorIds: [member],
          requireFollowOrRequest: true
        })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('removeListAccounts keeps everything when the feed purge fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const listId = `${prefix}-list`
    await seedMembership({ listId, actorId: owner, targetActorId: member })
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    await seedTimelineRow({
      actorId: owner,
      timeline: listTimelineKey(listId),
      statusId: post,
      statusActorId: member
    })
    const drop = await failWrite('timelines', 'delete', 'statusId', post)
    const before = await dumpTables()
    try {
      await expect(
        removeListAccounts(db, {
          listId,
          actorId: owner,
          targetActorIds: [member]
        })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })
})
