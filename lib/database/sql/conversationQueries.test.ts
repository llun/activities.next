import knexFactory, { type Knex } from 'knex'
import {
  InsertQueryNode,
  type KyselyPlugin,
  type RootOperationNode,
  SelectQueryNode,
  TableNode
} from 'kysely'
import { randomUUID } from 'node:crypto'

import { getConversationIdForRootStatusId } from '@/lib/database/domains/conversation/ordering'
import {
  type ConversationStatusSource,
  createConversationQueries
} from '@/lib/database/domains/conversation/queries'
import { type Db, kyselyFor } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Query-level tests for the direct conversation domain. Every test uses its
// own actors and conversations and puts neighbouring rows (another actor's
// memberships, another conversation's statuses and participants, other
// blocks) next to them, so a dropped predicate shows up as a wrong row.

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
const actorIdOf = (name: string) => `https://cq.test/users/${name}`

const statusObject = ({
  id,
  url = id,
  actorId,
  to = [],
  cc = [],
  reply = '',
  createdAt,
  type = StatusType.enum.Note
}: {
  id: string
  url?: string
  actorId: string
  to?: string[]
  cc?: string[]
  reply?: string
  createdAt: number
  type?: StatusType
}): Status =>
  ({
    id,
    url,
    actorId,
    actor: null,
    type,
    text: id,
    summary: '',
    reply,
    to,
    cc,
    createdAt,
    updatedAt: createdAt,
    attachments: [],
    mentions: [],
    likesCount: 0,
    repliesCount: 0,
    reblogsCount: 0,
    liked: false,
    bookmarked: false
  }) as unknown as Status

// A status row with its recipients (what reply resolution reads), returned as
// the domain object syncDirectConversationForStatus takes.
const seedStatus = async (params: Parameters<typeof statusObject>[0]) => {
  const status = statusObject(params)
  const url = params.url ?? params.id
  await db
    .insertInto('statuses')
    .values({
      id: params.id,
      url,
      urlHash: getHashFromString(url),
      actorId: params.actorId,
      type: params.type ?? StatusType.enum.Note,
      reply: params.reply ?? '',
      createdAt: new Date(params.createdAt),
      updatedAt: new Date(params.createdAt)
    })
    .execute()
  const recipients = [
    ...(params.to ?? []).map((actorId) => ({ actorId, type: 'to' })),
    ...(params.cc ?? []).map((actorId) => ({ actorId, type: 'cc' }))
  ]
  if (recipients.length > 0) {
    await db
      .insertInto('recipients')
      .values(
        recipients.map((recipient) => ({
          id: randomUUID(),
          statusId: params.id,
          ...recipient
        }))
      )
      .execute()
  }
  return status
}

// A local actor holds a private key; a remote one stores none (or, on rows
// written by older code, an empty string).
const seedActor = async (id: string, local: boolean, privateKey = '') => {
  await db
    .insertInto('actors')
    .values({
      id,
      username: id.split('/').pop() ?? id,
      domain: 'cq.test',
      privateKey: local ? 'private-key' : privateKey || null
    })
    .execute()
  return id
}

const seedBlock = async (actorId: string, targetActorId: string) => {
  await db
    .insertInto('blocks')
    .values({
      id: randomUUID(),
      actorId,
      targetActorId,
      actorHost: 'cq.test',
      targetActorHost: 'cq.test',
      uri: `${actorId}#blocks/${randomUUID()}`
    })
    .execute()
}

const seedConversation = async ({
  id,
  participants = [],
  statuses = []
}: {
  id: string
  participants?: string[]
  statuses?: [statusId: string, createdAt: number][]
}) => {
  await db
    .insertInto('direct_conversations')
    .values({
      id,
      rootStatusId: statuses[0]?.[0] ?? `${id}/root`,
      createdAt: new Date(1),
      updatedAt: new Date(1)
    })
    .execute()
  if (participants.length > 0) {
    await db
      .insertInto('direct_conversation_participants')
      .values(
        participants.map((actorId) => ({
          id: randomUUID(),
          conversationId: id,
          actorId,
          createdAt: new Date(1),
          updatedAt: new Date(1)
        }))
      )
      .execute()
  }
  for (const [statusId, createdAt] of statuses) {
    await db
      .insertInto('direct_conversation_statuses')
      .values({
        conversationId: id,
        statusId,
        createdAt: new Date(createdAt),
        updatedAt: new Date(1)
      })
      .execute()
  }
}

