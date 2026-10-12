import { type Insertable, sql } from 'kysely'

import { lockGalleryAlbumActor } from '@/lib/database/domains/media/galleryAlbumCleanup'
import {
  deleteMediaForAccount,
  deleteMediaWithFiles,
  markMediaUploadVerified
} from '@/lib/database/domains/media/writes'
import type { Medias } from '@/lib/database/kysely/db'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { withStaleFirstRead } from '@/lib/database/testing/staleRead'

// The media writes (lib/database/domains/media/writes.ts) and the gallery album
// cleanup they share with the album writes, on both backends. Each where and
// limit is pinned next to a row it must leave alone (another media of the same
// account, another account's, another status's attachment, another media's
// album items, edit files and covers), each transaction is checked to keep
// nothing when its last write fails, and the row locks are read off the
// statements PostgreSQL is sent. The Knex album writes take the album lock
// through `kyselyFor(trx)`; that it runs inside their own transaction is
// pinned at the end. Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const { database, db } = testDb

const DOMAIN = 'media-writes.test'

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

afterEach(() => {
  vi.useRealTimers()
})

let sequence = 0
// Ids that differ in digits only, so they sort the same under any collation.
const nextKey = () => {
  sequence += 1
  return String(sequence).padStart(4, '0')
}

// An actor and, unless `withAccount` is false, the account it belongs to.
const newOwner = async ({ withAccount = true } = {}) => {
  const key = nextKey()
  const accountId = `account-${key}`
  const actorId = `https://${DOMAIN}/users/owner${key}`
  if (withAccount) {
    await db.insertInto('accounts').values({ id: accountId }).execute()
  }
  await db
    .insertInto('actors')
    .values({
      id: actorId,
      username: `owner${key}`,
      domain: DOMAIN,
      accountId: withAccount ? accountId : null,
      createdAt: new Date(1),
      updatedAt: new Date(1)
    })
    .execute()
  return { accountId, actorId }
}

// A second actor of the same account.
const newActorOf = async (accountId: string) => {
  const key = nextKey()
  const actorId = `https://${DOMAIN}/users/second${key}`
  await db
    .insertInto('actors')
    .values({
      id: actorId,
      username: `second${key}`,
      domain: DOMAIN,
      accountId,
      createdAt: new Date(1),
      updatedAt: new Date(1)
    })
    .execute()
  return actorId
}

const pendingMetaData = (key: string) => ({
  width: 640,
  height: 480,
  upload: { state: 'pending', clientPath: `medias/${key}-client.jpg` }
})

