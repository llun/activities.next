import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import { getMastodonActors } from '@/lib/database/domains/actor/mastodon'
import {
  type CollectionStatusSource,
  addCollectionMembers,
  addStatusToCollectionTimelines,
  countCollectionItems,
  createCollection,
  deleteCollection,
  getAccountCollections,
  getApprovedCollectionMembers,
  getCollection,
  getCollectionById,
  getCollectionItem,
  getCollectionItemByAccount,
  getCollectionItems,
  getCollectionMemberCounts,
  getCollectionMembers,
  getCollectionTimeline,
  getCollections,
  getCollectionsFeaturingAccount,
  getPublicCollectionTimeline,
  removeCollectionItemById,
  removeCollectionMembers,
  setOwnCollectionMembershipState,
  updateCollection
} from '@/lib/database/domains/collection/queries'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { CollectionLimitError } from '@/lib/services/collections/limits'
import type { CollectionFeatureState } from '@/lib/types/domain/collection'
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

// A feed cap of 3 trimmed past 4, so the backfill limit, the trim threshold
// and its boundary are reachable with a handful of rows.
vi.mock('@/lib/services/timelines/types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/timelines/types')>()),
  COLLECTION_FEED_MAX_ROWS: 3,
  COLLECTION_FEED_TRIM_SLACK: 1
}))

// Ceilings of 2 collections an owner and 3 members a collection.
vi.mock('@/lib/services/collections/limits', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/services/collections/limits')
  >()),
  MAX_COLLECTIONS_PER_ACTOR: 2,
  MAX_COLLECTION_MEMBERS: 3
}))

// Query-level tests for the collection domain. Every test uses its own actors
// and collections (a fresh prefix) and puts neighbouring rows next to the
// ones under test — another collection of the same owner, another owner's
// collection holding the same member, rows of another feed — so a dropped
// predicate shows up as a wrong row. Rows that tie on their sort key are
// written out of id order, and ids that tie differ in a digit, not in letter
// case. Runs on PostgreSQL in CI.

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
const nextPrefix = () => `cq${++prefixCount}`
const BASE = Date.UTC(2026, 0, 1)
const actorIn = (domain: string, name: string) =>
  `https://${domain}/users/${name}`
// Explicit seq and row ids, for rows whose key order a test depends on,
// handed out in blocks counting down from far above anything the sequences
// reach here, ascending within a block. SQLite gives a new row its column's
// maximum plus one, so every later automatic key lands above every explicit
// one and no later block can collide with it.
let nextBlock = 1_000_000_000
const explicitKeys = (count: number) => {
  nextBlock -= count
  return Array.from({ length: count }, (_, index) => nextBlock + index)
}

// A status facade that echoes what it is asked for, in order.
const statusCalls: [string[], string | undefined][] = []
const statusesSource: CollectionStatusSource = async (
  statusIds,
  currentActorId
) => {
  statusCalls.push([statusIds, currentActorId])
  return statusIds.map((id) => ({ id }) as unknown as Status)
}

