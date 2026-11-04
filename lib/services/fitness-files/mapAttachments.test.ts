import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  findRouteMapAttachments,
  removeRouteMapAttachmentsAndMedia
} from '@/lib/services/fitness-files/mapAttachments'
import { deleteMediaFile } from '@/lib/services/medias'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

vi.mock('@/lib/services/medias', () => ({
  deleteMediaFile: vi.fn()
}))

describe('removeRouteMapAttachmentsAndMedia', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let accountId = ''

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
    accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  beforeEach(() => {
    vi.mocked(deleteMediaFile).mockReset()
    vi.mocked(deleteMediaFile).mockResolvedValue(true)
  })

  // The owner may have opened the route map in the photo editor: its
  // uploaded original and earlier renders live beside the live file.
  it('deletes the files an edited map keeps along with its row', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/route-map.webp',
        bytes: 1000,
        mimeType: 'image/webp',
        metaData: { width: 800, height: 600 }
      }
    })
    for (const [index, name] of ['route-map-a', 'route-map-b'].entries()) {
      await database.applyMediaEdit({
        mediaId: media!.id,
        accountId,
        baseVersion: index,
        saveId: name,
        recipe: '{"v":1}',
        render: {
          path: `medias/${name}.webp`,
          bytes: 300,
          mimeType: 'image/webp',
          width: 800,
          height: 600,
          blurhash: null,
          focus: null
        }
      })
    }
    const usageBefore = await database.getStorageUsageForAccount({
      accountId
    })

    await removeRouteMapAttachmentsAndMedia({
      database,
      accountId,
      statusId: `${ACTOR1_ID}/statuses/route-map`,
      attachmentIds: [],
      mediaIds: [media!.id]
    })

    const deleted = vi.mocked(deleteMediaFile).mock.calls.map((call) => call[1])
    expect([...deleted].sort()).toEqual(
      [
        'medias/route-map.webp',
        'medias/route-map-a.webp',
        'medias/route-map-b.webp'
      ].sort()
    )
    expect(
      await database.listMediaEditFiles({ mediaIds: [media!.id] })
    ).toEqual([])
    expect(await database.getStorageUsageForAccount({ accountId })).toBe(
      usageBefore - 1600
    )
  })
})

describe('findRouteMapAttachments', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  // Only a flagged map at the file's path is the file's map: a photo that
  // happens to show the same file is never removed with it.
  it('finds the flagged map at the path and leaves an unflagged attachment there alone', async () => {
    const statusId = `${ACTOR1_ID}/statuses/find-route-map`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Ride',
      summary: null,
      to: [],
      cc: []
    })
    const mapImagePath = 'medias/find-route-map.webp'
    const media = (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: mapImagePath,
        bytes: 1000,
        mimeType: 'image/webp',
        metaData: { width: 800, height: 600 }
      }
    }))!
    const attach = (isRouteMap: boolean) =>
      database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/webp',
        url: `https://llun.test/api/v1/files/${mapImagePath}`,
        width: 800,
        height: 600,
        name: '',
        mediaId: media.id,
        isRouteMap
      })
    const map = await attach(true)
    await attach(false)

    const found = await findRouteMapAttachments({
      database,
      statusId,
      mapImagePath
    })

    expect(found.map((attachment) => attachment.id)).toEqual([map.id])
  })
})
