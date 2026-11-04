import { NextRequest } from 'next/server'

import { getRouteMapAttachmentIndex } from '@/app/(timeline)/[actor]/[status]/ActivityPostFrame'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  ROUTE_MAP_ATTACHMENT_NAME,
  findRouteMapAttachments
} from '@/lib/services/fitness-files/mapAttachments'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { refreshPostsForEditedMedia } from '@/lib/services/medias/edit/refreshPostsForEditedMedia'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { urlToId } from '@/lib/utils/urlToId'

import { PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', async () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/medias')>()),
  deleteMediaFile: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const OWNER_ALT_TEXT = 'Loop around the reservoir, clockwise'

// A fitness post edited after its route map was attached: whatever the edit,
// the map stays the map (isRouteMap), out of the activity's photos, first in
// the hydrated post and picked by the post frame, and its alt text is what
// the owner last set (the default name until they set one).
describe('PUT /api/v1/statuses/[id] keeps a fitness route map', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let accountId = ''

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
  })

  afterAll(async () => {
    mockDatabase = null
    await testDb.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createRide = async (label: string) => {
    const statusId = `${ACTOR1_ID}/statuses/route-map-${label}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Evening ride',
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${ACTOR1_ID}/followers`]
    })
    const mapImagePath = `medias/route-map-${label}.webp`
    const fitnessFileId = `route-map-fit-${label}`
    await testDb.db
      .insertInto('fitness_files')
      .values({
        id: fitnessFileId,
        actorId: ACTOR1_ID,
        statusId,
        path: `fitness/${fitnessFileId}.fit`,
        fileName: `${fitnessFileId}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1000,
        processingStatus: 'completed',
        isPrimary: true,
        hasMapData: true,
        mapImagePath
      })
      .execute()
    // As processFitnessFileJob stores it: no description on the media row
    // (route alt text was not generated), the name on the attachment only.
    const map = (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: mapImagePath,
        bytes: 2048,
        mimeType: 'image/webp',
        metaData: { width: 640, height: 480 }
      }
    }))!
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/webp',
      url: `https://llun.test/api/v1/files/${mapImagePath}`,
      width: 640,
      height: 480,
      name: ROUTE_MAP_ATTACHMENT_NAME,
      mediaId: map.id,
      isRouteMap: true,
      // Stored after the photo, so only the route map rules put it first.
      createdAt: Date.UTC(2026, 0, 1, 8, 0, 1)
    })
    const photo = (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `medias/route-map-${label}-photo.jpg`,
        bytes: 1024,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      },
      description: 'Bikes at the summit'
    }))!
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/api/v1/files/${photo.original.path}`,
      width: 320,
      height: 240,
      name: 'Bikes at the summit',
      mediaId: photo.id,
      createdAt: Date.UTC(2026, 0, 1, 8, 0, 0)
    })
    // Both in the gallery, so only the route map rule can leave the map out.
    await testDb.db
      .updateTable('medias')
      .set({ inGallery: true, galleryAddedAt: new Date() })
      .where('id', 'in', [Number(map.id), Number(photo.id)])
      .execute()
    return { statusId, mapImagePath, fitnessFileId, map, photo }
  }

  type Ride = Awaited<ReturnType<typeof createRide>>

  const edit = (statusId: string, body: unknown) =>
    PUT(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

  const expectRouteMap = async (ride: Ride, expectedName: string) => {
    const status = await database.getStatus({
      statusId: ride.statusId,
      withReplies: false
    })
    if (!status || status.type !== StatusType.enum.Note) {
      throw new Error('Expected note status')
    }
    const note = status as StatusNote
    const map = note.attachments.find(
      (attachment) => attachment.mediaId === ride.map.id
    )
    expect(map).toBeDefined()
    expect(map!.isRouteMap).toBe(true)
    expect(map!.name).toBe(expectedName)

    // Hydration puts the map first and the post frame picks it, without
    // leaning on the "first attachment of a file with map data" fallback.
    expect(note.attachments[0].id).toBe(map!.id)
    expect(getRouteMapAttachmentIndex(note.attachments, false)).toBe(0)

    // The gallery leaves it out of the activity's photos.
    const activityMedia = await database.getGalleryMedia({
      actorId: ACTOR1_ID,
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 10,
      filters: { activityId: ride.fitnessFileId }
    })
    expect(activityMedia.map((row) => row.media.id)).toEqual([ride.photo.id])

    // The map jobs still find it as the file's own map.
    const found = await findRouteMapAttachments({
      database,
      accountId,
      statusId: ride.statusId,
      mapImagePath: ride.mapImagePath
    })
    expect(found.map((attachment) => attachment.id)).toEqual([map!.id])

    // The alt text reaches clients and peers; the flag never does.
    const mastodon = await getMastodonStatus(database, status)
    const mastodonMap = mastodon?.media_attachments.find(
      (attachment) => attachment.id === map!.id
    )
    expect(mastodonMap?.description).toBe(expectedName)
    expect(JSON.stringify(mastodon)).not.toContain('isRouteMap')

    const federated = getNoteFromStatus(status)
    const federatedAttachments = Array.isArray(federated?.attachment)
      ? federated.attachment
      : []
    const federatedMap = federatedAttachments.find(
      (attachment) => 'url' in attachment && attachment.url === map!.url
    )
    expect(federatedMap?.name).toBe(expectedName)
    expect(JSON.stringify(federated)).not.toContain('isRouteMap')
  }

  it('keeps the map and its name when a client resends media_ids', async () => {
    const ride = await createRide('media-ids')

    const response = await edit(ride.statusId, {
      status: 'Evening ride, edited',
      media_ids: [ride.map.id, ride.photo.id]
    })

    expect(response.status).toBe(200)
    await expectRouteMap(ride, ROUTE_MAP_ATTACHMENT_NAME)
  })

  it('takes the alt text the owner sets through media_attributes', async () => {
    const ride = await createRide('media-attributes')

    const response = await edit(ride.statusId, {
      media_ids: [ride.map.id, ride.photo.id],
      media_attributes: [{ id: ride.map.id, description: OWNER_ALT_TEXT }]
    })

    expect(response.status).toBe(200)
    await expectRouteMap(ride, OWNER_ALT_TEXT)
  })

  it('takes the alt text the owner sets through media_attributes alone', async () => {
    const ride = await createRide('media-attributes-only')

    const response = await edit(ride.statusId, {
      media_attributes: [{ id: ride.map.id, description: OWNER_ALT_TEXT }]
    })

    expect(response.status).toBe(200)
    await expectRouteMap(ride, OWNER_ALT_TEXT)
  })

  it('flags the map again when an edit drops it and a later one puts it back', async () => {
    const ride = await createRide('re-added')
    const newPhoto = (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/route-map-re-added-extra.jpg',
        bytes: 1024,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      }
    }))!

    expect(
      (await edit(ride.statusId, { media_ids: [ride.photo.id] })).status
    ).toBe(200)
    // The map comes back with a photo new to the post: only the map is one.
    expect(
      (
        await edit(ride.statusId, {
          media_ids: [ride.map.id, ride.photo.id, newPhoto.id]
        })
      ).status
    ).toBe(200)

    // A media new to the post again: it takes the media row's (empty) alt
    // text, but it is the route map.
    await expectRouteMap(ride, '')
    const added = (
      await database.getAttachments({ statusId: ride.statusId })
    ).find((attachment) => attachment.mediaId === newPhoto.id)
    expect(added).toBeDefined()
    expect(added?.isRouteMap).toBeFalsy()
  })

  it('flags a map put back at its recorded url whatever its media row holds', async () => {
    const ride = await createRide('recorded-url')
    expect(
      (await edit(ride.statusId, { media_ids: [ride.photo.id] })).status
    ).toBe(200)
    // Neither the media's live file nor any edit file is the recorded path
    // any more; the url the map is put back at still is.
    await testDb.db
      .updateTable('medias')
      .set({ original: 'medias/route-map-recorded-url-moved.webp' })
      .where('id', '=', Number(ride.map.id))
      .execute()

    await database.updateNote({
      statusId: ride.statusId,
      text: 'Evening ride',
      summary: null,
      attachments: [
        {
          type: 'upload',
          id: ride.map.id,
          mediaType: 'image/webp',
          url: `https://llun.test/api/v1/files/${ride.mapImagePath}`,
          width: 640,
          height: 480,
          blurhash: null,
          focus: null,
          thumbnailUrl: null
        }
      ]
    })

    const map = (
      await database.getAttachments({ statusId: ride.statusId })
    ).find((attachment) => attachment.mediaId === ride.map.id)
    expect(map?.isRouteMap).toBe(true)
  })

  it('flags a re-rendered map put back after an edit dropped it', async () => {
    const ride = await createRide('re-rendered-re-added')
    const result = await database.applyMediaEdit({
      mediaId: ride.map.id,
      accountId,
      baseVersion: 0,
      saveId: `route-map-readd-${ride.map.id}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: 'medias/route-map-re-rendered-re-added-render.webp',
        bytes: 200,
        mimeType: 'image/webp',
        width: 640,
        height: 480,
        blurhash: null,
        focus: null
      }
    })
    if (result.status !== 'ok') throw new Error('edit failed')

    expect(
      (await edit(ride.statusId, { media_ids: [ride.photo.id] })).status
    ).toBe(200)
    expect(
      (
        await edit(ride.statusId, {
          media_ids: [ride.map.id, ride.photo.id]
        })
      ).status
    ).toBe(200)

    // It comes back on the render, which is no mapImagePath: the uploaded
    // original its edit keeps is what marks it.
    const status = (await database.getStatus({
      statusId: ride.statusId
    })) as StatusNote
    expect(
      status.attachments.find(
        (attachment) => attachment.mediaId === ride.map.id
      )?.url
    ).toBe(
      'https://llun.test/api/v1/files/medias/route-map-re-rendered-re-added-render.webp'
    )
    await expectRouteMap(ride, '')
  })

  it('leaves a new photo on the ride, and the map put on another post, unflagged', async () => {
    const ride = await createRide('new-photo')
    const newPhoto = (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/route-map-new-photo-extra.jpg',
        bytes: 1024,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      }
    }))!
    const otherStatusId = `${ACTOR1_ID}/statuses/route-map-other-post`
    await database.createNote({
      id: otherStatusId,
      url: otherStatusId,
      actorId: ACTOR1_ID,
      text: 'Not a ride',
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    expect(
      (
        await edit(ride.statusId, {
          media_ids: [ride.map.id, ride.photo.id, newPhoto.id]
        })
      ).status
    ).toBe(200)
    expect(
      (await edit(otherStatusId, { media_ids: [ride.map.id] })).status
    ).toBe(200)

    const flags = async (statusId: string) =>
      Object.fromEntries(
        (await database.getAttachments({ statusId })).map((attachment) => [
          attachment.mediaId,
          Boolean(attachment.isRouteMap)
        ])
      )
    expect(await flags(ride.statusId)).toEqual({
      [ride.map.id]: true,
      [ride.photo.id]: false,
      [newPhoto.id]: false
    })
    expect(await flags(otherStatusId)).toEqual({ [ride.map.id]: false })
  })

  it('keeps the stored order once the activity is deleted', async () => {
    const ride = await createRide('deleted-activity')
    await testDb.db
      .updateTable('fitness_files')
      .set({ deletedAt: new Date() })
      .where('id', '=', ride.fitnessFileId)
      .execute()

    const status = (await database.getStatus({
      statusId: ride.statusId
    })) as StatusNote

    expect(status.attachments.map((attachment) => attachment.mediaId)).toEqual([
      ride.photo.id,
      ride.map.id
    ])
  })

  it("flags a map put back under another url of its media's file", async () => {
    const ride = await createRide('other-url')
    expect(
      (await edit(ride.statusId, { media_ids: [ride.photo.id] })).status
    ).toBe(200)

    // Not the url the post showed, but the media's live file is still the
    // recorded map path.
    await database.updateNote({
      statusId: ride.statusId,
      text: 'Evening ride',
      summary: null,
      attachments: [
        {
          type: 'upload',
          id: ride.map.id,
          mediaType: 'image/webp',
          url: `https://llun.test/api/v1/files/${ride.mapImagePath}?v=2`,
          width: 640,
          height: 480,
          blurhash: null,
          focus: null,
          thumbnailUrl: null
        },
        {
          type: 'upload',
          id: ride.photo.id,
          mediaType: 'image/jpeg',
          url: `https://llun.test/api/v1/files/${ride.photo.original.path}`,
          width: 320,
          height: 240,
          name: 'Bikes at the summit',
          blurhash: null,
          focus: null,
          thumbnailUrl: null
        }
      ]
    })

    const map = (
      await database.getAttachments({ statusId: ride.statusId })
    ).find((attachment) => attachment.mediaId === ride.map.id)
    expect(map?.isRouteMap).toBe(true)
  })

  it('does not flag a map put back once the activity is deleted', async () => {
    const ride = await createRide('deleted-re-added')
    await testDb.db
      .updateTable('fitness_files')
      .set({ deletedAt: new Date() })
      .where('id', '=', ride.fitnessFileId)
      .execute()

    expect(
      (await edit(ride.statusId, { media_ids: [ride.photo.id] })).status
    ).toBe(200)
    expect(
      (
        await edit(ride.statusId, {
          media_ids: [ride.map.id, ride.photo.id]
        })
      ).status
    ).toBe(200)

    const map = (
      await database.getAttachments({ statusId: ride.statusId })
    ).find((attachment) => attachment.mediaId === ride.map.id)
    expect(map).toBeDefined()
    expect(map?.isRouteMap).toBeFalsy()
  })

  it('leads with the flagged map when the primary file records no map path', async () => {
    const ride = await createRide('no-map-path')
    await testDb.db
      .updateTable('fitness_files')
      .set({ mapImagePath: null })
      .where('id', '=', ride.fitnessFileId)
      .execute()

    const status = (await database.getStatus({
      statusId: ride.statusId
    })) as StatusNote

    expect(status.attachments.map((attachment) => attachment.mediaId)).toEqual([
      ride.map.id,
      ride.photo.id
    ])
  })

  it('keeps the map and its name when the photo editor updates the post', async () => {
    const ride = await createRide('photo-editor')

    const result = await database.applyMediaEdit({
      mediaId: ride.map.id,
      accountId,
      baseVersion: 0,
      saveId: `route-map-${ride.map.id}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: 'medias/route-map-photo-editor-render.webp',
        bytes: 200,
        mimeType: 'image/webp',
        width: 640,
        height: 480,
        blurhash: null,
        focus: null
      }
    })
    if (result.status !== 'ok') throw new Error('edit failed')
    const refreshed = await refreshPostsForEditedMedia({
      database,
      media: result.media,
      version: result.media.edit!.version,
      accountId
    })

    expect(refreshed).toEqual({ updated: [ride.statusId], skipped: [] })
    const status = (await database.getStatus({
      statusId: ride.statusId
    })) as StatusNote
    expect(
      status.attachments.find(
        (attachment) => attachment.mediaId === ride.map.id
      )?.url
    ).toBe(
      'https://llun.test/api/v1/files/medias/route-map-photo-editor-render.webp'
    )
    await expectRouteMap(ride, ROUTE_MAP_ATTACHMENT_NAME)
  })
})
