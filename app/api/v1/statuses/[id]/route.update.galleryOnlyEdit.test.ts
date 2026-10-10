import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Media } from '@/lib/types/database/operations'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
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

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

// An edit of the post (alt text, focal point, text, or adding, removing or
// reordering photos) must leave every photo it already shows on the file the
// post shows: a photo edited "Gallery only" keeps its earlier file in the post
// until an "Update posts" save.
describe('PUT /api/v1/statuses/[id] after a Gallery-only edit', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let accountId = ''

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const fileUrl = (path: string) => `https://llun.test/api/v1/files/${path}`

  const createPhoto = async (name: string) =>
    (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `medias/${name}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 300 }
      },
      description: `${name} alt`,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: 0.1, y: 0.2 }
    }))!

  const editGalleryOnly = async (media: Media, name: string) => {
    const result = await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: `gallery-only-${name}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: `medias/${name}-render.webp`,
        bytes: 200,
        mimeType: 'image/webp',
        width: 300,
        height: 300,
        blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
        focus: { x: -0.9, y: 0.9 }
      }
    })
    if (result.status !== 'ok') throw new Error('edit failed')
  }

  const put = (statusId: string, body: unknown) =>
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

  const createPost = async (slug: string, medias: Media[]) => {
    const statusId = `${ACTOR1_ID}/statuses/${slug}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Photos',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    for (const [index, media] of medias.entries()) {
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: fileUrl(media.original.path),
        width: 400,
        height: 300,
        name: media.description ?? '',
        mediaId: media.id,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focus: { x: 0.1, y: 0.2 },
        createdAt: Date.now() + index
      })
    }
    return statusId
  }

  const attachmentOf = async (statusId: string, media: Media) =>
    (await database.getAttachments({ statusId })).find(
      (item) => item.mediaId === media.id
    )

  // What the post published for a photo, without the row's timestamp.
  const publishedFile = async (statusId: string, media: Media) => {
    const attachment = await attachmentOf(statusId, media)
    if (!attachment) return undefined
    const { updatedAt: _updatedAt, ...rest } = attachment
    return rest
  }

  const expectOriginalFile = async (statusId: string, media: Media) =>
    expect(await attachmentOf(statusId, media)).toMatchObject({
      url: fileUrl(media.original.path),
      mediaType: 'image/jpeg',
      width: 400,
      height: 300,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: 0.1, y: 0.2 }
    })

  it('keeps each photo on the file the post shows', async () => {
    const x = await createPhoto('gallery-only-x')
    const y = await createPhoto('gallery-only-y')
    const statusId = `${ACTOR1_ID}/statuses/gallery-only-alt`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Two photos',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    for (const [index, media] of [x, y].entries()) {
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: fileUrl(media.original.path),
        width: 400,
        height: 300,
        name: media.description ?? '',
        mediaId: media.id,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focus: { x: 0.1, y: 0.2 },
        createdAt: Date.now() + index
      })
    }
    await editGalleryOnly(x, 'gallery-only-x')
    await editGalleryOnly(y, 'gallery-only-y')
    const before = await database.getAttachments({ statusId })

    const fixX = await put(statusId, {
      media_attributes: [{ id: x.id, description: 'Fixed alt for X' }]
    })
    expect(fixX.status).toBe(200)
    const fixY = await put(statusId, {
      media_attributes: [{ id: y.id, description: 'Fixed alt for Y' }]
    })
    expect(fixY.status).toBe(200)

    const after = await database.getAttachments({ statusId })
    const pick = (list: typeof after, media: Media) =>
      list.find((item) => item.mediaId === media.id)!
    for (const media of [x, y]) {
      const { name: _beforeName, updatedAt: _b, ...kept } = pick(before, media)
      const { name: _afterName, updatedAt: _a, ...now } = pick(after, media)
      expect(now).toEqual(kept)
      expect(now).toMatchObject({
        url: fileUrl(media.original.path),
        mediaType: 'image/jpeg',
        width: 400,
        height: 300,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focus: { x: 0.1, y: 0.2 }
      })
    }
    expect(pick(after, x).name).toBe('Fixed alt for X')
    expect(pick(after, y).name).toBe('Fixed alt for Y')
  })

  // The composer sends `media_ids` whenever the photo list changes, and a
  // Mastodon client sends them on every edit.
  it('keeps a kept photo on the file the post shows when the composer removes another photo', async () => {
    const x = await createPhoto('remove-x')
    const y = await createPhoto('remove-y')
    const statusId = await createPost('gallery-only-remove', [x, y])
    await editGalleryOnly(x, 'remove-x')
    const before = await publishedFile(statusId, x)

    const response = await put(statusId, { media_ids: [x.id] })
    expect(response.status).toBe(200)

    expect(await publishedFile(statusId, x)).toEqual(before)
    await expectOriginalFile(statusId, x)
    expect(await attachmentOf(statusId, y)).toBeUndefined()
    const json = await response.json()
    expect(json.media_attachments).toHaveLength(1)
    expect(json.media_attachments[0].url).toBe(fileUrl(x.original.path))
  })

  it('keeps each photo on the file the post shows when the photos are reordered', async () => {
    const x = await createPhoto('reorder-x')
    const y = await createPhoto('reorder-y')
    const statusId = await createPost('gallery-only-reorder', [x, y])
    await editGalleryOnly(x, 'reorder-x')
    const before = await publishedFile(statusId, x)

    const response = await put(statusId, { media_ids: [y.id, x.id] })
    expect(response.status).toBe(200)

    expect(await publishedFile(statusId, x)).toEqual(before)
    await expectOriginalFile(statusId, x)
    await expectOriginalFile(statusId, y)
  })

  it('keeps each photo on the file the post shows through a Mastodon client text edit', async () => {
    const x = await createPhoto('client-x')
    const y = await createPhoto('client-y')
    const statusId = await createPost('gallery-only-client', [x, y])
    await editGalleryOnly(x, 'client-x')
    await editGalleryOnly(y, 'client-y')

    const response = await put(statusId, {
      status: 'Fixed a typo',
      media_ids: [x.id, y.id]
    })
    expect(response.status).toBe(200)

    await expectOriginalFile(statusId, x)
    await expectOriginalFile(statusId, y)
  })

  it('gives a photo new to the post its live file and keeps the others', async () => {
    const x = await createPhoto('add-x')
    const z = await createPhoto('add-z')
    const statusId = await createPost('gallery-only-add', [x])
    await editGalleryOnly(x, 'add-x')
    await editGalleryOnly(z, 'add-z')

    const response = await put(statusId, { media_ids: [x.id, z.id] })
    expect(response.status).toBe(200)

    await expectOriginalFile(statusId, x)
    expect(await attachmentOf(statusId, z)).toMatchObject({
      url: fileUrl('medias/add-z-render.webp'),
      mediaType: 'image/webp',
      width: 300,
      height: 300,
      blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
      focus: { x: -0.9, y: 0.9 }
    })
  })

  // The client drew the point on the image the post shows, the earlier file,
  // so it belongs to that attachment and not to the render's media row.
  it('sets a focal point on the post`s earlier file and leaves the render`s alone', async () => {
    const x = await createPhoto('focus-x')
    const y = await createPhoto('focus-y')
    const statusId = await createPost('gallery-only-focus', [x, y])
    await editGalleryOnly(x, 'focus-x')
    const attachmentId = (await attachmentOf(statusId, x))!.id

    const response = await put(statusId, {
      media_attributes: [{ id: attachmentId, focus: '0.5,-0.25' }]
    })
    expect(response.status).toBe(200)

    expect(await attachmentOf(statusId, x)).toMatchObject({
      url: fileUrl(x.original.path),
      mediaType: 'image/jpeg',
      width: 400,
      height: 300,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: 0.5, y: -0.25 }
    })
    await expectOriginalFile(statusId, y)
    const media = await database.getMediaByIdForAccount({
      mediaId: x.id,
      accountId
    })
    expect(media?.focus).toEqual({ x: -0.9, y: 0.9 })
    const json = await response.json()
    const published = json.media_attachments.find(
      (item: { id: string }) => item.id === attachmentId
    )
    expect(published.meta.focus).toEqual({ x: 0.5, y: -0.25 })
  })

  it('still sets the focal point on the media row of a photo the post shows live', async () => {
    const x = await createPhoto('focus-live-x')
    const statusId = await createPost('gallery-only-focus-live', [x])

    const response = await put(statusId, {
      media_attributes: [{ id: x.id, focus: '0.3,0.4' }]
    })
    expect(response.status).toBe(200)

    expect((await attachmentOf(statusId, x))?.focus).toEqual({
      x: 0.3,
      y: 0.4
    })
    const media = await database.getMediaByIdForAccount({
      mediaId: x.id,
      accountId
    })
    expect(media?.focus).toEqual({ x: 0.3, y: 0.4 })
  })
})
