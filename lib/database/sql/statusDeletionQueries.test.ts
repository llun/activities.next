import { randomUUID } from 'node:crypto'

import { searchQueries } from '@/lib/database/domains/search/queries'
import {
  deleteStatus,
  deleteStatusEditHistory,
  deleteStatusWithQueueJob,
  selectPubliclyAddressedStatusIds
} from '@/lib/database/domains/status/deletion'
import { createNote } from '@/lib/database/domains/status/writes'
import { type Db, isInTransaction } from '@/lib/database/kysely'
import {
  type StatementNames,
  type TableDump,
  capture,
  describeStatement,
  dumpDatabase,
  failWrite,
  quote,
  start,
  waitForLockWait,
  withTable
} from '@/lib/database/sql/deletionTestHelpers'
import { pauseAfterStatement } from '@/lib/database/sql/fitnessRouteHeatmapTileTestHelpers'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

// Query-level tests for the status deletions (lib/database/domains/status/
// deletion.ts), called directly on Kysely. Every test writes its own actors
// and statuses (a fresh prefix) beside neighbouring ones that must survive
// untouched: other statuses with every kind of row keyed on them, statuses
// quoting the deleted ones, other actors' counters. The deletion tests compare
// a dump of every table before and after against the rows the deletion should
// have removed or changed and nothing else. Date is faked per test, so the
// timestamps the deletion writes are known. The hashtag search refresh after
// the transaction is replaced by a spy, except where a test checks it.
//
// The IN-list batch size can be capped (`cap`), so a few rows cross the chunk
// boundaries the deletion splits its statements at, on both backends.

const { batchCap } = vi.hoisted(() => ({ batchCap: { value: 0 } }))

vi.mock('@/lib/database/kysely/inList', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/kysely/inList')>()
  const getWhereInBatchSize: typeof original.getWhereInBatchSize = (
    db,
    reservedBindings = 0,
    defaultBatchSize
  ) =>
    batchCap.value > 0
      ? Math.max(1, batchCap.value - reservedBindings)
      : original.getWhereInBatchSize(db, reservedBindings, defaultBatchSize)
  return {
    ...original,
    getWhereInBatchSize,
    // selectInChunks reads the batch size through the module's own binding,
    // so it is rebuilt over the capped one.
    selectInChunks: async <Value, Row>(
      db: Db,
      values: Value[],
      select: (chunk: Value[]) => Promise<Row[]>,
      reservedBindings = 0
    ) => {
      const rows: Row[] = []
      for (const chunk of original.chunkArray(
        values,
        getWhereInBatchSize(db, reservedBindings)
      )) {
        rows.push(...(await select(chunk)))
      }
      return rows
    }
  }
})

const testDb = createTestDatabase()
const db = () => testDb.db

const DOMAIN = 'status-deletion.test'
const BASE = Date.UTC(2026, 0, 1)
const actorIn = (name: string) => `https://${DOMAIN}/users/${name}`

let prefixCount = 0
let prefix = ''
let hourCount = 0
let now = 0

const PUBLIC = [ACTIVITY_STREAM_PUBLIC]

