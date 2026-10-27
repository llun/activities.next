import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import { indexHashtagSearchDocuments } from '@/lib/database/domains/search/hashtags'
import {
  appendStatusHistory,
  updateNote,
  updateNoteVisibility,
  updatePoll,
  updateStatusQuoteApprovalPolicy
} from '@/lib/database/domains/status/edits'
import {
  createTag,
  decreaseHashtagCounter,
  deleteStatusTagsByType,
  increaseHashtagCounter
} from '@/lib/database/domains/status/hashtags'
import {
  createPollAnswer,
  incrementPollChoiceVotes,
  recordPollVotes
} from '@/lib/database/domains/status/polls'
import { createStatusQueries } from '@/lib/database/domains/status/queries'
import type { StatusHydration } from '@/lib/database/domains/status/types'
import {
  createAnnounce,
  createNote,
  createNoteWithResult,
  createPoll,
  createPollWithResult
} from '@/lib/database/domains/status/writes'
import { inTransaction } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { CapturedQuery } from '@/lib/database/testing/queryCapture'
import { CounterKey } from '@/lib/database/utils/counter'
import {
  formatBucketHour,
  truncateToHour
} from '@/lib/database/utils/counterBucket'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { MAX_FUTURE_SKEW_MS } from '@/lib/services/accountImport/mappers/timeSkew'
import type { Attachment } from '@/lib/types/domain/attachment'
import { StatusNote, StatusPoll, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Query-level tests for the status writes (lib/database/domains/status): the
// creates, the edits, the tag writes and the poll votes. Every test uses its
// own actors and statuses (a fresh prefix) and writes neighbouring rows next to
// the ones under test, so a dropped predicate touches a row it must not. The
// first actor and status of the database are written before any test, so a
// single-row read that lost its where finds them instead of the row under
// test. Each test runs at its own hour (Date is faked), so the hour buckets it
// moves are its own. Hydration is the facade's, recording what it is asked
// for. Every transaction is checked for its statements in order and for
// a full rollback when its last write fails (a trigger, on both backends).
// Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const db = testDb.db

const DOMAIN = 'status-writes.test'
const BASE = Date.UTC(2026, 0, 1)
const actorIn = (name: string) => `https://${DOMAIN}/users/${name}`
const FIRST_ACTOR = actorIn('first')
const FIRST_STATUS = `${FIRST_ACTOR}/statuses/first`

let prefixCount = 0
const nextPrefix = () => `sw${++prefixCount}`

// The faked current time of the running test: a new hour for each test.
let hourCount = 0
let now = 0

type HydrationCall =
  | [
      'getStatus',
      { statusId: string; currentActorId?: string; withReplies?: boolean }
    ]
  | ['getStatusesByIds' | 'hydrateStatusRow', unknown]

// The facade's hydration, recording what the writes ask it for. The writes
// only read single statuses.
const hydrationCalls: HydrationCall[] = []
const hydration: StatusHydration = {
  getStatus: (params) => {
    hydrationCalls.push(['getStatus', params])
    return testDb.database.getStatus(params)
  },
  getStatusesByIds: async (params) => {
    hydrationCalls.push(['getStatusesByIds', params])
    throw new Error('not used by the writes')
  },
  hydrateStatusRow: async (row) => {
    hydrationCalls.push(['hydrateStatusRow', row])
    throw new Error('not used by the writes')
  }
}

const seedActor = async (
  name: string,
  {
    local = false,
    lastStatusAt = null
  }: { local?: boolean; lastStatusAt?: number | null } = {}
) => {
  const id = actorIn(name)
  let accountId: string | null = null
  if (local) {
    accountId = randomUUID()
    await db
      .insertInto('accounts')
      .values({
        id: accountId,
        email: `${name}@${DOMAIN}`,
        passwordHash: 'hash',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
  }
  await db
    .insertInto('actors')
    .values({
      id,
      username: name,
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

const noteContent = (url: string, text = `text of ${url}`) =>
  JSON.stringify({ url, text, summary: '', sensitive: false, language: null })

const seedStatus = async ({
  id,
  actorId,
  createdAt = BASE,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  type = StatusType.enum.Note,
  url = id,
  urlHash = getHashFromString(url),
  reply = '',
  content = type === StatusType.enum.Announce ? null : noteContent(url),
  originalStatusId = null
}: {
  id: string
  actorId: string
  createdAt?: number | null
  to?: string[]
  cc?: string[]
  type?: StatusType
  url?: string
  urlHash?: string
  reply?: string
  content?: string | null
  originalStatusId?: string | null
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
      reply,
      replyHash: reply ? getHashFromString(reply) : null,
      content,
      originalStatusId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  for (const [kind, actorIds] of [
    ['to', to],
    ['cc', cc]
  ] as const) {
    for (const recipient of actorIds) {
      await db
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

const pollContent = (url: string, text = `poll ${url}`) =>
  JSON.stringify({
    url,
    text,
    summary: '',
    sensitive: false,
    language: null,
    endAt: BASE + 86_400_000,
    pollType: 'oneOf',
    hideTotals: false
  })

// A poll whose choices are written with descending choiceIds, so a table scan
// on PostgreSQL meets them in the opposite of choiceId order.
let choiceIdCount = 900_000
const seedPoll = async (
  id: string,
  actorId: string,
  titles: string[],
  totals: number[] = titles.map(() => 0)
) => {
  await seedStatus({
    id,
    actorId,
    type: StatusType.enum.Poll,
    content: pollContent(id)
  })
  // Far apart, so the ids SQLite's AUTOINCREMENT gives the polls written in
  // between (one above the largest so far) never reach the next poll's.
  choiceIdCount += 1_000
  const choiceIds = titles.map((_, index) => choiceIdCount - index)
  for (const [index, title] of [...titles.entries()].reverse()) {
    await db
      .insertInto('poll_choices')
      .values({
        choiceId: choiceIds[titles.length - 1 - index],
        statusId: id,
        title,
        totalVotes: totals[index],
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
  }
  return id
}

const choicesOf = async (statusId: string) =>
  db
    .selectFrom('poll_choices')
    .select(['title', 'totalVotes'])
    .where('statusId', '=', statusId)
    .orderBy('choiceId')
    .execute()

const recipientsOf = async (statusId: string) =>
  (
    await db
      .selectFrom('recipients')
      .select(['actorId', 'type', 'createdAt', 'updatedAt'])
      .where('statusId', '=', statusId)
      .execute()
  ).sort((a, b) =>
    `${a.type} ${a.actorId}`.localeCompare(`${b.type} ${b.actorId}`)
  )

const counterValue = async (id: string) =>
  (
    await db
      .selectFrom('counters')
      .select('value')
      .where('id', '=', id)
      .executeTakeFirst()
  )?.value ?? null

const counterRow = (id: string) =>
  db.selectFrom('counters').selectAll().where('id', '=', id).executeTakeFirst()

const lastStatusAtOf = async (actorId: string) =>
  (
    await db
      .selectFrom('actors')
      .select('lastStatusAt')
      .where('id', '=', actorId)
      .executeTakeFirstOrThrow()
  ).lastStatusAt

const statusRow = (id: string) =>
  db.selectFrom('statuses').selectAll().where('id', '=', id).executeTakeFirst()

const historyOf = (statusId: string) =>
  db
    .selectFrom('status_history')
    .select(['data', 'createdAt', 'updatedAt'])
    .where('statusId', '=', statusId)
    .orderBy('id')
    .execute()

const searchDocumentOf = (statusId: string) =>
  db
    .selectFrom('search_documents')
    .select(['entityId', 'actorId', 'documentText', 'entityCreatedAt'])
    .where('entityType', '=', 'status')
    .where('entityId', '=', statusId)
    .executeTakeFirst()

// The counter rows of the hour bucket `type` for the running test's hour.
const bucketOf = (type: string) =>
  CounterKey.bucketKey(type, formatBucketHour(truncateToHour(new Date(now))))

// Every table a status write touches, in a stable order.
const dumpTables = async () => ({
  statuses: await db.selectFrom('statuses').selectAll().orderBy('id').execute(),
  recipients: await db
    .selectFrom('recipients')
    .selectAll()
    .orderBy('id')
    .execute(),
  counters: await db.selectFrom('counters').selectAll().orderBy('id').execute(),
  actors: await db
    .selectFrom('actors')
    .select(['id', 'lastStatusAt'])
    .orderBy('id')
    .execute(),
  pollChoices: await db
    .selectFrom('poll_choices')
    .selectAll()
    .orderBy('choiceId')
    .execute(),
  pollAnswers: await db
    .selectFrom('poll_answers')
    .selectAll()
    .orderBy('answerId')
    .execute(),
  pollVoters: await db
    .selectFrom('poll_voters')
    .selectAll()
    .orderBy('id')
    .execute(),
  tags: await db.selectFrom('tags').selectAll().orderBy('id').execute(),
  statusHistory: await db
    .selectFrom('status_history')
    .selectAll()
    .orderBy('id')
    .execute(),
  attachments: await db
    .selectFrom('attachments')
    .selectAll()
    .orderBy('id')
    .execute(),
  timelines: await db
    .selectFrom('timelines')
    .selectAll()
    .orderBy('id')
    .execute(),
  searchDocuments: await db
    .selectFrom('search_documents')
    .selectAll()
    .orderBy('id')
    .execute()
})

// Makes every write on `table` matching `condition` (SQL over `new`, valid on
// both backends) fail, for each of `events`. Returns the function that removes
// the triggers again. A BEFORE INSERT trigger also fires for an upsert whose
// row exists, on both backends.
let triggerCount = 0
const failWrite = async (
  table: string,
  events: ('insert' | 'update')[],
  condition: string,
  // PostgreSQL's SQLSTATE and SQLite's message for the forced error.
  error: { code: string; message: string } = {
    code: 'P0001',
    message: 'forced failure'
  }
) => {
  const drops: (() => Promise<void>)[] = []
  for (const event of events) {
    triggerCount += 1
    const name = `status_writes_fail_${triggerCount}`
    if (testDb.backend === 'pg') {
      await sql
        .raw(
          `create or replace function ${name}() returns trigger language plpgsql as $$ begin raise exception '${error.message}' using errcode = '${error.code}'; end $$`
        )
        .execute(db)
      await sql
        .raw(
          `create trigger ${name} before ${event} on "${table}" for each row when (${condition}) execute function ${name}()`
        )
        .execute(db)
      drops.push(async () => {
        await sql.raw(`drop trigger ${name} on "${table}"`).execute(db)
        await sql.raw(`drop function ${name}()`).execute(db)
      })
    } else {
      await sql
        .raw(
          `create trigger ${name} before ${event} on "${table}" when ${condition} begin select raise(abort, '${error.message}'); end`
        )
        .execute(db)
      drops.push(async () => {
        await sql.raw(`drop trigger ${name}`).execute(db)
      })
    }
  }
  return async () => {
    for (const drop of drops) await drop()
  }
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

// Runs `action` expecting it to fail on the forced write, then checks that
// every table is as it was.
const expectRolledBack = async (
  drop: () => Promise<void>,
  action: () => Promise<unknown>
) => {
  const before = await dumpTables()
  try {
    await expect(action()).rejects.toThrow('forced failure')
  } finally {
    await drop()
  }
  expect(await dumpTables()).toEqual(before)
}

type Statement = CapturedQuery

// The statements `run` sends, with what it returned.
const capture = async <T>(run: () => Promise<T>) => {
  let result!: T
  const statements = await testDb.captureQueries(async () => {
    result = await run()
  })
  return { result, statements }
}

// What each statement of a status write does, named with the binding that
// tells it apart. The Kysely statements are the same text on both backends
// but for the placeholders.
const STATEMENTS: [RegExp, (bindings: unknown[]) => string][] = [
  [/^(begin|commit|rollback)$/, () => ''],
  [/^insert into "statuses" /, () => 'insert status'],
  [/^insert into "counters" .* on conflict/, (b) => `count ${b[0]}`],
  [/^update "counters" set "bucketHour" /, (b) => `bucket hour ${b.at(-1)}`],
  [/^update "actors" set "lastStatusAt" /, (b) => `lastStatusAt ${b[1]}`],
  [/^select "accountId" from "actors" /, (b) => `read account ${b[0]}`],
  [/^select "id" from "statuses" where "id" = /, (b) => `parent by id ${b[0]}`],
  [
    /^select "id" from "statuses" where "urlHash" = \S+ and "url" = /,
    (b) => `parent by url ${b[1]}`
  ],
  [/^insert into "recipients" /, (b) => `recipient ${b[3]} ${b[2]}`],
  [/^insert into "poll_choices" /, (b) => `insert choice ${b[1]}`],
  [/^select "title" from "poll_choices" /, () => 'read choice titles'],
  [/^insert into "status_history" /, () => 'insert history'],
  [/^update "statuses" set /, () => 'update status'],
  [/^delete from "attachments" /, () => 'delete attachments'],
  [/^insert into "attachments" /, () => 'insert attachment'],
  [/^update "attachments" set /, (b) => `update attachment ${b.at(-1)}`],
  [/^delete from "status_history" /, () => 'delete history'],
  [/^delete from "recipients" /, () => 'delete recipients'],
  [/^delete from "timelines" /, () => 'delete timelines'],
  [/^select "statusId", "name" from "tags" /, () => 'read hashtags'],
  [/^delete from "poll_answers" /, () => 'delete answers'],
  [/^delete from "poll_voters" /, () => 'delete voters'],
  [/^delete from "poll_choices" /, () => 'delete choices'],
  [
    /^update "poll_choices" set "totalVotes" = "totalVotes" \+ /,
    () => 'add votes'
  ],
  [/^update "poll_choices" set "totalVotes" = /, (b) => `tally ${b.at(-1)}`],
  [/^select "choiceId" from "poll_choices" /, () => 'read choices'],
  [/^select "id" from "poll_voters" /, () => 'read voter'],
  [/^select "choice" from "poll_answers" /, () => 'read answers'],
  [/^insert into "poll_voters" /, () => 'insert voter'],
  [/^insert into "poll_answers" /, () => 'insert answers']
]

const describeStatement = ({ sql: text, bindings }: Statement) => {
  for (const [pattern, name] of STATEMENTS) {
    if (pattern.test(text)) return name(bindings) || text
  }
  return `unknown: ${text}`
}

// The statements of the first transaction among `statements` that writes,
// from its begin to its commit or rollback. Hydration runs outside it, and
// may read in a transaction of its own; reindexing a hashtag for search
// writes in one after it.
const writingTransaction = (statements: Statement[]) => {
  const transactions: Statement[][] = []
  let current: Statement[] | null = null
  for (const statement of statements) {
    if (statement.sql === 'begin') current = []
    current?.push(statement)
    if (
      current &&
      (statement.sql === 'commit' || statement.sql === 'rollback')
    ) {
      transactions.push(current)
      current = null
    }
  }
  const writing = transactions.filter((transaction) =>
    transaction.some(
      ({ sql: text }) => !/^(begin|commit|rollback|select) ?/.test(text)
    )
  )
  expect(writing.length, 'a writing transaction').toBeGreaterThan(0)
  return writing[0]
}

const transactionSteps = (statements: Statement[]) =>
  writingTransaction(statements).map(describeStatement)

// The row lock an edit takes: the `select * from "statuses"` read of its
// transaction, taken before anything is written. PostgreSQL appends
// `for update`; SQLite has no row locks, so the same statement reads
// without it.
const statusRowLock = (statements: Statement[]) => {
  const transaction = writingTransaction(statements)
  const lock = transaction.find(({ sql: text }) =>
    /^select \* from "statuses" where "id" = (\$1|\?) limit (\$2|\?)( for update)?$/.test(
      text
    )
  )
  const firstWrite = transaction.findIndex(
    ({ sql: text }) => !/^(begin|select) ?/.test(text)
  )
  expect(lock, 'the status row lock').toBeDefined()
  expect(
    lock && transaction.indexOf(lock) < firstWrite,
    'the lock is taken before the first write'
  ).toBe(true)
  return lock
}

beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
  await seedActor('first', { local: true })
  await seedStatus({ id: FIRST_STATUS, actorId: FIRST_ACTOR })
})

afterAll(async () => {
  await testDb.destroy()
})

beforeEach(() => {
  hourCount += 1
  now = Date.UTC(2026, 2, 1) + hourCount * 3_600_000 + 1_234
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  hydrationCalls.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createNote', () => {
  const setup = async () => {
    const p = nextPrefix()
    const local = await seedActor(`${p}-local`, { local: true })
    const remote = await seedActor(`${p}-remote`)
    return { p, local, remote }
  }

  it('writes the status, its recipients and its counters, indexes it and returns it', async () => {
    const { local, remote } = await setup()
    const id = `${local}/statuses/1`
    const createdAt = now - 5_000
    const serviceBefore = await counterValue(CounterKey.serviceTotalStatuses())
    const localPostsBefore = await counterValue(CounterKey.nodeinfoLocalPosts())

    const result = await createNoteWithResult(db, hydration, {
      id,
      url: `https://${DOMAIN}/@local/1`,
      actorId: local,
      text: 'Hello',
      summary: 'cw',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${local}/followers`, remote],
      sensitive: true,
      language: 'en',
      quoteApprovalPolicy: 'followers',
      applicationName: 'app',
      applicationWebsite: 'https://app.test',
      createdAt,
      publicId: '01890000-0000-7000-8000-000000000001'
    })

    expect(await statusRow(id)).toEqual({
      id,
      publicId: '01890000-0000-7000-8000-000000000001',
      url: `https://${DOMAIN}/@local/1`,
      urlHash: getHashFromString(`https://${DOMAIN}/@local/1`),
      actorId: local,
      type: StatusType.enum.Note,
      content: JSON.stringify({
        url: `https://${DOMAIN}/@local/1`,
        text: 'Hello',
        summary: 'cw',
        sensitive: true,
        language: 'en',
        quoteApprovalPolicy: 'followers'
      }),
      applicationName: 'app',
      applicationWebsite: 'https://app.test',
      reply: '',
      replyHash: null,
      originalStatusId: null,
      createdAt,
      updatedAt: now
    })
    expect(await recipientsOf(id)).toEqual([
      {
        actorId: `${local}/followers`,
        type: 'cc',
        createdAt: now,
        updatedAt: now
      },
      { actorId: remote, type: 'cc', createdAt: now, updatedAt: now },
      {
        actorId: ACTIVITY_STREAM_PUBLIC,
        type: 'to',
        createdAt: now,
        updatedAt: now
      }
    ])
    expect(await counterRow(CounterKey.totalStatus(local))).toEqual({
      id: CounterKey.totalStatus(local),
      value: 1,
      bucketHour: null,
      createdAt: now,
      updatedAt: now
    })
    expect(await counterValue(CounterKey.serviceTotalStatuses())).toBe(
      (serviceBefore ?? 0) + 1
    )
    expect(await counterRow(bucketOf('statuses'))).toEqual({
      id: bucketOf('statuses'),
      value: 1,
      bucketHour: truncateToHour(new Date(now)).getTime(),
      createdAt: now,
      updatedAt: now
    })
    expect(await counterValue(CounterKey.nodeinfoLocalPosts())).toBe(
      (localPostsBefore ?? 0) + 1
    )
    expect(await counterRow(bucketOf('local-statuses'))).toEqual({
      id: bucketOf('local-statuses'),
      value: 1,
      bucketHour: truncateToHour(new Date(now)).getTime(),
      createdAt: now,
      updatedAt: now
    })
    expect(await lastStatusAtOf(local)).toBe(createdAt)
    // A Note's content names no boosted status.
    expect(
      await counterValue(CounterKey.totalReblog(`https://${DOMAIN}/@local/1`))
    ).toBeNull()
    expect(await searchDocumentOf(id)).toEqual({
      entityId: id,
      actorId: local,
      documentText: expect.stringContaining('Hello'),
      entityCreatedAt: createdAt
    })

    expect(result.isNew).toBe(true)
    // The author is read through the actor domain, its lastStatusAt hidden.
    const { actor } = result.status as StatusNote
    expect(actor).toMatchObject({ id: local, lastStatusAt: null })
    expect(result.status).toEqual(
      StatusNote.parse({
        id,
        publicId: '01890000-0000-7000-8000-000000000001',
        url: `https://${DOMAIN}/@local/1`,
        actorId: local,
        actor,
        type: StatusType.enum.Note,
        text: 'Hello',
        summary: 'cw',
        sensitive: true,
        language: 'en',
        quoteApprovalPolicy: 'followers',
        detectedLanguage: null,
        applicationName: 'app',
        applicationWebsite: 'https://app.test',
        reply: '',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${local}/followers`, remote],
        edits: [],
        attachments: [],
        tags: [],
        replies: [],
        totalLikes: 0,
        reactions: [],
        isActorLiked: false,
        isActorBookmarked: false,
        actorAnnounceStatusId: null,
        isLocalActor: true,
        createdAt,
        updatedAt: now
      })
    )
    // A new status is not hydrated.
    expect(hydrationCalls).toEqual([])
  })

  it('defaults its optional fields, its createdAt to now and its publicId to one minted for that time', async () => {
    const { remote } = await setup()
    const id = `${remote}/statuses/1`
    const status = await createNote(db, hydration, {
      id,
      url: id,
      actorId: remote,
      text: 'plain',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const row = await statusRow(id)
    expect(row).toMatchObject({
      content: JSON.stringify({
        url: id,
        text: 'plain',
        summary: '',
        sensitive: false,
        language: null
      }),
      applicationName: null,
      applicationWebsite: null,
      reply: '',
      replyHash: null,
      createdAt: now,
      updatedAt: now
    })
    expect(row?.publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(
      parseInt(row!.publicId!.slice(0, 8) + row!.publicId!.slice(9, 13), 16)
    ).toBe(now)
    expect(status).toMatchObject({
      id,
      publicId: row?.publicId,
      isLocalActor: false,
      createdAt: now,
      updatedAt: now
    })
  })

  it("moves the local post total and bucket only for a local author, read from that author's row", async () => {
    // FIRST_ACTOR, the first row of `actors`, is local.
    const { remote } = await setup()
    const localPostsBefore = await counterValue(CounterKey.nodeinfoLocalPosts())
    await createNote(db, hydration, {
      id: `${remote}/statuses/1`,
      url: `${remote}/statuses/1`,
      actorId: remote,
      text: 'remote',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    expect(await counterValue(CounterKey.nodeinfoLocalPosts())).toBe(
      localPostsBefore
    )
    expect(await counterValue(bucketOf('local-statuses'))).toBeNull()
    expect(await counterValue(CounterKey.totalStatus(remote))).toBe(1)
    expect(await counterValue(bucketOf('statuses'))).toBe(1)
  })

  it("advances only its author's lastStatusAt, and never backwards", async () => {
    const { p, local } = await setup()
    const later = await seedActor(`${p}-later`, { lastStatusAt: now })
    const earlier = await seedActor(`${p}-earlier`, {
      lastStatusAt: now - 60_000
    })
    const create = (actorId: string, index: number, createdAt: number) =>
      createNote(db, hydration, {
        id: `${actorId}/statuses/${index}`,
        url: `${actorId}/statuses/${index}`,
        actorId,
        text: 'x',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt
      })

    // Backdated: an author with a newer lastStatusAt keeps it.
    await create(later, 1, now - 30_000)
    expect(await lastStatusAtOf(later)).toBe(now)
    // Newer than the stored one: it advances.
    await create(earlier, 1, now - 30_000)
    expect(await lastStatusAtOf(earlier)).toBe(now - 30_000)
    // No lastStatusAt yet: it is set; the other authors keep theirs.
    await create(local, 1, now - 45_000)
    expect(await lastStatusAtOf(local)).toBe(now - 45_000)
    expect(await lastStatusAtOf(later)).toBe(now)
    expect(await lastStatusAtOf(earlier)).toBe(now - 30_000)
    expect(await lastStatusAtOf(FIRST_ACTOR)).toBeNull()
  })

  it('does not advance lastStatusAt for a direct status, but counts it', async () => {
    const { local, remote } = await setup()
    await createNote(db, hydration, {
      id: `${local}/statuses/1`,
      url: `${local}/statuses/1`,
      actorId: local,
      text: 'dm',
      to: [remote],
      cc: []
    })
    expect(await lastStatusAtOf(local)).toBeNull()
    expect(await counterValue(CounterKey.totalStatus(local))).toBe(1)
    // An unlisted status is not direct.
    await createNote(db, hydration, {
      id: `${local}/statuses/2`,
      url: `${local}/statuses/2`,
      actorId: local,
      text: 'unlisted',
      to: [`${local}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    expect(await lastStatusAtOf(local)).toBe(now)
  })

  it('counts a public reply on its parent, found by id, else by url hash and url', async () => {
    const { local, remote } = await setup()
    const parentUrl = `https://${DOMAIN}/@remote/${local.length}`
    // Neighbours a lookup by url must pass over, written before the parent:
    // the parent's url hash with another url, and the parent's url with
    // another hash.
    const sameHash = await seedStatus({
      id: `${remote}/statuses/same-hash`,
      actorId: remote,
      url: `${parentUrl}?other`,
      urlHash: getHashFromString(parentUrl)
    })
    const sameUrl = await seedStatus({
      id: `${remote}/statuses/same-url`,
      actorId: remote,
      url: parentUrl,
      urlHash: getHashFromString(`${parentUrl}?other`)
    })
    const parent = await seedStatus({
      id: `${remote}/statuses/parent`,
      actorId: remote,
      url: parentUrl
    })

    await createNote(db, hydration, {
      id: `${local}/statuses/by-url`,
      url: `${local}/statuses/by-url`,
      actorId: local,
      text: 'reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: parentUrl
    })
    expect(await counterValue(CounterKey.totalReply(parent))).toBe(1)
    await createNote(db, hydration, {
      id: `${local}/statuses/by-id`,
      url: `${local}/statuses/by-id`,
      actorId: local,
      text: 'reply',
      to: [`${local}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC],
      reply: parent
    })
    expect(await counterValue(CounterKey.totalReply(parent))).toBe(2)
    expect(await statusRow(`${local}/statuses/by-id`)).toMatchObject({
      reply: parent,
      replyHash: getHashFromString(parent)
    })

    for (const neighbour of [sameHash, sameUrl, FIRST_STATUS]) {
      expect(await counterValue(CounterKey.totalReply(neighbour))).toBeNull()
    }
  })

  it('does not count a followers-only or direct reply, or a reply to an unknown status', async () => {
    const { local, remote } = await setup()
    const parent = await seedStatus({
      id: `${remote}/statuses/parent`,
      actorId: remote
    })
    await createNote(db, hydration, {
      id: `${local}/statuses/private`,
      url: `${local}/statuses/private`,
      actorId: local,
      text: 'reply',
      to: [`${local}/followers`],
      cc: [remote],
      reply: parent
    })
    await createNote(db, hydration, {
      id: `${local}/statuses/direct`,
      url: `${local}/statuses/direct`,
      actorId: local,
      text: 'reply',
      to: [remote],
      cc: [],
      reply: parent
    })
    expect(await counterValue(CounterKey.totalReply(parent))).toBeNull()

    const { statements } = await capture(() =>
      createNote(db, hydration, {
        id: `${local}/statuses/unknown`,
        url: `${local}/statuses/unknown`,
        actorId: local,
        text: 'reply',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        reply: `${remote}/statuses/missing`
      })
    )
    expect(
      await counterValue(CounterKey.totalReply(`${remote}/statuses/missing`))
    ).toBeNull()
    // It looks the parent up, finds none and counts no reply at all.
    const steps = transactionSteps(statements)
    expect(steps).toEqual(
      expect.arrayContaining([
        `parent by id ${remote}/statuses/missing`,
        `parent by url ${remote}/statuses/missing`
      ])
    )
    expect(
      steps.filter((step) => step.startsWith('count total-reply'))
    ).toEqual([])
    expect(await counterValue(CounterKey.totalStatus(local))).toBe(3)
  })

  it('runs its statements in one transaction, in order', async () => {
    const { local, remote } = await setup()
    const parent = await seedStatus({
      id: `${remote}/statuses/parent`,
      actorId: remote,
      url: `${remote}/@parent`
    })
    const id = `${local}/statuses/1`
    const { statements } = await capture(() =>
      createNote(db, hydration, {
        id,
        url: id,
        actorId: local,
        text: 'reply',
        to: [ACTIVITY_STREAM_PUBLIC, remote],
        cc: [`${local}/followers`],
        reply: `${remote}/@parent`
      })
    )
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'insert status',
      `count ${CounterKey.totalStatus(local)}`,
      `count ${CounterKey.serviceTotalStatuses()}`,
      `count ${bucketOf('statuses')}`,
      `bucket hour ${bucketOf('statuses')}`,
      `lastStatusAt ${local}`,
      `read account ${local}`,
      `count ${CounterKey.nodeinfoLocalPosts()}`,
      `count ${bucketOf('local-statuses')}`,
      `bucket hour ${bucketOf('local-statuses')}`,
      `parent by id ${remote}/@parent`,
      `parent by url ${remote}/@parent`,
      `count ${CounterKey.totalReply(parent)}`,
      `recipient to ${ACTIVITY_STREAM_PUBLIC}`,
      `recipient to ${remote}`,
      `recipient cc ${local}/followers`,
      'commit'
    ])
  })

  it('rolls back the status, its counters and its recipients when its last recipient fails', async () => {
    const { local, remote } = await setup()
    const parent = await seedStatus({
      id: `${remote}/statuses/parent`,
      actorId: remote
    })
    const id = `${local}/statuses/1`
    const drop = await failWrite(
      'recipients',
      ['insert'],
      `new."statusId" = ${quote(id)} and new."actorId" = ${quote(remote)}`
    )
    await expectRolledBack(drop, () =>
      createNoteWithResult(db, hydration, {
        id,
        url: id,
        actorId: local,
        text: 'reply',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${local}/followers`, remote],
        reply: parent
      })
    )
    // The failure is not a duplicate: nothing is hydrated.
    expect(hydrationCalls).toEqual([])
  })

  it('returns the stored status, writing nothing, when the id already exists', async () => {
    const { local, remote } = await setup()
    const id = `${local}/statuses/1`
    await createNote(db, hydration, {
      id,
      url: id,
      actorId: local,
      text: 'first delivery',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [remote]
    })
    const before = await dumpTables()
    hydrationCalls.length = 0

    const { result, statements } = await capture(() =>
      createNoteWithResult(db, hydration, {
        id,
        url: id,
        actorId: local,
        text: 'second delivery',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [remote, `${local}/followers`]
      })
    )

    expect(result.isNew).toBe(false)
    expect(result.status).toMatchObject({ id, text: 'first delivery' })
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: id, withReplies: false }]
    ])
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'insert status',
      'rollback'
    ])
    expect(await dumpTables()).toEqual(before)
  })

  it('rethrows a duplicate publicId of another status', async () => {
    const { local } = await setup()
    const publicId = '01890000-0000-7000-8000-0000000000aa'
    await createNote(db, hydration, {
      id: `${local}/statuses/1`,
      url: `${local}/statuses/1`,
      actorId: local,
      text: 'one',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      publicId
    })
    const before = await dumpTables()
    hydrationCalls.length = 0

    await expect(
      createNote(db, hydration, {
        id: `${local}/statuses/2`,
        url: `${local}/statuses/2`,
        actorId: local,
        text: 'two',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        publicId
      })
    ).rejects.toThrow(
      testDb.backend === 'pg'
        ? 'duplicate key value violates unique constraint "statuses_publicid_unique"'
        : 'UNIQUE constraint failed: statuses.publicId'
    )
    // It looked for a status with its own id, found none, and gave up.
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: `${local}/statuses/2`, withReplies: false }]
    ])
    expect(await dumpTables()).toEqual(before)
  })
})

describe('createPoll', () => {
  const setup = async () => {
    const p = nextPrefix()
    const local = await seedActor(`${p}-local`, { local: true })
    const remote = await seedActor(`${p}-remote`)
    return { local, remote }
  }

  it('writes the poll with its choices in order, and its counters', async () => {
    const { local, remote } = await setup()
    const id = `${local}/statuses/poll`
    const parent = await seedStatus({
      id: `${remote}/statuses/parent`,
      actorId: remote
    })
    const result = await createPollWithResult(db, hydration, {
      id,
      url: id,
      actorId: local,
      text: 'Which?',
      summary: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [remote],
      reply: parent,
      endAt: now + 3_600_000,
      choices: ['red', { title: 'green', totalVotes: 4 }, { title: 'blue' }],
      pollType: 'anyOf',
      hideTotals: true,
      language: 'en',
      createdAt: now - 1_000,
      publicId: '01890000-0000-7000-8000-000000000101'
    })

    expect(await statusRow(id)).toMatchObject({
      type: StatusType.enum.Poll,
      publicId: '01890000-0000-7000-8000-000000000101',
      content: JSON.stringify({
        url: id,
        text: 'Which?',
        summary: '',
        sensitive: false,
        language: 'en',
        endAt: now + 3_600_000,
        pollType: 'anyOf',
        hideTotals: true
      }),
      reply: parent,
      replyHash: getHashFromString(parent),
      createdAt: now - 1_000,
      updatedAt: now
    })
    expect(
      await db
        .selectFrom('poll_choices')
        .select(['title', 'totalVotes', 'createdAt', 'updatedAt'])
        .where('statusId', '=', id)
        .orderBy('choiceId')
        .execute()
    ).toEqual([
      { title: 'red', totalVotes: 0, createdAt: now, updatedAt: now },
      { title: 'green', totalVotes: 4, createdAt: now, updatedAt: now },
      { title: 'blue', totalVotes: 0, createdAt: now, updatedAt: now }
    ])
    expect(await recipientsOf(id)).toEqual([
      { actorId: remote, type: 'cc', createdAt: now, updatedAt: now },
      {
        actorId: ACTIVITY_STREAM_PUBLIC,
        type: 'to',
        createdAt: now,
        updatedAt: now
      }
    ])
    expect(await counterValue(CounterKey.totalStatus(local))).toBe(1)
    expect(await counterValue(bucketOf('statuses'))).toBe(1)
    expect(await counterValue(bucketOf('local-statuses'))).toBe(1)
    expect(await counterValue(CounterKey.totalReply(parent))).toBe(1)
    expect(await lastStatusAtOf(local)).toBe(now - 1_000)
    expect(await searchDocumentOf(id)).toMatchObject({
      entityId: id,
      documentText: expect.stringContaining('Which?'),
      entityCreatedAt: now - 1_000
    })
    expect(result.isNew).toBe(true)
    const { actor } = result.status as StatusPoll
    expect(actor).toMatchObject({ id: local, lastStatusAt: null })
    expect(result.status).toEqual(
      StatusPoll.parse({
        id,
        publicId: '01890000-0000-7000-8000-000000000101',
        url: id,
        actorId: local,
        actor,
        type: StatusType.enum.Poll,
        text: 'Which?',
        summary: '',
        sensitive: false,
        language: 'en',
        detectedLanguage: null,
        applicationName: null,
        applicationWebsite: null,
        reply: parent,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [remote],
        edits: [],
        attachments: [],
        tags: [],
        replies: [],
        choices: [],
        totalLikes: 0,
        reactions: [],
        isActorLiked: false,
        isActorBookmarked: false,
        actorAnnounceStatusId: null,
        endAt: now + 3_600_000,
        pollType: 'anyOf',
        hideTotals: true,
        isLocalActor: true,
        createdAt: now - 1_000,
        updatedAt: now
      })
    )
    expect(hydrationCalls).toEqual([])
  })

  it('runs its statements in one transaction, the choices before the recipients', async () => {
    const { remote } = await setup()
    const id = `${remote}/statuses/poll`
    const { statements } = await capture(() =>
      createPoll(db, hydration, {
        id,
        url: id,
        actorId: remote,
        text: 'Which?',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${remote}/followers`],
        endAt: now + 1,
        choices: ['b', 'a']
      })
    )
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'insert status',
      `count ${CounterKey.totalStatus(remote)}`,
      `count ${CounterKey.serviceTotalStatuses()}`,
      `count ${bucketOf('statuses')}`,
      `bucket hour ${bucketOf('statuses')}`,
      `lastStatusAt ${remote}`,
      `read account ${remote}`,
      'insert choice b',
      'insert choice a',
      `recipient to ${ACTIVITY_STREAM_PUBLIC}`,
      `recipient cc ${remote}/followers`,
      'commit'
    ])
  })

  it('rolls back the poll, its choices and its counters when its last recipient fails', async () => {
    const { local } = await setup()
    const id = `${local}/statuses/poll`
    const drop = await failWrite(
      'recipients',
      ['insert'],
      `new."statusId" = ${quote(id)} and new."type" = 'cc'`
    )
    await expectRolledBack(drop, () =>
      createPoll(db, hydration, {
        id,
        url: id,
        actorId: local,
        text: 'Which?',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${local}/followers`],
        endAt: now + 1,
        choices: ['a', 'b']
      })
    )
  })

  it('returns the stored poll, writing nothing, when the id already exists', async () => {
    const { local } = await setup()
    const id = `${local}/statuses/poll`
    await createPoll(db, hydration, {
      id,
      url: id,
      actorId: local,
      text: 'first',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      endAt: now + 1,
      choices: ['a', 'b']
    })
    const before = await dumpTables()
    hydrationCalls.length = 0

    const result = await createPollWithResult(db, hydration, {
      id,
      url: id,
      actorId: local,
      text: 'second',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      endAt: now + 1,
      choices: ['c']
    })
    expect(result.isNew).toBe(false)
    expect(result.status).toMatchObject({ id, text: 'first' })
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: id, withReplies: false }]
    ])
    expect(await dumpTables()).toEqual(before)
  })
})

