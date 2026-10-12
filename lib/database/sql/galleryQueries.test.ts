import { type Insertable, sql } from 'kysely'

import {
  pruneGalleryLookups,
  putGalleryLookup
} from '@/lib/database/domains/gallery/lookupCache'
import type { GalleryMediaRow } from '@/lib/database/domains/gallery/types'
import type { Db } from '@/lib/database/kysely'
import type {
  Attachments,
  GalleryGears,
  Medias
} from '@/lib/database/kysely/db'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const DOMAIN = 'galleryq.test'

// Every `where`, `orderBy`, `limit` and cursor of the gallery queries
// (lib/database/domains/gallery), each pinned with a neighbouring row the
// query must not touch (another actor's, a deleted, retired, hidden, unposted
// or out-of-range one), plus the transactions of createGalleryGearWithinLimit,
// deleteGalleryGear, updateGallerySettings and addMediaToGallery running on one
// connection and rolling back as a whole when their last write fails. Orders
// are pinned with rows the database would not return in that order unaided:
// ids that sort against insertion and creation time, and ties inserted in id
// order in one group and in reverse in another. Which media each audience may
// see at all is galleryMediaEquivalence.test.ts's job; here the owner and the
// logged-out audience pin the queries around the scope. Runs on PostgreSQL in
// CI.

const testDb = createTestDatabase()
const { database, knex } = testDb
const db = () => testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await testDb.destroy()
})

const at = (iso: string) => new Date(`${iso}T08:00:00.000Z`)

let actorCount = 0
const newActor = async () => {
  actorCount += 1
  const username = `galleryq${actorCount}`
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
const publicNote = (actorId: string) => note(actorId, [ACTIVITY_STREAM_PUBLIC])
const followersNote = (actorId: string) =>
  note(actorId, [`${actorId}/followers`])

// Each test takes its own block of media ids, so it can insert them out of
// order; `createdAt` follows the insertion order.
let mediaBlock = 0
const mediaIds = () => {
  mediaBlock += 100
  const base = mediaBlock
  return (n: number) => base + n
}
let clock = 0
const seedMedia = async (
  id: number,
  actorId: string,
  values: Partial<Insertable<Medias>> = {}
) => {
  clock += 1000
  await db()
    .insertInto('medias')
    .values({
      id,
      actorId,
      original: `medias/${id}.jpg`,
      originalBytes: 1000,
      originalMimeType: 'image/jpeg',
      originalMetaData: JSON.stringify({ width: 640, height: 480 }),
      // The column defaults to false; most media here are in the gallery.
      inGallery: true,
      createdAt: new Date(clock),
      updatedAt: new Date(clock),
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
  const id = values.id ?? `attachment-${attachmentCount}`
  await db()
    .insertInto('attachments')
    .values({
      actorId,
      statusId,
      type: 'Document',
      mediaType: 'image/jpeg',
      url: `https://${DOMAIN}/files/${id}.jpg`,
      width: 640,
      height: 480,
      name: '',
      mediaId,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
      ...values,
      id
    })
    .execute()
  return id
}

let gearCount = 0
const nextGearId = () => {
  gearCount += 1
  return `gear-${String(gearCount).padStart(4, '0')}`
}
const seedGear = async (
  actorId: string,
  values: Partial<Insertable<GalleryGears>> = {}
) => {
  const id = values.id ?? nextGearId()
  await db()
    .insertInto('gallery_gears')
    .values({
      kind: 'camera',
      name: id,
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}

const gearRow = (id: string) =>
  db()
    .selectFrom('gallery_gears')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const mediaRow = (id: number) =>
  db()
    .selectFrom('medias')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const TABLES = {
  gallery_gears: 'id',
  gallery_settings: 'actorId',
  gallery_lookup_cache: 'key',
  medias: 'id',
  attachments: 'id'
} as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  for (const [table, column] of Object.entries(TABLES)) {
    dump[table] = await db()
      .selectFrom(table as keyof typeof TABLES)
      .selectAll()
      .orderBy(column)
      .execute()
  }
  return dump
}

// Makes the next write on `table` matching `condition` (SQL over `new` or
// `old`, valid on both backends) fail. Returns the function that removes the
// trigger again.
let triggerCount = 0
const failWrite = async (
  table: keyof typeof TABLES,
  event: 'insert' | 'update',
  condition: string
) => {
  triggerCount += 1
  const name = `gallery_queries_fail_${triggerCount}`
  if (testDb.backend === 'pg') {
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
// table the gallery writes is exactly as it was.
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

// Every statement of `action` ran between one `begin` and its `commit`, on
// that transaction's connection; returns them without the two.
const expectOneTransaction = async (action: () => Promise<unknown>) => {
  const { statements } = await captureStatements(action)
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
  return texts.slice(1, -1)
}

// `db` with `interleave` run once, right after the first query through it has
// finished: the gap between a method's read and its write, which a concurrent
// request lands in and a single-process test cannot reach any other way.
const interleaveAfterFirstQuery = (
  inner: Db,
  interleave: () => Promise<void>
): Db => {
  let done = false
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property, object)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const result = value.apply(object, args)
          if (result instanceof Promise) {
            return result.then(async (rows) => {
              if (!done) {
                done = true
                await interleave()
              }
              return rows
            })
          }
          return typeof result === 'object' && result !== null
            ? wrap(result)
            : result
        }
      }
    })
  return wrap(inner)
}

const isPostgres = () => testDb.backend === 'pg'

describe('gear reads', () => {
  it('getGalleryGearsByActor lists the actor’s live gear by createdAt, then id', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const prefix = nextGearId()
    const gear = (n: number) => `${prefix}-${n}`
    // The later-created gear has the lower id.
    await seedGear(actorId, { id: gear(1), createdAt: at('2026-01-03') })
    await seedGear(actorId, { id: gear(2), createdAt: at('2026-01-02') })
    // Tied, inserted in id order.
    await seedGear(actorId, { id: gear(3), createdAt: at('2026-01-04') })
    await seedGear(actorId, { id: gear(4), createdAt: at('2026-01-04') })
    // Tied, inserted in reverse id order.
    await seedGear(actorId, { id: gear(6), createdAt: at('2026-01-05') })
    await seedGear(actorId, { id: gear(5), createdAt: at('2026-01-05') })
    // Deleted, and another actor's, both earliest.
    await seedGear(actorId, {
      id: gear(7),
      createdAt: at('2026-01-01'),
      deletedAt: at('2026-01-06')
    })
    await seedGear(otherActorId, { id: gear(8), createdAt: at('2026-01-01') })

    const gears = await database.getGalleryGearsByActor({ actorId })

    expect(gears.map((item) => item.id)).toEqual([2, 1, 3, 4, 5, 6].map(gear))
  })

  it('getGalleryGear reads only the actor’s own live gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId, { name: 'Mine', brand: 'Canon' })
    await seedGear(actorId, { name: 'Neighbour' })
    const deletedId = await seedGear(actorId, { deletedAt: at('2026-01-02') })

    expect(await database.getGalleryGear({ id: gearId, actorId })).toEqual({
      id: gearId,
      actorId,
      kind: 'camera',
      name: 'Mine',
      brand: 'Canon',
      model: undefined,
      productUrl: undefined,
      deviceKey: undefined,
      retiredAt: undefined,
      createdAt: at('2026-01-01').getTime(),
      updatedAt: at('2026-01-01').getTime(),
      deletedAt: undefined
    })
    expect(
      await database.getGalleryGear({ id: gearId, actorId: otherActorId })
    ).toBeNull()
    expect(await database.getGalleryGear({ id: deletedId, actorId })).toBeNull()
  })

  it('findGalleryGearByDeviceKey matches the actor and key of live gear only', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const mine = await seedGear(actorId, { deviceKey: 'canon:r5' })
    await seedGear(actorId, { deviceKey: 'canon:r6' })
    const theirs = await seedGear(otherActorId, { deviceKey: 'canon:r5' })
    await seedGear(actorId, {
      deviceKey: 'canon:r7',
      deletedAt: at('2026-01-02')
    })

    const find = (actor: string, deviceKey: string) =>
      database
        .findGalleryGearByDeviceKey({ actorId: actor, deviceKey })
        .then((gear) => gear?.id ?? null)

    expect(await find(actorId, 'canon:r5')).toBe(mine)
    expect(await find(otherActorId, 'canon:r5')).toBe(theirs)
    expect(await find(actorId, 'canon:r7')).toBeNull()
    expect(await find(actorId, 'canon:r8')).toBeNull()
  })

  it('getGalleryGearNamesByIds names the requested live gear only', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const first = await seedGear(actorId, { name: 'First' })
    const theirs = await seedGear(otherActorId, { name: 'Theirs' })
    await seedGear(actorId, { name: 'Not asked for' })
    const deleted = await seedGear(actorId, {
      name: 'Deleted',
      deletedAt: at('2026-01-02')
    })

    expect(
      await database.getGalleryGearNamesByIds({
        ids: [first, theirs, deleted, 'missing', first]
      })
    ).toEqual({ [first]: 'First', [theirs]: 'Theirs' })
    expect(await database.getGalleryGearNamesByIds({ ids: [] })).toEqual({})
  })

  it('reads an epoch-0 retiredAt as not retired', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId, { retiredAt: new Date(0) })

    const gear = await database.getGalleryGear({ id: gearId, actorId })
    expect(gear?.retiredAt).toBeUndefined()
  })
})

