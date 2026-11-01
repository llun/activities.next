import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { importAccountArchiveJob } from '@/lib/jobs/importAccountArchiveJob'
import {
  IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME
} from '@/lib/jobs/names'
import { planArchiveActors } from '@/lib/services/accountArchive/layout'
import { FileArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import {
  ACCOUNT_IMPORT_ALBUM_POSITION,
  ACCOUNT_IMPORT_FITNESS_FILE_POSITION,
  ACCOUNT_IMPORT_FITNESS_GEAR_POSITION,
  ACCOUNT_IMPORT_GALLERY_GEAR_POSITION,
  ACCOUNT_IMPORT_OWN_MEDIA_POSITION
} from '@/lib/services/accountImport/constants'
import { createAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  runAlbumsPhase,
  runFitnessPhase,
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
    mocks.storageRoot = os.tmpdir() + '/phase-storage'
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
        position: ACCOUNT_IMPORT_OWN_MEDIA_POSITION,
        data: JSON.stringify(mediaLine(101, goodPath))
      },
      {
        kind: 'own-media',
        sourceId: '102',
        position: ACCOUNT_IMPORT_OWN_MEDIA_POSITION + 1,
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

  it('restores a media gear link whose gear was finished in an earlier import', async () => {
    const previousImport = await createImport(
      'media-gear-previous-' + randomUUID()
    )
    const sourceGearId = 'source-camera-' + randomUUID()
    const targetGear = await database.createGalleryGear({
      actorId: actor.id,
      kind: 'camera',
      name: 'Previously imported camera'
    })
    await upsertItems(previousImport.id, [
      {
        kind: 'gallery-gear',
        sourceId: sourceGearId,
        position: ACCOUNT_IMPORT_GALLERY_GEAR_POSITION
      }
    ])
    const previousGearItem = (
      await database.getAccountImportItems({
        importId: previousImport.id,
        limit: 10
      })
    )[0]
    await database.markAccountImportItem({
      id: previousGearItem.id,
      state: 'done',
      targetId: targetGear.id
    })
    await database.updateAccountImport({
      id: previousImport.id,
      status: 'cancelled'
    })

    const importId = 'media-gear-current-' + randomUUID()
    const accountImport = await createImport(importId)
    const archivePath = 'media_attachments/301.png'
    const stagedImport = await stageArchive(
      accountImport,
      buildZip([{ name: archivePath, data: PNG }])
    )
    await upsertItems(importId, [
      {
        kind: 'own-media',
        sourceId: '301',
        position: ACCOUNT_IMPORT_OWN_MEDIA_POSITION,
        data: JSON.stringify({
          ...mediaLine(301, archivePath),
          cameraGearId: sourceGearId
        })
      }
    ])

    await runOwnArchiveMediaPhase(
      contextFor(stagedImport),
      createInitialImportProgress(),
      null
    )

    const importedItem = (
      await database.getAccountImportItems({ importId, limit: 1 })
    )[0]
    const importedMedia = await db
      .selectFrom('medias')
      .select('cameraGearId')
      .where('id', '=', Number(importedItem.targetId))
      .executeTakeFirst()
    expect(importedMedia?.cameraGearId).toBe(targetGear.id)
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
    const previousImportId = 'album-order-previous-' + randomUUID()
    const previousImport = await createImport(previousImportId)
    await upsertItems(
      previousImportId,
      sourceIds.map((id, index) => ({
        kind: 'own-media',
        sourceId: String(id),
        position: ACCOUNT_IMPORT_OWN_MEDIA_POSITION + index,
        data: JSON.stringify(mediaLine(id, 'media_attachments/' + id + '.png'))
      }))
    )
    const mediaItems = await database.getAccountImportItems({
      importId: previousImportId,
      limit: 10
    })
    for (const [index, item] of mediaItems.entries()) {
      await database.markAccountImportItem({
        id: item.id,
        state: 'done',
        targetId: mediaIds[index]
      })
    }
    await database.updateAccountImport({
      id: previousImport.id,
      status: 'cancelled'
    })
    const importId = 'album-order-current-' + randomUUID()
    const accountImport = await createImport(importId)
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

  it('writes no gear when the lease is lost', async () => {
    const importId = 'gear-lost-lease-' + randomUUID()
    const accountImport = await createImport(importId)
    await upsertItems(importId, [
      {
        kind: 'gallery-gear',
        sourceId: 'source-camera',
        position: ACCOUNT_IMPORT_GALLERY_GEAR_POSITION,
        data: JSON.stringify({
          id: 'source-camera',
          kind: 'camera',
          name: 'Lost lease camera',
          brand: null,
          model: null,
          productUrl: null,
          deviceKey: null,
          retiredAt: null,
          createdAt: 1,
          updatedAt: 1
        })
      }
    ])
    const context = {
      ...contextFor(accountImport),
      renew: vi.fn().mockRejectedValue(new Error('import lease lost'))
    }

    await expect(
      runGearsPhase(context, createInitialImportProgress(), null)
    ).rejects.toThrow('import lease lost')

    const gear = await db
      .selectFrom('gallery_gears')
      .select('id')
      .where('actorId', '=', actor.id)
      .where('name', '=', 'Lost lease camera')
      .executeTakeFirst()
    expect(gear).toBeUndefined()
    const item = (
      await database.getAccountImportItems({ importId, limit: 1 })
    )[0]
    expect(item).toMatchObject({ state: 'pending', targetId: null })
  })

  it('leaves gallery settings untouched when the settings option is off', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const sourceExtrasDir = planArchiveActors(
      [{ id: sourceActorId, username: 'archive', domain: 'source.test' }],
      sourceActorId
    )[0].dir
    const archive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: sourceActorId,
            preferredUsername: 'archive',
            followers: `${sourceActorId}/followers`
          })
        )
      },
      {
        name: `${sourceExtrasDir}/profile.json`,
        data: Buffer.from(
          JSON.stringify({ id: sourceActorId, isDefault: true })
        )
      },
      {
        name: `${sourceExtrasDir}/gallery/settings.json`,
        data: Buffer.from(
          JSON.stringify({
            autoDescribe: true,
            allowEmptyDescription: true,
            subjectHashtags: false,
            galleryDefault: 'never',
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
        )
      }
    ])
    const importId = 'gallery-gating-' + randomUUID()
    const accountImport = await createImport(importId)
    // The job reads the archive through the config-derived object store
    // (mediaStorage path), so stage it there.
    const jobObjectStore = createAccountImportObjectStore(
      new FileArchiveObjectStore({
        type: 'fs' as never,
        path: mocks.storageRoot + '/media'
      })
    )!
    await jobObjectStore.store.put(
      jobObjectStore.getUploadKey(accountImport),
      archive
    )
    await database.updateAccountImport({
      id: importId,
      uploadedBytes: archive.length
    })
    await database.updateGallerySettings({
      actorId: actor.id,
      galleryDefault: 'always'
    })

    for (let slice = 0; slice < 20; slice += 1) {
      await importAccountArchiveJob(database, {
        id: 'gallery-gating-job-' + randomUUID(),
        name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { importId, actorId: actor.id }
      })
      const current = await database.getAccountImport({
        id: importId,
        actorId: actor.id
      })
      if (current?.status !== 'running') break
    }

    const completed = (await database.getAccountImport({
      id: importId,
      actorId: actor.id
    }))!
    expect(completed.status).toBe('done')
    expect(
      (await database.getGallerySettings({ actorId: actor.id })).galleryDefault
    ).toBe('always')
    const items = await database.getAccountImportItems({
      importId,
      limit: 100
    })
    expect(
      items.filter((item) => item.kind === 'gallery-settings')
    ).toHaveLength(0)
  })

  it('links imported fitness files and queues ProcessFitnessFileJob with both quiet flags', async () => {
    const importId = 'fitness-' + randomUUID()
    const previousImport = await createImport('fitness-refs-' + randomUUID())
    const statusId = actor.id + '/statuses/' + randomUUID()
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor.id,
      text: 'Fitness status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const sourceGearId = 'source-bike-' + randomUUID()
    const targetGear = await database.createFitnessGear({
      actorId: actor.id,
      kind: 'bike',
      name: 'Previously imported bike'
    })
    await upsertItems(previousImport.id, [
      { kind: 'status', sourceId: 'source-status', position: 1, data: '{}' },
      {
        kind: 'fitness-gear',
        sourceId: sourceGearId,
        position: ACCOUNT_IMPORT_FITNESS_GEAR_POSITION,
        data: '{}'
      }
    ])
    const previousItems = await database.getAccountImportItems({
      importId: previousImport.id,
      limit: 10
    })
    for (const item of previousItems) {
      await database.markAccountImportItem({
        id: item.id,
        state: 'done',
        targetId: item.kind === 'status' ? statusId : targetGear.id
      })
    }
    await database.updateAccountImport({
      id: previousImport.id,
      status: 'cancelled'
    })
    const accountImport = await createImport(importId)
    const archivePath = 'fitness/files/source.fit'
    const bytes = Buffer.from('FIT archive bytes')
    const stagedImport = await stageArchive(
      accountImport,
      buildZip([{ name: archivePath, data: bytes }])
    )
    await upsertItems(importId, [
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
          gearId: sourceGearId,
          deviceGearId: sourceGearId,
          isPrimary: true,
          importBatchId: null,
          createdAt: '2024-01-02T03:04:05.000Z',
          archivePath
        })
      }
    ])
    await runFitnessPhase(
      contextFor(stagedImport),
      createInitialImportProgress(),
      null
    )

    const fitnessItem = (
      await database.getAccountImportItems({
        importId,
        kinds: ['fitness-file'],
        limit: 1
      })
    )[0]
    const importedFitnessFile = await db
      .selectFrom('fitness_files')
      .select(['statusId', 'gearId', 'deviceGearId'])
      .where('id', '=', fitnessItem.targetId!)
      .executeTakeFirst()
    expect(importedFitnessFile).toEqual({
      statusId,
      gearId: targetGear.id,
      deviceGearId: targetGear.id
    })
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

  it('opens the archive once per fitness phase slice, not once per file', async () => {
    const importId = 'fitness-open-' + randomUUID()
    const previousImport = await createImport(
      'fitness-open-refs-' + randomUUID()
    )
    const statusId = actor.id + '/statuses/' + randomUUID()
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor.id,
      text: 'Fitness status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await upsertItems(previousImport.id, [
      { kind: 'status', sourceId: 'source-status', position: 1, data: '{}' }
    ])
    const previousItems = await database.getAccountImportItems({
      importId: previousImport.id,
      limit: 10
    })
    for (const item of previousItems) {
      await database.markAccountImportItem({
        id: item.id,
        state: 'done',
        targetId: statusId
      })
    }
    await database.updateAccountImport({
      id: previousImport.id,
      status: 'cancelled'
    })
    const accountImport = await createImport(importId)
    const firstPath = 'fitness/files/first.fit'
    const secondPath = 'fitness/files/second.fit'
    const firstBytes = Buffer.from('FIRST fit bytes')
    const secondBytes = Buffer.from('SECOND fit bytes')
    const stagedImport = await stageArchive(
      accountImport,
      buildZip([
        { name: firstPath, data: firstBytes },
        { name: secondPath, data: secondBytes }
      ])
    )
    const fitnessFileItem = (
      archivePath: string,
      bytes: Buffer,
      position: number
    ) => ({
      kind: 'fitness-file',
      sourceId: archivePath,
      position,
      data: JSON.stringify({
        id: archivePath,
        statusId: 'source-status',
        fileName: archivePath.split('/').pop(),
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
    })
    await upsertItems(importId, [
      fitnessFileItem(
        firstPath,
        firstBytes,
        ACCOUNT_IMPORT_FITNESS_FILE_POSITION
      ),
      fitnessFileItem(
        secondPath,
        secondBytes,
        ACCOUNT_IMPORT_FITNESS_FILE_POSITION + 1
      )
    ])
    const openSourceSpy = vi.spyOn(objectStore, 'openSource')

    await runFitnessPhase(
      contextFor(stagedImport),
      createInitialImportProgress(),
      null
    )

    expect(openSourceSpy).toHaveBeenCalledTimes(1)
    const items = await database.getAccountImportItems({
      importId,
      kinds: ['fitness-file'],
      limit: 10
    })
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.state === 'done')).toBe(true)
  })
})