describe('createAnnounce', () => {
  const setup = async () => {
    const p = nextPrefix()
    const local = await seedActor(`${p}-local`, { local: true })
    const remote = await seedActor(`${p}-remote`)
    const original = await seedStatus({
      id: `${remote}/statuses/original`,
      actorId: remote,
      content: noteContent(`${remote}/statuses/original`, 'boost me')
    })
    return { local, remote, original }
  }

  it('writes the boost and its counters, the reblog count of the original among them', async () => {
    const { local, remote, original } = await setup()
    const id = `${local}/statuses/boost`
    const status = await createAnnounce(db, hydration, {
      id,
      actorId: local,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [remote],
      originalStatusId: original,
      createdAt: now - 2_000,
      publicId: '01890000-0000-7000-8000-000000000201'
    })

    expect(await statusRow(id)).toEqual({
      id,
      publicId: '01890000-0000-7000-8000-000000000201',
      url: null,
      urlHash: null,
      actorId: local,
      type: StatusType.enum.Announce,
      content: original,
      applicationName: null,
      applicationWebsite: null,
      reply: '',
      replyHash: null,
      originalStatusId: original,
      createdAt: now - 2_000,
      updatedAt: now
    })
    expect(await recipientsOf(id)).toEqual([
      { actorId: remote, type: 'cc', createdAt: now, updatedAt: now },
      {
        actorId: ACTIVITY_STREAM_PUBLIC,
        type: 'to',
        createdAt: now,
        updatedAt: now
      }
    ])
    expect(await counterValue(CounterKey.totalReblog(original))).toBe(1)
    expect(await counterValue(CounterKey.totalStatus(local))).toBe(1)
    expect(await counterValue(bucketOf('statuses'))).toBe(1)
    expect(await counterValue(bucketOf('local-statuses'))).toBe(1)
    expect(await lastStatusAtOf(local)).toBe(now - 2_000)
    // A boost is not indexed for search.
    expect(await searchDocumentOf(id)).toBeUndefined()

    expect(status).toMatchObject({
      id,
      publicId: '01890000-0000-7000-8000-000000000201',
      actorId: local,
      actor: expect.objectContaining({ id: local, lastStatusAt: null }),
      type: StatusType.enum.Announce,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [remote],
      edits: [],
      originalStatus: expect.objectContaining({
        id: original,
        text: 'boost me'
      }),
      isLocalActor: true,
      // A boost reports when it was written.
      createdAt: now,
      updatedAt: now
    })
    // The original is read before the transaction and again after it.
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: original }],
      ['getStatus', { statusId: original }]
    ])
  })

  it('writes nothing for an original that does not exist', async () => {
    const { local, remote } = await setup()
    const before = await dumpTables()
    const { result, statements } = await capture(() =>
      createAnnounce(db, hydration, {
        id: `${local}/statuses/boost`,
        actorId: local,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: `${remote}/statuses/missing`
      })
    )
    expect(result).toBeNull()
    expect(statements.map(({ sql: text }) => text)).not.toContain('begin')
    expect(await dumpTables()).toEqual(before)
  })

  it('returns null, keeping the boost, when the original is gone by the time it is read back', async () => {
    const { local, original } = await setup()
    const id = `${local}/statuses/boost`
    let reads = 0
    const vanishing: StatusHydration = {
      ...hydration,
      // The original is there before the transaction and deleted by a
      // concurrent request before the read after it.
      getStatus: async (params) => {
        reads += 1
        return reads === 1 ? hydration.getStatus(params) : null
      }
    }
    expect(
      await createAnnounce(db, vanishing, {
        id,
        actorId: local,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: original
      })
    ).toBeNull()
    expect(reads).toBe(2)
    expect(await statusRow(id)).toMatchObject({
      id,
      originalStatusId: original
    })
    expect(await counterValue(CounterKey.totalReblog(original))).toBe(1)
  })

  it('runs its statements in one transaction, in order', async () => {
    const { remote, original } = await setup()
    const id = `${remote}/statuses/boost`
    const { statements } = await capture(() =>
      createAnnounce(db, hydration, {
        id,
        actorId: remote,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${remote}/followers`],
        originalStatusId: original
      })
    )
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'insert status',
      `count ${CounterKey.totalStatus(remote)}`,
      `count ${CounterKey.serviceTotalStatuses()}`,
      `count ${bucketOf('statuses')}`,
      `bucket hour ${bucketOf('statuses')}`,
      `lastStatusAt ${remote}`,
      `read account ${remote}`,
      `count ${CounterKey.totalReblog(original)}`,
      `recipient to ${ACTIVITY_STREAM_PUBLIC}`,
      `recipient cc ${remote}/followers`,
      'commit'
    ])
  })

  it('rolls back the boost and the reblog count when its last recipient fails', async () => {
    const { local, original } = await setup()
    const id = `${local}/statuses/boost`
    const drop = await failWrite(
      'recipients',
      ['insert'],
      `new."statusId" = ${quote(id)} and new."type" = 'cc'`
    )
    await expectRolledBack(drop, () =>
      createAnnounce(db, hydration, {
        id,
        actorId: local,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${local}/followers`],
        originalStatusId: original
      })
    )
  })

  it('returns the stored boost, writing nothing, when the id already exists', async () => {
    const { local, original } = await setup()
    const id = `${local}/statuses/boost`
    await createAnnounce(db, hydration, {
      id,
      actorId: local,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: original
    })
    const before = await dumpTables()
    hydrationCalls.length = 0

    const status = await createAnnounce(db, hydration, {
      id,
      actorId: local,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${local}/followers`],
      originalStatusId: original
    })
    expect(status).toMatchObject({ id, type: StatusType.enum.Announce })
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: original }],
      ['getStatus', { statusId: id, withReplies: false }]
    ])
    expect(await dumpTables()).toEqual(before)
  })
})

describe('updateNote', () => {
  const seedAttachment = async ({
    statusId,
    actorId,
    mediaId,
    mediaType = 'image/jpeg',
    name = '',
    createdAt = BASE
  }: {
    statusId: string
    actorId: string
    mediaId: string | null
    mediaType?: string
    name?: string
    createdAt?: number
  }) => {
    const id = randomUUID()
    await db
      .insertInto('attachments')
      .values({
        id,
        statusId,
        actorId,
        type: 'Document',
        mediaType,
        url: `https://${DOMAIN}/media/${mediaId ?? id}`,
        width: 100,
        height: 50,
        name,
        mediaId: mediaId === null ? null : Number(mediaId),
        blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
        focusX: 0.1,
        focusY: -0.2,
        thumbnailUrl: null,
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt)
      })
      .execute()
    return id
  }

  const attachmentsOf = (statusId: string) =>
    db
      .selectFrom('attachments')
      .selectAll()
      .where('statusId', '=', statusId)
      .orderBy('createdAt')
      .orderBy('mediaId')
      .execute()

  // The incoming form of a seeded attachment, as the edit form sends it.
  const incoming = (
    mediaId: string,
    changes: Partial<{
      name: string
      focus: { x: number; y: number } | null
    }> = {}
  ) => ({
    type: 'upload' as const,
    id: mediaId,
    mediaType: 'image/jpeg',
    url: `https://${DOMAIN}/media/${mediaId}`,
    width: 100,
    height: 50,
    name: changes.name ?? '',
    blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
    focus: changes.focus === undefined ? { x: 0.1, y: -0.2 } : changes.focus,
    thumbnailUrl: null
  })

  const setup = async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`, { local: true })
    const id = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      createdAt: BASE + 1_000,
      content: JSON.stringify({
        url: `${author}/statuses/1`,
        text: 'before',
        summary: 'old cw',
        sensitive: true,
        language: 'th'
      })
    })
    // A neighbour status that uses the same media as the edited one.
    const neighbour = await seedStatus({
      id: `${author}/statuses/2`,
      actorId: author
    })
    const neighbourAttachment = await seedAttachment({
      statusId: neighbour,
      actorId: author,
      mediaId: '9101'
    })
    const attachments = {
      changed: await seedAttachment({
        statusId: id,
        actorId: author,
        mediaId: '9101',
        createdAt: BASE + 1
      }),
      kept: await seedAttachment({
        statusId: id,
        actorId: author,
        mediaId: '9102',
        createdAt: BASE + 2
      }),
      removed: await seedAttachment({
        statusId: id,
        actorId: author,
        mediaId: '9103',
        createdAt: BASE + 3
      }),
      // Not replaceable: a fitness file, and an attachment with no media.
      fitness: await seedAttachment({
        statusId: id,
        actorId: author,
        mediaId: '9105',
        mediaType: 'application/gpx+xml',
        createdAt: BASE + 4
      }),
      noMedia: await seedAttachment({
        statusId: id,
        actorId: author,
        mediaId: null,
        createdAt: BASE + 5
      })
    }
    return { author, id, neighbour, neighbourAttachment, attachments }
  }

  it('refuses an attachment whose id is not a media row id, writing nothing', async () => {
    const { id } = await setup()
    const attachmentsBefore = await attachmentsOf(id)
    const rowBefore = await statusRow(id)
    const historyBefore = await historyOf(id)

    await expect(
      updateNote(db, hydration, {
        statusId: id,
        text: 'after',
        summary: 'new cw',
        attachments: [incoming('9102'), incoming('not-a-row-id')]
      })
    ).rejects.toThrow('Invalid media id')

    expect(await attachmentsOf(id)).toEqual(attachmentsBefore)
    expect(await statusRow(id)).toEqual(rowBefore)
    expect(await historyOf(id)).toEqual(historyBefore)
  })

  it('records the revision, rewrites the content and replaces, adds and refreshes the attachments', async () => {
    const { author, id, neighbour, attachments } = await setup()
    const previous = await testDb.database.getStatus({ statusId: id })
    const attachmentsBefore = await attachmentsOf(id)
    const neighbourBefore = await attachmentsOf(neighbour)
    const neighbourRowBefore = await statusRow(neighbour)

    const status = await updateNote(db, hydration, {
      statusId: id,
      text: 'after',
      summary: 'new cw',
      attachments: [
        incoming('9102'),
        incoming('9101', { name: 'alt text', focus: { x: 0.5, y: 0.5 } }),
        incoming('9104', { name: 'new one', focus: null })
      ]
    })

    expect(await historyOf(id)).toEqual([
      {
        data: {
          text: 'before',
          summary: 'old cw',
          sensitive: true,
          attachments: JSON.parse(
            JSON.stringify((previous as StatusNote).attachments)
          ),
          pollOptions: null
        },
        createdAt: BASE + 1_000,
        updatedAt: now
      }
    ])
    expect(await statusRow(id)).toMatchObject({
      url: id,
      urlHash: getHashFromString(id),
      content: JSON.stringify({
        url: id,
        text: 'after',
        summary: 'new cw',
        sensitive: true,
        language: 'th'
      }),
      createdAt: BASE + 1_000,
      updatedAt: now
    })

    const byId = (rows: Awaited<ReturnType<typeof attachmentsOf>>) =>
      Object.fromEntries(rows.map((row) => [row.id, row]))
    const before = byId(attachmentsBefore)
    const after = await attachmentsOf(id)
    const added = after.find((row) => String(row.mediaId) === '9104')
    expect(added).toEqual({
      id: expect.any(String),
      statusId: id,
      actorId: author,
      type: 'Document',
      mediaType: 'image/jpeg',
      url: `https://${DOMAIN}/media/9104`,
      width: 100,
      height: 50,
      name: 'new one',
      mediaId: 9104,
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
      focusX: null,
      focusY: null,
      thumbnailUrl: null,
      playbackType: null,
      createdAt: now,
      updatedAt: now
    })
    expect(byId(after)).toEqual({
      [attachments.changed]: {
        ...before[attachments.changed],
        name: 'alt text',
        focusX: 0.5,
        focusY: 0.5,
        updatedAt: now
      },
      // Unchanged rows are not rewritten.
      [attachments.kept]: before[attachments.kept],
      [attachments.fitness]: before[attachments.fitness],
      [attachments.noMedia]: before[attachments.noMedia],
      [added!.id]: added
    })
    // The other status, and its attachment of the same media, are untouched.
    expect(await attachmentsOf(neighbour)).toEqual(neighbourBefore)
    expect(await statusRow(neighbour)).toEqual(neighbourRowBefore)

    expect(await searchDocumentOf(id)).toMatchObject({
      documentText: expect.stringContaining('after'),
      entityCreatedAt: BASE + 1_000
    })
    // Read before the transaction and again after it.
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: id }],
      ['getStatus', { statusId: id }]
    ])
    expect(status).toMatchObject({ id, text: 'after', summary: 'new cw' })
  })

  it('keeps the flags it is not given and the attachments when none are given', async () => {
    const { id } = await setup()
    const attachmentsBefore = await attachmentsOf(id)
    const { statements } = await capture(() =>
      updateNote(db, hydration, {
        statusId: id,
        text: 'after',
        summary: '',
        sensitive: false
      })
    )
    expect(JSON.parse((await statusRow(id))!.content!)).toEqual({
      url: id,
      text: 'after',
      summary: '',
      sensitive: false,
      language: 'th'
    })
    expect(await attachmentsOf(id)).toEqual(attachmentsBefore)
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'insert history',
      'update status',
      'commit'
    ])
  })

  it('deletes no attachment when the edit keeps every replaceable one', async () => {
    const { id } = await setup()
    const attachmentsBefore = await attachmentsOf(id)
    const { statements } = await capture(() =>
      updateNote(db, hydration, {
        statusId: id,
        text: 'after',
        summary: '',
        attachments: [incoming('9101'), incoming('9102'), incoming('9103')]
      })
    )
    expect(await attachmentsOf(id)).toEqual(attachmentsBefore)
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'insert history',
      'update status',
      'commit'
    ])
  })

  it('runs its statements in one transaction, in order', async () => {
    const { id } = await setup()
    const { statements } = await capture(() =>
      updateNote(db, hydration, {
        statusId: id,
        text: 'after',
        summary: '',
        attachments: [
          incoming('9102'),
          incoming('9101', { name: 'alt text' }),
          incoming('9104'),
          incoming('9106')
        ]
      })
    )
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'insert history',
      'update status',
      'delete attachments',
      'insert attachment',
      'insert attachment',
      'update attachment 9101',
      'commit'
    ])
    const added = (await attachmentsOf(id)).filter((row) =>
      ['9104', '9106'].includes(String(row.mediaId))
    )
    // Each new row is a millisecond after the one before it.
    expect(
      added.map((row) => [String(row.mediaId), row.createdAt, row.updatedAt])
    ).toEqual([
      ['9104', now, now],
      ['9106', now + 1, now + 1]
    ])
  })

  it("never deletes another actor's attachment on the status", async () => {
    const { id, attachments } = await setup()
    const other = await seedActor(`${nextPrefix()}-other`)
    const foreign = await seedAttachment({
      statusId: id,
      actorId: other,
      mediaId: '9107'
    })
    await updateNote(db, hydration, {
      statusId: id,
      text: 'after',
      summary: '',
      attachments: [incoming('9101'), incoming('9102')]
    })
    const remaining = (await attachmentsOf(id)).map((row) => row.id)
    expect(remaining).toContain(foreign)
    expect(remaining).not.toContain(attachments.removed)
  })

  it('rolls back the revision, the content and the attachments when its last write fails', async () => {
    const { id, attachments } = await setup()
    const drop = await failWrite(
      'attachments',
      ['update'],
      `new."id" = ${quote(attachments.changed)}`
    )
    await expectRolledBack(drop, () =>
      updateNote(db, hydration, {
        statusId: id,
        text: 'after',
        summary: '',
        attachments: [
          incoming('9102'),
          incoming('9101', { name: 'alt text' }),
          incoming('9104')
        ]
      })
    )
    // Hydrated before the transaction only.
    expect(hydrationCalls).toEqual([['getStatus', { statusId: id }]])
  })

  it('writes nothing for a status that is missing or not a note', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const poll = await seedPoll(`${author}/statuses/poll`, author, ['a', 'b'])
    const before = await dumpTables()
    for (const statusId of [poll, `${author}/statuses/missing`]) {
      const { result, statements } = await capture(() =>
        updateNote(db, hydration, { statusId, text: 'x', summary: '' })
      )
      expect(result).toBeNull()
      expect(statements.map(({ sql: text }) => text)).not.toContain(
        'insert into "status_history"'
      )
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('does not put back a marker a concurrent visibility change cleared', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = `${author}/statuses/1`
    await seedStatus({
      id,
      actorId: author,
      to: [],
      cc: [],
      content: JSON.stringify({
        url: id,
        text: 'ride',
        summary: '',
        sensitive: false,
        language: null,
        createdWhileMoved: true
      })
    })
    // The visibility change commits after updateNote's hydrated read: the
    // row no longer carries the marker, but the read that raced it still
    // does. Only that first read is doctored — the re-read updateNote
    // returns must see the row as it is.
    await db
      .updateTable('statuses')
      .set({
        content: JSON.stringify({
          url: id,
          text: 'ride',
          summary: '',
          sensitive: false,
          language: null
        })
      })
      .where('id', '=', id)
      .execute()
    let reads = 0
    const racedHydration: StatusHydration = {
      ...hydration,
      getStatus: (params) => {
        reads += 1
        return reads === 1
          ? hydration
              .getStatus(params)
              .then((status) =>
                status ? { ...status, createdWhileMoved: true } : status
              )
          : hydration.getStatus(params)
      }
    }
    const status = await updateNote(db, racedHydration, {
      statusId: id,
      text: 'after',
      summary: ''
    })
    expect(
      getCompatibleJSON(
        (
          await db
            .selectFrom('statuses')
            .select('content')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).content
      )
    ).toEqual({
      url: id,
      text: 'after',
      summary: '',
      sensitive: false,
      language: null
    })
    expect(status).not.toHaveProperty('createdWhileMoved')
  })

  it('locks the status row before writing an edit of a marked status', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = `${author}/statuses/1`
    await seedStatus({
      id,
      actorId: author,
      to: [],
      cc: [],
      content: JSON.stringify({
        url: id,
        text: 'ride',
        summary: '',
        sensitive: false,
        language: null,
        createdWhileMoved: true
      })
    })
    const { statements } = await capture(() =>
      updateNote(db, hydration, { statusId: id, text: 'after', summary: '' })
    )
    // The in-transaction re-read that keeps the marker honest is a row lock:
    // it waits for a concurrent visibility change on PostgreSQL. SQLite has
    // no row locks, so the same statement reads without one.
    const lock = statusRowLock(statements)
    expect(lock?.sql.endsWith(' for update')).toBe(testDb.backend === 'pg')
  })
})