describe('createGalleryGearWithinLimit', () => {
  const create = (
    actorId: string,
    name: string,
    {
      limit = 10,
      dedupeByName = true,
      deviceKey
    }: { limit?: number; dedupeByName?: boolean; deviceKey?: string } = {}
  ) =>
    database.createGalleryGearWithinLimit({
      actorId,
      kind: 'camera',
      name,
      deviceKey,
      limit,
      dedupeByName
    })

  it('returns the earliest matching gear, by createdAt then id', async () => {
    const actorId = await newActor()
    const prefix = nextGearId()
    const gear = (n: number) => `${prefix}-${n}`
    // The later-created match has the lower id.
    await seedGear(actorId, {
      id: gear(1),
      name: 'Canon R5',
      createdAt: at('2026-01-03')
    })
    await seedGear(actorId, {
      id: gear(2),
      name: 'canon  r5',
      createdAt: at('2026-01-02')
    })
    // Tied matches, in id order and in reverse.
    await seedGear(actorId, {
      id: gear(3),
      name: 'Fuji X',
      createdAt: at('2026-01-04')
    })
    await seedGear(actorId, {
      id: gear(4),
      name: 'Fuji X',
      createdAt: at('2026-01-04')
    })
    await seedGear(actorId, {
      id: gear(6),
      name: 'Nikon Z',
      createdAt: at('2026-01-05')
    })
    await seedGear(actorId, {
      id: gear(5),
      name: 'Nikon Z',
      createdAt: at('2026-01-05')
    })

    const found = async (name: string) => {
      const result = await create(actorId, name)
      return result.status === 'existing' ? result.gear.id : result.status
    }
    expect(await found('CANON R5')).toBe(gear(2))
    expect(await found('Fuji X')).toBe(gear(3))
    expect(await found('Nikon Z')).toBe(gear(5))
  })

  it('counts and matches only the actor’s own live gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    await seedGear(actorId, { name: 'Kept' })
    // A deleted gear of the same name, and another actor's.
    await seedGear(actorId, {
      name: 'Old',
      deviceKey: 'old:key',
      deletedAt: at('2026-01-02')
    })
    await seedGear(otherActorId, { name: 'Theirs', deviceKey: 'their:key' })
    await seedGear(otherActorId, { name: 'Theirs too' })

    const old = await create(actorId, 'Old', { limit: 2 })
    expect(old.status).toBe('created')
    const theirs = await create(actorId, 'Theirs', {
      limit: 3,
      deviceKey: 'their:key'
    })
    expect(theirs.status).toBe('created')
    // Three of the actor's own now.
    expect((await create(actorId, 'Fourth', { limit: 3 })).status).toBe(
      'limit-reached'
    )
    expect((await create(actorId, 'Fourth', { limit: 4 })).status).toBe(
      'created'
    )
    // Sorted by name: gear created in the same millisecond ties on createdAt
    // and then orders by its random id. The order itself is pinned above.
    expect(
      (await database.getGalleryGearsByActor({ actorId }))
        .map((gear) => gear.name)
        .sort()
    ).toEqual(['Fourth', 'Kept', 'Old', 'Theirs'])
  })

  it('matches a device key without dedupeByName, and a name only with it', async () => {
    const actorId = await newActor()
    const keyed = await seedGear(actorId, {
      name: 'Keyed',
      deviceKey: 'sony:a7'
    })

    const byKey = await create(actorId, 'Another name', {
      dedupeByName: false,
      deviceKey: 'sony:a7'
    })
    expect(byKey).toEqual({
      status: 'existing',
      gear: expect.objectContaining({ id: keyed })
    })
    expect(
      (await create(actorId, 'Keyed', { dedupeByName: false })).status
    ).toBe('created')
  })

  it('matches a name only on gear of the same kind', async () => {
    const actorId = await newActor()
    await seedGear(actorId, { kind: 'lens', name: 'Shared name' })

    const camera = await create(actorId, 'Shared name')
    expect(camera).toEqual({
      status: 'created',
      gear: expect.objectContaining({ kind: 'camera', name: 'Shared name' })
    })
  })

  it('locks the actor row first, inside its own transaction', async () => {
    const actorId = await newActor()

    const statements = await expectOneTransaction(() =>
      create(actorId, 'Locked')
    )
    expect(statements[0]).toBe(
      isPostgres()
        ? 'select "id" from "actors" where "id" = $1 for update'
        : 'select "id" from "actors" where "id" = ?'
    )
    expect(statements).toHaveLength(3)
    expect(statements[2]).toMatch(/^insert into "gallery_gears"/)
  })

  it('rolls back as a whole when the insert fails', async () => {
    const actorId = await newActor()
    await seedGear(actorId, { name: 'Kept' })

    const drop = await failWrite(
      'gallery_gears',
      'insert',
      `new."name" = 'Doomed'`
    )
    await expectRolledBack(drop, () => create(actorId, 'Doomed'))
  })
})

describe('gear writes', () => {
  it('updateGalleryGear changes only the actor’s own live gear, and only the given fields', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId, {
      name: 'Before',
      brand: 'Brand',
      model: 'Model',
      productUrl: 'https://shop.test/before'
    })
    const neighbour = await seedGear(actorId, { name: 'Neighbour' })
    const deletedId = await seedGear(actorId, {
      name: 'Deleted',
      deletedAt: at('2026-01-02')
    })

    const updated = await database.updateGalleryGear({
      id: gearId,
      actorId,
      name: 'After',
      brand: null
    })
    expect(updated).toEqual(
      expect.objectContaining({
        id: gearId,
        name: 'After',
        brand: undefined,
        model: 'Model',
        productUrl: 'https://shop.test/before'
      })
    )
    expect((await gearRow(neighbour)).name).toBe('Neighbour')

    expect(
      await database.updateGalleryGear({
        id: gearId,
        actorId: otherActorId,
        name: 'Stolen'
      })
    ).toBeNull()
    expect(
      await database.updateGalleryGear({
        id: deletedId,
        actorId,
        name: 'Revived'
      })
    ).toBeNull()
    expect((await gearRow(gearId)).name).toBe('After')
    expect(await gearRow(deletedId)).toEqual(
      expect.objectContaining({ name: 'Deleted' })
    )
    expect(
      await database.getGalleryGearsByActor({ actorId: otherActorId })
    ).toEqual([])
  })

  it('setGalleryGearRetired moves only between the two states, on the actor’s own live gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const active = await seedGear(actorId)
    const retired = await seedGear(actorId, {
      retiredAt: at('2026-01-05'),
      updatedAt: at('2026-01-05')
    })
    const deleted = await seedGear(actorId, { deletedAt: at('2026-01-02') })
    const neighbour = await seedGear(actorId)
    const unchanged = async (id: string) => {
      const before = await gearRow(id)
      return async () => expect(await gearRow(id)).toEqual(before)
    }

    // Re-retiring keeps the date the owner put it away on.
    const retiredStays = await unchanged(retired)
    expect(
      await database.setGalleryGearRetired({
        id: retired,
        actorId,
        retired: true
      })
    ).toEqual(
      expect.objectContaining({ retiredAt: at('2026-01-05').getTime() })
    )
    await retiredStays()

    // Un-retiring active gear changes nothing either.
    const activeStays = await unchanged(active)
    expect(
      await database.setGalleryGearRetired({
        id: active,
        actorId,
        retired: false
      })
    ).toEqual(expect.objectContaining({ id: active, retiredAt: undefined }))
    await activeStays()

    // Another actor's call, and a deleted gear, change nothing.
    expect(
      await database.setGalleryGearRetired({
        id: active,
        actorId: otherActorId,
        retired: true
      })
    ).toBeNull()
    await activeStays()
    const deletedStays = await unchanged(deleted)
    expect(
      await database.setGalleryGearRetired({
        id: deleted,
        actorId,
        retired: true
      })
    ).toBeNull()
    await deletedStays()

    const neighbourStays = await unchanged(neighbour)
    const now = Date.now()
    const nowRetired = await database.setGalleryGearRetired({
      id: active,
      actorId,
      retired: true
    })
    expect(nowRetired?.retiredAt).toBeGreaterThanOrEqual(now)
    const nowActive = await database.setGalleryGearRetired({
      id: retired,
      actorId,
      retired: false
    })
    expect(nowActive?.retiredAt).toBeUndefined()
    expect(nowActive?.updatedAt).toBeGreaterThanOrEqual(now)
    await neighbourStays()
  })
})

