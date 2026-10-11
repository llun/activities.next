import { type Insertable, sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import type {
  Attachments,
  GalleryAlbums,
  Medias
} from '@/lib/database/kysely/db'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  type GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { toSubjectKey } from '@/lib/services/gallery/galleryEntities'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Every `in` list is chunked by `getWhereInBatchSize`. Capped at 2 here, so
// the album reads and writes cross chunk boundaries with a few rows.
vi.mock('@/lib/database/kysely/inList', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/kysely/inList')>()
  return {
    ...original,
    getWhereInBatchSize: (
      ...args: Parameters<typeof original.getWhereInBatchSize>
    ) => Math.min(original.getWhereInBatchSize(...args), 2)
  }
})

const DOMAIN = 'galleryalbums.test'

// Every `where`, `orderBy`, `limit` and cursor of the album store
// (lib/database/domains/gallery/albums.ts), each pinned with a neighbouring
// row the query must not touch: another actor's albums and items, private
// albums for each audience, hidden or unposted media inside an album, items
// written for another actor and items of another album. Orders are pinned with
// rows the database would not return in that order unaided: ids that sort
// against `updatedAt` and insertion, ties inserted in id order in one group
// and against it in another, and media ids that sort against their capture
// dates. Each write's transaction is read off the statements it sends, and
// rolls back as a whole when its last write is made to fail. On PostgreSQL,
// the actor row lock is pinned by holding it from a second connection: every
// write waits on it before anything else, and two creates (or two item adds)
// racing at the limit leave exactly `limit` rows. Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const { database, knex } = testDb
const db = () => testDb.db
const isPostgres = () => testDb.backend === 'pg'

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await testDb.destroy()
})

const at = (iso: string) => new Date(`${iso}T08:00:00.000Z`)
const OWNER = OWNER_GALLERY_AUDIENCE
const PUBLIC = PUBLIC_GALLERY_AUDIENCE

let actorCount = 0
const newActor = async () => {
  actorCount += 1
  const username = `galleryalbums${actorCount}`
  const id = `https://${DOMAIN}/users/${username}`
  await createSearchActor(database, { id, username, domain: DOMAIN })
  return id
}

let statusCount = 0
const note = async (actorId: string, to: string[]) => {
  statusCount += 1
  const id = `${actorId}/statuses/${statusCount}`
  await database.createNote({ id, url: id, actorId, text: id, to, cc: [] })
  return id
}

// Each test takes its own block of media ids, so it can insert them out of
// order.
let mediaBlock = 0
const mediaIds = () => {
  mediaBlock += 100
  const base = mediaBlock
  return (n: number) => base + n
}
const seedMedia = async (
  id: number,
  actorId: string,
  values: Partial<Insertable<Medias>> = {}
) => {
  await db()
    .insertInto('medias')
    .values({
      id,
      actorId,
      original: `medias/${id}.jpg`,
      originalBytes: 1000,
      originalMimeType: 'image/jpeg',
      originalMetaData: JSON.stringify({ width: 640, height: 480 }),
      inGallery: true,
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values
    })
    .execute()
  return id
}

let attachmentCount = 0
const seedAttachment = async (
  mediaId: number,
  statusId: string | null,
  actorId: string,
  values: Partial<Insertable<Attachments>> = {}
) => {
  attachmentCount += 1
  const id = `album-attachment-${attachmentCount}`
  await db()
    .insertInto('attachments')
    .values({
      id,
      actorId,
      statusId,
      type: 'Document',
      mediaType: 'image/jpeg',
      url: `https://${DOMAIN}/files/${id}.jpg`,
      width: 640,
      height: 480,
      name: '',
      mediaId: String(mediaId),
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
      ...values
    })
    .execute()
  return id
}

// A photo in the actor's gallery, on a post addressed to `to` (public unless
// given).
const postedMedia = async (
  id: number,
  actorId: string,
  values: Partial<Insertable<Medias>> = {},
  to: string[] = [ACTIVITY_STREAM_PUBLIC]
) => {
  await seedMedia(id, actorId, values)
  await seedAttachment(id, await note(actorId, to), actorId)
  return id
}

let albumCount = 0
const nextAlbumId = () => {
  albumCount += 1
  return `album-${String(albumCount).padStart(4, '0')}`
}
const seedAlbum = async (
  actorId: string,
  values: Partial<Insertable<GalleryAlbums>> = {}
) => {
  const id = values.id ?? nextAlbumId()
  await db()
    .insertInto('gallery_albums')
    .values({
      title: `Title ${id}`,
      visibility: 'public',
      sortOrder: 'taken_desc',
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}
const seedItem = async (
  albumId: string,
  mediaId: number,
  actorId: string,
  createdAt = at('2026-02-01')
) => {
  await db()
    .insertInto('gallery_album_items')
    .values({ albumId, mediaId, actorId, createdAt })
    .execute()
}

const albumRow = (id: string) =>
  db()
    .selectFrom('gallery_albums')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
const itemsOf = async (albumId: string) =>
  (
    await db()
      .selectFrom('gallery_album_items')
      .select('mediaId')
      .where('albumId', '=', albumId)
      .orderBy('mediaId')
      .execute()
  ).map((row) => row.mediaId)
const albumIdsOf = async (actorId: string) =>
  (
    await db()
      .selectFrom('gallery_albums')
      .select('id')
      .where('actorId', '=', actorId)
      .orderBy('id')
      .execute()
  ).map((row) => row.id)

const TABLES = {
  gallery_albums: ['id'],
  gallery_album_items: ['albumId', 'mediaId'],
  medias: ['id'],
  attachments: ['id']
} as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  for (const [table, columns] of Object.entries(TABLES)) {
    let query = db()
      .selectFrom(table as keyof typeof TABLES)
      .selectAll()
    for (const column of columns) query = query.orderBy(sql.ref(column))
    dump[table] = await query.execute()
  }
  return dump
}

// Makes the next write on `table` matching `condition` (SQL over `new` or
// `old`, valid on both backends) fail. Returns the function that removes the
// trigger again.
let triggerCount = 0
const failWrite = async (
  table: keyof typeof TABLES,
  event: 'insert' | 'update' | 'delete',
  condition: string
) => {
  triggerCount += 1
  const name = `gallery_albums_fail_${triggerCount}`
  if (isPostgres()) {
    await sql
      .raw(
        `create or replace function ${name}() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db())
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${condition}) execute function ${name}()`
      )
      .execute(db())
    return async () => {
      await sql.raw(`drop trigger ${name} on "${table}"`).execute(db())
      await sql.raw(`drop function ${name}()`).execute(db())
    }
  }
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${condition} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db())
  return async () => {
    await sql.raw(`drop trigger ${name}`).execute(db())
  }
}

// Runs `action` expecting it to fail on the forced write, then checks every
// table the albums touch is exactly as it was.
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

type CapturedStatement = { sql: string; connection?: string }

// The statements `action` sends, as Knex's `query` event reports them (Kysely
// statements emit it too), with the connection each ran on.
const captureStatements = async <T>(action: () => Promise<T>) => {
  const statements: CapturedStatement[] = []
  const listener = (query: { sql: string; __knexUid?: string }) => {
    statements.push({ sql: query.sql, connection: query.__knexUid })
  }
  knex.on('query', listener)
  try {
    const result = await action()
    return { result, statements }
  } finally {
    knex.removeListener('query', listener)
  }
}

// PostgreSQL's numbered placeholders read as SQLite's `?`.
const plain = (text: string) => text.replace(/\$\d+/g, '?')

const LOCK = 'select "id" from "actors" where "id" = ?'
const lockStatement = () => (isPostgres() ? `${LOCK} for update` : LOCK)

// Every statement of `action` ran between one `begin` and its `commit`, on
// that transaction's connection; returns them without the two.
const expectOneTransaction = async (action: () => Promise<unknown>) =>
  expectOneTransactionOf((await captureStatements(action)).statements)

const expectOneTransactionOf = (statements: CapturedStatement[]) => {
  const texts = statements.map((statement) => plain(statement.sql))
  expect(texts[0]).toBe('begin')
  expect(texts.at(-1)).toBe('commit')
  expect(
    texts.filter((text) => /^(begin|commit|rollback)\b/i.test(text))
  ).toHaveLength(2)
  expect(statements.every((statement) => statement.connection)).toBeTrue()
  expect(
    new Set(statements.map((statement) => statement.connection)).size
  ).toBe(1)
  return texts.slice(1, -1)
}

const viewer = (
  flags: Partial<Extract<GalleryAudience, { kind: 'viewer' }>>
): GalleryAudience => ({
  kind: 'viewer',
  publicOnly: false,
  visibleToActorId: null,
  includeFollowersOnly: false,
  followersAudience: null,
  ...flags
})

// One actor's album of four items: two public photos, a hidden one and an
// unposted upload, plus a foreign item row and another album sharing a photo.
const seedAlbumWithNeighbours = async () => {
  const owner = await newActor()
  const other = await newActor()
  const ids = mediaIds()
  const publicA = await postedMedia(ids(1), owner, {
    takenAt: at('2025-03-01')
  })
  const publicB = await postedMedia(ids(2), owner, {
    takenAt: at('2025-04-01')
  })
  const hidden = await postedMedia(ids(3), owner, { inGallery: false })
  const unposted = await seedMedia(ids(4), owner)
  const foreign = await postedMedia(ids(5), other)
  const albumId = await seedAlbum(owner)
  for (const mediaId of [publicA, publicB, hidden, unposted]) {
    await seedItem(albumId, mediaId, owner)
  }
  // Written for another actor, of the owner's own posted photo.
  const forOther = await postedMedia(ids(6), owner)
  await seedItem(albumId, forOther, other)
  // Another album of the owner's, holding one of the same photos.
  const neighbourId = await seedAlbum(owner)
  await seedItem(neighbourId, publicA, owner)
  return {
    owner,
    other,
    ids,
    albumId,
    neighbourId,
    publicA,
    publicB,
    hidden,
    unposted,
    foreign,
    forOther
  }
}

