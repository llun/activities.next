import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import {
  getHashtagCounter,
  getHashtagStatusesPage,
  getStatusesByHashtag,
  getTags
} from '@/lib/database/domains/status/hashtags'
import {
  getFavouritedBy,
  getRebloggedBy
} from '@/lib/database/domains/status/interactions'
import {
  getActorAnnounceStatus,
  getActorAnnouncedStatusId,
  getActorStatusFromPathSegment,
  getStatusFromPublicId,
  getStatusFromUrl,
  getStatusFromUrlHash,
  getStatusIdByPublicId,
  getStatusIdsByPublicIds,
  getStatusPublicIds
} from '@/lib/database/domains/status/lookups'
import {
  getPinnedStatusIds,
  pinStatus,
  unpinStatus
} from '@/lib/database/domains/status/pins'
import {
  getActorPollVotes,
  getActorPollVotesForStatuses,
  hasActorVoted
} from '@/lib/database/domains/status/polls'
import type {
  StatusHydration,
  StatusRow
} from '@/lib/database/domains/status/types'
import { inTransaction } from '@/lib/database/kysely'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { encodeFavouritedByCursor } from '@/lib/database/sql/utils/favouritedByCursor'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { type Status, StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { generatePublicId } from '@/lib/utils/publicId'

// Query-level tests for the status lookups, poll reads, hashtag reads, pins
// and the favourited-by and reblogged-by pages (lib/database/domains/status).
// Every test uses its own actors and statuses (a fresh prefix) and writes
// neighbouring rows next to the ones under test: a lookup is first asked for
// a row only its neighbours come close to, and must find nothing, so a
// dropped predicate returns a wrong row rather than happening to return the
// right one. Rows that tie on their sort key are written out of id order, and
// ids that tie differ in a digit, not in letter case. Hydration is a fake
// that records what it is asked for. Runs on PostgreSQL in CI.

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
const nextPrefix = () => `sl${++prefixCount}`
const BASE = Date.UTC(2026, 0, 1)
const actorIn = (domain: string, name: string) =>
  `https://${domain}/users/${name}`

type HydrationCall =
  | [
      'getStatus',
      { statusId: string; currentActorId?: string; withReplies?: boolean }
    ]
  | ['getStatusesByIds', { statusIds: string[]; currentActorId?: string }]
  | ['hydrateStatusRow', StatusRow, string | undefined]

// A hydration that records what it is asked for: getStatus answers from the
// row it finds, the other two echo the ids or the row they are given.
const hydrationCalls: HydrationCall[] = []
const hydration: StatusHydration = {
  getStatus: async (params) => {
    hydrationCalls.push(['getStatus', params])
    const row = await db
      .selectFrom('statuses')
      .select(['id', 'actorId'])
      .where('id', '=', params.statusId)
      .executeTakeFirst()
    return row
      ? ({ id: row.id, actorId: row.actorId } as unknown as Status)
      : null
  },
  getStatusesByIds: async (params) => {
    hydrationCalls.push(['getStatusesByIds', params])
    return params.statusIds.map((id) => ({ id }) as unknown as Status)
  },
  hydrateStatusRow: async (row, currentActorId) => {
    hydrationCalls.push(['hydrateStatusRow', row, currentActorId])
    return { id: row.id, actorId: row.actorId } as unknown as Status
  }
}

beforeEach(() => {
  hydrationCalls.length = 0
})

// The statements `run` sends, as the Kysely driver reports them on the Knex
// `query` event.
const capture = async <T>(run: () => Promise<T>) => {
  const statements: { sql: string; bindings: unknown[] }[] = []
  const listener = (event: { sql: string; bindings?: unknown[] }) => {
    statements.push({ sql: event.sql, bindings: event.bindings ?? [] })
  }
  testDb.knex.on('query', listener)
  try {
    const result = await run()
    return { result, statements }
  } finally {
    testDb.knex.off('query', listener)
  }
}

const seedActor = async (id: string, privateKey: string | null = null) => {
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
  return id
}

const seedStatus = async ({
  id,
  actorId,
  createdAt = BASE,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  type = StatusType.enum.Note,
  originalStatusId = null,
  content = null,
  url = id,
  urlHash = getHashFromString(url),
  publicId = null,
  media = false
}: {
  id: string
  actorId: string
  createdAt?: number | null
  to?: string[]
  cc?: string[]
  type?: StatusType
  originalStatusId?: string | null
  content?: string | null
  url?: string
  urlHash?: string
  publicId?: string | null
  media?: boolean
}) => {
  const at = createdAt === null ? null : new Date(createdAt)
  await db
    .insertInto('statuses')
    .values({
      id,
      url,
      urlHash,
      actorId,
      type,
      reply: '',
      content,
      originalStatusId,
      publicId,
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

const statementsReadingOneRow = (
  statements: { sql: string; bindings: unknown[] }[]
) =>
  statements.map(({ sql: text, bindings }) => ({
    limited: / limit (\?|\$\d+)$/.test(text),
    lastBinding: bindings.at(-1)
  }))

describe('status lookups', () => {
  it('getStatusFromUrl matches both the url hash and the url, then hydrates by id', async () => {
    const prefix = nextPrefix()
    const author = actorIn('a.test', `${prefix}-author`)
    const url = `${author}/statuses/target`
    // The same hash under another url (a hash collision), and the same url
    // under a stale hash.
    await seedStatus({
      id: `${author}/statuses/collision`,
      actorId: author,
      url: `${url}/other`,
      urlHash: getHashFromString(url)
    })
    await seedStatus({
      id: `${author}/statuses/stale`,
      actorId: author,
      url,
      urlHash: 'stale-hash'
    })

    await expect(getStatusFromUrl(db, hydration, { url })).resolves.toBeNull()
    expect(hydrationCalls).toEqual([])

    await seedStatus({ id: `${author}/statuses/row`, actorId: author, url })
    await expect(
      getStatusFromUrl(db, hydration, { url, currentActorId: 'viewer' })
    ).resolves.toEqual({ id: `${author}/statuses/row`, actorId: author })
    expect(hydrationCalls).toEqual([
      [
        'getStatus',
        { statusId: `${author}/statuses/row`, currentActorId: 'viewer' }
      ]
    ])
  })

  it('getStatusFromUrlHash hydrates the whole row, by its author when one is given', async () => {
    const prefix = nextPrefix()
    const alice = actorIn('a.test', `${prefix}-alice`)
    const bob = actorIn('a.test', `${prefix}-bob`)
    const hash = `${prefix}-hash1`
    await seedStatus({
      id: `${alice}/statuses/1`,
      actorId: alice,
      urlHash: hash
    })
    await seedStatus({
      id: `${bob}/statuses/other-hash`,
      actorId: bob,
      urlHash: `${prefix}-hash2`
    })

    // Alice's row has the hash, bob's other row has bob.
    await expect(
      getStatusFromUrlHash(db, hydration, { urlHash: hash, actorId: bob })
    ).resolves.toBeNull()
    expect(hydrationCalls).toEqual([])

    await seedStatus({
      id: `${bob}/statuses/1`,
      actorId: bob,
      urlHash: hash,
      publicId: generatePublicId(BASE)
    })
    await expect(
      getStatusFromUrlHash(db, hydration, {
        urlHash: hash,
        actorId: bob,
        currentActorId: 'viewer'
      })
    ).resolves.toEqual({ id: `${bob}/statuses/1`, actorId: bob })
    expect(hydrationCalls).toEqual([
      [
        'hydrateStatusRow',
        expect.objectContaining({
          id: `${bob}/statuses/1`,
          url: `${bob}/statuses/1`,
          urlHash: hash,
          actorId: bob,
          type: StatusType.enum.Note,
          publicId: expect.any(String),
          createdAt: BASE
        }),
        'viewer'
      ]
    ])

    // Without an author (or an empty one) the hash alone decides.
    await expect(
      getStatusFromUrlHash(db, hydration, { urlHash: `${prefix}-hash2` })
    ).resolves.toEqual({ id: `${bob}/statuses/other-hash`, actorId: bob })
    await expect(
      getStatusFromUrlHash(db, hydration, {
        urlHash: `${prefix}-hash2`,
        actorId: ''
      })
    ).resolves.toEqual({ id: `${bob}/statuses/other-hash`, actorId: bob })
    await expect(
      getStatusFromUrlHash(db, hydration, { urlHash: `${prefix}-hash3` })
    ).resolves.toBeNull()
  })

  it('getStatusIdByPublicId and getStatusFromPublicId match the publicId in any case', async () => {
    const prefix = nextPrefix()
    const author = actorIn('a.test', `${prefix}-author`)
    const target = generatePublicId(BASE + 2)
    await seedStatus({
      id: `${author}/statuses/neighbour`,
      actorId: author,
      publicId: generatePublicId(BASE + 1)
    })

    await expect(
      getStatusIdByPublicId(db, { publicId: target })
    ).resolves.toBeNull()
    await expect(
      getStatusFromPublicId(db, hydration, { publicId: target })
    ).resolves.toBeNull()
    expect(hydrationCalls).toEqual([])

    await seedStatus({
      id: `${author}/statuses/target`,
      actorId: author,
      publicId: target
    })
    await expect(
      getStatusIdByPublicId(db, { publicId: target.toUpperCase() })
    ).resolves.toBe(`${author}/statuses/target`)
    await expect(
      getStatusFromPublicId(db, hydration, {
        publicId: target.toUpperCase(),
        currentActorId: 'viewer'
      })
    ).resolves.toEqual({ id: `${author}/statuses/target`, actorId: author })
    expect(hydrationCalls).toEqual([
      [
        'hydrateStatusRow',
        expect.objectContaining({
          id: `${author}/statuses/target`,
          publicId: target,
          actorId: author,
          createdAt: BASE
        }),
        'viewer'
      ]
    ])
  })

  it('getStatusIdsByPublicIds keys the map by the publicIds as requested, in IN-list chunks', async () => {
    const prefix = nextPrefix()
    const author = actorIn('a.test', `${prefix}-author`)
    const first = generatePublicId(BASE + 1)
    const second = generatePublicId(BASE + 2)
    const unrequested = generatePublicId(BASE + 3)
    await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      publicId: first
    })
    await seedStatus({
      id: `${author}/statuses/2`,
      actorId: author,
      publicId: second
    })
    await seedStatus({
      id: `${author}/statuses/3`,
      actorId: author,
      publicId: unrequested
    })

    const batchSize = getWhereInBatchSize(db)
    const missing = Array.from({ length: batchSize + 4 }, () =>
      generatePublicId(BASE + 10)
    )
    const { result, statements } = await capture(() =>
      getStatusIdsByPublicIds(db, {
        publicIds: [...missing, first, second.toUpperCase(), '']
      })
    )

    expect(Object.fromEntries(result)).toEqual({
      [first]: `${author}/statuses/1`,
      [second.toUpperCase()]: `${author}/statuses/2`
    })
    // 1 + batchSize + 5 distinct keys; the chunks run concurrently.
    expect(
      statements.map(({ bindings }) => bindings.length).sort((a, b) => b - a)
    ).toEqual([batchSize, 6])
    await expect(
      getStatusIdsByPublicIds(db, { publicIds: [] })
    ).resolves.toEqual(new Map())
  })

  it('getStatusPublicIds answers only the requested ids that have a publicId', async () => {
    const prefix = nextPrefix()
    const author = actorIn('a.test', `${prefix}-author`)
    const publicId = generatePublicId(BASE)
    await seedStatus({
      id: `${author}/statuses/with`,
      actorId: author,
      publicId
    })
    await seedStatus({ id: `${author}/statuses/without`, actorId: author })
    await seedStatus({
      id: `${author}/statuses/unrequested`,
      actorId: author,
      publicId: generatePublicId(BASE + 1)
    })

    const result = await getStatusPublicIds(db, {
      statusIds: [
        `${author}/statuses/with`,
        `${author}/statuses/without`,
        `${author}/statuses/missing`
      ]
    })
    expect(Object.fromEntries(result)).toEqual({
      [`${author}/statuses/with`]: publicId
    })

    const { result: empty, statements } = await capture(() =>
      getStatusPublicIds(db, { statusIds: [] })
    )
    expect(empty).toEqual(new Map())
    expect(statements).toEqual([])
  })

  it("getActorStatusFromPathSegment reads the actor's local id first, then the actor's own publicId", async () => {
    const prefix = nextPrefix()
    const alice = actorIn('a.test', `${prefix}-alice`)
    const bob = actorIn('a.test', `${prefix}-bob`)
    const alicePublicId = generatePublicId(BASE + 1)
    const bobPublicId = generatePublicId(BASE + 2)
    await seedStatus({ id: `${alice}/statuses/local`, actorId: alice })
    await seedStatus({
      id: `${alice}/statuses/remote-shaped`,
      actorId: alice,
      publicId: alicePublicId
    })
    await seedStatus({
      id: `${bob}/statuses/bobs`,
      actorId: bob,
      publicId: bobPublicId
    })

    await expect(
      getActorStatusFromPathSegment(db, hydration, {
        actorId: alice,
        pathSegment: 'local',
        withReplies: true
      })
    ).resolves.toEqual({ id: `${alice}/statuses/local`, actorId: alice })
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: `${alice}/statuses/local`, withReplies: true }]
    ])

    hydrationCalls.length = 0
    await expect(
      getActorStatusFromPathSegment(db, hydration, {
        actorId: alice,
        pathSegment: alicePublicId
      })
    ).resolves.toEqual({
      id: `${alice}/statuses/remote-shaped`,
      actorId: alice
    })
    expect(hydrationCalls).toEqual([
      [
        'getStatus',
        {
          statusId: `${alice}/statuses/${alicePublicId}`,
          withReplies: undefined
        }
      ],
      [
        'getStatus',
        { statusId: `${alice}/statuses/remote-shaped`, withReplies: undefined }
      ]
    ])

    // Another actor's publicId does not resolve under alice's path.
    await expect(
      getActorStatusFromPathSegment(db, hydration, {
        actorId: alice,
        pathSegment: bobPublicId
      })
    ).resolves.toBeNull()

    // A segment that is not a publicId, and a publicId nothing has, stop
    // after the local lookup.
    hydrationCalls.length = 0
    const notPublicId = await capture(() =>
      getActorStatusFromPathSegment(db, hydration, {
        actorId: alice,
        pathSegment: 'missing'
      })
    )
    expect(notPublicId.result).toBeNull()
    // The local lookup only: the segment is never looked up as a publicId.
    expect(notPublicId.statements).toHaveLength(1)
    const { result, statements } = await capture(() =>
      getActorStatusFromPathSegment(db, hydration, {
        actorId: alice,
        pathSegment: generatePublicId(BASE + 3)
      })
    )
    expect(result).toBeNull()
    expect(hydrationCalls.map(([name]) => name)).toEqual([
      'getStatus',
      'getStatus'
    ])
    // The local lookup and the publicId lookup.
    expect(statements).toHaveLength(2)
  })

  it("getActorAnnouncedStatusId and getActorAnnounceStatus find the actor's own Announce of the status", async () => {
    const prefix = nextPrefix()
    const alice = actorIn('a.test', `${prefix}-alice`)
    const bob = actorIn('a.test', `${prefix}-bob`)
    const original = `${bob}/statuses/original`
    const otherOriginal = `${bob}/statuses/other-original`
    await seedStatus({ id: original, actorId: bob })
    await seedStatus({ id: otherOriginal, actorId: bob })
    // Alice's Note pointing at the status, bob's Announce of it and alice's
    // Announce of another status.
    await seedStatus({
      id: `${alice}/statuses/note`,
      actorId: alice,
      originalStatusId: original
    })
    await seedStatus({
      id: `${bob}/statuses/announce`,
      actorId: bob,
      type: StatusType.enum.Announce,
      originalStatusId: original
    })
    await seedStatus({
      id: `${alice}/statuses/announce-other`,
      actorId: alice,
      type: StatusType.enum.Announce,
      originalStatusId: otherOriginal
    })

    await expect(
      getActorAnnouncedStatusId(db, {
        actorId: alice,
        originalStatusId: original
      })
    ).resolves.toBeNull()
    await expect(
      getActorAnnounceStatus(db, hydration, {
        actorId: alice,
        statusId: original
      })
    ).resolves.toBeNull()
    expect(hydrationCalls).toEqual([])

    await seedStatus({
      id: `${alice}/statuses/announce`,
      actorId: alice,
      type: StatusType.enum.Announce,
      originalStatusId: original,
      content: original
    })
    await expect(
      getActorAnnouncedStatusId(db, {
        actorId: alice,
        originalStatusId: original
      })
    ).resolves.toBe(`${alice}/statuses/announce`)
    await expect(
      getActorAnnounceStatus(db, hydration, {
        actorId: alice,
        statusId: original
      })
    ).resolves.toEqual({ id: `${alice}/statuses/announce`, actorId: alice })
    expect(hydrationCalls).toEqual([
      [
        'hydrateStatusRow',
        expect.objectContaining({
          id: `${alice}/statuses/announce`,
          type: StatusType.enum.Announce,
          originalStatusId: original,
          content: original
        }),
        undefined
      ]
    ])

    // No actor, no query.
    const { result, statements } = await capture(() =>
      getActorAnnounceStatus(db, hydration, { statusId: original })
    )
    expect(result).toBeNull()
    expect(statements).toEqual([])
  })

  it.each<[string, () => Promise<unknown>]>([
    [
      'getStatusFromUrl',
      () => getStatusFromUrl(db, hydration, { url: 'https://a.test/none' })
    ],
    [
      'getStatusFromUrlHash',
      () =>
        getStatusFromUrlHash(db, hydration, { urlHash: 'none', actorId: 'x' })
    ],
    [
      'getStatusIdByPublicId',
      () => getStatusIdByPublicId(db, { publicId: generatePublicId(BASE) })
    ],
    [
      'getStatusFromPublicId',
      () =>
        getStatusFromPublicId(db, hydration, {
          publicId: generatePublicId(BASE)
        })
    ],
    [
      'getActorAnnouncedStatusId',
      () =>
        getActorAnnouncedStatusId(db, {
          actorId: 'x',
          originalStatusId: 'y'
        })
    ],
    [
      'getActorAnnounceStatus',
      () =>
        getActorAnnounceStatus(db, hydration, { actorId: 'x', statusId: 'y' })
    ],
    ['hasActorVoted', () => hasActorVoted(db, { statusId: 'x', actorId: 'y' })],
    [
      "getStatusesByHashtag's cursor",
      () =>
        getStatusesByHashtag(db, hydration, {
          hashtag: 'none',
          maxStatusId: 'missing'
        })
    ],
    [
      "getStatusesByHashtag's min cursor",
      () =>
        getStatusesByHashtag(db, hydration, {
          hashtag: 'none',
          minStatusId: 'missing'
        })
    ],
    [
      "getRebloggedBy's cursor",
      () => getRebloggedBy(db, { statusId: 'x', maxStatusId: 'missing' })
    ]
  ])('%s reads at most one row', async (_name, run) => {
    const { statements } = await capture(run)
    expect(statementsReadingOneRow(statements)).toEqual([
      { limited: true, lastBinding: 1 }
    ])
  })
})