describe('deleteGalleryGear', () => {
  const seed = async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const ids = mediaIds()
    const gearId = await seedGear(actorId, { deviceKey: 'canon:r5' })
    const otherGear = await seedGear(actorId)
    const camera = await seedMedia(ids(1), actorId, {
      cameraGearId: gearId,
      lensGearId: otherGear
    })
    const lens = await seedMedia(ids(2), actorId, {
      cameraGearId: otherGear,
      lensGearId: gearId
    })
    // Another actor's media pointing at the gear keeps its reference.
    const theirs = await seedMedia(ids(3), otherActorId, {
      cameraGearId: gearId,
      lensGearId: gearId
    })
    return { actorId, otherActorId, gearId, otherGear, camera, lens, theirs }
  }

  it('soft-deletes the gear, frees its device key and clears the actor’s own media references', async () => {
    const { actorId, gearId, otherGear, camera, lens, theirs } = await seed()

    expect(await database.deleteGalleryGear({ id: gearId, actorId })).toBeTrue()

    const row = await gearRow(gearId)
    expect(row.deletedAt).not.toBeNull()
    expect(row.deviceKey).toBeNull()
    expect((await gearRow(otherGear)).deletedAt).toBeNull()
    expect(await mediaRow(camera)).toEqual(
      expect.objectContaining({ cameraGearId: null, lensGearId: otherGear })
    )
    expect(await mediaRow(lens)).toEqual(
      expect.objectContaining({ cameraGearId: otherGear, lensGearId: null })
    )
    expect(await mediaRow(theirs)).toEqual(
      expect.objectContaining({ cameraGearId: gearId, lensGearId: gearId })
    )
  })

  it('changes nothing for a deleted gear or another actor’s', async () => {
    const { actorId, otherActorId, gearId } = await seed()
    // The other actor's own media holding a stale reference to the gear.
    const stale = await seedMedia(mediaIds()(1), otherActorId, {
      cameraGearId: gearId
    })
    const before = await dumpTables()

    expect(
      await database.deleteGalleryGear({ id: gearId, actorId: otherActorId })
    ).toBeFalse()
    expect(await dumpTables()).toEqual(before)
    expect((await mediaRow(stale)).cameraGearId).toBe(gearId)

    expect(await database.deleteGalleryGear({ id: gearId, actorId })).toBeTrue()
    const deleted = await dumpTables()
    expect(
      await database.deleteGalleryGear({ id: gearId, actorId })
    ).toBeFalse()
    expect(await dumpTables()).toEqual(deleted)
  })

  it('runs inside one transaction', async () => {
    const { actorId, gearId } = await seed()

    const statements = await expectOneTransaction(() =>
      database.deleteGalleryGear({ id: gearId, actorId })
    )
    expect(statements).toHaveLength(3)
  })

  it('rolls back as a whole when the last write fails', async () => {
    const { actorId, gearId } = await seed()

    const drop = await failWrite(
      'medias',
      'update',
      `old."lensGearId" = '${gearId}' and new."lensGearId" is null`
    )
    await expectRolledBack(drop, () =>
      database.deleteGalleryGear({ id: gearId, actorId })
    )
  })
})

describe('gallery settings', () => {
  it('reads the actor’s own row, and the defaults without one', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    await database.updateGallerySettings({
      actorId: otherActorId,
      mapPublic: false
    })

    expect(await database.getGallerySettings({ actorId })).toEqual(
      expect.objectContaining({ mapPublic: true })
    )
    expect(
      await database.getGallerySettings({ actorId: otherActorId })
    ).toEqual(expect.objectContaining({ mapPublic: false }))
  })

  it('updateGallerySettings writes only the given fields of the actor’s own row', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    await database.updateGallerySettings({
      actorId: otherActorId,
      showGear: true,
      photoEnhance: true
    })
    const theirs = await db()
      .selectFrom('gallery_settings')
      .selectAll()
      .where('actorId', '=', otherActorId)
      .executeTakeFirstOrThrow()

    await database.updateGallerySettings({ actorId, showGear: false })
    const settings = await database.updateGallerySettings({
      actorId,
      photoEnhance: false,
      showGear: undefined,
      hiddenLocations: [
        { latitude: 13.75, longitude: 100.5, hideRadiusMeters: 1000 }
      ]
    })

    expect(settings).toEqual(
      expect.objectContaining({
        showGear: false,
        photoEnhance: false,
        mapPublic: true,
        hiddenLocations: [
          { latitude: 13.75, longitude: 100.5, hideRadiusMeters: 1000 }
        ]
      })
    )
    expect(
      await db()
        .selectFrom('gallery_settings')
        .selectAll()
        .where('actorId', '=', otherActorId)
        .executeTakeFirstOrThrow()
    ).toEqual(theirs)
  })

  it('runs inside one transaction', async () => {
    const actorId = await newActor()

    const statements = await expectOneTransaction(() =>
      database.updateGallerySettings({ actorId, mapPublic: false })
    )
    expect(statements).toHaveLength(3)
  })

  it('rolls back the first save as a whole when the update fails', async () => {
    const actorId = await newActor()

    const drop = await failWrite(
      'gallery_settings',
      'update',
      `new."actorId" = '${actorId}'`
    )
    await expectRolledBack(drop, () =>
      database.updateGallerySettings({ actorId, mapPublic: false })
    )
  })
})