const seedCollection = async ({
  id,
  owner,
  createdAt = BASE,
  visibility = 'public',
  publicFeed = true,
  seq
}: {
  id: string
  owner: string
  createdAt?: number | null
  visibility?: string
  publicFeed?: boolean
  seq?: number
}) => {
  const at = createdAt === null ? null : new Date(createdAt)
  await db
    .insertInto('collections')
    .values({
      ...(seq === undefined ? null : { seq }),
      id,
      ownerActorId: owner,
      title: `title ${id}`,
      visibility,
      publicFeed,
      sensitive: false,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  const row = await db
    .selectFrom('collections')
    .select('seq')
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  return row.seq
}

const seedMember = async ({
  collectionSeq,
  targetActorId,
  featureState = 'pending',
  createdAt = BASE,
  id = randomUUID(),
  seq
}: {
  collectionSeq: number
  targetActorId: string
  featureState?: CollectionFeatureState
  createdAt?: number | null
  id?: string
  seq?: number
}) => {
  await db
    .insertInto('collection_members')
    .values({
      ...(seq === undefined ? null : { seq }),
      id,
      collectionSeq,
      targetActorId,
      featureState,
      createdAt: createdAt === null ? null : new Date(createdAt)
    })
    .execute()
  const row = await db
    .selectFrom('collection_members')
    .select('seq')
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  return { id, seq: row.seq }
}

const seedFeedRow = async ({
  collectionSeq,
  memberSeq,
  statusId,
  sortKey,
  id
}: {
  collectionSeq: number
  memberSeq: number
  statusId: string
  sortKey: number
  id?: number
}) => {
  await db
    .insertInto('collection_timeline')
    .values({
      ...(id === undefined ? null : { id }),
      collectionSeq,
      memberSeq,
      statusId,
      sortKey
    })
    .execute()
}

const seedStatus = async ({
  id,
  actorId,
  createdAt = BASE,
  to = [ACTIVITY_STREAM_PUBLIC],
  type = StatusType.enum.Note,
  originalStatusId = null
}: {
  id: string
  actorId: string
  createdAt?: number | null
  to?: string[]
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
      reply: '',
      originalStatusId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  if (to.length > 0) {
    await db
      .insertInto('recipients')
      .values(
        to.map((recipient) => ({
          id: randomUUID(),
          statusId: id,
          actorId: recipient,
          type: 'to'
        }))
      )
      .execute()
  }
  return id
}

const collectionRow = (id: string) =>
  db
    .selectFrom('collections')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

const membersOf = async (collectionSeq: number) =>
  (
    await db
      .selectFrom('collection_members')
      .select(['targetActorId', 'featureState'])
      .where('collectionSeq', '=', collectionSeq)
      .execute()
  )
    .map((row) => `${row.targetActorId}:${row.featureState}`)
    .sort()

const memberSeqOf = async (collectionSeq: number, targetActorId: string) =>
  (
    await db
      .selectFrom('collection_members')
      .select('seq')
      .where('collectionSeq', '=', collectionSeq)
      .where('targetActorId', '=', targetActorId)
      .executeTakeFirstOrThrow()
  ).seq

// The feed rows of one collection as `statusId@sortKey#memberSeq`, sorted.
const feedOf = async (collectionSeq: number) =>
  (
    await db
      .selectFrom('collection_timeline')
      .select(['statusId', 'sortKey', 'memberSeq'])
      .where('collectionSeq', '=', collectionSeq)
      .execute()
  )
    .map((row) => `${row.statusId}@${row.sortKey}#${row.memberSeq}`)
    .sort()

describe('collection rows', () => {
  it('creates a collection with the defaults and reads it back', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const created = await createCollection(db, {
      actorId: owner,
      title: 'Curated'
    })
    expect(created).toEqual({
      id: expect.any(String),
      ownerActorId: owner,
      title: 'Curated',
      description: null,
      topic: null,
      language: null,
      visibility: 'public',
      sensitive: false,
      publicFeed: true,
      createdAt: expect.any(Number),
      updatedAt: created.createdAt
    })
    expect(await getCollection(db, { id: created.id, actorId: owner })).toEqual(
      created
    )

    const custom = await createCollection(db, {
      actorId: owner,
      title: 'Custom',
      description: 'about',
      topic: 'birds',
      language: 'th',
      visibility: 'unlisted',
      sensitive: true,
      publicFeed: false
    })
    expect(custom).toMatchObject({
      description: 'about',
      topic: 'birds',
      language: 'th',
      visibility: 'unlisted',
      sensitive: true,
      publicFeed: false
    })
    expect(await getCollection(db, { id: custom.id, actorId: owner })).toEqual(
      custom
    )
  })

  it('refuses a collection past the ceiling, counting only the owner’s', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    await seedCollection({ id: `${prefix}-o1`, owner: other })
    await seedCollection({ id: `${prefix}-o2`, owner: other })
    await seedCollection({ id: `${prefix}-a`, owner })

    await createCollection(db, { actorId: owner, title: 'second' })
    await expect(
      createCollection(db, { actorId: owner, title: 'third' })
    ).rejects.toThrow(CollectionLimitError)
    expect(
      (await getCollections(db, { actorId: owner })).map(({ title }) => title)
    ).toEqual([`title ${prefix}-a`, 'second'])
  })

  it('reads a collection by id for its owner only, and by id alone', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    // Written first, so a lookup that lost its id test would find it.
    await seedCollection({ id: `${prefix}-b`, owner })
    await seedCollection({ id: `${prefix}-a`, owner })
    await seedCollection({ id: `${prefix}-c`, owner: other })

    expect(
      await getCollection(db, { id: `${prefix}-a`, actorId: owner })
    ).toMatchObject({ id: `${prefix}-a`, ownerActorId: owner })
    expect(
      await getCollection(db, { id: `${prefix}-c`, actorId: owner })
    ).toBeNull()
    expect(
      await getCollection(db, { id: `${prefix}-a`, actorId: other })
    ).toBeNull()
    expect(await getCollectionById(db, { id: `${prefix}-c` })).toMatchObject({
      id: `${prefix}-c`,
      ownerActorId: other
    })
    expect(await getCollectionById(db, { id: `${prefix}-none` })).toBeNull()
  })

  it('lists the owner’s collections oldest first', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    // Ids sort against time, written in id order.
    await seedCollection({
      id: `${prefix}-a`,
      owner,
      createdAt: BASE + 2000
    })
    await seedCollection({
      id: `${prefix}-b`,
      owner,
      createdAt: BASE + 1000
    })
    await seedCollection({
      id: `${prefix}-c`,
      owner,
      createdAt: BASE + 3000
    })
    await seedCollection({ id: `${prefix}-d`, owner: other, createdAt: BASE })
    expect(
      (await getCollections(db, { actorId: owner })).map(({ id }) => id)
    ).toEqual([`${prefix}-b`, `${prefix}-a`, `${prefix}-c`])
  })

  it('reads a NULL timestamp as 0', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    await seedCollection({ id: `${prefix}-a`, owner, createdAt: null })
    expect(
      await getCollection(db, { id: `${prefix}-a`, actorId: owner })
    ).toMatchObject({ createdAt: 0, updatedAt: 0 })
  })

  it('updates only the given fields of the owner’s collection', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    await seedCollection({ id: `${prefix}-a`, owner })
    await seedCollection({ id: `${prefix}-b`, owner })

    const updated = await updateCollection(db, {
      id: `${prefix}-a`,
      actorId: owner,
      topic: 'birds',
      sensitive: true,
      description: 'about'
    })
    expect(updated).toMatchObject({
      id: `${prefix}-a`,
      title: `title ${prefix}-a`,
      topic: 'birds',
      description: 'about',
      sensitive: true,
      visibility: 'public',
      publicFeed: true
    })
    expect(updated?.updatedAt).toBeGreaterThan(BASE)
    await updateCollection(db, {
      id: `${prefix}-a`,
      actorId: owner,
      title: 'Renamed',
      description: null,
      visibility: 'private',
      publicFeed: false,
      language: 'en'
    })
    expect(await collectionRow(`${prefix}-a`)).toMatchObject({
      title: 'Renamed',
      topic: 'birds',
      description: null,
      visibility: 'private',
      publicFeed: false,
      language: 'en',
      sensitive: true
    })
    expect(await collectionRow(`${prefix}-b`)).toMatchObject({
      title: `title ${prefix}-b`,
      topic: null,
      updatedAt: BASE
    })

    expect(
      await updateCollection(db, {
        id: `${prefix}-b`,
        actorId: other,
        title: 'x'
      })
    ).toBeNull()
    expect((await collectionRow(`${prefix}-b`))?.title).toBe(
      `title ${prefix}-b`
    )
  })

  it('deletes the owner’s collection with its members and its feed only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const member = actorIn('m.test', `${prefix}-member`)
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    const doomed = await seedCollection({ id: `${prefix}-doomed`, owner })
    const kept = await seedCollection({ id: `${prefix}-kept`, owner })
    for (const collectionSeq of [doomed, kept]) {
      const { seq } = await seedMember({ collectionSeq, targetActorId: member })
      await seedFeedRow({
        collectionSeq,
        memberSeq: seq,
        statusId: post,
        sortKey: BASE
      })
    }

    expect(
      await deleteCollection(db, { id: `${prefix}-doomed`, actorId: other })
    ).toBe(false)
    expect(await collectionRow(`${prefix}-doomed`)).toBeDefined()
    expect(await membersOf(doomed)).toHaveLength(1)
    expect(await feedOf(doomed)).toHaveLength(1)

    expect(
      await deleteCollection(db, { id: `${prefix}-doomed`, actorId: owner })
    ).toBe(true)
    expect(await collectionRow(`${prefix}-doomed`)).toBeUndefined()
    expect(await collectionRow(`${prefix}-kept`)).toBeDefined()
    expect(await membersOf(doomed)).toEqual([])
    expect(await feedOf(doomed)).toEqual([])
    expect(await membersOf(kept)).toEqual([`${member}:pending`])
    expect(await feedOf(kept)).toHaveLength(1)

    expect(
      await deleteCollection(db, { id: `${prefix}-none`, actorId: owner })
    ).toBe(false)
  })
})

describe('getCollectionMemberCounts', () => {
  it('counts the owner’s members of each requested collection, 0 for the rest', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [m1, m2] = [1, 2].map((n) => actorIn('m.test', `${prefix}-m${n}`))
    const a = await seedCollection({ id: `${prefix}-a`, owner })
    const b = await seedCollection({ id: `${prefix}-b`, owner })
    const foreign = await seedCollection({ id: `${prefix}-c`, owner: other })
    await seedCollection({ id: `${prefix}-d`, owner })
    const unrequested = await seedCollection({ id: `${prefix}-e`, owner })
    await seedMember({
      collectionSeq: a,
      targetActorId: m1,
      featureState: 'approved'
    })
    await seedMember({ collectionSeq: a, targetActorId: m2 })
    await seedMember({ collectionSeq: b, targetActorId: m1 })
    for (const target of [m1, m2]) {
      await seedMember({
        collectionSeq: foreign,
        targetActorId: target,
        featureState: 'approved'
      })
    }
    await seedMember({
      collectionSeq: unrequested,
      targetActorId: m1,
      featureState: 'approved'
    })

    const ids = ['a', 'b', 'c', 'd'].map((key) => `${prefix}-${key}`)
    expect(
      await getCollectionMemberCounts(db, {
        actorId: owner,
        collectionIds: ids
      })
    ).toEqual({
      [`${prefix}-a`]: 2,
      [`${prefix}-b`]: 1,
      [`${prefix}-c`]: 0,
      [`${prefix}-d`]: 0
    })
    expect(
      await getCollectionMemberCounts(db, {
        actorId: owner,
        collectionIds: ids,
        approvedOnly: true
      })
    ).toEqual({
      [`${prefix}-a`]: 1,
      [`${prefix}-b`]: 0,
      [`${prefix}-c`]: 0,
      [`${prefix}-d`]: 0
    })
    expect(
      await getCollectionMemberCounts(db, {
        actorId: owner,
        collectionIds: []
      })
    ).toEqual({})
  })
})

