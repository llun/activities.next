import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { applyFiltersToStatus } from '@/lib/services/filters/applyFilters'
import {
  getMastodonFilter,
  getMastodonFilterStatus,
  getMastodonFilters,
  getV1Filter,
  hydrateFilterRecordStatusPublicIds,
  hydrateFilterStatusPublicIds
} from '@/lib/services/mastodon/getMastodonFilter'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Status } from '@/lib/types/domain/status'
import { V1Filter } from '@/lib/types/mastodon'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { generatePublicId } from '@/lib/utils/publicId'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

let knexDatabase: Knex
let database: Database

beforeAll(async () => {
  knexDatabase = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  database = getSQLDatabase(knexDatabase)
  await database.migrate()
  await seedDatabase(database)
})

afterAll(async () => {
  await database.destroy()
})

// A real status row, so its publicId is the one the database minted rather than
// a literal this test made up.
const createStatus = async (
  slug: string,
  id = `${ACTOR1_ID}/statuses/${slug}`
): Promise<{ status: Status; publicId: string }> => {
  const status = await database.createNote({
    id,
    url: `https://llun.test/@test1/${slug}`,
    actorId: ACTOR1_ID,
    text: slug,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: []
  })
  const publicId = (await database.getStatusPublicIds({ statusIds: [id] })).get(
    id
  )
  if (!publicId) throw new Error('created status has no publicId')
  return { status, publicId }
}

describe('getMastodonFilter', () => {
  it('serializes a domain filter into the Mastodon API shape', async () => {
    const { status, publicId } = await createStatus('filter-shape')
    const expiresAt = Date.now() + 60_000
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Apple',
      context: ['home', 'public'],
      filterAction: 'warn',
      expiresAt,
      keywords: [{ keyword: 'apple', wholeWord: true }]
    })
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: status.id
    })

    const result = await getMastodonFilter(database, filter)

    expect(result.id).toBe(filter.id)
    expect(result.title).toBe('Apple')
    expect(result.context.sort()).toEqual(['home', 'public'])
    expect(result.filter_action).toBe('warn')
    expect(result.expires_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
    expect(result.keywords).toHaveLength(1)
    expect(result.keywords[0]).toMatchObject({
      keyword: 'apple',
      whole_word: true
    })
    expect(result.statuses).toHaveLength(1)
    // Stored as the resolved URI, emitted as the publicId every other status
    // reference in the API carries.
    expect(result.statuses[0].status_id).toBe(publicId)
  })

  it('falls back to the legacy colon form for a row with no status to resolve', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Unknown status',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null
    })
    // The column has no foreign key, so a row can outlive (or precede) its
    // status.
    const unknownStatusUri = `${ACTOR1_ID}/statuses/never-stored`
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: unknownStatusUri
    })

    const result = await getMastodonFilter(database, filter)

    expect(result.statuses[0].status_id).toBe(urlToId(unknownStatusUri))
  })

  it('serializes multiple filters via the batched helper', async () => {
    const a = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'A',
      context: ['home'],
      filterAction: 'hide',
      expiresAt: null
    })
    const b = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'B',
      context: ['public'],
      filterAction: 'warn',
      expiresAt: null
    })

    const result = await getMastodonFilters(database, [a, b])

    expect(result.map((entry) => entry.title)).toEqual(['A', 'B'])
    expect(result[0].expires_at).toBeNull()
    expect(result[0].filter_action).toBe('hide')
  })
})

describe('hydrateFilterStatusPublicIds', () => {
  const buildRow = (statusId: string) => ({
    id: `fs:${statusId}`,
    filterId: 'filter-1',
    statusId,
    createdAt: 0
  })

  // The stored value can name the status in three ways, and the first two both
  // have to reach the same publicId: a filter written before the flip must not
  // report a different id from one written after it.
  it('resolves the publicId from a stored uri and from a stored colon form', async () => {
    const { status, publicId } = await createStatus('hydrate-forms')

    const hydrated = await hydrateFilterStatusPublicIds(database, [
      buildRow(status.id),
      buildRow(urlToId(status.id))
    ])

    expect(hydrated.map((row) => row.statusPublicId)).toEqual([
      publicId,
      publicId
    ])
  })

  it('leaves a row that already stores a bare publicId unresolved', async () => {
    const { publicId } = await createStatus('hydrate-bare-public-id')

    const [hydrated] = await hydrateFilterStatusPublicIds(database, [
      buildRow(publicId)
    ])

    // Nothing to resolve: `statuses.id` is the URI, and the row already holds
    // the emitted form, which getMastodonFilterStatus echoes unchanged.
    expect(hydrated.statusPublicId).toBeNull()
    expect(getMastodonFilterStatus(hydrated).status_id).toBe(publicId)
  })

  it('resolves nothing for a status this instance does not have', async () => {
    const [hydrated] = await hydrateFilterStatusPublicIds(database, [
      buildRow('https://remote.test/users/someone/statuses/1')
    ])

    expect(hydrated.statusPublicId).toBeNull()
  })

  // The record form flattens every row into one query and slices the results
  // back out by offset, so a record with no rows in the middle is the case that
  // would mis-assign one filter's publicId to another.
  it('returns each record its own rows when hydrating several at once', async () => {
    const first = await createStatus('hydrate-record-first')
    const second = await createStatus('hydrate-record-second')
    const buildRecord = (id: string, statusIds: string[]) => ({
      filter: {
        id,
        actorId: ACTOR1_ID,
        title: id,
        context: ['home' as const],
        filterAction: 'warn' as const,
        expiresAt: null,
        createdAt: 0,
        updatedAt: 0
      },
      keywords: [],
      statuses: statusIds.map(buildRow)
    })

    const hydrated = await hydrateFilterRecordStatusPublicIds(database, [
      buildRecord('one-row', [first.status.id]),
      buildRecord('no-rows', []),
      buildRecord('two-rows', [
        second.status.id,
        `${ACTOR1_ID}/statuses/hydrate-record-missing`
      ])
    ])

    expect(
      hydrated.map((record) => record.statuses.map((row) => row.statusPublicId))
    ).toEqual([[first.publicId], [], [second.publicId, null]])
  })
})