describe('poll reads', () => {
  const seedVote = (statusId: string, actorId: string, choice: number) =>
    db
      .insertInto('poll_answers')
      .values({ statusId, actorId, choice })
      .execute()

  it("hasActorVoted and getActorPollVotes read only the actor's answers on the status", async () => {
    const prefix = nextPrefix()
    const alice = actorIn('a.test', `${prefix}-alice`)
    const bob = actorIn('a.test', `${prefix}-bob`)
    const poll = `${bob}/statuses/poll1`
    const otherPoll = `${bob}/statuses/poll2`
    await seedVote(poll, bob, 1)
    await seedVote(otherPoll, alice, 3)

    await expect(
      hasActorVoted(db, { statusId: poll, actorId: alice })
    ).resolves.toBe(false)
    await expect(
      getActorPollVotes(db, { statusId: poll, actorId: alice })
    ).resolves.toEqual([])

    await seedVote(poll, alice, 2)
    await seedVote(poll, alice, 0)
    await expect(
      hasActorVoted(db, { statusId: poll, actorId: alice })
    ).resolves.toBe(true)
    // No order is asked for.
    expect(
      (await getActorPollVotes(db, { statusId: poll, actorId: alice })).sort()
    ).toEqual([0, 2])
  })

  it('getActorPollVotesForStatuses gives every requested status its choices in ascending order', async () => {
    const prefix = nextPrefix()
    const alice = actorIn('a.test', `${prefix}-alice`)
    const bob = actorIn('a.test', `${prefix}-bob`)
    const poll1 = `${bob}/statuses/poll1`
    const poll2 = `${bob}/statuses/poll2`
    const poll3 = `${bob}/statuses/poll3`
    const unrequested = `${bob}/statuses/poll4`
    // Written out of choice order, with bob's answers and an unrequested
    // poll's between them.
    await seedVote(poll2, alice, 2)
    await seedVote(poll1, bob, 1)
    await seedVote(poll1, alice, 3)
    await seedVote(unrequested, alice, 0)
    await seedVote(poll2, alice, 0)
    await seedVote(poll1, alice, 1)

    const result = await getActorPollVotesForStatuses(db, {
      statusIds: [poll2, poll1, poll2, poll3],
      actorId: alice
    })
    expect(result).toEqual({ [poll2]: [0, 2], [poll1]: [1, 3], [poll3]: [] })
    expect(Object.keys(result)).toEqual([poll2, poll1, poll3])

    const { result: empty, statements } = await capture(() =>
      getActorPollVotesForStatuses(db, { statusIds: [], actorId: alice })
    )
    expect(empty).toEqual({})
    expect(statements).toEqual([])
  })

  it('getActorPollVotesForStatuses splits a long id list, keeping a binding for the actor', async () => {
    const prefix = nextPrefix()
    const alice = actorIn('a.test', `${prefix}-alice`)
    const batchSize = getWhereInBatchSize(db, 1)
    const statusIds = Array.from(
      { length: batchSize + 2 },
      (_unused, index) => `${alice}/statuses/poll${index}`
    )
    await seedVote(statusIds[batchSize + 1], alice, 4)
    await seedVote(statusIds[0], alice, 1)

    const { result, statements } = await capture(() =>
      getActorPollVotesForStatuses(db, { statusIds, actorId: alice })
    )
    expect(statements.map(({ bindings }) => bindings.length)).toEqual([
      batchSize + 1,
      3
    ])
    expect(result[statusIds[0]]).toEqual([1])
    expect(result[statusIds[batchSize + 1]]).toEqual([4])
    expect(Object.keys(result)).toHaveLength(batchSize + 2)
  })

  it('getActorPollVotesForStatuses reads a repeated id once, even when the repeat would fall in another chunk', async () => {
    const prefix = nextPrefix()
    const alice = actorIn('a.test', `${prefix}-alice`)
    const batchSize = getWhereInBatchSize(db, 1)
    const voted = `${alice}/statuses/voted`
    await seedVote(voted, alice, 1)
    const statusIds = [
      voted,
      ...Array.from(
        { length: batchSize },
        (_unused, index) => `${alice}/statuses/unvoted${index}`
      ),
      voted
    ]

    const { result, statements } = await capture(() =>
      getActorPollVotesForStatuses(db, { statusIds, actorId: alice })
    )
    expect(statements.map(({ bindings }) => bindings.length)).toEqual([
      batchSize + 1,
      2
    ])
    expect(result[voted]).toEqual([1])
    expect(Object.keys(result)).toHaveLength(batchSize + 1)
  })
})