describe('updateNoteVisibility', () => {
  const FOLLOWERS_ONLY = (actorId: string) => ({
    to: [`${actorId}/followers`],
    cc: []
  })

  const seedTag = async (
    statusId: string,
    name: string,
    type: 'hashtag' | 'mention' = 'hashtag'
  ) =>
    db
      .insertInto('tags')
      .values({
        id: randomUUID(),
        statusId,
        type,
        name,
        nameNormalized: type === 'hashtag' ? name.toLowerCase() : null,
        value: '',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()

  const seedHistory = (statusId: string) =>
    db
      .insertInto('status_history')
      .values({
        statusId,
        data: JSON.stringify({ text: 'older' }),
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()

  const seedTimeline = (statusId: string, actorId: string) =>
    db
      .insertInto('timelines')
      .values({
        actorId,
        timeline: 'main',
        statusId,
        statusActorId: actorId,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()

  const setCounter = (id: string, value: number) =>
    db
      .insertInto('counters')
      .values({
        id,
        value,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()

  const setup = async (tags: string[] = ['#Cats', '#dogs']) => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const reader = await seedActor(`${p}-reader`)
    const parent = await seedStatus({
      id: `${reader}/statuses/parent`,
      actorId: reader
    })
    const id = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      reply: parent,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${author}/followers`]
    })
    for (const tag of tags) await seedTag(id, `${tag}${p}`)
    // A mention is not a hashtag: its name has no counter.
    await seedTag(id, `@${p}mention`, 'mention')
    await seedHistory(id)
    await seedTimeline(id, reader)
    // A neighbour reply with its own hashtag, revisions, timeline rows and
    // recipients.
    const neighbour = await seedStatus({
      id: `${author}/statuses/2`,
      actorId: author,
      reply: parent
    })
    await seedTag(neighbour, `#neighbour${p}`)
    await seedHistory(neighbour)
    await seedTimeline(neighbour, reader)
    await setCounter(CounterKey.totalReply(parent), 5)
    const hashtagKeys = tags.map((tag) =>
      CounterKey.totalHashtag(`${tag.slice(1)}${p}`)
    )
    for (const [index, key] of hashtagKeys.entries()) {
      await setCounter(key, 3 + index)
    }
    await setCounter(CounterKey.totalHashtag(`neighbour${p}`), 7)
    await indexHashtagSearchDocuments(db, {
      hashtags: tags.map((tag) => `${tag}${p}`)
    })
    return { p, author, reader, parent, id, neighbour, hashtagKeys }
  }

  const otherRows = async (statusId: string) => ({
    recipients: await recipientsOf(statusId),
    history: await historyOf(statusId),
    timelines: await db
      .selectFrom('timelines')
      .selectAll()
      .where('statusId', '=', statusId)
      .execute()
  })

  it('narrowing keeps the revisions, replaces the audience, drops the timelines and takes back the public counts', async () => {
    const { p, author, parent, id, neighbour, hashtagKeys } = await setup()
    const neighbourBefore = await otherRows(neighbour)
    const historyBefore = await historyOf(id)
    expect(
      await db
        .selectFrom('search_documents')
        .select(['entityId', 'postCount'])
        .where('entityType', '=', 'hashtag')
        .where('entityId', 'in', [`cats${p}`, `dogs${p}`])
        .orderBy('entityId')
        .execute()
    ).toEqual([
      { entityId: `cats${p}`, postCount: 1 },
      { entityId: `dogs${p}`, postCount: 1 }
    ])

    // Nobody is added, so the revisions stay.
    const status = await updateNoteVisibility(db, hydration, {
      statusId: id,
      to: [],
      cc: [`${author}/followers`]
    })

    expect(await historyOf(id)).toEqual(historyBefore)
    expect(await recipientsOf(id)).toEqual([
      {
        actorId: `${author}/followers`,
        type: 'cc',
        createdAt: now,
        updatedAt: now
      }
    ])
    expect(
      await db
        .selectFrom('timelines')
        .select('id')
        .where('statusId', '=', id)
        .execute()
    ).toEqual([])
    expect(await counterValue(CounterKey.totalReply(parent))).toBe(4)
    expect(
      await Promise.all(hashtagKeys.map((key) => counterValue(key)))
    ).toEqual([2, 3])
    expect(
      await counterValue(CounterKey.totalHashtag(`@${p}mention`))
    ).toBeNull()
    expect(await counterValue(CounterKey.totalHashtag(`neighbour${p}`))).toBe(7)
    expect(await otherRows(neighbour)).toEqual(neighbourBefore)

    // The status and its hashtags are reindexed: the hashtags now count no
    // public status, so their documents are gone.
    expect(await searchDocumentOf(id)).toMatchObject({ entityId: id })
    expect(
      await db
        .selectFrom('search_documents')
        .select(['entityId', 'postCount'])
        .where('entityType', '=', 'hashtag')
        .where('entityId', 'in', [`cats${p}`, `dogs${p}`])
        .orderBy('entityId')
        .execute()
    ).toEqual([])
    expect(hydrationCalls).toEqual([
      ['getStatus', { statusId: id }],
      ['getStatus', { statusId: id }]
    ])
    expect(status).toMatchObject({ id, to: [], cc: [`${author}/followers`] })
  })

  it('widening drops the revisions and gives the public counts back', async () => {
    const { p, author, parent, id, neighbour, hashtagKeys } = await setup()
    await updateNoteVisibility(db, hydration, {
      statusId: id,
      ...FOLLOWERS_ONLY(author)
    })
    expect(await historyOf(id)).toHaveLength(1)
    const neighbourBefore = await otherRows(neighbour)

    await updateNoteVisibility(db, hydration, {
      statusId: id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${author}/followers`]
    })
    expect(await historyOf(id)).toEqual([])
    expect(await counterValue(CounterKey.totalReply(parent))).toBe(5)
    expect(
      await Promise.all(hashtagKeys.map((key) => counterValue(key)))
    ).toEqual([3, 4])
    expect(await otherRows(neighbour)).toEqual(neighbourBefore)
    expect(
      await db
        .selectFrom('search_documents')
        .select(['entityId', 'postCount'])
        .where('entityType', '=', 'hashtag')
        .where('entityId', 'in', [`cats${p}`, `dogs${p}`])
        .orderBy('entityId')
        .execute()
    ).toEqual([
      { entityId: `cats${p}`, postCount: 1 },
      { entityId: `dogs${p}`, postCount: 1 }
    ])
  })

  it('moves no count when the status stays publicly addressed, and keeps the revisions when nobody is added', async () => {
    const { author, parent, id, hashtagKeys } = await setup()
    const { statements } = await capture(() =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        to: [`${author}/followers`],
        cc: [ACTIVITY_STREAM_PUBLIC]
      })
    )
    expect(await historyOf(id)).toHaveLength(1)
    expect(await counterValue(CounterKey.totalReply(parent))).toBe(5)
    expect(
      await Promise.all(hashtagKeys.map((key) => counterValue(key)))
    ).toEqual([3, 4])
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'delete recipients',
      'delete timelines',
      `recipient to ${author}/followers`,
      `recipient cc ${ACTIVITY_STREAM_PUBLIC}`,
      'read hashtags',
      'commit'
    ])
  })

  it('looks up no parent for a status that is no reply when it crosses the public line', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      cc: [`${author}/followers`]
    })
    await seedTag(id, `#Solo${p}`)
    const key = CounterKey.totalHashtag(`solo${p}`)
    await setCounter(key, 2)
    const { statements } = await capture(() =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        ...FOLLOWERS_ONLY(author)
      })
    )
    expect(await counterValue(key)).toBe(1)
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'delete recipients',
      'delete timelines',
      `recipient to ${author}/followers`,
      'read hashtags',
      `count ${key}`,
      'commit'
    ])
  })

  it('runs its statements in one transaction, in order', async () => {
    const { author, reader, parent, id, hashtagKeys } = await setup(['#Cats'])
    // Narrowing, then widening.
    const narrowing = await capture(() =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        ...FOLLOWERS_ONLY(author)
      })
    )
    expect(transactionSteps(narrowing.statements)).toEqual([
      'begin',
      'delete recipients',
      'delete timelines',
      `recipient to ${author}/followers`,
      'read hashtags',
      `parent by id ${parent}`,
      `count ${CounterKey.totalReply(parent)}`,
      `count ${hashtagKeys[0]}`,
      'commit'
    ])
    const widening = await capture(() =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [reader]
      })
    )
    expect(transactionSteps(widening.statements)).toEqual([
      'begin',
      'delete history',
      'delete recipients',
      'delete timelines',
      `recipient to ${ACTIVITY_STREAM_PUBLIC}`,
      `recipient cc ${reader}`,
      'read hashtags',
      `parent by id ${parent}`,
      `count ${CounterKey.totalReply(parent)}`,
      `count ${hashtagKeys[0]}`,
      'commit'
    ])
  })

  it('rolls back the audience, the revisions and the counts when its last count fails', async () => {
    const { author, id, hashtagKeys } = await setup(['#Cats'])
    await updateNoteVisibility(db, hydration, {
      statusId: id,
      ...FOLLOWERS_ONLY(author)
    })
    hydrationCalls.length = 0
    const drop = await failWrite(
      'counters',
      ['insert', 'update'],
      `new."id" = ${quote(hashtagKeys[0])}`
    )
    await expectRolledBack(drop, () =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
    )
    expect(hydrationCalls).toEqual([['getStatus', { statusId: id }]])
  })

  it('writes nothing for a status that is missing or not a note', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const poll = await seedPoll(`${author}/statuses/poll`, author, ['a'])
    const before = await dumpTables()
    for (const statusId of [poll, `${author}/statuses/missing`]) {
      await expect(
        updateNoteVisibility(db, hydration, {
          statusId,
          ...FOLLOWERS_ONLY(author)
        })
      ).resolves.toBeNull()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('drops the moved-time marker from the content, keeping every other field', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = `${author}/statuses/1`
    await seedStatus({
      id,
      actorId: author,
      to: [],
      cc: [],
      content: JSON.stringify({
        url: id,
        text: 'ride',
        summary: 'spoiler',
        sensitive: true,
        language: 'de',
        createdWhileMoved: true
      })
    })

    // The owner picked a new audience (followers), so the status is an
    // ordinary post now.
    const status = await updateNoteVisibility(db, hydration, {
      statusId: id,
      ...FOLLOWERS_ONLY(author)
    })
    expect(status).not.toHaveProperty('createdWhileMoved')
    expect(
      getCompatibleJSON(
        (
          await db
            .selectFrom('statuses')
            .select('content')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).content
      )
    ).toEqual({
      url: id,
      text: 'ride',
      summary: 'spoiler',
      sensitive: true,
      language: 'de'
    })
  })

  it('clears the marker when a duplicated mention is replaced by a new one', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = `${author}/statuses/1`
    const mention = (name: string) => actorIn(`${p}-${name}`)
    await seedStatus({
      id,
      actorId: author,
      to: [],
      // A private note's cc keeps the mention hrefs as written, duplicates
      // included, so [alice, alice] and [alice, bob] are different
      // audiences even though both lists have two entries.
      cc: [mention('alice'), mention('alice')],
      content: JSON.stringify({
        url: id,
        text: 'ride',
        summary: '',
        sensitive: false,
        language: null,
        createdWhileMoved: true
      })
    })
    const status = await updateNoteVisibility(db, hydration, {
      statusId: id,
      to: [],
      cc: [mention('alice'), mention('bob')]
    })
    expect(status).not.toHaveProperty('createdWhileMoved')
    expect(
      getCompatibleJSON(
        (
          await db
            .selectFrom('statuses')
            .select('content')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).content
      )
    ).toEqual({
      url: id,
      text: 'ride',
      summary: '',
      sensitive: false,
      language: null
    })
  })

  it('writes no content update for a status without the marker', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      to: [],
      cc: []
    })
    const { statements } = await capture(() =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        ...FOLLOWERS_ONLY(author)
      })
    )
    // An audience change on an unmarked status rewrites the recipients but
    // never the content: there is no marker to clear.
    expect(statements.map(describeStatement)).not.toContain('update status')
    expect(
      (
        await db
          .selectFrom('statuses')
          .select('content')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).content
    ).toBe(noteContent(id))
  })

  it('keeps the marker when the resent visibility is the current one', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = `${author}/statuses/1`
    const content = JSON.stringify({
      url: id,
      text: 'ride',
      summary: '',
      sensitive: false,
      language: null,
      createdWhileMoved: true
    })
    await seedStatus({ id, actorId: author, to: [], cc: [], content })
    const { result: status, statements } = await capture(() =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        to: [],
        cc: []
      })
    )
    // A hidden status reads back as `direct`, so a client reusing its draft
    // settings on a text edit resends to: [], cc: [] — the status's current
    // audience. That is not a visibility change: the marker stays and no
    // content write runs.
    expect(statements.map(describeStatement)).not.toContain('update status')
    expect((status as StatusNote | null)?.createdWhileMoved).toBe(true)
    expect(
      (
        await db
          .selectFrom('statuses')
          .select('content')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).content
    ).toBe(content)
  })

  it('locks the status row before clearing the marker', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = `${author}/statuses/1`
    await seedStatus({
      id,
      actorId: author,
      to: [],
      cc: [],
      content: JSON.stringify({
        url: id,
        text: 'ride',
        summary: '',
        sensitive: false,
        language: null,
        createdWhileMoved: true
      })
    })
    const { statements } = await capture(() =>
      updateNoteVisibility(db, hydration, {
        statusId: id,
        ...FOLLOWERS_ONLY(author)
      })
    )
    // The marker clear reads the row before the audience is rewritten, so a
    // concurrent edit is waited for on PostgreSQL. SQLite has no row locks,
    // so the same statement reads without one.
    const lock = statusRowLock(statements)
    expect(lock?.sql.endsWith(' for update')).toBe(testDb.backend === 'pg')
  })
})

