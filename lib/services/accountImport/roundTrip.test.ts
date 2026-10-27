import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { exportAccountArchiveJob } from '@/lib/jobs/exportAccountArchiveJob'
import { importAccountArchiveJob } from '@/lib/jobs/importAccountArchiveJob'
import {
  EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
  IMPORT_ACCOUNT_ARCHIVE_JOB_NAME
} from '@/lib/jobs/names'
import { FileArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import { createAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { getMediaFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import {
  MAX_GALLERY_ALBUMS_PER_ACTOR,
  MAX_GALLERY_ALBUM_ITEMS
} from '@/lib/types/database/galleryAlbums'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getVisibility } from '@/lib/utils/getVisibility'

const mocks = vi.hoisted(() => ({
  storageRoot: '',
  published: [] as { id: string; name: string; data: unknown }[]
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    allowEmails: [],
    trustedHosts: [],
    allowActorDomains: [],
    email: null,
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
    publish: vi.fn(async (message) => {
      mocks.published.push(message)
    }),
    handle: vi.fn()
  })
}))

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const GPX = Buffer.from('<gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>')

describe('account archive round trip', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  let sourceActor: Actor
  let targetActor: Actor
  let objectStore: FileArchiveObjectStore
  let importObjectStore: NonNullable<
    ReturnType<typeof createAccountImportObjectStore>
  >

  beforeAll(async () => {
    mocks.storageRoot = process.cwd() + '/plans/tmp/s5/roundtrip-storage'
    await Promise.all(
      ['/media', '/fitness'].map((subdirectory) =>
        fs.mkdir(mocks.storageRoot + subdirectory, { recursive: true })
      )
    )
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    sourceActor = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
    targetActor = (await database.getActorFromEmail({
      email: seedActor2.email
    })) as Actor
    objectStore = new FileArchiveObjectStore({
      type: 'fs' as never,
      path: mocks.storageRoot + '/media'
    })
    importObjectStore = createAccountImportObjectStore(objectStore)!
  })

  afterAll(async () => {
    await destroy()
    await fs.rm(mocks.storageRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    mocks.published.length = 0
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
    await db.deleteFrom('account_archives').execute()
  })

  it('exports and imports statuses, media details, gallery, gears, and fitness links', async () => {
    await database.updateActor({
      actorId: sourceActor.id,
      name: 'Round trip profile name',
      summary: 'Round trip profile bio',
      fields: [{ name: 'Website', value: 'https://source.example' }],
      defaultPrivacy: 'private',
      defaultSensitive: true,
      defaultLanguage: 'sl',
      readingExpandSpoilers: true,
      discoverable: false
    })
    await database.updateActor({
      actorId: targetActor.id,
      name: 'Destination profile name',
      summary: 'Destination profile bio',
      fields: [],
      defaultPrivacy: 'unlisted',
      defaultSensitive: false,
      defaultLanguage: 'en',
      readingExpandSpoilers: false,
      discoverable: true
    })
    const mediaBefore = await db
      .selectFrom('medias')
      .select('id')
      .where('actorId', '=', targetActor.id)
      .execute()
    const statusId = sourceActor.id + '/statuses/' + randomUUID()
    const sourceStatus = await database.createNote({
      id: statusId,
      url: statusId,
      actorId: sourceActor.id,
      text: 'A public archive status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const camera = await database.createGalleryGear({
      actorId: sourceActor.id,
      kind: 'camera',
      name: 'Round trip camera',
      deviceKey: 'camera:' + randomUUID()
    })
    const fitnessGear = await database.createFitnessGear({
      actorId: sourceActor.id,
      kind: 'bike',
      name: 'Round trip bike',
      deviceKey: 'bike:' + randomUUID()
    })
    await database.updateGallerySettings({
      actorId: sourceActor.id,
      galleryDefault: 'always'
    })

    const exportMediaPath = 'medias/archive-' + randomUUID() + '.png'
    await fs.mkdir(mocks.storageRoot + '/media/medias', { recursive: true })
    await fs.writeFile(mocks.storageRoot + '/media/' + exportMediaPath, PNG)
    const sourceMedia = await database.createMedia({
      actorId: sourceActor.id,
      original: {
        path: exportMediaPath,
        bytes: PNG.length,
        mimeType: 'image/png',
        metaData: { width: 1, height: 1 },
        fileName: 'bird.png'
      },
      description: 'A bright bird'
    })
    expect(sourceMedia).toBeTruthy()
    await database.updateMedia({
      mediaId: sourceMedia!.id,
      accountId: sourceActor.account!.id,
      actorId: sourceActor.id,
      description: 'A bright bird',
      focus: { x: 0.2, y: -0.1 },
      blurhash: 'round-trip-blurhash',
      details: {
        subjectName: 'Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectCategory: 'bird',
        takenAt: 1_700_000_000_000,
        cameraGearId: camera.id,
        lensGearId: null,
        exposure: null,
        placeName: 'Ljubljana',
        placeLatitude: 46.0569,
        placeLongitude: 14.5058,
        placePrecision: 'area',
        inGallery: false,
        subjectTaxonKey: '2492'
      }
    })
    await database.setMediaSubjectLookup({
      mediaId: sourceMedia!.id,
      expect: {
        subjectName: 'Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectTaxonKey: '2492',
        subjectCategory: 'bird'
      },
      patch: {
        subjectLookupStatus: 'resolved',
        subjectTaxonPath: ['Animalia', 'Chordata', 'Aves'],
        subjectIucnCategory: 'LC'
      }
    })
    await database.setMediaPlaceLookup({
      mediaId: sourceMedia!.id,
      expect: { placeLatitude: 46.0569, placeLongitude: 14.5058 },
      patch: {
        placeLookupStatus: 'resolved',
        placeCountryCode: 'SI',
        placeName: 'Ljubljana'
      }
    })
    await database.addMediaToGallery({
      actorId: sourceActor.id,
      mediaIds: [sourceMedia!.id]
    })
    await database.createAttachment({
      actorId: sourceActor.id,
      statusId: sourceStatus.id,
      mediaType: 'image',
      url: getMediaFileUrl('llun.test', exportMediaPath),
      mediaId: sourceMedia!.id,
      width: 1,
      height: 1,
      name: 'A bright bird'
    })
    const album = await database.createGalleryAlbumWithinLimit({
      actorId: sourceActor.id,
      title: 'Round trip album',
      description: 'Preserved gallery membership',
      visibility: 'public',
      sortOrder: 'added_desc',
      limit: MAX_GALLERY_ALBUMS_PER_ACTOR,
      itemLimit: MAX_GALLERY_ALBUM_ITEMS,
      mediaIds: [sourceMedia!.id]
    })
    if (album.status !== 'created') throw new Error('album creation failed')
    await database.updateGalleryAlbum({
      id: album.album.id,
      actorId: sourceActor.id,
      coverMediaId: sourceMedia!.id
    })

    const fitnessUpload = await saveFitnessFile(database, sourceActor, {
      file: new File([new Uint8Array(GPX)], 'round-trip.gpx', {
        type: 'application/gpx+xml'
      })
    })
    expect(fitnessUpload).toBeTruthy()
    await database.updateFitnessFileStatus(fitnessUpload!.id, sourceStatus.id)
    await database.updateFitnessFileActivityData(fitnessUpload!.id, {
      activityType: 'ride',
      activityStartTime: new Date('2024-01-02T03:04:05.000Z'),
      totalDistanceMeters: 12_345,
      totalDurationSeconds: 3_600,
      movingTimeSeconds: 3_500,
      elevationGainMeters: 123,
      deviceManufacturer: 'Archive maker',
      deviceName: 'Archive device'
    })
    await database.setFitnessFileGear({
      fitnessFileId: fitnessUpload!.id,
      actorId: sourceActor.id,
      gearId: fitnessGear.id
    })
    await database.updateFitnessFilePrimary(fitnessUpload!.id, true)

    const archiveId = 'roundtrip-export-' + randomUUID()
    await database.createAccountArchive({
      id: archiveId,
      accountId: sourceActor.account!.id,
      options: { stripExactLocations: false, drafts: false }
    })
    const runExportSlice = (slice: number) =>
      exportAccountArchiveJob(database, {
        id: 'roundtrip-export-job-' + archiveId + '-' + slice,
        name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { archiveId, slice }
      })
    await runExportSlice(0)
    for (let slice = 0; slice < 200; slice += 1) {
      const nextIndex = mocks.published.findIndex(
        (message) =>
          message.name === EXPORT_ACCOUNT_ARCHIVE_JOB_NAME &&
          (message.data as { archiveId?: string; action?: string })
            .archiveId === archiveId &&
          !(message.data as { action?: string }).action
      )
      if (nextIndex < 0) break
      const [message] = mocks.published.splice(nextIndex, 1)
      await runExportSlice((message.data as { slice: number }).slice)
    }
    const exported = (await database.getAccountArchive({ id: archiveId }))!
    expect(exported.status).toBe('ready')
    const archiveBytes = await fs.readFile(
      mocks.storageRoot + '/media/' + exported.storagePath
    )

    const importId = 'roundtrip-import-' + randomUUID()
    const importRow = await database.createAccountImport({
      id: importId,
      accountId: targetActor.account!.id,
      actorId: targetActor.id,
      options: '{"profile":true,"settings":true}'
    })
    await importObjectStore.store.put(
      importObjectStore.getUploadKey(importRow),
      archiveBytes
    )
    await database.updateAccountImport({
      id: importId,
      uploadedBytes: archiveBytes.length,
      status: 'running',
      phase: 'inspect'
    })
    mocks.published.length = 0
    const runImport = () =>
      importAccountArchiveJob(database, {
        id: 'roundtrip-import-job-' + randomUUID(),
        name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { importId, actorId: targetActor.id }
      })
    await runImport()
    for (let slice = 0; slice < 100; slice += 1) {
      const nextIndex = mocks.published.findIndex(
        (message) =>
          message.name === IMPORT_ACCOUNT_ARCHIVE_JOB_NAME &&
          (message.data as { importId?: string }).importId === importId
      )
      if (nextIndex < 0) break
      mocks.published.splice(nextIndex, 1)
      await runImport()
    }

    const completed = await database.getAccountImport({
      id: importId,
      actorId: targetActor.id
    })
    expect(completed?.status).toBe('done')
    const importedActor = (await database.getActorFromId({
      id: targetActor.id
    }))!
    expect(importedActor).toMatchObject({
      name: 'Round trip profile name',
      summary: 'Round trip profile bio'
    })
    expect(importedActor.fields).toHaveLength(1)
    expect(importedActor.fields?.[0]?.value ?? '').toContain('source.example')
    expect(
      await database.getActorSettings({ actorId: targetActor.id })
    ).toMatchObject({
      defaultPrivacy: 'private',
      defaultSensitive: true,
      defaultLanguage: 'sl',
      readingExpandSpoilers: true,
      discoverable: false
    })
    const items = await database.getAccountImportItems({ importId, limit: 100 })
    const targetStatusId = items.find(
      (item) => item.kind === 'status' && item.sourceId === statusId
    )?.targetId
    const targetMediaId = items.find(
      (item) => item.kind === 'own-media'
    )?.targetId
    const targetAlbumId = items.find((item) => item.kind === 'album')?.targetId
    const targetFitnessFileId = items.find(
      (item) => item.kind === 'fitness-file'
    )?.targetId
    expect(targetStatusId).toBeTruthy()
    expect(targetMediaId).toBeTruthy()
    expect(targetAlbumId).toBeTruthy()
    expect(targetFitnessFileId).toBeTruthy()

    const sourceStatusEntity = await database.getStatus({
      statusId: sourceStatus.id
    })
    const targetStatusEntity = await database.getStatus({
      statusId: targetStatusId!
    })
    if (
      !sourceStatusEntity ||
      !targetStatusEntity ||
      sourceStatusEntity.type === 'Announce' ||
      targetStatusEntity.type === 'Announce'
    ) {
      throw new Error('round-trip status missing or not a note')
    }
    expect(targetStatusEntity.text).toBe(sourceStatusEntity.text)
    expect(getVisibility(sourceStatusEntity!.to, sourceStatusEntity!.cc)).toBe(
      getVisibility(targetStatusEntity!.to, targetStatusEntity!.cc)
    )

    const targetAttachment = await db
      .selectFrom('attachments')
      .selectAll()
      .where('statusId', '=', targetStatusId!)
      .executeTakeFirst()
    expect(String(targetAttachment?.mediaId)).toBe(targetMediaId)
    expect(
      await db
        .selectFrom('medias')
        .select('id')
        .where('actorId', '=', targetActor.id)
        .execute()
    ).toHaveLength(mediaBefore.length + 1)
    const targetMedia = await db
      .selectFrom('medias')
      .selectAll()
      .where('id', '=', Number(targetMediaId))
      .executeTakeFirst()
    expect(targetMedia).toMatchObject({
      description: 'A bright bird',
      subjectName: 'Kingfisher',
      subjectScientificName: 'Alcedo atthis',
      subjectCategory: 'bird',
      placeName: 'Ljubljana',
      placeLatitude: 46.0569,
      placeLongitude: 14.5058,
      placeCountryCode: 'SI',
      placePrecision: 'area',
      placeNameSource: 'owner',
      subjectTaxonKey: '2492',
      subjectTaxonPath: JSON.stringify(['Animalia', 'Chordata', 'Aves']),
      subjectIucnCategory: 'LC',
      subjectLookupStatus: 'resolved',
      placeLookupStatus: 'resolved',
      blurhash: 'round-trip-blurhash',
      focusX: 0.2,
      focusY: -0.1
    })
    expect(Boolean(targetMedia?.inGallery)).toBe(true)
    expect(targetMedia?.galleryAddedAt).not.toBeNull()
    const importedGalleryGearId = items.find(
      (item) => item.kind === 'gallery-gear'
    )?.targetId
    expect(targetMedia?.cameraGearId).toBe(importedGalleryGearId)
    expect(
      await database.getGallerySettings({ actorId: targetActor.id })
    ).toMatchObject({ galleryDefault: 'always' })

    const albumItems = await db
      .selectFrom('gallery_album_items')
      .select('mediaId')
      .where('albumId', '=', targetAlbumId!)
      .execute()
    expect(albumItems.map((row) => String(row.mediaId))).toEqual([
      targetMediaId
    ])
    const targetFitnessFile = await db
      .selectFrom('fitness_files')
      .select(['statusId', 'gearId', 'activityType', 'totalDistanceMeters'])
      .where('id', '=', targetFitnessFileId!)
      .executeTakeFirst()
    expect(targetFitnessFile).toMatchObject({
      statusId: targetStatusId,
      activityType: 'ride',
      totalDistanceMeters: 12_345
    })
    const importedFitnessGearId = items.find(
      (item) => item.kind === 'fitness-gear'
    )?.targetId
    expect(targetFitnessFile?.gearId).toBe(importedFitnessGearId)
    expect(mocks.published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ProcessFitnessFileJob',
          data: expect.objectContaining({
            statusId: targetStatusId,
            fitnessFileId: targetFitnessFileId,
            publishSendNote: false,
            notifyOnComplete: false
          })
        })
      ])
    )
  })
})