// A `medias` row written straight to the table. The id comes from the
// sequence, as createMedia's does.
const seedMedia = async (
  actorId: string | null,
  values: Partial<Insertable<Medias>> = {}
) => {
  const key = nextKey()
  const row = await db
    .insertInto('medias')
    .values({
      actorId,
      original: `medias/${key}.jpg`,
      originalBytes: 1000,
      originalMimeType: 'image/jpeg',
      originalMetaData: JSON.stringify({ width: 640, height: 480 }),
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
      ...values
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

const mediaRow = (id: number) =>
  db.selectFrom('medias').selectAll().where('id', '=', id).executeTakeFirst()

const counterValue = async (id: string) =>
  (
    await db
      .selectFrom('counters')
      .select('value')
      .where('id', '=', id)
      .executeTakeFirst()
  )?.value ?? null

const setCounter = (id: string, value: number) =>
  db
    .insertInto('counters')
    .values({ id, value, createdAt: new Date(1), updatedAt: new Date(1) })
    .onConflict((oc) => oc.column('id').doUpdateSet({ value }))
    .execute()

const addAttachment = async ({
  actorId,
  statusId,
  mediaId = null,
  mediaType = 'image/jpeg',
  key = nextKey()
}: {
  actorId: string
  statusId: string
  mediaId?: number | null
  mediaType?: string
  key?: string
}) => {
  const id = `${statusId}/attachments/${key}`
  await db
    .insertInto('attachments')
    .values({
      id,
      actorId,
      statusId,
      type: 'Document',
      mediaType,
      url: `https://${DOMAIN}/files/${key}.${mediaType === 'image/jpeg' ? 'jpg' : 'gpx'}`,
      width: 640,
      height: 480,
      name: '',
      mediaId,
      createdAt: new Date(1000),
      updatedAt: new Date(1000)
    })
    .execute()
  return id
}

const attachmentRow = (id: string) =>
  db
    .selectFrom('attachments')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

const addAlbum = async (actorId: string, coverMediaId: number | null) => {
  const id = `album-${nextKey()}`
  await db
    .insertInto('gallery_albums')
    .values({
      id,
      actorId,
      title: id,
      coverMediaId,
      createdAt: new Date(1000),
      updatedAt: new Date(1000)
    })
    .execute()
  return id
}

const addAlbumItem = (albumId: string, mediaId: number, actorId: string) =>
  db
    .insertInto('gallery_album_items')
    .values({ albumId, mediaId, actorId, createdAt: new Date(1000) })
    .execute()

const addEditFile = async (
  mediaId: number,
  actorId: string,
  slot: string,
  bytes: number,
  metaData: object = {}
) => {
  const id = `edit-${nextKey()}`
  await db
    .insertInto('media_edit_files')
    .values({
      id,
      mediaId,
      actorId,
      slot,
      path: `edits/${id}.webp`,
      bytes,
      mimeType: 'image/webp',
      metaData: JSON.stringify(metaData),
      createdAt: new Date(1000)
    })
    .execute()
  return `edits/${id}.webp`
}

const dumpTables = async () => ({
  medias: await db.selectFrom('medias').selectAll().orderBy('id').execute(),
  attachments: await db
    .selectFrom('attachments')
    .selectAll()
    .orderBy('id')
    .execute(),
  counters: await db.selectFrom('counters').selectAll().orderBy('id').execute(),
  galleryAlbums: await db
    .selectFrom('gallery_albums')
    .selectAll()
    .orderBy('id')
    .execute(),
  galleryAlbumItems: await db
    .selectFrom('gallery_album_items')
    .selectAll()
    .orderBy('albumId')
    .orderBy('mediaId')
    .execute(),
  mediaEditFiles: await db
    .selectFrom('media_edit_files')
    .selectAll()
    .orderBy('id')
    .execute()
})

// Makes the next write on `table` matching `condition` (SQL over `new`, valid
// on both backends) fail, for each of `events`. Returns the function that
// removes the triggers again.
let triggerCount = 0
const failWrite = async (
  table: 'counters' | 'attachments' | 'medias',
  events: ('insert' | 'update')[],
  condition: string
) => {
  const drops: (() => Promise<void>)[] = []
  for (const event of events) {
    triggerCount += 1
    const name = `media_writes_fail_${triggerCount}`
    if (testDb.backend === 'pg') {
      await sql
        .raw(
          `create or replace function ${name}() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
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
          `create trigger ${name} before ${event} on "${table}" when ${condition} begin select raise(abort, 'forced failure'); end`
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

// Runs `action` expecting it to fail on the forced write, then checks every
// table the media writes touch is exactly as it was.
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

// The statements `action` sends, with the connection each ran on. `onQuery`
// rather than `captureQueries`, which does not report the connection.
const captureStatements = async <T>(action: () => Promise<T>) => {
  const statements: CapturedStatement[] = []
  const unsubscribe = testDb.onQuery(({ sql, connection }) => {
    statements.push({ sql, connection })
  })
  try {
    const result = await action()
    return { result, statements }
  } finally {
    unsubscribe()
  }
}

// What the statements of a media delete do, for the ones whose order is the
// lock order: the owner's actor-row lock, the media row, then the album rows,
// then the `medias` row itself. The same statements run on both backends;
// PostgreSQL adds `for update` to the two locks, which the tests read off the
// statement text.
const lockOrderSteps = (statements: CapturedStatement[]) =>
  statements.flatMap(({ sql: text }) => {
    if (
      /^select "id" from "actors" where "id" = (\$1|\?)( for update)?$/.test(
        text
      )
    )
      return ['lock the actor row']
    if (/^select .*"originalBytes".* from "medias" where "id" = /.test(text))
      return ['lock the media row']
    if (text.startsWith('delete from "gallery_album_items"'))
      return ['delete the album items']
    if (text.startsWith('update "gallery_albums" set "coverMediaId"'))
      return ['clear the album covers']
    if (text.startsWith('delete from "medias"')) return ['delete the media row']
    return []
  })

const LOCK_ORDER = [
  'lock the actor row',
  'lock the media row',
  'delete the album items',
  'clear the album covers',
  'delete the media row'
]

const isPostgres = () => testDb.backend === 'pg'

describe('createMedia', () => {
  const HOUR = '2026030405'
  const now = new Date('2026-03-04T05:06:07.000Z')

  it('writes the row and moves the owner account counters and the hour buckets', async () => {
    // Inserted first, so an actor lookup without its id would find it.
    const neighbour = await newOwner()
    await setCounter(`media-usage:${neighbour.accountId}`, 50)
    await setCounter(`total-media:${neighbour.accountId}`, 5)
    const owner = await newOwner()
    const filesBefore = Number(
      (await counterValue(`bucket:media-files:${HOUR}`)) ?? 0
    )
    const bytesBefore = Number(
      (await counterValue(`bucket:media-bytes:${HOUR}`)) ?? 0
    )

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const media = await database.createMedia({
      actorId: owner.actorId,
      original: {
        path: 'medias/created.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 640, height: 480 },
        fileName: 'holiday.jpg'
      },
      thumbnail: {
        path: 'medias/created-thumb.jpg',
        bytes: 200,
        mimeType: 'image/jpeg',
        metaData: { width: 64, height: 48 }
      },
      description: 'A heron',
      focus: { x: 0.5, y: -0.25 },
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
      details: { subjectName: 'Grey heron', inGallery: true }
    })
    vi.useRealTimers()

    const row = await mediaRow(Number(media!.id))
    expect(media).toMatchObject({
      id: String(row!.id),
      actorId: owner.actorId,
      description: 'A heron',
      focus: { x: 0.5, y: -0.25 },
      details: { subjectName: 'Grey heron', inGallery: true }
    })
    expect(row).toMatchObject({
      actorId: owner.actorId,
      original: 'medias/created.jpg',
      originalBytes: 1000,
      originalFileName: 'holiday.jpg',
      originalMetaData: { width: 640, height: 480 },
      thumbnail: 'medias/created-thumb.jpg',
      thumbnailBytes: 200,
      thumbnailMetaData: { width: 64, height: 48 },
      description: 'A heron',
      focusX: 0.5,
      focusY: -0.25,
      subjectName: 'Grey heron',
      inGallery: true
    })
    expect(await counterValue(`media-usage:${owner.accountId}`)).toBe(1200)
    expect(await counterValue(`total-media:${owner.accountId}`)).toBe(1)
    expect(await counterValue(`media-usage:${neighbour.accountId}`)).toBe(50)
    expect(await counterValue(`total-media:${neighbour.accountId}`)).toBe(5)
    expect(await counterValue(`bucket:media-files:${HOUR}`)).toBe(
      filesBefore + 1
    )
    expect(await counterValue(`bucket:media-bytes:${HOUR}`)).toBe(
      bytesBefore + 1200
    )
    const buckets = await db
      .selectFrom('counters')
      .select('bucketHour')
      .where('id', 'in', [
        `bucket:media-files:${HOUR}`,
        `bucket:media-bytes:${HOUR}`
      ])
      .execute()
    expect(buckets.map((bucket) => bucket.bucketHour)).toEqual([
      Date.parse('2026-03-04T05:00:00.000Z'),
      Date.parse('2026-03-04T05:00:00.000Z')
    ])
  })

  it('counts only the hour buckets for an actor with no account or no row', async () => {
    const accountless = await newOwner({ withAccount: false })
    const ghost = `https://${DOMAIN}/users/ghost${nextKey()}`
    for (const actorId of [accountless.actorId, ghost]) {
      const before = await dumpTables()
      const media = await database.createMedia({
        actorId,
        original: {
          path: `medias/${nextKey()}.jpg`,
          bytes: 300,
          mimeType: 'image/jpeg',
          metaData: { width: 1, height: 1 }
        }
      })
      expect(await mediaRow(Number(media!.id))).toMatchObject({ actorId })
      const after = await dumpTables()
      const changed = after.counters
        .filter(
          (counter) =>
            !before.counters.some(
              (old) => old.id === counter.id && old.value === counter.value
            )
        )
        .map((counter) => counter.id.split(':').slice(0, 2).join(':'))
      expect(changed.sort()).toEqual([
        'bucket:media-bytes',
        'bucket:media-files'
      ])
    }
  })

  it('writes nothing and answers null without an actor id', async () => {
    const before = await dumpTables()
    expect(
      await database.createMedia({
        actorId: '',
        original: {
          path: 'medias/none.jpg',
          bytes: 1,
          mimeType: 'image/jpeg',
          metaData: { width: 1, height: 1 }
        }
      })
    ).toBeNull()
    expect(await dumpTables()).toEqual(before)
  })

  it('keeps nothing when its last write fails', async () => {
    const owner = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 10)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-05T06:00:00.000Z'))
    // The last write sets the new media-bytes bucket's hour.
    await db
      .deleteFrom('counters')
      .where('id', '=', 'bucket:media-bytes:2026030506')
      .execute()
    const drop = await failWrite(
      'counters',
      ['update'],
      `new.id = 'bucket:media-bytes:2026030506' and new."bucketHour" is not null`
    )
    await expectRolledBack(drop, () =>
      database.createMedia({
        actorId: owner.actorId,
        original: {
          path: 'medias/rolled-back.jpg',
          bytes: 500,
          mimeType: 'image/jpeg',
          metaData: { width: 1, height: 1 }
        }
      })
    )
  })
})

describe('markMediaUploadVerified', () => {
  const verify = (mediaId: number, accountId: string, originalBytes?: number) =>
    database.markMediaUploadVerified({
      mediaId: String(mediaId),
      accountId,
      verifiedAt: 1234,
      ...(originalBytes === undefined ? null : { originalBytes })
    })

  it('verifies only the named upload of the account and moves its usage', async () => {
    const owner = await newOwner()
    const other = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 5000)
    await setCounter(`media-usage:${other.accountId}`, 7000)
    // Pending uploads of the same actor, written before the one verified.
    const neighbour = await seedMedia(owner.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('neighbour'))
    })
    const media = await seedMedia(owner.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('media'))
    })
    const foreign = await seedMedia(other.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('foreign'))
    })

    const result = await verify(media, owner.accountId, 1300)

    expect(result).toMatchObject({
      transitioned: true,
      media: {
        id: String(media),
        original: {
          bytes: 1300,
          metaData: { upload: { state: 'verified', verifiedAt: 1234 } }
        }
      }
    })
    expect(await mediaRow(media)).toMatchObject({
      originalBytes: 1300,
      originalMetaData: { upload: { state: 'verified', verifiedAt: 1234 } }
    })
    for (const id of [neighbour, foreign]) {
      expect(await mediaRow(id)).toMatchObject({
        originalBytes: 1000,
        originalMetaData: { upload: { state: 'pending' } }
      })
    }
    expect(await counterValue(`media-usage:${owner.accountId}`)).toBe(5300)
    expect(await counterValue(`media-usage:${other.accountId}`)).toBe(7000)
  })

  it('decreases the usage when the rewritten original is smaller', async () => {
    const owner = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 5000)
    const media = await seedMedia(owner.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('smaller'))
    })

    await verify(media, owner.accountId, 600)

    expect(await counterValue(`media-usage:${owner.accountId}`)).toBe(4600)
  })

  it('answers null for another account and leaves the upload pending', async () => {
    const owner = await newOwner()
    const other = await newOwner()
    const media = await seedMedia(other.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('foreign'))
    })
    const before = await dumpTables()

    expect(await verify(media, owner.accountId, 2000)).toBeNull()
    expect(await dumpTables()).toEqual(before)
  })

  it('reads back the details it wrote with the verification', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('details'))
    })

    const result = await database.markMediaUploadVerified({
      mediaId: String(media),
      accountId: owner.accountId,
      verifiedAt: 1,
      details: { takenAt: Date.parse('2026-01-02T03:04:05.000Z') }
    })

    expect(result?.media.details).toMatchObject({
      takenAt: Date.parse('2026-01-02T03:04:05.000Z')
    })
  })

  it('changes nothing when another completion verified the row after the read', async () => {
    const owner = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 5000)
    const media = await seedMedia(owner.actorId, {
      originalMetaData: JSON.stringify({
        width: 640,
        height: 480,
        upload: { state: 'verified', verifiedAt: 99 }
      })
    })
    const before = await dumpTables()
    // The first read still sees the upload pending.
    const stale = withStaleFirstRead(db, 'medias', (rows) =>
      rows.map((row) => ({
        ...row,
        originalMetaData: pendingMetaData('raced')
      }))
    )

    const result = await markMediaUploadVerified(stale, {
      mediaId: String(media),
      accountId: owner.accountId,
      verifiedAt: 1234,
      originalBytes: 3000
    })

    expect(result).toMatchObject({
      transitioned: false,
      media: {
        id: String(media),
        original: {
          bytes: 1000,
          metaData: { upload: { state: 'verified', verifiedAt: 99 } }
        }
      }
    })
    expect(await dumpTables()).toEqual(before)
  })

  it('locks only the media row on PostgreSQL', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('lock'))
    })

    const { statements } = await captureStatements(() =>
      verify(media, owner.accountId)
    )

    const read = statements.find((statement) =>
      statement.sql.startsWith('select')
    )
    expect(read?.sql).toMatch(/inner join "actors"/)
    if (isPostgres()) expect(read?.sql).toMatch(/ for update of "medias"$/)
    else expect(read?.sql).not.toMatch(/for update/)
  })

  it('keeps the upload pending when its last write fails', async () => {
    const owner = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 5000)
    const media = await seedMedia(owner.actorId, {
      originalMetaData: JSON.stringify(pendingMetaData('rollback'))
    })
    const drop = await failWrite(
      'counters',
      ['insert', 'update'],
      `new.id = 'media-usage:${owner.accountId}'`
    )

    await expectRolledBack(drop, () => verify(media, owner.accountId, 1500))
  })
})