describe('filter status id emission', () => {
  // One response names the same status twice — in `filtered[].status_matches`
  // and in the `filter.statuses[]` beside it — so the two must agree. The
  // agreement cannot rest on `idToUrl(urlToId(id))` being the identity, because
  // it is not: urlToId normalizes the host, and a remote note delivered to the
  // inbox keeps whatever `note.id` the sender wrote (createNoteJob stores it
  // verbatim). A row holding the colon form of such an id rebuilds a lookup key
  // `statuses.id` is not keyed by, the hydration resolves nothing, and both
  // halves have to fall back TOGETHER.
  it('emits one id form when the stored row cannot rebuild the status uri', async () => {
    const { status, publicId } = await createStatus(
      'uppercase-host',
      'https://Remote.Example/users/alice/statuses/1'
    )
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Uppercase host',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null
    })
    // The legacy colon form, as a row written before the route resolved client
    // ids holds it.
    const storedStatusId = urlToId(status.id)
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: storedStatusId
    })
    const statuses = await database.getFilterStatuses({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    const [record] = await hydrateFilterRecordStatusPublicIds(database, [
      { filter, keywords: [], statuses: statuses ?? [] }
    ])

    // The lossy round trip, spelled out: the rebuilt key is not the id the
    // status is stored under, so the batched lookup cannot find the row.
    expect(idToUrl(storedStatusId)).not.toBe(status.id)
    expect(record.statuses[0].statusPublicId).toBeNull()

    const [result] = applyFiltersToStatus(status, [record])
    expect(result.status_matches).toEqual([storedStatusId])
    expect(result.filter.statuses.map((entry) => entry.status_id)).toEqual(
      result.status_matches
    )
    // The status does have a publicId — it is simply unreachable from this row,
    // and the response says so in one voice instead of two.
    expect(result.status_matches).not.toContain(publicId)
  })
})

describe('getMastodonFilterStatus', () => {
  const statusUri = 'https://llun.test/users/test1/statuses/100'
  const publicId = generatePublicId()
  const resolvedPublicId = generatePublicId()

  // A hydrated row emits the publicId whatever form it is stored in, so a
  // client never sees two ids for one status. A row with none to emit — a
  // pre-backfill status, or one this instance does not have — falls back to the
  // stored form: the legacy colon form for a URI, and byte-identical for
  // anything else, since running urlToId over a bare publicId would append a
  // spurious `:` to an id the client never wrote.
  it.each([
    {
      description: 'a resolved uri with a publicId',
      stored: statusUri,
      statusPublicId: resolvedPublicId,
      emitted: resolvedPublicId
    },
    {
      description: 'a legacy colon form with a publicId',
      stored: urlToId(statusUri),
      statusPublicId: resolvedPublicId,
      emitted: resolvedPublicId
    },
    {
      description: 'an unresolved uri',
      stored: statusUri,
      statusPublicId: null,
      emitted: urlToId(statusUri)
    },
    {
      description: 'an unresolved legacy colon form',
      stored: urlToId(statusUri),
      statusPublicId: null,
      emitted: urlToId(statusUri)
    },
    {
      description: 'an unresolvable bare publicId',
      stored: publicId,
      statusPublicId: null,
      emitted: publicId
    }
  ])(
    'emits the client id for a row stored as $description',
    ({ stored, statusPublicId, emitted }) => {
      expect(
        getMastodonFilterStatus({
          id: 'filter-status-1',
          filterId: 'filter-1',
          statusId: stored,
          statusPublicId,
          createdAt: 0
        })
      ).toEqual({ id: 'filter-status-1', status_id: emitted })
    }
  )
})

describe('getV1Filter', () => {
  const baseKeyword = {
    id: 'keyword-1',
    filterId: 'filter-1',
    keyword: 'apple',
    wholeWord: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  }

  it('builds the v1 row from the keyword and its parent filter', () => {
    const result = getV1Filter(
      {
        context: ['home', 'public'],
        expiresAt: Date.UTC(2026, 0, 2, 3, 4, 5, 6),
        filterAction: 'warn'
      },
      baseKeyword
    )

    expect(result).toEqual({
      id: 'keyword-1',
      phrase: 'apple',
      context: ['home', 'public'],
      expires_at: '2026-01-02T03:04:05.006Z',
      irreversible: false,
      whole_word: true
    })
    expect(V1Filter.safeParse(result).success).toBe(true)
  })

  it.each([
    {
      description: 'maps filter_action warn to irreversible=false',
      filterAction: 'warn' as const,
      expected: false
    },
    {
      description: 'maps filter_action hide to irreversible=true',
      filterAction: 'hide' as const,
      expected: true
    }
  ])('$description', ({ filterAction, expected }) => {
    const result = getV1Filter(
      { context: ['home'], expiresAt: null, filterAction },
      baseKeyword
    )

    expect(result.irreversible).toBe(expected)
    expect(result.expires_at).toBeNull()
  })
})