describe('updatePoll', () => {
  const seedVote = async (
    statusId: string,
    actorId: string,
    choice: number
  ) => {
    await db
      .insertInto('poll_voters')
      .values({
        statusId,
        actorId,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .onConflict((conflict) =>
        conflict.columns(['statusId', 'actorId']).doNothing()
      )
      .execute()
    await db
      .insertInto('poll_answers')
      .values({
        statusId,
        actorId,
        choice,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
  }

  const votesOf = async (statusId: string) => ({
    voters: (
      await db
        .selectFrom('poll_voters')
        .select('actorId')
        .where('statusId', '=', statusId)
        .execute()
    )
      .map((row) => row.actorId)
      .sort(),
    answers: (
      await db
        .selectFrom('poll_answers')
        .select(['actorId', 'choice'])
        .where('statusId', '=', statusId)
        .execute()
    )
      .map((row) => `${row.actorId} ${row.choice}`)
      .sort()
  })

  const setup = async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const voter = await seedActor(`${p}-voter`)
    // The neighbour poll comes first and shares a choice title.
    const neighbour = await seedPoll(
      `${author}/statuses/neighbour`,
      author,
      ['red', 'blue'],
      [7, 1]
    )
    const id = await seedPoll(
      `${author}/statuses/poll`,
      author,
      ['red', 'green', 'blue'],
      [3, 5, 0]
    )
    await seedVote(id, voter, 0)
    await seedVote(neighbour, voter, 1)
    await db
      .updateTable('statuses')
      .set({ createdAt: new Date(BASE + 9_000) })
      .where('id', '=', id)
      .execute()
    return { author, voter, neighbour, id }
  }

  const neighbourRows = async (neighbour: string) => ({
    status: await statusRow(neighbour),
    choices: await choicesOf(neighbour),
    votes: await votesOf(neighbour),
    history: await historyOf(neighbour)
  })

  it('refreshes the tallies only, with no revision, when nothing a reader sees changed', async () => {
    const { id, neighbour } = await setup()
    const statusBefore = await statusRow(id)
    const neighbourBefore = await neighbourRows(neighbour)

    const { result, statements } = await capture(() =>
      updatePoll(db, hydration, {
        statusId: id,
        text: `poll ${id}`,
        // A blank summary is the same as the stored empty one.
        summary: ' ',
        choices: [
          { title: 'red', totalVotes: 4 },
          { title: 'green', totalVotes: 6 },
          { title: 'blue', totalVotes: 1 }
        ]
      })
    )

    expect(await historyOf(id)).toEqual([])
    expect(await statusRow(id)).toEqual(statusBefore)
    expect(
      await db
        .selectFrom('poll_choices')
        .select(['title', 'totalVotes', 'updatedAt'])
        .where('statusId', '=', id)
        .orderBy('choiceId')
        .execute()
    ).toEqual([
      { title: 'red', totalVotes: 4, updatedAt: now },
      { title: 'green', totalVotes: 6, updatedAt: now },
      { title: 'blue', totalVotes: 1, updatedAt: now }
    ])
    expect(await neighbourRows(neighbour)).toEqual(neighbourBefore)
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'tally red',
      'tally green',
      'tally blue',
      'commit'
    ])
    expect(hydrationCalls).toEqual([['getStatus', { statusId: id }]])
    expect(result).toMatchObject({ id, type: StatusType.enum.Poll })
  })

  it('records a revision with the previous options when the content changes', async () => {
    const { id, neighbour } = await setup()
    const neighbourBefore = await neighbourRows(neighbour)

    const { statements } = await capture(() =>
      updatePoll(db, hydration, {
        statusId: id,
        text: 'new question',
        sensitive: true,
        choices: [{ title: 'green', totalVotes: 9 }]
      })
    )

    expect(await historyOf(id)).toEqual([
      {
        data: {
          text: `poll ${id}`,
          summary: '',
          sensitive: false,
          attachments: [],
          pollOptions: ['red', 'green', 'blue']
        },
        createdAt: BASE + 9_000,
        updatedAt: now
      }
    ])
    expect(await statusRow(id)).toMatchObject({
      url: id,
      urlHash: getHashFromString(id),
      content: JSON.stringify({
        url: id,
        text: 'new question',
        summary: '',
        sensitive: true,
        language: null,
        endAt: BASE + 86_400_000,
        pollType: 'oneOf',
        hideTotals: false
      }),
      updatedAt: now
    })
    expect(await choicesOf(id)).toEqual([
      { title: 'red', totalVotes: 3 },
      { title: 'green', totalVotes: 9 },
      { title: 'blue', totalVotes: 0 }
    ])
    expect(await neighbourRows(neighbour)).toEqual(neighbourBefore)
    expect(await searchDocumentOf(id)).toMatchObject({
      documentText: expect.stringContaining('new question'),
      entityCreatedAt: BASE + 9_000
    })
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'read choice titles',
      'insert history',
      'update status',
      'tally green',
      'commit'
    ])
  })

  it('records a revision for a reset that changes nothing else', async () => {
    const { id } = await setup()
    const { statements } = await capture(() =>
      updatePoll(db, hydration, {
        statusId: id,
        text: `poll ${id}`,
        choices: [{ title: 'yes', totalVotes: 3 }],
        resetVotes: true
      })
    )
    expect(await historyOf(id)).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          pollOptions: ['red', 'green', 'blue']
        })
      })
    ])
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'read choice titles',
      'insert history',
      'update status',
      'delete answers',
      'delete voters',
      'delete choices',
      'insert choice yes',
      'commit'
    ])
  })

  it('resets the votes and replaces the options of that poll only', async () => {
    const { id, neighbour } = await setup()
    const neighbourBefore = await neighbourRows(neighbour)

    const { statements } = await capture(() =>
      updatePoll(db, hydration, {
        statusId: id,
        text: `poll ${id}`,
        choices: [
          { title: 'yes', totalVotes: 4 },
          { title: 'no', totalVotes: 2 }
        ],
        pollType: 'anyOf',
        resetVotes: true
      })
    )

    expect(await historyOf(id)).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          pollOptions: ['red', 'green', 'blue']
        })
      })
    ])
    expect(
      await db
        .selectFrom('poll_choices')
        .select(['title', 'totalVotes', 'createdAt', 'updatedAt'])
        .where('statusId', '=', id)
        .orderBy('choiceId')
        .execute()
    ).toEqual([
      { title: 'yes', totalVotes: 0, createdAt: now, updatedAt: now },
      { title: 'no', totalVotes: 0, createdAt: now, updatedAt: now }
    ])
    expect(await votesOf(id)).toEqual({ voters: [], answers: [] })
    expect(await neighbourRows(neighbour)).toEqual(neighbourBefore)
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'read choice titles',
      'insert history',
      'update status',
      'delete answers',
      'delete voters',
      'delete choices',
      'insert choice yes',
      'insert choice no',
      'commit'
    ])
  })

  it('rolls back the revision, the content and the tallies when its last tally fails', async () => {
    const { id } = await setup()
    const drop = await failWrite(
      'poll_choices',
      ['update'],
      `new."statusId" = ${quote(id)} and new."title" = 'blue'`
    )
    await expectRolledBack(drop, () =>
      updatePoll(db, hydration, {
        statusId: id,
        text: 'new question',
        choices: [
          { title: 'red', totalVotes: 4 },
          { title: 'blue', totalVotes: 1 }
        ]
      })
    )
  })

  it('rolls back the reset when its last new option fails', async () => {
    const { id } = await setup()
    const drop = await failWrite(
      'poll_choices',
      ['insert'],
      `new."statusId" = ${quote(id)} and new."title" = 'no'`
    )
    await expectRolledBack(drop, () =>
      updatePoll(db, hydration, {
        statusId: id,
        text: `poll ${id}`,
        choices: [
          { title: 'yes', totalVotes: 0 },
          { title: 'no', totalVotes: 0 }
        ],
        resetVotes: true
      })
    )
    expect(hydrationCalls).toEqual([])
  })

  it('dates the revision and the search document of an undated poll at the epoch', async () => {
    const { id } = await setup()
    await db
      .updateTable('statuses')
      .set({ createdAt: null })
      .where('id', '=', id)
      .execute()
    // The edit commits; reading the undated poll back then fails in the
    // hydration, as it did before.
    await expect(
      updatePoll(db, hydration, {
        statusId: id,
        text: 'new question',
        choices: []
      })
    ).rejects.toThrow("Cannot read properties of null (reading 'getTime')")
    expect(await historyOf(id)).toEqual([
      expect.objectContaining({ createdAt: 0, updatedAt: now })
    ])
    expect(await searchDocumentOf(id)).toMatchObject({ entityCreatedAt: 0 })
  })

  it('writes nothing for a missing status', async () => {
    const before = await dumpTables()
    await expect(
      updatePoll(db, hydration, {
        statusId: `${actorIn('nobody')}/statuses/missing`,
        text: 'x',
        choices: [{ title: 'a', totalVotes: 1 }]
      })
    ).resolves.toBeNull()
    expect(await dumpTables()).toEqual(before)
    expect(hydrationCalls).toEqual([])
  })
})