describe('addCollectionMembers', () => {
  it('adds pending members once, returns the new ones and backfills their posts', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [t1, t2, t3] = [1, 2, 3].map((n) =>
      actorIn('m.test', `${prefix}-t${n}`)
    )
    const stranger = actorIn('m.test', `${prefix}-stranger`)
    const p1 = await seedStatus({
      id: `${t1}/statuses/1`,
      actorId: t1,
      createdAt: BASE + 1000
    })
    const p2 = await seedStatus({
      id: `${t2}/statuses/1`,
      actorId: t2,
      createdAt: BASE + 2000
    })
    await seedStatus({
      id: `${stranger}/statuses/1`,
      actorId: stranger,
      createdAt: BASE + 3000
    })
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    // Another owner's collection already holds t1.
    const foreign = await seedCollection({ id: `${prefix}-z`, owner: other })
    await seedMember({ collectionSeq: foreign, targetActorId: t1 })

    expect(
      await addCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: owner,
        targetActorIds: [t1, t2]
      })
    ).toEqual([t1, t2])
    expect(await membersOf(collection)).toEqual([
      `${t1}:pending`,
      `${t2}:pending`
    ])
    const [seq1, seq2] = [
      await memberSeqOf(collection, t1),
      await memberSeqOf(collection, t2)
    ]
    expect(await feedOf(collection)).toEqual(
      [`${p1}@${BASE + 1000}#${seq1}`, `${p2}@${BASE + 2000}#${seq2}`].sort()
    )
    expect(await feedOf(foreign)).toEqual([])
    expect(await membersOf(foreign)).toEqual([`${t1}:pending`])

    // A re-add is not new; t3 has no posts.
    expect(
      await addCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: owner,
        targetActorIds: [t2, t3]
      })
    ).toEqual([t3])
    expect(await membersOf(collection)).toEqual([
      `${t1}:pending`,
      `${t2}:pending`,
      `${t3}:pending`
    ])
    expect(await feedOf(collection)).toHaveLength(2)

    // A re-add backfills only the re-added member, under its seq in THIS
    // collection, though a later collection holds t1 under a seq above every
    // other on both backends.
    const later = await seedCollection({ id: `${prefix}-y`, owner: other })
    await seedMember({ collectionSeq: later, targetActorId: t1, seq: 2 ** 40 })
    const p3 = await seedStatus({
      id: `${t1}/statuses/3`,
      actorId: t1,
      createdAt: BASE + 4000
    })
    await seedStatus({
      id: `${t2}/statuses/2`,
      actorId: t2,
      createdAt: BASE + 5000
    })
    expect(
      await addCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: owner,
        targetActorIds: [t1]
      })
    ).toEqual([])
    expect(await feedOf(collection)).toEqual(
      [
        `${p1}@${BASE + 1000}#${seq1}`,
        `${p2}@${BASE + 2000}#${seq2}`,
        `${p3}@${BASE + 4000}#${seq1}`
      ].sort()
    )
    expect(await feedOf(later)).toEqual([])

    // Not the owner, or nobody to add: nothing changes.
    expect(
      await addCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: other,
        targetActorIds: [stranger]
      })
    ).toEqual([])
    expect(
      await addCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: owner,
        targetActorIds: []
      })
    ).toEqual([])
    expect(await membersOf(collection)).toHaveLength(3)
  })

  it('refuses members past the ceiling, counting only this collection’s and only new ones', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const [a1, a2, a3, a4] = [1, 2, 3, 4].map((n) =>
      actorIn('m.test', `${prefix}-a${n}`)
    )
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-b`, owner })
    for (const target of [a1, a2]) {
      await seedMember({ collectionSeq: collection, targetActorId: target })
    }
    for (const target of [a1, a2, a3]) {
      await seedMember({ collectionSeq: neighbour, targetActorId: target })
    }

    expect(
      await addCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: owner,
        targetActorIds: [a2, a3]
      })
    ).toEqual([a3])
    await expect(
      addCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: owner,
        targetActorIds: [a4]
      })
    ).rejects.toThrow(CollectionLimitError)
    expect(await membersOf(collection)).toEqual([
      `${a1}:pending`,
      `${a2}:pending`,
      `${a3}:pending`
    ])
  })

  it('backfills each member’s newest posts up to the feed cap, a post without createdAt as 0', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const undated = actorIn('m.test', `${prefix}-undated`)
    // Ids sort against time, written oldest first.
    for (const [n, offset] of [
      [4, 1000],
      [3, 2000],
      [2, 3000],
      [1, 4000]
    ]) {
      await seedStatus({
        id: `${member}/statuses/${n}`,
        actorId: member,
        createdAt: BASE + offset
      })
    }
    const undatedPost = await seedStatus({
      id: `${undated}/statuses/1`,
      actorId: undated,
      createdAt: null
    })
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const undatedCollection = await seedCollection({
      id: `${prefix}-b`,
      owner
    })

    await addCollectionMembers(db, {
      id: `${prefix}-a`,
      actorId: owner,
      targetActorIds: [member]
    })
    const seq = await memberSeqOf(collection, member)
    expect(await feedOf(collection)).toEqual(
      [
        `${member}/statuses/1@${BASE + 4000}#${seq}`,
        `${member}/statuses/2@${BASE + 3000}#${seq}`,
        `${member}/statuses/3@${BASE + 2000}#${seq}`
      ].sort()
    )

    await addCollectionMembers(db, {
      id: `${prefix}-b`,
      actorId: owner,
      targetActorIds: [undated]
    })
    expect(await feedOf(undatedCollection)).toEqual([
      `${undatedPost}@0#${await memberSeqOf(undatedCollection, undated)}`
    ])
  })

  it('trims the feed back to the cap when a backfill takes it past the slack', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const [existing, added] = ['existing', 'added'].map((name) =>
      actorIn('m.test', `${prefix}-${name}`)
    )
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const { seq: existingSeq } = await seedMember({
      collectionSeq: collection,
      targetActorId: existing
    })
    // Two older rows already in the feed: with the three backfilled posts
    // the feed holds five, past the cap of three plus the slack of one.
    for (const n of [1, 2]) {
      await seedFeedRow({
        collectionSeq: collection,
        memberSeq: existingSeq,
        statusId: `${existing}/statuses/${n}`,
        sortKey: BASE + n * 100
      })
    }
    for (const n of [1, 2, 3]) {
      await seedStatus({
        id: `${added}/statuses/${n}`,
        actorId: added,
        createdAt: BASE + n * 1000
      })
    }

    await addCollectionMembers(db, {
      id: `${prefix}-a`,
      actorId: owner,
      targetActorIds: [added]
    })
    const seq = await memberSeqOf(collection, added)
    expect(await feedOf(collection)).toEqual(
      [1, 2, 3]
        .map((n) => `${added}/statuses/${n}@${BASE + n * 1000}#${seq}`)
        .sort()
    )
  })
})