describe('createAttachment', () => {
  it('writes the canonical media id and the optional columns as given', async () => {
    const owner = await newOwner()
    const statusId = `${owner.actorId}/statuses/${nextKey()}`

    const attachment = await database.createAttachment({
      actorId: owner.actorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://${DOMAIN}/files/canonical.jpg`,
      width: 10,
      height: 20,
      mediaId: '0012.0',
      createdAt: 5000,
      focus: { x: 0.25, y: 0.5 }
    })

    expect(await attachmentRow(attachment.id)).toMatchObject({
      actorId: owner.actorId,
      statusId,
      type: 'Document',
      mediaType: 'image/jpeg',
      width: 10,
      height: 20,
      name: '',
      mediaId: 12,
      blurhash: null,
      focusX: 0.25,
      focusY: 0.5,
      thumbnailUrl: null,
      playbackType: null,
      createdAt: 5000,
      updatedAt: 5000
    })
    expect(attachment).toMatchObject({
      id: expect.any(String),
      createdAt: 5000
    })
  })
})

describe('updateAttachmentPlayback', () => {
  it('updates only the named attachment of the named status', async () => {
    const owner = await newOwner()
    const statusId = `${owner.actorId}/statuses/${nextKey()}`
    const otherStatusId = `${owner.actorId}/statuses/${nextKey()}`
    const target = await addAttachment({ actorId: owner.actorId, statusId })
    const sibling = await addAttachment({ actorId: owner.actorId, statusId })

    // The attachment id alone is not enough.
    expect(
      await database.updateAttachmentPlayback({
        id: target,
        statusId: otherStatusId,
        playbackType: 'gifv'
      })
    ).toBeFalse()
    expect(await attachmentRow(target)).toMatchObject({ playbackType: null })

    expect(
      await database.updateAttachmentPlayback({
        id: target,
        statusId,
        playbackType: 'gifv',
        thumbnailUrl: `https://${DOMAIN}/files/thumb.jpg`
      })
    ).toBeTrue()
    expect(await attachmentRow(target)).toMatchObject({
      playbackType: 'gifv',
      thumbnailUrl: `https://${DOMAIN}/files/thumb.jpg`
    })
    expect(await attachmentRow(sibling)).toMatchObject({
      playbackType: null,
      thumbnailUrl: null
    })
  })

  it('stamps updatedAt on the attachment it writes and on no other', async () => {
    const owner = await newOwner()
    const statusId = `${owner.actorId}/statuses/${nextKey()}`
    const target = await addAttachment({ actorId: owner.actorId, statusId })
    const sibling = await addAttachment({ actorId: owner.actorId, statusId })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(777000))
    await database.updateAttachmentPlayback({
      id: target,
      statusId,
      playbackType: 'gifv'
    })
    vi.useRealTimers()

    expect(await attachmentRow(target)).toMatchObject({ updatedAt: 777000 })
    expect(await attachmentRow(sibling)).toMatchObject({ updatedAt: 1000 })
  })

  it('leaves a set playback alone with onlyIfUnset and keeps an omitted thumbnail', async () => {
    const owner = await newOwner()
    const statusId = `${owner.actorId}/statuses/${nextKey()}`
    const target = await addAttachment({ actorId: owner.actorId, statusId })
    await database.updateAttachmentPlayback({
      id: target,
      statusId,
      playbackType: 'video',
      thumbnailUrl: `https://${DOMAIN}/files/kept.jpg`
    })

    expect(
      await database.updateAttachmentPlayback({
        id: target,
        statusId,
        playbackType: 'gifv',
        onlyIfUnset: true
      })
    ).toBeFalse()
    expect(await attachmentRow(target)).toMatchObject({
      playbackType: 'video'
    })

    expect(
      await database.updateAttachmentPlayback({
        id: target,
        statusId,
        playbackType: 'gifv'
      })
    ).toBeTrue()
    expect(await attachmentRow(target)).toMatchObject({
      playbackType: 'gifv',
      thumbnailUrl: `https://${DOMAIN}/files/kept.jpg`
    })

    await database.updateAttachmentPlayback({
      id: target,
      statusId,
      playbackType: 'gifv',
      thumbnailUrl: null
    })
    expect(await attachmentRow(target)).toMatchObject({ thumbnailUrl: null })
  })
})