describe('appendStatusHistory', () => {
  const revision = ({
    text,
    supersededAt,
    summary = null,
    sensitive = false,
    attachments = [],
    pollOptions = null
  }: {
    text: string
    supersededAt: number
    summary?: string | null
    sensitive?: boolean | null
    attachments?: Attachment[] | null
    pollOptions?: string[] | null
  }) => ({
    text,
    summary,
    sensitive,
    attachments,
    pollOptions,
    supersededAt
  })

  const setup = async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`, { local: true })
    const id = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      createdAt: BASE + 1_000,
      content: JSON.stringify({
        url: `${author}/statuses/1`,
        text: 'current',
        summary: '',
        sensitive: false,
        language: null
      })
    })
    return { author, id }
  }

  it('writes the revisions in supersededAt order with the archived times and bumps updatedAt to the newest', async () => {
    const { id } = await setup()
    const rowBefore = await statusRow(id)

    // An empty replay writes nothing at all.
    await appendStatusHistory(db, { statusId: id, revisions: [] })
    expect(await historyOf(id)).toEqual([])
    expect(await statusRow(id)).toEqual(rowBefore)

    // Out of order: the oldest revision is passed last.
    await appendStatusHistory(db, {
      statusId: id,
      revisions: [
        revision({ text: 'third', supersededAt: BASE + 9_000 }),
        revision({
          text: 'first',
          summary: 'cw',
          sensitive: true,
          supersededAt: BASE + 3_000
        }),
        revision({ text: 'second', supersededAt: BASE + 5_000 })
      ]
    })

    const rows = await historyOf(id)
    expect(rows).toEqual([
      {
        data: {
          text: 'first',
          summary: 'cw',
          sensitive: true,
          attachments: [],
          pollOptions: null
        },
        createdAt: BASE + 3_000,
        updatedAt: BASE + 3_000
      },
      {
        data: {
          text: 'second',
          summary: null,
          sensitive: false,
          attachments: [],
          pollOptions: null
        },
        createdAt: BASE + 5_000,
        updatedAt: BASE + 5_000
      },
      {
        data: {
          text: 'third',
          summary: null,
          sensitive: false,
          attachments: [],
          pollOptions: null
        },
        createdAt: BASE + 9_000,
        updatedAt: BASE + 9_000
      }
    ])
    // The reader reports the archived supersede times, oldest first.
    expect(
      (await testDb.database.getStatusEditHistory({ statusId: id })).map(
        (row) => row.supersededAt
      )
    ).toEqual([BASE + 3_000, BASE + 5_000, BASE + 9_000])
    // The newest supersede time becomes the status's edited_at; nothing else
    // on the row moved, and no search document was written.
    const rowAfter = await statusRow(id)
    expect(rowAfter).toMatchObject({ updatedAt: BASE + 9_000 })
    const { updatedAt: _after, ...restAfter } = rowAfter ?? {}
    const { updatedAt: _before, ...restBefore } = rowBefore ?? {}
    expect(restAfter).toEqual(restBefore)
    expect(await searchDocumentOf(id)).toBeUndefined()
    expect(hydrationCalls).toEqual([])
  })

  it('stores the same previousData shape as a real updateNote revision', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`, { local: true })
    const content = JSON.stringify({
      url: `${author}/statuses/shared`,
      text: 'before',
      summary: 'old cw',
      sensitive: true,
      language: 'th'
    })
    const edited = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      createdAt: BASE + 1_000,
      content
    })
    const appended = await seedStatus({
      id: `${author}/statuses/2`,
      actorId: author,
      createdAt: BASE + 1_000,
      content
    })
    const seedAttachment = async (statusId: string) => {
      const id = randomUUID()
      await db
        .insertInto('attachments')
        .values({
          id,
          statusId,
          actorId: author,
          type: 'Document',
          mediaType: 'image/jpeg',
          url: `https://${DOMAIN}/media/shared`,
          width: 100,
          height: 50,
          name: 'alt',
          mediaId: null,
          blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
          focusX: 0.1,
          focusY: -0.2,
          thumbnailUrl: null,
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        })
        .execute()
      return id
    }
    await seedAttachment(edited)
    await seedAttachment(appended)

    // A real edit of the first status records its previous version.
    await updateNote(db, hydration, {
      statusId: edited,
      text: 'after',
      summary: 'new cw'
    })
    // The same previous version, appended as an archived revision of the
    // second status with its own supersede time.
    const previous = await testDb.database.getStatus({ statusId: appended })
    await appendStatusHistory(db, {
      statusId: appended,
      revisions: [
        revision({
          text: 'before',
          summary: 'old cw',
          sensitive: true,
          attachments: (previous as StatusNote).attachments,
          supersededAt: BASE + 2_000
        })
      ]
    })

    const [updateNoteRow, appendedRow] = [
      (await historyOf(edited))[0],
      (await historyOf(appended))[0]
    ]
    const appendedData = appendedRow.data as Record<string, unknown>
    const updateNoteData = updateNoteRow.data as Record<string, unknown>
    expect(Object.keys(appendedData)).toEqual(Object.keys(updateNoteData))
    expect(appendedData.text).toBe(updateNoteData.text)
    expect(appendedData.summary).toBe(updateNoteData.summary)
    expect(appendedData.sensitive).toBe(updateNoteData.sensitive)
    expect(appendedData.pollOptions).toBe(updateNoteData.pollOptions)
    const appendedAttachments = appendedData.attachments as Record<
      string,
      unknown
    >[]
    const updateNoteAttachments = updateNoteData.attachments as Record<
      string,
      unknown
    >[]
    expect(appendedAttachments).toHaveLength(1)
    expect(Object.keys(appendedAttachments[0])).toEqual(
      Object.keys(updateNoteAttachments[0])
    )
  })

  it('appends the revisions and the updatedAt bump in one transaction', async () => {
    const { id } = await setup()
    const drop = await failWrite(
      'statuses',
      ['update'],
      `new."id" = ${quote(id)}`
    )
    await expectRolledBack(drop, () =>
      appendStatusHistory(db, {
        statusId: id,
        revisions: [
          revision({ text: 'first', supersededAt: BASE + 3_000 }),
          revision({ text: 'second', supersededAt: BASE + 5_000 })
        ]
      })
    )
    expect(hydrationCalls).toEqual([])
  })

  it('refuses a supersede time later than now plus the skew, or not finite', async () => {
    const { id } = await setup()
    const rowBefore = await statusRow(id)
    // `now` is this test's faked time; one millisecond past the skew is a
    // crafted future edited_at.
    const future = now + MAX_FUTURE_SKEW_MS + 1
    await expect(
      appendStatusHistory(db, {
        statusId: id,
        revisions: [revision({ text: 'future', supersededAt: future })]
      })
    ).rejects.toThrow()
    await expect(
      appendStatusHistory(db, {
        statusId: id,
        revisions: [revision({ text: 'nan', supersededAt: Number.NaN })]
      })
    ).rejects.toThrow()
    // Nothing was written: no history row, no updatedAt bump.
    expect(await historyOf(id)).toEqual([])
    expect(await statusRow(id)).toEqual(rowBefore)
    expect(hydrationCalls).toEqual([])
  })
})