const seedActor = async (
  name: string,
  { local = false, lastStatusAt = null as number | null } = {}
) => {
  const id = actorIn(`${prefix}-${name}`)
  let accountId: string | null = null
  if (local) {
    accountId = randomUUID()
    await db()
      .insertInto('accounts')
      .values({
        id: accountId,
        email: `${prefix}-${name}@${DOMAIN}`,
        passwordHash: 'hash',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
  }
  await db()
    .insertInto('actors')
    .values({
      id,
      username: `${prefix}-${name}`,
      domain: DOMAIN,
      accountId,
      privateKey: local ? 'private-key' : null,
      publicKey: 'public-key',
      settings: JSON.stringify({
        followersUrl: `${id}/followers`,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${DOMAIN}/inbox`
      }),
      lastStatusAt: lastStatusAt === null ? null : new Date(lastStatusAt),
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()
  return id
}

type SeedStatus = {
  id: string
  actorId: string
  createdAt: number
  to?: string[]
  cc?: string[]
  type?: StatusType
  url?: string
  reply?: string
  content?: string | null
  originalStatusId?: string | null
}

const statusIn = (actorId: string, name: string) =>
  `${actorId}/statuses/${name}`

const seedStatus = async ({
  id,
  actorId,
  createdAt,
  to = PUBLIC,
  cc = [],
  type = StatusType.enum.Note,
  url = `${id}/page`,
  reply = '',
  content = type === StatusType.enum.Announce
    ? null
    : JSON.stringify({ url, text: `text of ${id}` }),
  originalStatusId = null
}: SeedStatus) => {
  await db()
    .insertInto('statuses')
    .values({
      id,
      url,
      urlHash: getHashFromString(url),
      actorId,
      type,
      reply,
      replyHash: reply ? getHashFromString(reply) : null,
      content,
      originalStatusId,
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt)
    })
    .execute()
  for (const [kind, recipients] of [
    ['to', to],
    ['cc', cc]
  ] as const) {
    for (const recipient of recipients) {
      await db()
        .insertInto('recipients')
        .values({
          id: randomUUID(),
          statusId: id,
          actorId: recipient,
          type: kind,
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        })
        .execute()
    }
  }
  return id
}

let sequence = 0
const next = () => (sequence += 1)

// One row in every table the deletion clears by statusId, written for
// `statusId` (owned by `ownerId`, acted on by `otherId`), plus its counters.
const seedRowsFor = async (
  statusId: string,
  ownerId: string,
  otherId: string,
  hashtags: string[] = []
) => {
  const at = new Date(BASE + next())
  const d = db()
  await d
    .insertInto('likes')
    .values({ statusId, actorId: otherId, createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('status_reactions')
    .values({
      statusId,
      actorId: otherId,
      name: '👍',
      createdAt: at,
      updatedAt: at
    })
    .execute()
  for (const name of hashtags) {
    await d
      .insertInto('tags')
      .values({
        id: randomUUID(),
        statusId,
        type: 'hashtag',
        name,
        nameNormalized: name.toLowerCase(),
        value: `https://${DOMAIN}/tags/${name}`,
        createdAt: at,
        updatedAt: at
      })
      .execute()
  }
  await d
    .insertInto('tags')
    .values({
      id: randomUUID(),
      statusId,
      type: 'mention',
      name: '@someone',
      value: otherId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('attachments')
    .values({
      id: randomUUID(),
      statusId,
      actorId: ownerId,
      url: `https://${DOMAIN}/media/${next()}.png`,
      mediaType: 'image/png',
      type: 'Document',
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('bookmarks')
    .values({ actorId: otherId, statusId, createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('status_pins')
    .values({ actorId: ownerId, statusId, createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('status_history')
    .values({
      statusId,
      data: JSON.stringify({ text: 'before' }),
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('poll_choices')
    .values({
      statusId,
      title: 'choice',
      totalVotes: 1,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('poll_answers')
    .values({
      statusId,
      actorId: otherId,
      choice: 0,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('poll_voters')
    .values({ statusId, actorId: otherId, createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('timelines')
    .values({
      actorId: otherId,
      timeline: 'main',
      statusId,
      statusActorId: ownerId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('collection_timeline')
    .values({ collectionSeq: next(), memberSeq: 1, statusId, sortKey: next() })
    .execute()
  await d
    .insertInto('notifications')
    .values({
      id: randomUUID(),
      actorId: ownerId,
      type: 'favourite',
      sourceActorId: otherId,
      statusId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('direct_conversation_statuses')
    .values({
      conversationId: `conversation-${next()}`,
      statusId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('idempotency_keys')
    .values({ actorId: ownerId, key: `key-${next()}`, statusId, createdAt: at })
    .execute()
  await d
    .insertInto('status_mutes')
    .values({ actorId: otherId, statusId, createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('status_detected_languages')
    .values({
      statusId,
      language: 'en',
      confidence: 0.5,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('status_link_previews')
    .values({
      statusId,
      urlHash: SHARED_PREVIEW,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await d
    .insertInto('search_documents')
    .values({
      id: `status:${statusId}`,
      entityType: 'status',
      entityId: statusId,
      documentText: `text of ${statusId}`,
      actorId: ownerId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  for (const id of [
    CounterKey.totalLike(statusId),
    CounterKey.totalReblog(statusId),
    CounterKey.totalReply(statusId)
  ]) {
    await setCounter(id, 3)
  }
}

const SHARED_PREVIEW = getHashFromString('https://example.com/shared')

const setCounter = (id: string, value: number) =>
  db()
    .insertInto('counters')
    .values({
      id,
      value,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({ value, updatedAt: new Date(BASE) })
    )
    .execute()

const counterValue = async (id: string) =>
  (
    await db()
      .selectFrom('counters')
      .select('value')
      .where('id', '=', id)
      .executeTakeFirst()
  )?.value ?? null

const lastStatusAtOf = async (actorId: string) =>
  (
    await db()
      .selectFrom('actors')
      .select('lastStatusAt')
      .where('id', '=', actorId)
      .executeTakeFirstOrThrow()
  ).lastStatusAt

// The tables whose rows hang off a status by `statusId`, all cleared for the
// deleted ones.
const STATUS_ID_TABLES = [
  'recipients',
  'likes',
  'status_reactions',
  'tags',
  'attachments',
  'bookmarks',
  'status_pins',
  'status_quotes',
  'status_history',
  'poll_answers',
  'poll_voters',
  'poll_choices',
  'timelines',
  'collection_timeline',
  'notifications',
  'direct_conversation_statuses',
  'idempotency_keys',
  'status_mutes',
  'status_detected_languages',
  'status_link_previews'
]

// What a dump should look like after `deleted` are deleted at `now`: their
// rows gone, quotes of them tombstoned, their Wahoo imports and fitness files
// unlinked, their search documents and counters gone. `counters` and
// `lastStatusAt` give the values the counter adjustments and the recompute
// should leave.
const expectedAfterDeletion = (
  before: TableDump,
  deleted: string[],
  {
    counters = {},
    lastStatusAt = {}
  }: {
    counters?: Record<string, number>
    lastStatusAt?: Record<string, number | null>
  }
) => {
  const gone = new Set(deleted)
  let dump = withTable(before, 'statuses', (rows) =>
    rows.filter((row) => !gone.has(row.id as string))
  )
  for (const table of STATUS_ID_TABLES) {
    dump = withTable(dump, table, (rows) =>
      rows.filter((row) => !gone.has(row.statusId as string))
    )
  }
  dump = withTable(dump, 'status_quotes', (rows) =>
    rows.map((row) =>
      gone.has(row.quotedStatusId as string) &&
      ['pending', 'accepted'].includes(row.state as string)
        ? { ...row, state: 'deleted', updatedAt: now }
        : row
    )
  )
  const unlinkedFiles = new Set(
    before.fitness_files
      .filter((row) => gone.has(row.statusId as string))
      .map((row) => row.id as string)
  )
  dump = withTable(dump, 'wahoo_imports', (rows) =>
    rows.map((row) =>
      gone.has(row.statusId as string) ||
      unlinkedFiles.has(row.fitnessFileId as string)
        ? {
            ...row,
            hadStatus: true,
            statusId: null,
            status: 'completed',
            lastError: null,
            updatedAt: now
          }
        : row
    )
  )
  dump = withTable(dump, 'fitness_files', (rows) =>
    rows.map((row) =>
      gone.has(row.statusId as string) ? { ...row, statusId: null } : row
    )
  )
  dump = withTable(dump, 'search_documents', (rows) =>
    rows.filter(
      (row) =>
        !(row.entityType === 'status' && gone.has(row.entityId as string))
    )
  )
  const deletedCounters = new Set(
    deleted.flatMap((id) => [
      CounterKey.totalLike(id),
      CounterKey.totalReblog(id),
      CounterKey.totalReply(id)
    ])
  )
  dump = withTable(dump, 'counters', (rows) => {
    const kept = rows
      .filter((row) => !deletedCounters.has(row.id as string))
      .map((row) =>
        (row.id as string) in counters
          ? { ...row, value: counters[row.id as string], updatedAt: now }
          : row
      )
    const existing = new Set(rows.map((row) => row.id))
    for (const [id, value] of Object.entries(counters)) {
      if (existing.has(id) || deletedCounters.has(id)) continue
      kept.push({
        id,
        value,
        createdAt: now,
        updatedAt: now,
        bucketHour: null
      })
    }
    return kept
  })
  dump = withTable(dump, 'actors', (rows) =>
    rows.map((row) =>
      (row.id as string) in lastStatusAt
        ? { ...row, lastStatusAt: lastStatusAt[row.id as string] }
        : row
    )
  )
  return dump
}

const refreshSpy = () =>
  vi
    .spyOn(searchQueries, 'indexHashtagSearchDocuments')
    .mockResolvedValue(undefined)

beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
  // The shared link preview every status links to: it must survive.
  await db()
    .insertInto('link_previews')
    .values({
      urlHash: SHARED_PREVIEW,
      url: 'https://example.com/shared',
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()
})

afterAll(async () => {
  await testDb.destroy()
})

beforeEach(() => {
  prefixCount += 1
  prefix = `sd${prefixCount}`
  hourCount += 1
  now = Date.UTC(2026, 2, 1) + hourCount * 3_600_000 + 1_234
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  batchCap.value = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  batchCap.value = 0
})

// A thread and its neighbours:
// - root by `author` (local), public, tagged #Cats and dogs, quoting a
//   neighbour, with a fitness file and two Wahoo imports (one by status, one
//   by file);
//   - reply1 by `replier` (remote), public, to the root by id;
//     - reply11 by `author`, followers-only, to reply1 by id;
//   - reply2 by `author`, public, to the root by id;
//     - reply21 by `replier`, direct to `author`, to reply2 by id;
//   - a reply by `neighbour` to the root by its url, which the deletion does
//     not walk (it follows replies by id only) and so keeps;
// - the neighbour status by `neighbour`, public, and its own reply, each with
//   every kind of row; the neighbour quotes the root (accepted), reply1
//   (rejected) and reply2 (pending); an announce by `neighbour` of the root.
const seedThread = async () => {
  const author = await seedActor('author', { local: true })
  const replier = await seedActor('replier')
  const neighbourActor = await seedActor('neighbour', { local: true })
  const root = await seedStatus({
    id: statusIn(author, 'root'),
    actorId: author,
    createdAt: BASE + 10_000,
    cc: [`${author}/followers`]
  })
  const reply1 = await seedStatus({
    id: statusIn(replier, 'reply1'),
    actorId: replier,
    createdAt: BASE + 20_000,
    reply: root
  })
  const reply11 = await seedStatus({
    id: statusIn(author, 'reply11'),
    actorId: author,
    createdAt: BASE + 30_000,
    to: [`${author}/followers`],
    reply: reply1
  })
  const reply2 = await seedStatus({
    id: statusIn(author, 'reply2'),
    actorId: author,
    createdAt: BASE + 40_000,
    reply: root
  })
  const reply21 = await seedStatus({
    id: statusIn(replier, 'reply21'),
    actorId: replier,
    createdAt: BASE + 50_000,
    to: [author],
    reply: reply2
  })
  // The author's own surviving status, older than the thread.
  const authorOlder = await seedStatus({
    id: statusIn(author, 'older'),
    actorId: author,
    createdAt: BASE + 5_000
  })
  const neighbour = await seedStatus({
    id: statusIn(neighbourActor, 'neighbour'),
    actorId: neighbourActor,
    createdAt: BASE + 15_000
  })
  const neighbourReply = await seedStatus({
    id: statusIn(neighbourActor, 'neighbour-reply'),
    actorId: neighbourActor,
    createdAt: BASE + 16_000,
    reply: neighbour
  })
  const announce = await seedStatus({
    id: statusIn(neighbourActor, 'announce'),
    actorId: neighbourActor,
    createdAt: BASE + 17_000,
    type: StatusType.enum.Announce,
    originalStatusId: root
  })
  const urlReply = await seedStatus({
    id: statusIn(neighbourActor, 'url-reply'),
    actorId: neighbourActor,
    createdAt: BASE + 18_000,
    reply: `${root}/page`
  })
  const thread = [root, reply1, reply11, reply2, reply21]
  for (const id of thread) {
    await seedRowsFor(
      id,
      id.startsWith(author) ? author : replier,
      neighbourActor,
      id === root ? ['#Cats', 'dogs'] : ['#Cats']
    )
  }
  for (const id of [authorOlder, neighbour, neighbourReply, announce]) {
    await seedRowsFor(id, neighbourActor, author, ['#Cats'])
  }
  const at = new Date(BASE)
  await db()
    .insertInto('status_quotes')
    .values(
      [
        { statusId: root, quotedStatusId: neighbour, state: 'accepted' },
        { statusId: neighbour, quotedStatusId: root, state: 'accepted' },
        { statusId: neighbourReply, quotedStatusId: reply1, state: 'rejected' },
        { statusId: announce, quotedStatusId: reply2, state: 'pending' },
        { statusId: authorOlder, quotedStatusId: neighbour, state: 'pending' }
      ].map((row) => ({ ...row, createdAt: at, updatedAt: at }))
    )
    .execute()
  for (const [id, statusId] of [
    [`${prefix}-file-root`, root],
    [`${prefix}-file-neighbour`, neighbour]
  ]) {
    await db()
      .insertInto('fitness_files')
      .values({
        id,
        actorId: statusId === root ? author : neighbourActor,
        statusId,
        path: `/fitness/${id}.fit`,
        fileName: `${id}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 100,
        createdAt: at,
        updatedAt: at
      })
      .execute()
  }
  for (const [id, statusId, fitnessFileId] of [
    [`${prefix}-wahoo-status`, root, null],
    [`${prefix}-wahoo-file`, null, `${prefix}-file-root`],
    [`${prefix}-wahoo-neighbour`, neighbour, `${prefix}-file-neighbour`]
  ]) {
    await db()
      .insertInto('wahoo_imports')
      .values({
        id: id as string,
        actorId: author,
        providerUserId: 'provider',
        workoutId: id as string,
        statusId,
        fitnessFileId,
        status: 'processing',
        hadStatus: false,
        lastError: 'pending error',
        createdAt: at,
        updatedAt: at
      })
      .execute()
  }
  await setCounter(CounterKey.totalStatus(author), 10)
  await setCounter(CounterKey.totalStatus(replier), 5)
  await setCounter(CounterKey.totalStatus(neighbourActor), 4)
  await setCounter(CounterKey.serviceTotalStatuses(), 100)
  await setCounter(CounterKey.nodeinfoLocalPosts(), 50)
  await setCounter(CounterKey.totalHashtag('cats'), 30)
  await setCounter(CounterKey.totalHashtag('dogs'), 8)
  await db()
    .updateTable('actors')
    .set({ lastStatusAt: new Date(BASE + 40_000) })
    .where('id', '=', author)
    .execute()
  await db()
    .updateTable('actors')
    .set({ lastStatusAt: new Date(BASE + 50_000) })
    .where('id', '=', replier)
    .execute()
  return {
    author,
    replier,
    neighbourActor,
    root,
    reply1,
    reply11,
    reply2,
    reply21,
    authorOlder,
    neighbour,
    neighbourReply,
    announce,
    urlReply,
    thread
  }
}

describe('deleteStatus', () => {
  it('deletes the reply tree and every row keyed on it, and nothing else', async () => {
    const t = await seedThread()
    const refresh = refreshSpy()
    const before = await dumpDatabase(testDb)

    await deleteStatus(db(), { statusId: t.root })

    expect(await dumpDatabase(testDb)).toEqual(
      expectedAfterDeletion(before, t.thread, {
        counters: {
          // root, reply11, reply2
          [CounterKey.totalStatus(t.author)]: 7,
          // reply1, reply21
          [CounterKey.totalStatus(t.replier)]: 3,
          [CounterKey.serviceTotalStatuses()]: 95,
          // the author is local, the replier is not
          [CounterKey.nodeinfoLocalPosts()]: 47,
          // root and reply1 and reply2 are public; reply11 and reply21 are not
          [CounterKey.totalHashtag('cats')]: 27,
          [CounterKey.totalHashtag('dogs')]: 7
        },
        lastStatusAt: {
          [t.author]: BASE + 5_000,
          [t.replier]: null
        }
      })
    )
    // The tags of every deleted status, private ones included, are refreshed
    // once each, on the root instance after the commit.
    expect(refresh).toHaveBeenCalledTimes(1)
    const [refreshDb, params] = refresh.mock.calls[0]
    expect(isInTransaction(refreshDb)).toBe(false)
    expect(params.hashtags.sort()).toEqual(['#Cats', 'dogs'])
  })

  it('deletes only the root when it has no replies', async () => {
    const t = await seedThread()
    refreshSpy()
    const before = await dumpDatabase(testDb)

    await deleteStatus(db(), { statusId: t.reply21 })

    expect(await dumpDatabase(testDb)).toEqual(
      expectedAfterDeletion(before, [t.reply21], {
        counters: {
          [CounterKey.totalStatus(t.replier)]: 4,
          [CounterKey.serviceTotalStatuses()]: 99
          // direct: neither the hashtag nor reply2's reply counter moves
        },
        lastStatusAt: { [t.replier]: BASE + 20_000 }
      })
    )
  })

  it('writes nothing for a status that does not exist', async () => {
    await seedThread()
    const refresh = refreshSpy()
    const before = await dumpDatabase(testDb)
    const { statements } = await capture(testDb, () =>
      deleteStatus(db(), { statusId: statusIn(actorIn('nobody'), 'none') })
    )
    expect(await dumpDatabase(testDb)).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
    expect(statements.map(({ sql }) => sql.split(' ')[0])).toEqual([
      'begin',
      'select',
      'commit'
    ])
  })

  it('moves back exactly the counters the deleted statuses moved', async () => {
    const local = await seedActor('local', { local: true })
    const remote = await seedActor('remote')
    const parentActor = await seedActor('parent')
    const parent = await seedStatus({
      id: statusIn(parentActor, 'parent'),
      actorId: parentActor,
      createdAt: BASE + 1_000
    })
    const parentByUrl = await seedStatus({
      id: statusIn(parentActor, 'parent-by-url'),
      actorId: parentActor,
      createdAt: BASE + 1_100,
      url: `https://${DOMAIN}/@parent/by-url`
    })
    const boosted = await seedStatus({
      id: statusIn(parentActor, 'boosted'),
      actorId: parentActor,
      createdAt: BASE + 1_200
    })
    // The root: a public reply to `parent` by id, by a local actor.
    const root = await seedStatus({
      id: statusIn(local, 'root'),
      actorId: local,
      createdAt: BASE + 2_000,
      reply: parent
    })
    // Its replies, each addressed differently.
    const replies = [
      // public reply to the root, by a remote actor
      await seedStatus({
        id: statusIn(remote, 'r-public'),
        actorId: remote,
        createdAt: BASE + 3_000,
        reply: root
      }),
      // unlisted (public in cc) reply to the root
      await seedStatus({
        id: statusIn(local, 'r-unlisted'),
        actorId: local,
        createdAt: BASE + 3_100,
        to: [`${local}/followers`],
        cc: PUBLIC,
        reply: root
      }),
      // followers-only reply to the root
      await seedStatus({
        id: statusIn(remote, 'r-followers'),
        actorId: remote,
        createdAt: BASE + 3_200,
        to: [`${remote}/followers`],
        reply: root
      })
    ]
    // Boosts in the tree cannot be replies, so the boosts are separate roots.
    const boostById = await seedStatus({
      id: statusIn(local, 'boost-id'),
      actorId: local,
      createdAt: BASE + 4_000,
      type: StatusType.enum.Announce,
      originalStatusId: boosted
    })
    const boostLegacyString = await seedStatus({
      id: statusIn(remote, 'boost-string'),
      actorId: remote,
      createdAt: BASE + 4_100,
      type: StatusType.enum.Announce,
      content: JSON.stringify(boosted)
    })
    const boostLegacyUrl = await seedStatus({
      id: statusIn(remote, 'boost-url'),
      actorId: remote,
      createdAt: BASE + 4_200,
      type: StatusType.enum.Announce,
      content: JSON.stringify({ url: parentByUrl })
    })
    const boostLegacyId = await seedStatus({
      id: statusIn(remote, 'boost-object-id'),
      actorId: remote,
      createdAt: BASE + 4_300,
      type: StatusType.enum.Announce,
      content: JSON.stringify({ id: parent })
    })
    // A reply by url, as its own root.
    const replyByUrl = await seedStatus({
      id: statusIn(remote, 'by-url'),
      actorId: remote,
      createdAt: BASE + 5_000,
      reply: `https://${DOMAIN}/@parent/by-url`
    })
    // A reply to a parent that is not stored.
    const orphan = await seedStatus({
      id: statusIn(remote, 'orphan'),
      actorId: remote,
      createdAt: BASE + 5_100,
      reply: statusIn(parentActor, 'missing')
    })
    for (const [id, tags] of [
      [root, ['#Cats', '#cats', 'Dogs']],
      [replies[0], ['#Birds']],
      [replies[1], ['#Birds']],
      // a followers-only status's tags never counted
      [replies[2], ['#Birds', '#Secret']]
    ] as const) {
      for (const name of tags) {
        await db()
          .insertInto('tags')
          .values({
            id: randomUUID(),
            statusId: id,
            type: 'hashtag',
            name,
            value: name,
            createdAt: new Date(BASE),
            updatedAt: new Date(BASE)
          })
          .execute()
      }
    }
    const initial: Record<string, number> = {
      [CounterKey.totalStatus(local)]: 20,
      [CounterKey.totalStatus(remote)]: 20,
      [CounterKey.serviceTotalStatuses()]: 500,
      [CounterKey.nodeinfoLocalPosts()]: 300,
      [CounterKey.totalReply(parent)]: 6,
      [CounterKey.totalReply(parentByUrl)]: 6,
      [CounterKey.totalReblog(boosted)]: 6,
      [CounterKey.totalReblog(parentByUrl)]: 6,
      [CounterKey.totalReblog(parent)]: 6,
      [CounterKey.totalHashtag('cats')]: 9,
      [CounterKey.totalHashtag('dogs')]: 9,
      // birds is only partly stored: it is clamped at 0
      [CounterKey.totalHashtag('birds')]: 1,
      [CounterKey.totalHashtag('secret')]: 9
    }
    for (const [id, value] of Object.entries(initial)) {
      await setCounter(id, value)
    }
    refreshSpy()
    const before = await dumpDatabase(testDb)

    for (const statusId of [
      root,
      boostById,
      boostLegacyString,
      boostLegacyUrl,
      boostLegacyId,
      replyByUrl,
      orphan
    ]) {
      await deleteStatus(db(), { statusId })
    }

    const counters = Object.fromEntries(
      (
        await db()
          .selectFrom('counters')
          .select(['id', 'value'])
          .where('id', 'in', Object.keys(initial))
          .execute()
      ).map((row) => [row.id, row.value])
    )
    expect(counters).toEqual({
      // root, r-unlisted, boost-id
      [CounterKey.totalStatus(local)]: 17,
      // r-public, r-followers, the three legacy boosts, by-url, orphan
      [CounterKey.totalStatus(remote)]: 13,
      [CounterKey.serviceTotalStatuses()]: 490,
      // the local actor's three
      [CounterKey.nodeinfoLocalPosts()]: 297,
      // root (public, by id)
      [CounterKey.totalReply(parent)]: 5,
      // by-url (public, by url)
      [CounterKey.totalReply(parentByUrl)]: 5,
      // boost-id and boost-string
      [CounterKey.totalReblog(boosted)]: 4,
      // boost-url
      [CounterKey.totalReblog(parentByUrl)]: 5,
      // boost-object-id
      [CounterKey.totalReblog(parent)]: 5,
      // #Cats and #cats on one public status: two
      [CounterKey.totalHashtag('cats')]: 7,
      [CounterKey.totalHashtag('dogs')]: 8,
      // two public statuses, from 1: clamped at 0
      [CounterKey.totalHashtag('birds')]: 0,
      // only on the followers-only reply
      [CounterKey.totalHashtag('secret')]: 9
    })
    // Every counter it moved was rewritten at `now`; no other was touched,
    // and the deleted statuses' own counters (none were stored) stay absent.
    const after = await dumpDatabase(testDb)
    const moved = new Set(
      Object.entries(counters)
        .filter(([id, value]) => initial[id] !== value)
        .map(([id]) => id)
    )
    expect(after.counters.filter((row) => moved.has(row.id as string))).toEqual(
      expect.arrayContaining(
        [...moved].map((id) => expect.objectContaining({ id, updatedAt: now }))
      )
    )
    expect(
      after.counters.filter((row) => !moved.has(row.id as string))
    ).toEqual(before.counters.filter((row) => !moved.has(row.id as string)))
  })

  it('creates a missing counter it decreases at 0', async () => {
    const author = await seedActor('author')
    const root = await seedStatus({
      id: statusIn(author, 'root'),
      actorId: author,
      createdAt: BASE + 1_000
    })
    refreshSpy()
    await deleteStatus(db(), { statusId: root })
    expect(
      await db()
        .selectFrom('counters')
        .selectAll()
        .where('id', '=', CounterKey.totalStatus(author))
        .executeTakeFirst()
    ).toEqual({
      id: CounterKey.totalStatus(author),
      value: 0,
      createdAt: now,
      updatedAt: now,
      bucketHour: null
    })
  })

  it('recomputes lastStatusAt from the newest remaining public or followers-only status', async () => {
    const author = await seedActor('author', { lastStatusAt: BASE + 9_000 })
    const other = await seedActor('other', { lastStatusAt: BASE + 9_999 })
    const followersOnly = await seedStatus({
      id: statusIn(author, 'followers'),
      actorId: author,
      createdAt: BASE + 3_000,
      to: [`${author}/followers`]
    })
    // Newer, but direct: it never advanced lastStatusAt and must not now.
    await seedStatus({
      id: statusIn(author, 'direct'),
      actorId: author,
      createdAt: BASE + 8_000,
      to: [other]
    })
    // Newer still, but addressed to a collection that is not `/followers`.
    await seedStatus({
      id: statusIn(author, 'list'),
      actorId: author,
      createdAt: BASE + 8_500,
      to: [`${author}/following`]
    })
    await seedStatus({
      id: statusIn(author, 'public-old'),
      actorId: author,
      createdAt: BASE + 1_000
    })
    const newest = await seedStatus({
      id: statusIn(author, 'newest'),
      actorId: author,
      createdAt: BASE + 9_000
    })
    // The other actor has a status too, untouched by this deletion.
    await seedStatus({
      id: statusIn(other, 'kept'),
      actorId: other,
      createdAt: BASE + 2_000
    })
    refreshSpy()

    await deleteStatus(db(), { statusId: newest })
    expect(await lastStatusAtOf(author)).toBe(BASE + 3_000)
    expect(await lastStatusAtOf(other)).toBe(BASE + 9_999)

    await deleteStatus(db(), { statusId: followersOnly })
    expect(await lastStatusAtOf(author)).toBe(BASE + 1_000)
    await deleteStatus(db(), { statusId: statusIn(author, 'public-old') })
    // Only the direct and the list-addressed statuses are left.
    expect(await lastStatusAtOf(author)).toBeNull()
  })

  describe('with an actor scope', () => {
    it('deletes nothing when the root is another actor’s', async () => {
      const t = await seedThread()
      const refresh = refreshSpy()
      const before = await dumpDatabase(testDb)
      await deleteStatus(db(), { statusId: t.root, actorId: t.replier })
      expect(await dumpDatabase(testDb)).toEqual(before)
      expect(refresh).not.toHaveBeenCalled()
    })

    it('deletes only the actor’s statuses of the tree, walking through the others’ replies', async () => {
      const t = await seedThread()
      refreshSpy()
      const before = await dumpDatabase(testDb)

      // Matched after normalization: a trailing slash and a fragment.
      await deleteStatus(db(), {
        statusId: t.root,
        actorId: `${t.author}/#main-key`
      })

      expect(await dumpDatabase(testDb)).toEqual(
        expectedAfterDeletion(before, [t.root, t.reply11, t.reply2], {
          counters: {
            [CounterKey.totalStatus(t.author)]: 7,
            [CounterKey.serviceTotalStatuses()]: 97,
            [CounterKey.nodeinfoLocalPosts()]: 47,
            // reply11 is followers-only, so reply1's reply counter stays
            [CounterKey.totalHashtag('cats')]: 28,
            [CounterKey.totalHashtag('dogs')]: 7
          },
          lastStatusAt: { [t.author]: BASE + 5_000 }
        })
      )
    })

    it('skips an actor id that does not normalize', async () => {
      const t = await seedThread()
      refreshSpy()
      const before = await dumpDatabase(testDb)
      await deleteStatus(db(), { statusId: t.root, actorId: 'not a url' })
      expect(await dumpDatabase(testDb)).toEqual(before)
    })
  })

  describe('reply depth', () => {
    const seedChain = async (levels: number) => {
      const author = await seedActor('chain')
      const ids: string[] = []
      for (let index = 0; index < levels; index += 1) {
        ids.push(
          await seedStatus({
            id: statusIn(author, `deep-${index}`),
            actorId: author,
            createdAt: BASE + index,
            reply: index === 0 ? '' : statusIn(author, `deep-${index - 1}`)
          })
        )
      }
      return { author, ids }
    }

    it('deletes a chain of 100 reply levels', async () => {
      const { author, ids } = await seedChain(100)
      refreshSpy()
      await deleteStatus(db(), { statusId: ids[0] })
      expect(
        await db()
          .selectFrom('statuses')
          .select('id')
          .where('actorId', '=', author)
          .execute()
      ).toEqual([])
    })

    it('refuses a chain of 101 levels before writing anything, without reading the 101st', async () => {
      const { ids } = await seedChain(101)
      refreshSpy()
      const before = await dumpDatabase(testDb)
      const { statements } = await capture(testDb, () =>
        expect(deleteStatus(db(), { statusId: ids[0] })).rejects.toThrow(
          new Error(
            `Status reply deletion depth limit exceeded for status ${ids[0]}`
          )
        )
      )
      expect(await dumpDatabase(testDb)).toEqual(before)
      // The last level read is the 100th (its replies give the 101st id,
      // which is never read).
      const reads = statements.filter(({ sql }) =>
        /^select "id", "actorId", "type"/.test(sql)
      )
      expect(reads).toHaveLength(100)
      expect(reads.at(-1)?.bindings).toEqual([ids[99]])
      expect(statements.at(-1)?.sql).toBe('rollback')
    })

    it('deletes a reply cycle once', async () => {
      const author = await seedActor('cycle')
      const a = statusIn(author, 'a')
      const b = statusIn(author, 'b')
      await seedStatus({ id: a, actorId: author, createdAt: BASE, reply: b })
      await seedStatus({
        id: b,
        actorId: author,
        createdAt: BASE + 1,
        reply: a
      })
      await setCounter(CounterKey.totalStatus(author), 5)
      refreshSpy()
      await deleteStatus(db(), { statusId: a })
      expect(
        await db()
          .selectFrom('statuses')
          .select('id')
          .where('actorId', '=', author)
          .execute()
      ).toEqual([])
      expect(await counterValue(CounterKey.totalStatus(author))).toBe(3)
    })
  })

  describe('chunks', () => {
    // Every IN list holds at most `cap` values, less its other bindings.
    const CAP = 4

    // The number of values in the longest IN list of a statement.
    const longestInList = (sql: string) =>
      Math.max(
        0,
        ...[...sql.matchAll(/ in \(([^()]*)\)/g)].map(
          ([, list]) => list.split(',').length
        )
      )

    it('splits every IN list at the batch size and still deletes it all', async () => {
      const t = await seedThread()
      // Five more public replies to the root, by both actors.
      for (let index = 0; index < 5; index += 1) {
        const actorId = index % 2 ? t.author : t.replier
        const id = await seedStatus({
          id: statusIn(actorId, `extra-${index}`),
          actorId,
          createdAt: BASE + 60_000 + index,
          reply: t.root
        })
        t.thread.push(id)
        await seedRowsFor(id, actorId, t.neighbourActor, ['#Cats'])
      }
      refreshSpy()
      const before = await dumpDatabase(testDb)
      batchCap.value = CAP

      const { statements } = await capture(testDb, () =>
        deleteStatus(db(), { statusId: t.root })
      )
      batchCap.value = 0

      expect(await dumpDatabase(testDb)).toEqual(
        expectedAfterDeletion(before, t.thread, {
          counters: {
            // root, reply11, reply2 and extra-1, extra-3
            [CounterKey.totalStatus(t.author)]: 5,
            // reply1, reply21 and extra-0, extra-2, extra-4
            [CounterKey.totalStatus(t.replier)]: 0,
            [CounterKey.serviceTotalStatuses()]: 90,
            [CounterKey.nodeinfoLocalPosts()]: 45,
            [CounterKey.totalHashtag('cats')]: 22,
            [CounterKey.totalHashtag('dogs')]: 7
          },
          lastStatusAt: { [t.author]: BASE + 5_000, [t.replier]: null }
        })
      )
      // Ten statuses: no IN list holds more than the cap.
      const lists = statements.map(({ sql }) => longestInList(sql))
      expect(Math.max(...lists)).toBe(CAP)
      const count = (pattern: RegExp) =>
        statements.filter(({ sql }) => pattern.test(sql)).length
      // 10 ids in chunks of 4: 3 statements per status-keyed table.
      expect(count(/^delete from "recipients"/)).toBe(3)
      expect(count(/^delete from "status_link_previews"/)).toBe(3)
      expect(count(/^update "fitness_files"/)).toBe(3)
      // One value reserved for the tag type: chunks of 3.
      expect(count(/^select "statusId", "name" from "tags"/)).toBe(4)
      // Two for the public recipients (both spellings): chunks of 2.
      expect(count(/^select distinct "statusId" from "recipients"/)).toBe(5)
      // Each reference is bound three times: chunks of 1, for the three
      // distinct parents (the root, reply1 and reply2).
      expect(count(/^select "id", "url" from "statuses"/)).toBe(3)
      // One value reserved for the entity type: chunks of 3.
      expect(count(/^delete from "search_documents"/)).toBe(4)
      // 30 counter ids in chunks of 4.
      expect(count(/^delete from "counters"/)).toBe(8)
      // No actor scope: chunks of 4 ids.
      expect(count(/^delete from "statuses"/)).toBe(3)
    })

    it('closes an actor-scoped status delete chunk before its ids and authors pass the cap', async () => {
      const author = await seedActor('author')
      const root = statusIn(author, 'root')
      const ids = [root]
      await seedStatus({ id: root, actorId: author, createdAt: BASE })
      for (let index = 0; index < 5; index += 1) {
        ids.push(
          await seedStatus({
            id: statusIn(author, `r${index}`),
            actorId: author,
            createdAt: BASE + 1 + index,
            reply: root
          })
        )
      }
      refreshSpy()
      batchCap.value = CAP
      const { statements } = await capture(testDb, () =>
        deleteStatus(db(), { statusId: root, actorId: author })
      )
      batchCap.value = 0
      const deletes = statements.filter(({ sql }) =>
        /^delete from "statuses"/.test(sql)
      )
      // Each chunk binds its ids and its one author: 3 + 1, so six statuses
      // take two statements of 3 ids.
      expect(deletes.map(({ bindings }) => bindings.length)).toEqual([4, 4])
      for (const { sql } of deletes) expect(sql).toMatch(/"actorId" in \(/)
      expect(
        await db()
          .selectFrom('statuses')
          .select('id')
          .where('id', 'in', ids)
          .execute()
      ).toEqual([])
    })
  })
})

// What each statement of a deletion transaction does.
const STATEMENTS: StatementNames = [
  [/^(begin|commit|rollback)$/, () => ''],
  [
    /^select "id", "actorId", "type", "reply", "content", "originalStatusId" from "statuses"/,
    (b) => `read statuses ${b.join(',')}`
  ],
  [
    /^select "id" from "statuses" where "reply" in/,
    (b) => `read replies of ${b.join(',')}`
  ],
  [
    /^select distinct "statusId" from "recipients"/,
    () => 'read publicly addressed'
  ],
  [
    /^select "id" from "actors" where "id" in \([^)]*\) and "accountId" is not null$/,
    () => 'read local actors'
  ],
  [/^select "id", "url" from "statuses"/, () => 'read parents'],
  [/^insert into "counters" .* on conflict/, (b) => `decrease ${b[0]}`],
  [/^select "statusId", "name" from "tags"/, () => 'read hashtags'],
  [/^delete from "(\w+)" where "statusId" in/, () => ''],
  [/^update "status_quotes" set/, () => 'tombstone quotes'],
  // By file first: its subquery has a `"statusId" in` too.
  [
    /^update "wahoo_imports" set .* where "fitnessFileId" in \(select "id" from "fitness_files"/,
    () => 'tombstone wahoo by file'
  ],
  [
    /^update "wahoo_imports" set .* where "statusId" in/,
    () => 'tombstone wahoo by status'
  ],
  [/^update "fitness_files" set "statusId" = /, () => 'unlink fitness files'],
  [/^delete from "statuses" where "id" in/, () => 'delete statuses'],
  [
    /^select "id" from "actors" where "id" in \([^)]*\)( for update)?$/,
    () => 'lock actors'
  ],
  [/^update "actors" set "lastStatusAt" = \(select max/, () => 'recompute'],
  [/^delete from "search_documents"/, () => 'delete search documents'],
  [/^delete from "counters" where "id" in/, () => 'delete counters'],
  [/^insert into "queue_jobs"/, () => 'insert queue job'],
  [/^select .* from "queue_jobs"/, () => 'read queue job']
]

const step = (statement: { sql: string; bindings: unknown[] }) => {
  const table = /^delete from "(\w+)" where "statusId" in/.exec(statement.sql)
  if (table) return `delete ${table[1]}`
  return describeStatement(STATEMENTS, statement) || statement.sql
}

describe('statements', () => {
  const seedPair = async () => {
    const author = await seedActor('author', { local: true })
    const replier = await seedActor('replier')
    const root = await seedStatus({
      id: statusIn(author, 'root'),
      actorId: author,
      createdAt: BASE + 1_000
    })
    const reply = await seedStatus({
      id: statusIn(replier, 'reply'),
      actorId: replier,
      createdAt: BASE + 2_000,
      reply: root
    })
    await db()
      .insertInto('tags')
      .values({
        id: randomUUID(),
        statusId: root,
        type: 'hashtag',
        name: '#Cats',
        value: '#Cats',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
    return { author, replier, root, reply }
  }

  const deletionSteps = (
    { author, replier, root, reply }: Awaited<ReturnType<typeof seedPair>>,
    tail: string[] = []
  ) => [
    'begin',
    `read statuses ${root}`,
    `read replies of ${root}`,
    `read statuses ${reply}`,
    `read replies of ${reply}`,
    'read publicly addressed',
    'read local actors',
    'read parents',
    // The reply first (the deepest level first), then the root.
    `decrease ${CounterKey.totalStatus(replier)}`,
    `decrease ${CounterKey.serviceTotalStatuses()}`,
    `decrease ${CounterKey.totalReply(root)}`,
    `decrease ${CounterKey.totalStatus(author)}`,
    `decrease ${CounterKey.nodeinfoLocalPosts()}`,
    'read hashtags',
    `decrease ${CounterKey.totalHashtag('cats')}`,
    'delete recipients',
    'delete likes',
    'delete status_reactions',
    'delete tags',
    'delete attachments',
    'delete bookmarks',
    'delete status_pins',
    'delete status_quotes',
    'tombstone quotes',
    'delete status_history',
    'delete poll_answers',
    'delete poll_voters',
    'delete poll_choices',
    'delete timelines',
    'delete collection_timeline',
    'delete notifications',
    'delete direct_conversation_statuses',
    'delete idempotency_keys',
    'delete status_mutes',
    'delete status_detected_languages',
    'delete status_link_previews',
    'tombstone wahoo by status',
    'tombstone wahoo by file',
    'unlink fitness files',
    'delete statuses',
    'lock actors',
    'recompute',
    'delete search documents',
    'delete counters',
    ...tail,
    'commit'
  ]

  it('runs deleteStatus in one transaction, in order', async () => {
    const pair = await seedPair()
    refreshSpy()
    const { statements } = await capture(testDb, () =>
      deleteStatus(db(), { statusId: pair.root })
    )
    expect(statements.map(step)).toEqual(deletionSteps(pair))
    // The row lock is PostgreSQL's alone.
    const lock = statements.find(({ sql }) =>
      /^select "id" from "actors" where "id" in \([^)]*\)( for update)?$/.test(
        sql
      )
    )
    expect(lock?.sql.endsWith(' for update')).toBe(testDb.backend === 'pg')
  })

  it('runs deleteStatusWithQueueJob in one transaction, the queue job last', async () => {
    const pair = await seedPair()
    refreshSpy()
    const { result, statements } = await capture(testDb, () =>
      deleteStatusWithQueueJob(db(), {
        statusId: pair.root,
        actorId: pair.author,
        queueJob: {
          id: `${prefix}-job`,
          name: 'sendDeleteNote',
          payload: {
            id: `${prefix}-job`,
            name: 'sendDeleteNote',
            data: { statusId: pair.root }
          }
        }
      })
    )
    expect(result).toBe(true)
    // The reply is the replier's: it is walked but kept.
    const steps = statements.map(step)
    expect(steps).toEqual([
      'begin',
      `read statuses ${pair.root}`,
      `read replies of ${pair.root}`,
      `read statuses ${pair.reply}`,
      `read replies of ${pair.reply}`,
      'read publicly addressed',
      'read local actors',
      // The root is no reply: no parent to read.
      `decrease ${CounterKey.totalStatus(pair.author)}`,
      `decrease ${CounterKey.serviceTotalStatuses()}`,
      `decrease ${CounterKey.nodeinfoLocalPosts()}`,
      ...deletionSteps(pair).slice(13, -1),
      'insert queue job',
      'read queue job',
      'commit'
    ])
  })

  it('reads the publicly addressed statuses before deleting their recipients', async () => {
    const pair = await seedPair()
    expect(
      await selectPubliclyAddressedStatusIds(db(), [pair.root, pair.reply])
    ).toEqual(new Set([pair.root, pair.reply]))
    expect(await selectPubliclyAddressedStatusIds(db(), [])).toEqual(new Set())
  })
})

describe('rollback', () => {
  it('rolls deleteStatus back in full when its last write fails', async () => {
    const t = await seedThread()
    const refresh = refreshSpy()
    // The last write: the deleted statuses' own counters.
    const drop = await failWrite(
      testDb,
      'counters',
      'delete',
      `old.id = ${quote(CounterKey.totalReply(t.root))}`
    )
    const before = await dumpDatabase(testDb)
    try {
      await expect(deleteStatus(db(), { statusId: t.root })).rejects.toThrow(
        // The driver's own message, without Knex's statement prefix.
        /^forced failure$/
      )
    } finally {
      await drop()
    }
    expect(await dumpDatabase(testDb)).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('rolls deleteStatusWithQueueJob back in full when the queue job insert fails', async () => {
    const t = await seedThread()
    const refresh = refreshSpy()
    const drop = await failWrite(testDb, 'queue_jobs', 'insert', '1 = 1')
    const before = await dumpDatabase(testDb)
    try {
      await expect(
        deleteStatusWithQueueJob(db(), {
          statusId: t.root,
          actorId: t.author,
          queueJob: {
            id: `${prefix}-job`,
            name: 'sendDeleteNote',
            payload: {} as never
          }
        })
      ).rejects.toThrow(/^forced failure$/)
    } finally {
      await drop()
    }
    expect(await dumpDatabase(testDb)).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('deleteStatusWithQueueJob', () => {
  const job = () => ({
    id: `${prefix}-job`,
    name: 'sendDeleteNote',
    payload: {
      id: `${prefix}-job`,
      name: 'sendDeleteNote',
      data: { statusId: 'x' }
    }
  })

  it('deletes the actor’s status and its tree and inserts the queue job', async () => {
    const t = await seedThread()
    const refresh = refreshSpy()
    const before = await dumpDatabase(testDb)
    await expect(
      deleteStatusWithQueueJob(db(), {
        statusId: t.root,
        actorId: t.author,
        queueJob: job()
      })
    ).resolves.toBe(true)
    const jobRow = {
      id: `${prefix}-job`,
      name: 'sendDeleteNote',
      payload: job().payload,
      attempts: 0,
      max_retries: 16,
      next_run_at: now,
      status: 'pending',
      claim_token: null,
      last_error_message: null,
      last_error_stack: null,
      created_at: now,
      updated_at: now
    }
    expect(await dumpDatabase(testDb)).toEqual(
      withTable(
        expectedAfterDeletion(before, [t.root, t.reply11, t.reply2], {
          counters: {
            [CounterKey.totalStatus(t.author)]: 7,
            [CounterKey.serviceTotalStatuses()]: 97,
            [CounterKey.nodeinfoLocalPosts()]: 47,
            [CounterKey.totalHashtag('cats')]: 28,
            [CounterKey.totalHashtag('dogs')]: 7
          },
          lastStatusAt: { [t.author]: BASE + 5_000 }
        }),
        'queue_jobs',
        (rows) => [...rows, jobRow]
      )
    )
    expect(refresh).toHaveBeenCalledTimes(1)
    const [refreshDb, params] = refresh.mock.calls[0]
    expect(isInTransaction(refreshDb)).toBe(false)
    expect(params.hashtags.sort()).toEqual(['#Cats', 'dogs'])
  })

  it('returns false and writes nothing, no queue job either, for another actor’s or a missing status', async () => {
    const t = await seedThread()
    const refresh = refreshSpy()
    const before = await dumpDatabase(testDb)
    for (const params of [
      { statusId: t.root, actorId: t.replier },
      { statusId: statusIn(t.author, 'missing'), actorId: t.author }
    ]) {
      await expect(
        deleteStatusWithQueueJob(db(), { ...params, queueJob: job() })
      ).resolves.toBe(false)
    }
    expect(await dumpDatabase(testDb)).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('hashtag refresh', () => {
  it('reindexes the affected hashtags after the commit', async () => {
    const author = await seedActor('author')
    const root = await seedStatus({
      id: statusIn(author, 'root'),
      actorId: author,
      createdAt: BASE
    })
    const tag = `#Refresh${prefix}`
    await db()
      .insertInto('tags')
      .values({
        id: randomUUID(),
        statusId: root,
        type: 'hashtag',
        name: tag,
        nameNormalized: tag.toLowerCase(),
        value: tag,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
    await searchQueries.indexHashtagSearchDocuments(db(), { hashtags: [tag] })
    const hashtagDocument = () =>
      db()
        .selectFrom('search_documents')
        .select(['entityId', 'postCount'])
        .where('entityType', '=', 'hashtag')
        .where('entityId', '=', tag.slice(1).toLowerCase())
        .executeTakeFirst()
    expect(await hashtagDocument()).toBeDefined()
    await deleteStatus(db(), { statusId: root })
    // Its last status is gone, so the refresh removes it.
    expect(await hashtagDocument()).toBeUndefined()
  })

  it('logs a failed refresh and still resolves, the deletion committed', async () => {
    const t = await seedThread()
    const failure = new Error('refresh failed')
    vi.spyOn(searchQueries, 'indexHashtagSearchDocuments').mockRejectedValue(
      failure
    )
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    await expect(
      deleteStatus(db(), { statusId: t.reply2 })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      { err: failure, hashtags: ['#Cats'], statusId: t.reply2 },
      'Failed to refresh hashtag search documents after status deletion'
    )
    expect(
      await db()
        .selectFrom('statuses')
        .select('id')
        .where('id', '=', t.reply2)
        .executeTakeFirst()
    ).toBeUndefined()
  })
})

describe('deleteStatusEditHistory', () => {
  it('deletes the revisions of that status only', async () => {
    const t = await seedThread()
    const before = await dumpDatabase(testDb)
    const { statements } = await capture(testDb, () =>
      deleteStatusEditHistory(db(), { statusId: t.root })
    )
    expect(statements.map(({ sql }) => sql)).toEqual([
      expect.stringMatching(
        /^delete from "status_history" where "statusId" = (\?|\$1)$/
      )
    ])
    expect(await dumpDatabase(testDb)).toEqual(
      withTable(before, 'status_history', (rows) =>
        rows.filter((row) => row.statusId !== t.root)
      )
    )
  })
})

// Each was reproduced against the Knex mixin this replaces.
describe('behaviour changes', () => {
  it('treats an undefined status id as no status, where Knex threw', async () => {
    await seedThread()
    const refresh = refreshSpy()
    const before = await dumpDatabase(testDb)
    await expect(
      deleteStatus(db(), { statusId: undefined as unknown as string })
    ).resolves.toBeUndefined()
    await expect(
      deleteStatusWithQueueJob(db(), {
        statusId: undefined as unknown as string,
        actorId: actorIn('anyone'),
        queueJob: {
          id: `${prefix}-job`,
          name: 'sendDeleteNote',
          payload: {} as never
        }
      })
    ).resolves.toBe(false)
    await expect(
      deleteStatusEditHistory(db(), {
        statusId: undefined as unknown as string
      })
    ).resolves.toBeUndefined()
    expect(await dumpDatabase(testDb)).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('deletes no revision for a null status id, where Knex deleted those with no status', async () => {
    await db()
      .insertInto('status_history')
      .values({
        statusId: null,
        data: '{}',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
    const before = await dumpDatabase(testDb)
    await deleteStatusEditHistory(db(), {
      statusId: null as unknown as string
    })
    expect(await dumpDatabase(testDb)).toEqual(before)
    await db()
      .deleteFrom('status_history')
      .where('statusId', 'is', null)
      .execute()
  })
})

// The row lock and the transaction, raced on two PostgreSQL connections.
// SQLite serialises every write on its one connection, so there is nothing
// to race there.
describe.runIf(testDb.backend === 'pg')('PostgreSQL locks', () => {
  // recomputeActorsLastStatusAt: "Taking the lock first serializes the two
  // and forces the following UPDATE to take a fresh snapshot that already
  // sees the new status." A concurrent transaction posts a newer status and
  // bumps lastStatusAt, holding the actor row; the deletion's lock read waits
  // for it, so its recompute sees the new status. Without the lock read, the
  // UPDATE waits on the same row but recomputes from its older snapshot.
  it('makes the lastStatusAt recompute wait for a concurrent bump and see its status', async () => {
    const author = await seedActor('author', { lastStatusAt: BASE + 2_000 })
    await seedStatus({
      id: statusIn(author, 'old'),
      actorId: author,
      createdAt: BASE + 1_000
    })
    const doomed = await seedStatus({
      id: statusIn(author, 'doomed'),
      actorId: author,
      createdAt: BASE + 2_000
    })
    refreshSpy()

    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let markBumped = () => {}
    const bumped = new Promise<void>((resolve) => {
      markBumped = resolve
    })
    const newer = statusIn(author, 'newer')
    const writer = start(() =>
      db()
        .transaction()
        .execute(async (trx) => {
          await trx
            .insertInto('statuses')
            .values({
              id: newer,
              actorId: author,
              type: 'Note',
              reply: '',
              content: '{}',
              createdAt: new Date(BASE + 3_000),
              updatedAt: new Date(BASE + 3_000)
            })
            .execute()
          await trx
            .insertInto('recipients')
            .values({
              id: randomUUID(),
              statusId: newer,
              actorId: ACTIVITY_STREAM_PUBLIC,
              type: 'to',
              createdAt: new Date(BASE),
              updatedAt: new Date(BASE)
            })
            .execute()
          await trx
            .updateTable('actors')
            .set({ lastStatusAt: new Date(BASE + 3_000) })
            .where('id', '=', author)
            .execute()
          markBumped()
          await released
        })
    )
    await bumped

    const deletion = start(() => deleteStatus(db(), { statusId: doomed }))
    const waiting = await waitForLockWait(testDb, deletion)
    expect(waiting).toEqual([
      expect.stringMatching(/^select "id" from "actors" .* for update$/)
    ])
    release()
    await writer.result()
    await deletion.result()
    expect(await lastStatusAtOf(author)).toBe(BASE + 3_000)
  })

  // The whole deletion is one transaction: stopped after its last statement,
  // it still holds the counter rows it moved, so a create by the same author
  // waits until it commits, and both adjustments land.
  it('holds its counter rows until it commits, so a concurrent create waits', async () => {
    const author = await seedActor('author', { local: true })
    const doomed = await seedStatus({
      id: statusIn(author, 'doomed'),
      actorId: author,
      createdAt: BASE + 1_000
    })
    await setCounter(CounterKey.totalStatus(author), 5)
    refreshSpy()

    const last = pauseAfterStatement((sql) =>
      /^delete from "counters" where "id" in/.test(sql)
    )
    const deletion = start(() => deleteStatus(db(), { statusId: doomed }))
    await last.reached

    const create = start(() =>
      createNote(
        db(),
        {
          getStatus: async () => null,
          getStatusesByIds: async () => [],
          hydrateStatusRow: async () => null
        },
        {
          id: statusIn(author, 'new'),
          url: statusIn(author, 'new'),
          actorId: author,
          to: PUBLIC,
          cc: [],
          text: 'new'
        }
      )
    )
    const waiting = await waitForLockWait(testDb, create)
    expect(waiting).toEqual([expect.stringMatching(/^insert into "counters" /)])
    last.release()
    await deletion.result()
    await create.result()
    expect(await counterValue(CounterKey.totalStatus(author))).toBe(5)
  })
})