describe('replaceRemoteAttachmentsForStatus', () => {
  const newAttachment = (statusId: string, name: string) => ({
    actorId: `https://remote.test/users/someone`,
    statusId,
    mediaType: 'image/jpeg',
    url: `https://remote.test/media/${name}.jpg`,
    name,
    createdAt: 9000
  })

  const urlsOf = async (statusId: string) =>
    (
      await db
        .selectFrom('attachments')
        .select('url')
        .where('statusId', '=', statusId)
        .orderBy('url')
        .execute()
    ).map((row) => row.url)

  it('swaps only the status remote rows, keeping a local media and a fitness file', async () => {
    const owner = await newOwner()
    const statusId = `${owner.actorId}/statuses/${nextKey()}`
    const otherStatusId = `${owner.actorId}/statuses/${nextKey()}`
    const media = await seedMedia(owner.actorId)
    await addAttachment({ actorId: owner.actorId, statusId, key: 'r1' })
    await addAttachment({ actorId: owner.actorId, statusId, key: 'r2' })
    await addAttachment({
      actorId: owner.actorId,
      statusId,
      key: 'local',
      mediaId: media
    })
    await addAttachment({
      actorId: owner.actorId,
      statusId,
      key: 'ride',
      mediaType: 'application/gpx+xml'
    })
    await addAttachment({
      actorId: owner.actorId,
      statusId: otherStatusId,
      key: 'r3'
    })

    // The new row names another status: the swap writes it under the one it
    // replaces.
    await database.replaceRemoteAttachmentsForStatus({
      statusId,
      attachments: [newAttachment(otherStatusId, 'fresh')]
    })

    expect(await urlsOf(statusId)).toEqual([
      `https://${DOMAIN}/files/local.jpg`,
      `https://${DOMAIN}/files/ride.gpx`,
      'https://remote.test/media/fresh.jpg'
    ])
    expect(await urlsOf(otherStatusId)).toEqual([
      `https://${DOMAIN}/files/r3.jpg`
    ])
  })

  // With nothing to remove the delete is left out: PostgreSQL rejects an empty
  // `in ()` list, and SQLite would only match no row.
  it('writes the new rows on a status with no remote rows to remove', async () => {
    const owner = await newOwner()
    const emptyStatusId = `${owner.actorId}/statuses/${nextKey()}`
    const localStatusId = `${owner.actorId}/statuses/${nextKey()}`
    const media = await seedMedia(owner.actorId)
    // Only a local media attachment and a fitness file: both are kept.
    await addAttachment({
      actorId: owner.actorId,
      statusId: localStatusId,
      key: 'local',
      mediaId: media
    })
    await addAttachment({
      actorId: owner.actorId,
      statusId: localStatusId,
      key: 'ride',
      mediaType: 'application/gpx+xml'
    })

    for (const statusId of [emptyStatusId, localStatusId]) {
      const { statements } = await captureStatements(() =>
        database.replaceRemoteAttachmentsForStatus({
          statusId,
          attachments: [newAttachment(statusId, 'fresh')]
        })
      )
      expect(
        statements.filter((statement) =>
          statement.sql.startsWith('delete from "attachments"')
        )
      ).toEqual([])
    }

    expect(await urlsOf(emptyStatusId)).toEqual([
      'https://remote.test/media/fresh.jpg'
    ])
    expect(await urlsOf(localStatusId)).toEqual([
      `https://${DOMAIN}/files/local.jpg`,
      `https://${DOMAIN}/files/ride.gpx`,
      'https://remote.test/media/fresh.jpg'
    ])
  })

  it('keeps the stored rows when its last write fails', async () => {
    const owner = await newOwner()
    const statusId = `${owner.actorId}/statuses/${nextKey()}`
    await addAttachment({ actorId: owner.actorId, statusId })
    const drop = await failWrite(
      'attachments',
      ['insert'],
      `new.url = 'https://remote.test/media/second.jpg'`
    )

    await expectRolledBack(drop, () =>
      database.replaceRemoteAttachmentsForStatus({
        statusId,
        attachments: [
          newAttachment(statusId, 'first'),
          newAttachment(statusId, 'second')
        ]
      })
    )
  })
})

describe('updateMedia', () => {
  const thumbnail = (path: string, bytes: number) => ({
    path,
    bytes,
    mimeType: 'image/jpeg',
    metaData: { width: 64, height: 48 }
  })

  it('updates only the named media of the account and moves its usage', async () => {
    const owner = await newOwner()
    const other = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 5000)
    await setCounter(`media-usage:${other.accountId}`, 7000)
    // Written first, so a read without the media id would find it.
    const neighbour = await seedMedia(owner.actorId, {
      thumbnail: 'medias/neighbour-thumb.jpg',
      thumbnailBytes: 100
    })
    const media = await seedMedia(owner.actorId, {
      thumbnail: 'medias/old-thumb.jpg',
      thumbnailBytes: 100
    })

    const result = await database.updateMedia({
      mediaId: String(media),
      accountId: owner.accountId,
      description: 'Updated',
      thumbnail: thumbnail('medias/new-thumb.jpg', 250)
    })

    expect(result).toMatchObject({
      media: {
        id: String(media),
        description: 'Updated',
        thumbnail: { path: 'medias/new-thumb.jpg', bytes: 250 }
      },
      replacedThumbnailPath: 'medias/old-thumb.jpg'
    })
    expect(await mediaRow(neighbour)).toMatchObject({
      description: null,
      thumbnail: 'medias/neighbour-thumb.jpg',
      thumbnailBytes: 100
    })
    expect(await counterValue(`media-usage:${owner.accountId}`)).toBe(5150)
    expect(await counterValue(`media-usage:${other.accountId}`)).toBe(7000)

    await database.updateMedia({
      mediaId: String(media),
      accountId: owner.accountId,
      thumbnail: thumbnail('medias/newer-thumb.jpg', 50)
    })
    expect(await counterValue(`media-usage:${owner.accountId}`)).toBe(4950)

    // Rewriting the same path replaces no file.
    expect(
      await database.updateMedia({
        mediaId: String(media),
        accountId: owner.accountId,
        thumbnail: thumbnail('medias/newer-thumb.jpg', 60)
      })
    ).toMatchObject({ replacedThumbnailPath: null })
    expect(await counterValue(`media-usage:${owner.accountId}`)).toBe(4960)
  })

  it('stamps updatedAt on the media it writes and on no other', async () => {
    const owner = await newOwner()
    const neighbour = await seedMedia(owner.actorId)
    const media = await seedMedia(owner.actorId)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(777000))
    await database.updateMedia({
      mediaId: String(media),
      accountId: owner.accountId,
      description: 'Edited'
    })
    vi.useRealTimers()

    expect(await mediaRow(media)).toMatchObject({
      description: 'Edited',
      updatedAt: 777000
    })
    expect(await mediaRow(neighbour)).toMatchObject({ updatedAt: 1000 })
  })

  it('stores a trimmed taxon key, and a blank one as no key', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId)

    await database.updateMedia({
      mediaId: String(media),
      accountId: owner.accountId,
      details: { subjectTaxonKey: ' 2481 ' }
    })
    expect(await mediaRow(media)).toMatchObject({ subjectTaxonKey: '2481' })

    await database.updateMedia({
      mediaId: String(media),
      accountId: owner.accountId,
      details: { subjectTaxonKey: '   ' }
    })
    expect(await mediaRow(media)).toMatchObject({ subjectTaxonKey: null })
  })

  it('answers null for another account or another actor of the account', async () => {
    const owner = await newOwner()
    const other = await newOwner()
    const secondActor = await newActorOf(owner.accountId)
    const media = await seedMedia(owner.actorId)
    const before = await dumpTables()

    expect(
      await database.updateMedia({
        mediaId: String(media),
        accountId: other.accountId,
        description: 'Stolen'
      })
    ).toBeNull()
    expect(
      await database.updateMedia({
        mediaId: String(media),
        accountId: owner.accountId,
        actorId: secondActor,
        description: 'Wrong actor'
      })
    ).toBeNull()
    expect(await dumpTables()).toEqual(before)

    expect(
      await database.updateMedia({
        mediaId: String(media),
        accountId: owner.accountId,
        actorId: owner.actorId,
        description: 'Right actor'
      })
    ).toMatchObject({ media: { description: 'Right actor' } })
  })

  it('locks only the media row on PostgreSQL, and only when it writes details', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId)
    const firstRead = async (details?: { subjectName: string }) => {
      const { statements } = await captureStatements(() =>
        database.updateMedia({
          mediaId: String(media),
          accountId: owner.accountId,
          description: 'Locked',
          ...(details ? { details } : null)
        })
      )
      return statements.find((statement) => statement.sql.startsWith('select'))
        ?.sql
    }

    const withDetails = await firstRead({ subjectName: 'Heron' })
    if (isPostgres()) expect(withDetails).toMatch(/ for update of "medias"$/)
    else expect(withDetails).not.toMatch(/for update/)
    expect(await firstRead()).not.toMatch(/for update/)
  })

  it('keeps the row when its last write fails', async () => {
    const owner = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 5000)
    const media = await seedMedia(owner.actorId, {
      thumbnail: 'medias/kept-thumb.jpg',
      thumbnailBytes: 100
    })
    const drop = await failWrite(
      'counters',
      ['insert', 'update'],
      `new.id = 'media-usage:${owner.accountId}'`
    )

    await expectRolledBack(drop, () =>
      database.updateMedia({
        mediaId: String(media),
        accountId: owner.accountId,
        description: 'Rolled back',
        thumbnail: thumbnail('medias/rolled-back-thumb.jpg', 300)
      })
    )
  })
})