describe('album reads', () => {
  it('getGalleryAlbum reads only the actor’s own album, parsed', async () => {
    const owner = await newActor()
    const other = await newActor()
    const albumId = await seedAlbum(owner, {
      description: 'About',
      coverMediaId: 7,
      visibility: 'unknown',
      sortOrder: 'bogus',
      createdAt: at('2026-01-02'),
      updatedAt: at('2026-01-03')
    })
    const foreignId = await seedAlbum(other)

    expect(
      await database.getGalleryAlbum({
        id: albumId,
        actorId: owner,
        audience: OWNER
      })
    ).toEqual({
      id: albumId,
      actorId: owner,
      title: `Title ${albumId}`,
      description: 'About',
      coverMediaId: '7',
      // Fails closed.
      visibility: 'private',
      sortOrder: 'taken_desc',
      createdAt: at('2026-01-02').getTime(),
      updatedAt: at('2026-01-03').getTime()
    })
    expect(
      await database.getGalleryAlbum({
        id: foreignId,
        actorId: owner,
        audience: OWNER
      })
    ).toBeNull()
    expect(
      await database.getGalleryAlbum({
        id: albumId,
        actorId: other,
        audience: OWNER
      })
    ).toBeNull()
  })

  it('getGalleryAlbum opens to a visitor only a public album with an item visible to them', async () => {
    const { owner, other, ids, albumId, publicA } =
      await seedAlbumWithNeighbours()

    expect(
      await database.getGalleryAlbum({
        id: albumId,
        actorId: owner,
        audience: PUBLIC
      })
    ).toMatchObject({ id: albumId })

    // Private, with the same visible photo.
    const privateId = await seedAlbum(owner, { visibility: 'private' })
    await seedItem(privateId, publicA, owner)
    // Public, holding only a hidden photo, an unposted upload, a
    // followers-only photo and a visible photo written for another actor.
    const dimId = await seedAlbum(owner)
    await seedItem(
      dimId,
      await postedMedia(ids(10), owner, { inGallery: false }),
      owner
    )
    await seedItem(dimId, await seedMedia(ids(11), owner), owner)
    await seedItem(
      dimId,
      await postedMedia(ids(12), owner, {}, [`${owner}/followers`]),
      owner
    )
    await seedItem(dimId, await postedMedia(ids(13), owner), other)
    // Public and empty, while another album holds a visible photo.
    const emptyId = await seedAlbum(owner)

    for (const id of [privateId, dimId, emptyId]) {
      expect(
        await database.getGalleryAlbum({ id, actorId: owner, audience: PUBLIC })
      ).toBeNull()
    }
    // The owner opens all three.
    for (const id of [privateId, dimId, emptyId]) {
      expect(
        await database.getGalleryAlbum({ id, actorId: owner, audience: OWNER })
      ).toMatchObject({ id })
    }
    // A follower sees the followers-only photo.
    expect(
      await database.getGalleryAlbum({
        id: dimId,
        actorId: owner,
        audience: viewer({
          visibleToActorId: other,
          includeFollowersOnly: true,
          followersAudience: `${owner}/followers`
        })
      })
    ).toMatchObject({ id: dimId })
  })

  it('getGalleryAlbumIndex lists only the album’s own items the audience can see', async () => {
    const { owner, albumId, publicA, publicB, hidden, unposted } =
      await seedAlbumWithNeighbours()

    const names = async (audience: GalleryAudience, ignore?: boolean) =>
      (
        await database.getGalleryAlbumIndex({
          albumId,
          actorId: owner,
          audience,
          ignoreAlbumVisibility: ignore
        })
      )
        .map((row) => Number(row.id))
        .sort((a, b) => a - b)

    // The unposted upload is not added in Gallery, so not even the owner's.
    expect(await names(OWNER)).toEqual([publicA, publicB])
    expect(await names(PUBLIC)).toEqual([publicA, publicB])
    expect(hidden).toBeDefined()
    expect(unposted).toBeDefined()

    const [row] = await database.getGalleryAlbumIndex({
      albumId,
      actorId: owner,
      audience: OWNER
    })
    expect(row).toMatchObject({ addedAt: at('2026-02-01').getTime() })
  })

  it('getGalleryAlbumIndex reads a private album for a visitor only when told to ignore its visibility', async () => {
    const owner = await newActor()
    const ids = mediaIds()
    const visible = await postedMedia(ids(1), owner)
    const followersOnly = await postedMedia(ids(2), owner, {}, [
      `${owner}/followers`
    ])
    const albumId = await seedAlbum(owner, { visibility: 'private' })
    await seedItem(albumId, visible, owner)
    await seedItem(albumId, followersOnly, owner)

    expect(
      await database.getGalleryAlbumIndex({
        albumId,
        actorId: owner,
        audience: PUBLIC
      })
    ).toEqual([])
    expect(
      (
        await database.getGalleryAlbumIndex({
          albumId,
          actorId: owner,
          audience: PUBLIC,
          ignoreAlbumVisibility: true
        })
      ).map((row) => Number(row.id))
    ).toEqual([visible])
    // Still the album's own owner only.
    expect(
      await database.getGalleryAlbumIndex({
        albumId,
        actorId: await newActor(),
        audience: PUBLIC,
        ignoreAlbumVisibility: true
      })
    ).toEqual([])
  })

  it('getGalleryAlbumSummaries lists the owner’s albums by updatedAt, newest first, then id', async () => {
    const owner = await newActor()
    const other = await newActor()
    // Inserted against the order asked for: the index on (actorId,
    // updatedAt) reads them oldest first, ties in insertion order. One tie
    // group inserted against id order, one in it.
    await seedAlbum(owner, { id: 'sum-c1', updatedAt: at('2026-03-03') })
    await seedAlbum(owner, { id: 'sum-a1', updatedAt: at('2026-03-01') })
    await seedAlbum(owner, { id: 'sum-b1', updatedAt: at('2026-03-03') })
    await seedAlbum(owner, { id: 'sum-d1', updatedAt: at('2026-03-02') })
    await seedAlbum(owner, { id: 'sum-e1', updatedAt: at('2026-03-04') })
    await seedAlbum(owner, { id: 'sum-f1', updatedAt: at('2026-03-04') })
    await seedAlbum(owner, {
      id: 'sum-g1',
      visibility: 'private',
      updatedAt: at('2026-02-01')
    })
    await seedAlbum(other, { id: 'sum-h1', updatedAt: at('2026-03-05') })

    const summaries = await database.getGalleryAlbumSummaries({
      actorId: owner,
      audience: OWNER
    })
    expect(summaries.map((summary) => summary.album.id)).toEqual([
      'sum-e1',
      'sum-f1',
      'sum-b1',
      'sum-c1',
      'sum-d1',
      'sum-a1',
      'sum-g1'
    ])
    // Empty albums carry no dates or cover.
    expect(summaries[0]).toMatchObject({
      itemCount: 0,
      firstAt: null,
      lastAt: null,
      coverMediaId: null,
      previewMediaIds: []
    })
    // The owner's album times are the stored ones.
    expect(summaries[0].album.updatedAt).toBe(at('2026-03-04').getTime())

    // Only the one asked for.
    expect(
      (
        await database.getGalleryAlbumSummaries({
          actorId: owner,
          audience: OWNER,
          albumId: 'sum-d1'
        })
      ).map((summary) => summary.album.id)
    ).toEqual(['sum-d1'])
    expect(
      await database.getGalleryAlbumSummaries({
        actorId: owner,
        audience: OWNER,
        albumId: 'sum-h1'
      })
    ).toEqual([])
  })

  it('getGalleryAlbumSummaries counts, dates, covers and previews from the visible items only', async () => {
    const owner = await newActor()
    const ids = mediaIds()
    // Media ids against capture order; one undated, ordered by its upload.
    const newest = await postedMedia(ids(1), owner, {
      takenAt: at('2025-06-01')
    })
    const oldest = await postedMedia(ids(4), owner, {
      takenAt: at('2025-01-01')
    })
    const undated = await postedMedia(ids(2), owner, {
      takenAt: null,
      createdAt: at('2025-03-01')
    })
    const followersOnly = await postedMedia(
      ids(3),
      owner,
      { takenAt: at('2025-12-01') },
      [`${owner}/followers`]
    )
    const albumId = await seedAlbum(owner, { coverMediaId: followersOnly })
    await seedItem(albumId, newest, owner, at('2026-02-03'))
    await seedItem(albumId, oldest, owner, at('2026-02-01'))
    await seedItem(albumId, undated, owner, at('2026-02-02'))
    await seedItem(albumId, followersOnly, owner, at('2026-02-04'))

    const [ownerSummary] = await database.getGalleryAlbumSummaries({
      actorId: owner,
      audience: OWNER,
      albumId
    })
    expect(ownerSummary).toMatchObject({
      itemCount: 4,
      firstAt: at('2025-01-01').getTime(),
      lastAt: at('2025-12-01').getTime(),
      coverMediaId: String(followersOnly),
      previewMediaIds: [followersOnly, newest, undated].map(String)
    })

    const [visitorSummary] = await database.getGalleryAlbumSummaries({
      actorId: owner,
      audience: PUBLIC,
      albumId
    })
    // The explicit cover is hidden from them: the newest visible photo.
    expect(visitorSummary).toMatchObject({
      itemCount: 3,
      firstAt: at('2025-01-01').getTime(),
      lastAt: at('2025-06-01').getTime(),
      coverMediaId: String(newest),
      previewMediaIds: [newest, undated, oldest].map(String)
    })
    // When the first and the latest visible photo joined the album.
    expect(visitorSummary.album).toMatchObject({
      createdAt: at('2026-02-01').getTime(),
      updatedAt: at('2026-02-03').getTime()
    })
  })

  it('getGalleryAlbumSummaries gives a visitor public albums with something visible, by the visible updatedAt, then id', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    const photo = (n: number) => postedMedia(ids(n), owner)
    // Stored times against the visible ones.
    const late = await seedAlbum(owner, {
      id: 'vis-a2',
      updatedAt: at('2026-01-01')
    })
    await seedItem(late, await photo(1), owner, at('2026-02-09'))
    const tiedB = await seedAlbum(owner, {
      id: 'vis-c2',
      updatedAt: at('2026-05-01')
    })
    await seedItem(tiedB, await photo(2), owner, at('2026-02-05'))
    const tiedA = await seedAlbum(owner, {
      id: 'vis-b2',
      updatedAt: at('2026-04-01')
    })
    await seedItem(tiedA, await photo(3), owner, at('2026-02-05'))
    // A hidden photo joined last: it does not move the visible time.
    await seedItem(
      tiedA,
      await postedMedia(ids(4), owner, { inGallery: false }),
      owner,
      at('2026-03-01')
    )
    const privateId = await seedAlbum(owner, {
      id: 'vis-d2',
      visibility: 'private',
      updatedAt: at('2026-06-01')
    })
    await seedItem(privateId, await photo(5), owner)
    const dimId = await seedAlbum(owner, {
      id: 'vis-e2',
      updatedAt: at('2026-06-01')
    })
    await seedItem(
      dimId,
      await postedMedia(ids(6), owner, {}, [`${owner}/followers`]),
      owner
    )
    // Another actor's public album holding the owner's photo.
    const foreignId = await seedAlbum(other, { id: 'vis-f2' })
    await seedItem(foreignId, ids(1), owner)

    const summaries = await database.getGalleryAlbumSummaries({
      actorId: owner,
      audience: PUBLIC
    })
    expect(summaries.map((summary) => summary.album.id)).toEqual([
      late,
      tiedA,
      tiedB
    ])
    expect(summaries.map((summary) => summary.album.updatedAt)).toEqual([
      at('2026-02-09').getTime(),
      at('2026-02-05').getTime(),
      at('2026-02-05').getTime()
    ])
    // The owner's order is the stored one.
    expect(
      (
        await database.getGalleryAlbumSummaries({
          actorId: owner,
          audience: OWNER
        })
      ).map((summary) => summary.album.id)
    ).toEqual([privateId, dimId, tiedB, tiedA, late])
  })

  it('getGalleryAlbumPlaceIndexes groups the visible placed items by album', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    const named = await postedMedia(ids(1), owner, { placeName: 'Bangkok' })
    const located = await postedMedia(ids(2), owner, {
      placeLatitude: 13.75,
      placeLongitude: 100.5,
      subjectName: 'Red Fox'
    })
    const unplaced = await postedMedia(ids(3), owner, {
      placeLongitude: 100.5
    })
    const hiddenPlaced = await postedMedia(ids(4), owner, {
      inGallery: false,
      placeName: 'Hidden'
    })
    const followersPlaced = await postedMedia(
      ids(5),
      owner,
      { placeName: 'Followers' },
      [`${owner}/followers`]
    )
    const first = await seedAlbum(owner)
    for (const id of [named, unplaced, hiddenPlaced, followersPlaced]) {
      await seedItem(first, id, owner)
    }
    const second = await seedAlbum(owner)
    await seedItem(second, located, owner)
    // Written for another actor.
    await seedItem(second, named, other)
    const privateId = await seedAlbum(owner, { visibility: 'private' })
    await seedItem(privateId, named, owner)
    const empty = await seedAlbum(owner)
    // Another actor's album holding the owner's placed photo.
    const foreign = await seedAlbum(other)
    await seedItem(foreign, located, owner)

    const groups = async (audience: GalleryAudience, albumId?: string) =>
      Object.fromEntries(
        (
          await database.getGalleryAlbumPlaceIndexes({
            actorId: owner,
            audience,
            albumId
          })
        ).map((group) => [
          group.albumId,
          group.rows.map((row) => Number(row.id)).sort((a, b) => a - b)
        ])
      )

    expect(await groups(OWNER)).toEqual({
      [first]: [named, followersPlaced],
      [second]: [located],
      [privateId]: [named]
    })
    expect(await groups(PUBLIC)).toEqual({
      [first]: [named],
      [second]: [located]
    })
    expect(await groups(OWNER, second)).toEqual({ [second]: [located] })
    expect(await groups(OWNER, foreign)).toEqual({})
    expect(await groups(OWNER, empty)).toEqual({})

    const [group] = await database.getGalleryAlbumPlaceIndexes({
      actorId: owner,
      audience: OWNER,
      albumId: second
    })
    expect(group.rows[0]).toMatchObject({
      id: String(located),
      placeLatitude: 13.75,
      placeLongitude: 100.5,
      subjectName: 'Red Fox',
      addedAt: 0
    })
  })

  it('countGalleryAlbumMedia counts each visible photo once across the actor’s albums', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    const shared = await postedMedia(ids(1), owner)
    const single = await postedMedia(ids(2), owner)
    const privateOnly = await postedMedia(ids(3), owner)
    const hidden = await postedMedia(ids(4), owner, { inGallery: false })
    const forOther = await postedMedia(ids(5), owner)
    const inForeign = await postedMedia(ids(6), owner)
    const first = await seedAlbum(owner)
    await seedItem(first, shared, owner)
    await seedItem(first, single, owner)
    await seedItem(first, hidden, owner)
    await seedItem(first, forOther, other)
    const second = await seedAlbum(owner)
    await seedItem(second, shared, owner)
    const privateId = await seedAlbum(owner, { visibility: 'private' })
    await seedItem(privateId, privateOnly, owner)
    // Another actor's album holding a row written for the owner.
    const foreign = await seedAlbum(other)
    await seedItem(foreign, inForeign, owner)

    expect(
      await database.countGalleryAlbumMedia({ actorId: owner, audience: OWNER })
    ).toBe(3)
    expect(
      await database.countGalleryAlbumMedia({
        actorId: owner,
        audience: PUBLIC
      })
    ).toBe(2)
    expect(
      await database.countGalleryAlbumMedia({ actorId: other, audience: OWNER })
    ).toBe(0)
  })

  it('getActorHasVisibleGalleryAlbums answers any album for the owner and a public album with a visible photo for anyone else', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    expect(
      await database.getActorHasVisibleGalleryAlbums({
        actorId: owner,
        audience: OWNER
      })
    ).toBeFalse()

    // Private with a visible photo, public with a hidden one and one written
    // for another actor, and another actor's public album holding a row
    // written for the owner.
    const privateId = await seedAlbum(owner, { visibility: 'private' })
    await seedItem(privateId, await postedMedia(ids(1), owner), owner)
    const dimId = await seedAlbum(owner)
    await seedItem(
      dimId,
      await postedMedia(ids(2), owner, { inGallery: false }),
      owner
    )
    await seedItem(dimId, await postedMedia(ids(3), owner), other)
    const foreign = await seedAlbum(other)
    await seedItem(foreign, await postedMedia(ids(4), owner), owner)

    const has = (actorId: string, audience: GalleryAudience) =>
      database.getActorHasVisibleGalleryAlbums({ actorId, audience })
    expect(await has(owner, OWNER)).toBeTrue()
    expect(await has(owner, PUBLIC)).toBeFalse()

    await seedItem(dimId, await postedMedia(ids(5), owner), owner)
    expect(await has(owner, PUBLIC)).toBeTrue()
    expect(await has(await newActor(), OWNER)).toBeFalse()
  })

  it('countGalleryAlbumStoredItems counts every stored item of the album whose media exists', async () => {
    const { owner, other, albumId, neighbourId } =
      await seedAlbumWithNeighbours()
    // Four of the owner's items, hidden and unposted ones too, and the row
    // written for another actor; not the neighbour album's.
    expect(
      await database.countGalleryAlbumStoredItems({ albumId, actorId: owner })
    ).toBe(5)
    expect(
      await database.countGalleryAlbumStoredItems({
        albumId: neighbourId,
        actorId: owner
      })
    ).toBe(1)
    expect(
      await database.countGalleryAlbumStoredItems({ albumId, actorId: other })
    ).toBe(0)
  })

  it('countGalleryAlbumStoredItems does not count an item whose media is gone (SQLite without foreign keys)', async () => {
    if (isPostgres()) {
      // The item's foreign key cascades the media delete on PostgreSQL.
      return
    }
    const owner = await newActor()
    const ids = mediaIds()
    const albumId = await seedAlbum(owner)
    await seedItem(albumId, await postedMedia(ids(1), owner), owner)
    await sql`PRAGMA foreign_keys = OFF`.execute(db())
    try {
      await seedItem(albumId, ids(2), owner)
    } finally {
      await sql`PRAGMA foreign_keys = ON`.execute(db())
    }
    expect(await itemsOf(albumId)).toEqual([ids(1), ids(2)])
    expect(
      await database.countGalleryAlbumStoredItems({ albumId, actorId: owner })
    ).toBe(1)
    // And it takes no room against the cap.
    expect(
      await database.addGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: [String(await postedMedia(ids(3), owner))],
        limit: 2
      })
    ).toMatchObject({ status: 'added', added: [String(ids(3))] })
  })

  it('getAlbumsForMedia lists the owner’s albums holding the media, by updatedAt, newest first, then id', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    const photo = await postedMedia(ids(1), owner)
    const elsewhere = await postedMedia(ids(2), owner)
    for (const [id, updatedAt] of [
      ['fm-c3', '2026-03-02'],
      ['fm-a3', '2026-03-01'],
      ['fm-e3', '2026-03-03'],
      ['fm-b3', '2026-03-02'],
      ['fm-f3', '2026-03-03']
    ] as const) {
      await seedAlbum(owner, { id, title: id, updatedAt: at(updatedAt) })
      await seedItem(id, photo, owner)
    }
    // Holds another photo only; holds it for another actor; another actor's.
    await seedAlbum(owner, { id: 'fm-g3', updatedAt: at('2026-04-01') })
    await seedItem('fm-g3', elsewhere, owner)
    await seedAlbum(owner, { id: 'fm-h3', updatedAt: at('2026-04-01') })
    await seedItem('fm-h3', photo, other)
    await seedAlbum(other, { id: 'fm-i3', updatedAt: at('2026-04-01') })
    await seedItem('fm-i3', photo, owner)

    const albums = await database.getAlbumsForMedia({
      mediaId: String(photo),
      actorId: owner,
      audience: OWNER
    })
    expect(albums).toEqual(
      ['fm-e3', 'fm-f3', 'fm-b3', 'fm-c3', 'fm-a3'].map((id) => ({
        id,
        title: id
      }))
    )
    expect(
      await database.getAlbumsForMedia({
        mediaId: String(photo),
        actorId: owner,
        audience: PUBLIC
      })
    ).toEqual([])
    // Neither a visitor nor an id that is no media id sends a statement.
    const { result: notAnId, statements } = await captureStatements(
      async () => [
        await database.getAlbumsForMedia({
          mediaId: 'not-an-id',
          actorId: owner,
          audience: OWNER
        }),
        await database.getAlbumsForMedia({
          mediaId: String(photo),
          actorId: owner,
          audience: PUBLIC
        })
      ]
    )
    expect(notAnId).toEqual([[], []])
    expect(statements).toEqual([])
  })
})

