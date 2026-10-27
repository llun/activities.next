import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { FileArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import {
  ACCOUNT_IMPORT_ALBUM_POSITION,
  ACCOUNT_IMPORT_FITNESS_FILE_POSITION,
  ACCOUNT_IMPORT_FITNESS_GEAR_POSITION,
  ACCOUNT_IMPORT_GALLERY_GEAR_POSITION,
  ACCOUNT_IMPORT_GALLERY_SETTINGS_POSITION,
  ACCOUNT_IMPORT_MEDIA_POSITION
} from '@/lib/services/accountImport/constants'
import { createAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  runAlbumsPhase,
  runFitnessPhase,
  runGalleryPhase,
  runGearsPhase,
  runOwnArchiveMediaPhase
} from '@/lib/services/accountImport/phases'
import { createInitialImportProgress } from '@/lib/services/accountImport/progress'
import { buildZip } from '@/lib/services/accountImport/zip/testing/fixtures'
import * as mediaService from '@/lib/services/medias'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const mocks = vi.hoisted(() => ({ storageRoot: '', publish: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    allowEmails: [],
    trustedHosts: [],
    allowActorDomains: [],
    mediaStorage: {
      type: 'fs',
      path: mocks.storageRoot + '/media',
      maxFileSize: 10 * 1024 * 1024
    },
    fitnessStorage: {
      type: 'fs',
      path: mocks.storageRoot + '/fitness',
      maxFileSize: 10 * 1024 * 1024
    }
  }),
  getBaseURL: () => 'https://llun.test',
  buildBaseURL: (host: string) => 'https://' + host
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    publish: mocks.publish,
    handle: vi.fn()
  })
}))

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('own archive import phases', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  let actor: Actor
  let objectStore: NonNullable<
    ReturnType<typeof createAccountImportObjectStore>
  >

  beforeAll(async () => {
    mocks.storageRoot = process.cwd() + '/plans/tmp/s5/phase-storage'
    await Promise.all(
      ['/media', '/fitness'].map((subdirectory) =>
        fs.mkdir(mocks.storageRoot + subdirectory, { recursive: true })
      )
    )
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
    objectStore = createAccountImportObjectStore(
      new FileArchiveObjectStore({
        type: 'fs' as never,
        path: mocks.storageRoot
      })
    )!
  })

  afterAll(async () => {
    await destroy()
    await fs.rm(mocks.storageRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
    mocks.publish.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  const createImport = async (id: string) => {
    await database.createAccountImport({
      id,
      accountId: actor.account!.id,
      actorId: actor.id,
      options: '{}'
    })
    await database.updateAccountImport({
      id,
      status: 'running',
      kind: 'activities.next'
    })
    return (await database.getAccountImport({ id, actorId: actor.id }))!
  }

  const stageArchive = async (
    accountImport: Awaited<ReturnType<typeof createImport>>,
    archive: Buffer
  ) => {
    await objectStore.store.put(
      objectStore.getUploadKey(accountImport),
      archive
    )
    await database.updateAccountImport({
      id: accountImport.id,
      uploadedBytes: archive.length
    })
    return (await database.getAccountImport({
      id: accountImport.id,
      actorId: actor.id
    }))!
  }

  const contextFor = (
    accountImport: Awaited<ReturnType<typeof createImport>>
  ) => ({
    database,
    objectStore,
    accountImport,
    now: () => 1,
    deadline: Number.MAX_SAFE_INTEGER,
    renew: async () => {}
  })

  const mediaLine = (id: number, archivePath: string | null) => ({
    id,
    original: 'stored/' + id + '.webp',
    thumbnail: null,
    description: 'Photo ' + id,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    originalMimeType: 'image/webp',
    originalBytes: 100,
    thumbnailBytes: null,
    thumbnailMimeType: null,
    originalMetaData: { width: 1, height: 1, size: '1x1', aspect: 1 },
    thumbnailMetaData: null,
    originalFileName: 'deceptive.gif',
    focusX: null,
    focusY: null,
    blurhash: null,
    subjectName: null,
    subjectScientificName: null,
    subjectCategory: null,
    takenAt: null,
    cameraGearId: null,
    lensGearId: null,
    exposure: null,
    placeName: null,
    placeLatitude: null,
    placeLongitude: null,
    placePrecision: null,
    placeCountryCode: null,
    placeNameSource: null,
    inGallery: true,
    subjectTaxonKey: null,
    subjectTaxonPath: null,
    subjectIucnCategory: null,
    subjectSuggestions: null,
    editRecipe: null,
    editVersion: 0,
    editedAt: null,
    galleryAddedAt: null,
    archivePath,
    thumbnailArchivePath: null,
    editFiles: []
  })

  const upsertItems = async (
    importId: string,
    items: {
      kind: string
      sourceId: string
      position: number
      data?: string
    }[]
  ) => database.upsertAccountImportItems({ importId, actorId: actor.id, items })

  it('sniffs media bytes rather than extension or declared MIME and queues no enrichment', async () => {
    const importId = 'own-media-' + randomUUID()
    const accountImport = await createImport(importId)
    const goodPath = 'media_attachments/101.lied'
    const badPath = 'media_attachments/102.jpg'
    const zip = buildZip([
      { name: goodPath, data: PNG },
      { name: badPath, data: Buffer.from('%PDF-1.7 disallowed') }
    ])
    const stagedImport = await stageArchive(accountImport, zip)
    await upsertItems(importId, [
      {
        kind: 'own-media',
        sourceId: '101',
        position: ACCOUNT_IMPORT_MEDIA_POSITION,
        data: JSON.stringify(mediaLine(101, goodPath))
      },
      {
        kind: 'own-media',
        sourceId: '102',
        position: ACCOUNT_IMPORT_MEDIA_POSITION + 1,
        data: JSON.stringify(mediaLine(102, badPath))
      }
    ])
    const saveSpy = vi.spyOn(mediaService, 'saveMedia')

    const result = await runOwnArchiveMediaPhase(
      contextFor(stagedImport),
      createInitialImportProgress(),
      null
    )

    expect(result.result).toBe('done')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledWith(
      database,
      actor,
      expect.objectContaining({ file: expect.any(File) }),
      { withGalleryDetails: false }
    )
    const uploadedFile = saveSpy.mock.calls[0][2].file
    expect(uploadedFile.type).toBe('image/png')
    expect(uploadedFile.name).toBe('archive-media-101.png')
    const items = await database.getAccountImportItems({ importId, limit: 10 })
    expect(items.map(({ state, reason }) => ({ state, reason }))).toEqual([
      { state: 'done', reason: null },
      { state: 'skipped', reason: 'media_type_unsupported' }
    ])
    expect(mocks.publish).not.toHaveBeenCalled()
    saveSpy.mockRestore()
  })

  it('reuses gallery and fitness gears by deviceKey', async () => {
    const importId = 'gear-reuse-' + randomUUID()
    const accountImport = await createImport(importId)
    const galleryGear = await database.createGalleryGear({
      actorId: actor.id,
      kind: 'camera',
      name: 'Existing camera',
      deviceKey: 'camera:' + randomUUID()
    })
    const fitnessGear = await database.createFitnessGear({
      actorId: actor.id,
      kind: 'bike',
      name: 'Existing bike',
      deviceKey: 'bike:' + randomUUID()
    })
    await upsertItems(importId, [
      {
        kind: 'gallery-gear',
        sourceId: 'source-camera',
        position: ACCOUNT_IMPORT_GALLERY_GEAR_POSITION,
        data: JSON.stringify({
          id: 'source-camera',
          kind: 'camera',
          name: 'Archive camera',
          brand: null,
          model: null,
          productUrl: null,
          deviceKey: galleryGear.deviceKey,
          retiredAt: null,
          createdAt: 1,
          updatedAt: 1
        })
      },
      {
        kind: 'fitness-gear',
        sourceId: 'source-bike',
        position: ACCOUNT_IMPORT_FITNESS_GEAR_POSITION,
        data: JSON.stringify({
          id: 'source-bike',
          kind: 'bike',
          name: 'Archive bike',
          brand: null,
          model: null,
          bikeType: null,
          weightKilograms: null,
          defaultSports: null,
          alertDistanceMeters: null,
          lastAlertedDistanceMeters: null,
          notes: null,
          retiredAt: null,
          createdAt: 1,
          updatedAt: 1,
          deviceKey: fitnessGear.deviceKey,
          productUrl: null,
          components: []
        })
      }
    ])

    await runGearsPhase(
      contextFor(accountImport),
      createInitialImportProgress(),
      null
    )

    const items = await database.getAccountImportItems({ importId, limit: 10 })
    expect(items.map(({ targetId }) => targetId)).toEqual([
      galleryGear.id,
      fitnessGear.id
    ])
  })

  it('recreates album membership in archive item order', async () => {
    const importId = 'album-order-' + randomUUID()
    const accountImport = await createImport(importId)
    const mediaIds = await Promise.all(
      [1, 2, 3].map(async (index) => {
        const saved = await mediaService.saveMedia(
          database,
          actor,
          {
            file: new File([new Uint8Array(PNG)], 'album-' + index + '.png', {
              type: 'image/png'
            })
          },
          { withGalleryDetails: false }
        )
        await database.addMediaToGallery({
          actorId: actor.id,
          mediaIds: [saved!.id]
        })
        return saved!.id
      })
    )
    const sourceIds = [31, 11, 21]
    const order = [2, 0, 1]
    await upsertItems(
      importId,
      sourceIds.map((id, index) => ({
        kind: 'own-media',
        sourceId: String(id),
        position: ACCOUNT_IMPORT_MEDIA_POSITION + index,
        data: JSON.stringify(mediaLine(id, 'media_attachments/' + id + '.png'))
      }))
    )
    const mediaItems = await database.getAccountImportItems({
      importId,
      limit: 10
    })
    for (const [index, item] of mediaItems.entries()) {
      await database.markAccountImportItem({
        id: item.id,
        state: 'done',
        targetId: mediaIds[index]
      })
    }
    const album = {
      id: 'source-album',
      title: 'Ordered photos',
      description: null,
      coverMediaId: null,
      visibility: 'public',
      sortOrder: 'added_desc',
      createdAt: 1,
      updatedAt: 1,
      items: order.map((index) => ({
        mediaId: sourceIds[index],
        createdAt: 100 + index
      }))
    }
    await upsertItems(importId, [
      {
        kind: 'album',
        sourceId: album.id,
        position: ACCOUNT_IMPORT_ALBUM_POSITION,
        data: JSON.stringify(album)
      }
    ])
    const createSpy = vi.spyOn(database, 'createGalleryAlbumWithinLimit')

    await runAlbumsPhase(
      contextFor(accountImport),
      createInitialImportProgress(),
      null
    )

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaIds: order.map((index) => mediaIds[index])
      })
    )
    createSpy.mockRestore()
  })

  it('maps old galleryDefault booleans and drops invalid values', async () => {
    const cases: [unknown, string][] = [
      [true, 'always'],
      [false, 'never'],
      ['subject', 'subject'],
      ['unexpected', 'always']
    ]
    for (const [value, expected] of cases) {
      await db.deleteFrom('account_import_items').execute()
      await db.deleteFrom('account_imports').execute()
      const importId = 'gallery-setting-' + randomUUID()
      const accountImport = await createImport(importId)
      await database.updateGallerySettings({
        actorId: actor.id,
        galleryDefault: 'always'
      })
      await upsertItems(importId, [
        {
          kind: 'gallery-settings',
          sourceId: 'gallery-settings',
          position: ACCOUNT_IMPORT_GALLERY_SETTINGS_POSITION,
          data: JSON.stringify({
            autoDescribe: true,
            allowEmptyDescription: true,
            subjectHashtags: false,
            galleryDefault: value,
            defaultPlacePrecision: 'area',
            showGear: true,
            mapPublic: false,
            lifeListPublic: false,
            hiddenLocations: [],
            hideThreatenedPlaces: true,
            subjectSuggestionMode: 'off',
            subjectConfidenceThreshold: 70,
            photoEnhance: false,
            createdAt: 1,
            updatedAt: 1
          })
        }
      ])

      await runGalleryPhase(
        contextFor(accountImport),
        createInitialImportProgress(),
        null
      )

      expect(
        (await database.getGallerySettings({ actorId: actor.id }))
          .galleryDefault
      ).toBe(expected)
    }
  })

  it('links imported fitness files and queues ProcessFitnessFileJob with both quiet flags', async () => {
    const importId = 'fitness-' + randomUUID()
    const accountImport = await createImport(importId)
    const statusId = actor.id + '/statuses/' + randomUUID()
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor.id,
      text: 'Fitness status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const archivePath = 'fitness/files/source.fit'
    const bytes = Buffer.from('FIT archive bytes')
    const stagedImport = await stageArchive(
      accountImport,
      buildZip([{ name: archivePath, data: bytes }])
    )
    await upsertItems(importId, [
      {
        kind: 'status',
        sourceId: 'source-status',
        position: 1,
        data: '{}'
      },
      {
        kind: 'fitness-file',
        sourceId: 'source-file',
        position: ACCOUNT_IMPORT_FITNESS_FILE_POSITION,
        data: JSON.stringify({
          id: 'source-file',
          statusId: 'source-status',
          fileName: 'source.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: bytes.length,
          description: 'Archive ride',
          activityType: 'ride',
          activityStartTime: '2024-01-02T03:04:05.000Z',
          totalDistanceMeters: 5_000,
          totalDurationSeconds: 1_200,
          movingTimeSeconds: 1_100,
          elevationGainMeters: 10,
          deviceManufacturer: null,
          deviceName: null,
          sourceUrl: null,
          gearId: null,
          deviceGearId: null,
          isPrimary: true,
          importBatchId: null,
          createdAt: '2024-01-02T03:04:05.000Z',
          archivePath
        })
      }
    ])
    const statusItem = (
      await database.getAccountImportItems({
        importId,
        limit: 1
      })
    )[0]
    await database.markAccountImportItem({
      id: statusItem.id,
      state: 'done',
      targetId: statusId
    })

    await runFitnessPhase(
      contextFor(stagedImport),
      createInitialImportProgress(),
      null
    )

    const fitnessItem = (
      await database.getAccountImportItems({
        importId,
        afterPosition: ACCOUNT_IMPORT_FITNESS_FILE_POSITION - 1,
        limit: 1
      })
    )[0]
    expect(
      (await database.getFitnessFile({ id: fitnessItem.targetId! }))?.statusId
    ).toBe(statusId)
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: expect.objectContaining({
          actorId: actor.id,
          statusId,
          fitnessFileId: fitnessItem.targetId,
          publishSendNote: false,
          notifyOnComplete: false
        })
      })
    )
  })
})
