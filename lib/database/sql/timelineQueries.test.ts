import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import {
  type TimelineStatusSource,
  addStatusToFederatedTimeline,
  createTimelineStatus,
  getLocalPublicStatusesCount,
  getTimeline
} from '@/lib/database/domains/timeline/queries'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Timeline } from '@/lib/services/timelines/types'
import { type Status, StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Query-level tests for the timeline domain. The home and direct feeds are
// scoped by actor, so each test uses its own actors and puts neighbouring rows
// next to the ones under test: another actor's feed, another feed of the same
// actor, a row for the same status elsewhere. The local and federated feeds
// read the whole instance, so their tests start from empty status tables.
// Rows that tie on createdAt are written out of id order, and ids that tie
// differ in a digit, not in letter case. Runs on PostgreSQL in CI.

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
const nextPrefix = () => `tq${++prefixCount}`
const BASE = Date.UTC(2026, 0, 1)
const actorIn = (domain: string, name: string) =>
  `https://${domain}/users/${name}`
// Explicit timeline row ids, for rows whose id order a test depends on,
// handed out in blocks counting down from far above anything the sequence
// reaches here, ascending within a block. SQLite gives a new row its column's
// maximum plus one, so every later automatic id lands above every explicit
// one and no later block can collide with it.
let nextBlock = 2_000_000_000
const explicitKeys = (count: number) => {
  nextBlock -= count
  return Array.from({ length: count }, (_, index) => nextBlock + index)
}

// A status facade that echoes what it is asked for, in order.
const statusCalls: [string[], string | undefined][] = []
const statusesSource: TimelineStatusSource = async (
  statusIds,
  currentActorId
) => {
  statusCalls.push([statusIds, currentActorId])
  return statusIds.map((id) => ({ id }) as unknown as Status)
}
const read = async (params: Parameters<typeof getTimeline>[2]) =>
  (await getTimeline(db, statusesSource, params)).map((status) => status.id)

const seedActor = async (id: string, privateKey: string | null) => {
  await db
    .insertInto('actors')
    .values({
      id,
      username: id.split('/').pop() ?? id,
      domain: new URL(id).host,
      privateKey,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()
}

const seedStatus = async ({
  id,
  actorId,
  createdAt = BASE,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  reply = '',
  type = StatusType.enum.Note,
  originalStatusId = null,
  media = false
}: {
  id: string
  actorId: string
  createdAt?: number | null
  to?: string[]
  cc?: string[]
  reply?: string
  type?: StatusType
  originalStatusId?: string | null
  media?: boolean
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
  if (media) {
    await db
      .insertInto('attachments')
      .values({ id: randomUUID(), statusId: id, actorId, url: `${id}/media` })
      .execute()
  }
  return id
}

const seedTimelineRow = async ({
  actorId,
  timeline,
  statusId,
  statusActorId,
  createdAt = BASE,
  id
}: {
  actorId: string
  timeline: string
  statusId: string
  statusActorId: string
  createdAt?: number | null
  id?: number
}) => {
  const at = createdAt === null ? null : new Date(createdAt)
  await db
    .insertInto('timelines')
    .values({
      ...(id === undefined ? null : { id }),
      actorId,
      timeline,
      statusId,
      statusActorId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
}

describe('the home and direct feeds', () => {
  // The viewer's main feed: m1..m6, m2 and m3 tied and written out of id
  // order, m4 by a member of the viewer's exclusive list, m5 the viewer's own
  // post (the viewer is in that list too). Neighbours: rows for m5 in another
  // actor's main feed and in the viewer's direct feed, written first and
  // dated differently, a list feed row, and a status that is in no feed.
  const setup = async () => {
    const prefix = nextPrefix()
    const viewer = actorIn('home.test', `${prefix}-viewer`)
    const other = actorIn('home.test', `${prefix}-other`)
    const [x, y] = ['x', 'y'].map((name) =>
      actorIn('remote.test', `${prefix}-${name}`)
    )
    const s = (key: string) => `${prefix}-status-${key}`
    await seedTimelineRow({
      actorId: other,
      timeline: Timeline.MAIN,
      statusId: s('m5'),
      statusActorId: viewer,
      createdAt: BASE + 100
    })
    await seedTimelineRow({
      actorId: viewer,
      timeline: Timeline.DIRECT,
      statusId: s('m5'),
      statusActorId: viewer,
      createdAt: BASE + 100
    })
    const [low, high] = explicitKeys(2)
    const plan: [string, string, number, number | undefined][] = [
      ['m1', y, 1000, undefined],
      ['m2', y, 2000, high],
      ['m3', y, 2000, low],
      ['m4', x, 2500, undefined],
      ['m5', viewer, 3000, undefined],
      ['m6', y, 4000, undefined]
    ]
    for (const [key, author, offset, id] of plan) {
      await seedTimelineRow({
        actorId: viewer,
        timeline: Timeline.MAIN,
        statusId: s(key),
        statusActorId: author,
        createdAt: BASE + offset,
        id
      })
    }
    for (const [key, author, offset] of [
      ['d1', y, 3500],
      ['d2', x, 1500]
    ] as const) {
      await seedTimelineRow({
        actorId: viewer,
        timeline: Timeline.DIRECT,
        statusId: s(key),
        statusActorId: author,
        createdAt: BASE + offset
      })
    }
    await seedTimelineRow({
      actorId: viewer,
      timeline: `list:${prefix}-list`,
      statusId: s('listed'),
      statusActorId: y,
      createdAt: BASE + 9000
    })
    await db
      .insertInto('lists')
      .values({
        id: `${prefix}-exclusive`,
        actorId: viewer,
        title: 'Exclusive',
        repliesPolicy: 'list',
        exclusive: true,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
    for (const target of [x, viewer]) {
      await db
        .insertInto('list_accounts')
        .values({
          id: randomUUID(),
          listId: `${prefix}-exclusive`,
          actorId: viewer,
          targetActorId: target,
          createdAt: new Date(BASE)
        })
        .execute()
    }
    // In no feed of the viewer: the fallback cursors.
    await seedStatus({ id: s('gone'), actorId: y, createdAt: BASE + 2000 })
    await seedStatus({ id: s('undated'), actorId: y, createdAt: null })
    return { prefix, viewer, s }
  }

  it.each([
    { cursor: {}, limit: 40, expected: ['m6', 'm5', 'm2', 'm3', 'm1'] },
    { cursor: {}, limit: 2, expected: ['m6', 'm5'] },
    { cursor: { maxStatusId: 'm5' }, limit: 40, expected: ['m2', 'm3', 'm1'] },
    { cursor: { maxStatusId: 'm2' }, limit: 40, expected: ['m3', 'm1'] },
    { cursor: { maxStatusId: 'm6' }, limit: 2, expected: ['m5', 'm2'] },
    {
      cursor: { sinceStatusId: 'm3' },
      limit: 40,
      expected: ['m6', 'm5', 'm2']
    },
    { cursor: { sinceStatusId: 'm3' }, limit: 2, expected: ['m6', 'm5'] },
    { cursor: { minStatusId: 'm3' }, limit: 2, expected: ['m5', 'm2'] },
    {
      cursor: { minStatusId: 'm1', maxStatusId: 'm5' },
      limit: 40,
      expected: ['m2', 'm3']
    },
    // In no feed of the viewer: its createdAt, without a tie-breaker.
    { cursor: { maxStatusId: 'gone' }, limit: 40, expected: ['m1'] },
    { cursor: { sinceStatusId: 'gone' }, limit: 40, expected: ['m6', 'm5'] },
    { cursor: { minStatusId: 'gone' }, limit: 1, expected: ['m5'] }
  ])(
    'pages the home feed with $cursor and limit $limit',
    async ({ cursor, limit, expected }) => {
      const t = await setup()
      const args = Object.fromEntries(
        Object.entries(cursor).map(([key, name]) => [key, t.s(name)])
      )
      const ids = expected.map(t.s)
      for (const timeline of [Timeline.MAIN, Timeline.HOME]) {
        statusCalls.length = 0
        expect(
          await read({ timeline, actorId: t.viewer, limit, ...args })
        ).toEqual(ids)
        expect(statusCalls).toEqual([[ids, t.viewer]])
      }
    }
  )

  it('reads the direct feed without the exclusive-list filter', async () => {
    const t = await setup()
    expect(
      await read({ timeline: Timeline.DIRECT, actorId: t.viewer })
    ).toEqual(['d1', 'd2', 'm5'].map(t.s))
    expect(
      await read({
        timeline: Timeline.DIRECT,
        actorId: t.viewer,
        maxStatusId: t.s('d1')
      })
    ).toEqual(['d2', 'm5'].map(t.s))
  })

  it('ends on an unknown cursor or a cursor without createdAt, and reads nothing without an actor', async () => {
    const t = await setup()
    statusCalls.length = 0
    for (const cursor of [
      { maxStatusId: t.s('missing') },
      { sinceStatusId: t.s('missing') },
      { minStatusId: t.s('missing') },
      { maxStatusId: t.s('undated') },
      { minStatusId: t.s('undated') }
    ]) {
      expect(
        await read({ timeline: Timeline.MAIN, actorId: t.viewer, ...cursor })
      ).toEqual([])
    }
    expect(await read({ timeline: Timeline.MAIN })).toEqual([])
    expect(
      await read({ timeline: 'unknown' as Timeline, actorId: t.viewer })
    ).toEqual([])
    expect(statusCalls).toEqual([])
  })

  it('ends the page at a feed row without createdAt', async () => {
    const prefix = nextPrefix()
    const viewer = actorIn('home.test', `${prefix}-viewer`)
    const author = actorIn('remote.test', `${prefix}-author`)
    for (const [key, createdAt] of [
      ['undated', null],
      ['dated', BASE]
    ] as const) {
      await seedTimelineRow({
        actorId: viewer,
        timeline: Timeline.MAIN,
        statusId: `${prefix}-${key}`,
        statusActorId: author,
        createdAt
      })
    }
    expect(
      await read({
        timeline: Timeline.MAIN,
        actorId: viewer,
        maxStatusId: `${prefix}-undated`
      })
    ).toEqual([])
    expect(
      (await read({ timeline: Timeline.MAIN, actorId: viewer })).sort()
    ).toEqual([`${prefix}-dated`, `${prefix}-undated`])
  })
})

describe('createTimelineStatus', () => {
  it('adds a status to one actor’s feed once', async () => {
    const prefix = nextPrefix()
    const viewer = actorIn('home.test', `${prefix}-viewer`)
    const other = actorIn('home.test', `${prefix}-other`)
    const author = actorIn('remote.test', `${prefix}-author`)
    const status = (n: number) =>
      ({
        id: `${prefix}-status-${n}`,
        actorId: author,
        createdAt: BASE + n
      }) as unknown as Status
    const rows = async () =>
      (
        await db
          .selectFrom('timelines')
          .select([
            'actorId',
            'timeline',
            'statusId',
            'statusActorId',
            'createdAt'
          ])
          .where('statusId', 'like', `${prefix}-%`)
          .execute()
      )
        .map(
          (row) =>
            `${row.actorId}|${row.timeline}|${row.statusId}|${row.statusActorId}|${row.createdAt}`
        )
        .sort()

    for (const [actorId, timeline, n] of [
      [viewer, Timeline.MAIN, 1],
      [viewer, Timeline.MAIN, 1],
      [viewer, Timeline.DIRECT, 1],
      [other, Timeline.MAIN, 1],
      [viewer, Timeline.MAIN, 2]
    ] as const) {
      await createTimelineStatus(db, { actorId, timeline, status: status(n) })
    }
    expect(await rows()).toEqual(
      [
        `${viewer}|main|${prefix}-status-1|${author}|${BASE + 1}`,
        `${viewer}|direct|${prefix}-status-1|${author}|${BASE + 1}`,
        `${other}|main|${prefix}-status-1|${author}|${BASE + 1}`,
        `${viewer}|main|${prefix}-status-2|${author}|${BASE + 2}`
      ].sort()
    )
  })
})

describe('the public feeds', () => {
  beforeEach(async () => {
    for (const table of [
      'attachments',
      'recipients',
      'statuses',
      'actors',
      'federated_timeline'
    ] as const) {
      await db.deleteFrom(table).execute()
    }
  })

  // Local actors l1 and l2, a remote actor and a remote one stored with an
  // empty key. Status ids sort against time; tieA and tieB share a createdAt
  // and are written out of id order.
  const setupLocal = async () => {
    const [l1, l2, remote, emptyKey] = [
      ['local.test', 'l1'],
      ['local.test', 'l2'],
      ['remote.test', 'remote'],
      ['remote.test', 'empty-key']
    ].map(([domain, name]) => actorIn(domain, name))
    await seedActor(l1, 'key-l1')
    await seedActor(l2, 'key-l2')
    await seedActor(remote, null)
    await seedActor(emptyKey, '')
    const ids: Record<string, string> = {}
    const id = (digit: number) => `https://local.test/s/${digit}`
    ids.remote = await seedStatus({
      id: 'https://remote.test/s/1',
      actorId: remote,
      createdAt: BASE + 8000
    })
    ids.followers = await seedStatus({
      id: id(10),
      actorId: l1,
      createdAt: BASE + 500,
      to: [`${l1}/followers`]
    })
    ids.pub1 = await seedStatus({
      id: id(9),
      actorId: l1,
      createdAt: BASE + 1000
    })
    ids.tieB = await seedStatus({
      id: id(7),
      actorId: l1,
      createdAt: BASE + 2000
    })
    ids.tieA = await seedStatus({
      id: id(8),
      actorId: l2,
      createdAt: BASE + 2000
    })
    ids.media = await seedStatus({
      id: id(6),
      actorId: l2,
      createdAt: BASE + 3000,
      media: true
    })
    ids.boostPublic = await seedStatus({
      id: id(5),
      actorId: l1,
      createdAt: BASE + 4000,
      type: StatusType.enum.Announce,
      originalStatusId: ids.remote
    })
    ids.pub2 = await seedStatus({
      id: id(4),
      actorId: l1,
      createdAt: BASE + 5000
    })
    ids.reply = await seedStatus({
      id: id(3),
      actorId: l1,
      createdAt: BASE + 6000,
      reply: ids.pub1,
      media: true
    })
    ids.ccOnly = await seedStatus({
      id: id(2),
      actorId: l1,
      createdAt: BASE + 6500,
      to: [`${l1}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    ids.compact = await seedStatus({
      id: id(1),
      actorId: l1,
      createdAt: BASE + 7000,
      to: [ACTIVITY_STREAM_PUBLIC_COMPACT]
    })
    ids.boostPrivate = await seedStatus({
      id: id(0),
      actorId: l1,
      createdAt: BASE + 7500,
      type: StatusType.enum.Announce,
      originalStatusId: ids.followers
    })
    ids.emptyKey = await seedStatus({
      id: 'https://remote.test/s/2',
      actorId: emptyKey,
      createdAt: BASE + 8500
    })
    return ids
  }

  const LOCAL_ORDER = ['pub2', 'boostPublic', 'media', 'tieA', 'tieB', 'pub1']

  it.each([
    { cursor: {}, limit: 40, expected: LOCAL_ORDER },
    { cursor: {}, limit: 2, expected: ['pub2', 'boostPublic'] },
    {
      cursor: { maxStatusId: 'pub2' },
      limit: 40,
      expected: LOCAL_ORDER.slice(1)
    },
    { cursor: { maxStatusId: 'tieA' }, limit: 40, expected: ['tieB', 'pub1'] },
    {
      cursor: { minStatusId: 'tieB' },
      limit: 40,
      expected: LOCAL_ORDER.slice(0, 4)
    },
    {
      cursor: { minStatusId: 'pub1', maxStatusId: 'media' },
      limit: 40,
      expected: ['tieA', 'tieB']
    },
    // A cursor need not be in the feed.
    { cursor: { maxStatusId: 'remote' }, limit: 40, expected: LOCAL_ORDER },
    { cursor: { minStatusId: 'compact' }, limit: 40, expected: [] },
    { cursor: {}, limit: 40, onlyMedia: true, expected: ['media'] }
  ])(
    'reads the local public feed with $cursor, limit $limit and onlyMedia $onlyMedia',
    async ({ cursor, limit, onlyMedia, expected }) => {
      const ids = await setupLocal()
      statusCalls.length = 0
      const expectedIds = expected.map((key) => ids[key])
      expect(
        await read({
          timeline: Timeline.LOCAL_PUBLIC,
          limit,
          ...(onlyMedia ? { onlyMedia } : null),
          ...Object.fromEntries(
            Object.entries(cursor).map(([key, name]) => [key, ids[name]])
          )
        })
      ).toEqual(expectedIds)
      expect(statusCalls).toEqual([[expectedIds, undefined]])
    }
  )

  it('counts the local public feed, up to a limit', async () => {
    await setupLocal()
    expect(await getLocalPublicStatusesCount(db)).toBe(LOCAL_ORDER.length)
    expect(await getLocalPublicStatusesCount(db, 2)).toBe(2)
    expect(await getLocalPublicStatusesCount(db, 100)).toBe(LOCAL_ORDER.length)
  })

  // Three posts sharing a createdAt, written in neither id order nor its
  // reverse. A scan in write order and a backward index scan both leave such
  // a tie out of id order, so only the id tie-break puts it in id order.
  it.each([Timeline.LOCAL_PUBLIC, Timeline.FEDERATED_PUBLIC])(
    'breaks a three-way createdAt tie on the status id in the %s feed',
    async (timeline) => {
      const author = actorIn('local.test', 'tie')
      await seedActor(author, 'key-tie')
      for (const digit of [2, 3, 1]) {
        const id = await seedStatus({
          id: `https://local.test/t/${digit}`,
          actorId: author,
          createdAt: BASE + 1000
        })
        await db
          .insertInto('federated_timeline')
          .values({
            statusId: id,
            statusActorId: author,
            createdAt: new Date(BASE)
          })
          .execute()
      }
      expect(await read({ timeline, limit: 40 })).toEqual(
        [3, 2, 1].map((digit) => `https://local.test/t/${digit}`)
      )
    }
  )

  it('ends the local public feed on an unknown cursor or one without createdAt', async () => {
    const ids = await setupLocal()
    ids.undated = await seedStatus({
      id: 'https://local.test/s/undated',
      actorId: actorIn('local.test', 'l1'),
      createdAt: null,
      reply: ids.pub1
    })
    statusCalls.length = 0
    for (const cursor of [
      { maxStatusId: 'https://local.test/s/missing' },
      { minStatusId: 'https://local.test/s/missing' },
      { maxStatusId: ids.undated },
      { minStatusId: ids.undated }
    ]) {
      expect(
        await read({ timeline: Timeline.LOCAL_PUBLIC, ...cursor })
      ).toEqual([])
    }
    expect(statusCalls).toEqual([])
  })

  // Relay-ingested rows. federated_timeline's own createdAt runs against the
  // statuses' createdAt, which is what the feed orders by; fedTieA and fedTieB
  // tie, written out of id order.
  const setupFederated = async () => {
    const author = actorIn('remote.test', 'fed')
    const ids: Record<string, string> = {}
    const id = (digit: number) => `https://remote.test/f/${digit}`
    const plan: [
      string,
      number,
      number,
      Partial<Parameters<typeof seedStatus>[0]>
    ][] = [
      ['fed1', 9, 1000, {}],
      ['fedTieB', 7, 2000, {}],
      ['fedTieA', 8, 2000, {}],
      ['fedMedia', 6, 3000, { media: true, to: [] }],
      ['fed2', 5, 4000, { to: [`${author}/followers`] }],
      ['fedReply', 4, 5000, { reply: id(9), media: true }]
    ]
    for (const [key, digit, offset, extra] of plan) {
      ids[key] = await seedStatus({
        id: id(digit),
        actorId: author,
        createdAt: BASE + offset,
        ...extra
      })
      await db
        .insertInto('federated_timeline')
        .values({
          statusId: ids[key],
          statusActorId: author,
          createdAt: new Date(BASE - offset)
        })
        .execute()
    }
    ids.notFederated = await seedStatus({
      id: id(3),
      actorId: author,
      createdAt: BASE + 6000,
      media: true
    })
    ids.undated = await seedStatus({
      id: id(2),
      actorId: author,
      createdAt: null
    })
    return ids
  }

  const FEDERATED_ORDER = ['fed2', 'fedMedia', 'fedTieA', 'fedTieB', 'fed1']

  it.each([
    { cursor: {}, limit: 40, expected: FEDERATED_ORDER },
    { cursor: {}, limit: 2, expected: ['fed2', 'fedMedia'] },
    {
      cursor: { maxStatusId: 'fedMedia' },
      limit: 40,
      expected: FEDERATED_ORDER.slice(2)
    },
    { cursor: { maxStatusId: 'fedTieA' }, limit: 1, expected: ['fedTieB'] },
    {
      cursor: { minStatusId: 'fedTieB' },
      limit: 40,
      expected: FEDERATED_ORDER.slice(0, 3)
    },
    {
      cursor: { minStatusId: 'fed1', maxStatusId: 'fed2' },
      limit: 40,
      expected: ['fedMedia', 'fedTieA', 'fedTieB']
    },
    { cursor: { minStatusId: 'notFederated' }, limit: 40, expected: [] },
    { cursor: {}, limit: 40, onlyMedia: true, expected: ['fedMedia'] }
  ])(
    'reads the federated feed with $cursor, limit $limit and onlyMedia $onlyMedia',
    async ({ cursor, limit, onlyMedia, expected }) => {
      const ids = await setupFederated()
      statusCalls.length = 0
      const expectedIds = expected.map((key) => ids[key])
      expect(
        await read({
          timeline: Timeline.FEDERATED_PUBLIC,
          limit,
          ...(onlyMedia ? { onlyMedia } : null),
          ...Object.fromEntries(
            Object.entries(cursor).map(([key, name]) => [key, ids[name]])
          )
        })
      ).toEqual(expectedIds)
      expect(statusCalls).toEqual([[expectedIds, undefined]])
    }
  )

  it('ends the federated feed on an unknown cursor or one without createdAt', async () => {
    const ids = await setupFederated()
    statusCalls.length = 0
    for (const cursor of [
      { maxStatusId: 'https://remote.test/f/missing' },
      { minStatusId: 'https://remote.test/f/missing' },
      { maxStatusId: ids.undated },
      { minStatusId: ids.undated }
    ]) {
      expect(
        await read({ timeline: Timeline.FEDERATED_PUBLIC, ...cursor })
      ).toEqual([])
    }
    expect(statusCalls).toEqual([])
  })

  it('appends a status to the federated timeline once', async () => {
    const author = actorIn('remote.test', 'first')
    for (const id of ['https://remote.test/f/x', 'https://remote.test/f/y']) {
      await seedStatus({ id, actorId: author })
    }
    const before = Date.now()
    await addStatusToFederatedTimeline(db, {
      statusId: 'https://remote.test/f/x',
      statusActorId: actorIn('remote.test', 'first')
    })
    await addStatusToFederatedTimeline(db, {
      statusId: 'https://remote.test/f/x',
      statusActorId: actorIn('remote.test', 'second')
    })
    await addStatusToFederatedTimeline(db, {
      statusId: 'https://remote.test/f/y',
      statusActorId: actorIn('remote.test', 'second')
    })
    const rows = await db
      .selectFrom('federated_timeline')
      .selectAll()
      .orderBy('statusId')
      .execute()
    expect(rows).toEqual([
      {
        statusId: 'https://remote.test/f/x',
        statusActorId: actorIn('remote.test', 'first'),
        createdAt: expect.any(Number)
      },
      {
        statusId: 'https://remote.test/f/y',
        statusActorId: actorIn('remote.test', 'second'),
        createdAt: expect.any(Number)
      }
    ])
    expect(rows[0].createdAt).toBeGreaterThanOrEqual(before - 1000)
  })
})

describe('transactions', () => {
  it('createTimelineStatus writes nothing when its insert fails', async () => {
    const prefix = nextPrefix()
    const viewer = actorIn('home.test', `${prefix}-viewer`)
    const statusId = `${prefix}-status`
    const name = 'timeline_queries_fail_insert_timelines'
    if (testDb.backend === 'pg') {
      await sql
        .raw(
          `create or replace function timeline_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
        )
        .execute(db)
      await sql
        .raw(
          `create trigger ${name} before insert on "timelines" for each row when (new."statusId" = '${statusId}') execute function timeline_queries_fail()`
        )
        .execute(db)
    } else {
      await sql
        .raw(
          `create trigger ${name} before insert on "timelines" when new."statusId" = '${statusId}' begin select raise(abort, 'forced failure'); end`
        )
        .execute(db)
    }
    const dump = () =>
      db.selectFrom('timelines').selectAll().orderBy('id').execute()
    const before = await dump()
    try {
      await expect(
        createTimelineStatus(db, {
          actorId: viewer,
          timeline: Timeline.MAIN,
          status: {
            id: statusId,
            actorId: viewer,
            createdAt: BASE
          } as unknown as Status
        })
      ).rejects.toThrow()
    } finally {
      await sql
        .raw(
          testDb.backend === 'pg'
            ? `drop trigger ${name} on "timelines"`
            : `drop trigger ${name}`
        )
        .execute(db)
    }
    expect(await dump()).toEqual(before)
  })
})