describe('getGalleryAlbumMedia', () => {
  // Media ids against capture order, a tie on the capture date, an undated
  // photo (ordered by its upload) and items added in a third order.
  const seedSorted = async () => {
    const owner = await newActor()
    const ids = mediaIds()
    const kingfisher = {
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthis'
    }
    const m = {
      jan: await postedMedia(ids(5), owner, {
        takenAt: at('2025-01-01'),
        ...kingfisher
      }),
      marLow: await postedMedia(ids(1), owner, { takenAt: at('2025-03-01') }),
      marHigh: await postedMedia(ids(7), owner, { takenAt: at('2025-03-01') }),
      undated: await postedMedia(ids(3), owner, {
        takenAt: null,
        createdAt: at('2025-02-01'),
        ...kingfisher
      }),
      dec: await postedMedia(ids(2), owner, { takenAt: at('2025-12-01') }),
      hidden: await postedMedia(ids(4), owner, {
        inGallery: false,
        takenAt: at('2025-06-01')
      }),
      followers: await postedMedia(
        ids(6),
        owner,
        {
          takenAt: at('2025-07-01')
        },
        [`${owner}/followers`]
      )
    }
    const albumId = await seedAlbum(owner)
    const added: [number, string][] = [
      [m.dec, '2026-02-03'],
      [m.jan, '2026-02-05'],
      [m.marLow, '2026-02-01'],
      [m.marHigh, '2026-02-04'],
      [m.undated, '2026-02-04'],
      [m.hidden, '2026-02-06'],
      [m.followers, '2026-02-02']
    ]
    for (const [mediaId, when] of added) {
      await seedItem(albumId, mediaId, owner, at(when))
    }
    return { owner, albumId, m }
  }

  it('orders by capture date, either way, or by when the photo was added, ties on the media id', async () => {
    const { owner, albumId, m } = await seedSorted()
    const page = async (
      sort: 'taken_desc' | 'taken_asc' | 'added_desc',
      audience: GalleryAudience = OWNER
    ) =>
      (
        await database.getGalleryAlbumMedia({
          albumId,
          actorId: owner,
          audience,
          sort,
          limit: 100
        })
      ).map((row) => [Number(row.media.id), row.sortKey])

    expect(await page('taken_desc')).toEqual([
      [m.dec, at('2025-12-01').getTime()],
      [m.followers, at('2025-07-01').getTime()],
      [m.marHigh, at('2025-03-01').getTime()],
      [m.marLow, at('2025-03-01').getTime()],
      [m.undated, at('2025-02-01').getTime()],
      [m.jan, at('2025-01-01').getTime()]
    ])
    expect(await page('taken_asc')).toEqual([
      [m.jan, at('2025-01-01').getTime()],
      [m.undated, at('2025-02-01').getTime()],
      [m.marLow, at('2025-03-01').getTime()],
      [m.marHigh, at('2025-03-01').getTime()],
      [m.followers, at('2025-07-01').getTime()],
      [m.dec, at('2025-12-01').getTime()]
    ])
    expect(await page('added_desc')).toEqual([
      [m.jan, at('2026-02-05').getTime()],
      [m.marHigh, at('2026-02-04').getTime()],
      [m.undated, at('2026-02-04').getTime()],
      [m.dec, at('2026-02-03').getTime()],
      [m.followers, at('2026-02-02').getTime()],
      [m.marLow, at('2026-02-01').getTime()]
    ])
    expect((await page('taken_desc', PUBLIC)).map(([id]) => id)).toEqual([
      m.dec,
      m.marHigh,
      m.marLow,
      m.undated,
      m.jan
    ])
  })

  it('pages strictly after the cursor, also inside a tie, and stops at the limit', async () => {
    const { owner, albumId, m } = await seedSorted()
    const page = async (
      after: { key: number; mediaId: number } | undefined,
      limit: number,
      sort: 'taken_desc' | 'taken_asc' = 'taken_desc'
    ) =>
      (
        await database.getGalleryAlbumMedia({
          albumId,
          actorId: owner,
          audience: OWNER,
          sort,
          after,
          limit
        })
      ).map((row) => Number(row.media.id))

    expect(await page(undefined, 2)).toEqual([m.dec, m.followers])
    const tie = at('2025-03-01').getTime()
    expect(await page({ key: tie, mediaId: m.marHigh }, 2)).toEqual([
      m.marLow,
      m.undated
    ])
    expect(await page({ key: tie, mediaId: m.marLow }, 100)).toEqual([
      m.undated,
      m.jan
    ])
    expect(await page({ key: tie, mediaId: m.marLow }, 1, 'taken_asc')).toEqual(
      [m.marHigh]
    )
    expect(
      await page({ key: at('2025-01-01').getTime(), mediaId: m.jan }, 100)
    ).toEqual([])
  })

  it('filters to one species and carries the post each photo is shown through', async () => {
    const { owner, albumId, m } = await seedSorted()
    const rows = await database.getGalleryAlbumMedia({
      albumId,
      actorId: owner,
      audience: OWNER,
      sort: 'taken_desc',
      limit: 100,
      subjectKey:
        toSubjectKey({
          name: 'Common Kingfisher',
          scientificName: 'Alcedo atthis'
        }) ?? undefined
    })
    expect(rows.map((row) => Number(row.media.id))).toEqual([m.undated, m.jan])
    expect(rows[0].statusId).toMatch(/\/statuses\//)
    expect(rows[0].attachment).toMatchObject({ mediaId: String(m.undated) })
  })

  it('reads nothing for a zero limit, and only the album row for an album the audience may not open', async () => {
    const { owner, albumId } = await seedSorted()
    const privateId = await seedAlbum(owner, { visibility: 'private' })
    const { statements } = await captureStatements(async () => {
      for (const limit of [0, -1, Number.NaN]) {
        expect(
          await database.getGalleryAlbumMedia({
            albumId,
            actorId: owner,
            audience: OWNER,
            sort: 'taken_desc',
            limit
          })
        ).toEqual([])
      }
    })
    expect(statements).toEqual([])

    const { statements: privateRead } = await captureStatements(async () =>
      expect(
        await database.getGalleryAlbumMedia({
          albumId: privateId,
          actorId: owner,
          audience: PUBLIC,
          sort: 'taken_desc',
          limit: 10
        })
      ).toEqual([])
    )
    expect(privateRead.map((statement) => plain(statement.sql))).toEqual([
      'select * from "gallery_albums" where "id" = ? and "actorId" = ? limit ?'
    ])
  })
})

describe('the reads that answer one row keep their limit 1', () => {
  it('sends `limit` on the album, existence, count and cover reads', async () => {
    const { owner, albumId, publicA } = await seedAlbumWithNeighbours()
    const { statements } = await captureStatements(async () => {
      await database.getGalleryAlbum({
        id: albumId,
        actorId: owner,
        audience: PUBLIC
      })
      await database.getActorHasVisibleGalleryAlbums({
        actorId: owner,
        audience: OWNER
      })
      await database.getActorHasVisibleGalleryAlbums({
        actorId: owner,
        audience: PUBLIC
      })
      await database.countGalleryAlbumStoredItems({ albumId, actorId: owner })
      await database.countGalleryAlbumMedia({ actorId: owner, audience: OWNER })
      await database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        coverMediaId: String(publicA)
      })
      await database.createGalleryAlbumWithinLimit({
        actorId: owner,
        title: 'Counted',
        limit: 100
      })
    })
    const texts = statements.map((statement) => plain(statement.sql))
    const oneRow = [
      /^select \* from "gallery_albums" where "id" = \? and "actorId" = \?/,
      /^select 1 as "one" from "gallery_album_items" as "album_items"/,
      /^select "id" from "gallery_albums" where "actorId" = \?/,
      /^select count\(\*\) as "total" from "gallery_album_items"/,
      /^select count\(\*\) as "total" from "gallery_albums"/,
      /^select count\(distinct "medias"\."id"\) as "total"/,
      /^select "mediaId" from "gallery_album_items" where "albumId" = \? and "mediaId" = \?/
    ]
    for (const pattern of oneRow) {
      const matching = texts.filter((text) => pattern.test(text))
      expect(matching, String(pattern)).not.toHaveLength(0)
      for (const text of matching) expect(text).toMatch(/ limit \?$/)
    }
  })
})