describe('feed trimming', () => {
  // Feed rows of one collection as [sortKey offset, explicit id], plus a
  // neighbour collection whose five older rows must survive every trim.
  const setup = async (rows: [number, number][]) => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const author = actorIn('m.test', `${prefix}-author`)
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-b`, owner })
    const { seq } = await seedMember({
      collectionSeq: collection,
      targetActorId: author
    })
    const { seq: neighbourSeq } = await seedMember({
      collectionSeq: neighbour,
      targetActorId: actorIn('m.test', `${prefix}-neighbour`)
    })
    for (const [index, [offset, id]] of rows.entries()) {
      await seedFeedRow({
        collectionSeq: collection,
        memberSeq: seq,
        statusId: `${prefix}-row${index}`,
        sortKey: BASE + offset,
        id
      })
    }
    const neighbourKeys = explicitKeys(5)
    for (const index of [1, 2, 3, 4, 5]) {
      await seedFeedRow({
        collectionSeq: neighbour,
        memberSeq: neighbourSeq,
        statusId: `${prefix}-neighbour${index}`,
        sortKey: BASE - index * 1000,
        id: neighbourKeys[index - 1]
      })
    }
    const post = async (offset: number) => {
      const id = await seedStatus({
        id: `${author}/statuses/${offset}`,
        actorId: author,
        createdAt: BASE + offset
      })
      await addStatusToCollectionTimelines(db, {
        status: {
          id,
          actorId: author,
          createdAt: BASE + offset
        } as unknown as Status
      })
      return id
    }
    const keys = async (collectionSeq: number) =>
      (
        await db
          .selectFrom('collection_timeline')
          .select(['statusId'])
          .where('collectionSeq', '=', collectionSeq)
          .execute()
      )
        .map((row) => row.statusId)
        .sort()
    return { prefix, collection, neighbour, post, keys }
  }

  it('keeps a feed at exactly the cap plus slack, and the neighbour’s rows', async () => {
    const [k1, k2, k3] = explicitKeys(3)
    const s = await setup([
      [1000, k1],
      [2000, k2],
      [3000, k3]
    ])
    const added = await s.post(4000)
    expect(await s.keys(s.collection)).toEqual(
      [`${s.prefix}-row0`, `${s.prefix}-row1`, `${s.prefix}-row2`, added].sort()
    )
    expect(await s.keys(s.neighbour)).toHaveLength(5)
  })

  it('trims past the slack to the newest rows, breaking a sortKey tie on the row id', async () => {
    // Three rows tie at 2000, written out of id order; the cap keeps two of
    // them, the higher ids.
    const [low, middle, high, older] = explicitKeys(4)
    const s = await setup([
      [2000, low],
      [2000, high],
      [2000, middle],
      [1000, older]
    ])
    const added = await s.post(3000)
    expect(await s.keys(s.collection)).toEqual(
      [added, `${s.prefix}-row1`, `${s.prefix}-row2`].sort()
    )
    expect(await s.keys(s.neighbour)).toHaveLength(5)
  })
})

describe('removeCollectionMembers', () => {
  it('removes the members and their feed rows from this collection only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [t1, t2] = [1, 2].map((n) => actorIn('m.test', `${prefix}-t${n}`))
    const p1 = await seedStatus({ id: `${t1}/statuses/1`, actorId: t1 })
    const p2 = await seedStatus({ id: `${t2}/statuses/1`, actorId: t2 })
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-b`, owner })
    for (const [collectionSeq, target, post] of [
      [collection, t1, p1],
      [collection, t2, p2],
      [neighbour, t1, p1]
    ] as const) {
      const { seq } = await seedMember({ collectionSeq, targetActorId: target })
      await seedFeedRow({
        collectionSeq,
        memberSeq: seq,
        statusId: post,
        sortKey: BASE
      })
    }
    const before = {
      collection: await feedOf(collection),
      neighbour: await feedOf(neighbour)
    }

    for (const call of [
      { id: `${prefix}-a`, actorId: other, targetActorIds: [t1] },
      { id: `${prefix}-a`, actorId: owner, targetActorIds: [] },
      {
        id: `${prefix}-a`,
        actorId: owner,
        targetActorIds: [actorIn('m.test', `${prefix}-nobody`)]
      }
    ]) {
      await removeCollectionMembers(db, call)
    }
    expect(await membersOf(collection)).toHaveLength(2)
    expect(await feedOf(collection)).toEqual(before.collection)

    await removeCollectionMembers(db, {
      id: `${prefix}-a`,
      actorId: owner,
      targetActorIds: [t1]
    })
    expect(await membersOf(collection)).toEqual([`${t2}:pending`])
    expect(await feedOf(collection)).toEqual(
      before.collection.filter((row) => row.startsWith(p2))
    )
    expect(await membersOf(neighbour)).toEqual([`${t1}:pending`])
    expect(await feedOf(neighbour)).toEqual(before.neighbour)
  })
})

describe('setOwnCollectionMembershipState', () => {
  it('changes the caller’s own membership of that collection only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const [t, u] = [1, 2].map((n) => actorIn('m.test', `${prefix}-t${n}`))
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-b`, owner })
    await seedMember({ collectionSeq: collection, targetActorId: t })
    await seedMember({ collectionSeq: collection, targetActorId: u })
    await seedMember({ collectionSeq: neighbour, targetActorId: t })

    expect(
      await setOwnCollectionMembershipState(db, {
        collectionId: `${prefix}-a`,
        actorId: t,
        state: 'approved'
      })
    ).toBe(true)
    expect(await membersOf(collection)).toEqual([
      `${t}:approved`,
      `${u}:pending`
    ])
    expect(await membersOf(neighbour)).toEqual([`${t}:pending`])

    expect(
      await setOwnCollectionMembershipState(db, {
        collectionId: `${prefix}-a`,
        actorId: t,
        state: 'revoked'
      })
    ).toBe(true)
    expect(await membersOf(collection)).toEqual([
      `${t}:revoked`,
      `${u}:pending`
    ])

    expect(
      await setOwnCollectionMembershipState(db, {
        collectionId: `${prefix}-a`,
        actorId: actorIn('m.test', `${prefix}-nobody`),
        state: 'approved'
      })
    ).toBe(false)
    expect(
      await setOwnCollectionMembershipState(db, {
        collectionId: `${prefix}-none`,
        actorId: t,
        state: 'approved'
      })
    ).toBe(false)
    expect(await membersOf(neighbour)).toEqual([`${t}:pending`])
  })
})

describe('getCollectionMembers', () => {
  // Members 1..5, ids sorting against time, 2 and 3 added at the same time
  // and written out of id order, with actor ids that sort against their
  // member ids too, so neither the write order nor the (collectionSeq,
  // targetActorId) index puts the tie in id order; 2 and 5 approved.
  // Neighbours: a member of the owner's other collection, and of another
  // owner's.
  const setup = async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-b`, owner })
    const foreign = await seedCollection({ id: `${prefix}-c`, owner: other })
    const plan: [number, number, string, CollectionFeatureState][] = [
      [1, 1000, '5', 'pending'],
      [3, 2000, '3', 'pending'],
      [2, 2000, '4', 'approved'],
      [4, 3000, '2', 'pending'],
      [5, 4000, '1', 'approved']
    ]
    const ids: Record<number, string> = {}
    const members: Record<number, string> = {}
    for (const [n, offset, idDigit, featureState] of plan) {
      members[n] = actorIn('m.test', `${prefix}-member${10 - n}`)
      ids[n] = (
        await seedMember({
          collectionSeq: collection,
          targetActorId: members[n],
          featureState,
          createdAt: BASE + offset,
          id: `${prefix}-id${idDigit}`
        })
      ).id
    }
    const neighbourId = (
      await seedMember({
        collectionSeq: neighbour,
        targetActorId: actorIn('m.test', `${prefix}-member11`),
        createdAt: BASE + 2500,
        id: `${prefix}-id6`
      })
    ).id
    await seedMember({
      collectionSeq: foreign,
      targetActorId: actorIn('m.test', `${prefix}-member12`),
      createdAt: BASE + 2500
    })
    return { prefix, owner, other, ids, members, neighbourId }
  }

  it.each([
    { cursor: {}, limit: 40, expected: [5, 4, 2, 3, 1] },
    { cursor: {}, limit: 2, expected: [5, 4] },
    { cursor: { maxId: 2 }, limit: 40, expected: [3, 1] },
    { cursor: { maxId: 4 }, limit: 2, expected: [2, 3] },
    { cursor: { sinceId: 3 }, limit: 40, expected: [5, 4, 2] },
    { cursor: { sinceId: 1 }, limit: 1, expected: [5] },
    { cursor: { sinceId: 3, maxId: 5 }, limit: 40, expected: [4, 2] },
    {
      cursor: {},
      limit: 40,
      projection: 'public' as const,
      expected: [5, 2]
    },
    {
      cursor: { maxId: 4 },
      limit: 40,
      projection: 'public' as const,
      expected: [2]
    }
  ])(
    'pages on (createdAt, id) with $cursor, limit $limit and $projection projection',
    async ({ cursor, limit, projection, expected }) => {
      const s = await setup()
      vi.mocked(getMastodonActors).mockClear()
      const page = await getCollectionMembers(db, {
        id: `${s.prefix}-a`,
        actorId: s.owner,
        limit,
        ...(projection ? { projection } : null),
        ...Object.fromEntries(
          Object.entries(cursor).map(([key, n]) => [key, s.ids[n]])
        )
      })
      const targets = expected.map((n) => s.members[n])
      expect(page.accounts.map((account) => account.id)).toEqual(targets)
      expect(getMastodonActors).toHaveBeenCalledTimes(1)
      expect(getMastodonActors).toHaveBeenCalledWith(db, targets)
      expect(page.prevMinId).toBe(s.ids[expected[0]])
      expect(page.nextMaxId).toBe(s.ids[expected[expected.length - 1]])
    }
  )

  it('applies no bound for an unknown or another collection’s cursor, and reads nothing for another owner', async () => {
    const s = await setup()
    const all = [5, 4, 2, 3, 1].map((n) => s.members[n])
    for (const cursor of [
      { maxId: `${s.prefix}-missing` },
      { sinceId: s.neighbourId }
    ]) {
      const page = await getCollectionMembers(db, {
        id: `${s.prefix}-a`,
        actorId: s.owner,
        ...cursor
      })
      expect(page.accounts.map((account) => account.id)).toEqual(all)
    }
    expect(
      await getCollectionMembers(db, { id: `${s.prefix}-a`, actorId: s.other })
    ).toEqual({ accounts: [], nextMaxId: null, prevMinId: null })
  })

  it('pages members without a createdAt on their id only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const members: string[] = []
    const ids: string[] = []
    for (const n of [1, 2, 3]) {
      members.push(actorIn('m.test', `${prefix}-member${n}`))
      ids.push(
        (
          await seedMember({
            collectionSeq: collection,
            targetActorId: members[n - 1],
            createdAt: null,
            id: `${prefix}-n${n}`
          })
        ).id
      )
    }
    await seedMember({
      collectionSeq: collection,
      targetActorId: actorIn('m.test', `${prefix}-member4`),
      createdAt: BASE
    })
    const page = async (cursor: Record<string, string>) =>
      (
        await getCollectionMembers(db, {
          id: `${prefix}-a`,
          actorId: owner,
          ...cursor
        })
      ).accounts.map((account) => account.id)
    expect(await page({ maxId: ids[1] })).toEqual([members[0]])
    expect(await page({ sinceId: ids[1] })).toEqual([members[2]])
  })
})