describe('hashtag reads', () => {
  const seedTag = async ({
    statusId,
    name,
    type = 'hashtag',
    nameNormalized = `#${name}`,
    createdAt = BASE
  }: {
    statusId: string
    name: string
    type?: string
    nameNormalized?: string
    createdAt?: number | null
  }) => {
    const at = createdAt === null ? null : new Date(createdAt)
    const id = randomUUID()
    await db
      .insertInto('tags')
      .values({
        id,
        statusId,
        type,
        name: type === 'hashtag' ? `#${name}` : name,
        nameNormalized,
        value: '',
        createdAt: at,
        updatedAt: at
      })
      .execute()
    return id
  }

  it("getTags reads the status's tags, a missing timestamp as 0", async () => {
    const prefix = nextPrefix()
    const author = actorIn('a.test', `${prefix}-author`)
    const status = `${author}/statuses/1`
    await seedTag({ statusId: `${author}/statuses/2`, name: `${prefix}x` })
    const first = await seedTag({
      statusId: status,
      name: `${prefix}a`,
      createdAt: BASE + 1
    })
    const second = await seedTag({
      statusId: status,
      name: `${prefix}b`,
      createdAt: null
    })

    const tags = await getTags(db, { statusId: status })
    expect(tags.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      {
        id: first,
        statusId: status,
        type: 'hashtag',
        name: `#${prefix}a`,
        value: '',
        createdAt: BASE + 1,
        updatedAt: BASE + 1
      },
      {
        id: second,
        statusId: status,
        type: 'hashtag',
        name: `#${prefix}b`,
        value: '',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    await expect(
      getTags(db, { statusId: `${author}/statuses/3` })
    ).resolves.toEqual([])
  })

  // One hashtag, `${prefix}t`, on five public statuses s1..s5 (s4 and s5
  // tied, written out of id order), and on neighbours that must never be
  // listed: an Announce, a followers-only Note, an emoji tag of the same name
  // and a status with another hashtag. s3 is addressed to the public twice,
  // so it joins two recipient rows.
  const setupHashtag = async () => {
    const prefix = nextPrefix()
    const tag = `${prefix}t`
    const local = await seedActor(actorIn('a.test', `${prefix}-local`), 'key')
    const remote = await seedActor(actorIn('b.test', `${prefix}-remote`))
    const unknown = actorIn('c.test', `${prefix}-unknown`)
    const id = (actor: string, name: string) => `${actor}/statuses/${name}`

    // Neighbours first, each newer than everything listed.
    const announce = await seedStatus({
      id: id(local, 'announce'),
      actorId: local,
      type: StatusType.enum.Announce,
      createdAt: BASE + 9000
    })
    await seedTag({ statusId: announce, name: tag })
    const followersOnly = await seedStatus({
      id: id(local, 'followers'),
      actorId: local,
      to: [`${local}/followers`],
      createdAt: BASE + 9001
    })
    await seedTag({ statusId: followersOnly, name: tag })
    const emoji = await seedStatus({
      id: id(local, 'emoji'),
      actorId: local,
      createdAt: BASE + 9002
    })
    await seedTag({
      statusId: emoji,
      name: `:${tag}:`,
      type: 'emoji',
      nameNormalized: `#${tag}`
    })
    const otherTag = await seedStatus({
      id: id(local, 'other-tag'),
      actorId: local,
      createdAt: BASE + 9003
    })
    await seedTag({ statusId: otherTag, name: `${prefix}w` })

    const s1 = await seedStatus({
      id: id(local, 's1'),
      actorId: local,
      createdAt: BASE + 1000
    })
    await seedTag({ statusId: s1, name: tag })
    await seedTag({ statusId: s1, name: `${prefix}u` })
    // A Poll, public through the compact form, tagged the legacy way.
    const s2 = await seedStatus({
      id: id(remote, 's2'),
      actorId: remote,
      type: StatusType.enum.Poll,
      to: [],
      cc: [ACTIVITY_STREAM_PUBLIC_COMPACT],
      createdAt: BASE + 2000
    })
    await seedTag({ statusId: s2, name: tag, nameNormalized: tag })
    const s3 = await seedStatus({
      id: id(unknown, 's3'),
      actorId: unknown,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTIVITY_STREAM_PUBLIC_COMPACT],
      createdAt: BASE + 3000,
      media: true
    })
    await seedTag({ statusId: s3, name: tag })
    await seedTag({ statusId: s3, name: `${prefix}v` })
    const s5 = await seedStatus({
      id: id(local, 'tie2'),
      actorId: local,
      createdAt: BASE + 4000,
      media: true
    })
    await seedTag({ statusId: s5, name: tag })
    const s4 = await seedStatus({
      id: id(local, 'tie1'),
      actorId: local,
      createdAt: BASE + 4000
    })
    await seedTag({ statusId: s4, name: tag })
    await seedTag({ statusId: s4, name: `${prefix}u` })
    await seedTag({ statusId: s4, name: `${prefix}v` })

    // A status with no createdAt, as a cursor.
    const undated = await seedStatus({
      id: id(local, 'undated'),
      actorId: local,
      createdAt: null
    })

    return {
      prefix,
      tag,
      s1,
      s2,
      s3,
      s4,
      s5,
      otherTag,
      undated,
      missing: id(local, 'missing')
    }
  }

  const listed = async (
    params: Omit<Parameters<typeof getStatusesByHashtag>[2], 'hashtag'> & {
      hashtag: string
    }
  ) =>
    (await getStatusesByHashtag(db, hydration, params)).map(
      (status) => status.id
    )

  it('getStatusesByHashtag lists public Notes and Polls with the tag, newest first', async () => {
    const { tag, s1, s2, s3, s4, s5 } = await setupHashtag()

    await expect(
      listed({ hashtag: tag, currentActorId: 'viewer' })
    ).resolves.toEqual([s5, s4, s3, s2, s1])
    expect(hydrationCalls).toEqual([
      [
        'getStatusesByIds',
        { statusIds: [s5, s4, s3, s2, s1], currentActorId: 'viewer' }
      ]
    ])
    // The tag in any spelling.
    await expect(
      listed({ hashtag: `#${tag.toUpperCase()}`, limit: 2 })
    ).resolves.toEqual([s5, s4])
  })

  it('getStatusesByHashtag pages past a max or min cursor and refuses one it cannot place', async () => {
    const { tag, s1, s2, s3, s4, s5, missing, undated } = await setupHashtag()

    // Past s5 is s4, its tied twin with the lower id.
    await expect(listed({ hashtag: tag, maxStatusId: s5 })).resolves.toEqual([
      s4,
      s3,
      s2,
      s1
    ])
    await expect(listed({ hashtag: tag, maxStatusId: s4 })).resolves.toEqual([
      s3,
      s2,
      s1
    ])
    // A min cursor keeps the newest page above it.
    await expect(
      listed({ hashtag: tag, minStatusId: s2, limit: 2 })
    ).resolves.toEqual([s5, s4])
    await expect(listed({ hashtag: tag, minStatusId: s4 })).resolves.toEqual([
      s5
    ])
    await expect(
      listed({ hashtag: tag, minStatusId: s2, maxStatusId: s4 })
    ).resolves.toEqual([s3])

    // A tagged status from the epoch itself, with an id below the undated
    // cursor's: the cursor's missing createdAt must not be read as 0.
    const epoch = await seedStatus({
      id: undated.replace(/undated$/, 'epoch'),
      actorId: undated.split('/statuses/')[0],
      createdAt: 0
    })
    await seedTag({ statusId: epoch, name: tag })

    hydrationCalls.length = 0
    await expect(
      listed({ hashtag: tag, maxStatusId: missing })
    ).resolves.toEqual([])
    await expect(
      listed({ hashtag: tag, minStatusId: missing })
    ).resolves.toEqual([])
    await expect(
      listed({ hashtag: tag, maxStatusId: undated })
    ).resolves.toEqual([])
    await expect(
      listed({ hashtag: tag, minStatusId: undated })
    ).resolves.toEqual([])
    expect(hydrationCalls).toEqual([])
  })

  it('getStatusesByHashtag narrows by any, all and none tags', async () => {
    const { prefix, tag, s1, s2, s3, s4, s5, otherTag } = await setupHashtag()
    // Emoji rows under the normalized names of an all and a none tag count for
    // neither.
    await seedTag({
      statusId: s5,
      name: `:${prefix}u:`,
      type: 'emoji',
      nameNormalized: `#${prefix}u`
    })
    await seedTag({
      statusId: s1,
      name: `:${prefix}v:`,
      type: 'emoji',
      nameNormalized: `#${prefix}v`
    })

    await expect(
      listed({ hashtag: tag, anyTags: [`${prefix}w`] })
    ).resolves.toEqual([otherTag, s5, s4, s3, s2, s1])
    await expect(
      listed({ hashtag: tag, allTags: [`${prefix}u`] })
    ).resolves.toEqual([s4, s1])
    await expect(
      listed({ hashtag: tag, allTags: [`${prefix}u`, `${prefix}v`] })
    ).resolves.toEqual([s4])
    await expect(
      listed({ hashtag: tag, allTags: [`${prefix}u`, '#'] })
    ).resolves.toEqual([])
    await expect(
      listed({ hashtag: tag, noneTags: [`${prefix}v`] })
    ).resolves.toEqual([s5, s2, s1])
    await expect(listed({ hashtag: tag, noneTags: ['#'] })).resolves.toEqual([
      s5,
      s4,
      s3,
      s2,
      s1
    ])
  })

  it('getStatusesByHashtag narrows to statuses with media, and to local or remote authors', async () => {
    const { tag, s1, s2, s3, s4, s5 } = await setupHashtag()

    await expect(listed({ hashtag: tag, onlyMedia: true })).resolves.toEqual([
      s5,
      s3
    ])
    await expect(listed({ hashtag: tag, local: true })).resolves.toEqual([
      s5,
      s4,
      s1
    ])
    // Remote includes the author with no actors row.
    await expect(listed({ hashtag: tag, remote: true })).resolves.toEqual([
      s3,
      s2
    ])
    await expect(
      listed({ hashtag: tag, local: true, remote: true })
    ).resolves.toEqual([s5, s4, s3, s2, s1])
  })

  it('getStatusesByHashtag answers an empty tag, and an empty page, without hydrating', async () => {
    const { tag, s1 } = await setupHashtag()

    const { result, statements } = await capture(() =>
      getStatusesByHashtag(db, hydration, { hashtag: '#' })
    )
    expect(result).toEqual([])
    expect(statements).toEqual([])

    await expect(listed({ hashtag: tag, maxStatusId: s1 })).resolves.toEqual([])
    expect(hydrationCalls).toEqual([])
  })

  it('getHashtagStatusesPage pages by offset and counts each status once', async () => {
    const { tag, s3, s4 } = await setupHashtag()

    await expect(
      getHashtagStatusesPage(db, hydration, {
        hashtag: `#${tag}`,
        limit: 2,
        offset: 1
      })
    ).resolves.toEqual({ statuses: [{ id: s4 }, { id: s3 }], total: 5 })
    expect(hydrationCalls).toEqual([
      ['getStatusesByIds', { statusIds: [s4, s3] }]
    ])

    hydrationCalls.length = 0
    await expect(
      getHashtagStatusesPage(db, hydration, {
        hashtag: tag,
        limit: 2,
        offset: 5
      })
    ).resolves.toEqual({ statuses: [], total: 5 })
    expect(hydrationCalls).toEqual([])

    const { result, statements } = await capture(() =>
      getHashtagStatusesPage(db, hydration, {
        hashtag: '#',
        limit: 2,
        offset: 0
      })
    )
    expect(result).toEqual({ statuses: [], total: 0 })
    expect(statements).toEqual([])
  })

  it('getHashtagStatusesPage breaks createdAt ties by id, descending', async () => {
    const { tag, s1 } = await setupHashtag()
    const local = s1.split('/statuses/')[0]
    // Four newest statuses on one createdAt, written neither in id order nor
    // against it.
    const tied: Record<string, string> = {}
    for (const name of ['p2', 'p4', 'p1', 'p3']) {
      tied[name] = await seedStatus({
        id: `${local}/statuses/${name}`,
        actorId: local,
        createdAt: BASE + 5000
      })
      await seedTag({ statusId: tied[name], name: tag })
    }

    await expect(
      getHashtagStatusesPage(db, hydration, {
        hashtag: tag,
        limit: 4,
        offset: 0
      })
    ).resolves.toEqual({
      statuses: [
        { id: tied.p4 },
        { id: tied.p3 },
        { id: tied.p2 },
        { id: tied.p1 }
      ],
      total: 9
    })
    await expect(
      getHashtagStatusesPage(db, hydration, {
        hashtag: tag,
        limit: 2,
        offset: 1
      })
    ).resolves.toEqual({
      statuses: [{ id: tied.p3 }, { id: tied.p2 }],
      total: 9
    })
  })

  it('getHashtagCounter reads the counter of the normalized tag', async () => {
    const prefix = nextPrefix()
    await db
      .insertInto('counters')
      .values([
        { id: CounterKey.totalHashtag(`${prefix}t2`), value: 3 },
        { id: CounterKey.totalHashtag(`${prefix}t`), value: 7 }
      ])
      .execute()

    await expect(
      getHashtagCounter(db, { hashtag: ` #${prefix.toUpperCase()}T ` })
    ).resolves.toBe(7)
    await expect(
      getHashtagCounter(db, { hashtag: `${prefix}t3` })
    ).resolves.toBe(0)
  })
})

// Forces the next insert on `table` whose `column` is `value` to fail with a
// database error. Returns the function that removes the trigger again.
const failInsert = async (table: string, column: string, value: string) => {
  const name = `status_lookup_queries_fail_insert_${table}`.toLowerCase()
  const literal = `'${value.replaceAll("'", "''")}'`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function status_lookup_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db)
    await sql
      .raw(
        `create trigger ${name} before insert on "${table}" for each row when (new."${column}" = ${literal}) execute function status_lookup_queries_fail()`
      )
      .execute(db)
    return () => sql.raw(`drop trigger ${name} on "${table}"`).execute(db)
  }
  await sql
    .raw(
      `create trigger ${name} before insert on "${table}" when new."${column}" = ${literal} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db)
  return () => sql.raw(`drop trigger ${name}`).execute(db)
}

describe('pins', () => {
  const pinsOf = async (actorId: string) =>
    (
      await db
        .selectFrom('status_pins')
        .select('statusId')
        .where('actorId', '=', actorId)
        .orderBy('statusId')
        .execute()
    ).map((row) => row.statusId)

  const seedPin = (
    actorId: string,
    statusId: string,
    createdAt: number | null
  ) =>
    db
      .insertInto('status_pins')
      .values({
        actorId,
        statusId,
        createdAt: createdAt === null ? null : new Date(createdAt),
        updatedAt: createdAt === null ? null : new Date(createdAt)
      })
      .execute()

  // Two actors and statuses s1..s4 by a third.
  const setupPins = async () => {
    const prefix = nextPrefix()
    const alice = await seedActor(actorIn('a.test', `${prefix}-alice`), 'key')
    const bob = await seedActor(actorIn('a.test', `${prefix}-bob`), 'key')
    const author = await seedActor(actorIn('b.test', `${prefix}-author`))
    const statuses: string[] = []
    for (const index of [1, 2, 3, 4]) {
      statuses.push(
        await seedStatus({
          id: `${author}/statuses/${index}`,
          actorId: author
        })
      )
    }
    return { alice, bob, statuses }
  }

  it('pinStatus without a cap pins once, keeping the first pin', async () => {
    const { alice, statuses } = await setupPins()
    const [s1] = statuses

    const before = Date.now()
    await expect(pinStatus(db, { actorId: alice, statusId: s1 })).resolves.toBe(
      true
    )
    const row = await db
      .selectFrom('status_pins')
      .selectAll()
      .where('actorId', '=', alice)
      .executeTakeFirstOrThrow()
    expect(row.statusId).toBe(s1)
    expect(row.createdAt).toBe(row.updatedAt)
    expect(row.createdAt).toBeGreaterThanOrEqual(before)

    await expect(pinStatus(db, { actorId: alice, statusId: s1 })).resolves.toBe(
      true
    )
    const again = await db
      .selectFrom('status_pins')
      .selectAll()
      .where('actorId', '=', alice)
      .execute()
    expect(again).toEqual([row])
  })

  it("pinStatus with a cap counts only the actor's own pins and reports an existing pin", async () => {
    const { alice, bob, statuses } = await setupPins()
    const [s1, s2, s3, s4] = statuses
    // Bob has three pins, among them s2.
    await seedPin(bob, s2, BASE)
    await seedPin(bob, s3, BASE)
    await seedPin(bob, s4, BASE)

    await expect(
      pinStatus(db, { actorId: alice, statusId: s1, maxPinnedStatuses: 2 })
    ).resolves.toBe(true)
    // Bob's pin of s2 is not alice's.
    await expect(
      pinStatus(db, { actorId: alice, statusId: s2, maxPinnedStatuses: 1 })
    ).resolves.toBe(false)
    expect(await pinsOf(alice)).toEqual([s1])
    // Alice's own pin of s1 is reported pinned even at the cap.
    await expect(
      pinStatus(db, { actorId: alice, statusId: s1, maxPinnedStatuses: 1 })
    ).resolves.toBe(true)
    await expect(
      pinStatus(db, { actorId: alice, statusId: s2, maxPinnedStatuses: 2 })
    ).resolves.toBe(true)
    await expect(
      pinStatus(db, { actorId: alice, statusId: s3, maxPinnedStatuses: 2 })
    ).resolves.toBe(false)
    await expect(
      pinStatus(db, { actorId: alice, statusId: s3, maxPinnedStatuses: 0 })
    ).resolves.toBe(false)
    expect(await pinsOf(alice)).toEqual([s1, s2])
    expect(await pinsOf(bob)).toEqual([s2, s3, s4])
  })

  it('pinStatus refuses a missing actor or status before any query', async () => {
    const { alice, statuses } = await setupPins()

    for (const [params, message] of [
      [{ actorId: undefined, statusId: statuses[0] }, 'an actorId'],
      [{ actorId: null, statusId: statuses[0] }, 'an actorId'],
      [{ actorId: alice, statusId: undefined }, 'a statusId'],
      [{ actorId: alice, statusId: null, maxPinnedStatuses: 3 }, 'a statusId']
    ] as const) {
      const { statements } = await capture(() =>
        expect(
          pinStatus(db, params as unknown as Parameters<typeof pinStatus>[1])
        ).rejects.toThrow(`pinStatus requires ${message}`)
      )
      expect(statements).toEqual([])
    }
    expect(await pinsOf(alice)).toEqual([])
  })

  it('pinStatus rolls back when its insert fails', async () => {
    const { alice, statuses } = await setupPins()
    const [s1, s2] = statuses
    await seedPin(alice, s1, BASE)
    const pinsBefore = await db
      .selectFrom('status_pins')
      .selectAll()
      .where('actorId', '=', alice)
      .execute()

    const dropTrigger = await failInsert('status_pins', 'statusId', s2)
    try {
      await expect(
        pinStatus(db, { actorId: alice, statusId: s2, maxPinnedStatuses: 5 })
      ).rejects.toThrow('forced failure')
      await expect(
        pinStatus(db, { actorId: alice, statusId: s2 })
      ).rejects.toThrow('forced failure')
    } finally {
      await dropTrigger()
    }
    await expect(
      db
        .selectFrom('status_pins')
        .selectAll()
        .where('actorId', '=', alice)
        .execute()
    ).resolves.toEqual(pinsBefore)

    // The actor's row is free again.
    await expect(
      pinStatus(db, { actorId: alice, statusId: s2, maxPinnedStatuses: 5 })
    ).resolves.toBe(true)
  })

  // SQLite runs one writer at a time, so only PostgreSQL can show the lock.
  it.runIf(testDb.backend === 'pg')(
    "pinStatus with a cap waits for the actor's row lock before counting",
    async () => {
      const { alice, statuses } = await setupPins()
      const [s1, s2] = statuses

      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let lockTaken = () => {}
      const locked = new Promise<void>((resolve) => {
        lockTaken = resolve
      })
      // Another writer holds alice's row and pins s1 before it commits.
      const holder = inTransaction(db, async (trx) => {
        await trx
          .selectFrom('actors')
          .select('id')
          .where('id', '=', alice)
          .forUpdate()
          .execute()
        lockTaken()
        await released
        await trx
          .insertInto('status_pins')
          .values({
            actorId: alice,
            statusId: s1,
            createdAt: new Date(BASE),
            updatedAt: new Date(BASE)
          })
          .execute()
      })
      await locked

      let settled = false
      const pin = pinStatus(db, {
        actorId: alice,
        statusId: s2,
        maxPinnedStatuses: 1
      }).finally(() => {
        settled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(settled).toBe(false)

      release()
      await holder
      // It counted after the other pin committed.
      await expect(pin).resolves.toBe(false)
      expect(await pinsOf(alice)).toEqual([s1])
    }
  )

  it.runIf(testDb.backend === 'pg')(
    'concurrent pins with a cap hold the row lock until they commit, so only one gets in',
    async () => {
      const { alice, statuses } = await setupPins()
      for (const index of [5, 6, 7, 8]) {
        statuses.push(
          await seedStatus({ id: `${alice}/statuses/${index}`, actorId: alice })
        )
      }

      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let lockTaken = () => {}
      const locked = new Promise<void>((resolve) => {
        lockTaken = resolve
      })
      // Hold alice's row so the eight pins below queue on it together.
      const holder = inTransaction(db, async (trx) => {
        await trx
          .selectFrom('actors')
          .select('id')
          .where('id', '=', alice)
          .forUpdate()
          .execute()
        lockTaken()
        await released
      })
      await locked

      const pins = statuses.map((statusId) =>
        pinStatus(db, { actorId: alice, statusId, maxPinnedStatuses: 1 })
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      release()
      await holder

      // Each pin counts only after the one before it committed.
      const results = await Promise.all(pins)
      expect(results.filter(Boolean)).toHaveLength(1)
      expect(await pinsOf(alice)).toHaveLength(1)
    }
  )

  it("pinStatus with a cap locks only the actor's row, before it reads a pin", async () => {
    const { alice, statuses } = await setupPins()
    const { result, statements } = await capture(() =>
      pinStatus(db, {
        actorId: alice,
        statusId: statuses[0],
        maxPinnedStatuses: 3
      })
    )
    expect(result).toBe(true)
    // SQLite has no row locks: Knex's forUpdate() wrote nothing there either.
    const lock =
      testDb.backend === 'pg'
        ? 'select "id" from "actors" where "id" = $1 for update'
        : 'select "id" from "actors" where "id" = ?'
    // One transaction, the lock first.
    expect(statements.map(({ sql: text }) => text)).toEqual([
      'begin',
      lock,
      expect.stringMatching(/^select "statusId" from "status_pins" /),
      expect.stringMatching(
        /^select count\(\*\) as "count" from "status_pins" /
      ),
      expect.stringMatching(/^insert into "status_pins" /),
      'commit'
    ])
    expect(statements[1].bindings).toEqual([alice])
  })

  it('pinStatus with a cap reads at most one existing pin', async () => {
    const { alice, statuses } = await setupPins()
    const { result, statements } = await capture(() =>
      pinStatus(db, {
        actorId: alice,
        statusId: statuses[0],
        maxPinnedStatuses: 3
      })
    )
    expect(result).toBe(true)
    const existingPinReads = statements.filter(({ sql: text }) =>
      text.startsWith('select "statusId" from "status_pins"')
    )
    expect(statementsReadingOneRow(existingPinReads)).toEqual([
      { limited: true, lastBinding: 1 }
    ])
  })

  it('unpinStatus removes only that pin of that actor', async () => {
    const { alice, bob, statuses } = await setupPins()
    const [s1, s2] = statuses
    await seedPin(alice, s1, BASE)
    await seedPin(alice, s2, BASE)
    await seedPin(bob, s1, BASE)

    await unpinStatus(db, { actorId: alice, statusId: s1 })
    expect(await pinsOf(alice)).toEqual([s2])
    expect(await pinsOf(bob)).toEqual([s1])
  })

  it("getPinnedStatusIds lists the actor's pins newest first, ties by status id descending", async () => {
    const { alice, bob, statuses } = await setupPins()
    const [s1, s2, s3, s4] = statuses
    // Written so that neither insertion nor id order is the answer: s2 and
    // s3 tie, and bob's pin is the newest of all.
    await seedPin(bob, s4, BASE + 9000)
    await seedPin(alice, s2, BASE + 2000)
    await seedPin(alice, s4, BASE + 1000)
    await seedPin(alice, s1, BASE + 3000)
    await seedPin(alice, s3, BASE + 2000)

    await expect(getPinnedStatusIds(db, { actorId: alice })).resolves.toEqual([
      s1,
      s3,
      s2,
      s4
    ])
    await expect(getPinnedStatusIds(db, { actorId: bob })).resolves.toEqual([
      s4
    ])
  })

  // Both planners walk status_pins_actor_created_status backwards here while
  // the table is small and unanalysed, which yields the ties by statusId
  // anyway. Once PostgreSQL has statistics it may sort instead, and the order
  // must not depend on the plan.
  it.runIf(testDb.backend === 'pg')(
    'getPinnedStatusIds keeps its order when PostgreSQL sorts instead of walking the index',
    async () => {
      const { alice, statuses } = await setupPins()
      const [s1, s2, s3, s4] = statuses
      // Two ties, one written in id order and one against it.
      await seedPin(alice, s1, BASE + 1000)
      await seedPin(alice, s2, BASE + 1000)
      await seedPin(alice, s4, BASE + 2000)
      await seedPin(alice, s3, BASE + 2000)

      const ids = await inTransaction(db, async (trx) => {
        await sql`set local enable_indexscan = off`.execute(trx)
        await sql`set local enable_indexonlyscan = off`.execute(trx)
        await sql`set local enable_bitmapscan = off`.execute(trx)
        return getPinnedStatusIds(trx, { actorId: alice })
      })
      expect(ids).toEqual([s4, s3, s2, s1])
    }
  )

  it('getPinnedStatusIds with status ids keeps only those, in the same order', async () => {
    const { alice, bob, statuses } = await setupPins()
    const [s1, s2, s3, s4] = statuses
    await seedPin(bob, s4, BASE + 9000)
    await seedPin(alice, s2, BASE + 2000)
    await seedPin(alice, s4, null)
    await seedPin(alice, s1, BASE + 3000)
    await seedPin(alice, s3, BASE + 2000)

    // A pin with no createdAt sorts as the oldest.
    await expect(
      getPinnedStatusIds(db, {
        actorId: alice,
        statusIds: [s4, s2, s3, s2, `${s1}/unpinned`]
      })
    ).resolves.toEqual([s3, s2, s4])
    await expect(
      getPinnedStatusIds(db, { actorId: bob, statusIds: [s1, s2] })
    ).resolves.toEqual([])

    const { result, statements } = await capture(() =>
      getPinnedStatusIds(db, { actorId: alice, statusIds: [] })
    )
    expect(result).toEqual([])
    expect(statements).toEqual([])
  })

  it('getPinnedStatusIds splits a long id list, keeping a binding for the actor', async () => {
    const { alice, statuses } = await setupPins()
    const [s1, s2] = statuses
    await seedPin(alice, s1, BASE + 1000)
    await seedPin(alice, s2, BASE + 2000)
    const batchSize = getWhereInBatchSize(db, 1)
    const statusIds = [
      s1,
      ...Array.from(
        { length: batchSize },
        (_unused, index) => `${s1}/unpinned${index}`
      ),
      s2
    ]

    const { result, statements } = await capture(() =>
      getPinnedStatusIds(db, { actorId: alice, statusIds })
    )
    expect(statements.map(({ bindings }) => bindings.length)).toEqual([
      batchSize + 1,
      3
    ])
    // s2 came back in the second chunk and still sorts first.
    expect(result).toEqual([s2, s1])
  })

  it('getPinnedStatusIds reads a repeated id once, even when the repeat would fall in another chunk', async () => {
    const { alice, statuses } = await setupPins()
    const [s1] = statuses
    await seedPin(alice, s1, BASE + 1000)
    const batchSize = getWhereInBatchSize(db, 1)
    const statusIds = [
      s1,
      ...Array.from(
        { length: batchSize },
        (_unused, index) => `${s1}/unpinned${index}`
      ),
      s1
    ]

    const { result, statements } = await capture(() =>
      getPinnedStatusIds(db, { actorId: alice, statusIds })
    )
    expect(statements.map(({ bindings }) => bindings.length)).toEqual([
      batchSize + 1,
      2
    ])
    expect(result).toEqual([s1])
  })
})

describe('getFavouritedBy', () => {
  const seedLike = (
    statusId: string,
    actorId: string,
    createdAt: number | null
  ) =>
    db
      .insertInto('likes')
      .values({
        statusId,
        actorId,
        createdAt: createdAt === null ? null : new Date(createdAt),
        updatedAt: createdAt === null ? null : new Date(createdAt)
      })
      .execute()

  // Five likes of one status (two tied, written out of id order) and a newer
  // like of another status.
  const setupLikes = async () => {
    const prefix = nextPrefix()
    const status = `https://a.test/users/${prefix}-author/statuses/1`
    const fan = (name: string) => actorIn('b.test', `${prefix}-${name}`)
    await seedLike(`${status}/other`, fan('other'), BASE + 9000)
    await seedLike(status, fan('a2'), BASE + 2000)
    await seedLike(status, fan('tie2'), BASE + 3000)
    await seedLike(status, fan('a1'), BASE + 1000)
    await seedLike(status, fan('a4'), BASE + 4000)
    await seedLike(status, fan('tie1'), BASE + 3000)
    const like = (name: string, at: number) => ({
      actorId: fan(name),
      createdAt: BASE + at
    })
    return {
      status,
      a1: like('a1', 1000),
      a2: like('a2', 2000),
      tie1: like('tie1', 3000),
      tie2: like('tie2', 3000),
      a4: like('a4', 4000)
    }
  }

  it('lists the likes of the status newest first, ties by actor descending', async () => {
    const { status, a1, a2, tie1, tie2, a4 } = await setupLikes()

    await expect(
      getFavouritedBy(db, { statusId: status, limit: 10 })
    ).resolves.toEqual([a4, tie2, tie1, a2, a1])
    await expect(
      getFavouritedBy(db, { statusId: status, limit: 2 })
    ).resolves.toEqual([a4, tie2])
  })

  it('pages older past a max cursor, and nearest-first past a min cursor', async () => {
    const { status, a1, a2, tie1, tie2, a4 } = await setupLikes()
    const cursor = encodeFavouritedByCursor

    await expect(
      getFavouritedBy(db, { statusId: status, limit: 10, maxId: cursor(tie2) })
    ).resolves.toEqual([tie1, a2, a1])
    // min_id takes the likes just above the cursor, still listed newest first.
    await expect(
      getFavouritedBy(db, { statusId: status, limit: 2, minId: cursor(a1) })
    ).resolves.toEqual([tie1, a2])
    await expect(
      getFavouritedBy(db, { statusId: status, limit: 10, minId: cursor(tie1) })
    ).resolves.toEqual([a4, tie2])
    // since_id takes the newest likes above the cursor.
    await expect(
      getFavouritedBy(db, { statusId: status, limit: 2, sinceId: cursor(a1) })
    ).resolves.toEqual([a4, tie2])
    await expect(
      getFavouritedBy(db, {
        statusId: status,
        limit: 10,
        maxId: cursor(a4),
        minId: cursor(a1)
      })
    ).resolves.toEqual([tie2, tie1, a2])
  })

  it('answers a malformed cursor with an empty page, and a like with no createdAt as 0', async () => {
    const { status } = await setupLikes()

    for (const token of ['not-a-cursor', 'MTIz', '']) {
      if (!token) continue
      await expect(
        getFavouritedBy(db, { statusId: status, limit: 10, maxId: token })
      ).resolves.toEqual([])
      await expect(
        getFavouritedBy(db, { statusId: status, limit: 10, minId: token })
      ).resolves.toEqual([])
      await expect(
        getFavouritedBy(db, { statusId: status, limit: 10, sinceId: token })
      ).resolves.toEqual([])
    }

    const undatedStatus = `${status}/undated`
    const fan = actorIn('b.test', `${nextPrefix()}-undated`)
    await seedLike(undatedStatus, fan, null)
    await expect(
      getFavouritedBy(db, { statusId: undatedStatus, limit: 10 })
    ).resolves.toEqual([{ actorId: fan, createdAt: 0 }])
  })
})