describe('createGalleryAlbumWithinLimit', () => {
  it('creates a public album with defaults, counting only the actor’s own albums against the limit', async () => {
    const owner = await newActor()
    const other = await newActor()
    await seedAlbum(owner)
    await seedAlbum(other)
    await seedAlbum(other)

    const created = await database.createGalleryAlbumWithinLimit({
      actorId: owner,
      title: 'Second',
      limit: 2
    })
    expect(created).toEqual({
      status: 'created',
      album: {
        id: expect.any(String),
        actorId: owner,
        title: 'Second',
        description: null,
        coverMediaId: null,
        visibility: 'public',
        sortOrder: 'taken_desc',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      },
      added: [],
      existing: [],
      skipped: []
    })
    if (created.status !== 'created') throw new Error('not created')
    expect(await albumRow(created.album.id)).toMatchObject({
      actorId: owner,
      title: 'Second',
      visibility: 'public',
      sortOrder: 'taken_desc',
      createdAt: created.album.createdAt,
      updatedAt: created.album.updatedAt
    })

    const before = await dumpTables()
    expect(
      await database.createGalleryAlbumWithinLimit({
        actorId: owner,
        title: 'Third',
        limit: 2
      })
    ).toEqual({ status: 'limit-reached' })
    expect(await dumpTables()).toEqual(before)
  })

  it('adds the first photos in the same transaction, and creates nothing when they do not fit', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    const mine = await postedMedia(ids(1), owner)
    const second = await postedMedia(ids(2), owner)
    const foreign = await postedMedia(ids(3), other)

    const created = await database.createGalleryAlbumWithinLimit({
      actorId: owner,
      title: 'With photos',
      description: 'About',
      visibility: 'private',
      sortOrder: 'added_desc',
      limit: 10,
      mediaIds: [String(mine), String(foreign), 'nope'],
      itemLimit: 1
    })
    expect(created).toMatchObject({
      status: 'created',
      album: {
        description: 'About',
        visibility: 'private',
        sortOrder: 'added_desc'
      },
      added: [String(mine)],
      existing: [],
      skipped: [String(foreign), 'nope']
    })
    if (created.status !== 'created') throw new Error('not created')
    expect(await itemsOf(created.album.id)).toEqual([mine])

    const before = await dumpTables()
    await expect(
      database.createGalleryAlbumWithinLimit({
        actorId: owner,
        title: 'Too many',
        limit: 10,
        mediaIds: [String(mine), String(second)],
        itemLimit: 1
      })
    ).rejects.toThrow(
      'Could not add the first photos to the new album: limit-reached'
    )
    expect(await dumpTables()).toEqual(before)
  })

  it('locks the actor row first, then counts, inserts and adds, in one transaction', async () => {
    const owner = await newActor()
    const ids = mediaIds()
    const photo = await postedMedia(ids(1), owner)

    expect(
      await expectOneTransaction(() =>
        database.createGalleryAlbumWithinLimit({
          actorId: owner,
          title: 'Plain',
          limit: 10
        })
      )
    ).toEqual([
      lockStatement(),
      'select count(*) as "total" from "gallery_albums" where "actorId" = ? limit ?',
      expect.stringMatching(/^insert into "gallery_albums" /)
    ])
    // An empty list of first photos is no list: nothing is read for it.
    expect(
      await expectOneTransaction(() =>
        database.createGalleryAlbumWithinLimit({
          actorId: owner,
          title: 'No photos',
          limit: 10,
          mediaIds: []
        })
      )
    ).toEqual([
      lockStatement(),
      'select count(*) as "total" from "gallery_albums" where "actorId" = ? limit ?',
      expect.stringMatching(/^insert into "gallery_albums" /)
    ])

    const statements = await expectOneTransaction(() =>
      database.createGalleryAlbumWithinLimit({
        actorId: owner,
        title: 'With a photo',
        limit: 10,
        mediaIds: [String(photo)]
      })
    )
    expect(statements).toEqual([
      lockStatement(),
      'select count(*) as "total" from "gallery_albums" where "actorId" = ? limit ?',
      expect.stringMatching(/^insert into "gallery_albums" /),
      'select * from "gallery_albums" where "id" = ? and "actorId" = ? limit ?',
      expect.stringMatching(
        /^select "medias"\."id" from "medias" where "medias"\."id" in \(\?\) and /
      ),
      'select "mediaId" from "gallery_album_items" where "albumId" = ? and "mediaId" in (?)',
      expect.stringMatching(
        /^select count\(\*\) as "total" from "gallery_album_items" as "album_items" inner join "medias" on "medias"\."id" = "album_items"\."mediaId" where "album_items"\."albumId" = \? limit \?$/
      ),
      expect.stringMatching(/^insert into "gallery_album_items" /),
      'update "gallery_albums" set "updatedAt" = ? where "id" = ?'
    ])
  })

  it('rolls back the album when its insert fails', async () => {
    const owner = await newActor()
    await seedAlbum(owner)
    const drop = await failWrite(
      'gallery_albums',
      'insert',
      `new."title" = 'Doomed'`
    )
    await expectRolledBack(drop, () =>
      database.createGalleryAlbumWithinLimit({
        actorId: owner,
        title: 'Doomed',
        limit: 10
      })
    )
  })

  it('rolls back the album and its first photos when the last write fails', async () => {
    const owner = await newActor()
    const ids = mediaIds()
    const photo = await postedMedia(ids(1), owner)
    const second = await postedMedia(ids(2), owner)
    // The album's `updatedAt` after its items are in.
    const drop = await failWrite(
      'gallery_albums',
      'update',
      `new."title" = 'Doomed with photos'`
    )
    await expectRolledBack(drop, () =>
      database.createGalleryAlbumWithinLimit({
        actorId: owner,
        title: 'Doomed with photos',
        limit: 10,
        mediaIds: [String(photo), String(second)]
      })
    )
  })
})