describe('gallery media reads', () => {
  const ids = mediaIds()
  let owner: string
  let other: string
  let gearId: string
  const attachments: Record<string, string> = {}
  // The media, by what they are; the numbers are their ids within the block.
  const POSTED = ids(5)
  const HIDDEN = ids(2)
  const ADDED = ids(7)
  const ADDED_HIDDEN = ids(1)
  const UNPOSTED = ids(6)
  const POSTED_AND_ADDED = ids(3)
  const FOLLOWERS_ONLY = ids(4)
  const OTHERS = ids(8)

  beforeAll(async () => {
    owner = await newActor()
    other = await newActor()
    gearId = await seedGear(owner)
    const otherGear = await seedGear(owner)
    const publicPost = await publicNote(owner)
    const secondPublicPost = await publicNote(owner)
    const followersPost = await followersNote(owner)
    const othersPost = await publicNote(other)

    // Inserted out of id order.
    await seedMedia(POSTED, owner, {
      cameraGearId: gearId,
      placeLatitude: 13.75,
      placeLongitude: 100.5,
      placePrecision: 'exact'
    })
    attachments.postedOld = await seedAttachment(POSTED, publicPost, owner, {
      createdAt: new Date(2000)
    })
    attachments.postedPublic = await seedAttachment(
      POSTED,
      secondPublicPost,
      owner,
      { createdAt: new Date(3000) }
    )
    attachments.postedFollowers = await seedAttachment(
      POSTED,
      followersPost,
      owner,
      { createdAt: new Date(5000) }
    )
    // Newer still, but another actor's attachment, and the owner's on another
    // actor's post: never the one the media is shown through.
    await seedAttachment(POSTED, othersPost, other, {
      createdAt: new Date(9000)
    })
    await seedAttachment(POSTED, othersPost, owner, {
      createdAt: new Date(8000)
    })
    await seedMedia(HIDDEN, owner, { inGallery: false })
    attachments.hidden = await seedAttachment(HIDDEN, publicPost, owner)
    await seedMedia(ADDED, owner, { galleryAddedAt: at('2026-01-02') })
    await seedMedia(ADDED_HIDDEN, owner, {
      inGallery: false,
      galleryAddedAt: at('2026-01-02')
    })
    await seedMedia(UNPOSTED, owner)
    await seedMedia(POSTED_AND_ADDED, owner, {
      lensGearId: gearId,
      galleryAddedAt: at('2026-01-02')
    })
    attachments.postedAndAdded = await seedAttachment(
      POSTED_AND_ADDED,
      secondPublicPost,
      owner
    )
    await seedMedia(FOLLOWERS_ONLY, owner, { cameraGearId: otherGear })
    attachments.followersOnly = await seedAttachment(
      FOLLOWERS_ONLY,
      followersPost,
      owner
    )
    await seedMedia(OTHERS, other, { cameraGearId: gearId })
    await seedAttachment(OTHERS, othersPost, other)
  })

  const shown = (rows: GalleryMediaRow[]) =>
    rows.map((row) => [Number(row.media.id), row.attachment?.id ?? null])

  const OWNER_VIEW = {
    in_gallery: [ADDED, POSTED, FOLLOWERS_ONLY, POSTED_AND_ADDED],
    hidden: [HIDDEN, ADDED_HIDDEN],
    all: [
      ADDED,
      POSTED,
      FOLLOWERS_ONLY,
      POSTED_AND_ADDED,
      HIDDEN,
      ADDED_HIDDEN
    ],
    not_posted: [ADDED, ADDED_HIDDEN]
  } as const

  it.each(Object.entries(OWNER_VIEW))(
    'getGalleryMedia lists the owner’s %s media, newest first',
    async (show, expected) => {
      const rows = await database.getGalleryMedia({
        actorId: owner,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 20,
        show: show as keyof typeof OWNER_VIEW
      })
      expect(rows.map((row) => Number(row.media.id))).toEqual(expected)
    }
  )

  it('getGalleryMedia shows each media through its newest readable attachment', async () => {
    expect(
      shown(
        await database.getGalleryMedia({
          actorId: owner,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 20
        })
      )
    ).toEqual([
      [ADDED, null],
      [POSTED, attachments.postedFollowers],
      [FOLLOWERS_ONLY, attachments.followersOnly],
      [POSTED_AND_ADDED, attachments.postedAndAdded]
    ])
    // Logged out, `show` is not read.
    for (const show of [undefined, 'all', 'hidden', 'not_posted'] as const) {
      expect(
        shown(
          await database.getGalleryMedia({
            actorId: owner,
            audience: PUBLIC_GALLERY_AUDIENCE,
            limit: 20,
            show
          })
        )
      ).toEqual([
        [POSTED, attachments.postedPublic],
        [POSTED_AND_ADDED, attachments.postedAndAdded]
      ])
    }
  })

  it('getGalleryMedia breaks a tie between attachments by the highest id', async () => {
    const actorId = await newActor()
    const post = await publicNote(actorId)
    const secondPost = await publicNote(actorId)
    const tied = mediaIds()(1)
    await seedMedia(tied, actorId)
    // The same createdAt, the higher id inserted first.
    const higher = await seedAttachment(tied, post, actorId, {
      id: `${actorId}/attachments/b`,
      createdAt: new Date(4000)
    })
    await seedAttachment(tied, secondPost, actorId, {
      id: `${actorId}/attachments/a`,
      createdAt: new Date(4000)
    })

    for (const audience of [OWNER_GALLERY_AUDIENCE, PUBLIC_GALLERY_AUDIENCE]) {
      expect(
        shown(await database.getGalleryMedia({ actorId, audience, limit: 20 }))
      ).toEqual([[tied, higher]])
    }
  })

  it('getGalleryMedia pages by limit and an exclusive max id', async () => {
    const page = (limit: number, maxId?: string) =>
      database
        .getGalleryMedia({
          actorId: owner,
          audience: OWNER_GALLERY_AUDIENCE,
          limit,
          maxId
        })
        .then((rows) => rows.map((row) => Number(row.media.id)))

    expect(await page(2)).toEqual([ADDED, POSTED])
    expect(await page(2, String(POSTED))).toEqual([
      FOLLOWERS_ONLY,
      POSTED_AND_ADDED
    ])
    expect(await page(20, String(FOLLOWERS_ONLY))).toEqual([POSTED_AND_ADDED])
    expect(await page(0)).toEqual([])
    expect(await page(20, 'not-an-id')).toEqual([])
    expect(
      await database
        .getGalleryMedia({
          actorId: owner,
          audience: PUBLIC_GALLERY_AUDIENCE,
          limit: 1
        })
        .then((rows) => rows.map((row) => Number(row.media.id)))
    ).toEqual([POSTED])
  })

  it('getGalleryMedia narrows to a gear as the camera or the lens', async () => {
    const rows = await database.getGalleryMedia({
      actorId: owner,
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 20,
      gearId
    })
    expect(rows.map((row) => Number(row.media.id))).toEqual([
      POSTED,
      POSTED_AND_ADDED
    ])
  })

  it('getGalleryMediaByIds re-applies the scope and sorts newest first', async () => {
    const requested = [
      POSTED_AND_ADDED,
      ADDED_HIDDEN,
      POSTED,
      UNPOSTED,
      OTHERS,
      FOLLOWERS_ONLY
    ].map(String)
    const byIds = (audience: typeof OWNER_GALLERY_AUDIENCE, show?: 'all') =>
      database
        .getGalleryMediaByIds({
          actorId: owner,
          audience,
          mediaIds: [...requested, 'not-an-id', String(POSTED)],
          show
        })
        .then(shown)

    expect(await byIds(OWNER_GALLERY_AUDIENCE)).toEqual([
      [POSTED, attachments.postedFollowers],
      [FOLLOWERS_ONLY, attachments.followersOnly],
      [POSTED_AND_ADDED, attachments.postedAndAdded]
    ])
    expect(await byIds(OWNER_GALLERY_AUDIENCE, 'all')).toEqual([
      [POSTED, attachments.postedFollowers],
      [FOLLOWERS_ONLY, attachments.followersOnly],
      [POSTED_AND_ADDED, attachments.postedAndAdded],
      [ADDED_HIDDEN, null]
    ])
    expect(await byIds(PUBLIC_GALLERY_AUDIENCE)).toEqual([
      [POSTED, attachments.postedPublic],
      [POSTED_AND_ADDED, attachments.postedAndAdded]
    ])
    expect(
      await database.getGalleryMediaByIds({
        actorId: owner,
        audience: OWNER_GALLERY_AUDIENCE,
        mediaIds: []
      })
    ).toEqual([])
  })

  it.each(Object.entries(OWNER_VIEW))(
    'getGalleryMediaIndex lists the owner’s %s media, newest first',
    async (show, expected) => {
      const rows = await database.getGalleryMediaIndex({
        actorId: owner,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 20,
        show: show as keyof typeof OWNER_VIEW
      })
      expect(rows.map((row) => Number(row.id))).toEqual(expected)
    }
  )

  it('getGalleryMediaIndex pages by limit and an exclusive max id, for each audience', async () => {
    const index = (
      audience: typeof OWNER_GALLERY_AUDIENCE,
      limit: number,
      maxId?: string
    ) =>
      database
        .getGalleryMediaIndex({ actorId: owner, audience, limit, maxId })
        .then((rows) => rows.map((row) => Number(row.id)))

    expect(await index(OWNER_GALLERY_AUDIENCE, 2)).toEqual([ADDED, POSTED])
    expect(await index(OWNER_GALLERY_AUDIENCE, 2, String(POSTED))).toEqual([
      FOLLOWERS_ONLY,
      POSTED_AND_ADDED
    ])
    expect(await index(OWNER_GALLERY_AUDIENCE, 0)).toEqual([])
    expect(await index(OWNER_GALLERY_AUDIENCE, 20, '-1')).toEqual([])
    expect(await index(PUBLIC_GALLERY_AUDIENCE, 20)).toEqual([
      POSTED,
      POSTED_AND_ADDED
    ])
    expect(await index(PUBLIC_GALLERY_AUDIENCE, 1)).toEqual([POSTED])
    expect(
      (
        await database.getGalleryMediaIndex({
          actorId: owner,
          audience: OWNER_GALLERY_AUDIENCE,
          limit: 1,
          maxId: String(ADDED)
        })
      )[0]
    ).toEqual(
      expect.objectContaining({
        id: String(POSTED),
        placeLatitude: 13.75,
        placeLongitude: 100.5,
        placePrecision: 'exact'
      })
    )
  })

  it('getActorHasGalleryMedia answers for the scope of the audience', async () => {
    const unposted = await newActor()
    await seedMedia(mediaIds()(1), unposted)
    const followersOnly = await newActor()
    const media = await seedMedia(mediaIds()(1), followersOnly)
    await seedAttachment(
      media,
      await followersNote(followersOnly),
      followersOnly
    )

    const has = (actorId: string, audience: typeof OWNER_GALLERY_AUDIENCE) =>
      database.getActorHasGalleryMedia({ actorId, audience })

    expect(await has(owner, OWNER_GALLERY_AUDIENCE)).toBeTrue()
    expect(await has(owner, PUBLIC_GALLERY_AUDIENCE)).toBeTrue()
    expect(await has(unposted, OWNER_GALLERY_AUDIENCE)).toBeFalse()
    expect(await has(followersOnly, OWNER_GALLERY_AUDIENCE)).toBeTrue()
    expect(await has(followersOnly, PUBLIC_GALLERY_AUDIENCE)).toBeFalse()
  })
})

describe('getGalleryMapRows', () => {
  const ids = mediaIds()
  let owner: string
  let post: string
  const ROWS = {
    exact: ids(4),
    latitudeOnly: ids(7),
    longitudeOnly: ids(8),
    country: ids(5),
    area: ids(1),
    addedHidden: ids(6),
    unplaced: ids(3),
    // Placed, but outside the gallery scope; their ids sort first.
    postedHidden: ids(9),
    othersPosted: ids(10),
    unposted: ids(2)
  }

  beforeAll(async () => {
    owner = await newActor()
    post = await publicNote(owner)
    const place = (
      latitude: number | null,
      longitude: number | null,
      placePrecision: string
    ) => ({
      placeLatitude: latitude,
      placeLongitude: longitude,
      placePrecision
    })
    const posted = async (id: number, values: Partial<Insertable<Medias>>) => {
      await seedMedia(id, owner, values)
      await seedAttachment(id, post, owner, {
        thumbnailUrl: `https://${DOMAIN}/thumbnails/${id}.jpg`
      })
    }
    await posted(ROWS.exact, place(13.75, 100.5, 'exact'))
    await posted(ROWS.latitudeOnly, place(13.75, null, 'exact'))
    await posted(ROWS.longitudeOnly, place(null, 100.5, 'exact'))
    await posted(ROWS.country, place(13.75, 100.5, 'country'))
    await posted(ROWS.area, place(13.75, 100.5, 'area'))
    await seedMedia(ROWS.addedHidden, owner, {
      ...place(13.75, 100.5, 'hidden'),
      galleryAddedAt: at('2026-01-02')
    })
    await posted(ROWS.unplaced, place(null, null, 'exact'))
    // Switched off in the gallery, though its post is public.
    await posted(ROWS.postedHidden, {
      ...place(13.75, 100.5, 'exact'),
      inGallery: false
    })
    const other = await newActor()
    await seedMedia(ROWS.othersPosted, other, place(13.75, 100.5, 'exact'))
    await seedAttachment(ROWS.othersPosted, await publicNote(other), other)
    await seedMedia(ROWS.unposted, owner, place(13.75, 100.5, 'exact'))
  })

  const map = (audience: typeof OWNER_GALLERY_AUDIENCE, limit: number) =>
    database
      .getGalleryMapRows({ actorId: owner, audience, limit })
      .then((rows) => rows.map((row) => Number(row.id)))

  it('reads placed media only, newest first, and only public precisions for a viewer', async () => {
    expect(await map(OWNER_GALLERY_AUDIENCE, 20)).toEqual([
      ROWS.addedHidden,
      ROWS.country,
      ROWS.exact,
      ROWS.area
    ])
    expect(await map(PUBLIC_GALLERY_AUDIENCE, 20)).toEqual([
      ROWS.exact,
      ROWS.area
    ])
  })

  it('applies the limit after the place conditions', async () => {
    expect(await map(OWNER_GALLERY_AUDIENCE, 2)).toEqual([
      ROWS.addedHidden,
      ROWS.country
    ])
    expect(await map(PUBLIC_GALLERY_AUDIENCE, 1)).toEqual([ROWS.exact])
    expect(await map(OWNER_GALLERY_AUDIENCE, 0)).toEqual([])
  })

  it('shows each point through its attachment', async () => {
    const [addedHidden, country] = await database.getGalleryMapRows({
      actorId: owner,
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 2
    })
    expect(addedHidden).toEqual(
      expect.objectContaining({
        thumbnailUrl: null,
        statusId: null,
        placePrecision: 'hidden'
      })
    )
    expect(country).toEqual(
      expect.objectContaining({
        thumbnailUrl: `https://${DOMAIN}/thumbnails/${ROWS.country}.jpg`,
        statusId: post,
        latitude: 13.75,
        longitude: 100.5,
        placePrecision: 'country'
      })
    )
  })
})

