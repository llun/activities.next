import { randomUUID } from 'node:crypto'

import { deleteActorData } from '@/lib/database/domains/actor/deletion'
import { searchQueries } from '@/lib/database/domains/search/queries'
import { type Db, isInTransaction } from '@/lib/database/kysely'
import { increaseCounterValue } from '@/lib/database/kysely/counter'
import {
  type Statement,
  type TableDump,
  capture,
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

// Query-level tests for deleteActorData (lib/database/domains/actor/
// deletion.ts), called directly on Kysely. Every test writes its own actors
// (a fresh prefix): the one purged and neighbours with rows of their own in
// every table the purge touches, which must survive untouched. The tests
// compare a dump of every table before and after against the rows the purge
// should have removed or changed and nothing else. Date is faked per test, so
// the timestamps the purge writes are known. The hashtag search refresh after
// the transaction is replaced by a spy, except where a test checks it.
//
// The IN-list batch size can be capped (`batchCap`), so a few rows cross the
// chunk boundaries the purge splits its statements at, on both backends.

const { batchCap } = vi.hoisted(() => ({ batchCap: { value: 0 } }))

vi.mock('@/lib/database/kysely/inList', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/kysely/inList')>()
  const { chunkArray } = await import('@/lib/database/sql/utils/knex')
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
      for (const chunk of chunkArray(
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

const DOMAIN = 'actor-deletion.test'
const BASE = Date.UTC(2026, 0, 1)
const PUBLIC = [ACTIVITY_STREAM_PUBLIC]
const at = new Date(BASE)

let prefixCount = 0
let prefix = ''
let hourCount = 0
let now = 0
let sequence = 0
const next = () => (sequence += 1)

const actorIn = (name: string) => `https://${DOMAIN}/users/${prefix}-${name}`
const statusIn = (actorId: string, name: string) =>
  `${actorId}/statuses/${name}`

const seedActor = async (name: string, { local = false } = {}) => {
  const id = actorIn(name)
  let accountId: string | null = null
  if (local) {
    accountId = randomUUID()
    await db()
      .insertInto('accounts')
      .values({
        id: accountId,
        email: `${prefix}-${name}@${DOMAIN}`,
        passwordHash: 'hash',
        createdAt: at,
        updatedAt: at
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
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await db()
    .insertInto('search_documents')
    .values({
      id: `account:${id}`,
      entityType: 'account',
      entityId: id,
      documentText: name,
      actorId: id,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  return { id, accountId }
}

const seedStatus = async ({
  id,
  actorId,
  to = PUBLIC,
  type = StatusType.enum.Note,
  url = `${id}/page`,
  reply = '',
  content = JSON.stringify({ url, text: `text of ${id}` }),
  originalStatusId = null
}: {
  id: string
  actorId: string | null
  to?: string[]
  type?: StatusType
  url?: string
  reply?: string
  content?: string | null
  originalStatusId?: string | null
}) => {
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
      createdAt: new Date(BASE + next()),
      updatedAt: at
    })
    .execute()
  for (const recipient of to) {
    await db()
      .insertInto('recipients')
      .values({
        id: randomUUID(),
        statusId: id,
        actorId: recipient,
        type: 'to',
        createdAt: at,
        updatedAt: at
      })
      .execute()
  }
  await db()
    .insertInto('search_documents')
    .values({
      id: `status:${id}`,
      entityType: 'status',
      entityId: id,
      documentText: `text of ${id}`,
      actorId,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  return id
}

const setCounter = (id: string, value: number) =>
  db()
    .insertInto('counters')
    .values({ id, value, createdAt: at, updatedAt: at })
    .onConflict((oc) => oc.column('id').doUpdateSet({ value, updatedAt: at }))
    .execute()

const seedTag = (statusId: string, name: string, type = 'hashtag') =>
  db()
    .insertInto('tags')
    .values({
      id: randomUUID(),
      statusId,
      type,
      name,
      value: name,
      createdAt: at,
      updatedAt: at
    })
    .execute()

// A poll on `statusId` with one choice per tally, in choiceId order; returns
// the choice ids.
const seedPoll = async (statusId: string, tallies: number[]) => {
  for (const [index, totalVotes] of tallies.entries()) {
    await db()
      .insertInto('poll_choices')
      .values({
        statusId,
        title: `choice ${index}`,
        totalVotes,
        createdAt: at,
        updatedAt: at
      })
      .execute()
  }
  return (
    await db()
      .selectFrom('poll_choices')
      .select('choiceId')
      .where('statusId', '=', statusId)
      .orderBy('choiceId')
      .execute()
  ).map((row) => row.choiceId)
}

const vote = async (statusId: string, actorId: string, choice: number) => {
  await db()
    .insertInto('poll_answers')
    .values({ statusId, actorId, choice, createdAt: at, updatedAt: at })
    .execute()
}

// Rows by `actorId` (or about it) that hang off the status `statusId`.
const seedInteractions = async (statusId: string, actorId: string) => {
  const d = db()
  await d
    .insertInto('likes')
    .values({ statusId, actorId, createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('status_reactions')
    .values({ statusId, actorId, name: '👍', createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('bookmarks')
    .values({ statusId, actorId, createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('poll_voters')
    .values({ statusId, actorId, createdAt: at, updatedAt: at })
    .execute()
}

// The rows a status has of its own, whoever wrote them.
const seedStatusRows = async (
  statusId: string,
  ownerId: string,
  otherId: string
) => {
  const d = db()
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
    .insertInto('status_history')
    .values({ statusId, data: '{}', createdAt: at, updatedAt: at })
    .execute()
  await d
    .insertInto('status_link_previews')
    .values({ statusId, urlHash: SHARED_PREVIEW, createdAt: at, updatedAt: at })
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
  // Rows the purge leaves (as it always has), on both backends.
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
    .insertInto('collection_timeline')
    .values({ collectionSeq: next(), memberSeq: 1, statusId, sortKey: next() })
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

const seedMedia = async (
  actorId: string,
  accountId: string | null,
  originalBytes: number | null,
  thumbnailBytes: number | null
) => {
  const { id } = await db()
    .insertInto('medias')
    .values({
      actorId,
      accountId,
      original: `original-${next()}`,
      originalMimeType: 'image/png',
      originalBytes,
      thumbnailBytes,
      originalMetaData: '{}',
      createdAt: at,
      updatedAt: at
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return id
}

const seedEditFile = (mediaId: number, actorId: string, bytes: number) =>
  db()
    .insertInto('media_edit_files')
    .values({
      id: randomUUID(),
      mediaId,
      actorId,
      slot: `slot-${next()}`,
      path: `/edits/${next()}.png`,
      mimeType: 'image/png',
      bytes,
      metaData: '{}',
      createdAt: at
    })
    .execute()

const seedAlbum = async (actorId: string, mediaId: number) => {
  const albumId = randomUUID()
  await db()
    .insertInto('gallery_albums')
    .values({
      id: albumId,
      actorId,
      title: 'album',
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await db()
    .insertInto('gallery_album_items')
    .values({ albumId, actorId, mediaId, createdAt: at })
    .execute()
}

const seedFollow = (actorId: string, targetActorId: string, status: string) =>
  db()
    .insertInto('follows')
    .values({
      id: randomUUID(),
      actorId,
      actorHost: DOMAIN,
      targetActorId,
      targetActorHost: DOMAIN,
      status,
      inbox: `${actorId}/inbox`,
      sharedInbox: `https://${DOMAIN}/inbox`,
      createdAt: at,
      updatedAt: at
    })
    .execute()

const seedList = async (actorId: string, members: string[]) => {
  const listId = randomUUID()
  await db()
    .insertInto('lists')
    .values({
      id: listId,
      actorId,
      title: 'list',
      createdAt: at,
      updatedAt: at
    })
    .execute()
  for (const targetActorId of members) {
    await db()
      .insertInto('list_accounts')
      .values({
        id: randomUUID(),
        listId,
        actorId,
        targetActorId,
        createdAt: at
      })
      .execute()
  }
  return listId
}

// One row each way between `actorId` and `targetActorId` in the tables keyed
// on a pair of actors.
const seedPairRows = async (actorId: string, targetActorId: string) => {
  const hosts = { actorHost: DOMAIN, targetActorHost: DOMAIN }
  await db()
    .insertInto('endorsements')
    .values({ actorId, targetActorId, ...hosts, createdAt: at })
    .execute()
  await db()
    .insertInto('blocks')
    .values({
      id: randomUUID(),
      actorId,
      targetActorId,
      uri: `${actorId}/blocks/${next()}`,
      ...hosts,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await db()
    .insertInto('mutes')
    .values({
      id: randomUUID(),
      actorId,
      targetActorId,
      endsAt: null,
      ...hosts,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await db()
    .insertInto('account_notes')
    .values({
      id: randomUUID(),
      actorId,
      targetActorId,
      comment: 'note',
      ...hosts,
      createdAt: at,
      updatedAt: at
    })
    .execute()
}

// An actor's own settings rows: a featured tag, a filter with a status and a
// keyword, a marker.
const seedSettings = async (actorId: string, statusId: string) => {
  await db()
    .insertInto('featured_tags')
    .values({
      id: randomUUID(),
      actorId,
      name: 'cats',
      nameNormalized: 'cats',
      createdAt: at
    })
    .execute()
  const filterId = randomUUID()
  await db()
    .insertInto('filters')
    .values({
      id: filterId,
      actorId,
      title: 'filter',
      context: '["home"]',
      expiresAt: null,
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await db()
    .insertInto('filter_statuses')
    .values({ id: randomUUID(), filterId, statusId, createdAt: at })
    .execute()
  await db()
    .insertInto('filter_keywords')
    .values({
      id: randomUUID(),
      filterId,
      keyword: 'word',
      createdAt: at,
      updatedAt: at
    })
    .execute()
  await db()
    .insertInto('markers')
    .values({
      id: randomUUID(),
      actorId,
      timeline: 'home',
      lastReadId: statusId,
      updatedAt: at
    })
    .execute()
}

const seedTimeline = (
  actorId: string,
  statusId: string,
  statusActorId: string
) =>
  db()
    .insertInto('timelines')
    .values({
      actorId,
      timeline: 'main',
      statusId,
      statusActorId,
      createdAt: at,
      updatedAt: at
    })
    .execute()

const seedFitnessFile = async (actorId: string, statusId: string) => {
  const id = randomUUID()
  await db()
    .insertInto('fitness_files')
    .values({
      id,
      actorId,
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

const seedPin = (actorId: string, statusId: string) =>
  db()
    .insertInto('status_pins')
    .values({ actorId, statusId, createdAt: at, updatedAt: at })
    .execute()

// The tables whose rows hang off a status by `statusId` that the purge
// clears for the actor's statuses.
const STATUS_ID_TABLES = [
  'tags',
  'recipients',
  'likes',
  'status_reactions',
  'bookmarks',
  'attachments',
  'status_history',
  'status_link_previews',
  'poll_answers',
  'poll_voters',
  'poll_choices',
  'notifications',
  'direct_conversation_statuses'
]

// Tables cleared of the rows the actor holds on either side.
const EITHER_SIDE_TABLES = [
  'follows',
  'endorsements',
  'blocks',
  'mutes',
  'account_notes'
]

// Tables cleared of the actor's own rows.
const OWN_TABLES = [
  'lists',
  'featured_tags',
  'filters',
  'likes',
  'status_reactions',
  'bookmarks',
  'markers',
  'poll_answers',
  'poll_voters',
  'attachments',
  'gallery_album_items',
  'gallery_albums',
  'medias',
  'statuses'
]

const ACTOR_COUNTERS = (actorId: string) => [
  CounterKey.totalStatus(actorId),
  CounterKey.totalFollowers(actorId),
  CounterKey.totalFollowing(actorId),
  CounterKey.totalBlocking(actorId),
  CounterKey.totalBlockedBy(actorId),
  CounterKey.remoteCountsSyncedAt(actorId)
]

const ids = (rows: Record<string, unknown>[], column = 'id') =>
  new Set(rows.map((row) => row[column]))

// What a dump should look like after `actorId` is purged at `now`. `counters`
// gives the values the counter adjustments should leave and `tallies` the
// poll choices' new totals by choiceId. The foreign keys also cascade the
// actor's and its statuses' pins and the actor's fitness files.
const expectedAfterPurge = (
  before: TableDump,
  actorId: string,
  {
    counters = {},
    tallies = {}
  }: {
    counters?: Record<string, number>
    tallies?: Record<number, number>
  }
) => {
  const statusIds = ids(
    before.statuses.filter((row) => row.actorId === actorId)
  )
  const listIds = ids(before.lists.filter((row) => row.actorId === actorId))
  const filterIds = ids(before.filters.filter((row) => row.actorId === actorId))
  const mediaIds = ids(before.medias.filter((row) => row.actorId === actorId))
  const drop = (
    dump: TableDump,
    table: string,
    gone: (row: Record<string, unknown>) => boolean
  ) => withTable(dump, table, (rows) => rows.filter((row) => !gone(row)))

  let dump = before
  for (const table of STATUS_ID_TABLES) {
    dump = drop(dump, table, (row) => statusIds.has(row.statusId))
  }
  for (const table of EITHER_SIDE_TABLES) {
    dump = drop(
      dump,
      table,
      (row) => row.actorId === actorId || row.targetActorId === actorId
    )
  }
  for (const table of OWN_TABLES) {
    dump = drop(dump, table, (row) => row.actorId === actorId)
  }
  dump = drop(
    dump,
    'timelines',
    (row) => row.actorId === actorId || row.statusActorId === actorId
  )
  dump = drop(
    dump,
    'list_accounts',
    (row) => row.targetActorId === actorId || listIds.has(row.listId)
  )
  for (const table of ['filter_statuses', 'filter_keywords']) {
    dump = drop(dump, table, (row) => filterIds.has(row.filterId))
  }
  dump = drop(dump, 'media_edit_files', (row) => mediaIds.has(row.mediaId))
  dump = drop(
    dump,
    'notifications',
    (row) => row.actorId === actorId || row.sourceActorId === actorId
  )
  dump = drop(
    dump,
    'search_documents',
    (row) =>
      (row.entityType === 'status' && statusIds.has(row.entityId)) ||
      (row.entityType === 'account' && row.entityId === actorId)
  )
  dump = drop(dump, 'actors', (row) => row.id === actorId)
  dump = withTable(dump, 'fitness_files', (rows) =>
    rows.map((row) =>
      statusIds.has(row.statusId) ? { ...row, statusId: null } : row
    )
  )
  dump = withTable(dump, 'poll_choices', (rows) =>
    rows.map((row) =>
      (row.choiceId as number) in tallies
        ? { ...row, totalVotes: tallies[row.choiceId as number] }
        : row
    )
  )
  // Not the purge's statements: the foreign keys cascade these, on both
  // backends.
  dump = drop(
    dump,
    'status_pins',
    (row) => row.actorId === actorId || statusIds.has(row.statusId)
  )
  dump = drop(dump, 'fitness_files', (row) => row.actorId === actorId)
  const deletedCounters = new Set([
    ...ACTOR_COUNTERS(actorId),
    ...[...statusIds].flatMap((id) => [
      CounterKey.totalLike(id as string),
      CounterKey.totalReblog(id as string),
      CounterKey.totalReply(id as string)
    ])
  ])
  dump = withTable(dump, 'counters', (rows) => {
    const kept = rows
      .filter((row) => !deletedCounters.has(row.id as string))
      .map((row) =>
        (row.id as string) in counters
          ? { ...row, value: counters[row.id as string], updatedAt: now }
          : row
      )
    const existing = ids(rows)
    for (const [id, value] of Object.entries(counters)) {
      if (existing.has(id)) continue
      kept.push({ id, value, createdAt: now, updatedAt: now, bucketHour: null })
    }
    return kept
  })
  return dump
}

// The purged actor and its neighbours, with rows in every table the purge
// touches:
// - `target`, local: six statuses
//   - post: public, tagged #Cats, #cats, Dogs, a bare "#" and a mention, with
//     a poll, interactions by `n1`, every row of its own, pinned by itself
//     and by `n1`, quoted by `n1`, a fitness file each of `target`'s and
//     `n1`'s;
//   - reply: public, to n1's post by id, tagged #Cats;
//   - urlReply: public, to n1's post by its url;
//   - privateReply: followers-only, to n1's post by id, tagged #Cats;
//   - announce: of n1's post, by originalStatusId;
//   - legacyAnnounce: of n2's post, by the url in its content.
// - follows: target → n1 (accepted), target → n2 (requested), n1 → target,
//   n2 → target (accepted), n3 → target (requested); n2 → n1 (accepted)
//   stays.
// - interactions by `target` on n1's post (like, reaction, bookmark, two
//   poll votes, an attachment), n2's on it stay.
// - lists, endorsements, blocks, mutes, notes, filters, markers, featured
//   tags, media with edit files and an album, timelines, notifications: each
//   with the neighbours' own beside them.
const seedWorld = async () => {
  const target = await seedActor('target', { local: true })
  const n1 = await seedActor('n1')
  const n2 = await seedActor('n2', { local: true })
  const n3 = await seedActor('n3')
  const T = target.id

  const n1Post = await seedStatus({
    id: statusIn(n1.id, 'post'),
    actorId: n1.id
  })
  const n2Post = await seedStatus({
    id: statusIn(n2.id, 'post'),
    actorId: n2.id
  })
  const n1Choices = await seedPoll(n1Post, [3, 0, 7])
  await seedStatusRows(n1Post, n1.id, n2.id)
  await seedInteractions(n1Post, n2.id)
  await vote(n1Post, n2.id, 2)
  await seedTag(n1Post, '#Cats')

  const post = await seedStatus({ id: statusIn(T, 'post'), actorId: T })
  for (const name of ['#Cats', '#cats', 'Dogs', '#']) await seedTag(post, name)
  await seedTag(post, '@someone', 'mention')
  const postChoices = await seedPoll(post, [1])
  await vote(post, n1.id, 0)
  await seedInteractions(post, n1.id)
  await seedStatusRows(post, T, n1.id)
  await seedPin(T, post)
  await seedPin(n1.id, post)
  await seedPin(n1.id, n1Post)
  await seedFitnessFile(T, post)
  await seedFitnessFile(n1.id, post)
  await seedFitnessFile(n1.id, n1Post)
  await db()
    .insertInto('status_quotes')
    .values(
      [
        { statusId: n1Post, quotedStatusId: post, state: 'accepted' },
        { statusId: post, quotedStatusId: n2Post, state: 'accepted' }
      ].map((row) => ({ ...row, createdAt: at, updatedAt: at }))
    )
    .execute()

  const reply = await seedStatus({
    id: statusIn(T, 'reply'),
    actorId: T,
    reply: n1Post
  })
  await seedTag(reply, '#Cats')
  const urlReply = await seedStatus({
    id: statusIn(T, 'url-reply'),
    actorId: T,
    reply: `${n1Post}/page`
  })
  const privateReply = await seedStatus({
    id: statusIn(T, 'private-reply'),
    actorId: T,
    to: [`${T}/followers`],
    reply: n1Post
  })
  await seedTag(privateReply, '#Cats')
  const announce = await seedStatus({
    id: statusIn(T, 'announce'),
    actorId: T,
    type: StatusType.enum.Announce,
    content: null,
    originalStatusId: n1Post
  })
  const legacyAnnounce = await seedStatus({
    id: statusIn(T, 'legacy-announce'),
    actorId: T,
    type: StatusType.enum.Announce,
    content: JSON.stringify({ url: n2Post })
  })

  await seedFollow(T, n1.id, 'Accepted')
  await seedFollow(T, n2.id, 'Requested')
  await seedFollow(n1.id, T, 'Accepted')
  await seedFollow(n2.id, T, 'Accepted')
  await seedFollow(n3.id, T, 'Requested')
  await seedFollow(n2.id, n1.id, 'Accepted')

  await seedInteractions(n1Post, T)
  await vote(n1Post, T, 0)
  await vote(n1Post, T, 1)
  await db()
    .insertInto('attachments')
    .values({
      id: randomUUID(),
      statusId: n1Post,
      actorId: T,
      url: `https://${DOMAIN}/media/${next()}.png`,
      mediaType: 'image/png',
      type: 'Document',
      createdAt: at,
      updatedAt: at
    })
    .execute()

  await seedList(T, [n1.id, n2.id])
  await seedList(n1.id, [T, n2.id])
  await seedPairRows(T, n1.id)
  await seedPairRows(n2.id, T)
  await seedPairRows(n1.id, n2.id)
  await seedSettings(T, n1Post)
  await seedSettings(n1.id, post)

  const media = await seedMedia(T, target.accountId, 100, 10)
  await seedEditFile(media, T, 5)
  await seedEditFile(media, T, 7)
  await seedAlbum(T, media)
  await seedMedia(T, target.accountId, null, null)
  const n2Media = await seedMedia(n2.id, n2.accountId, 50, 5)
  await seedEditFile(n2Media, n2.id, 3)
  await seedAlbum(n2.id, n2Media)

  await seedTimeline(T, n1Post, n1.id)
  await seedTimeline(n1.id, post, T)
  await seedTimeline(n1.id, n2Post, n2.id)
  for (const [actorId, sourceActorId] of [
    [T, n1.id],
    [n1.id, T],
    [n2.id, n1.id]
  ]) {
    await db()
      .insertInto('notifications')
      .values({
        id: randomUUID(),
        actorId,
        type: 'follow',
        sourceActorId,
        createdAt: at,
        updatedAt: at
      })
      .execute()
  }

  const counters: Record<string, number> = {
    [CounterKey.totalStatus(T)]: 6,
    [CounterKey.totalFollowers(T)]: 2,
    [CounterKey.totalFollowing(T)]: 1,
    [CounterKey.totalBlocking(T)]: 1,
    [CounterKey.totalBlockedBy(T)]: 1,
    [CounterKey.remoteCountsSyncedAt(T)]: 1_700_000_000,
    [CounterKey.totalFollowers(n1.id)]: 10,
    [CounterKey.totalFollowing(n1.id)]: 10,
    [CounterKey.totalFollowing(n2.id)]: 10,
    [CounterKey.totalFollowers(n2.id)]: 10,
    [CounterKey.totalFollowing(n3.id)]: 10,
    [CounterKey.totalBlockedBy(n1.id)]: 10,
    [CounterKey.totalBlocking(n2.id)]: 10,
    [CounterKey.totalBlocking(n1.id)]: 10,
    [CounterKey.totalLike(n1Post)]: 10,
    [CounterKey.totalReblog(n1Post)]: 10,
    [CounterKey.totalReply(n1Post)]: 10,
    [CounterKey.totalReblog(n2Post)]: 10,
    [CounterKey.serviceTotalStatuses()]: 100,
    [CounterKey.serviceTotalActors()]: 20,
    [CounterKey.nodeinfoTotalUsers()]: 20,
    [CounterKey.nodeinfoLocalPosts()]: 100,
    [CounterKey.mediaUsage(target.accountId as string)]: 1_000,
    [CounterKey.mediaUsage(n2.accountId as string)]: 1_000,
    [CounterKey.totalHashtag('cats')]: 10,
    [CounterKey.totalHashtag('dogs')]: 10
  }
  for (const [id, value] of Object.entries(counters)) {
    await setCounter(id, value)
  }
  return {
    target,
    n1,
    n2,
    n1Post,
    n2Post,
    n1Choices,
    postChoices,
    statuses: [post, reply, urlReply, privateReply, announce, legacyAnnounce]
  }
}

const refreshSpy = () =>
  vi
    .spyOn(searchQueries, 'indexHashtagSearchDocuments')
    .mockResolvedValue(undefined)

beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
  await db()
    .insertInto('link_previews')
    .values({
      urlHash: SHARED_PREVIEW,
      url: 'https://example.com/shared',
      createdAt: at,
      updatedAt: at
    })
    .execute()
})

afterAll(async () => {
  await testDb.destroy()
})

beforeEach(() => {
  prefixCount += 1
  prefix = `ad${prefixCount}`
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

describe('deleteActorData', () => {
  it('purges the actor and every row it left, moves back its counters and touches nothing else', async () => {
    const w = await seedWorld()
    const T = w.target.id
    const refresh = refreshSpy()
    const before = await dumpDatabase(testDb)

    await deleteActorData(db(), { actorId: T })

    expect(await dumpDatabase(testDb)).toEqual(
      expectedAfterPurge(before, T, {
        counters: {
          // its six statuses, the local actor's posts and user
          [CounterKey.serviceTotalStatuses()]: 94,
          [CounterKey.nodeinfoLocalPosts()]: 94,
          [CounterKey.serviceTotalActors()]: 19,
          [CounterKey.nodeinfoTotalUsers()]: 19,
          // the accepted follow of n1; the requested one of n2 never counted
          [CounterKey.totalFollowers(w.n1.id)]: 9,
          // n1 and n2 followed it; n3 only asked to, which never counted
          [CounterKey.totalFollowing(w.n1.id)]: 9,
          [CounterKey.totalFollowing(w.n2.id)]: 9,
          // it blocked n1; n2 blocked it
          [CounterKey.totalBlockedBy(w.n1.id)]: 9,
          [CounterKey.totalBlocking(w.n2.id)]: 9,
          // its like of n1's post
          [CounterKey.totalLike(w.n1Post)]: 9,
          // the announces, by originalStatusId and by the content's url
          [CounterKey.totalReblog(w.n1Post)]: 9,
          [CounterKey.totalReblog(w.n2Post)]: 9,
          // the public replies by id and by url; not the followers-only one
          [CounterKey.totalReply(w.n1Post)]: 8,
          // 100 + 10 + 5 + 7 bytes, the empty media counting 0
          [CounterKey.mediaUsage(w.target.accountId as string)]: 878,
          // #Cats and #cats on the post, #Cats on the public reply; the
          // followers-only reply's #Cats never counted, the bare # is skipped
          [CounterKey.totalHashtag('cats')]: 7,
          [CounterKey.totalHashtag('dogs')]: 9
        },
        // its two votes on n1's poll: 3 → 2 and 0 stays 0
        tallies: { [w.n1Choices[0]]: 2, [w.n1Choices[1]]: 0 }
      })
    )
    // The tags of every one of its statuses are refreshed, once, after the
    // commit.
    expect(refresh).toHaveBeenCalledTimes(1)
    const [refreshDb, params] = refresh.mock.calls[0]
    expect(isInTransaction(refreshDb)).toBe(false)
    expect([...params.hashtags].sort()).toEqual(['#', '#Cats', '#cats', 'Dogs'])
  })

  it('moves no account counter for a remote actor', async () => {
    const remote = await seedActor('remote')
    const post = await seedStatus({
      id: statusIn(remote.id, 'post'),
      actorId: remote.id
    })
    await seedMedia(remote.id, null, 100, 10)
    for (const id of [
      CounterKey.serviceTotalStatuses(),
      CounterKey.serviceTotalActors(),
      CounterKey.nodeinfoTotalUsers(),
      CounterKey.nodeinfoLocalPosts(),
      CounterKey.totalStatus(remote.id)
    ]) {
      await setCounter(id, 50)
    }
    refreshSpy()
    const before = await dumpDatabase(testDb)

    await deleteActorData(db(), { actorId: remote.id })

    expect(await dumpDatabase(testDb)).toEqual(
      expectedAfterPurge(before, remote.id, {
        counters: { [CounterKey.serviceTotalStatuses()]: 49 }
      })
    )
    expect(before.statuses.some((row) => row.id === post)).toBe(true)
  })

  it('changes nothing for an actor that does not exist', async () => {
    await seedWorld()
    const refresh = refreshSpy()
    const before = await dumpDatabase(testDb)
    await deleteActorData(db(), { actorId: actorIn('nobody') })
    expect(await dumpDatabase(testDb)).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
  })

  // A vote stores the choice's index, read against the choices in choiceId
  // order. Updating the first choice moves its PostgreSQL row version behind
  // the second, so an unordered read would return the choices the other way
  // round.
  it('takes back a vote from the choice at its index in choiceId order', async () => {
    const voter = await seedActor('voter')
    const owner = await seedActor('owner')
    const poll = await seedStatus({
      id: statusIn(owner.id, 'poll'),
      actorId: owner.id
    })
    const [first, second] = await seedPoll(poll, [5, 5])
    await db()
      .updateTable('poll_choices')
      .set({ title: 'first, edited' })
      .where('choiceId', '=', first)
      .execute()
    await vote(poll, voter.id, 0)
    refreshSpy()
    await deleteActorData(db(), { actorId: voter.id })
    expect(
      await db()
        .selectFrom('poll_choices')
        .select(['choiceId', 'totalVotes'])
        .where('statusId', '=', poll)
        .orderBy('choiceId')
        .execute()
    ).toEqual([
      { choiceId: first, totalVotes: 4 },
      { choiceId: second, totalVotes: 5 }
    ])
  })

  it('keeps `limit 1` on its first read', async () => {
    const actor = await seedActor('limit')
    refreshSpy()
    const { statements } = await capture(testDb, () =>
      deleteActorData(db(), { actorId: actor.id })
    )
    expect(statements[1].sql).toMatch(
      /^select "accountId" from "actors" where "id" = (\?|\$1) limit (\?|\$2)$/
    )
    expect(statements[1].bindings).toEqual([actor.id, 1])
  })
})

// `<verb> <table> by <first where column>`, the counters by id.
const shape = ({ sql, bindings }: Statement) => {
  if (/^(begin|commit|rollback)$/.test(sql)) return sql
  if (/^insert into "counters"/.test(sql)) return `adjust ${bindings[0]}`
  if (/^delete from "counters" where "id" = /.test(sql)) {
    return `delete counter ${bindings[0]}`
  }
  if (/^delete from "counters" where "id" in/.test(sql)) {
    return `delete counters ×${bindings.length}`
  }
  const verb = sql.startsWith('delete') ? 'delete' : sql.split(' ')[0]
  const table =
    verb === 'update'
      ? /^update "(\w+)"/.exec(sql)?.[1]
      : /from "(\w+)"/.exec(sql)?.[1]
  const where = /where \(?"(\w+)"/.exec(sql)?.[1]
  return `${verb} ${table}${where ? ` by ${where}` : ''}`
}

describe('statements', () => {
  // One of each: every map the purge builds has a single entry, so the
  // statement order does not hang on row order.
  const seedSmallWorld = async () => {
    const target = await seedActor('target', { local: true })
    const n1 = await seedActor('n1')
    const n2 = await seedActor('n2')
    const T = target.id
    const n1Post = await seedStatus({
      id: statusIn(n1.id, 'post'),
      actorId: n1.id
    })
    await seedPoll(n1Post, [2])
    const reply = await seedStatus({
      id: statusIn(T, 'reply'),
      actorId: T,
      reply: n1Post
    })
    await seedTag(reply, '#Cats')
    const announce = await seedStatus({
      id: statusIn(T, 'announce'),
      actorId: T,
      type: StatusType.enum.Announce,
      content: null,
      originalStatusId: n1Post
    })
    await seedFollow(T, n1.id, 'Accepted')
    await seedFollow(n2.id, T, 'Accepted')
    await seedInteractions(n1Post, T)
    await vote(n1Post, T, 0)
    await seedList(T, [n1.id])
    await seedPairRows(T, n1.id)
    await seedPairRows(n2.id, T)
    await seedMedia(T, target.accountId, 10, 1)
    return { target, n1, n2, n1Post, reply, announce }
  }

  const purgeSteps = ({
    target,
    n1,
    n2,
    n1Post
  }: Awaited<ReturnType<typeof seedSmallWorld>>) => {
    const T = target.id
    return [
      'begin',
      'select actors by id',
      'select statuses by actorId',
      'select recipients by statusId',
      'select statuses by id',
      `adjust ${CounterKey.totalStatus(T)}`,
      `adjust ${CounterKey.serviceTotalStatuses()}`,
      `adjust ${CounterKey.serviceTotalActors()}`,
      `adjust ${CounterKey.totalReblog(n1Post)}`,
      `adjust ${CounterKey.totalReply(n1Post)}`,
      'select follows by actorId',
      `adjust ${CounterKey.totalFollowing(T)}`,
      `adjust ${CounterKey.totalFollowers(n1.id)}`,
      'select follows by targetActorId',
      `adjust ${CounterKey.totalFollowers(T)}`,
      `adjust ${CounterKey.totalFollowing(n2.id)}`,
      'select likes by actorId',
      `adjust ${CounterKey.totalLike(n1Post)}`,
      'select medias by actorId',
      'select media_edit_files by mediaId',
      `adjust ${CounterKey.mediaUsage(target.accountId as string)}`,
      'select tags by type',
      `adjust ${CounterKey.totalHashtag('cats')}`,
      ...[
        'tags',
        'recipients',
        'likes',
        'status_reactions',
        'bookmarks',
        'attachments',
        'status_history',
        'status_link_previews',
        'poll_answers',
        'poll_voters',
        'poll_choices',
        'notifications',
        'direct_conversation_statuses'
      ].map((table) => `delete ${table} by statusId`),
      'update fitness_files by statusId',
      'delete timelines by actorId',
      'delete timelines by statusActorId',
      'delete statuses by actorId',
      'delete search_documents by entityType',
      'delete follows by actorId',
      'delete follows by targetActorId',
      'delete list_accounts by targetActorId',
      'select lists by actorId',
      'delete list_accounts by listId',
      'delete lists by actorId',
      'delete endorsements by actorId',
      'delete endorsements by targetActorId',
      'delete featured_tags by actorId',
      'select blocks by actorId',
      // Sent together (Promise.all): the blockers' then the blocked's.
      `adjust ${CounterKey.totalBlocking(n2.id)}`,
      `adjust ${CounterKey.totalBlockedBy(n1.id)}`,
      'delete blocks by actorId',
      'delete mutes by actorId',
      'delete account_notes by actorId',
      'delete filter_statuses by filterId',
      'delete filter_keywords by filterId',
      'delete filters by actorId',
      'delete likes by actorId',
      'delete status_reactions by actorId',
      'delete bookmarks by actorId',
      'delete markers by actorId',
      'select poll_answers by actorId',
      'select poll_choices by statusId',
      'update poll_choices by statusId',
      'delete poll_answers by actorId',
      'delete poll_voters by actorId',
      'delete attachments by actorId',
      'delete gallery_album_items by actorId',
      'delete gallery_albums by actorId',
      'delete media_edit_files by mediaId',
      'delete medias by actorId',
      ...ACTOR_COUNTERS(T).map((id) => `delete counter ${id}`),
      `adjust ${CounterKey.nodeinfoTotalUsers()}`,
      `adjust ${CounterKey.nodeinfoLocalPosts()}`,
      // like, reblog and reply of its two statuses
      'delete counters ×6',
      'delete notifications by actorId',
      'delete notifications by sourceActorId',
      // The actor row and its search document last.
      'delete actors by id',
      'delete search_documents by entityType',
      'commit'
    ]
  }

  it('runs the purge in one transaction, in order, the actor last', async () => {
    const w = await seedSmallWorld()
    refreshSpy()
    const { statements } = await capture(testDb, () =>
      deleteActorData(db(), { actorId: w.target.id })
    )
    expect(statements.map(shape)).toEqual(purgeSteps(w))
    // The poll tally update is the CASE clamp, as before.
    expect(
      statements.find(({ sql }) => sql.startsWith('update "poll_choices"'))?.sql
    ).toMatch(
      /^update "poll_choices" set "totalVotes" = CASE WHEN "totalVotes" > (\?|\$1) THEN "totalVotes" - (\?|\$2) ELSE 0 END where "statusId" = (\?|\$3) and "choiceId" = (\?|\$4)$/
    )
    // The last search document delete is the actor's own.
    expect(statements.at(-2)?.bindings).toEqual(['account', w.target.id])
  })

  it('splits its IN lists at the batch size; the parent read stays one statement', async () => {
    const CAP = 4
    const target = await seedActor('target', { local: true })
    const other = await seedActor('other')
    const T = target.id
    const parents: string[] = []
    const votedPolls: string[] = []
    for (let index = 0; index < 5; index += 1) {
      parents.push(
        await seedStatus({
          id: statusIn(other.id, `parent-${index}`),
          actorId: other.id
        })
      )
      votedPolls.push(parents[index])
      await seedPoll(parents[index], [4])
      await vote(parents[index], T, 0)
      const own = await seedStatus({
        id: statusIn(T, `reply-${index}`),
        actorId: T,
        reply: parents[index]
      })
      await seedTag(own, '#Cats')
      await seedStatusRows(own, T, other.id)
      await seedList(T, [other.id])
      await setCounter(CounterKey.totalReply(parents[index]), 3)
    }
    for (const id of [
      CounterKey.serviceTotalStatuses(),
      CounterKey.serviceTotalActors(),
      CounterKey.nodeinfoTotalUsers(),
      CounterKey.nodeinfoLocalPosts(),
      CounterKey.totalHashtag('cats')
    ]) {
      await setCounter(id, 50)
    }
    refreshSpy()
    const before = await dumpDatabase(testDb)
    batchCap.value = CAP
    const { statements } = await capture(testDb, () =>
      deleteActorData(db(), { actorId: T })
    )
    batchCap.value = 0

    expect(await dumpDatabase(testDb)).toEqual(
      expectedAfterPurge(before, T, {
        counters: {
          [CounterKey.serviceTotalStatuses()]: 45,
          [CounterKey.nodeinfoLocalPosts()]: 45,
          [CounterKey.serviceTotalActors()]: 49,
          [CounterKey.nodeinfoTotalUsers()]: 49,
          [CounterKey.totalHashtag('cats')]: 45,
          ...Object.fromEntries(
            parents.map((id) => [CounterKey.totalReply(id), 2])
          )
        },
        // one vote off each poll's only choice
        tallies: Object.fromEntries(
          before.poll_choices
            .filter((row) => votedPolls.includes(row.statusId as string))
            .map((row) => [row.choiceId as number, 3])
        )
      })
    )

    const count = (pattern: RegExp) =>
      statements.filter(({ sql }) => pattern.test(sql)).length
    // Five statuses in chunks of 4.
    expect(count(/^delete from "tags" where "statusId" in/)).toBe(2)
    expect(count(/^delete from "direct_conversation_statuses"/)).toBe(2)
    expect(count(/^update "fitness_files"/)).toBe(2)
    // One value reserved for the tag type, two for the public recipients,
    // one for the entity type.
    expect(count(/^select "statusId", "name" from "tags"/)).toBe(2)
    expect(count(/^select distinct "statusId" from "recipients"/)).toBe(3)
    expect(
      count(
        /^delete from "search_documents" where "entityType" = \S+ and "entityId" in/
      )
    ).toBe(2)
    // Five owned lists, five voted polls, fifteen status counters.
    expect(count(/^delete from "list_accounts" where "listId" in/)).toBe(2)
    expect(count(/^select "statusId", "choiceId" from "poll_choices"/)).toBe(2)
    expect(count(/^delete from "counters" where "id" in/)).toBe(4)
    // Unchunked, as before: all five references, three times each.
    const parentReads = statements.filter(({ sql }) =>
      /^select "id", "url" from "statuses"/.test(sql)
    )
    expect(parentReads).toHaveLength(1)
    expect(parentReads[0].bindings).toHaveLength(15)
  })
})

describe('rollback', () => {
  it('rolls the purge back in full when its last write fails', async () => {
    const w = await seedWorld()
    const refresh = refreshSpy()
    const drop = await failWrite(
      testDb,
      'search_documents',
      'delete',
      `old."entityType" = 'account' and old."entityId" = ${quote(w.target.id)}`
    )
    const before = await dumpDatabase(testDb)
    try {
      await expect(
        deleteActorData(db(), { actorId: w.target.id })
      ).rejects.toThrow(/^forced failure$/)
    } finally {
      await drop()
    }
    expect(await dumpDatabase(testDb)).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('hashtag refresh', () => {
  it('logs a failed refresh and still resolves, the purge committed', async () => {
    const w = await seedWorld()
    const failure = new Error('refresh failed')
    vi.spyOn(searchQueries, 'indexHashtagSearchDocuments').mockRejectedValue(
      failure
    )
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    await expect(
      deleteActorData(db(), { actorId: w.target.id })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      {
        actorId: w.target.id,
        err: failure,
        hashtags: expect.arrayContaining(['#', '#Cats', '#cats', 'Dogs'])
      },
      'Failed to refresh hashtag search documents after actor deletion'
    )
    expect(
      await db()
        .selectFrom('actors')
        .select('id')
        .where('id', '=', w.target.id)
        .execute()
    ).toEqual([])
  })

  it('refreshes nothing for an actor without statuses', async () => {
    const actor = await seedActor('quiet')
    const refresh = refreshSpy()
    await deleteActorData(db(), { actorId: actor.id })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes the real hashtag documents after the commit', async () => {
    const actor = await seedActor('tagger')
    const post = await seedStatus({
      id: statusIn(actor.id, 'post'),
      actorId: actor.id
    })
    const tag = `#${prefix}refresh`
    await seedTag(post, tag)
    await db()
      .insertInto('search_documents')
      .values({
        id: `hashtag:${prefix}refresh`,
        entityType: 'hashtag',
        entityId: `${prefix}refresh`,
        documentText: `${prefix}refresh`,
        createdAt: at,
        updatedAt: at
      })
      .execute()
    await deleteActorData(db(), { actorId: actor.id })
    // The hashtag lost its only status: its document goes.
    expect(
      await db()
        .selectFrom('search_documents')
        .select('id')
        .where('entityType', '=', 'hashtag')
        .where('entityId', '=', `${prefix}refresh`)
        .execute()
    ).toEqual([])
  })
})

describe('behaviour changes', () => {
  // A status and a follow with a NULL actor: Knex compiled
  // `where("actorId", null)` to IS NULL and purged them; Kysely binds NULL,
  // which matches nothing. An undefined id made Knex throw "Undefined
  // binding(s)"; Kysely binds it as NULL too.
  it.each([
    ['null', null],
    ['undefined', undefined]
  ])('purges nothing for a %s actor id', async (_name, actorId) => {
    const actor = await seedActor('kept')
    await seedStatus({ id: `${actor.id}/statuses/orphan`, actorId: null })
    await seedFollow(actor.id, actor.id, 'Accepted')
    await db()
      .insertInto('follows')
      .values({
        id: randomUUID(),
        actorId: null,
        targetActorId: actor.id,
        status: 'Accepted',
        createdAt: at,
        updatedAt: at
      })
      .execute()
    refreshSpy()
    const before = await dumpDatabase(testDb)
    await deleteActorData(db(), { actorId: actorId as unknown as string })
    expect(await dumpDatabase(testDb)).toEqual(before)
  })

  // A media of more than 2^53 - 1 bytes: Knex returned the int8 as a string
  // and parseCounterValue clamped it; Kysely's PostgreSQL reads throw a
  // RangeError, which rolls the purge back.
  it.runIf(testDb.backend === 'pg')(
    'fails and rolls back on a media size above 2^53 - 1 bytes',
    async () => {
      const actor = await seedActor('big', { local: true })
      await seedStatus({ id: statusIn(actor.id, 'post'), actorId: actor.id })
      await testDb.knex('medias').insert({
        actorId: actor.id,
        accountId: actor.accountId,
        original: 'big',
        originalMimeType: 'image/png',
        originalBytes: '9007199254740994',
        thumbnailBytes: 1,
        originalMetaData: '{}',
        createdAt: at,
        updatedAt: at
      })
      const refresh = refreshSpy()
      const before = await dumpDatabaseWithoutBigMedia()
      await expect(
        deleteActorData(db(), { actorId: actor.id })
      ).rejects.toThrow(RangeError)
      expect(await dumpDatabaseWithoutBigMedia()).toEqual(before)
      expect(refresh).not.toHaveBeenCalled()
    }
  )
})

// The dump reads medias through Kysely too, which cannot read the oversized
// size either: it is left out, and its row is checked as text.
const dumpDatabaseWithoutBigMedia = async () => {
  const dump = await dumpDatabase(testDb, ['medias'])
  const { rows } = await testDb.knex.raw(
    'select id, "originalBytes"::text as bytes from medias order by id'
  )
  return { ...dump, medias: rows }
}

describe.runIf(testDb.backend === 'pg')('PostgreSQL locks', () => {
  // The purge is one transaction: stopped after its last statement, it still
  // holds the counter rows it moved, so a like counted on the same status
  // waits until it commits, and both adjustments land.
  it('holds the counters it moved until it commits', async () => {
    const w = await seedWorld()
    refreshSpy()
    const last = pauseAfterStatement((sql) =>
      /^delete from "search_documents" where "entityType" = \$1 and "entityId" = \$2$/.test(
        sql
      )
    )
    const purge = start(() => deleteActorData(db(), { actorId: w.target.id }))
    await last.reached

    const like = start(() =>
      increaseCounterValue(db(), CounterKey.totalLike(w.n1Post))
    )
    const waiting = await waitForLockWait(testDb, like)
    expect(waiting).toEqual([expect.stringMatching(/^insert into "counters" /)])
    last.release()
    await purge.result()
    await like.result()
    expect(
      (
        await db()
          .selectFrom('counters')
          .select('value')
          .where('id', '=', CounterKey.totalLike(w.n1Post))
          .executeTakeFirstOrThrow()
      ).value
    ).toBe(10)
  })
})