describe('updateGalleryAlbum', () => {
  it('changes only the given fields of the actor’s own album', async () => {
    const owner = await newActor()
    const other = await newActor()
    const albumId = await seedAlbum(owner, {
      title: 'Before',
      description: 'Kept',
      visibility: 'public',
      sortOrder: 'taken_asc'
    })
    const neighbour = await seedAlbum(owner, { title: 'Neighbour' })
    const foreign = await seedAlbum(other, { title: 'Foreign' })
    const untouched = [await albumRow(neighbour), await albumRow(foreign)]

    const updated = await database.updateGalleryAlbum({
      id: albumId,
      actorId: owner,
      title: 'After',
      visibility: 'private',
      description: undefined
    })
    expect(updated).toEqual({
      status: 'updated',
      album: expect.objectContaining({
        id: albumId,
        title: 'After',
        description: 'Kept',
        visibility: 'private',
        sortOrder: 'taken_asc',
        createdAt: at('2026-01-01').getTime()
      })
    })
    if (updated.status !== 'updated') throw new Error('not updated')
    expect(updated.album.updatedAt).toBeGreaterThan(at('2026-01-01').getTime())

    expect(
      await database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        description: null,
        sortOrder: 'added_desc'
      })
    ).toMatchObject({
      status: 'updated',
      album: { title: 'After', description: null, sortOrder: 'added_desc' }
    })
    expect([await albumRow(neighbour), await albumRow(foreign)]).toEqual(
      untouched
    )

    // Another actor's album, under its own id.
    expect(
      await database.updateGalleryAlbum({
        id: foreign,
        actorId: owner,
        title: 'Taken'
      })
    ).toEqual({ status: 'not-found' })
    expect(
      await database.updateGalleryAlbum({
        id: albumId,
        actorId: other,
        title: 'Taken'
      })
    ).toEqual({ status: 'not-found' })
    expect(await albumRow(foreign)).toEqual(untouched[1])
    expect(await albumRow(albumId)).toMatchObject({ title: 'After' })
  })

  it('sets the cover only to one of the album’s own items, and clears it with null', async () => {
    const { owner, albumId, neighbourId, publicB, hidden, foreign } =
      await seedAlbumWithNeighbours()
    const neighbourOnly = mediaIds()(1)
    await postedMedia(neighbourOnly, owner)
    await seedItem(neighbourId, neighbourOnly, owner)

    for (const coverMediaId of [
      String(neighbourOnly),
      String(foreign),
      'not-an-id',
      '0'
    ]) {
      const before = await albumRow(albumId)
      expect(
        await database.updateGalleryAlbum({
          id: albumId,
          actorId: owner,
          coverMediaId,
          title: 'Not written'
        })
      ).toEqual({ status: 'invalid-cover' })
      expect(await albumRow(albumId)).toEqual(before)
    }

    // A hidden item can be the cover: the owner's choice.
    expect(
      await database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        coverMediaId: String(hidden)
      })
    ).toMatchObject({
      status: 'updated',
      album: { coverMediaId: String(hidden) }
    })
    expect(
      await database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        coverMediaId: `${publicB}.0`
      })
    ).toMatchObject({
      status: 'updated',
      album: { coverMediaId: String(publicB) }
    })
    expect(
      await database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        coverMediaId: null
      })
    ).toMatchObject({ status: 'updated', album: { coverMediaId: null } })
  })

  it('locks the actor row first, then reads, checks the cover, writes and re-reads, in one transaction', async () => {
    const { owner, albumId, publicA } = await seedAlbumWithNeighbours()
    const read =
      'select * from "gallery_albums" where "id" = ? and "actorId" = ? limit ?'
    expect(
      await expectOneTransaction(() =>
        database.updateGalleryAlbum({
          id: albumId,
          actorId: owner,
          coverMediaId: String(publicA)
        })
      )
    ).toEqual([
      lockStatement(),
      read,
      'select "mediaId" from "gallery_album_items" where "albumId" = ? and "mediaId" = ? limit ?',
      'update "gallery_albums" set "coverMediaId" = ?, "updatedAt" = ? where "id" = ? and "actorId" = ?',
      read
    ])
    // A cover that is no media id is refused without a read, and a missing
    // album stops at the read.
    expect(
      await expectOneTransaction(() =>
        database.updateGalleryAlbum({
          id: albumId,
          actorId: owner,
          coverMediaId: 'not-an-id'
        })
      )
    ).toEqual([lockStatement(), read])
    expect(
      await expectOneTransaction(() =>
        database.updateGalleryAlbum({
          id: 'missing-album',
          actorId: owner,
          title: 'Never'
        })
      )
    ).toEqual([lockStatement(), read])
  })

  // The update's only write is the one forced to fail, so the tables are
  // unchanged with or without a transaction: this pins that the error
  // propagates and nothing else changes, not a rollback.
  it('passes on the error and changes nothing when its only write fails', async () => {
    const { owner, albumId } = await seedAlbumWithNeighbours()
    const drop = await failWrite(
      'gallery_albums',
      'update',
      `new."title" = 'Doomed'`
    )
    await expectRolledBack(drop, () =>
      database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        title: 'Doomed'
      })
    )
  })
})

