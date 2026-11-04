import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import {
  down,
  up
} from '@/migrations/20261104133123_add_attachments_is_route_map'

const testDb = createTestDatabase()
const { database } = testDb

const hasColumn = async () => {
  const tables = await testDb.db.introspection.getTables()
  const columns =
    tables.find((table) => table.name === 'attachments')?.columns ?? []
  return columns.some((column) => column.name === 'isRouteMap')
}

let mediaCount = 0
const createMedia = async (original: string) => {
  mediaCount += 1
  const id = 9000 + mediaCount
  await testDb.db
    .insertInto('medias')
    .values({ id, actorId: ACTOR1_ID, original })
    .execute()
  return id
}

const createStatus = async (label: string) => {
  const statusId = `${ACTOR1_ID}/statuses/backfill-${label}`
  await database.createNote({
    id: statusId,
    url: statusId,
    actorId: ACTOR1_ID,
    text: label,
    summary: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: []
  })
  return statusId
}

const createFitnessFile = async (
  statusId: string,
  mapImagePath: string | null
) => {
  const id = `backfill-fit-${statusId.split('-').pop()}`
  await testDb.db
    .insertInto('fitness_files')
    .values({
      id,
      actorId: ACTOR1_ID,
      statusId,
      path: `fitness/${id}.fit`,
      fileName: `${id}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1000,
      mapImagePath
    })
    .execute()
}

const createAttachment = async (
  id: string,
  statusId: string,
  { name, url, mediaId }: { name: string; url: string; mediaId: number }
) => {
  await testDb.db
    .insertInto('attachments')
    .values({
      id,
      actorId: ACTOR1_ID,
      statusId,
      type: 'Document',
      mediaType: 'image/webp',
      url,
      width: 640,
      height: 480,
      name,
      mediaId
    })
    .execute()
}

const fileUrl = (path: string) => `https://llun.test/api/v1/files/${path}`

describe('20261104133123_add_attachments_is_route_map', () => {
  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('marks every route map a fitness status shows, and nothing else, on both backends', async () => {
    await down(testDb.db)
    expect(await hasColumn()).toBe(false)

    // A map still under its default name, found by the name alone: neither
    // its url nor its media matches the file, which records no map path.
    const named = await createStatus('named')
    await createFitnessFile(named, null)
    await createAttachment('named-map', named, {
      name: 'Activity route map',
      url: fileUrl('medias/named-old-map.webp'),
      mediaId: await createMedia('medias/named-old-map.webp')
    })
    // A photo on the same post.
    await createAttachment('named-photo', named, {
      name: 'Summit',
      url: fileUrl('medias/named-photo.jpg'),
      mediaId: await createMedia('medias/named-photo.jpg')
    })

    // A map an edit renamed, found by its url alone: it still ends with
    // mapImagePath, while its media row has moved on.
    const renamed = await createStatus('renamed')
    await createFitnessFile(renamed, 'medias/renamed-map.webp')
    await createAttachment('renamed-map', renamed, {
      name: '',
      url: fileUrl('medias/renamed-map.webp'),
      mediaId: await createMedia('medias/renamed-later.webp')
    })

    // A renamed map whose url does not end with the path (another host
    // spelling), found by its media row's original.
    const byMedia = await createStatus('bymedia')
    await createFitnessFile(byMedia, 'medias/bymedia-map.webp')
    await createAttachment('bymedia-map', byMedia, {
      name: 'Owner text',
      url: fileUrl('medias/bymedia-map.webp?v=2'),
      mediaId: await createMedia('medias/bymedia-map.webp')
    })

    // A renamed map the photo editor re-rendered: the url and the media row
    // both moved, and the original path is one of its edit files.
    const reRendered = await createStatus('rerendered')
    await createFitnessFile(reRendered, 'medias/rerendered-map.webp')
    const reRenderedMedia = await createMedia('medias/rerendered-render.webp')
    await testDb.db
      .insertInto('media_edit_files')
      .values({
        id: 'rerendered-original',
        mediaId: reRenderedMedia,
        actorId: ACTOR1_ID,
        slot: 'original',
        path: 'medias/rerendered-map.webp',
        bytes: 1000,
        mimeType: 'image/webp',
        metaData: '{}'
      })
      .execute()
    await createAttachment('rerendered-map', reRendered, {
      name: '',
      url: fileUrl('medias/rerendered-render.webp'),
      mediaId: reRenderedMedia
    })
    // Photos beside the two maps found through their media: the media checks
    // match each attachment's own media, never the status's.
    await createAttachment('bymedia-photo', byMedia, {
      name: '',
      url: fileUrl('medias/bymedia-photo.jpg'),
      mediaId: await createMedia('medias/bymedia-photo.jpg')
    })
    await createAttachment('rerendered-photo', reRendered, {
      name: '',
      url: fileUrl('medias/rerendered-photo.jpg'),
      mediaId: await createMedia('medias/rerendered-photo.jpg')
    })

    // `%` and `_` in a path are literal: this photo's url matches the path as
    // a LIKE pattern, not as a suffix.
    const wildcard = await createStatus('wildcard')
    await createFitnessFile(wildcard, 'medias/wild%_map.webp')
    await createAttachment('wildcard-photo', wildcard, {
      name: '',
      url: fileUrl('medias/wildXYmap.webp'),
      mediaId: await createMedia('medias/wildXYmap.webp')
    })

    // An empty mapImagePath is a suffix of every url; it marks nothing.
    const emptyPath = await createStatus('emptypath')
    await createFitnessFile(emptyPath, '')
    await createAttachment('emptypath-photo', emptyPath, {
      name: '',
      url: fileUrl('medias/emptypath-photo.jpg'),
      mediaId: await createMedia('medias/emptypath-photo.jpg')
    })

    // The default name on a post with no fitness file is just a name.
    const plain = await createStatus('plain')
    await createAttachment('plain-named', plain, {
      name: 'Activity route map',
      url: fileUrl('medias/plain.jpg'),
      mediaId: await createMedia('medias/plain.jpg')
    })

    const flags = async () =>
      Object.fromEntries(
        (
          await testDb.db
            .selectFrom('attachments')
            .select(['id', 'isRouteMap'])
            .where('id', 'in', [
              'named-map',
              'named-photo',
              'renamed-map',
              'bymedia-map',
              'rerendered-map',
              'bymedia-photo',
              'rerendered-photo',
              'wildcard-photo',
              'emptypath-photo',
              'plain-named'
            ])
            .execute()
        ).map((row) => [row.id, Boolean(row.isRouteMap)])
      )
    const expected = {
      'named-map': true,
      'named-photo': false,
      'renamed-map': true,
      'bymedia-map': true,
      'rerendered-map': true,
      'bymedia-photo': false,
      'rerendered-photo': false,
      'wildcard-photo': false,
      'emptypath-photo': false,
      'plain-named': false
    }

    await up(testDb.db)
    expect(await hasColumn()).toBe(true)
    expect(await flags()).toEqual(expected)

    // Safe to run twice.
    await up(testDb.db)
    expect(await flags()).toEqual(expected)

    // A new row defaults to false.
    await createAttachment('after-up', plain, {
      name: '',
      url: fileUrl('medias/after-up.jpg'),
      mediaId: await createMedia('medias/after-up.jpg')
    })
    const afterUp = await testDb.db
      .selectFrom('attachments')
      .select('isRouteMap')
      .where('id', '=', 'after-up')
      .executeTakeFirstOrThrow()
    expect(Boolean(afterUp.isRouteMap)).toBe(false)

    await down(testDb.db)
    expect(await hasColumn()).toBe(false)
    await up(testDb.db)
    expect(await hasColumn()).toBe(true)
  })
})