describe('deleteAttachmentsByIds', () => {
  it('deletes only the listed attachments and counts them', async () => {
    const owner = await newOwner()
    const statusId = `${owner.actorId}/statuses/${nextKey()}`
    const first = await addAttachment({ actorId: owner.actorId, statusId })
    const second = await addAttachment({ actorId: owner.actorId, statusId })
    const kept = await addAttachment({ actorId: owner.actorId, statusId })

    expect(await database.deleteAttachmentsByIds({ attachmentIds: [] })).toBe(0)
    expect(
      await database.deleteAttachmentsByIds({
        attachmentIds: [first, second, `${statusId}/attachments/missing`]
      })
    ).toBe(2)
    expect(await attachmentRow(first)).toBeUndefined()
    expect(await attachmentRow(second)).toBeUndefined()
    expect(await attachmentRow(kept)).toBeDefined()
  })
})

describe('media deletes', () => {
  // An account's media with everything a delete removes or frees: a thumbnail,
  // the presigned key it was uploaded through, photo edit files (the uploaded
  // original with its own presigned key, and a superseded render), an album
  // item in an album whose cover it is. Beside it, a media of the same actor
  // in the same album and covering another album, with its own edit file, and
  // an account written earlier whose counters must not move.
  const seedDeletable = async () => {
    const neighbourOwner = await newOwner()
    await setCounter(`media-usage:${neighbourOwner.accountId}`, 50)
    await setCounter(`total-media:${neighbourOwner.accountId}`, 5)
    const owner = await newOwner()
    await setCounter(`media-usage:${owner.accountId}`, 10000)
    await setCounter(`total-media:${owner.accountId}`, 4)
    const key = nextKey()
    const media = await seedMedia(owner.actorId, {
      original: `medias/${key}.webp`,
      originalBytes: 1000,
      originalMetaData: JSON.stringify({
        width: 640,
        height: 480,
        upload: { state: 'verified', clientPath: `medias/${key}-client.jpg` }
      }),
      thumbnail: `medias/${key}-thumb.jpg`,
      thumbnailBytes: 200
    })
    const neighbour = await seedMedia(owner.actorId)
    const editOriginal = await addEditFile(
      media,
      owner.actorId,
      'original',
      300,
      { upload: { clientPath: `edits/${key}-client.jpg` } }
    )
    // A render's metadata naming an upload key: only the original slot's
    // presigned key is a file of its own, so this one is not returned.
    const editRender = await addEditFile(
      media,
      owner.actorId,
      'superseded',
      400,
      { upload: { clientPath: `edits/${key}-render-client.jpg` } }
    )
    const neighbourEdit = await addEditFile(
      neighbour,
      owner.actorId,
      'original',
      500
    )
    const sharedAlbum = await addAlbum(owner.actorId, media)
    const neighbourAlbum = await addAlbum(owner.actorId, neighbour)
    await addAlbumItem(sharedAlbum, media, owner.actorId)
    await addAlbumItem(sharedAlbum, neighbour, owner.actorId)
    await addAlbumItem(neighbourAlbum, neighbour, owner.actorId)
    return {
      owner,
      neighbourOwner,
      media,
      neighbour,
      neighbourEdit,
      sharedAlbum,
      neighbourAlbum,
      files: [
        `medias/${key}.webp`,
        `medias/${key}-client.jpg`,
        `medias/${key}-thumb.jpg`,
        editOriginal,
        `edits/${key}-client.jpg`,
        editRender
      ]
    }
  }

  const albumState = async (albumIds: string[]) => ({
    covers: (
      await db
        .selectFrom('gallery_albums')
        .select(['id', 'coverMediaId'])
        .where('id', 'in', albumIds)
        .orderBy('id')
        .execute()
    ).map((album) => [album.id, album.coverMediaId]),
    items: (
      await db
        .selectFrom('gallery_album_items')
        .select(['albumId', 'mediaId'])
        .where('albumId', 'in', albumIds)
        .orderBy('albumId')
        .orderBy('mediaId')
        .execute()
    ).map((item) => [item.albumId, item.mediaId])
  })

  const expectDeleted = async (
    seeded: Awaited<ReturnType<typeof seedDeletable>>
  ) => {
    const { owner, neighbourOwner, media, neighbour } = seeded
    expect(await mediaRow(media)).toBeUndefined()
    expect(await mediaRow(neighbour)).toBeDefined()
    expect(
      await db
        .selectFrom('media_edit_files')
        .select('path')
        .where('mediaId', 'in', [media, neighbour])
        .execute()
    ).toEqual([{ path: seeded.neighbourEdit }])
    expect(
      await albumState([seeded.sharedAlbum, seeded.neighbourAlbum])
    ).toEqual({
      covers: [
        [seeded.sharedAlbum, null],
        [seeded.neighbourAlbum, neighbour]
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      items: [
        [seeded.sharedAlbum, neighbour],
        [seeded.neighbourAlbum, neighbour]
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    })
    // The original, the thumbnail and both edit files: 1000 + 200 + 300 + 400.
    expect(await counterValue(`media-usage:${owner.accountId}`)).toBe(8100)
    expect(await counterValue(`total-media:${owner.accountId}`)).toBe(3)
    expect(await counterValue(`media-usage:${neighbourOwner.accountId}`)).toBe(
      50
    )
    expect(await counterValue(`total-media:${neighbourOwner.accountId}`)).toBe(
      5
    )
  }

  describe('deleteMediaWithFiles and deleteMedia', () => {
    it('deletes the media with its edit files and album rows, frees its bytes and returns its paths', async () => {
      const seeded = await seedDeletable()

      const result = await database.deleteMediaWithFiles({
        mediaId: String(seeded.media)
      })

      expect(result).toEqual({ status: 'deleted', files: expect.any(Array) })
      expect(result.status === 'deleted' && [...result.files].sort()).toEqual(
        [...seeded.files].sort()
      )
      await expectDeleted(seeded)
      expect(
        await database.deleteMediaWithFiles({ mediaId: String(seeded.media) })
      ).toEqual({ status: 'not-found' })
    })

    it('answers whether it deleted the media', async () => {
      const seeded = await seedDeletable()

      expect(
        await database.deleteMedia({ mediaId: String(seeded.media) })
      ).toBeTrue()
      await expectDeleted(seeded)
      expect(
        await database.deleteMedia({ mediaId: String(seeded.media) })
      ).toBeFalse()
    })

    it('deletes a media with no actor without touching any counter', async () => {
      const media = await seedMedia(null)
      const counters = await db
        .selectFrom('counters')
        .selectAll()
        .orderBy('id')
        .execute()

      expect(await database.deleteMedia({ mediaId: String(media) })).toBeTrue()
      expect(await mediaRow(media)).toBeUndefined()
      expect(
        await db.selectFrom('counters').selectAll().orderBy('id').execute()
      ).toEqual(counters)
    })

    it('takes the owner album lock, then the media row lock, then clears the album rows', async () => {
      const seeded = await seedDeletable()

      const { statements } = await captureStatements(() =>
        database.deleteMedia({ mediaId: String(seeded.media) })
      )

      const locks = statements
        .map((statement) => statement.sql)
        .filter((text) => / for update$/.test(text))
      if (isPostgres()) {
        expect(locks).toEqual([
          expect.stringMatching(/^select "id" from "actors" where "id" = \$1/),
          expect.stringMatching(/^select .* from "medias" where "id" = \$1/)
        ])
      } else {
        expect(locks).toEqual([])
      }
      // Both locks come before the album rows are touched, and the `medias`
      // row goes last.
      expect(lockOrderSteps(statements)).toEqual(LOCK_ORDER)
    })

    it('answers not-found when another delete removed the media after its first read', async () => {
      const seeded = await seedDeletable()
      await database.deleteMedia({ mediaId: String(seeded.media) })
      const before = await dumpTables()
      // The first read still sees the row the other delete removed.
      const stale = withStaleFirstRead(db, 'medias', () => [
        { id: seeded.media, actorId: seeded.owner.actorId }
      ])

      expect(
        await deleteMediaWithFiles(stale, { mediaId: String(seeded.media) })
      ).toEqual({ status: 'not-found' })
      expect(await dumpTables()).toEqual(before)
    })

    it('keeps everything when its last write fails', async () => {
      const seeded = await seedDeletable()
      const drop = await failWrite(
        'counters',
        ['insert', 'update'],
        `new.id = 'total-media:${seeded.owner.accountId}'`
      )

      await expectRolledBack(drop, () =>
        database.deleteMediaWithFiles({ mediaId: String(seeded.media) })
      )
    })
  })

  describe('deleteMediaForAccount', () => {
    it('deletes the account media with its edit files and album rows and returns its paths', async () => {
      const seeded = await seedDeletable()

      const result = await database.deleteMediaForAccount({
        mediaId: String(seeded.media),
        accountId: seeded.owner.accountId
      })

      expect(result.status === 'deleted' && [...result.files].sort()).toEqual(
        [...seeded.files].sort()
      )
      await expectDeleted(seeded)
    })

    it('answers not-found for another account and leaves everything', async () => {
      const seeded = await seedDeletable()
      const before = await dumpTables()

      expect(
        await database.deleteMediaForAccount({
          mediaId: String(seeded.media),
          accountId: seeded.neighbourOwner.accountId
        })
      ).toEqual({ status: 'not-found' })
      expect(await dumpTables()).toEqual(before)
    })

    it('refuses a media a status uses, but not because of another media attachment', async () => {
      const seeded = await seedDeletable()
      const statusId = `${seeded.owner.actorId}/statuses/${nextKey()}`
      await addAttachment({
        actorId: seeded.owner.actorId,
        statusId,
        mediaId: seeded.neighbour
      })

      const before = await dumpTables()
      const used = await addAttachment({
        actorId: seeded.owner.actorId,
        statusId,
        mediaId: seeded.media
      })
      expect(
        await database.deleteMediaForAccount({
          mediaId: String(seeded.media),
          accountId: seeded.owner.accountId
        })
      ).toEqual({ status: 'in-use' })

      await db.deleteFrom('attachments').where('id', '=', used).execute()
      expect(await dumpTables()).toEqual(before)
      expect(
        await database.deleteMediaForAccount({
          mediaId: String(seeded.media),
          accountId: seeded.owner.accountId
        })
      ).toMatchObject({ status: 'deleted' })
      await expectDeleted(seeded)
    })

    it('takes the owner album lock, then the media row lock, then clears the album rows', async () => {
      const seeded = await seedDeletable()

      const { statements } = await captureStatements(() =>
        database.deleteMediaForAccount({
          mediaId: String(seeded.media),
          accountId: seeded.owner.accountId
        })
      )

      const locks = statements
        .map((statement) => statement.sql)
        .filter((text) => / for update$/.test(text))
      expect(locks).toEqual(
        isPostgres()
          ? [
              expect.stringMatching(
                /^select "id" from "actors" where "id" = \$1/
              ),
              expect.stringMatching(/^select .* from "medias" where "id" = \$1/)
            ]
          : []
      )
      // Both locks come before the album rows are touched, and the `medias`
      // row goes last.
      expect(lockOrderSteps(statements)).toEqual(LOCK_ORDER)
    })

    it('answers not-found when another delete removed the media after its first read', async () => {
      const seeded = await seedDeletable()
      await database.deleteMedia({ mediaId: String(seeded.media) })
      const before = await dumpTables()
      // The first read still sees the row the other delete removed.
      const stale = withStaleFirstRead(db, 'medias', () => [
        { id: seeded.media, actorId: seeded.owner.actorId }
      ])

      expect(
        await deleteMediaForAccount(stale, {
          mediaId: String(seeded.media),
          accountId: seeded.owner.accountId
        })
      ).toEqual({ status: 'not-found' })
      expect(await dumpTables()).toEqual(before)
    })

    it('keeps everything when its last write fails', async () => {
      const seeded = await seedDeletable()
      const drop = await failWrite(
        'counters',
        ['insert', 'update'],
        `new.id = 'total-media:${seeded.owner.accountId}'`
      )

      await expectRolledBack(drop, () =>
        database.deleteMediaForAccount({
          mediaId: String(seeded.media),
          accountId: seeded.owner.accountId
        })
      )
    })
  })

  // better-sqlite3 enforces foreign keys, so the edit files and album items
  // would cascade with the media row; a SQLite database may run without them,
  // where only the delete's own statements remove them. (PostgreSQL always
  // cascades, so there this repeats the tests above.)
  describe('where nothing cascades', () => {
    beforeAll(async () => {
      if (!isPostgres()) await sql`PRAGMA foreign_keys = OFF`.execute(db)
    })

    afterAll(async () => {
      if (!isPostgres()) await sql`PRAGMA foreign_keys = ON`.execute(db)
    })

    it('deleteMediaWithFiles removes the edit files and album rows itself', async () => {
      const seeded = await seedDeletable()

      expect(
        await database.deleteMediaWithFiles({ mediaId: String(seeded.media) })
      ).toMatchObject({ status: 'deleted' })
      await expectDeleted(seeded)
    })

    it('deleteMediaForAccount removes the edit files and album rows itself', async () => {
      const seeded = await seedDeletable()

      expect(
        await database.deleteMediaForAccount({
          mediaId: String(seeded.media),
          accountId: seeded.owner.accountId
        })
      ).toMatchObject({ status: 'deleted' })
      await expectDeleted(seeded)
    })
  })
})

describe('setMediaSubjectLookup', () => {
  const subject = {
    subjectName: 'Grey heron',
    subjectScientificName: 'Ardea cinerea',
    subjectTaxonKey: '2481139',
    subjectCategory: 'bird'
  }

  const lookupState = async (id: number) => {
    const row = await mediaRow(id)
    return {
      subjectLookupStatus: row?.subjectLookupStatus,
      subjectIucnCategory: row?.subjectIucnCategory
    }
  }

  it('writes only the named media while the subject is the one it read', async () => {
    const owner = await newOwner()
    // The same subject on another media: an update without the id would
    // write it too.
    const neighbour = await seedMedia(owner.actorId, subject)
    const media = await seedMedia(owner.actorId, subject)
    const write = (expect: Record<string, string | null | undefined>) =>
      database.setMediaSubjectLookup({
        mediaId: String(media),
        expect: {
          subjectName: subject.subjectName,
          subjectScientificName: subject.subjectScientificName,
          subjectTaxonKey: subject.subjectTaxonKey,
          ...expect
        } as Parameters<typeof database.setMediaSubjectLookup>[0]['expect'],
        patch: { subjectLookupStatus: 'resolved', subjectIucnCategory: 'LC' }
      })

    for (const stale of [
      { subjectName: 'Little egret' },
      { subjectName: null },
      { subjectScientificName: 'Egretta garzetta' },
      { subjectTaxonKey: '1' },
      { subjectCategory: 'plant' },
      { subjectCategory: null }
    ]) {
      expect(await write(stale)).toBeFalse()
      expect(await lookupState(media)).toEqual({
        subjectLookupStatus: null,
        subjectIucnCategory: null
      })
    }

    expect(await write({ subjectCategory: 'bird' })).toBeTrue()
    expect(await lookupState(media)).toEqual({
      subjectLookupStatus: 'resolved',
      subjectIucnCategory: 'LC'
    })
    expect(await lookupState(neighbour)).toEqual({
      subjectLookupStatus: null,
      subjectIucnCategory: null
    })
  })

  it('writes the resolved taxon key trimmed and its path, and a blank key as none', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, {
      ...subject,
      subjectTaxonKey: null
    })
    const resolve = (subjectTaxonKey: string | null) =>
      database.setMediaSubjectLookup({
        mediaId: String(media),
        expect: {
          subjectName: subject.subjectName,
          subjectScientificName: subject.subjectScientificName,
          subjectTaxonKey: null
        },
        patch: {
          subjectLookupStatus: 'resolved',
          subjectLookupAt: 5000,
          subjectTaxonKey,
          subjectTaxonPath: ['Animalia', 'Chordata', 'Aves']
        }
      })

    expect(await resolve(' 2481139 ')).toBeTrue()
    const row = await mediaRow(media)
    expect(row).toMatchObject({
      subjectTaxonKey: '2481139',
      subjectLookupAt: 5000
    })
    // A JSON text column.
    expect(JSON.parse(String(row?.subjectTaxonPath))).toEqual([
      'Animalia',
      'Chordata',
      'Aves'
    ])

    await db
      .updateTable('medias')
      .set({ subjectTaxonKey: null })
      .where('id', '=', media)
      .execute()
    expect(await resolve('  ')).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({ subjectTaxonKey: null })
  })

  it('keeps the stored taxon key, path and IUCN category when the patch omits them', async () => {
    const owner = await newOwner()
    const taxonPath = JSON.stringify(['Animalia', 'Chordata', 'Aves'])
    const media = await seedMedia(owner.actorId, {
      ...subject,
      subjectIucnCategory: 'LC',
      subjectTaxonPath: taxonPath
    })
    const write = (
      patch: Parameters<typeof database.setMediaSubjectLookup>[0]['patch']
    ) =>
      database.setMediaSubjectLookup({
        mediaId: String(media),
        expect: {
          subjectName: subject.subjectName,
          subjectScientificName: subject.subjectScientificName,
          subjectTaxonKey: subject.subjectTaxonKey
        },
        patch
      })

    // A lookup that found nothing new writes its status and time alone.
    expect(await write({ subjectLookupStatus: null })).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      subjectLookupStatus: null,
      subjectTaxonKey: subject.subjectTaxonKey,
      subjectTaxonPath: taxonPath,
      subjectIucnCategory: 'LC'
    })

    // A null key or path clears it, and leaves the other columns alone.
    expect(
      await write({
        subjectLookupStatus: 'no-match',
        subjectTaxonKey: null,
        subjectTaxonPath: null
      })
    ).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      subjectLookupStatus: 'no-match',
      subjectTaxonKey: null,
      subjectTaxonPath: null,
      subjectIucnCategory: 'LC'
    })
  })

  it('refuses an unknown status or IUCN category without writing', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, subject)
    const expectSubject = {
      subjectName: subject.subjectName,
      subjectScientificName: subject.subjectScientificName,
      subjectTaxonKey: subject.subjectTaxonKey
    }

    await expect(
      database.setMediaSubjectLookup({
        mediaId: String(media),
        expect: expectSubject,
        patch: {
          subjectLookupStatus: 'done' as unknown as 'resolved'
        }
      })
    ).rejects.toThrow('Unknown subject lookup status: done')
    await expect(
      database.setMediaSubjectLookup({
        mediaId: String(media),
        expect: expectSubject,
        patch: {
          subjectLookupStatus: 'resolved',
          subjectIucnCategory: 'XX' as unknown as 'LC'
        }
      })
    ).rejects.toThrow('Unknown IUCN category: XX')
    expect(await lookupState(media)).toEqual({
      subjectLookupStatus: null,
      subjectIucnCategory: null
    })
  })

  it('compares a null expectation as IS NULL', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, { subjectName: 'Fern' })

    expect(
      await database.setMediaSubjectLookup({
        mediaId: String(media),
        expect: {
          subjectName: 'Fern',
          subjectScientificName: null,
          subjectTaxonKey: null,
          subjectCategory: null
        },
        patch: { subjectLookupStatus: 'no-match' }
      })
    ).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      subjectLookupStatus: 'no-match'
    })
  })
})