describe('deleteGalleryAlbum', () => {
  it('deletes the album and its own items, and leaves the media, its posts and other albums', async () => {
    const { owner, other, albumId, neighbourId, publicA } =
      await seedAlbumWithNeighbours()
    const foreign = await seedAlbum(other)
    await seedItem(foreign, publicA, owner)
    const before = await dumpTables()

    expect(
      await database.deleteGalleryAlbum({ id: albumId, actorId: other })
    ).toBeFalse()
    expect(
      await database.deleteGalleryAlbum({ id: foreign, actorId: owner })
    ).toBeFalse()
    expect(await dumpTables()).toEqual(before)

    expect(
      await database.deleteGalleryAlbum({ id: albumId, actorId: owner })
    ).toBeTrue()
    expect(await albumRow(albumId)).toBeUndefined()
    expect(await itemsOf(albumId)).toEqual([])
    expect(await itemsOf(neighbourId)).toEqual([publicA])
    expect(await itemsOf(foreign)).toEqual([publicA])
    const after = await dumpTables()
    expect(after.medias).toEqual(before.medias)
    expect(after.attachments).toEqual(before.attachments)
    expect(
      await database.deleteGalleryAlbum({ id: albumId, actorId: owner })
    ).toBeFalse()
  })

  it('locks the actor row first, then reads and deletes the items and the album, in one transaction', async () => {
    const { owner, albumId } = await seedAlbumWithNeighbours()
    expect(
      await expectOneTransaction(() =>
        database.deleteGalleryAlbum({ id: albumId, actorId: owner })
      )
    ).toEqual([
      lockStatement(),
      'select * from "gallery_albums" where "id" = ? and "actorId" = ? limit ?',
      'delete from "gallery_album_items" where "albumId" = ?',
      'delete from "gallery_albums" where "id" = ? and "actorId" = ?'
    ])
  })

  it('rolls back the item delete when the album delete fails', async () => {
    const { owner, albumId } = await seedAlbumWithNeighbours()
    const drop = await failWrite(
      'gallery_albums',
      'delete',
      `old."id" = '${albumId}'`
    )
    await expectRolledBack(drop, () =>
      database.deleteGalleryAlbum({ id: albumId, actorId: owner })
    )
  })
})

describe('addGalleryAlbumItems', () => {
  it('adds only the actor’s own gallery media and reports the rest', async () => {
    const {
      owner,
      other,
      ids,
      albumId,
      neighbourId,
      publicA,
      publicB,
      hidden,
      unposted,
      foreign
    } = await seedAlbumWithNeighbours()
    const fresh = await postedMedia(ids(20), owner)
    // In the neighbour album only: new to this one.
    const neighbourOnly = await postedMedia(ids(21), owner)
    await seedItem(neighbourId, neighbourOnly, owner)
    const added = await postedMedia(ids(22), owner, {
      galleryAddedAt: at('2026-01-05')
    })
    // Kept in Gallery without a post, but switched out of it.
    const addedHidden = await seedMedia(ids(23), owner, {
      inGallery: false,
      galleryAddedAt: at('2026-01-05')
    })
    const neighbourBefore = await albumRow(neighbourId)

    const result = await database.addGalleryAlbumItems({
      albumId,
      actorId: owner,
      mediaIds: [
        String(fresh),
        String(publicA),
        `${publicB}.0`,
        String(neighbourOnly),
        String(added),
        String(hidden),
        String(unposted),
        String(foreign),
        String(addedHidden),
        String(ids(99)),
        'nope',
        'nope',
        String(fresh)
      ],
      limit: 100
    })
    expect(result).toEqual({
      status: 'added',
      added: expect.any(Array),
      existing: expect.any(Array),
      skipped: expect.any(Array)
    })
    if (result.status !== 'added') throw new Error('not added')
    expect([...result.added].sort()).toEqual(
      [fresh, neighbourOnly, added].map(String).sort()
    )
    expect([...result.existing].sort()).toEqual(
      [publicA, publicB].map(String).sort()
    )
    expect([...result.skipped].sort()).toEqual(
      [
        String(hidden),
        String(unposted),
        String(foreign),
        String(addedHidden),
        String(ids(99)),
        'nope'
      ].sort()
    )

    const rows = await db()
      .selectFrom('gallery_album_items')
      .selectAll()
      .where('albumId', '=', albumId)
      .where('mediaId', 'in', [fresh, neighbourOnly, added])
      .execute()
    expect(rows.map((row) => row.actorId)).toEqual([owner, owner, owner])
    expect(new Set(rows.map((row) => row.createdAt)).size).toBe(1)
    expect((await albumRow(albumId))?.updatedAt).toBe(rows[0].createdAt)
    expect(await albumRow(neighbourId)).toEqual(neighbourBefore)
    expect(other).toBeDefined()
  })

  it('writes nothing, not even updatedAt, when nothing is new', async () => {
    const { owner, albumId, publicA, foreign } = await seedAlbumWithNeighbours()
    const before = await dumpTables()
    expect(
      await database.addGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: [String(publicA), String(foreign)],
        limit: 100
      })
    ).toEqual({
      status: 'added',
      added: [],
      existing: [String(publicA)],
      skipped: [String(foreign)]
    })
    expect(await dumpTables()).toEqual(before)
  })

  it('is all or nothing against the limit, counting every stored item of this album only', async () => {
    const { owner, ids, albumId, neighbourId } = await seedAlbumWithNeighbours()
    // The neighbour album fills up; its items do not count here.
    for (const n of [30, 31, 32]) {
      await seedItem(neighbourId, await postedMedia(ids(n), owner), owner)
    }
    const one = await postedMedia(ids(40), owner)
    const two = await postedMedia(ids(41), owner)
    const add = (mediaIds: number[], limit: number) =>
      database.addGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: mediaIds.map(String),
        limit
      })

    // Five stored items: the hidden and the unposted one, and the row written
    // for another actor, count too.
    const before = await dumpTables()
    expect(await add([one, two], 6)).toEqual({ status: 'limit-reached' })
    expect(await dumpTables()).toEqual(before)

    expect(await add([one, two], 7)).toMatchObject({ status: 'added' })
    expect(await itemsOf(albumId)).toHaveLength(7)
  })

  it('is not found for a missing or foreign album', async () => {
    const { owner, other, albumId, publicB } = await seedAlbumWithNeighbours()
    const before = await dumpTables()
    for (const [id, actorId] of [
      ['missing', owner],
      [albumId, other]
    ]) {
      expect(
        await database.addGalleryAlbumItems({
          albumId: id,
          actorId,
          mediaIds: [String(publicB)],
          limit: 100
        })
      ).toEqual({ status: 'not-found' })
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('locks the actor row first, then reads, counts, inserts and touches the album, in one transaction', async () => {
    const { owner, ids, albumId } = await seedAlbumWithNeighbours()
    const fresh = [ids(50), ids(51), ids(52)]
    for (const id of fresh) await postedMedia(id, owner)

    const statements = await expectOneTransaction(() =>
      database.addGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: fresh.map(String),
        limit: 100
      })
    )
    // Two chunks of at most two ids each for the scoped read and the
    // present check.
    expect(statements).toEqual([
      lockStatement(),
      'select * from "gallery_albums" where "id" = ? and "actorId" = ? limit ?',
      expect.stringMatching(
        /^select "medias"\."id" from "medias" where "medias"\."id" in \(\?, \?\) and /
      ),
      expect.stringMatching(
        /^select "medias"\."id" from "medias" where "medias"\."id" in \(\?\) and /
      ),
      'select "mediaId" from "gallery_album_items" where "albumId" = ? and "mediaId" in (?, ?)',
      'select "mediaId" from "gallery_album_items" where "albumId" = ? and "mediaId" in (?)',
      expect.stringMatching(
        /^select count\(\*\) as "total" from "gallery_album_items" as "album_items" .* limit \?$/
      ),
      'insert into "gallery_album_items" ("albumId", "mediaId", "actorId", "createdAt") values (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
      'update "gallery_albums" set "updatedAt" = ? where "id" = ?'
    ])
  })

  it('rolls back its items when the album’s updatedAt fails', async () => {
    const { owner, ids, albumId } = await seedAlbumWithNeighbours()
    const fresh = await postedMedia(ids(60), owner)
    const drop = await failWrite(
      'gallery_albums',
      'update',
      `new."id" = '${albumId}'`
    )
    await expectRolledBack(drop, () =>
      database.addGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: [String(fresh)],
        limit: 100
      })
    )
  })
})

