import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { deleteMediaFile, getMediaStorage } from '@/lib/services/medias'
import { NEUTRAL_RECIPE, Recipe } from '@/lib/services/medias/edit/recipe'
import { refreshPostsForEditedMedia } from '@/lib/services/medias/edit/refreshPostsForEditedMedia'
import { checkQuotaAvailable } from '@/lib/services/medias/quota'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({ where: () => ({ first: () => null }) })
}))

vi.mock('next/headers', () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const takeMock = vi.hoisted(() => vi.fn())
const counterOptions = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/services/gallery/lookups/rateLimit', async (importActual) => ({
  ...(await importActual<
    typeof import('@/lib/services/gallery/lookups/rateLimit')
  >()),
  createWindowCounter: (options: unknown) => {
    counterOptions.push(options)
    return { tryHit: takeMock, reset: vi.fn() }
  }
}))

vi.mock('@/lib/services/medias', () => ({
  getMediaStorage: vi.fn(),
  deleteMediaFile: vi.fn()
}))

vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))

vi.mock('@/lib/services/medias/quota', () => ({
  checkQuotaAvailable: vi.fn()
}))

vi.mock('@/lib/services/medias/uploadSizeLimit', () => ({
  exceedsMaxMediaUploadSize: vi.fn(async () => false)
}))

vi.mock(
  '@/lib/services/medias/edit/refreshPostsForEditedMedia',
  async (importActual) => ({
    ...(await importActual<
      typeof import('@/lib/services/medias/edit/refreshPostsForEditedMedia')
    >()),
    refreshPostsForEditedMedia: vi.fn()
  })
)

const SOURCE_WIDTH = 400
const SOURCE_HEIGHT = 300

const jpeg = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: '#336699' }
  })
    .jpeg()
    .toBuffer()

const RECIPE: Recipe = {
  ...NEUTRAL_RECIPE,
  adjustments: { exposure: 0.5 }
}