describe('getGalleryGearUsageRows', () => {
  it('counts every in-scope photo of the requested gear, whatever its gallery switch', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    const first = await seedGear(owner)
    const second = await seedGear(owner)
    const unrequested = await seedGear(owner)
    const post = await publicNote(owner)
    const posted = async (id: number, values: Partial<Insertable<Medias>>) => {
      await seedMedia(id, owner, values)
      await seedAttachment(id, post, owner)
    }

    // The lens is not requested: only the camera row comes back.
    await posted(ids(2), {
      cameraGearId: first,
      lensGearId: unrequested,
      takenAt: at('2026-01-02')
    })
    await posted(ids(4), {
      cameraGearId: second,
      lensGearId: first,
      inGallery: false
    })
    // Not posted and not added: not the owner's gallery.
    await seedMedia(ids(5), owner, { cameraGearId: first })
    // Added in Gallery and hidden.
    await seedMedia(ids(1), owner, {
      cameraGearId: first,
      inGallery: false,
      galleryAddedAt: at('2026-01-02')
    })
    await posted(ids(6), { cameraGearId: unrequested })
    await posted(ids(3), { cameraGearId: first, lensGearId: first })
    await seedMedia(ids(7), other, { cameraGearId: first })
    await seedAttachment(ids(7), await publicNote(other), other)

    const rows = await database.getGalleryGearUsageRows({
      actorId: owner,
      gearIds: [first, second, '', first]
    })

    expect(
      rows.map((row) => [row.gearId, Number(row.mediaId), row.inGallery])
    ).toEqual([
      [second, ids(4), false],
      [first, ids(4), false],
      [first, ids(3), true],
      [first, ids(2), true],
      [first, ids(1), false]
    ])
    expect(rows.find((row) => Number(row.mediaId) === ids(2))?.takenAt).toBe(
      at('2026-01-02').getTime()
    )
    expect(
      await database.getGalleryGearUsageRows({ actorId: owner, gearIds: [''] })
    ).toEqual([])
  })
})

describe('unposted media', () => {
  const seed = async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    const free = await seedMedia(ids(2), owner, { inGallery: false })
    const secondFree = await seedMedia(ids(5), owner, { inGallery: false })
    const alreadyAdded = await seedMedia(ids(3), owner, {
      inGallery: false,
      galleryAddedAt: at('2026-01-02')
    })
    // An attachment with no status still uses the media, as does another
    // actor's.
    const attached = await seedMedia(ids(1), owner, { inGallery: false })
    await seedAttachment(attached, null, owner)
    const attachedByOther = await seedMedia(ids(6), owner, {
      inGallery: false
    })
    await seedAttachment(attachedByOther, `${other}/statuses/x`, other)
    const othersFree = await seedMedia(ids(4), other, { inGallery: false })
    const notRequested = await seedMedia(ids(7), owner, { inGallery: false })
    const requested = [
      free,
      alreadyAdded,
      secondFree,
      attached,
      attachedByOther,
      othersFree
    ].map(String)
    return {
      owner,
      free,
      secondFree,
      alreadyAdded,
      notRequested,
      requested: [...requested, 'not-an-id', String(free)],
      unavailable: [attached, attachedByOther, othersFree].map(String)
    }
  }

  it('getUnattachedMedia reads the requested media of the actor no attachment uses, newest first', async () => {
    const { owner, free, secondFree, alreadyAdded, requested } = await seed()

    const media = await database.getUnattachedMedia({
      actorId: owner,
      mediaIds: requested
    })
    expect(media.map((item) => Number(item.id))).toEqual([
      secondFree,
      alreadyAdded,
      free
    ])
    expect(
      await database.getUnattachedMedia({ actorId: owner, mediaIds: [] })
    ).toEqual([])
  })

  it('addMediaToGallery adds them once, keeping a hidden one hidden', async () => {
    const { owner, free, secondFree, alreadyAdded, notRequested, requested } =
      await seed()
    const before = await dumpTables()
    const startedAt = Date.now()

    const added = await database.addMediaToGallery({
      actorId: owner,
      mediaIds: requested
    })
    expect(added).toEqual([secondFree, alreadyAdded, free].map(String))

    const after = await dumpTables()
    const changed = (after.medias as { id: number }[]).filter(
      (row, index) =>
        JSON.stringify(row) !== JSON.stringify(before.medias[index])
    )
    expect(changed.map((row) => Number(row.id)).sort()).toEqual(
      [free, secondFree].sort()
    )
    for (const id of [free, secondFree]) {
      const row = await mediaRow(id)
      expect(row.inGallery).toBeTrue()
      expect(row.galleryAddedAt).toBeGreaterThanOrEqual(startedAt)
    }
    const kept = await mediaRow(alreadyAdded)
    expect(kept.inGallery).toBeFalse()
    expect(kept.galleryAddedAt).toBe(at('2026-01-02').getTime())
    expect((await mediaRow(notRequested)).galleryAddedAt).toBeNull()

    // A repeat changes nothing.
    const repeated = await dumpTables()
    await database.addMediaToGallery({ actorId: owner, mediaIds: requested })
    expect(await dumpTables()).toEqual(repeated)
    expect(
      await database.addMediaToGallery({ actorId: owner, mediaIds: [] })
    ).toEqual([])
  })

  it('addMediaToGallery reads and writes inside one transaction', async () => {
    const { owner, requested } = await seed()

    const statements = await expectOneTransaction(() =>
      database.addMediaToGallery({ actorId: owner, mediaIds: requested })
    )
    expect(statements).toHaveLength(2)
  })

  it('addMediaToGallery writes nothing when every requested media is used or another actor’s', async () => {
    const { owner, unavailable } = await seed()
    const before = await dumpTables()

    const statements = await expectOneTransaction(async () =>
      expect(
        await database.addMediaToGallery({
          actorId: owner,
          mediaIds: unavailable
        })
      ).toEqual([])
    )
    expect(statements).toHaveLength(1)
    expect(await dumpTables()).toEqual(before)
  })

  it('addMediaToGallery rolls back as a whole when its write fails', async () => {
    const { owner, free, requested } = await seed()

    const drop = await failWrite('medias', 'update', `old."id" = ${free}`)
    await expectRolledBack(drop, () =>
      database.addMediaToGallery({ actorId: owner, mediaIds: requested })
    )
  })
})

// The scope's posted check is SQL, so a Gallery-added media whose only
// attachment is on a public post but does not parse (not a `Document`, or no
// media type) passes it for every audience, and the attachment pick then has
// nothing to show it through. Only the owner sees such a media, bare; another
// audience's read drops it rather than showing a photo with no post.
describe('media whose only attachment does not parse', () => {
  const ids = mediaIds()
  const GOOD = ids(1)
  const NOT_A_DOCUMENT = ids(2)
  const NO_MEDIA_TYPE = ids(3)
  const NEWEST_GOOD = ids(4)
  let owner: string

  beforeAll(async () => {
    owner = await newActor()
    const post = await publicNote(owner)
    const place = {
      placeLatitude: 13.75,
      placeLongitude: 100.5,
      placePrecision: 'exact'
    }
    await seedMedia(GOOD, owner, place)
    await seedAttachment(GOOD, post, owner)
    await seedMedia(NOT_A_DOCUMENT, owner, {
      ...place,
      galleryAddedAt: at('2026-01-02')
    })
    await seedAttachment(NOT_A_DOCUMENT, post, owner, { type: 'Image' })
    await seedMedia(NO_MEDIA_TYPE, owner, {
      ...place,
      galleryAddedAt: at('2026-01-02')
    })
    await seedAttachment(NO_MEDIA_TYPE, post, owner, { mediaType: null })
    await seedMedia(NEWEST_GOOD, owner, place)
    await seedAttachment(NEWEST_GOOD, post, owner)
  })

  const requested = () =>
    [GOOD, NOT_A_DOCUMENT, NO_MEDIA_TYPE, NEWEST_GOOD].map(String)

  const shown = (rows: GalleryMediaRow[]) =>
    rows.map((row) => [Number(row.media.id), row.attachment === null])

  it('are left out of the media reads for another audience', async () => {
    const audience = PUBLIC_GALLERY_AUDIENCE

    expect(
      shown(
        await database.getGalleryMedia({ actorId: owner, audience, limit: 20 })
      )
    ).toEqual([
      [NEWEST_GOOD, false],
      [GOOD, false]
    ])
    expect(
      shown(
        await database.getGalleryMediaByIds({
          actorId: owner,
          audience,
          mediaIds: requested()
        })
      )
    ).toEqual([
      [NEWEST_GOOD, false],
      [GOOD, false]
    ])
  })

  it('are left out of the map for another audience', async () => {
    const points = await database.getGalleryMapRows({
      actorId: owner,
      audience: PUBLIC_GALLERY_AUDIENCE,
      limit: 20
    })

    expect(points.map((point) => Number(point.id))).toEqual([NEWEST_GOOD, GOOD])
  })

  it('are shown bare to the owner', async () => {
    const audience = OWNER_GALLERY_AUDIENCE
    const expected = [
      [NEWEST_GOOD, false],
      [NO_MEDIA_TYPE, true],
      [NOT_A_DOCUMENT, true],
      [GOOD, false]
    ]

    expect(
      shown(
        await database.getGalleryMedia({ actorId: owner, audience, limit: 20 })
      )
    ).toEqual(expected)
    expect(
      shown(
        await database.getGalleryMediaByIds({
          actorId: owner,
          audience,
          mediaIds: requested()
        })
      )
    ).toEqual(expected)
    const points = await database.getGalleryMapRows({
      actorId: owner,
      audience,
      limit: 20
    })
    expect(
      points.map((point) => [Number(point.id), point.statusId === null])
    ).toEqual(expected)
  })
})