describe('removeGalleryAlbumItems', () => {
  it('removes only the requested items of this album, and clears a removed cover', async () => {
    const { owner, other, albumId, neighbourId, publicA, publicB, hidden } =
      await seedAlbumWithNeighbours()
    await db()
      .updateTable('gallery_albums')
      .set({ coverMediaId: publicA })
      .where('id', 'in', [albumId, neighbourId])
      .execute()
    const neighbourBefore = await albumRow(neighbourId)

    const result = await database.removeGalleryAlbumItems({
      albumId,
      actorId: owner,
      mediaIds: [
        String(publicA),
        `${hidden}.0`,
        String(publicA),
        'nope',
        '999999'
      ]
    })
    expect(result).toEqual({ status: 'removed', removed: expect.any(Array) })
    if (result.status !== 'removed') throw new Error('not removed')
    expect([...result.removed].sort()).toEqual(
      [publicA, hidden].map(String).sort()
    )
    expect(await itemsOf(albumId)).not.toContain(publicA)
    expect(await itemsOf(albumId)).toContain(publicB)
    expect(await itemsOf(albumId)).toHaveLength(3)
    const album = await albumRow(albumId)
    expect(album?.coverMediaId).toBeNull()
    expect(album?.updatedAt).toBeGreaterThan(at('2026-01-01').getTime())
    // The same photo stays in the neighbour album, its cover too.
    expect(await itemsOf(neighbourId)).toEqual([publicA])
    expect(await albumRow(neighbourId)).toEqual(neighbourBefore)

    // A cover that is not removed stays.
    await db()
      .updateTable('gallery_albums')
      .set({ coverMediaId: publicB })
      .where('id', '=', albumId)
      .execute()
    const [kept] = (await itemsOf(albumId)).filter((id) => id !== publicB)
    await database.removeGalleryAlbumItems({
      albumId,
      actorId: owner,
      mediaIds: [String(kept)]
    })
    expect((await albumRow(albumId))?.coverMediaId).toBe(publicB)
    expect(other).toBeDefined()
  })

  it('writes nothing when nothing is removed, and is not found for a foreign album', async () => {
    const { owner, other, albumId, publicA } = await seedAlbumWithNeighbours()
    const before = await dumpTables()
    expect(
      await database.removeGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: ['999999', 'nope']
      })
    ).toEqual({ status: 'removed', removed: [] })
    // A chunk with nothing to remove sends no delete, and nothing removed
    // leaves the album's updatedAt alone.
    expect(
      await expectOneTransaction(() =>
        database.removeGalleryAlbumItems({
          albumId,
          actorId: owner,
          mediaIds: ['999999']
        })
      )
    ).toEqual([
      lockStatement(),
      'select * from "gallery_albums" where "id" = ? and "actorId" = ? limit ?',
      'select "mediaId" from "gallery_album_items" where "albumId" = ? and "mediaId" in (?)'
    ])
    expect(
      await database.removeGalleryAlbumItems({
        albumId,
        actorId: other,
        mediaIds: [String(publicA)]
      })
    ).toEqual({ status: 'not-found' })
    expect(await dumpTables()).toEqual(before)
  })

  it('locks the actor row first, then reads and deletes per chunk and touches the album, in one transaction', async () => {
    const { owner, albumId, publicA, publicB, hidden } =
      await seedAlbumWithNeighbours()
    const statements = await expectOneTransaction(() =>
      database.removeGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: [String(publicA), String(publicB), String(hidden)]
      })
    )
    expect(statements).toEqual([
      lockStatement(),
      'select * from "gallery_albums" where "id" = ? and "actorId" = ? limit ?',
      'select "mediaId" from "gallery_album_items" where "albumId" = ? and "mediaId" in (?, ?)',
      'delete from "gallery_album_items" where "albumId" = ? and "mediaId" in (?, ?)',
      'select "mediaId" from "gallery_album_items" where "albumId" = ? and "mediaId" in (?)',
      'delete from "gallery_album_items" where "albumId" = ? and "mediaId" in (?)',
      'update "gallery_albums" set "updatedAt" = ? where "id" = ?'
    ])
  })

  it('rolls back the deletes when the album write fails', async () => {
    const { owner, albumId, publicA, publicB, hidden } =
      await seedAlbumWithNeighbours()
    const drop = await failWrite(
      'gallery_albums',
      'update',
      `new."id" = '${albumId}'`
    )
    await expectRolledBack(drop, () =>
      database.removeGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: [String(publicA), String(publicB), String(hidden)]
      })
    )
  })
})

// PostgreSQL only: SQLite runs one connection, so nothing can wait on a lock.
// A transaction on a second connection holds the actor row (and, where noted,
// the album row) while the writes run; each is checked to wait for it, and
// the outcome once it is released.
describe('the actor row lock', () => {
  // Holds a transaction on its own connection, after `setup` ran in it,
  // until `release()`.
  const holdTransaction = async (setup: (trx: Db) => Promise<void>) => {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready!: (pid: number) => void
    let failed!: (error: unknown) => void
    const readyPid = new Promise<number>((resolve, reject) => {
      ready = resolve
      failed = reject
    })
    const done = db()
      .transaction()
      .execute(async (trx) => {
        const { rows } = await sql<{
          pid: number
        }>`select pg_backend_pid() as pid`.execute(trx)
        await setup(trx)
        ready(Number(rows[0].pid))
        await released
      })
      .catch((error) => {
        failed(error)
        throw error
      })
    const pid = await readyPid
    return {
      pid,
      release: async () => {
        release()
        await done
      }
    }
  }

  // Polls pg_stat_activity until `count` other backends of this database wait
  // on a lock, failing as soon as one of `operations` settles instead.
  const untilWaiting = async (
    holder: number,
    count: number,
    operations: Promise<unknown>[]
  ) => {
    let settled = false
    for (const operation of operations) {
      operation.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
    }
    const deadline = Date.now() + 20_000
    for (;;) {
      const { rows } = await sql<{
        pid: number
        query: string
      }>`select pid, query from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid() and pid <> ${holder}`.execute(
        db()
      )
      if (rows.length >= count) return rows.map((row) => plain(row.query))
      if (settled) throw new Error('an operation finished without waiting')
      if (Date.now() > deadline) throw new Error('nothing waited on the lock')
    }
  }

  const lockActorRow = (actorId: string) => async (trx: Db) => {
    await sql`select "id" from "actors" where "id" = ${actorId} for update`.execute(
      trx
    )
  }

  it.each([
    'createGalleryAlbumWithinLimit',
    'updateGalleryAlbum',
    'deleteGalleryAlbum',
    'addGalleryAlbumItems',
    'removeGalleryAlbumItems'
  ] as const)('%s waits for it before anything else', async (method) => {
    if (!isPostgres()) return
    const { owner, ids, albumId, publicA } = await seedAlbumWithNeighbours()
    const fresh = await postedMedia(ids(70), owner)
    const calls = {
      createGalleryAlbumWithinLimit: () =>
        database.createGalleryAlbumWithinLimit({
          actorId: owner,
          title: 'Waited',
          limit: 100
        }),
      updateGalleryAlbum: () =>
        database.updateGalleryAlbum({
          id: albumId,
          actorId: owner,
          title: 'Waited'
        }),
      deleteGalleryAlbum: () =>
        database.deleteGalleryAlbum({ id: albumId, actorId: owner }),
      addGalleryAlbumItems: () =>
        database.addGalleryAlbumItems({
          albumId,
          actorId: owner,
          mediaIds: [String(fresh)],
          limit: 100
        }),
      removeGalleryAlbumItems: () =>
        database.removeGalleryAlbumItems({
          albumId,
          actorId: owner,
          mediaIds: [String(publicA)]
        })
    }

    // Every statement the test sends, to tell the write's from the holder's
    // and from the poll's.
    const sent: CapturedStatement[] = []
    const listener = (query: { sql: string; __knexUid?: string }) => {
      sent.push({ sql: plain(query.sql), connection: query.__knexUid })
    }
    knex.on('query', listener)
    let operation: Promise<unknown> | undefined
    try {
      const holder = await holdTransaction(lockActorRow(owner))
      const holderConnection = sent.find((statement) =>
        statement.sql.startsWith('select pg_backend_pid()')
      )?.connection
      expect(holderConnection).toBeDefined()
      const writes = () =>
        sent.filter(
          (statement) =>
            statement.connection !== holderConnection &&
            !statement.sql.includes('pg_stat_activity')
        )
      try {
        operation = calls[method]()
        const waiting = await untilWaiting(holder.pid, 1, [operation])
        expect(waiting).toEqual([`${LOCK} for update`])
        // Nothing ran before the lock, and the lock is inside the write's
        // transaction.
        expect(writes().map((statement) => statement.sql)).toEqual([
          'begin',
          `${LOCK} for update`
        ])
      } finally {
        await holder.release()
      }
      await expect(operation).resolves.toBeDefined()
      // The lock and the write share one transaction: a lock committed on its
      // own would send the same first two statements.
      expectOneTransactionOf(writes())
    } finally {
      knex.removeListener('query', listener)
    }
  })

  it('lets two creates racing at the limit leave exactly `limit` albums', async () => {
    if (!isPostgres()) return
    const owner = await newActor()
    await seedAlbum(owner)
    // Without the lock both would count one album and insert; the insert's
    // foreign key check waits on the held row, so both would get that far.
    const holder = await holdTransaction(lockActorRow(owner))
    let results: Promise<unknown>[] = []
    try {
      results = ['Left', 'Right'].map((title) =>
        database.createGalleryAlbumWithinLimit({
          actorId: owner,
          title,
          limit: 2
        })
      )
      await untilWaiting(holder.pid, 2, results)
    } finally {
      await holder.release()
    }
    const settled = (await Promise.all(results)) as { status: string }[]
    expect(settled.map((result) => result.status).sort()).toEqual([
      'created',
      'limit-reached'
    ])
    expect(await albumIdsOf(owner)).toHaveLength(2)
  })

  it('lets two item adds racing at the item limit leave exactly `limit` items', async () => {
    if (!isPostgres()) return
    const owner = await newActor()
    const ids = mediaIds()
    const albumId = await seedAlbum(owner)
    await seedItem(albumId, await postedMedia(ids(1), owner), owner)
    const left = await postedMedia(ids(2), owner)
    const right = await postedMedia(ids(3), owner)
    // The album row is held too: without the actor lock both adds would read
    // and count, then wait in their inserts' foreign key check on it.
    const holder = await holdTransaction(async (trx) => {
      await lockActorRow(owner)(trx)
      await sql`select "id" from "gallery_albums" where "id" = ${albumId} for update`.execute(
        trx
      )
    })
    let results: Promise<unknown>[] = []
    try {
      results = [left, right].map((mediaId) =>
        database.addGalleryAlbumItems({
          albumId,
          actorId: owner,
          mediaIds: [String(mediaId)],
          limit: 2
        })
      )
      await untilWaiting(holder.pid, 2, results)
    } finally {
      await holder.release()
    }
    const settled = (await Promise.all(results)) as { status: string }[]
    expect(settled.map((result) => result.status).sort()).toEqual([
      'added',
      'limit-reached'
    ])
    expect(await itemsOf(albumId)).toHaveLength(2)
  })

  it('clears a cover set on the photo while the remove waits', async () => {
    if (!isPostgres()) return
    const { owner, albumId, publicA } = await seedAlbumWithNeighbours()
    // The cover is set before the remove starts and committed while it waits
    // for the lock; the remove reads the album after taking it, so it clears
    // the cover.
    const holder = await holdTransaction(async (trx) => {
      await lockActorRow(owner)(trx)
      await trx
        .updateTable('gallery_albums')
        .set({ coverMediaId: publicA })
        .where('id', '=', albumId)
        .execute()
    })
    let removal: Promise<unknown> | undefined
    try {
      removal = database.removeGalleryAlbumItems({
        albumId,
        actorId: owner,
        mediaIds: [String(publicA)]
      })
      await untilWaiting(holder.pid, 1, [removal])
    } finally {
      await holder.release()
    }
    expect(await removal).toEqual({
      status: 'removed',
      removed: [String(publicA)]
    })
    expect((await albumRow(albumId))?.coverMediaId).toBeNull()
  })

  it('refuses a cover whose photo is removed while the update waits', async () => {
    if (!isPostgres()) return
    const { owner, albumId, publicA } = await seedAlbumWithNeighbours()
    // The photo leaves the album before the update starts and that is
    // committed while it waits for the lock; the update checks the cover after
    // taking the lock, so it refuses it.
    const holder = await holdTransaction(async (trx) => {
      await lockActorRow(owner)(trx)
      await trx
        .deleteFrom('gallery_album_items')
        .where('albumId', '=', albumId)
        .where('mediaId', '=', publicA)
        .execute()
    })
    let update: Promise<unknown> | undefined
    try {
      update = database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        coverMediaId: String(publicA)
      })
      await untilWaiting(holder.pid, 1, [update])
    } finally {
      await holder.release()
    }
    expect(await update).toEqual({ status: 'invalid-cover' })
    expect((await albumRow(albumId))?.coverMediaId).toBeNull()
  })
})