describe('updateStatusQuoteApprovalPolicy', () => {
  it("rewrites only the policy in that status's content, as no edit", async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      content: JSON.stringify({
        url: `${author}/statuses/1`,
        text: 'quote me',
        summary: '',
        sensitive: false,
        language: 'en',
        quoteApprovalPolicy: 'public'
      })
    })
    const neighbour = await seedStatus({
      id: `${author}/statuses/2`,
      actorId: author
    })
    const neighbourBefore = await statusRow(neighbour)

    const status = await updateStatusQuoteApprovalPolicy(db, hydration, {
      statusId: id,
      quoteApprovalPolicy: 'nobody'
    })

    expect(await statusRow(id)).toMatchObject({
      content: JSON.stringify({
        url: `${author}/statuses/1`,
        text: 'quote me',
        summary: '',
        sensitive: false,
        language: 'en',
        quoteApprovalPolicy: 'nobody'
      }),
      updatedAt: BASE
    })
    expect(await historyOf(id)).toEqual([])
    expect(await statusRow(neighbour)).toEqual(neighbourBefore)
    expect(hydrationCalls).toEqual([['getStatus', { statusId: id }]])
    expect(status).toMatchObject({ id, quoteApprovalPolicy: 'nobody' })

    await expect(
      updateStatusQuoteApprovalPolicy(db, hydration, {
        statusId: `${author}/statuses/missing`,
        quoteApprovalPolicy: 'nobody'
      })
    ).resolves.toBeNull()
  })
})

describe('tag writes', () => {
  const tagsOf = (statusId: string) =>
    db
      .selectFrom('tags')
      .select(['type', 'name', 'nameNormalized', 'value'])
      .where('statusId', '=', statusId)
      .orderBy('type')
      .orderBy('name')
      .execute()

  it('createTag writes the tag, a hashtag with its normalized name and its search document', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedStatus({ id: `${author}/statuses/1`, actorId: author })

    const tag = await createTag(db, {
      statusId: id,
      name: `#Café${p}`,
      type: 'hashtag'
    })
    expect(tag).toEqual({
      id: expect.any(String),
      statusId: id,
      type: 'hashtag',
      name: `#Café${p}`,
      value: '',
      createdAt: now,
      updatedAt: now
    })
    expect(
      await db
        .selectFrom('tags')
        .selectAll()
        .where('id', '=', tag.id)
        .executeTakeFirst()
    ).toEqual({ ...tag, nameNormalized: `#café${p}` })
    expect(
      await db
        .selectFrom('search_documents')
        .select(['entityId', 'postCount'])
        .where('entityType', '=', 'hashtag')
        .where('entityId', '=', `café${p}`)
        .execute()
    ).toEqual([{ entityId: `café${p}`, postCount: 1 }])

    await createTag(db, {
      statusId: id,
      name: `#Skipped${p}`,
      type: 'hashtag',
      skipSearchIndex: true
    })
    // A mention is written with no search document work at all.
    const mention = await capture(() =>
      createTag(db, {
        statusId: id,
        name: `@bob${p}`,
        value: `https://${DOMAIN}/users/bob`,
        type: 'mention'
      })
    )
    expect(mention.statements.map(({ sql: text }) => text)).toEqual([
      expect.stringMatching(/^insert into "tags" /)
    ])
    expect(await tagsOf(id)).toEqual([
      {
        type: 'hashtag',
        name: `#Café${p}`,
        nameNormalized: `#café${p}`,
        value: ''
      },
      {
        type: 'hashtag',
        name: `#Skipped${p}`,
        nameNormalized: `#skipped${p}`,
        value: ''
      },
      {
        type: 'mention',
        name: `@bob${p}`,
        nameNormalized: null,
        value: `https://${DOMAIN}/users/bob`
      }
    ])
    expect(
      await db
        .selectFrom('search_documents')
        .select('entityId')
        .where('entityType', '=', 'hashtag')
        .where('entityId', 'in', [`skipped${p}`, `bob${p}`, `@bob${p}`])
        .execute()
    ).toEqual([])
  })

  it("deleteStatusTagsByType removes only that status's tags of that type", async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedStatus({ id: `${author}/statuses/1`, actorId: author })
    const neighbour = await seedStatus({
      id: `${author}/statuses/2`,
      actorId: author
    })
    for (const statusId of [id, neighbour]) {
      await createTag(db, {
        statusId,
        name: `#tag${p}`,
        type: 'hashtag',
        skipSearchIndex: true
      })
      await createTag(db, {
        statusId,
        name: `:emoji${p}:`,
        value: 'https://emoji.test/e.png',
        type: 'emoji'
      })
    }
    const neighbourBefore = await tagsOf(neighbour)

    await deleteStatusTagsByType(db, { statusId: id, type: 'emoji' })
    expect(await tagsOf(id)).toEqual([
      expect.objectContaining({ type: 'hashtag', name: `#tag${p}` })
    ])
    expect(await tagsOf(neighbour)).toEqual(neighbourBefore)
  })

  it('increaseHashtagCounter and decreaseHashtagCounter adjust the normalized tag, never below zero', async () => {
    const p = nextPrefix()
    const key = CounterKey.totalHashtag(`count${p}`)
    await increaseHashtagCounter(db, { hashtag: `#Count${p}` })
    await increaseHashtagCounter(db, { hashtag: ` ##COUNT${p}` })
    expect(await counterRow(key)).toEqual({
      id: key,
      value: 2,
      bucketHour: null,
      createdAt: now,
      updatedAt: now
    })
    await decreaseHashtagCounter(db, { hashtag: `count${p}` })
    await decreaseHashtagCounter(db, { hashtag: `count${p}` })
    await decreaseHashtagCounter(db, { hashtag: `count${p}` })
    expect(await counterValue(key)).toBe(0)
    // A counter that never existed is created at zero.
    await decreaseHashtagCounter(db, { hashtag: `none${p}` })
    expect(await counterValue(CounterKey.totalHashtag(`none${p}`))).toBe(0)
  })
})