describe('gallery lookup cache', () => {
  const NOW = at('2026-03-01').getTime()
  const HOUR = 60 * 60 * 1000
  let kindCount = 0
  const newKind = () => {
    kindCount += 1
    return `kind-${kindCount}`
  }
  const put = (
    kind: string,
    key: string,
    expiresAt: number,
    value: unknown = { key }
  ) =>
    database.putGalleryLookup({
      kind,
      key,
      outcome: 'ok',
      value,
      ttlMs: expiresAt - (NOW - HOUR),
      now: NOW - HOUR
    })
  const keysOf = async (kind: string) =>
    (
      await db()
        .selectFrom('gallery_lookup_cache')
        .select('key')
        .where('kind', '=', kind)
        .orderBy('key')
        .execute()
    ).map((row) => row.key)

  it('getGalleryLookup reads the entry of the kind and key, until it expires', async () => {
    const kind = newKind()
    const otherKind = newKind()
    await put(kind, 'key-1', NOW + HOUR, 'one')
    await put(kind, 'key-2', NOW + HOUR, 'two')
    await put(otherKind, 'key-3', NOW + HOUR, 'three')
    await put(kind, 'expired', NOW, 'gone')

    const get = (lookupKind: string, key: string) =>
      database
        .getGalleryLookup({ kind: lookupKind, key, now: NOW })
        .then((entry) => entry?.value ?? null)

    expect(await get(kind, 'key-1')).toBe('one')
    expect(await get(kind, 'key-2')).toBe('two')
    expect(await get(kind, 'key-3')).toBeNull()
    expect(await get(otherKind, 'key-1')).toBeNull()
    expect(await get(kind, 'expired')).toBeNull()
  })

  it('putGalleryLookup replaces every column of an existing entry', async () => {
    const kind = newKind()
    await database.putGalleryLookup({
      kind,
      key: 'key',
      outcome: 'ok',
      value: { first: true },
      ttlMs: HOUR,
      now: NOW
    })
    await database.putGalleryLookup({
      kind,
      key: 'key',
      outcome: 'miss',
      value: null,
      ttlMs: 2 * HOUR,
      now: NOW + HOUR
    })

    expect(
      await database.getGalleryLookup({ kind, key: 'key', now: NOW })
    ).toEqual({
      kind,
      key: 'key',
      outcome: 'miss',
      value: null,
      fetchedAt: NOW + HOUR,
      expiresAt: NOW + 3 * HOUR
    })
  })

  it('pruneGalleryLookups deletes the oldest expired entries up to the limit', async () => {
    const kind = newKind()
    // Expiry order runs against key order and insertion order.
    await put(kind, 'a-newest-expired', NOW - 1)
    await put(kind, 'b-oldest', NOW - 3 * HOUR)
    await put(kind, 'c-middle', NOW - 2 * HOUR)
    // Expiring exactly at `before`, and later: kept.
    await put(kind, 'd-at-before', NOW)
    await put(kind, 'e-live', NOW + HOUR)

    expect(await database.pruneGalleryLookups({ before: NOW, limit: 2 })).toBe(
      2
    )
    expect(await keysOf(kind)).toEqual([
      'a-newest-expired',
      'd-at-before',
      'e-live'
    ])
    expect(await database.pruneGalleryLookups({ before: NOW, limit: 0 })).toBe(
      0
    )
    expect(await database.pruneGalleryLookups({ before: NOW, limit: 10 })).toBe(
      1
    )
    expect(await keysOf(kind)).toEqual(['d-at-before', 'e-live'])
  })

  it('pruneGalleryLookups keeps an entry refreshed after it was picked', async () => {
    const kind = newKind()
    await put(kind, 'refreshed', NOW - 2 * HOUR)
    await put(kind, 'stale', NOW - HOUR)

    const pruning = interleaveAfterFirstQuery(db(), async () => {
      await putGalleryLookup(db(), {
        kind,
        key: 'refreshed',
        outcome: 'ok',
        value: 'fresh',
        ttlMs: HOUR,
        now: NOW
      })
    })
    // Both were picked; only the one still expired is deleted.
    expect(
      await pruneGalleryLookups(pruning, { before: NOW, limit: 100 })
    ).toBe(1)
    expect(await keysOf(kind)).toEqual(['refreshed'])
  })
})

describe('getGalleryAlbumItemSets', () => {
  it('reads the actor’s own album items of the requested media, by album', async () => {
    const owner = await newActor()
    const other = await newActor()
    const ids = mediaIds()
    for (const id of [1, 2, 3, 4]) await seedMedia(ids(id), owner)
    const album = async (actorId: string, id: string, updatedAt: string) => {
      await db()
        .insertInto('gallery_albums')
        .values({
          id,
          actorId,
          title: id,
          createdAt: at('2026-01-01'),
          updatedAt: at(updatedAt)
        })
        .execute()
      return id
    }
    const item = (albumId: string, mediaId: number, actorId: string) =>
      db()
        .insertInto('gallery_album_items')
        .values({ albumId, mediaId, actorId, createdAt: at('2026-01-01') })
        .execute()
    const prefix = `${owner}/albums`
    // The album that sorts last comes first by insertion, by updatedAt and by
    // its lowest media id, so only the album sort puts it last.
    const second = await album(owner, `${prefix}/2`, '2026-01-01')
    const first = await album(owner, `${prefix}/1`, '2026-01-03')
    const theirs = await album(other, `${prefix}/3`, '2026-01-02')
    await item(second, ids(1), owner)
    await item(first, ids(2), owner)
    await item(first, ids(1), owner)
    // Not requested.
    await item(first, ids(4), owner)
    // Another actor's album, and an item row written for another actor.
    await item(theirs, ids(3), owner)
    await item(second, ids(3), other)

    const sets = await database.getGalleryAlbumItemSets({
      actorId: owner,
      mediaIds: [ids(1), ids(2), ids(3), 'not-an-id'].map(String)
    })

    expect(
      sets.map((set) => ({ ...set, mediaIds: [...set.mediaIds].sort() }))
    ).toEqual([
      { albumId: first, mediaIds: [ids(1), ids(2)].map(String).sort() },
      { albumId: second, mediaIds: [String(ids(1))] }
    ])
    expect(
      await database.getGalleryAlbumItemSets({ actorId: owner, mediaIds: [] })
    ).toEqual([])
  })
})

describe('requests that cannot match', () => {
  it('send no statement', async () => {
    const actorId = await newActor()
    const audience = OWNER_GALLERY_AUDIENCE
    const { statements } = await captureStatements(async () => {
      expect(
        await database.getGalleryMedia({ actorId, audience, limit: 0 })
      ).toEqual([])
      expect(
        await database.getGalleryMedia({
          actorId,
          audience,
          limit: 20,
          maxId: 'not-an-id'
        })
      ).toEqual([])
      expect(
        await database.getGalleryMediaIndex({ actorId, audience, limit: 0 })
      ).toEqual([])
      expect(
        await database.getGalleryMediaIndex({
          actorId,
          audience,
          limit: 20,
          maxId: 'not-an-id'
        })
      ).toEqual([])
      expect(
        await database.getGalleryMapRows({ actorId, audience, limit: 0 })
      ).toEqual([])
      expect(
        await database.getGalleryMediaByIds({
          actorId,
          audience,
          mediaIds: ['not-an-id']
        })
      ).toEqual([])
      expect(
        await database.getGalleryGearUsageRows({ actorId, gearIds: [] })
      ).toEqual([])
      expect(await database.getGalleryGearNamesByIds({ ids: [] })).toEqual({})
      expect(
        await database.getUnattachedMedia({ actorId, mediaIds: ['not-an-id'] })
      ).toEqual([])
      expect(
        await database.addMediaToGallery({ actorId, mediaIds: ['not-an-id'] })
      ).toEqual([])
      expect(
        await database.getGalleryAlbumItemSets({ actorId, mediaIds: [] })
      ).toEqual([])
      expect(
        await database.pruneGalleryLookups({ before: Date.now(), limit: 0 })
      ).toBe(0)
    })
    expect(statements).toEqual([])
  })
})