describe('getRebloggedBy', () => {
  // A public Note boosted by a1 (once), a2 (twice), a3 and a4 (tied), a5
  // (twice at one instant), a6 (a legacy row that names the Note only in
  // `content`) and a10 (followers-only). Neighbours: a Note by a7 that points
  // at it, a8's boost of another status and a9's boost of another status
  // that names this one in `content`.
  const setupReblogs = async () => {
    const prefix = nextPrefix()
    const author = actorIn('a.test', `${prefix}-author`)
    const booster = (index: number) => actorIn('b.test', `${prefix}-a${index}`)
    const target = await seedStatus({
      id: `${author}/statuses/target`,
      actorId: author
    })
    const other = await seedStatus({
      id: `${author}/statuses/other`,
      actorId: author
    })
    const boost = (
      index: number,
      name: string,
      createdAt: number | null,
      extra: Partial<Parameters<typeof seedStatus>[0]> = {}
    ) =>
      seedStatus({
        id: `${booster(index)}/statuses/${name}`,
        actorId: booster(index),
        type: StatusType.enum.Announce,
        originalStatusId: target,
        content: target,
        createdAt,
        ...extra
      })

    await boost(7, 'note', BASE + 9000, { type: StatusType.enum.Note })
    await boost(8, 'other', BASE + 9001, {
      originalStatusId: other,
      content: other
    })
    await boost(9, 'mismatch', BASE + 9002, {
      originalStatusId: other,
      content: target
    })

    const a2old = await boost(2, 'old', BASE + 500)
    const a1 = await boost(1, 'only', BASE + 1000)
    const a2 = await boost(2, 'new', BASE + 2000)
    const a5dup1 = await boost(5, 'dup1', BASE + 2500)
    const a5dup2 = await boost(5, 'dup2', BASE + 2500)
    const a4 = await boost(4, 'tie', BASE + 3000)
    const a3 = await boost(3, 'tie', BASE + 3000)
    const a6 = await boost(6, 'legacy', BASE + 3500, {
      originalStatusId: null,
      to: [],
      cc: [ACTIVITY_STREAM_PUBLIC_COMPACT]
    })
    const a10 = await boost(10, 'followers', BASE + 4000, {
      to: [`${booster(10)}/followers`]
    })

    return {
      prefix,
      target,
      booster,
      boosts: { a1, a2, a2old, a3, a4, a5dup1, a5dup2, a6, a10 }
    }
  }

  const listed = async (params: Parameters<typeof getRebloggedBy>[1]) =>
    (await getRebloggedBy(db, params)).map((row) => row.statusId)

  it("lists each actor's newest public boost, newest first", async () => {
    const { target, booster, boosts } = await setupReblogs()
    const { a1, a2, a3, a4, a5dup2, a6 } = boosts

    await expect(
      getRebloggedBy(db, {
        statusId: target,
        limit: 40,
        visibleToActorId: null
      })
    ).resolves.toEqual([
      { actorId: booster(6), statusId: a6 },
      { actorId: booster(4), statusId: a4 },
      { actorId: booster(3), statusId: a3 },
      { actorId: booster(5), statusId: a5dup2 },
      { actorId: booster(2), statusId: a2 },
      { actorId: booster(1), statusId: a1 }
    ])
    await expect(listed({ statusId: target, limit: 2 })).resolves.toEqual([
      a6,
      a4
    ])
    // No limit, no LIMIT.
    await expect(listed({ statusId: target })).resolves.toEqual([
      a6,
      a4,
      a3,
      a5dup2,
      a2,
      a1
    ])
  })

  it('adds the boosts the viewer may read', async () => {
    const { target, booster, boosts } = await setupReblogs()
    const { a1, a2, a3, a4, a5dup2, a6, a10 } = boosts
    const follower = await seedActor(actorIn('c.test', `${nextPrefix()}-v`))
    const stranger = await seedActor(actorIn('c.test', `${nextPrefix()}-w`))
    await db
      .insertInto('follows')
      .values({
        id: randomUUID(),
        actorId: follower,
        targetActorId: booster(10),
        status: 'Accepted',
        inbox: `${follower}/inbox`,
        sharedInbox: 'https://c.test/inbox'
      })
      .execute()

    await expect(
      listed({ statusId: target, limit: 40, visibleToActorId: follower })
    ).resolves.toEqual([a10, a6, a4, a3, a5dup2, a2, a1])
    await expect(
      listed({ statusId: target, limit: 40, visibleToActorId: booster(10) })
    ).resolves.toEqual([a10, a6, a4, a3, a5dup2, a2, a1])
    await expect(
      listed({ statusId: target, limit: 40, visibleToActorId: stranger })
    ).resolves.toEqual([a6, a4, a3, a5dup2, a2, a1])
  })

  it('pages past max, min and since cursors', async () => {
    const { target, boosts } = await setupReblogs()
    const { a1, a2, a2old, a3, a4, a5dup2, a6 } = boosts

    await expect(
      listed({ statusId: target, limit: 40, maxStatusId: a4 })
    ).resolves.toEqual([a3, a5dup2, a2, a1])
    // The min cursor takes the boosts just above it, still newest first.
    await expect(
      listed({ statusId: target, limit: 2, minStatusId: a2 })
    ).resolves.toEqual([a3, a5dup2])
    await expect(
      listed({ statusId: target, limit: 2, sinceStatusId: a2 })
    ).resolves.toEqual([a6, a4])
    await expect(
      listed({
        statusId: target,
        limit: 40,
        maxStatusId: a4,
        sinceStatusId: a2
      })
    ).resolves.toEqual([a3, a5dup2])
    // A superseded boost is still a cursor.
    await expect(
      listed({ statusId: target, limit: 40, minStatusId: a2old })
    ).resolves.toEqual([a6, a4, a3, a5dup2, a2, a1])
  })

  it('refuses a cursor it cannot place', async () => {
    const { target, booster, boosts } = await setupReblogs()
    const missing = `${booster(1)}/statuses/missing`
    const undated = await seedStatus({
      id: `${booster(11)}/statuses/undated`,
      actorId: booster(11),
      type: StatusType.enum.Announce,
      originalStatusId: target,
      createdAt: null
    })

    for (const cursor of [missing, boosts.a10, undated]) {
      await expect(
        listed({ statusId: target, limit: 40, maxStatusId: cursor })
      ).resolves.toEqual([])
      await expect(
        listed({ statusId: target, limit: 40, minStatusId: cursor })
      ).resolves.toEqual([])
      await expect(
        listed({ statusId: target, limit: 40, sinceStatusId: cursor })
      ).resolves.toEqual([])
    }
  })
})