const seedMembership = async ({
  actorId,
  conversationId,
  lastStatusId,
  lastStatusCreatedAt,
  unread = false,
  readAt = null,
  hiddenAt = null
}: {
  actorId: string
  conversationId: string
  lastStatusId: string
  lastStatusCreatedAt: number
  unread?: boolean
  readAt?: number | null
  hiddenAt?: number | null
}) => {
  const row = await db
    .insertInto('direct_conversation_memberships')
    .values({
      actorId,
      conversationId,
      lastStatusId,
      lastStatusCreatedAt: new Date(lastStatusCreatedAt),
      unread,
      readAt: readAt === null ? null : new Date(readAt),
      hiddenAt: hiddenAt === null ? null : new Date(hiddenAt),
      createdAt: new Date(5),
      updatedAt: new Date(5)
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return String(row.id)
}

const readMembership = (id: string) =>
  db
    .selectFrom('direct_conversation_memberships')
    .select([
      'actorId',
      'conversationId',
      'lastStatusId',
      'lastStatusCreatedAt',
      'unread',
      'readAt',
      'hiddenAt',
      'updatedAt'
    ])
    .where('id', '=', Number(id))
    .executeTakeFirstOrThrow()

const membershipsOf = async (conversationId: string) =>
  (
    await db
      .selectFrom('direct_conversation_memberships')
      .select([
        'actorId',
        'lastStatusId',
        'lastStatusCreatedAt',
        'unread',
        'readAt',
        'hiddenAt'
      ])
      .where('conversationId', '=', conversationId)
      .execute()
  ).sort((left, right) => left.actorId.localeCompare(right.actorId))

const participantsOf = async (conversationId: string) =>
  (
    await db
      .selectFrom('direct_conversation_participants')
      .select('actorId')
      .where('conversationId', '=', conversationId)
      .execute()
  )
    .map((row) => row.actorId)
    .sort()

const conversationIdOfStatus = async (statusId: string) =>
  (
    await db
      .selectFrom('direct_conversation_statuses')
      .select('conversationId')
      .where('statusId', '=', statusId)
      .execute()
  ).map((row) => row.conversationId)

// Hydrates every status id except `hidden`, and records each call.
const fakeStatuses = (hidden: Iterable<string> = []) => {
  const hiddenIds = new Set(hidden)
  const calls: string[][] = []
  const source: ConversationStatusSource = {
    getStatusesByIds: async ({ statusIds }) => {
      calls.push(statusIds)
      return statusIds
        .filter((statusId) => !hiddenIds.has(statusId))
        .map((statusId) =>
          statusObject({ id: statusId, actorId: 'x', createdAt: 1 })
        )
    }
  }
  return { source, calls }
}

const queries = createConversationQueries(fakeStatuses().source)

describe('getDirectConversations and getDirectConversation', () => {
  it("lists only the actor's visible memberships with their own participants", async () => {
    const p = nextPrefix()
    const [a, b, x] = ['a', 'b', 'x'].map((name) => actorIdOf(`${p}-${name}`))
    await seedConversation({
      id: `${p}-c1`,
      participants: [a, b],
      statuses: [[`${p}-c1-s1`, 1000]]
    })
    await seedConversation({
      id: `${p}-c2`,
      participants: [a, x],
      statuses: [[`${p}-c2-s1`, 2000]]
    })
    await seedConversation({
      id: `${p}-c3`,
      participants: [a, b, x],
      statuses: [[`${p}-c3-s1`, 1500]]
    })
    const a1 = await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-c1-s1`,
      lastStatusCreatedAt: 1000,
      unread: true
    })
    const b1 = await seedMembership({
      actorId: b,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-c1-s1`,
      lastStatusCreatedAt: 1000,
      readAt: 1000
    })
    const a2 = await seedMembership({
      actorId: a,
      conversationId: `${p}-c2`,
      lastStatusId: `${p}-c2-s1`,
      lastStatusCreatedAt: 2000,
      hiddenAt: 2500
    })
    const a3 = await seedMembership({
      actorId: a,
      conversationId: `${p}-c3`,
      lastStatusId: `${p}-c3-s1`,
      lastStatusCreatedAt: 1500,
      readAt: 1600
    })

    const actorA = await queries.getDirectConversations(db, { actorId: a })
    expect(
      actorA.map(({ lastStatus: _, participantActorIds, ...conversation }) => ({
        ...conversation,
        participantActorIds: [...participantActorIds].sort()
      }))
    ).toEqual([
      {
        id: a3,
        actorId: a,
        conversationId: `${p}-c3`,
        rootStatusId: `${p}-c3-s1`,
        participantActorIds: [a, b, x].sort(),
        lastStatusId: `${p}-c3-s1`,
        lastStatusCreatedAt: 1500,
        unread: false,
        readAt: 1600,
        hiddenAt: null,
        createdAt: 5,
        updatedAt: 5
      },
      {
        id: a1,
        actorId: a,
        conversationId: `${p}-c1`,
        rootStatusId: `${p}-c1-s1`,
        participantActorIds: [a, b].sort(),
        lastStatusId: `${p}-c1-s1`,
        lastStatusCreatedAt: 1000,
        unread: true,
        readAt: null,
        hiddenAt: null,
        createdAt: 5,
        updatedAt: 5
      }
    ])
    expect(actorA[0].lastStatus.id).toEqual(`${p}-c3-s1`)

    const actorB = await queries.getDirectConversations(db, { actorId: b })
    expect(actorB.map((conversation) => conversation.id)).toEqual([b1])

    await expect(
      queries.getDirectConversation(db, { actorId: a, conversationId: a2 })
    ).resolves.toBeNull()
    await expect(
      queries.getDirectConversation(db, {
        actorId: a,
        conversationId: a2,
        includeHidden: true
      })
    ).resolves.toMatchObject({ id: a2, hiddenAt: 2500, unread: false })
  })

  it('returns a membership by id only to its actor', async () => {
    const p = nextPrefix()
    const [a, b] = ['a', 'b'].map((name) => actorIdOf(`${p}-${name}`))
    await seedConversation({ id: `${p}-c1`, participants: [a, b] })
    await seedConversation({ id: `${p}-c2`, participants: [a] })
    const a1 = await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-c1-s1`,
      lastStatusCreatedAt: 1000
    })
    const a2 = await seedMembership({
      actorId: a,
      conversationId: `${p}-c2`,
      lastStatusId: `${p}-c2-s1`,
      lastStatusCreatedAt: 2000
    })
    const b1 = await seedMembership({
      actorId: b,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-c1-s1`,
      lastStatusCreatedAt: 1000
    })

    await expect(
      queries.getDirectConversation(db, { actorId: a, conversationId: a1 })
    ).resolves.toMatchObject({ id: a1, conversationId: `${p}-c1` })
    await expect(
      queries.getDirectConversation(db, { actorId: a, conversationId: a2 })
    ).resolves.toMatchObject({ id: a2, conversationId: `${p}-c2` })
    // Leading zeros name the same membership.
    await expect(
      queries.getDirectConversation(db, {
        actorId: a,
        conversationId: `000${a2}`
      })
    ).resolves.toMatchObject({ id: a2 })
    await expect(
      queries.getDirectConversation(db, { actorId: a, conversationId: b1 })
    ).resolves.toBeNull()
    await expect(
      queries.getDirectConversation(db, { actorId: b, conversationId: a1 })
    ).resolves.toBeNull()
  })

  it('pages by maxId and minId in (lastStatusCreatedAt, id) order with ties broken by id', async () => {
    const p = nextPrefix()
    const [a, b] = ['a', 'b'].map((name) => actorIdOf(`${p}-${name}`))
    const times = [1000, 2000, 2000, 3000, 2000]
    const ids: string[] = []
    for (const [index, time] of times.entries()) {
      const conversationId = `${p}-c${index + 1}`
      await seedConversation({ id: conversationId, participants: [a] })
      ids.push(
        await seedMembership({
          actorId: a,
          conversationId,
          lastStatusId: `${conversationId}-s`,
          lastStatusCreatedAt: time
        })
      )
    }
    const [m1, m2, m3, m4, m5] = ids
    // Neighbours: a hidden membership of the same actor and another actor's
    // membership, both inside the paged range.
    await seedConversation({ id: `${p}-hidden`, participants: [a] })
    const hidden = await seedMembership({
      actorId: a,
      conversationId: `${p}-hidden`,
      lastStatusId: `${p}-hidden-s`,
      lastStatusCreatedAt: 2200,
      hiddenAt: 2300
    })
    await seedConversation({ id: `${p}-other`, participants: [b] })
    const other = await seedMembership({
      actorId: b,
      conversationId: `${p}-other`,
      lastStatusId: `${p}-other-s`,
      lastStatusCreatedAt: 2500
    })

    const page = async (params: {
      limit?: number
      maxId?: string
      minId?: string
    }) =>
      (await queries.getDirectConversations(db, { actorId: a, ...params })).map(
        (conversation) => conversation.id
      )

    expect(await page({})).toEqual([m4, m5, m3, m2, m1])
    expect(await page({ limit: 2 })).toEqual([m4, m5])
    expect(await page({ limit: 2, maxId: m5 })).toEqual([m3, m2])
    expect(await page({ maxId: m3 })).toEqual([m2, m1])
    expect(await page({ minId: m3 })).toEqual([m4, m5])
    expect(await page({ minId: m2 })).toEqual([m4, m5, m3])
    expect(await page({ maxId: m4, minId: m1 })).toEqual([m5, m3, m2])
    expect(await page({ maxId: m1 })).toEqual([])
    // A cursor that is not a visible membership of the actor gives nothing.
    expect(await page({ maxId: hidden })).toEqual([])
    expect(await page({ minId: other })).toEqual([])
    expect(await page({ maxId: '999999999' })).toEqual([])
    expect(await page({ limit: 0 })).toEqual([])
  })

  it('scans past conversations whose last status is not visible across scan batches with tied timestamps', async () => {
    const p = nextPrefix()
    const a = actorIdOf(`${p}-a`)
    // Membership ids grow in seeding order: the newest visible one has the
    // smallest id, then 30 hidden ones share one timestamp across the first
    // scan batch's boundary, then older visible ones.
    const seeded: { name: string; time: number }[] = [
      { name: 'v0', time: 10_100 },
      ...Array.from({ length: 30 }, (_, index) => ({
        name: `h${String(index + 1).padStart(2, '0')}`,
        time: 10_050
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        name: `v${index + 1}`,
        time: 10_010
      }))
    ]
    for (const { name, time } of seeded) {
      await seedConversation({ id: `${p}-${name}`, participants: [a] })
      await seedMembership({
        actorId: a,
        conversationId: `${p}-${name}`,
        lastStatusId: `${p}-${name}-s`,
        lastStatusCreatedAt: time
      })
    }
    const { source } = fakeStatuses(
      seeded
        .filter(({ name }) => name.startsWith('h'))
        .map(({ name }) => `${p}-${name}-s`)
    )

    const conversations = await createConversationQueries(
      source
    ).getDirectConversations(db, { actorId: a, limit: 3 })

    expect(
      conversations.map((conversation) => conversation.lastStatusId)
    ).toEqual([`${p}-v0-s`, `${p}-v5-s`, `${p}-v4-s`])
  })

  it('reaches a tied membership past a whole scan batch of invisible ones', async () => {
    const p = nextPrefix()
    const a = actorIdOf(`${p}-a`)
    // All 31 memberships share one timestamp. The visible one is seeded first,
    // so it has the lowest id, and the 30 hidden ones (with no fallback
    // statuses) fill the first scan batch. Only the tie arm of the cursor
    // (same timestamp, smaller id) reaches the visible one in the second.
    const hiddenNames = Array.from({ length: 30 }, (_, index) => `h${index}`)
    for (const name of ['visible', ...hiddenNames]) {
      await seedConversation({ id: `${p}-${name}`, participants: [a] })
      await seedMembership({
        actorId: a,
        conversationId: `${p}-${name}`,
        lastStatusId: `${p}-${name}-s`,
        lastStatusCreatedAt: 5000
      })
    }
    const { source } = fakeStatuses(hiddenNames.map((name) => `${p}-${name}-s`))

    const conversations = await createConversationQueries(
      source
    ).getDirectConversations(db, { actorId: a })

    expect(
      conversations.map((conversation) => conversation.conversationId)
    ).toEqual([`${p}-visible`])
  })

  it("falls back to the newest visible status of the membership's own conversation", async () => {
    const p = nextPrefix()
    const [a, b] = ['a', 'b'].map((name) => actorIdOf(`${p}-${name}`))
    await seedConversation({
      id: `${p}-c1`,
      participants: [a, b],
      statuses: [
        [`${p}-c1-old`, 1000],
        [`${p}-c1-mid`, 2000],
        [`${p}-c1-hidden`, 3000]
      ]
    })
    // A newer visible status in another conversation.
    await seedConversation({
      id: `${p}-c2`,
      participants: [b],
      statuses: [[`${p}-c2-new`, 2500]]
    })
    const id = await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-c1-hidden`,
      lastStatusCreatedAt: 3000,
      unread: true,
      readAt: 1500
    })
    const { source } = fakeStatuses([`${p}-c1-hidden`])

    const [conversation] = await createConversationQueries(
      source
    ).getDirectConversations(db, { actorId: a })

    expect(conversation).toMatchObject({
      id,
      lastStatusId: `${p}-c1-mid`,
      lastStatusCreatedAt: 2000,
      unread: true,
      readAt: 1500
    })
    // The stored row is left as it is.
    expect(await readMembership(id)).toMatchObject({
      lastStatusId: `${p}-c1-hidden`,
      lastStatusCreatedAt: 3000
    })
  })

  it("keeps each conversation's fallback scan to its own statuses past a full batch", async () => {
    const p = nextPrefix()
    const a = actorIdOf(`${p}-a`)
    // Two conversations, each with 51 statuses of which only the oldest is
    // visible, so both need a second fallback batch. Every status of the
    // second is newer than every status of the first.
    const seeded = [
      { name: 'older', start: 1000 },
      { name: 'newer', start: 5000 }
    ]
    const hidden: string[] = []
    for (const { name, start } of seeded) {
      const statuses: [string, number][] = Array.from(
        { length: 51 },
        (_, index) => [`${p}-${name}-${index}`, start + index]
      )
      hidden.push(...statuses.slice(1).map(([statusId]) => statusId))
      await seedConversation({
        id: `${p}-${name}`,
        participants: [a],
        statuses
      })
      await seedMembership({
        actorId: a,
        conversationId: `${p}-${name}`,
        lastStatusId: `${p}-${name}-50`,
        lastStatusCreatedAt: start + 50
      })
    }
    const { source } = fakeStatuses(hidden)

    const conversations = await createConversationQueries(
      source
    ).getDirectConversations(db, { actorId: a })

    expect(
      conversations.map((conversation) => [
        conversation.conversationId,
        conversation.lastStatusId
      ])
    ).toEqual([
      [`${p}-newer`, `${p}-newer-0`],
      [`${p}-older`, `${p}-older-0`]
    ])
  })

  it("does not let one conversation's fallback cursor feed rows to another", async () => {
    const p = nextPrefix()
    const a = actorIdOf(`${p}-a`)
    // A has 200 statuses of which only the oldest is visible, so it needs all
    // four fallback batches. B has 51 statuses, all older than A's, of which
    // only the oldest is visible, so it needs two. A's cursor must not apply
    // to B's rows: unbounded, it would keep handing B its first 50 statuses
    // again and B would not get past them within the four batches.
    const seeded = [
      { name: 'A', count: 200, start: 10_000 },
      { name: 'B', count: 51, start: 1_000 }
    ]
    const hidden: string[] = []
    for (const { name, count, start } of seeded) {
      const statuses: [string, number][] = Array.from(
        { length: count },
        (_, index) => [
          `${p}-${name}-${String(index).padStart(3, '0')}`,
          start + index
        ]
      )
      hidden.push(...statuses.slice(1).map(([statusId]) => statusId))
      await seedConversation({
        id: `${p}-${name}`,
        participants: [a],
        statuses
      })
      await seedMembership({
        actorId: a,
        conversationId: `${p}-${name}`,
        lastStatusId: statuses[count - 1][0],
        lastStatusCreatedAt: start + count - 1
      })
    }
    const { source } = fakeStatuses(hidden)

    const conversations = await createConversationQueries(
      source
    ).getDirectConversations(db, { actorId: a })

    expect(
      conversations.map((conversation) => [
        conversation.conversationId,
        conversation.lastStatusId
      ])
    ).toEqual([
      [`${p}-A`, `${p}-A-000`],
      [`${p}-B`, `${p}-B-000`]
    ])
  })

  it('breaks ties between fallback statuses by status id, newest first', async () => {
    const p = nextPrefix()
    const a = actorIdOf(`${p}-a`)
    // 51 statuses share one timestamp and only the one with the lowest id is
    // visible. The first fallback batch is the 50 highest ids in descending
    // order, and the second is the one left.
    const ids = Array.from(
      { length: 51 },
      (_, index) => `${p}-t${String(index).padStart(2, '0')}`
    )
    await seedConversation({
      id: `${p}-c1`,
      participants: [a],
      statuses: ids.map((id): [string, number] => [id, 3000])
    })
    await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: ids[50],
      lastStatusCreatedAt: 3000
    })
    const { source, calls } = fakeStatuses(ids.slice(1))

    const [conversation] = await createConversationQueries(
      source
    ).getDirectConversations(db, { actorId: a })

    expect(conversation.lastStatusId).toBe(ids[0])
    expect(calls.slice(1)).toEqual([ids.slice(1).reverse(), [ids[0]]])
  })
})

describe('markDirectConversationRead and hideDirectConversation', () => {
  const seedPair = async () => {
    const p = nextPrefix()
    const [a, b] = ['a', 'b'].map((name) => actorIdOf(`${p}-${name}`))
    await seedConversation({ id: `${p}-c1`, participants: [a, b] })
    await seedConversation({ id: `${p}-c0`, participants: [a] })
    await seedConversation({ id: `${p}-c3`, participants: [a] })
    // Seeded first, oldest and with the lowest conversation id, so it is the
    // first row an unscoped read finds, whichever index the backend scans.
    const neighbour = await seedMembership({
      actorId: a,
      conversationId: `${p}-c0`,
      lastStatusId: `${p}-c0-s`,
      lastStatusCreatedAt: 500,
      unread: true
    })
    const target = await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-c1-s`,
      lastStatusCreatedAt: 1000,
      unread: true
    })
    const otherActor = await seedMembership({
      actorId: b,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-c1-s`,
      lastStatusCreatedAt: 1000,
      unread: true
    })
    const hidden = await seedMembership({
      actorId: a,
      conversationId: `${p}-c3`,
      lastStatusId: `${p}-c3-s`,
      lastStatusCreatedAt: 1500,
      unread: true,
      hiddenAt: 1600
    })
    return { a, b, neighbour, target, otherActor, hidden }
  }

  const unchanged = {
    unread: true,
    readAt: null,
    updatedAt: 5
  }

  it('marks only the given visible membership of the actor read', async () => {
    const { a, neighbour, target, otherActor, hidden } = await seedPair()
    const before = Date.now()

    const conversation = await queries.markDirectConversationRead(db, {
      actorId: a,
      conversationId: target
    })

    expect(conversation).toMatchObject({ id: target, unread: false })
    expect(conversation?.readAt).toBeGreaterThanOrEqual(before)
    expect(await readMembership(target)).toMatchObject({
      unread: false,
      readAt: conversation?.readAt
    })
    expect(await readMembership(neighbour)).toMatchObject(unchanged)
    expect(await readMembership(otherActor)).toMatchObject(unchanged)

    await expect(
      queries.markDirectConversationRead(db, {
        actorId: a,
        conversationId: otherActor
      })
    ).resolves.toBeNull()
    await expect(
      queries.markDirectConversationRead(db, {
        actorId: a,
        conversationId: hidden
      })
    ).resolves.toBeNull()
    await expect(
      queries.markDirectConversationRead(db, {
        actorId: a,
        conversationId: 'not-an-id'
      })
    ).resolves.toBeNull()
    expect(await readMembership(otherActor)).toMatchObject(unchanged)
    expect(await readMembership(hidden)).toMatchObject(unchanged)
    expect(await readMembership(neighbour)).toMatchObject(unchanged)
  })

  it('hides only the given membership of the actor', async () => {
    const { a, neighbour, target, otherActor } = await seedPair()
    const before = Date.now()

    await queries.hideDirectConversation(db, {
      actorId: a,
      conversationId: target
    })
    await queries.hideDirectConversation(db, {
      actorId: a,
      conversationId: otherActor
    })
    await queries.hideDirectConversation(db, {
      actorId: a,
      conversationId: 'not-an-id'
    })

    const hiddenRow = await readMembership(target)
    expect(hiddenRow.unread).toBe(false)
    expect(hiddenRow.hiddenAt).toBeGreaterThanOrEqual(before)
    expect(await readMembership(neighbour)).toMatchObject({
      ...unchanged,
      hiddenAt: null
    })
    expect(await readMembership(otherActor)).toMatchObject({
      ...unchanged,
      hiddenAt: null
    })
  })
})

describe('getDirectConversationStatuses', () => {
  it("lists only the conversation's statuses newest first, ties by status id, paged by maxStatusId and minStatusId", async () => {
    const p = nextPrefix()
    const [a, b] = ['a', 'b'].map((name) => actorIdOf(`${p}-${name}`))
    const s = (n: number) => `${p}-s${n}`
    await seedConversation({
      id: `${p}-c1`,
      participants: [a, b],
      statuses: [
        [s(1), 1000],
        [s(2), 2000],
        [s(3), 2000],
        [s(4), 3000],
        [s(5), 2000]
      ]
    })
    await seedConversation({
      id: `${p}-c2`,
      participants: [b],
      statuses: [
        [`${p}-n1`, 2500],
        [`${p}-n2`, 1500]
      ]
    })
    const membership = await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: s(4),
      lastStatusCreatedAt: 3000
    })
    await seedMembership({
      actorId: b,
      conversationId: `${p}-c2`,
      lastStatusId: `${p}-n1`,
      lastStatusCreatedAt: 2500
    })

    const page = async (params: {
      actorId?: string
      limit?: number
      maxStatusId?: string
      minStatusId?: string
    }) =>
      (
        await queries.getDirectConversationStatuses(db, {
          actorId: a,
          conversationId: membership,
          ...params
        })
      ).map((status) => status.id)

    expect(await page({})).toEqual([s(4), s(5), s(3), s(2), s(1)])
    expect(await page({ limit: 2 })).toEqual([s(4), s(5)])
    expect(await page({ maxStatusId: s(3) })).toEqual([s(2), s(1)])
    expect(await page({ maxStatusId: s(5) })).toEqual([s(3), s(2), s(1)])
    expect(await page({ minStatusId: s(3) })).toEqual([s(4), s(5)])
    expect(await page({ maxStatusId: s(4), minStatusId: s(1) })).toEqual([
      s(5),
      s(3),
      s(2)
    ])
    // A cursor from another conversation gives nothing.
    expect(await page({ maxStatusId: `${p}-n1` })).toEqual([])
    expect(await page({ minStatusId: `${p}-n2` })).toEqual([])
    // Another actor cannot read the conversation through this membership.
    expect(await page({ actorId: b })).toEqual([])
    expect(await page({ limit: 0 })).toEqual([])
  })

  it('scans past statuses the actor cannot see across scan batches with tied timestamps', async () => {
    const p = nextPrefix()
    const a = actorIdOf(`${p}-a`)
    const hidden = Array.from(
      { length: 30 },
      (_, index) => `${p}-h${String(index + 1).padStart(2, '0')}`
    )
    const visible = Array.from(
      { length: 5 },
      (_, index) => `${p}-v${index + 1}`
    )
    await seedConversation({
      id: `${p}-c1`,
      participants: [a],
      statuses: [
        [`${p}-v0`, 10_100],
        ...hidden.map((id): [string, number] => [id, 10_050]),
        ...visible.map((id): [string, number] => [id, 10_010])
      ]
    })
    const membership = await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: `${p}-v0`,
      lastStatusCreatedAt: 10_100
    })
    const { source } = fakeStatuses(hidden)

    const statuses = await createConversationQueries(
      source
    ).getDirectConversationStatuses(db, {
      actorId: a,
      conversationId: membership,
      limit: 3
    })

    expect(statuses.map((status) => status.id)).toEqual([
      `${p}-v0`,
      `${p}-v5`,
      `${p}-v4`
    ])
  })

  it('lists tied statuses by status id, newest first, whatever order they were stored in', async () => {
    const p = nextPrefix()
    const a = actorIdOf(`${p}-a`)
    // 40 statuses share one timestamp and are stored from the highest id down,
    // the reverse of the order they are listed in. A page of 35 scans exactly
    // 35 of them.
    const ids = Array.from(
      { length: 40 },
      (_, index) => `${p}-u${String(index).padStart(2, '0')}`
    )
    await seedConversation({
      id: `${p}-c1`,
      participants: [a],
      statuses: [...ids].reverse().map((id): [string, number] => [id, 4000])
    })
    const membership = await seedMembership({
      actorId: a,
      conversationId: `${p}-c1`,
      lastStatusId: ids[39],
      lastStatusCreatedAt: 4000
    })
    const { source, calls } = fakeStatuses()

    const statuses = await createConversationQueries(
      source
    ).getDirectConversationStatuses(db, {
      actorId: a,
      conversationId: membership,
      limit: 35
    })

    const expected = [...ids].reverse().slice(0, 35)
    expect(calls.slice(1)).toEqual([expected])
    expect(statuses.map((status) => status.id)).toEqual(expected)
  })
})

describe('syncDirectConversationForStatus', () => {
  const sync = (status: Status, excludedLocalActorIds?: string[]) =>
    queries.syncDirectConversationForStatus(db, {
      status,
      excludedLocalActorIds
    })

  it('adds memberships for the local participants only', async () => {
    const p = nextPrefix()
    const a = await seedActor(actorIdOf(`${p}-a`), true)
    const b = await seedActor(actorIdOf(`${p}-b`), true)
    // A remote participant whose row carries the legacy empty-string key,
    // and a local actor who is not a participant.
    const remote = await seedActor(actorIdOf(`${p}-remote`), false, '')
    const bystander = await seedActor(actorIdOf(`${p}-bystander`), true)
    const status = await seedStatus({
      id: `${a}/statuses/s1`,
      actorId: a,
      to: [b, remote],
      createdAt: 1000
    })

    await sync(status)

    const conversationId = getConversationIdForRootStatusId(status.id)
    expect(await conversationIdOfStatus(status.id)).toEqual([conversationId])
    expect(await participantsOf(conversationId)).toEqual([a, b, remote].sort())
    expect(await membershipsOf(conversationId)).toEqual(
      [
        {
          actorId: a,
          lastStatusId: status.id,
          lastStatusCreatedAt: 1000,
          unread: false,
          readAt: 1000,
          hiddenAt: null
        },
        {
          actorId: b,
          lastStatusId: status.id,
          lastStatusCreatedAt: 1000,
          unread: true,
          readAt: null,
          hiddenAt: null
        }
      ].sort((left, right) => left.actorId.localeCompare(right.actorId))
    )
    const bystanderMemberships = await db
      .selectFrom('direct_conversation_memberships')
      .select('id')
      .where('actorId', '=', bystander)
      .execute()
    expect(bystanderMemberships).toEqual([])
  })

  it("moves only this conversation's memberships forward and leaves excluded actors alone", async () => {
    const p = nextPrefix()
    const a = await seedActor(actorIdOf(`${p}-a`), true)
    const b = await seedActor(actorIdOf(`${p}-b`), true)
    const x = await seedActor(actorIdOf(`${p}-x`), true)
    // A neighbouring conversation of the same actors, synced first.
    const other = await seedStatus({
      id: `${a}/statuses/other`,
      actorId: a,
      to: [b, x],
      createdAt: 500
    })
    await sync(other)
    const otherConversationId = getConversationIdForRootStatusId(other.id)
    const otherBefore = await db
      .selectFrom('direct_conversation_memberships')
      .selectAll()
      .where('conversationId', '=', otherConversationId)
      .orderBy('id')
      .execute()

    const root = await seedStatus({
      id: `${a}/statuses/root`,
      actorId: a,
      to: [b],
      createdAt: 1000
    })
    await sync(root)
    const conversationId = getConversationIdForRootStatusId(root.id)
    // Participant rows are per conversation, though a and b already have
    // rows in the other one.
    expect(await participantsOf(conversationId)).toEqual([a, b].sort())

    const reply = await seedStatus({
      id: `${b}/statuses/reply`,
      actorId: b,
      to: [a],
      reply: root.id,
      createdAt: 2000
    })
    await sync(reply)

    // The reply joins the root's conversation through its synced row.
    expect(await conversationIdOfStatus(reply.id)).toEqual([conversationId])
    expect(await membershipsOf(conversationId)).toEqual(
      [
        {
          actorId: a,
          lastStatusId: reply.id,
          lastStatusCreatedAt: 2000,
          unread: true,
          readAt: 1000,
          hiddenAt: null
        },
        {
          actorId: b,
          lastStatusId: reply.id,
          lastStatusCreatedAt: 2000,
          unread: false,
          readAt: 2000,
          hiddenAt: null
        }
      ].sort((left, right) => left.actorId.localeCompare(right.actorId))
    )

    // b is excluded from the next one: its membership stays where it is.
    const second = await seedStatus({
      id: `${a}/statuses/second`,
      actorId: a,
      to: [b],
      reply: reply.id,
      createdAt: 3000
    })
    await sync(second, [b])
    expect(await membershipsOf(conversationId)).toEqual(
      [
        {
          actorId: a,
          lastStatusId: second.id,
          lastStatusCreatedAt: 3000,
          unread: false,
          readAt: 3000,
          hiddenAt: null
        },
        {
          actorId: b,
          lastStatusId: reply.id,
          lastStatusCreatedAt: 2000,
          unread: false,
          readAt: 2000,
          hiddenAt: null
        }
      ].sort((left, right) => left.actorId.localeCompare(right.actorId))
    )

    // An older status does not move a membership back.
    const late = await seedStatus({
      id: `${b}/statuses/late`,
      actorId: b,
      to: [a],
      reply: root.id,
      createdAt: 1500
    })
    await sync(late)
    expect(
      (await membershipsOf(conversationId)).map((row) => row.lastStatusId)
    ).toEqual(
      [
        [a, second.id],
        [b, reply.id]
      ]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, statusId]) => statusId)
    )

    expect(
      await db
        .selectFrom('direct_conversation_memberships')
        .selectAll()
        .where('conversationId', '=', otherConversationId)
        .orderBy('id')
        .execute()
    ).toEqual(otherBefore)
  })

  it('drops participants with a block either way with the author, and no one else', async () => {
    const p = nextPrefix()
    const [author, kept, blocker, blocked, blockedByAuthor] = await Promise.all(
      ['author', 'kept', 'blocker', 'blocked', 'blocked-by-author'].map(
        (name) => seedActor(actorIdOf(`${p}-${name}`), true)
      )
    )
    const outsider = await seedActor(actorIdOf(`${p}-outsider`), true)
    await seedBlock(blocker, author)
    await seedBlock(author, blockedByAuthor)
    // Blocks that do not involve the author.
    await seedBlock(blocker, kept)
    await seedBlock(kept, blocked)
    await seedBlock(outsider, author)
    const status = await seedStatus({
      id: `${author}/statuses/s1`,
      actorId: author,
      to: [kept, blocker, blocked, blockedByAuthor],
      createdAt: 1000
    })

    await sync(status)

    const conversationId = getConversationIdForRootStatusId(status.id)
    expect(
      (await membershipsOf(conversationId)).map((row) => row.actorId)
    ).toEqual([author, kept, blocked].sort())
    expect(await participantsOf(conversationId)).toEqual(
      [author, kept, blocker, blocked, blockedByAuthor].sort()
    )
  })

  it("inherits only the parent conversation's participants for a recipientless reply", async () => {
    const p = nextPrefix()
    const a = await seedActor(actorIdOf(`${p}-a`), true)
    const b = await seedActor(actorIdOf(`${p}-b`), true)
    const x = await seedActor(actorIdOf(`${p}-x`), true)
    // A neighbouring conversation with another participant.
    await sync(
      await seedStatus({
        id: `${a}/statuses/other`,
        actorId: a,
        to: [b, x],
        createdAt: 500
      })
    )
    const rootUrl = `${a}/@root`
    const root = await seedStatus({
      id: `${a}/statuses/root`,
      url: rootUrl,
      actorId: a,
      to: [b],
      createdAt: 1000
    })
    await sync(root)
    const reply = await seedStatus({
      id: `${b}/statuses/recipientless`,
      actorId: b,
      reply: rootUrl,
      createdAt: 2000
    })

    await sync(reply)

    const conversationId = getConversationIdForRootStatusId(root.id)
    expect(await conversationIdOfStatus(reply.id)).toEqual([conversationId])
    expect(await participantsOf(conversationId)).toEqual([a, b].sort())
    expect(
      (await membershipsOf(conversationId)).map((row) => [
        row.actorId,
        row.lastStatusId,
        row.unread
      ])
    ).toEqual(
      [
        [a, reply.id, true],
        [b, reply.id, false]
      ].sort(([left], [right]) =>
        (left as string).localeCompare(right as string)
      )
    )
  })

  it('does not treat an Announce as the parent of a recipientless reply', async () => {
    const p = nextPrefix()
    const local = await seedActor(actorIdOf(`${p}-local`), true)
    const replier = await seedActor(actorIdOf(`${p}-replier`), false)
    const announce = await seedStatus({
      id: `${local}/statuses/announce`,
      actorId: local,
      type: StatusType.enum.Announce,
      to: [ACTIVITY_STREAM_PUBLIC],
      createdAt: 1000
    })
    const reply = await seedStatus({
      id: `${replier}/statuses/reply`,
      actorId: replier,
      reply: announce.id,
      createdAt: 2000
    })

    await sync(reply)

    expect(await conversationIdOfStatus(reply.id)).toEqual([])
  })

  it('resolves a parent by id before another status whose url is the same text', async () => {
    const p = nextPrefix()
    const local = await seedActor(actorIdOf(`${p}-local`), true)
    const remote = await seedActor(actorIdOf(`${p}-remote`), false)
    const replier = await seedActor(actorIdOf(`${p}-replier`), false)
    const reference = `https://cq.test/statuses/${p}-ref`
    // Seeded first: a remote status whose url is the reference.
    await seedStatus({
      id: `${remote}/statuses/by-url`,
      url: reference,
      actorId: remote,
      to: [ACTIVITY_STREAM_PUBLIC],
      createdAt: 900
    })
    await seedStatus({
      id: reference,
      url: `${reference}/canonical`,
      actorId: local,
      to: [ACTIVITY_STREAM_PUBLIC],
      createdAt: 1000
    })
    const reply = await seedStatus({
      id: `${replier}/statuses/reply`,
      actorId: replier,
      reply: reference,
      createdAt: 2000
    })

    await sync(reply)

    const conversationId = getConversationIdForRootStatusId(reply.id)
    expect(await conversationIdOfStatus(reply.id)).toEqual([conversationId])
    expect(await participantsOf(conversationId)).toEqual(
      [local, replier].sort()
    )
    expect(
      (await membershipsOf(conversationId)).map((row) => row.actorId)
    ).toEqual([local])
  })

  it("does not add a remote parent's author for a local recipientless reply", async () => {
    const p = nextPrefix()
    const local = await seedActor(actorIdOf(`${p}-local`), true)
    await seedActor(actorIdOf(`${p}-other-local`), true)
    const remote = await seedActor(actorIdOf(`${p}-remote`), false, '')
    const parent = await seedStatus({
      id: `${remote}/statuses/public`,
      actorId: remote,
      to: [ACTIVITY_STREAM_PUBLIC],
      createdAt: 1000
    })
    const reply = await seedStatus({
      id: `${local}/statuses/reply`,
      actorId: local,
      reply: parent.id,
      createdAt: 2000
    })

    await sync(reply)

    expect(await conversationIdOfStatus(reply.id)).toEqual([])
    expect(
      await db
        .selectFrom('direct_conversation_memberships')
        .select('id')
        .where('actorId', '=', local)
        .execute()
    ).toEqual([])
  })

  it('writes nothing when a statement in its transaction fails', async () => {
    const p = nextPrefix()
    const a = await seedActor(actorIdOf(`${p}-a`), true)
    const b = await seedActor(actorIdOf(`${p}-b`), true)
    const status = await seedStatus({
      id: `${a}/statuses/s1`,
      actorId: a,
      to: [b],
      createdAt: 1000
    })
    const refuseMemberships: KyselyPlugin = {
      transformQuery: ({ node }) => {
        if (
          InsertQueryNode.is(node) &&
          node.into?.table.identifier.name === 'direct_conversation_memberships'
        ) {
          throw new Error('membership insert refused')
        }
        return node
      },
      transformResult: async ({ result }) => result
    }

    await expect(
      queries.syncDirectConversationForStatus(
        db.withPlugin(refuseMemberships),
        { status }
      )
    ).rejects.toThrow('membership insert refused')

    const conversationId = getConversationIdForRootStatusId(status.id)
    expect(await conversationIdOfStatus(status.id)).toEqual([])
    expect(await participantsOf(conversationId)).toEqual([])
    expect(await membershipsOf(conversationId)).toEqual([])
    expect(
      await db
        .selectFrom('direct_conversations')
        .select('id')
        .where('id', '=', conversationId)
        .execute()
    ).toEqual([])
  })

  it.each([
    [
      'a Kysely transaction',
      (callback: (trx: Db) => Promise<void>) =>
        db.transaction().execute(callback)
    ],
    [
      'a Knex transaction through kyselyFor',
      (callback: (trx: Db) => Promise<void>) =>
        testDb.knex.transaction((trx) => callback(kyselyFor(trx)))
    ]
  ])(
    "runs in the caller's transaction (%s) and rolls back with it",
    async (_, inCallerTransaction) => {
      const p = nextPrefix()
      const a = await seedActor(actorIdOf(`${p}-a`), true)
      const b = await seedActor(actorIdOf(`${p}-b`), true)
      const status = await seedStatus({
        id: `${a}/statuses/s1`,
        actorId: a,
        to: [b],
        createdAt: 1000
      })
      const conversationId = getConversationIdForRootStatusId(status.id)

      await expect(
        inCallerTransaction(async (trx) => {
          await queries.syncDirectConversationForStatus(trx, { status })
          const inside = await trx
            .selectFrom('direct_conversation_memberships')
            .select('actorId')
            .where('conversationId', '=', conversationId)
            .execute()
          expect(inside).toHaveLength(2)
          throw new Error('caller failed')
        })
      ).rejects.toThrow('caller failed')

      expect(await membershipsOf(conversationId)).toEqual([])
      expect(await participantsOf(conversationId)).toEqual([])
      expect(await conversationIdOfStatus(status.id)).toEqual([])
    }
  )
})