describe('/api/v1/media/[id]/edit', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  const saveEditedImage = vi.fn()
  let source: Buffer
  let render: Buffer

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    source = await jpeg(SOURCE_WIDTH, SOURCE_HEIGHT)
    render = await jpeg(SOURCE_WIDTH, SOURCE_HEIGHT)
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  let renders = 0
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    takeMock.mockReturnValue(true)
    vi.mocked(readStoredImage).mockImplementation(async () => ({
      buffer: source,
      mimeType: 'image/jpeg'
    }))
    vi.mocked(checkQuotaAvailable).mockResolvedValue({
      available: true,
      used: 0,
      limit: 1_000_000
    })
    vi.mocked(deleteMediaFile).mockResolvedValue(true)
    vi.mocked(getMediaStorage).mockReturnValue({
      saveEditedImage
    } as unknown as ReturnType<typeof getMediaStorage>)
    saveEditedImage.mockImplementation(async () => {
      renders += 1
      return {
        path: `medias/render-${renders}.webp`,
        bytes: 500,
        mimeType: 'image/webp',
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
        blurhash: null,
        focus: null
      }
    })
    vi.mocked(refreshPostsForEditedMedia).mockResolvedValue({
      updated: [],
      skipped: []
    })
  })

  const accountId = async () =>
    (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id

  let counter = 0
  const createMediaFor = async (
    actorId: string,
    { mimeType = 'image/jpeg' }: { mimeType?: string } = {}
  ) => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/edit-${counter}.jpg`,
        bytes: 1000,
        mimeType,
        metaData: { width: SOURCE_WIDTH, height: SOURCE_HEIGHT }
      }
    })
    return media!.id
  }

  const postWithMedia = async (mediaId: string) => {
    counter += 1
    const statusId = `${ACTOR1_ID}/statuses/edit-post-${counter}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'A post with a photo'
    })
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/api/v1/files/medias/edit-${counter}.jpg`,
      width: SOURCE_WIDTH,
      height: SOURCE_HEIGHT,
      mediaId
    })
    return statusId
  }

  const get = (id: string) =>
    GET(
      new NextRequest(`https://llun.test/api/v1/media/${id}/edit`, {
        headers: { origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ id }) }
    )

  const save = (
    id: string,
    fields: {
      file?: Buffer | null
      type?: string
      recipe?: string
      base_version?: string
      save_id?: string
      apply_to_posts?: string
      focus?: string
    } = {}
  ) => {
    const form = new FormData()
    const file = fields.file === undefined ? render : fields.file
    if (file) {
      form.set(
        'file',
        new File([new Uint8Array(file)], 'edit.jpg', {
          type: fields.type ?? 'image/jpeg'
        })
      )
    }
    form.set('recipe', fields.recipe ?? JSON.stringify(RECIPE))
    form.set('base_version', fields.base_version ?? '0')
    form.set('save_id', fields.save_id ?? crypto.randomUUID())
    if (fields.apply_to_posts) form.set('apply_to_posts', fields.apply_to_posts)
    if (fields.focus) form.set('focus', fields.focus)
    return POST(
      new NextRequest(`https://llun.test/api/v1/media/${id}/edit`, {
        method: 'POST',
        headers: { origin: 'https://llun.test' },
        body: form
      }),
      { params: Promise.resolve({ id }) }
    )
  }

  it('builds its rate limit as 60 saves an hour', () => {
    expect(counterOptions).toContainEqual({ limit: 60, windowMs: 3_600_000 })
  })

  describe('GET', () => {
    it('answers 401 without a session', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const id = await createMediaFor(ACTOR1_ID)
      expect((await get(id)).status).toBe(401)
    })

    it('answers 404 for a media of another account', async () => {
      const id = await createMediaFor(ACTOR2_ID)
      const response = await get(id)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Record not found' })
    })

    it('answers 422 for a video', async () => {
      const id = await createMediaFor(ACTOR1_ID, { mimeType: 'video/mp4' })
      const response = await get(id)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: "This media can't be edited"
      })
    })

    it('answers 422 when the source cannot be read', async () => {
      vi.mocked(readStoredImage).mockResolvedValue(null)
      const id = await createMediaFor(ACTOR1_ID)
      expect((await get(id)).status).toBe(422)
    })

    it('returns the edit state of an unedited photo', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const statusId = await postWithMedia(id)
      const status = await database.getStatus({ statusId })

      const response = await get(id)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({
        media: expect.objectContaining({
          id,
          details: expect.objectContaining({
            edit: { version: 0, editedAt: null }
          })
        }),
        edit: {
          version: 0,
          recipe: null,
          editedAt: null,
          saveId: null,
          source: {
            width: SOURCE_WIDTH,
            height: SOURCE_HEIGHT,
            mimeType: 'image/jpeg'
          },
          masks: []
        },
        usage: {
          statusCount: 1,
          latestStatusAt: new Date(status!.createdAt).toISOString()
        },
        capabilities: {
          subjectModel: null,
          enhance: { available: false, model: null }
        }
      })
      expect(readStoredImage).toHaveBeenCalledWith(
        database,
        `medias/edit-${Number(counter) - 1}.jpg`,
        100 * 1024 * 1024
      )
    })
  })

  describe('POST', () => {
    it('answers 401 without a session', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const id = await createMediaFor(ACTOR1_ID)
      expect((await save(id)).status).toBe(401)
    })

    it('answers 404 for a media of another account', async () => {
      const id = await createMediaFor(ACTOR2_ID)
      const response = await save(id)
      expect(response.status).toBe(404)
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it('answers 422 for a video', async () => {
      const id = await createMediaFor(ACTOR1_ID, { mimeType: 'video/mp4' })
      expect((await save(id)).status).toBe(422)
    })

    it.each([
      ['no file', { file: null }],
      ['a GIF file', { type: 'image/gif' }],
      ['a recipe that is not JSON', { recipe: '{' }],
      ['a neutral recipe', { recipe: JSON.stringify(NEUTRAL_RECIPE) }],
      ['a negative base version', { base_version: '-1' }],
      ['a save id that is not a uuid', { save_id: 'nope' }],
      ['an out-of-range focus', { focus: '2,0' }],
      ['an unknown apply_to_posts', { apply_to_posts: 'both' }]
    ])('answers 422 for %s', async (_, fields) => {
      const id = await createMediaFor(ACTOR1_ID)
      const response = await save(id, fields)
      expect(response.status).toBe(422)
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it('answers 422 when the render does not match the recipe size', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const response = await save(id, { file: await jpeg(200, 150) })
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'Edited image size does not match the recipe'
      })
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it('answers 413 when the render does not fit the quota', async () => {
      vi.mocked(checkQuotaAvailable).mockResolvedValue({
        available: false,
        used: 1_000_000,
        limit: 1_000_000
      })
      const id = await createMediaFor(ACTOR1_ID)
      const response = await save(id)
      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({
        error: 'Not enough storage left for the edited photo'
      })
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it('answers 429 once the hourly limit is used up', async () => {
      takeMock.mockReturnValue(false)
      const id = await createMediaFor(ACTOR1_ID)
      const response = await save(id)
      expect(response.status).toBe(429)
      expect(await response.json()).toEqual({
        error: 'Too many edits. Try again later.'
      })
      expect(takeMock).toHaveBeenCalledWith(ACTOR1_ID)
    })

    it('saves the render and answers the new edit state', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const saveId = crypto.randomUUID()

      const response = await save(id, { save_id: saveId, focus: '0.5,-0.5' })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.edit).toEqual({
        version: 1,
        recipe: RECIPE,
        editedAt: expect.any(String),
        saveId,
        source: {
          width: SOURCE_WIDTH,
          height: SOURCE_HEIGHT,
          mimeType: 'image/jpeg'
        },
        masks: []
      })
      expect(body.media.url).toBe(
        `https://llun.test/api/v1/files/medias/render-${renders}.webp`
      )
      expect(body.media.details.edit).toEqual({
        version: 1,
        editedAt: body.edit.editedAt
      })
      expect(body.usage).toEqual({ statusCount: 0, latestStatusAt: null })
      expect(body.posts).toEqual({ updated: [], skipped: [] })
      expect(saveEditedImage).toHaveBeenCalledWith({
        actor: expect.objectContaining({ id: ACTOR1_ID }),
        buffer: expect.any(Buffer),
        manualFocus: { x: 0.5, y: -0.5 }
      })
      expect(refreshPostsForEditedMedia).not.toHaveBeenCalled()
    })

    it('answers 409 stale with the save id that landed, and deletes nothing it did not store', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const saveId = crypto.randomUUID()
      expect((await save(id, { save_id: saveId })).status).toBe(200)
      vi.mocked(saveEditedImage).mockClear()

      // The client lost the answer and sends the same save again.
      const retry = await save(id, { save_id: saveId })

      expect(retry.status).toBe(409)
      expect(await retry.json()).toEqual({
        error: 'stale',
        edit: { version: 1, saveId }
      })
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it('deletes the stored render when another save lands first', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const competing = crypto.randomUUID()
      saveEditedImage.mockImplementationOnce(async () => {
        // Another tab saves while this render is being stored.
        await database.applyMediaEdit({
          mediaId: id,
          accountId: await accountId(),
          baseVersion: 0,
          saveId: competing,
          recipe: JSON.stringify(RECIPE),
          render: {
            path: 'medias/competing.webp',
            bytes: 10,
            mimeType: 'image/webp',
            width: SOURCE_WIDTH,
            height: SOURCE_HEIGHT,
            blurhash: null,
            focus: null
          }
        })
        return {
          path: 'medias/lost.webp',
          bytes: 500,
          mimeType: 'image/webp',
          width: SOURCE_WIDTH,
          height: SOURCE_HEIGHT,
          blurhash: null,
          focus: null
        }
      })

      const response = await save(id)

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: 'stale',
        edit: { version: 1, saveId: competing }
      })
      expect(deleteMediaFile).toHaveBeenCalledWith(database, 'medias/lost.webp')
    })

    it('requires apply_to_posts when the photo is in a post', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      await postWithMedia(id)

      const response = await save(id)

      expect(response.status).toBe(422)
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it('updates the posts and prunes the earlier render on "update"', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const statusId = await postWithMedia(id)
      vi.mocked(refreshPostsForEditedMedia).mockResolvedValue({
        updated: [statusId],
        skipped: []
      })

      const first = await save(id, { apply_to_posts: 'update' })
      expect(first.status).toBe(200)
      const firstRender = `medias/render-${renders}.webp`
      const second = await save(id, {
        apply_to_posts: 'update',
        base_version: '1'
      })

      expect(second.status).toBe(200)
      expect((await second.json()).posts).toEqual({
        updated: [statusId],
        skipped: []
      })
      expect(refreshPostsForEditedMedia).toHaveBeenCalledTimes(2)
      expect(refreshPostsForEditedMedia).toHaveBeenLastCalledWith({
        database,
        media: expect.objectContaining({ id }),
        accountId: await accountId()
      })
      expect(deleteMediaFile).toHaveBeenCalledWith(database, firstRender)
      const slots = (await database.listMediaEditFiles({ mediaIds: [id] })).map(
        (file) => file.slot
      )
      expect(slots).toEqual(['original'])
    })

    it('keeps the earlier render on "gallery", which a post still shows', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      await postWithMedia(id)

      await save(id, { apply_to_posts: 'gallery' })
      const firstRender = `medias/render-${renders}.webp`
      const second = await save(id, {
        apply_to_posts: 'gallery',
        base_version: '1'
      })

      expect(second.status).toBe(200)
      expect((await second.json()).posts).toEqual({ updated: [], skipped: [] })
      expect(refreshPostsForEditedMedia).not.toHaveBeenCalled()
      expect(deleteMediaFile).not.toHaveBeenCalled()
      const files = await database.listMediaEditFiles({ mediaIds: [id] })
      expect(files.map((file) => file.path)).toContain(firstRender)
    })

    it('keeps superseded renders when a post could not be updated', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const statusId = await postWithMedia(id)
      vi.mocked(refreshPostsForEditedMedia).mockResolvedValue({
        updated: [],
        skipped: [statusId]
      })

      await save(id, { apply_to_posts: 'update' })
      await save(id, { apply_to_posts: 'update', base_version: '1' })

      expect(deleteMediaFile).not.toHaveBeenCalled()
      const slots = (await database.listMediaEditFiles({ mediaIds: [id] })).map(
        (file) => file.slot.split(':')[0]
      )
      expect(slots.sort()).toEqual(['original', 'superseded'])
    })
  })
})