// The key and actor id parameters are typed `string`. These pin what a value
// the types forbid does now that the shared driver binds it: Knex threw on an
// `undefined` binding and compiled a two-argument `where(column, null)` to
// `IS NULL`, and Kysely binds both as NULL, which equals nothing. SQLite is
// the one backend where a NULL key can exist at all: its settings `actorId`
// and gear `id` are primary keys without NOT NULL, which SQLite does not imply
// for them.
describe('undefined and null keys', () => {
  const UNDEFINED = undefined as unknown as string
  const NULL = null as unknown as string

  it('an undefined id, actor id or device key matches nothing', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId, { deviceKey: 'canon:r5' })
    const mediaId = await seedMedia(mediaIds()(1), actorId, {
      galleryAddedAt: at('2026-01-02')
    })
    const audience = OWNER_GALLERY_AUDIENCE
    // The same reads find the media for the actor, so the empty answers below
    // are the undefined parameter's doing.
    expect(
      (await database.getGalleryMedia({ actorId, audience, limit: 20 })).length
    ).toBe(1)
    const before = await dumpTables()

    expect(
      await database.getGalleryGear({ id: gearId, actorId: UNDEFINED })
    ).toBeNull()
    expect(await database.getGalleryGear({ id: UNDEFINED, actorId })).toBeNull()
    expect(
      await database.findGalleryGearByDeviceKey({
        actorId,
        deviceKey: UNDEFINED
      })
    ).toBeNull()
    expect(
      await database.findGalleryGearByDeviceKey({
        actorId: UNDEFINED,
        deviceKey: 'canon:r5'
      })
    ).toBeNull()
    expect(
      await database.updateGalleryGear({
        id: UNDEFINED,
        actorId,
        name: 'Renamed'
      })
    ).toBeNull()
    expect(
      await database.updateGalleryGear({
        id: gearId,
        actorId: UNDEFINED,
        name: 'Renamed'
      })
    ).toBeNull()
    expect(
      await database.setGalleryGearRetired({
        id: UNDEFINED,
        actorId,
        retired: true
      })
    ).toBeNull()
    expect(
      await database.setGalleryGearRetired({
        id: gearId,
        actorId: UNDEFINED,
        retired: true
      })
    ).toBeNull()
    expect(
      await database.deleteGalleryGear({ id: UNDEFINED, actorId })
    ).toBeFalse()
    expect(
      await database.deleteGalleryGear({ id: gearId, actorId: UNDEFINED })
    ).toBeFalse()
    expect(await database.getGallerySettings({ actorId: UNDEFINED })).toEqual(
      DEFAULT_GALLERY_SETTINGS
    )
    expect(
      await database.getGalleryGearsByActor({ actorId: UNDEFINED })
    ).toEqual([])
    expect(
      await database.getActorHasGalleryMedia({ actorId: UNDEFINED, audience })
    ).toBeFalse()
    expect(
      await database.getGalleryMedia({
        actorId: UNDEFINED,
        audience,
        limit: 20
      })
    ).toEqual([])
    expect(
      await database.getGalleryMediaByIds({
        actorId: UNDEFINED,
        audience,
        mediaIds: [String(mediaId)]
      })
    ).toEqual([])
    expect(
      await database.getGalleryMediaIndex({
        actorId: UNDEFINED,
        audience,
        limit: 20
      })
    ).toEqual([])
    expect(
      await database.getGalleryMapRows({
        actorId: UNDEFINED,
        audience,
        limit: 20
      })
    ).toEqual([])
    expect(
      await database.getGalleryGearUsageRows({
        actorId: UNDEFINED,
        gearIds: [gearId]
      })
    ).toEqual([])
    expect(
      await database.getUnattachedMedia({
        actorId: UNDEFINED,
        mediaIds: [String(mediaId)]
      })
    ).toEqual([])
    expect(
      await database.addMediaToGallery({
        actorId: UNDEFINED,
        mediaIds: [String(mediaId)]
      })
    ).toEqual([])
    expect(
      await database.getGalleryAlbumItemSets({
        actorId: UNDEFINED,
        mediaIds: [String(mediaId)]
      })
    ).toEqual([])

    expect(await dumpTables()).toEqual(before)
  })

  it('getGalleryGearNamesByIds leaves an undefined id out', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId, { name: 'Named' })

    expect(
      await database.getGalleryGearNamesByIds({ ids: [gearId, UNDEFINED] })
    ).toEqual({ [gearId]: 'Named' })
    expect(
      await database.getGalleryGearNamesByIds({ ids: [UNDEFINED] })
    ).toEqual({})
  })

  it('createGalleryGearWithinLimit with an undefined actor id runs its reads, then fails on the insert’s NOT NULL actorId', async () => {
    const before = await dumpTables()

    const { statements } = await captureStatements(async () => {
      await expect(
        database.createGalleryGearWithinLimit({
          actorId: UNDEFINED,
          kind: 'camera',
          name: 'Nobody’s',
          limit: 10,
          dedupeByName: true
        })
      ).rejects.toThrow(
        isPostgres()
          ? 'null value in column "actorId"'
          : 'NOT NULL constraint failed: gallery_gears.actorId'
      )
    })

    const texts = statements.map((statement) => statement.sql)
    expect(texts[0]).toBe('begin')
    expect(
      texts.some((text) => /^insert into "gallery_gears"/.test(text))
    ).toBe(true)
    expect(texts.at(-1)).toBe('rollback')
    expect(await dumpTables()).toEqual(before)
  })

  it('updateGallerySettings with an undefined actor id throws on PostgreSQL and commits a NULL-actorId row of defaults on SQLite', async () => {
    const before = await dumpTables()
    const update = () =>
      database.updateGallerySettings({
        actorId: UNDEFINED,
        showGear: false,
        mapPublic: false
      })

    if (isPostgres()) {
      await expect(update()).rejects.toThrow('null value in column "actorId"')
      expect(await dumpTables()).toEqual(before)
      return
    }

    try {
      expect(await update()).toEqual(DEFAULT_GALLERY_SETTINGS)
      const rows = await db()
        .selectFrom('gallery_settings')
        .selectAll()
        .where('actorId', 'is', null)
        .execute()
      // The insert-if-missing wrote the row with the column defaults; the
      // update matched nothing, so the given fields were not written.
      expect(rows).toHaveLength(1)
      expect(Boolean(rows[0].showGear)).toBeTrue()
      expect(Boolean(rows[0].mapPublic)).toBeTrue()
    } finally {
      await db()
        .deleteFrom('gallery_settings')
        .where('actorId', 'is', null)
        .execute()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('a null id, actor id, device key or gear id matches nothing', async () => {
    const actorId = await newActor()
    const keyless = await seedGear(actorId, { name: 'No device key' })
    const mediaId = await seedMedia(mediaIds()(1), actorId, {
      cameraGearId: keyless
    })
    const publicPost = await publicNote(actorId)
    await seedAttachment(mediaId, publicPost, actorId)
    const before = await dumpTables()

    // Knex compiled these to `device key is null` and `cameraGearId is null`.
    expect(
      await database.findGalleryGearByDeviceKey({ actorId, deviceKey: NULL })
    ).toBeNull()
    expect(
      await database.getGalleryMedia({
        actorId,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 20,
        gearId: NULL
      })
    ).toEqual([])
    expect(await database.getGalleryGear({ id: NULL, actorId })).toBeNull()
    expect(await database.getGallerySettings({ actorId: NULL })).toEqual(
      DEFAULT_GALLERY_SETTINGS
    )
    expect(await dumpTables()).toEqual(before)
  })

  it('a null actor id matches no owner-less media', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const ids = mediaIds()
    const kept = {
      galleryAddedAt: at('2026-01-02'),
      cameraGearId: gearId,
      placeLatitude: 13.75,
      placeLongitude: 100.5,
      placePrecision: 'exact'
    }
    // The same media, kept in the gallery, once owned and once with no owner.
    const owned = await seedMedia(ids(1), actorId, kept)
    const ownerless = await seedMedia(ids(2), NULL, kept)
    const before = await dumpTables()
    const audience = OWNER_GALLERY_AUDIENCE
    const mediaIdList = [String(owned), String(ownerless)]

    // The owner finds theirs through each scoped read ...
    expect(
      (await database.getGalleryMedia({ actorId, audience, limit: 20 })).map(
        (row) => Number(row.media.id)
      )
    ).toEqual([owned])
    expect(
      (
        await database.getGalleryMediaByIds({
          actorId,
          audience,
          mediaIds: mediaIdList
        })
      ).map((row) => Number(row.media.id))
    ).toEqual([owned])
    expect(
      (
        await database.getGalleryMediaIndex({ actorId, audience, limit: 20 })
      ).map((row) => Number(row.id))
    ).toEqual([owned])
    expect(
      (await database.getGalleryMapRows({ actorId, audience, limit: 20 })).map(
        (row) => Number(row.id)
      )
    ).toEqual([owned])
    expect(
      (
        await database.getGalleryGearUsageRows({ actorId, gearIds: [gearId] })
      ).map((row) => Number(row.mediaId))
    ).toEqual([owned])
    expect(
      await database.getActorHasGalleryMedia({ actorId, audience })
    ).toBeTrue()

    // ... and a null actor id finds the owner-less one through none of them.
    expect(
      await database.getGalleryMedia({ actorId: NULL, audience, limit: 20 })
    ).toEqual([])
    expect(
      await database.getGalleryMediaByIds({
        actorId: NULL,
        audience,
        mediaIds: mediaIdList
      })
    ).toEqual([])
    expect(
      await database.getGalleryMediaIndex({
        actorId: NULL,
        audience,
        limit: 20
      })
    ).toEqual([])
    expect(
      await database.getGalleryMapRows({ actorId: NULL, audience, limit: 20 })
    ).toEqual([])
    expect(
      await database.getGalleryGearUsageRows({
        actorId: NULL,
        gearIds: [gearId]
      })
    ).toEqual([])
    expect(
      await database.getActorHasGalleryMedia({ actorId: NULL, audience })
    ).toBeFalse()
    expect(
      await database.getUnattachedMedia({
        actorId: NULL,
        mediaIds: mediaIdList
      })
    ).toEqual([])
    expect(
      await database.addMediaToGallery({
        actorId: NULL,
        mediaIds: mediaIdList
      })
    ).toEqual([])
    expect(await dumpTables()).toEqual(before)
  })

  // SQLite only: the keys below can be NULL there, and Knex matched them.
  it.skipIf(isPostgres())(
    'a null id or actor id matches no NULL-key row on SQLite',
    async () => {
      const actorId = await newActor()
      const now = at('2026-01-02')
      await db()
        .insertInto('gallery_settings')
        .values({
          actorId: NULL,
          showGear: false,
          createdAt: now,
          updatedAt: now
        })
        .execute()
      await db()
        .insertInto('gallery_gears')
        .values({
          id: NULL,
          actorId,
          kind: 'camera',
          name: 'No id',
          createdAt: now,
          updatedAt: now
        })
        .execute()
      const nullKeyRows = async () => ({
        settings: await db()
          .selectFrom('gallery_settings')
          .selectAll()
          .where('actorId', 'is', null)
          .execute(),
        gears: await db()
          .selectFrom('gallery_gears')
          .selectAll()
          .where('id', 'is', null)
          .execute()
      })

      try {
        const before = await nullKeyRows()
        expect(before.settings).toHaveLength(1)
        expect(before.gears).toHaveLength(1)

        expect(await database.getGallerySettings({ actorId: NULL })).toEqual(
          DEFAULT_GALLERY_SETTINGS
        )
        expect(await database.getGalleryGear({ id: NULL, actorId })).toBeNull()
        expect(
          await database.updateGalleryGear({
            id: NULL,
            actorId,
            name: 'Renamed'
          })
        ).toBeNull()
        expect(
          await database.setGalleryGearRetired({
            id: NULL,
            actorId,
            retired: true
          })
        ).toBeNull()
        expect(
          await database.deleteGalleryGear({ id: NULL, actorId })
        ).toBeFalse()
        // The save inserts a row of defaults (SQLite treats NULL keys as
        // distinct, so the insert-if-missing adds one) and updates nothing,
        // so it answers the defaults and leaves the hand-written row alone.
        expect(
          await database.updateGallerySettings({
            actorId: NULL,
            mapPublic: false
          })
        ).toEqual(DEFAULT_GALLERY_SETTINGS)

        const after = await nullKeyRows()
        expect(after.gears).toEqual(before.gears)
        expect(after.settings.filter((row) => !row.showGear)).toEqual(
          before.settings
        )
        expect(after.settings.every((row) => row.mapPublic)).toBeTrue()
      } finally {
        await db()
          .deleteFrom('gallery_settings')
          .where('actorId', 'is', null)
          .execute()
        await db().deleteFrom('gallery_gears').where('id', 'is', null).execute()
      }
    }
  )
})