describe('getApprovedCollectionMembers', () => {
  it('returns the approved members oldest first, with each actor type', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [m1, m2, m3, m4] = [1, 2, 3, 4].map((n) =>
      actorIn('m.test', `${prefix}-m${n}`)
    )
    await db
      .insertInto('actors')
      .values({
        id: m1,
        username: `${prefix}-m1`,
        domain: 'm.test',
        type: 'Service',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-b`, owner })
    // m1 and m4 tie, written out of id order.
    await seedMember({
      collectionSeq: collection,
      targetActorId: m1,
      featureState: 'approved',
      createdAt: BASE + 2000,
      id: `${prefix}-id2`
    })
    await seedMember({
      collectionSeq: collection,
      targetActorId: m2,
      featureState: 'approved',
      createdAt: BASE + 3000,
      id: `${prefix}-id0`
    })
    await seedMember({
      collectionSeq: collection,
      targetActorId: m4,
      featureState: 'approved',
      createdAt: BASE + 2000,
      id: `${prefix}-id1`
    })
    await seedMember({
      collectionSeq: collection,
      targetActorId: m3,
      createdAt: BASE
    })
    await seedMember({
      collectionSeq: neighbour,
      targetActorId: m3,
      featureState: 'approved',
      createdAt: BASE
    })

    expect(
      await getApprovedCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: owner
      })
    ).toEqual([
      { id: m4, type: 'Person' },
      { id: m1, type: 'Service' },
      { id: m2, type: 'Person' }
    ])
    expect(
      await getApprovedCollectionMembers(db, {
        id: `${prefix}-a`,
        actorId: other
      })
    ).toEqual([])
  })
})

describe('collection items', () => {
  const setup = async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [t1, t2, t3, t4] = [1, 2, 3, 4].map((n) =>
      actorIn('m.test', `${prefix}-t${n}`)
    )
    const a = await seedCollection({ id: `${prefix}-a`, owner })
    const b = await seedCollection({ id: `${prefix}-b`, owner: other })
    const c = await seedCollection({ id: `${prefix}-c`, owner })
    // In a: t1 and t3 tie, written out of id order; t1 approved.
    const i1 = await seedMember({
      collectionSeq: a,
      targetActorId: t1,
      featureState: 'approved',
      createdAt: BASE + 2000,
      id: `${prefix}-i2`
    })
    const i2 = await seedMember({
      collectionSeq: a,
      targetActorId: t2,
      createdAt: BASE + 1000,
      id: `${prefix}-i3`
    })
    const i3 = await seedMember({
      collectionSeq: a,
      targetActorId: t3,
      createdAt: BASE + 2000,
      id: `${prefix}-i1`
    })
    const j1 = await seedMember({
      collectionSeq: b,
      targetActorId: t1,
      featureState: 'approved',
      createdAt: BASE,
      id: `${prefix}-j1`
    })
    await seedMember({
      collectionSeq: c,
      targetActorId: t4,
      featureState: 'approved',
      createdAt: BASE
    })
    const item = (
      member: { id: string },
      targetActorId: string,
      featureState: CollectionFeatureState,
      createdAt: number
    ) => ({ id: member.id, targetActorId, featureState, createdAt })
    return {
      prefix,
      items: {
        i1: item(i1, t1, 'approved', BASE + 2000),
        i2: item(i2, t2, 'pending', BASE + 1000),
        i3: item(i3, t3, 'pending', BASE + 2000),
        j1: item(j1, t1, 'approved', BASE)
      },
      targets: { t1, t2, t3, t4 }
    }
  }

  it('reads each requested collection’s items oldest first, in chunks or a bounded preview', async () => {
    const s = await setup()
    const { i1, i2, i3, j1 } = s.items
    const ids = [`${s.prefix}-a`, `${s.prefix}-b`, `${s.prefix}-none`]
    expect(await getCollectionItems(db, { collectionIds: ids })).toEqual({
      [`${s.prefix}-a`]: [i2, i3, i1],
      [`${s.prefix}-b`]: [j1],
      [`${s.prefix}-none`]: []
    })
    expect(
      await getCollectionItems(db, { collectionIds: ids, approvedOnly: true })
    ).toEqual({
      [`${s.prefix}-a`]: [i1],
      [`${s.prefix}-b`]: [j1],
      [`${s.prefix}-none`]: []
    })
    expect(
      await getCollectionItems(db, {
        collectionIds: [...ids, `${s.prefix}-a`],
        limitPerCollection: 2
      })
    ).toEqual({
      [`${s.prefix}-a`]: [i2, i3],
      [`${s.prefix}-b`]: [j1],
      [`${s.prefix}-none`]: []
    })
    expect(
      await getCollectionItems(db, {
        collectionIds: ids,
        approvedOnly: true,
        limitPerCollection: 1
      })
    ).toEqual({
      [`${s.prefix}-a`]: [i1],
      [`${s.prefix}-b`]: [j1],
      [`${s.prefix}-none`]: []
    })
    expect(await getCollectionItems(db, { collectionIds: [] })).toEqual({})
  })

  it('reads one item of a collection by id or by account', async () => {
    const s = await setup()
    const { i3, j1 } = s.items
    const a = `${s.prefix}-a`
    expect(
      await getCollectionItem(db, { collectionId: a, itemId: i3.id })
    ).toEqual(i3)
    expect(
      await getCollectionItem(db, { collectionId: a, itemId: j1.id })
    ).toBeNull()
    expect(
      await getCollectionItemByAccount(db, {
        collectionId: `${s.prefix}-b`,
        targetActorId: s.targets.t1
      })
    ).toEqual(j1)
    expect(
      await getCollectionItemByAccount(db, {
        collectionId: a,
        targetActorId: s.targets.t4
      })
    ).toBeNull()
  })

  it('counts the items of any owner’s collections', async () => {
    const s = await setup()
    const ids = [`${s.prefix}-a`, `${s.prefix}-b`, `${s.prefix}-none`]
    expect(await countCollectionItems(db, { collectionIds: ids })).toEqual({
      [`${s.prefix}-a`]: 3,
      [`${s.prefix}-b`]: 1,
      [`${s.prefix}-none`]: 0
    })
    expect(
      await countCollectionItems(db, { collectionIds: ids, approvedOnly: true })
    ).toEqual({
      [`${s.prefix}-a`]: 1,
      [`${s.prefix}-b`]: 1,
      [`${s.prefix}-none`]: 0
    })
    expect(await countCollectionItems(db, { collectionIds: [] })).toEqual({})
  })

  it('reads an item without a createdAt as 0', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const { id } = await seedMember({
      collectionSeq: collection,
      targetActorId: actorIn('m.test', `${prefix}-t`),
      createdAt: null
    })
    expect(
      await getCollectionItem(db, { collectionId: `${prefix}-a`, itemId: id })
    ).toMatchObject({ id, createdAt: 0 })
  })
})

describe('collection listings', () => {
  it('lists an owner’s collections by createdAt then seq, paged', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [lowSeq, highSeq] = explicitKeys(2)
    // c1 and c3 tie on createdAt and are written out of seq order.
    await seedCollection({
      id: `${prefix}-c1`,
      owner,
      createdAt: BASE + 2000,
      seq: highSeq
    })
    await seedCollection({
      id: `${prefix}-c2`,
      owner,
      createdAt: BASE + 1000,
      visibility: 'unlisted'
    })
    await seedCollection({
      id: `${prefix}-c3`,
      owner,
      createdAt: BASE + 2000,
      seq: lowSeq,
      visibility: 'private'
    })
    await seedCollection({
      id: `${prefix}-c4`,
      owner,
      createdAt: BASE + 3000
    })
    await seedCollection({ id: `${prefix}-o1`, owner: other, createdAt: BASE })
    const list = async (params: {
      publicOnly?: boolean
      limit?: number
      offset?: number
    }) =>
      (await getAccountCollections(db, { ownerActorId: owner, ...params })).map(
        ({ id }) => id.slice(prefix.length + 1)
      )

    expect(await list({})).toEqual(['c2', 'c3', 'c1', 'c4'])
    expect(await list({ publicOnly: true })).toEqual(['c1', 'c4'])
    expect(await list({ limit: 2 })).toEqual(['c2', 'c3'])
    expect(await list({ limit: 2, offset: 1 })).toEqual(['c3', 'c1'])
    expect(await list({ offset: 3 })).toEqual(['c4'])
  })

  it('lists the collections featuring an account that the viewer may see', async () => {
    const prefix = nextPrefix()
    const viewer = actorIn('home.test', `${prefix}-viewer`)
    const other = actorIn('home.test', `${prefix}-other`)
    const target = actorIn('m.test', `${prefix}-target`)
    const someoneElse = actorIn('m.test', `${prefix}-someone`)
    const plan: [
      string,
      string,
      string,
      number,
      string,
      CollectionFeatureState
    ][] = [
      // key, owner, visibility, createdAt offset, member, state
      ['own-private', viewer, 'private', 3000, target, 'pending'],
      ['public-approved', other, 'public', 1000, target, 'approved'],
      ['public-pending', other, 'public', 500, target, 'pending'],
      ['private-approved', other, 'private', 600, target, 'approved'],
      ['unlisted-approved', other, 'unlisted', 700, target, 'approved'],
      ['public-other-member', other, 'public', 800, someoneElse, 'approved'],
      ['own-public-revoked', viewer, 'public', 2000, target, 'revoked']
    ]
    for (const [key, owner, visibility, offset, member, featureState] of plan) {
      const seq = await seedCollection({
        id: `${prefix}-${key}`,
        owner,
        visibility,
        createdAt: BASE + offset
      })
      await seedMember({
        collectionSeq: seq,
        targetActorId: member,
        featureState
      })
    }
    const list = async (limit?: number, offset?: number) =>
      (
        await getCollectionsFeaturingAccount(db, {
          targetActorId: target,
          viewerActorId: viewer,
          ...(limit === undefined ? null : { limit }),
          ...(offset === undefined ? null : { offset })
        })
      ).map(({ id }) => id.slice(prefix.length + 1))

    expect(await list()).toEqual([
      'public-approved',
      'own-public-revoked',
      'own-private'
    ])
    expect(await list(2)).toEqual(['public-approved', 'own-public-revoked'])
    expect(await list(2, 1)).toEqual(['own-public-revoked', 'own-private'])
  })
})

describe('removeCollectionItemById', () => {
  it('removes the item and its feed rows from the owner’s collection only', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [t1, t2] = [1, 2].map((n) => actorIn('m.test', `${prefix}-t${n}`))
    const p1 = await seedStatus({ id: `${t1}/statuses/1`, actorId: t1 })
    const p2 = await seedStatus({ id: `${t2}/statuses/1`, actorId: t2 })
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-b`, owner })
    const items: Record<string, string> = {}
    for (const [key, collectionSeq, target, post] of [
      ['i1', collection, t1, p1],
      ['i2', collection, t2, p2],
      ['j1', neighbour, t1, p1]
    ] as const) {
      const member = await seedMember({ collectionSeq, targetActorId: target })
      items[key] = member.id
      await seedFeedRow({
        collectionSeq,
        memberSeq: member.seq,
        statusId: post,
        sortKey: BASE
      })
    }
    const neighbourFeed = await feedOf(neighbour)

    for (const call of [
      { id: `${prefix}-a`, actorId: owner, itemId: items.j1 },
      { id: `${prefix}-a`, actorId: other, itemId: items.i1 },
      { id: `${prefix}-a`, actorId: owner, itemId: `${prefix}-none` }
    ]) {
      expect(await removeCollectionItemById(db, call)).toBe(false)
    }
    expect(await membersOf(collection)).toHaveLength(2)

    expect(
      await removeCollectionItemById(db, {
        id: `${prefix}-a`,
        actorId: owner,
        itemId: items.i1
      })
    ).toBe(true)
    expect(await membersOf(collection)).toEqual([`${t2}:pending`])
    expect((await feedOf(collection)).map((row) => row.split('@')[0])).toEqual([
      p2
    ])
    expect(await membersOf(neighbour)).toEqual([`${t1}:pending`])
    expect(await feedOf(neighbour)).toEqual(neighbourFeed)
  })
})