describe('poll votes', () => {
  const pollRows = async (statusId: string) => ({
    choices: await choicesOf(statusId),
    voters: await db
      .selectFrom('poll_voters')
      .select(['actorId', 'createdAt', 'updatedAt'])
      .where('statusId', '=', statusId)
      .orderBy('actorId')
      .execute(),
    answers: await db
      .selectFrom('poll_answers')
      .select(['actorId', 'choice', 'createdAt', 'updatedAt'])
      .where('statusId', '=', statusId)
      .orderBy('actorId')
      .orderBy('choice')
      .execute()
  })

  const setup = async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const alice = await seedActor(`${p}-alice`)
    const bob = await seedActor(`${p}-bob`)
    // The neighbour poll comes first.
    const neighbour = await seedPoll(
      `${author}/statuses/neighbour`,
      author,
      ['x', 'y', 'z'],
      [1, 1, 1]
    )
    const id = await seedPoll(
      `${author}/statuses/poll`,
      author,
      ['red', 'green', 'blue'],
      [0, 0, 0]
    )
    return { author, alice, bob, neighbour, id }
  }

  it("recordPollVotes records a first vote and adds to those choices' tallies", async () => {
    const { alice, bob, neighbour, id } = await setup()
    // Alice voted on the neighbour poll; Bob voted on this one.
    await recordPollVotes(db, {
      statusId: neighbour,
      actorId: alice,
      choices: [0]
    })
    await recordPollVotes(db, { statusId: id, actorId: bob, choices: [1] })
    const neighbourBefore = await pollRows(neighbour)

    await expect(
      recordPollVotes(db, { statusId: id, actorId: alice, choices: [2, 0, 2] })
    ).resolves.toBe(true)

    expect(await pollRows(id)).toEqual({
      choices: [
        { title: 'red', totalVotes: 1 },
        { title: 'green', totalVotes: 1 },
        { title: 'blue', totalVotes: 1 }
      ],
      voters: [
        { actorId: alice, createdAt: now, updatedAt: now },
        { actorId: bob, createdAt: now, updatedAt: now }
      ],
      answers: [
        { actorId: alice, choice: 0, createdAt: now, updatedAt: now },
        { actorId: alice, choice: 2, createdAt: now, updatedAt: now },
        { actorId: bob, choice: 1, createdAt: now, updatedAt: now }
      ]
    })
    expect(await pollRows(neighbour)).toEqual(neighbourBefore)
  })

  it('recordPollVotes refuses a second vote, and a choice the poll does not have, writing nothing', async () => {
    const { alice, id } = await setup()
    await recordPollVotes(db, { statusId: id, actorId: alice, choices: [0] })
    const before = await pollRows(id)
    for (const choices of [[1], [0], [3], [-1], []]) {
      await expect(
        recordPollVotes(db, { statusId: id, actorId: alice, choices })
      ).resolves.toBe(false)
    }
    // No choice at all is refused before any statement.
    const { result, statements } = await capture(() =>
      recordPollVotes(db, { statusId: id, actorId: alice, choices: [] })
    )
    expect(result).toBe(false)
    expect(statements).toEqual([])
    const { bob } = await setup()
    await expect(
      recordPollVotes(db, { statusId: id, actorId: bob, choices: [0, 3] })
    ).resolves.toBe(false)
    expect(await pollRows(id)).toEqual(before)
  })

  it("recordPollVotes with additional choices records only the actor's new ones on that poll", async () => {
    const { alice, bob, neighbour, id } = await setup()
    await recordPollVotes(db, { statusId: id, actorId: alice, choices: [0] })
    // Bob voted blue here, and Alice voted blue on the neighbour poll: neither
    // is Alice's vote for blue on this one.
    await recordPollVotes(db, { statusId: id, actorId: bob, choices: [2] })
    await createPollAnswer(db, {
      statusId: neighbour,
      actorId: alice,
      choice: 2
    })
    const neighbourBefore = await pollRows(neighbour)

    const { result, statements } = await capture(() =>
      recordPollVotes(db, {
        statusId: id,
        actorId: alice,
        choices: [0, 2],
        allowAdditionalChoices: true
      })
    )
    expect(result).toBe(true)
    expect(await pollRows(id)).toMatchObject({
      choices: [
        { title: 'red', totalVotes: 1 },
        { title: 'green', totalVotes: 0 },
        { title: 'blue', totalVotes: 2 }
      ],
      answers: [
        expect.objectContaining({ actorId: alice, choice: 0 }),
        expect.objectContaining({ actorId: alice, choice: 2 }),
        expect.objectContaining({ actorId: bob, choice: 2 })
      ]
    })
    expect((await pollRows(id)).voters).toHaveLength(2)
    expect(await pollRows(neighbour)).toEqual(neighbourBefore)
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'read choices',
      'read voter',
      'read answers',
      'insert answers',
      'add votes',
      'commit'
    ])

    // Nothing new: false, nothing written.
    const before = await pollRows(id)
    await expect(
      recordPollVotes(db, {
        statusId: id,
        actorId: alice,
        choices: [2, 0],
        allowAdditionalChoices: true
      })
    ).resolves.toBe(false)
    expect(await pollRows(id)).toEqual(before)
  })

  it('recordPollVotes runs its statements in one transaction, in order', async () => {
    const { alice, id } = await setup()
    const { statements } = await capture(() =>
      recordPollVotes(db, { statusId: id, actorId: alice, choices: [1, 0] })
    )
    expect(transactionSteps(statements)).toEqual([
      'begin',
      'read choices',
      'read voter',
      'insert voter',
      'insert answers',
      'add votes',
      'commit'
    ])
    // One multi-row insert, the answers in the order given.
    const insert = statements.find(({ sql: text }) =>
      text.startsWith('insert into "poll_answers"')
    )
    expect(
      insert?.bindings.filter((value) => typeof value === 'number')
    ).toEqual([1, 0])
  })

  it('recordPollVotes rolls back the voter and the answers when the tally fails', async () => {
    const { alice, id } = await setup()
    const drop = await failWrite(
      'poll_choices',
      ['update'],
      `new."statusId" = ${quote(id)}`
    )
    await expectRolledBack(drop, () =>
      recordPollVotes(db, { statusId: id, actorId: alice, choices: [0, 1] })
    )
  })

  it('recordPollVotes reads a unique violation as another vote that got there first', async () => {
    const { alice, id } = await setup()
    const before = await pollRows(id)
    // The voter row's unique key failing, the way a concurrent vote of the
    // same actor makes it fail.
    const drop = await failWrite(
      'poll_voters',
      ['insert'],
      `new."statusId" = ${quote(id)}`,
      {
        code: '23505',
        message:
          'UNIQUE constraint failed: poll_voters.statusId, poll_voters.actorId'
      }
    )
    try {
      await expect(
        recordPollVotes(db, { statusId: id, actorId: alice, choices: [0] })
      ).resolves.toBe(false)
    } finally {
      await drop()
    }
    expect(await pollRows(id)).toEqual(before)
  })

  it('createPollAnswer writes one answer', async () => {
    const { alice, id } = await setup()
    await createPollAnswer(db, { statusId: id, actorId: alice, choice: 1 })
    expect((await pollRows(id)).answers).toEqual([
      { actorId: alice, choice: 1, createdAt: now, updatedAt: now }
    ])
  })

  it('incrementPollChoiceVotes adds one to the choice at that index of that poll', async () => {
    const { neighbour, id } = await setup()
    const neighbourBefore = await pollRows(neighbour)
    await incrementPollChoiceVotes(db, { statusId: id, choiceIndex: 1 })
    await incrementPollChoiceVotes(db, { statusId: id, choiceIndex: 2 })
    await incrementPollChoiceVotes(db, { statusId: id, choiceIndex: 2 })
    // Past the last choice: nothing.
    await incrementPollChoiceVotes(db, { statusId: id, choiceIndex: 3 })
    expect(await choicesOf(id)).toEqual([
      { title: 'red', totalVotes: 0 },
      { title: 'green', totalVotes: 1 },
      { title: 'blue', totalVotes: 2 }
    ])
    expect(await pollRows(neighbour)).toEqual(neighbourBefore)
  })

  it('incrementPollChoiceVotes reads the index through parseInt', async () => {
    const { id } = await setup()
    // Cut to an integer, and a NaN one read as the first choice.
    await incrementPollChoiceVotes(db, { statusId: id, choiceIndex: 1.7 })
    await incrementPollChoiceVotes(db, {
      statusId: id,
      choiceIndex: Number.NaN
    })
    expect(await choicesOf(id)).toEqual([
      { title: 'red', totalVotes: 1 },
      { title: 'green', totalVotes: 1 },
      { title: 'blue', totalVotes: 0 }
    ])
    // A negative one is refused before any query.
    const { result, statements } = await capture(() =>
      incrementPollChoiceVotes(db, { statusId: id, choiceIndex: -1 }).then(
        () => 'resolved',
        (error: Error) => error.message
      )
    )
    expect(result).toBe('A non-negative integer must be provided to offset.')
    expect(statements).toEqual([])
  })
})

describe('single-row reads', () => {
  it('limit every read of one row to one row', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`, { local: true })
    const parent = await seedStatus({
      id: `${author}/statuses/parent`,
      actorId: author,
      url: `${author}/@parent`
    })
    const poll = await seedPoll(`${author}/statuses/poll`, author, ['a', 'b'])
    const { statements } = await capture(async () => {
      await createNote(db, hydration, {
        id: `${author}/statuses/reply`,
        url: `${author}/statuses/reply`,
        actorId: author,
        text: 'reply',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        reply: `${author}/@parent`
      })
      await updatePoll(db, hydration, {
        statusId: poll,
        text: `poll ${poll}`,
        choices: [{ title: 'a', totalVotes: 1 }]
      })
      await updateStatusQuoteApprovalPolicy(db, hydration, {
        statusId: parent,
        quoteApprovalPolicy: 'public'
      })
      await recordPollVotes(db, {
        statusId: poll,
        actorId: author,
        choices: [0]
      })
      await incrementPollChoiceVotes(db, { statusId: poll, choiceIndex: 1 })
    })
    // The single-row reads among the Kysely statements, hydration's included:
    // updatePoll and updateStatusQuoteApprovalPolicy each read their row and
    // then hydrate it by id after their write.
    const reads = statements
      .filter(({ sql: text }) =>
        [
          /^select "accountId" from "actors" /,
          /^select "id" from "statuses" where /,
          /^select \* from "statuses" where "id" = /,
          /^select "id" from "poll_voters" /,
          /^select "choiceId" from "poll_choices" .* offset /
        ].some((pattern) => pattern.test(text))
      )
      .map(({ sql: text }) =>
        text
          .replace(/\$\d+/g, '?')
          .replace(
            /^(select \S+ from "\w+") .*?( limit \? offset \?| limit \?)?$/,
            '$1$2'
          )
      )
    expect(reads).toEqual([
      'select "accountId" from "actors" limit ?',
      'select "id" from "statuses" limit ?',
      'select "id" from "statuses" limit ?',
      'select * from "statuses" limit ?',
      'select * from "statuses" limit ?',
      'select * from "statuses" limit ?',
      'select * from "statuses" limit ?',
      'select "id" from "poll_voters" limit ?',
      'select "choiceId" from "poll_choices" limit ? offset ?'
    ])
  })
})

// The creates take no lock of their own: the status id's primary key, the
// voter row's unique key and the counter upserts' row locks keep concurrent
// writers apart. These run on both backends; only PostgreSQL runs the writers
// at the same time (SQLite has one connection, which they take in turn).
describe('concurrent writes', () => {
  it('two deliveries of the same note create it once and count it once', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`, { local: true })
    const id = `${author}/statuses/1`
    const serviceBefore = await counterValue(CounterKey.serviceTotalStatuses())
    const deliver = (text: string) =>
      createNoteWithResult(db, hydration, {
        id,
        url: id,
        actorId: author,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${author}/followers`]
      })

    const results = await Promise.all([deliver('one'), deliver('two')])

    expect(results.map((result) => result.isNew).sort()).toEqual([false, true])
    const winner = results.find((result) => result.isNew)!.status as StatusNote
    const loser = results.find((result) => !result.isNew)!.status as StatusNote
    expect(loser).toMatchObject({ id, text: winner.text })
    expect(await recipientsOf(id)).toHaveLength(2)
    expect(await counterValue(CounterKey.totalStatus(author))).toBe(1)
    expect(await counterValue(CounterKey.serviceTotalStatuses())).toBe(
      (serviceBefore ?? 0) + 1
    )
    expect(await counterValue(bucketOf('statuses'))).toBe(1)
    expect(await counterValue(bucketOf('local-statuses'))).toBe(1)
  })

  it('concurrent creates by different authors leave every counter exact', async () => {
    const p = nextPrefix()
    const authors = await Promise.all(
      [0, 1, 2, 3].map((index) => seedActor(`${p}-a${index}`, { local: true }))
    )
    const parent = await seedStatus({
      id: `${authors[0]}/statuses/parent`,
      actorId: authors[0]
    })
    const serviceBefore = await counterValue(CounterKey.serviceTotalStatuses())
    const localBefore = await counterValue(CounterKey.nodeinfoLocalPosts())

    await Promise.all(
      authors.flatMap((author) =>
        [1, 2].map((index) =>
          createNote(db, hydration, {
            id: `${author}/statuses/${index}`,
            url: `${author}/statuses/${index}`,
            actorId: author,
            text: 'reply',
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            reply: parent
          })
        )
      )
    )

    for (const author of authors) {
      expect(await counterValue(CounterKey.totalStatus(author))).toBe(2)
    }
    expect(await counterValue(CounterKey.totalReply(parent))).toBe(8)
    expect(await counterValue(CounterKey.serviceTotalStatuses())).toBe(
      (serviceBefore ?? 0) + 8
    )
    expect(await counterValue(CounterKey.nodeinfoLocalPosts())).toBe(
      (localBefore ?? 0) + 8
    )
    expect(await counterValue(bucketOf('statuses'))).toBe(8)
    expect(await counterValue(bucketOf('local-statuses'))).toBe(8)
  })

  it('two votes of the same actor record one', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const voter = await seedActor(`${p}-voter`)
    const id = await seedPoll(`${author}/statuses/poll`, author, ['a', 'b'])

    const results = await Promise.all([
      recordPollVotes(db, { statusId: id, actorId: voter, choices: [0] }),
      recordPollVotes(db, { statusId: id, actorId: voter, choices: [1] })
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    const choices = await choicesOf(id)
    expect(choices.map((choice) => choice.totalVotes).sort()).toEqual([0, 1])
    expect(
      await db
        .selectFrom('poll_answers')
        .select('choice')
        .where('statusId', '=', id)
        .execute()
    ).toHaveLength(1)
    expect(
      await db
        .selectFrom('poll_voters')
        .select('actorId')
        .where('statusId', '=', id)
        .execute()
    ).toEqual([{ actorId: voter }])
  })

  // Only PostgreSQL can show a writer waiting on another's uncommitted row.
  it.runIf(testDb.backend === 'pg')(
    'a delivery waits for an uncommitted one of the same note, then returns it',
    async () => {
      const p = nextPrefix()
      const author = await seedActor(`${p}-author`)
      const id = `${author}/statuses/1`

      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let inserted = () => {}
      const insertDone = new Promise<void>((resolve) => {
        inserted = resolve
      })
      // Another writer has inserted the status and not committed yet.
      const holder = inTransaction(db, async (trx) => {
        await trx
          .insertInto('statuses')
          .values({
            id,
            url: id,
            urlHash: getHashFromString(id),
            actorId: author,
            type: StatusType.enum.Note,
            reply: '',
            content: noteContent(id, 'held'),
            createdAt: new Date(now),
            updatedAt: new Date(now)
          })
          .execute()
        inserted()
        await released
      })
      await insertDone

      let settled = false
      const delivery = createNoteWithResult(db, hydration, {
        id,
        url: id,
        actorId: author,
        text: 'late',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      }).finally(() => {
        settled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(settled).toBe(false)

      release()
      await holder
      const result = await delivery
      expect(result.isNew).toBe(false)
      expect(result.status).toMatchObject({ id, text: 'held' })
      expect(await counterValue(CounterKey.totalStatus(author))).toBeNull()
    }
  )
})

// Kysely binds what it is given: a null or undefined key is bound as NULL,
// which matches nothing. No caller passes either.
describe('null and undefined keys', () => {
  it('deleteStatusTagsByType with a null status id deletes nothing, not even the tags with no status', async () => {
    const p = nextPrefix()
    const tagId = randomUUID()
    await db
      .insertInto('tags')
      .values({
        id: tagId,
        statusId: null,
        type: 'hashtag',
        name: `#orphan${p}`,
        value: ''
      })
      .execute()
    await deleteStatusTagsByType(db, {
      statusId: null as unknown as string,
      type: 'hashtag'
    })
    await deleteStatusTagsByType(db, {
      statusId: undefined as unknown as string,
      type: 'hashtag'
    })
    expect(
      await db.selectFrom('tags').select('id').where('id', '=', tagId).execute()
    ).toEqual([{ id: tagId }])
  })

  it('recordPollVotes with a null or undefined status id finds no poll and returns false', async () => {
    const p = nextPrefix()
    const voter = await seedActor(`${p}-voter`)
    // A choice with no status, which must not be read as the poll's.
    await db
      .insertInto('poll_choices')
      .values({ statusId: null, title: `orphan ${p}`, totalVotes: 0 })
      .execute()
    const before = await dumpTables()
    for (const statusId of [null, undefined]) {
      await expect(
        recordPollVotes(db, {
          statusId: statusId as unknown as string,
          actorId: voter,
          choices: [0]
        })
      ).resolves.toBe(false)
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('updatePoll with an undefined choice title sets no tally', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedPoll(`${author}/statuses/poll`, author, ['a'], [2])
    await updatePoll(db, hydration, {
      statusId: id,
      text: 'edited',
      choices: [{ title: undefined as unknown as string, totalVotes: 9 }]
    })
    expect(await choicesOf(id)).toEqual([{ title: 'a', totalVotes: 2 }])
    expect(await historyOf(id)).toHaveLength(1)
  })
})