describe('setMediaPlaceLookup', () => {
  const point = { placeLatitude: 52.37, placeLongitude: 4.89 }

  it('refuses an unknown status without writing', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, point)

    await expect(
      database.setMediaPlaceLookup({
        mediaId: String(media),
        expect: point,
        patch: { placeLookupStatus: 'done' as unknown as 'resolved' }
      })
    ).rejects.toThrow('Unknown place lookup status: done')
    expect(await mediaRow(media)).toMatchObject({
      placeLookupStatus: null,
      placeLookupAt: null
    })
  })

  it('writes only the named media while the point is the one it read', async () => {
    const owner = await newOwner()
    // The same point and no name on another media: neither update may reach it.
    const neighbour = await seedMedia(owner.actorId, point)
    const media = await seedMedia(owner.actorId, point)
    const write = (expect: {
      placeLatitude: number | null
      placeLongitude: number | null
    }) =>
      database.setMediaPlaceLookup({
        mediaId: String(media),
        expect,
        patch: {
          placeLookupStatus: 'resolved',
          placeCountryCode: 'nl',
          placeName: 'Amsterdam'
        }
      })

    expect(await write({ ...point, placeLatitude: 1 })).toBeFalse()
    expect(await write({ ...point, placeLongitude: 1 })).toBeFalse()
    expect(await write({ ...point, placeLatitude: null })).toBeFalse()
    expect(await mediaRow(media)).toMatchObject({
      placeLookupStatus: null,
      placeName: null
    })

    expect(await write(point)).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      placeLookupStatus: 'resolved',
      placeCountryCode: 'NL',
      placeName: 'Amsterdam',
      placeNameSource: 'geocoder'
    })
    expect(await mediaRow(neighbour)).toMatchObject({
      placeLookupStatus: null,
      placeCountryCode: null,
      placeName: null,
      placeNameSource: null
    })
  })

  it('keeps the stored country code and geocoded name when the patch omits them', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, {
      ...point,
      placeCountryCode: 'NL',
      placeName: 'Amsterdam',
      placeNameSource: 'geocoder'
    })
    const write = (
      patch: Parameters<typeof database.setMediaPlaceLookup>[0]['patch']
    ) =>
      database.setMediaPlaceLookup({
        mediaId: String(media),
        expect: point,
        patch
      })

    expect(await write({ placeLookupStatus: null })).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      placeLookupStatus: null,
      placeCountryCode: 'NL',
      placeName: 'Amsterdam',
      placeNameSource: 'geocoder'
    })

    // A null code clears it, and still leaves the name alone.
    expect(
      await write({ placeLookupStatus: 'no-match', placeCountryCode: null })
    ).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      placeLookupStatus: 'no-match',
      placeCountryCode: null,
      placeName: 'Amsterdam',
      placeNameSource: 'geocoder'
    })
  })

  it('replaces a geocoded name but never the owner name', async () => {
    const owner = await newOwner()
    const geocoded = await seedMedia(owner.actorId, {
      ...point,
      placeName: 'Old',
      placeNameSource: 'geocoder'
    })
    const named = await seedMedia(owner.actorId, {
      ...point,
      placeName: 'Home',
      placeNameSource: 'owner'
    })
    const write = (id: number) =>
      database.setMediaPlaceLookup({
        mediaId: String(id),
        expect: point,
        patch: { placeLookupStatus: 'resolved', placeName: 'Amsterdam' }
      })

    expect(await write(geocoded)).toBeTrue()
    expect(await write(named)).toBeTrue()
    expect(await mediaRow(geocoded)).toMatchObject({
      placeName: 'Amsterdam',
      placeNameSource: 'geocoder'
    })
    expect(await mediaRow(named)).toMatchObject({
      placeLookupStatus: 'resolved',
      placeName: 'Home',
      placeNameSource: 'owner'
    })
  })

  it('trims the geocoded name and caps it at 255 characters, and a blank one is no name', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, point)
    const write = (placeName: string) =>
      database.setMediaPlaceLookup({
        mediaId: String(media),
        expect: point,
        patch: { placeLookupStatus: 'resolved', placeName }
      })

    expect(await write(`  ${'a'.repeat(300)}  `)).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      placeName: 'a'.repeat(255),
      placeNameSource: 'geocoder'
    })

    expect(await write('   ')).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      placeName: null,
      placeNameSource: null
    })
  })

  it('compares a null point as IS NULL', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId)

    expect(
      await database.setMediaPlaceLookup({
        mediaId: String(media),
        expect: { placeLatitude: null, placeLongitude: null },
        patch: { placeLookupStatus: null }
      })
    ).toBeTrue()
  })

  it('keeps the status when its last write fails', async () => {
    const owner = await newOwner()
    const media = await seedMedia(owner.actorId, point)
    const drop = await failWrite(
      'medias',
      ['update'],
      `new."placeName" = 'Doomed'`
    )

    await expectRolledBack(drop, () =>
      database.setMediaPlaceLookup({
        mediaId: String(media),
        expect: point,
        patch: { placeLookupStatus: 'resolved', placeName: 'Doomed' }
      })
    )
  })
})