describe('collection feed', () => {
  // Owner O's collection holds a (approved), b (pending), c (approved, blocked
  // by O) and d (approved, muted by O). Each feed row's sortKey is its
  // status's createdAt. O's other collection holds a's newest post.
  const setup = async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) =>
      actorIn('m.test', `${prefix}-${name}`)
    )
    const collection = await seedCollection({ id: `${prefix}-feed`, owner })
    const neighbour = await seedCollection({ id: `${prefix}-other`, owner })
    const seqs: Record<string, number> = {}
    for (const [name, actorId, featureState] of [
      ['a', a, 'approved'],
      ['b', b, 'pending'],
      ['c', c, 'approved'],
      ['d', d, 'approved']
    ] as const) {
      seqs[name] = (
        await seedMember({
          collectionSeq: collection,
          targetActorId: actorId,
          featureState
        })
      ).seq
    }
    const { seq: neighbourSeq } = await seedMember({
      collectionSeq: neighbour,
      targetActorId: a,
      featureState: 'approved'
    })
    await db
      .insertInto('blocks')
      .values({
        id: `${prefix}-block`,
        actorId: owner,
        actorHost: 'home.test',
        targetActorId: c,
        targetActorHost: 'm.test',
        uri: `${owner}#blocks/${prefix}`
      })
      .execute()
    await db
      .insertInto('mutes')
      .values({
        id: `${prefix}-mute`,
        actorId: owner,
        actorHost: 'home.test',
        targetActorId: d,
        targetActorHost: 'm.test',
        notifications: true,
        endsAt: null
      })
      .execute()

    const statuses: Record<string, string> = {}
    const [tieLow, tieHigh] = explicitKeys(2)
    const rowIds = { tieLow, tieHigh }
    // key, author, sortKey offset, recipients, explicit feed row id
    const plan: [
      string,
      'a' | 'b' | 'c' | 'd',
      number,
      string[],
      number | undefined
    ][] = [
      ['pub1', 'a', 1000, [ACTIVITY_STREAM_PUBLIC], undefined],
      // A sortKey tie, written out of row id order.
      ['tieHigh', 'a', 1500, [ACTIVITY_STREAM_PUBLIC], rowIds.tieHigh],
      ['tieLow', 'a', 1500, [ACTIVITY_STREAM_PUBLIC], rowIds.tieLow],
      ['pub2', 'a', 2000, [ACTIVITY_STREAM_PUBLIC], undefined],
      ['followersOnly', 'a', 3000, [`${a}/followers`], undefined],
      ['direct', 'a', 4000, [owner], undefined],
      ['pending', 'b', 5000, [ACTIVITY_STREAM_PUBLIC], undefined],
      ['blocked', 'c', 6000, [ACTIVITY_STREAM_PUBLIC], undefined],
      ['muted', 'd', 7000, [ACTIVITY_STREAM_PUBLIC], undefined]
    ]
    const actorOf = { a, b, c, d }
    for (const [key, author, offset, to, id] of plan) {
      statuses[key] = await seedStatus({
        id: `${actorOf[author]}/statuses/${key}`,
        actorId: actorOf[author],
        createdAt: BASE + offset,
        to
      })
      await seedFeedRow({
        collectionSeq: collection,
        memberSeq: seqs[author],
        statusId: statuses[key],
        sortKey: BASE + offset,
        id
      })
    }
    // A public boost of the followers-only note.
    statuses.boost = await seedStatus({
      id: `${a}/statuses/boost`,
      actorId: a,
      createdAt: BASE + 8000,
      type: StatusType.enum.Announce,
      originalStatusId: statuses.followersOnly
    })
    await seedFeedRow({
      collectionSeq: collection,
      memberSeq: seqs.a,
      statusId: statuses.boost,
      sortKey: BASE + 8000
    })
    // A row of the neighbour's feed, and statuses that are in no feed.
    statuses.elsewhere = await seedStatus({
      id: `${a}/statuses/elsewhere`,
      actorId: a,
      createdAt: BASE + 9000
    })
    // Its sortKey there is not its createdAt, so a cursor that read the row
    // from the wrong feed would page differently.
    await seedFeedRow({
      collectionSeq: neighbour,
      memberSeq: neighbourSeq,
      statusId: statuses.elsewhere,
      sortKey: BASE + 500
    })
    statuses.outsideTie = await seedStatus({
      id: `${a}/statuses/outside-tie`,
      actorId: a,
      createdAt: BASE + 1500
    })
    statuses.undated = await seedStatus({
      id: `${a}/statuses/undated`,
      actorId: a,
      createdAt: null
    })
    // Stored nowhere.
    statuses.missing = `${a}/statuses/missing`
    return { prefix, owner, statuses }
  }

  const OWNER_ORDER = [
    'boost',
    'pending',
    'direct',
    'pub2',
    'tieHigh',
    'tieLow',
    'pub1'
  ]
  const PUBLIC_ORDER = ['muted', 'blocked', 'pub2', 'tieHigh', 'tieLow', 'pub1']

  it.each([
    { cursor: {}, limit: 40, expected: OWNER_ORDER },
    { cursor: {}, limit: 2, expected: ['boost', 'pending'] },
    {
      cursor: { maxStatusId: 'pub2' },
      limit: 40,
      expected: OWNER_ORDER.slice(4)
    },
    {
      cursor: { maxStatusId: 'tieHigh' },
      limit: 40,
      expected: ['tieLow', 'pub1']
    },
    {
      cursor: { minStatusId: 'tieLow' },
      limit: 40,
      expected: OWNER_ORDER.slice(0, 5)
    },
    {
      cursor: { minStatusId: 'pub1', maxStatusId: 'direct' },
      limit: 40,
      expected: ['pub2', 'tieHigh', 'tieLow']
    },
    // Not in this feed: the status's createdAt with no row id.
    { cursor: { maxStatusId: 'outsideTie' }, limit: 40, expected: ['pub1'] },
    {
      cursor: { minStatusId: 'outsideTie' },
      limit: 2,
      expected: ['boost', 'pending']
    },
    { cursor: { minStatusId: 'elsewhere' }, limit: 40, expected: [] },
    // Without a createdAt, as if it were 0.
    { cursor: { maxStatusId: 'undated' }, limit: 40, expected: [] },
    { cursor: { minStatusId: 'undated' }, limit: 40, expected: OWNER_ORDER },
    { cursor: { maxStatusId: 'missing' }, limit: 40, expected: [] },
    { cursor: { minStatusId: 'missing' }, limit: 40, expected: [] }
  ])(
    'reads the owner projection with $cursor and limit $limit',
    async ({ cursor, limit, expected }) => {
      const s = await setup()
      statusCalls.length = 0
      const statuses = await getCollectionTimeline(db, statusesSource, {
        id: `${s.prefix}-feed`,
        actorId: s.owner,
        limit,
        ...Object.fromEntries(
          Object.entries(cursor).map(([key, name]) => [key, s.statuses[name]])
        )
      })
      const ids = expected.map((key) => s.statuses[key])
      expect(statuses.map((status) => status.id)).toEqual(ids)
      // Hydrated once as the owner, or not at all for an empty page.
      expect(statusCalls).toEqual(ids.length > 0 ? [[ids, s.owner]] : [])
    }
  )

  it.each([
    { cursor: {}, limit: 40, expected: PUBLIC_ORDER },
    { cursor: {}, limit: 3, expected: PUBLIC_ORDER.slice(0, 3) },
    {
      cursor: { maxStatusId: 'blocked' },
      limit: 2,
      expected: ['pub2', 'tieHigh']
    },
    {
      cursor: { minStatusId: 'tieLow' },
      limit: 40,
      expected: PUBLIC_ORDER.slice(0, 4)
    }
  ])(
    'reads the public projection with $cursor and limit $limit',
    async ({ cursor, limit, expected }) => {
      const s = await setup()
      const args = Object.fromEntries(
        Object.entries(cursor).map(([key, name]) => [key, s.statuses[name]])
      )
      const ids = expected.map((key) => s.statuses[key])
      statusCalls.length = 0
      const statuses = await getPublicCollectionTimeline(db, statusesSource, {
        id: `${s.prefix}-feed`,
        limit,
        ...args
      })
      expect(statuses?.map((status) => status.id)).toEqual(ids)
      // The owner's own read of the public projection.
      const projected = await getCollectionTimeline(db, statusesSource, {
        id: `${s.prefix}-feed`,
        actorId: s.owner,
        projection: 'public',
        limit,
        ...args
      })
      expect(projected.map((status) => status.id)).toEqual(ids)
      expect(statusCalls).toEqual([
        [ids, undefined],
        [ids, s.owner]
      ])
    }
  )

  it('hydrates for the viewer, and reads nothing for another owner', async () => {
    const s = await setup()
    const viewer = actorIn('home.test', `${s.prefix}-viewer`)
    statusCalls.length = 0
    await getCollectionTimeline(db, statusesSource, {
      id: `${s.prefix}-feed`,
      actorId: s.owner,
      currentActorId: viewer,
      limit: 1
    })
    await getPublicCollectionTimeline(db, statusesSource, {
      id: `${s.prefix}-feed`,
      currentActorId: viewer,
      limit: 1
    })
    expect(statusCalls).toEqual([
      [[s.statuses.boost], viewer],
      [[s.statuses.muted], viewer]
    ])

    statusCalls.length = 0
    expect(
      await getCollectionTimeline(db, statusesSource, {
        id: `${s.prefix}-feed`,
        actorId: viewer
      })
    ).toEqual([])
    expect(statusCalls).toEqual([])
  })

  it('serves a public feed only for a collection that is not private and has its feed on', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    for (const [key, visibility, publicFeed] of [
      ['private', 'private', true],
      ['off', 'public', false],
      ['unlisted', 'unlisted', true]
    ] as const) {
      const seq = await seedCollection({
        id: `${prefix}-${key}`,
        owner,
        visibility,
        publicFeed
      })
      const { seq: memberSeq } = await seedMember({
        collectionSeq: seq,
        targetActorId: member,
        featureState: 'approved'
      })
      await seedFeedRow({
        collectionSeq: seq,
        memberSeq,
        statusId: post,
        sortKey: BASE
      })
    }
    const read = (key: string) =>
      getPublicCollectionTimeline(db, statusesSource, {
        id: `${prefix}-${key}`
      })
    expect(await read('private')).toBeNull()
    expect(await read('off')).toBeNull()
    expect(await read('none')).toBeNull()
    expect((await read('unlisted'))?.map((status) => status.id)).toEqual([post])
  })
})