// What the Kysely driver does differently from Knex, as the gallery reads and
// writes meet it: the three differences the part 23 description lists.
describe('driver differences', () => {
  const EPOCH_0 = new Date(0)

  // The reads that return whole media rows, with the media they answer for the
  // owner. A media in the gallery without an attachment is shown bare to its
  // owner, and an unattached one is what getUnattachedMedia reads.
  const readMedia = async (actorId: string, mediaId: number) => {
    const audience = OWNER_GALLERY_AUDIENCE
    const id = String(mediaId)
    const listed = (
      await database.getGalleryMedia({ actorId, audience, limit: 20 })
    ).find((row) => row.media.id === id)
    const byIds = (
      await database.getGalleryMediaByIds({ actorId, audience, mediaIds: [id] })
    ).find((row) => row.media.id === id)
    const unattached = (
      await database.getUnattachedMedia({ actorId, mediaIds: [id] })
    ).find((media) => media.id === id)
    // Each read answers with the media, so the null times below are the
    // parser's doing and not a missing row.
    if (!listed || !byIds || !unattached) {
      throw new Error(`A whole-row media read dropped media ${id}`)
    }
    return { listed: listed.media, byIds: byIds.media, unattached }
  }

  it('reads epoch-0 media times as absent, and keeps 0 in the index rows', async () => {
    const actorId = await newActor()
    const ids = mediaIds()
    const times = {
      takenAt: EPOCH_0,
      editedAt: EPOCH_0,
      subjectLookupAt: EPOCH_0,
      placeLookupAt: EPOCH_0
    }
    // The same columns with ordinary times, so the reads below are shown to
    // return a time when there is one.
    const realTimes = {
      takenAt: at('2026-01-02'),
      editedAt: at('2026-01-03'),
      subjectLookupAt: at('2026-01-04'),
      placeLookupAt: at('2026-01-05')
    }
    const epoch = await seedMedia(ids(1), actorId, {
      ...times,
      galleryAddedAt: at('2026-01-02')
    })
    const real = await seedMedia(ids(2), actorId, {
      ...realTimes,
      galleryAddedAt: at('2026-01-02')
    })

    const read = await readMedia(actorId, epoch)
    for (const media of Object.values(read)) {
      expect(media.details?.takenAt).toBeNull()
      expect(media.details?.subjectLookupAt).toBeNull()
      expect(media.details?.placeLookupAt).toBeNull()
      expect(media.edit?.editedAt).toBeNull()
    }

    const control = await readMedia(actorId, real)
    for (const media of Object.values(control)) {
      expect(media.details?.takenAt).toBe(realTimes.takenAt.getTime())
      expect(media.details?.subjectLookupAt).toBe(
        realTimes.subjectLookupAt.getTime()
      )
      expect(media.details?.placeLookupAt).toBe(
        realTimes.placeLookupAt.getTime()
      )
      expect(media.edit?.editedAt).toBe(realTimes.editedAt.getTime())
    }

    // The index rows go through parseNullableTime, which keeps 0.
    const index = await database.getGalleryMediaIndex({
      actorId,
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 20
    })
    expect(index.map((row) => [row.id, row.takenAt])).toEqual([
      [String(real), realTimes.takenAt.getTime()],
      [String(epoch), 0]
    ])
  })

  // PostgreSQL only: SQLite has no int8 parsing, so it reads the stored integer
  // as a rounded JS number and does not throw.
  it.skipIf(!isPostgres())(
    'throws the driver’s RangeError for a byte count above 2^53 - 1 in the whole-row media reads only',
    async () => {
      for (const column of ['originalBytes', 'thumbnailBytes'] as const) {
        const actorId = await newActor()
        const gearId = await seedGear(actorId)
        const mediaId = await seedMedia(mediaIds()(1), actorId, {
          // As a SQL literal: a JS number would round it before it is bound.
          [column]: sql<number>`9007199254740993`,
          thumbnail: `medias/${column}.thumb.jpg`,
          galleryAddedAt: at('2026-01-02'),
          cameraGearId: gearId,
          placeLatitude: 13.75,
          placeLongitude: 100.5,
          placePrecision: 'exact'
        })
        const audience = OWNER_GALLERY_AUDIENCE
        const params = { actorId, audience }

        await expect(
          database.getGalleryMedia({ ...params, limit: 20 })
        ).rejects.toThrow(RangeError)
        await expect(
          database.getGalleryMediaByIds({
            ...params,
            mediaIds: [String(mediaId)]
          })
        ).rejects.toThrow(RangeError)
        await expect(
          database.getUnattachedMedia({ actorId, mediaIds: [String(mediaId)] })
        ).rejects.toThrow(RangeError)

        // The reads that select no byte count are unchanged.
        expect(
          (await database.getGalleryMediaIndex({ ...params, limit: 20 })).map(
            (row) => row.id
          )
        ).toEqual([String(mediaId)])
        expect(
          (await database.getGalleryMapRows({ ...params, limit: 20 })).map(
            (row) => row.id
          )
        ).toEqual([String(mediaId)])
        expect(
          (
            await database.getGalleryGearUsageRows({
              actorId,
              gearIds: [gearId]
            })
          ).map((row) => row.mediaId)
        ).toEqual([String(mediaId)])
      }
    }
  )

  // The driver's own message, without Knex's "insert into ... - " prefix. The
  // patterns are anchored, so a prefixed message does not match.
  const DRIVER_MESSAGE = isPostgres()
    ? /^insert or update on table "gallery_gears" violates foreign key constraint "gallery_gears_actorid_foreign"$/
    : /^FOREIGN KEY constraint failed$/

  const messageOf = async (action: Promise<unknown>) => {
    try {
      await action
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('Expected the call to reject')
  }

  it('database errors carry the driver’s message, without a statement prefix', async () => {
    const nobody = `https://${DOMAIN}/users/nobody-${Date.now()}`

    const created = await messageOf(
      database.createGalleryGear({
        actorId: nobody,
        kind: 'camera',
        name: 'Orphan'
      })
    )
    const createdWithinLimit = await messageOf(
      database.createGalleryGearWithinLimit({
        actorId: nobody,
        kind: 'camera',
        name: 'Orphan',
        limit: 10,
        dedupeByName: true
      })
    )

    expect(created).toMatch(DRIVER_MESSAGE)
    expect(createdWithinLimit).toMatch(DRIVER_MESSAGE)
    // What Knex wrote in front of the driver's message.
    for (const message of [created, createdWithinLimit]) {
      expect(message).not.toContain('insert into')
      expect(message).not.toContain(' - ')
    }
    // The anchored patterns reject a prefixed message.
    expect(
      `insert into "gallery_gears" (...) values (...) - ${created}`
    ).not.toMatch(DRIVER_MESSAGE)
  })
})