// On PostgreSQL markDirectConversationRead locks the membership row between
// its read and its update, so a status sync that moves the row forward in
// between waits and its unread flag survives.
describe.runIf(process.env.TEST_DATABASE_TYPE === 'pg')(
  'markDirectConversationRead with a concurrent writer',
  () => {
    let other: Knex

    beforeAll(() => {
      // A second pool outside this database's transaction guard, standing in
      // for another server process.
      other = knexFactory({ ...testDb.knex.client.config })
    })

    afterAll(async () => {
      await other.destroy()
    })

    // True once some statement of this database waits on a lock; false when
    // `stopped` turns true or the wait runs out first.
    const waitForLockWait = async (stopped: () => boolean) => {
      for (let attempt = 0; attempt < 250 && !stopped(); attempt += 1) {
        const { rows } = await other.raw(
          "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'"
        )
        if (rows[0].waiting > 0) return true
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return false
    }

    const selectsFrom = (node: RootOperationNode, table: string) =>
      SelectQueryNode.is(node) &&
      (node.from?.froms ?? []).some(
        (from) => TableNode.is(from) && from.table.identifier.name === table
      )

    it('keeps a new unread status that arrives between its read and its update', async () => {
      const p = nextPrefix()
      const a = actorIdOf(`${p}-a`)
      await seedConversation({ id: `${p}-c1`, participants: [a] })
      const id = await seedMembership({
        actorId: a,
        conversationId: `${p}-c1`,
        lastStatusId: `${p}-s1`,
        lastStatusCreatedAt: 1000,
        unread: true
      })

      let concurrent: Promise<unknown> | undefined
      let lockWaitSeen = false
      const watched = new Set<object>()
      const syncAfterRead: KyselyPlugin = {
        transformQuery: ({ node, queryId }) => {
          if (
            watched.size === 0 &&
            selectsFrom(node, 'direct_conversation_memberships')
          ) {
            watched.add(queryId)
          }
          return node
        },
        transformResult: async ({ result, queryId }) => {
          if (watched.has(queryId) && !concurrent) {
            concurrent = Promise.resolve(
              other('direct_conversation_memberships')
                .where('id', id)
                .update({
                  lastStatusId: `${p}-s2`,
                  lastStatusCreatedAt: new Date(2000),
                  unread: true,
                  updatedAt: new Date()
                })
            )
            let updated = false
            const settled = concurrent.then(() => {
              updated = true
            })
            lockWaitSeen = await Promise.race([
              settled.then(() => false),
              waitForLockWait(() => updated)
            ])
          }
          return result
        }
      }

      await queries.markDirectConversationRead(db.withPlugin(syncAfterRead), {
        actorId: a,
        conversationId: id
      })
      await concurrent

      expect(concurrent).toBeDefined()
      // The update was blocked on the row lock, not merely finished last.
      expect(lockWaitSeen).toBe(true)
      expect(await readMembership(id)).toMatchObject({
        lastStatusId: `${p}-s2`,
        unread: true
      })
    })
  }
)