// The id and actor id parameters are typed `string`. These pin what a value
// the types forbid does now that the shared driver binds it: Knex threw
// "Undefined binding(s) detected" for an `undefined` and compiled a `null` in
// a two-argument `where` to `IS NULL`.
describe('values the types forbid', () => {
  const UNDEFINED = undefined as unknown as string
  const NULL = null as unknown as string

  it('an undefined id or actor id matches nothing', async () => {
    const { owner, albumId, publicB } = await seedAlbumWithNeighbours()
    const before = await dumpTables()
    for (const [id, actorId] of [
      [UNDEFINED, owner],
      [albumId, UNDEFINED]
    ]) {
      expect(
        await database.getGalleryAlbum({ id, actorId, audience: OWNER })
      ).toBeNull()
      expect(
        await database.getGalleryAlbum({ id, actorId, audience: PUBLIC })
      ).toBeNull()
      expect(
        await database.updateGalleryAlbum({ id, actorId, title: 'Never' })
      ).toEqual({ status: 'not-found' })
      expect(await database.deleteGalleryAlbum({ id, actorId })).toBeFalse()
      expect(
        await database.addGalleryAlbumItems({
          albumId: id,
          actorId,
          mediaIds: [String(publicB)],
          limit: 100
        })
      ).toEqual({ status: 'not-found' })
      expect(
        await database.removeGalleryAlbumItems({
          albumId: id,
          actorId,
          mediaIds: [String(publicB)]
        })
      ).toEqual({ status: 'not-found' })
      expect(
        await database.getGalleryAlbumMedia({
          albumId: id,
          actorId,
          audience: OWNER,
          sort: 'taken_desc',
          limit: 10
        })
      ).toEqual([])
      expect(
        await database.getGalleryAlbumIndex({
          albumId: id,
          actorId,
          audience: OWNER
        })
      ).toEqual([])
      expect(
        await database.countGalleryAlbumStoredItems({ albumId: id, actorId })
      ).toBe(0)
    }
    // An undefined actor id, where only the actor is given.
    expect(
      await database.getGalleryAlbumSummaries({
        actorId: UNDEFINED,
        audience: OWNER
      })
    ).toEqual([])
    expect(
      await database.getGalleryAlbumPlaceIndexes({
        actorId: UNDEFINED,
        audience: OWNER
      })
    ).toEqual([])
    for (const audience of [OWNER, PUBLIC]) {
      expect(
        await database.countGalleryAlbumMedia({ actorId: UNDEFINED, audience })
      ).toBe(0)
      expect(
        await database.getActorHasVisibleGalleryAlbums({
          actorId: UNDEFINED,
          audience
        })
      ).toBeFalse()
    }
    expect(
      await database.getAlbumsForMedia({
        mediaId: String(publicB),
        actorId: UNDEFINED,
        audience: OWNER
      })
    ).toEqual([])
    expect(await dumpTables()).toEqual(before)
  })

  it('createGalleryAlbumWithinLimit with an undefined actor id fails on the insert and leaves nothing behind', async () => {
    const before = await dumpTables()
    await expect(
      database.createGalleryAlbumWithinLimit({
        actorId: UNDEFINED,
        title: 'Never',
        limit: 100
      })
    ).rejects.toThrow(
      isPostgres()
        ? /^null value in column "actorId" of relation "gallery_albums" violates not-null constraint$/
        : /^NOT NULL constraint failed: gallery_albums\.actorId$/
    )
    expect(await dumpTables()).toEqual(before)
  })

  it('a null id matches no NULL-id album row (SQLite, where the primary key admits NULL)', async () => {
    if (isPostgres()) return
    const owner = await newActor()
    const ids = mediaIds()
    const photo = await postedMedia(ids(1), owner)
    await sql`insert into "gallery_albums" ("id", "actorId", "title", "visibility", "sortOrder", "createdAt", "updatedAt") values (null, ${owner}, 'Null id', 'public', 'taken_desc', 1000, 1000)`.execute(
      db()
    )
    try {
      const before = await dumpTables()
      expect(
        await database.getGalleryAlbum({
          id: NULL,
          actorId: owner,
          audience: OWNER
        })
      ).toBeNull()
      expect(
        await database.getGalleryAlbumSummaries({
          actorId: owner,
          audience: OWNER,
          albumId: NULL
        })
      ).toEqual([])
      expect(
        await database.updateGalleryAlbum({
          id: NULL,
          actorId: owner,
          title: 'Never'
        })
      ).toEqual({ status: 'not-found' })
      expect(
        await database.addGalleryAlbumItems({
          albumId: NULL,
          actorId: owner,
          mediaIds: [String(photo)],
          limit: 100
        })
      ).toEqual({ status: 'not-found' })
      expect(
        await database.removeGalleryAlbumItems({
          albumId: NULL,
          actorId: owner,
          mediaIds: [String(photo)]
        })
      ).toEqual({ status: 'not-found' })
      expect(
        await database.deleteGalleryAlbum({ id: NULL, actorId: owner })
      ).toBeFalse()
      expect(await dumpTables()).toEqual(before)
      // Listed with the rest, as before.
      expect(
        (
          await database.getGalleryAlbumSummaries({
            actorId: owner,
            audience: OWNER
          })
        ).map((summary) => summary.album.title)
      ).toEqual(['Null id'])
    } finally {
      await db().deleteFrom('gallery_albums').where('id', 'is', null).execute()
    }
  })
})

describe('driver errors', () => {
  it('carry the driver’s own message, without the statement in front', async () => {
    const owner = await newActor()
    const albumId = await seedAlbum(owner)
    const ghost = `https://${DOMAIN}/users/ghost`
    const before = await dumpTables()

    // Anchored at both ends: a message that starts with Knex's
    // `insert into ... - ` fails them.
    const foreignKey = isPostgres()
      ? /^insert or update on table "gallery_albums" violates foreign key constraint "gallery_albums_actorid_foreign"$/
      : /^FOREIGN KEY constraint failed$/
    const notNull = isPostgres()
      ? /^null value in column "title" of relation "gallery_albums" violates not-null constraint$/
      : /^NOT NULL constraint failed: gallery_albums\.title$/
    expect(
      `insert into "gallery_albums" ("actorId") values (?) - ${isPostgres() ? 'insert or update on table "gallery_albums" violates foreign key constraint "gallery_albums_actorid_foreign"' : 'FOREIGN KEY constraint failed'}`
    ).not.toMatch(foreignKey)

    await expect(
      database.createGalleryAlbumWithinLimit({
        actorId: ghost,
        title: 'No actor',
        limit: 100
      })
    ).rejects.toThrow(foreignKey)
    await expect(
      database.updateGalleryAlbum({
        id: albumId,
        actorId: owner,
        title: null as unknown as string
      })
    ).rejects.toThrow(notNull)
    if (isPostgres()) {
      // Only PostgreSQL enforces the varchar(120) title.
      await expect(
        database.createGalleryAlbumWithinLimit({
          actorId: owner,
          title: 'x'.repeat(121),
          limit: 100
        })
      ).rejects.toThrow(/^value too long for type character varying\(120\)$/)
    }
    expect(await dumpTables()).toEqual(before)
  })
})
