import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  findRouteMapAttachments,
  removeRouteMapAttachmentsAndMedia
} from '@/lib/services/fitness-files/mapAttachments'
import { deleteMediaFile } from '@/lib/services/medias'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/services/medias', () => ({
  deleteMediaFile: vi.fn()
}))

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

describe('removeRouteMapAttachmentsAndMedia', () => {
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createStatus = async (postId: string) => {
    const statusId = `${ACTOR1_ID}/statuses/${postId}`
    await database.createNote({
      id: statusId,
      url: `https://llun.test/@actor1/${postId}`,
      actorId: ACTOR1_ID,
      text: 'Morning run',
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${ACTOR1_ID}/followers`],
      reply: ''
    })
    return statusId
  }

  const createMapMedia = async (path: string) => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path,
        bytes: 1000,
        mimeType: 'image/webp',
        metaData: { width: 800, height: 600 }
      }
    })
    expect(media).toBeDefined()
    return media!.id
  }

  const attachMap = async ({
    statusId,
    mediaId,
    path,
    name
  }: {
    statusId: string
    mediaId: string
    path: string
    name: string
  }) =>
    database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/webp',
      url: `https://llun.test/api/v1/files/${path}`,
      width: 800,
      height: 600,
      name,
      mediaId
    })

  // A "Gallery only" revert makes the uploaded original the live file again
  // while the post keeps the render. Committing between the live-file read and
  // the edit-files read leaves the recorded path in neither: the live read
  // still sees the render, and the edit-files read no longer has the original
  // slot. The live read has to be re-taken after the edit files are read.
  it('finds a map whose media was reverted between the live and edit-file reads', async () => {
    const statusId = await createStatus(`route-map-race-${Date.now()}`)
    const mapPath = 'medias/race-route-map.webp'
    const renderPath = 'medias/race-route-map-render.webp'
    const mediaId = await createMapMedia(mapPath)

    const edited = await database.applyMediaEdit({
      mediaId,
      accountId,
      baseVersion: 0,
      saveId: 'race-route-map-edit',
      recipe: '{"v":1}',
      render: {
        path: renderPath,
        bytes: 300,
        mimeType: 'image/webp',
        width: 800,
        height: 600,
        blurhash: null,
        focus: null
      }
    })
    expect(edited.status).toBe('ok')
    await attachMap({
      statusId,
      mediaId,
      path: renderPath,
      name: 'Morning route'
    })

    // The revert runs inside the edit-files read, after the live read has
    // returned — the same interleaving a concurrent save or revert produces.
    const getMediaByIdsForAccount =
      database.getMediaByIdsForAccount.bind(database)
    const listMediaEditFiles = database.listMediaEditFiles.bind(database)
    let liveReadDone: () => void = () => {}
    const liveRead = new Promise<void>((resolve) => {
      liveReadDone = resolve
    })
    vi.spyOn(database, 'getMediaByIdsForAccount').mockImplementation(
      async (params) => {
        const media = await getMediaByIdsForAccount(params)
        liveReadDone()
        return media
      }
    )
    vi.spyOn(database, 'listMediaEditFiles').mockImplementationOnce(
      async (params) => {
        await liveRead
        const reverted = await database.revertMediaEdit({
          mediaId,
          accountId,
          baseVersion: 1,
          saveId: 'race-route-map-revert'
        })
        expect(reverted.status).toBe('ok')
        return listMediaEditFiles(params)
      }
    )

    const attachments = await findRouteMapAttachments({
      database,
      accountId,
      statusId,
      mapImagePath: mapPath
    })

    expect(attachments).toHaveLength(1)
    expect(attachments[0].url).toBe(
      `https://llun.test/api/v1/files/${renderPath}`
    )
  })

  // A merged same-ride post carries one map per activity, each at its own
  // path, so one file's map must never be mistaken for another's.
  it('does not return another map on a merged post', async () => {
    const statusId = await createStatus(`route-map-merged-${Date.now()}`)
    const firstPath = 'medias/merged-first-map.webp'
    const secondPath = 'medias/merged-second-map.webp'
    const firstMediaId = await createMapMedia(firstPath)
    const secondMediaId = await createMapMedia(secondPath)
    await attachMap({
      statusId,
      mediaId: firstMediaId,
      path: firstPath,
      name: 'First map'
    })
    await attachMap({
      statusId,
      mediaId: secondMediaId,
      path: secondPath,
      name: 'Second map'
    })

    const attachments = await findRouteMapAttachments({
      database,
      accountId,
      statusId,
      mapImagePath: firstPath
    })

    expect(attachments).toHaveLength(1)
    expect(attachments[0].url).toBe(
      `https://llun.test/api/v1/files/${firstPath}`
    )
  })
})