describe('addStatusToCollectionTimelines', () => {
  it('fans a status into every collection holding its author, once', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const other = actorIn('home.test', `${prefix}-other`)
    const author = actorIn('m.test', `${prefix}-author`)
    const bystander = actorIn('m.test', `${prefix}-bystander`)
    const plan: [string, string, string, CollectionFeatureState][] = [
      ['a', owner, author, 'approved'],
      ['b', owner, author, 'pending'],
      ['c', other, author, 'revoked'],
      ['d', owner, bystander, 'approved']
    ]
    const seqs: Record<string, number> = {}
    const memberSeqs: Record<string, number> = {}
    for (const [key, collectionOwner, member, featureState] of plan) {
      seqs[key] = await seedCollection({
        id: `${prefix}-${key}`,
        owner: collectionOwner
      })
      memberSeqs[key] = (
        await seedMember({
          collectionSeq: seqs[key],
          targetActorId: member,
          featureState
        })
      ).seq
    }
    const status = {
      id: `${author}/statuses/1`,
      actorId: author,
      createdAt: BASE + 5000
    } as unknown as Status

    await addStatusToCollectionTimelines(db, { status })
    await addStatusToCollectionTimelines(db, { status })
    for (const key of ['a', 'b', 'c']) {
      expect(await feedOf(seqs[key])).toEqual([
        `${status.id}@${BASE + 5000}#${memberSeqs[key]}`
      ])
    }
    expect(await feedOf(seqs.d)).toEqual([])

    await addStatusToCollectionTimelines(db, {
      status: {
        id: `${prefix}-nobody/statuses/1`,
        actorId: actorIn('m.test', `${prefix}-nobody`),
        createdAt: BASE
      } as unknown as Status
    })
    expect(await feedOf(seqs.d)).toEqual([])
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
  const name = `collection_queries_fail_${event}_${table}`.toLowerCase()
  const record = event === 'delete' ? 'old' : 'new'
  const literal = `'${value.replaceAll("'", "''")}'`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function collection_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db)
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${record}."${column}" = ${literal}) execute function collection_queries_fail()`
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

const dumpTables = async () => ({
  collections: await db
    .selectFrom('collections')
    .selectAll()
    .orderBy('seq')
    .execute(),
  collection_members: await db
    .selectFrom('collection_members')
    .selectAll()
    .orderBy('seq')
    .execute(),
  collection_timeline: await db
    .selectFrom('collection_timeline')
    .selectAll()
    .orderBy('id')
    .execute()
})

describe('transactions', () => {
  // A collection with one member and one feed row, for the removals.
  const setup = async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    const collection = await seedCollection({ id: `${prefix}-a`, owner })
    const item = await seedMember({
      collectionSeq: collection,
      targetActorId: member
    })
    await seedFeedRow({
      collectionSeq: collection,
      memberSeq: item.seq,
      statusId: post,
      sortKey: BASE
    })
    return { prefix, owner, member, post, item }
  }

  const expectRolledBack = async (
    drop: () => Promise<unknown>,
    run: () => Promise<unknown>
  ) => {
    const before = await dumpTables()
    try {
      await expect(run()).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  }

  it('createCollection writes nothing when its insert fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    await expectRolledBack(
      await failWrite('collections', 'insert', 'title', `${prefix}-title`),
      () => createCollection(db, { actorId: owner, title: `${prefix}-title` })
    )
  })

  it('deleteCollection keeps everything when deleting the collection row fails', async () => {
    const s = await setup()
    await expectRolledBack(
      await failWrite('collections', 'delete', 'id', `${s.prefix}-a`),
      () => deleteCollection(db, { id: `${s.prefix}-a`, actorId: s.owner })
    )
  })

  it('addCollectionMembers keeps nothing when the backfill fails', async () => {
    const prefix = nextPrefix()
    const owner = actorIn('home.test', `${prefix}-owner`)
    const member = actorIn('m.test', `${prefix}-member`)
    const post = await seedStatus({
      id: `${member}/statuses/1`,
      actorId: member
    })
    await seedCollection({ id: `${prefix}-a`, owner })
    await expectRolledBack(
      await failWrite('collection_timeline', 'insert', 'statusId', post),
      () =>
        addCollectionMembers(db, {
          id: `${prefix}-a`,
          actorId: owner,
          targetActorIds: [member]
        })
    )
  })

  it('removeCollectionMembers keeps the feed when removing the member fails', async () => {
    const s = await setup()
    await expectRolledBack(
      await failWrite(
        'collection_members',
        'delete',
        'targetActorId',
        s.member
      ),
      () =>
        removeCollectionMembers(db, {
          id: `${s.prefix}-a`,
          actorId: s.owner,
          targetActorIds: [s.member]
        })
    )
  })

  it('removeCollectionItemById keeps the feed when removing the item fails', async () => {
    const s = await setup()
    await expectRolledBack(
      await failWrite('collection_members', 'delete', 'id', s.item.id),
      () =>
        removeCollectionItemById(db, {
          id: `${s.prefix}-a`,
          actorId: s.owner,
          itemId: s.item.id
        })
    )
  })
})