describe('setMediaSubjectSuggestions', () => {
  it('writes and clears only the named media', async () => {
    const owner = await newOwner()
    const neighbour = await seedMedia(owner.actorId)
    const media = await seedMedia(owner.actorId)
    const suggestions = {
      model: 'test',
      generatedAt: '2026-01-01T00:00:00.000Z',
      checkedAgainst: null,
      candidates: [],
      group: null
    }

    expect(
      await database.setMediaSubjectSuggestions({
        mediaId: String(media),
        suggestions
      })
    ).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({
      subjectSuggestions: JSON.stringify(suggestions)
    })
    expect(await mediaRow(neighbour)).toMatchObject({
      subjectSuggestions: null
    })

    expect(
      await database.setMediaSubjectSuggestions({
        mediaId: String(media),
        suggestions: null
      })
    ).toBeTrue()
    expect(await mediaRow(media)).toMatchObject({ subjectSuggestions: null })

    // No such media: nothing written.
    expect(
      await database.setMediaSubjectSuggestions({
        mediaId: String(media + 1000),
        suggestions
      })
    ).toBeFalse()
  })
})

describe('the gallery album lock', () => {
  it('locks the actor row on PostgreSQL only', async () => {
    const owner = await newOwner()

    const { statements } = await captureStatements(() =>
      lockGalleryAlbumActor(db, owner.actorId)
    )

    expect(statements.map((statement) => statement.sql)).toEqual([
      isPostgres()
        ? 'select "id" from "actors" where "id" = $1 for update'
        : 'select "id" from "actors" where "id" = ?'
    ])
  })

  // The album writes take the lock inside their own Kysely transaction: it has
  // to run on that transaction's connection, before anything else they do.
  it.each([
    'createGalleryAlbumWithinLimit',
    'updateGalleryAlbum',
    'deleteGalleryAlbum',
    'addGalleryAlbumItems',
    'removeGalleryAlbumItems'
  ] as const)(
    '%s takes it first, inside its own transaction',
    async (method) => {
      const owner = await newOwner()
      const media = await seedMedia(owner.actorId, { inGallery: true })
      const albumId = await addAlbum(owner.actorId, null)
      await addAlbumItem(albumId, media, owner.actorId)
      const calls: Record<typeof method, () => Promise<unknown>> = {
        createGalleryAlbumWithinLimit: () =>
          database.createGalleryAlbumWithinLimit({
            actorId: owner.actorId,
            title: 'New album',
            limit: 10
          }),
        updateGalleryAlbum: () =>
          database.updateGalleryAlbum({
            id: albumId,
            actorId: owner.actorId,
            title: 'Renamed'
          }),
        deleteGalleryAlbum: () =>
          database.deleteGalleryAlbum({ id: albumId, actorId: owner.actorId }),
        addGalleryAlbumItems: () =>
          database.addGalleryAlbumItems({
            albumId,
            actorId: owner.actorId,
            mediaIds: [String(media)],
            limit: 10
          }),
        removeGalleryAlbumItems: () =>
          database.removeGalleryAlbumItems({
            albumId,
            actorId: owner.actorId,
            mediaIds: [String(media)]
          })
      }

      const { statements } = await captureStatements(calls[method])

      // One transaction, and nothing runs outside it (a second connection
      // would read or write without the lock).
      const texts = statements.map((statement) => statement.sql)
      expect(texts[0]).toBe('begin')
      expect(texts.at(-1)).toBe('commit')
      expect(
        texts.filter((text) => /^(begin|commit|rollback)\b/i.test(text))
      ).toHaveLength(2)
      expect(statements.every((statement) => statement.connection)).toBeTrue()
      expect(
        new Set(statements.map((statement) => statement.connection)).size
      ).toBe(1)
      const inTransaction = texts.slice(1, -1)
      expect(inTransaction.length).toBeGreaterThan(1)
      expect(inTransaction[0]).toBe(
        isPostgres()
          ? 'select "id" from "actors" where "id" = $1 for update'
          : 'select "id" from "actors" where "id" = ?'
      )
    }
  )
})