describe('null and undefined keys, continued', () => {
  it('deleteStatusTagsByType with a null or undefined type deletes nothing, not even the untyped tags', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedStatus({ id: `${author}/statuses/1`, actorId: author })
    const untyped = randomUUID()
    await db
      .insertInto('tags')
      .values({
        id: untyped,
        statusId: id,
        type: null,
        name: `#x${p}`,
        value: ''
      })
      .execute()
    for (const type of [null, undefined]) {
      await deleteStatusTagsByType(db, {
        statusId: id,
        type: type as unknown as 'hashtag'
      })
    }
    expect(
      await db
        .selectFrom('tags')
        .select('id')
        .where('id', '=', untyped)
        .execute()
    ).toEqual([{ id: untyped }])
  })

  it('incrementPollChoiceVotes with a null or undefined status id tallies nothing, not even a choice with no status', async () => {
    const p = nextPrefix()
    await db
      .insertInto('poll_choices')
      .values({ statusId: null, title: `orphan ${p}`, totalVotes: 0 })
      .execute()
    const before = await dumpTables()
    for (const statusId of [null, undefined]) {
      await incrementPollChoiceVotes(db, {
        statusId: statusId as unknown as string,
        choiceIndex: 0
      })
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('updatePoll with a null choice title sets no tally, not even on the untitled choices', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedPoll(`${author}/statuses/poll`, author, ['a'], [2])
    await db
      .insertInto('poll_choices')
      .values({ statusId: id, title: null, totalVotes: 1 })
      .execute()
    // Hydrating a poll with an untitled choice fails, after the commit.
    await expect(
      updatePoll(db, hydration, {
        statusId: id,
        text: `poll ${id}`,
        choices: [{ title: null as unknown as string, totalVotes: 9 }]
      })
    ).rejects.toThrow()
    const choices = await choicesOf(id)
    expect(choices).toHaveLength(2)
    expect(choices).toEqual(
      expect.arrayContaining([
        { title: 'a', totalVotes: 2 },
        { title: null, totalVotes: 1 }
      ])
    )
  })

  it('recordPollVotes with an undefined actor id fails on the voter insert, writing nothing', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const id = await seedPoll(`${author}/statuses/poll`, author, ['a', 'b'])
    const before = await dumpTables()
    await expect(
      recordPollVotes(db, {
        statusId: id,
        actorId: undefined as unknown as string,
        choices: [0]
      })
    ).rejects.toThrow(
      testDb.backend === 'pg'
        ? 'null value in column "actorId" of relation "poll_voters" violates not-null constraint'
        : 'NOT NULL constraint failed: poll_voters.actorId'
    )
    expect(await dumpTables()).toEqual(before)
  })

  it('the creates with an undefined author commit the status and its counters, then fail building it', async () => {
    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const original = await seedStatus({
      id: `${author}/statuses/0`,
      actorId: author
    })
    const undefinedAuthor = CounterKey.totalStatus(
      undefined as unknown as string
    )
    const totalBefore = (await counterValue(undefinedAuthor)) ?? 0
    const base = {
      actorId: undefined as unknown as string,
      text: 'x',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    const note = `${actorIn(p)}/statuses/note`
    const poll = `${actorIn(p)}/statuses/poll`
    const boost = `${actorIn(p)}/statuses/boost`
    await expect(
      createNote(db, hydration, { ...base, id: note, url: note })
    ).rejects.toThrow('actorId')
    await expect(
      createPoll(db, hydration, {
        ...base,
        id: poll,
        url: poll,
        choices: ['a'],
        endAt: now
      })
    ).rejects.toThrow('actorId')
    await expect(
      createAnnounce(db, hydration, {
        id: boost,
        actorId: undefined as unknown as string,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: original
      })
    ).rejects.toThrow('actorId')
    for (const id of [note, poll, boost]) {
      expect(await statusRow(id)).toMatchObject({ id, actorId: null })
      expect(await recipientsOf(id)).toHaveLength(1)
    }
    expect(await counterValue(undefinedAuthor)).toBe(totalBefore + 3)
  })

  it('updatePoll and updateStatusQuoteApprovalPolicy with an undefined status id return null', async () => {
    const before = await dumpTables()
    await expect(
      updatePoll(db, hydration, {
        statusId: undefined as unknown as string,
        text: 'x',
        choices: []
      })
    ).resolves.toBeNull()
    await expect(
      updateStatusQuoteApprovalPolicy(db, hydration, {
        statusId: undefined as unknown as string,
        quoteApprovalPolicy: 'public'
      })
    ).resolves.toBeNull()
    expect(await dumpTables()).toEqual(before)
  })

  it.runIf(testDb.backend === 'sqlite')(
    'updatePoll and updateStatusQuoteApprovalPolicy with a null status id leave a status stored with no id alone',
    async () => {
      const p = nextPrefix()
      const author = await seedActor(`${p}-author`)
      const url = `${author}/statuses/null`
      await db
        .insertInto('statuses')
        .values({
          id: null as unknown as string,
          url,
          actorId: author,
          type: StatusType.enum.Poll,
          reply: '',
          content: pollContent(url),
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        })
        .execute()
      try {
        const before = await dumpTables()
        await expect(
          updatePoll(db, hydration, {
            statusId: null as unknown as string,
            text: 'edited',
            choices: []
          })
        ).resolves.toBeNull()
        await expect(
          updateStatusQuoteApprovalPolicy(db, hydration, {
            statusId: null as unknown as string,
            quoteApprovalPolicy: 'public'
          })
        ).resolves.toBeNull()
        expect(await dumpTables()).toEqual(before)
      } finally {
        await db.deleteFrom('statuses').where('id', 'is', null).execute()
      }
    }
  )

  it.runIf(testDb.backend === 'pg')(
    'decreaseHashtagCounter leaves a counter stored above 2^53 - 1 at 2^53 - 1',
    async () => {
      const p = nextPrefix()
      const id = CounterKey.totalHashtag(`huge${p}`)
      await sql`insert into counters (id, value, "createdAt", "updatedAt") values (${id}, 9007199254740995, now(), now())`.execute(
        db
      )
      await decreaseHashtagCounter(db, { hashtag: `#Huge${p}` })
      const { rows } = await sql<{
        value: string
      }>`select value::text as value from counters where id = ${id}`.execute(db)
      expect(rows).toEqual([{ value: '9007199254740991' }])
    }
  )
})

describe('counters above 2^53 - 1', () => {
  it.runIf(testDb.backend === 'sqlite')(
    'an increase, a decrease and a create leave a counter stored above 2^53 - 1 at 2^53 - 1',
    async () => {
      const p = nextPrefix()
      const author = await seedActor(`${p}-author`)
      const up = CounterKey.totalHashtag(`hugeup${p}`)
      const down = CounterKey.totalHashtag(`hugedown${p}`)
      const total = CounterKey.totalStatus(author)
      for (const id of [up, down, total]) {
        await sql`insert into counters (id, value, "createdAt", "updatedAt") values (${id}, 9007199254740995, 0, 0)`.execute(
          db
        )
      }
      await increaseHashtagCounter(db, { hashtag: `#Hugeup${p}` })
      await decreaseHashtagCounter(db, { hashtag: `#Hugedown${p}` })
      const id = `${author}/statuses/huge`
      await createNote(db, hydration, {
        id,
        url: id,
        actorId: author,
        text: 'x',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const { rows } = await sql<{
        id: string
        value: string
      }>`select id, cast(value as text) as value from counters where id in (${up}, ${down}, ${total})`.execute(
        db
      )
      expect(
        Object.fromEntries(rows.map((row) => [row.id, row.value]))
      ).toEqual({
        [up]: '9007199254740991',
        [down]: '9007199254740991',
        [total]: '9007199254740991'
      })
      expect(await statusRow(id)).toMatchObject({ id })
    }
  )
})

describe('createStatusQueries', () => {
  it('hands the writes that hydrate the hydration it is given, and the others as they are', async () => {
    const queries = createStatusQueries(() => hydration)
    expect({
      createTag: queries.createTag,
      deleteStatusTagsByType: queries.deleteStatusTagsByType,
      increaseHashtagCounter: queries.increaseHashtagCounter,
      decreaseHashtagCounter: queries.decreaseHashtagCounter,
      createPollAnswer: queries.createPollAnswer,
      incrementPollChoiceVotes: queries.incrementPollChoiceVotes,
      recordPollVotes: queries.recordPollVotes
    }).toEqual({
      createTag,
      deleteStatusTagsByType,
      increaseHashtagCounter,
      decreaseHashtagCounter,
      createPollAnswer,
      incrementPollChoiceVotes,
      recordPollVotes
    })

    const p = nextPrefix()
    const author = await seedActor(`${p}-author`)
    const note = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author
    })
    const poll = await seedPoll(`${author}/statuses/poll`, author, ['a'])
    const missing = `${author}/statuses/missing`
    const note2 = { url: note, actorId: author, text: 'x', to: [], cc: [] }
    const poll2 = { ...note2, url: poll, endAt: now, choices: ['a'] }
    const calls: [string, () => Promise<unknown>, string][] = [
      [
        'createNote',
        () => queries.createNote(db, { id: note, ...note2 }),
        note
      ],
      [
        'createNoteWithResult',
        () => queries.createNoteWithResult(db, { id: note, ...note2 }),
        note
      ],
      [
        'createPoll',
        () => queries.createPoll(db, { id: poll, ...poll2 }),
        poll
      ],
      [
        'createPollWithResult',
        () => queries.createPollWithResult(db, { id: poll, ...poll2 }),
        poll
      ],
      [
        'createAnnounce',
        () =>
          queries.createAnnounce(db, {
            id: `${author}/statuses/boost`,
            actorId: author,
            to: [],
            cc: [],
            originalStatusId: missing
          }),
        missing
      ],
      [
        'updateNote',
        () =>
          queries.updateNote(db, { statusId: missing, text: '', summary: '' }),
        missing
      ],
      [
        'updateNoteVisibility',
        () =>
          queries.updateNoteVisibility(db, {
            statusId: missing,
            to: [],
            cc: []
          }),
        missing
      ],
      [
        'updatePoll',
        () =>
          queries.updatePoll(db, {
            statusId: poll,
            text: `poll ${poll}`,
            choices: []
          }),
        poll
      ],
      [
        'updateStatusQuoteApprovalPolicy',
        () =>
          queries.updateStatusQuoteApprovalPolicy(db, {
            statusId: note,
            quoteApprovalPolicy: 'public'
          }),
        note
      ]
    ]
    for (const [name, call, statusId] of calls) {
      hydrationCalls.length = 0
      await call()
      expect(
        hydrationCalls.map(
          ([, params]) => (params as { statusId: string }).statusId
        ),
        name
      ).toContain(statusId)
    }
  })
})
