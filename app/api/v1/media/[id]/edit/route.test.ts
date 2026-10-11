import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { getPhotoEditorConfig } from '@/lib/config'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { deleteMediaFile, getMediaStorage } from '@/lib/services/medias'
import { Mask, NEUTRAL_RECIPE, Recipe } from '@/lib/services/medias/edit/recipe'
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
  getPhotoEditorConfig: vi.fn(),
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

// A one-channel mask in the source's shape (400x300 → 1024x768).
const maskPng = (width = 1024, height = 768) =>
  sharp({
    create: { width, height, channels: 3, background: '#ffffff' }
  })
    .extractChannel(0)
    .png()
    .toBuffer()

const SUBJECT: Mask = {
  id: 'subj0001',
  kind: 'subject',
  points: [{ x: 0.5, y: 0.5, label: 1 }],
  feather: 10,
  adjustments: { exposure: 0.3 }
}
const BACKGROUND: Mask = {
  id: 'back0001',
  kind: 'background',
  of: SUBJECT.id,
  points: [],
  feather: 0,
  adjustments: { saturation: -20 }
}
const BRUSH: Mask = {
  id: 'brush001',
  kind: 'brush',
  points: [],
  feather: 0,
  adjustments: { contrast: 10 }
}

const SUBJECT_MODEL = {
  baseUrl: 'https://models.example.com/slimsam/',
  files: {
    encoder: {
      path: 'onnx/vision_encoder_quantized.onnx',
      bytes: 8882165,
      sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971'
    },
    decoder: {
      path: 'onnx/prompt_encoder_mask_decoder_quantized.onnx',
      bytes: 4903810,
      sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2'
    }
  }
}

const RECIPE: Recipe = {
  ...NEUTRAL_RECIPE,
  adjustments: { exposure: 0.5 }
}
// A second save must change the picture, or it is answered as a no-op.
const NEXT_RECIPE: Recipe = {
  ...NEUTRAL_RECIPE,
  adjustments: { exposure: 0.75 }
}

describe('/api/v1/media/[id]/edit', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  const saveEditedImage = vi.fn()
  const saveMaskImage = vi.fn()
  let source: Buffer
  let mask: Buffer
  let render: Buffer

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    source = await jpeg(SOURCE_WIDTH, SOURCE_HEIGHT)
    render = await jpeg(SOURCE_WIDTH, SOURCE_HEIGHT)
    mask = await maskPng()
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  let renders = 0
  let masks = 0
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPhotoEditorConfig).mockReturnValue({
      subjectModel: null,
      connectOrigins: [],
      enhance: null
    })
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
      saveEditedImage,
      saveMaskImage
    } as unknown as ReturnType<typeof getMediaStorage>)
    saveMaskImage.mockImplementation(async () => {
      masks += 1
      return {
        path: `medias/mask-${masks}.png`,
        bytes: 40,
        mimeType: 'image/png',
        width: 1024,
        height: 768
      }
    })
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
      masks?: Record<string, Buffer | File>
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
    for (const [id, part] of Object.entries(fields.masks ?? {})) {
      form.set(
        `mask_${id}`,
        part instanceof File
          ? part
          : new File([new Uint8Array(part)], `${id}.png`, { type: 'image/png' })
      )
    }
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

    // The row records the uploaded size; a presigned upload's stored file is
    // the client's own bytes and may be larger than the row says.
    it('answers 422 when the decoded source is over 50 MP', async () => {
      const huge = await sharp({
        create: { width: 8000, height: 7000, channels: 3, background: '#000' }
      })
        .jpeg({ quality: 10 })
        .toBuffer()
      vi.mocked(readStoredImage).mockResolvedValue({
        buffer: huge,
        mimeType: 'image/jpeg'
      })
      const id = await createMediaFor(ACTOR1_ID)

      const response = await get(id)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: "This media can't be edited"
      })
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
        base_version: '1',
        recipe: JSON.stringify(NEXT_RECIPE)
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
        version: 2,
        accountId: await accountId()
      })
      expect(deleteMediaFile).toHaveBeenCalledWith(database, firstRender)
      const slots = (await database.listMediaEditFiles({ mediaIds: [id] })).map(
        (file) => file.slot
      )
      expect(slots).toEqual(['original'])
    })

    // The prune runs once the posts are updated, which can take seconds. A
    // "Gallery only" save that commits meanwhile supersedes this save's render
    // precisely so that the posts this save just updated keep showing it.
    it('keeps its render when a "gallery" save lands while the posts update', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const statusId = await postWithMedia(id)
      vi.mocked(refreshPostsForEditedMedia).mockImplementationOnce(async () => {
        await database.applyMediaEdit({
          mediaId: id,
          accountId: await accountId(),
          baseVersion: 1,
          saveId: 'other-tab',
          recipe: JSON.stringify(RECIPE),
          render: {
            path: 'medias/other-tab.webp',
            bytes: 10,
            mimeType: 'image/webp',
            width: SOURCE_WIDTH,
            height: SOURCE_HEIGHT,
            blurhash: null,
            focus: null
          }
        })
        return { updated: [statusId], skipped: [] }
      })

      const response = await save(id, { apply_to_posts: 'update' })

      expect(response.status).toBe(200)
      const ownRender = `medias/render-${renders}.webp`
      expect(deleteMediaFile).not.toHaveBeenCalled()
      const files = await database.listMediaEditFiles({ mediaIds: [id] })
      expect(files.map((file) => file.path)).toContain(ownRender)
    })

    it('answers a recipe that only changes the aspect preset as saved, storing nothing', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const statusId = await postWithMedia(id)
      vi.mocked(refreshPostsForEditedMedia).mockResolvedValue({
        updated: [statusId],
        skipped: []
      })
      const saveId = crypto.randomUUID()
      expect(
        (await save(id, { apply_to_posts: 'update', save_id: saveId })).status
      ).toBe(200)
      vi.mocked(saveEditedImage).mockClear()
      vi.mocked(refreshPostsForEditedMedia).mockClear()

      // 1:1 picked and then Original again: same crop, another preset label.
      const response = await save(id, {
        recipe: JSON.stringify({
          ...RECIPE,
          geometry: { ...RECIPE.geometry, aspect: 'free' }
        }),
        base_version: '1'
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.edit).toMatchObject({ version: 1, recipe: RECIPE, saveId })
      expect(body.posts).toEqual({ updated: [], skipped: [] })
      expect(saveEditedImage).not.toHaveBeenCalled()
      expect(refreshPostsForEditedMedia).not.toHaveBeenCalled()
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
        base_version: '1',
        recipe: JSON.stringify(NEXT_RECIPE)
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
      await save(id, {
        apply_to_posts: 'update',
        base_version: '1',
        recipe: JSON.stringify(NEXT_RECIPE)
      })

      expect(deleteMediaFile).not.toHaveBeenCalled()
      const slots = (await database.listMediaEditFiles({ mediaIds: [id] })).map(
        (file) => file.slot.split(':')[0]
      )
      expect(slots.sort()).toEqual(['original', 'superseded'])
    })
  })

  describe('enhance capability', () => {
    const ENHANCE = {
      endpoint: 'https://vision.example.com/v1/chat/completions',
      apiKey: 'sk-test',
      model: 'vision-1'
    }
    const configured = () =>
      vi.mocked(getPhotoEditorConfig).mockReturnValue({
        subjectModel: null,
        connectOrigins: [],
        enhance: ENHANCE
      })

    afterEach(async () => {
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        photoEnhance: true
      })
    })

    it('is available, with the model, when the server has one and the switch is on', async () => {
      configured()
      const id = await createMediaFor(ACTOR1_ID)

      const body = await (await get(id)).json()

      expect(body.capabilities.enhance).toEqual({
        available: true,
        model: 'vision-1'
      })
    })

    it('is off when the owner switched AI enhance off', async () => {
      configured()
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        photoEnhance: false
      })
      const id = await createMediaFor(ACTOR1_ID)

      const body = await (await get(id)).json()

      expect(body.capabilities.enhance).toEqual({
        available: false,
        model: null
      })
    })

    it('follows the switch of the actor the person acts as, not the photo owner’s', async () => {
      configured()
      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const second = await database.createActorForAccount({
        accountId: actor!.account!.id,
        username: 'second-enhance',
        domain: 'llun.test',
        privateKey: 'private',
        publicKey: 'public'
      })
      const id = await createMediaFor(second)
      await database.updateGallerySettings({
        actorId: second,
        photoEnhance: false
      })

      expect((await (await get(id)).json()).capabilities.enhance).toEqual({
        available: true,
        model: 'vision-1'
      })

      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        photoEnhance: false
      })
      await database.updateGallerySettings({
        actorId: second,
        photoEnhance: true
      })

      expect((await (await get(id)).json()).capabilities.enhance).toEqual({
        available: false,
        model: null
      })
    })

    it('never leaks the endpoint or the key', async () => {
      configured()
      const id = await createMediaFor(ACTOR1_ID)

      const text = await (await get(id)).text()

      expect(text).not.toContain(ENHANCE.apiKey)
      expect(text).not.toContain(ENHANCE.endpoint)
    })

    it('is on the save response too', async () => {
      configured()
      const id = await createMediaFor(ACTOR1_ID)

      const response = await save(id)

      expect(response.status).toBe(200)
      expect((await response.json()).capabilities.enhance).toEqual({
        available: true,
        model: 'vision-1'
      })
    })
  })

  describe('masks', () => {
    const withMasks = (...items: Mask[]): Recipe => ({
      ...RECIPE,
      masks: items
    })
    const slotsOf = async (id: string) =>
      (await database.listMediaEditFiles({ mediaIds: [id] }))
        .filter((file) => file.slot.startsWith('mask:'))
        .map((file) => [file.slot, file.path])
    const maskUrl = (mediaId: string, maskId: string) =>
      expect.stringMatching(
        new RegExp(
          `^/api/v1/media/${mediaId}/edit/masks/${maskId}\\?v=[0-9a-f-]{36}$`
        )
      )

    it('answers the subject model the config offers', async () => {
      vi.mocked(getPhotoEditorConfig).mockReturnValue({
        subjectModel: SUBJECT_MODEL,
        connectOrigins: ['https://models.example.com'],
        enhance: null
      })
      const id = await createMediaFor(ACTOR1_ID)

      const body = await (await get(id)).json()

      expect(body.capabilities).toEqual({
        subjectModel: SUBJECT_MODEL,
        enhance: { available: false, model: null }
      })
    })

    it('stores a new subject mask, counts it in the quota, and lists it', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const recipe = withMasks(SUBJECT, BACKGROUND)

      const response = await save(id, {
        recipe: JSON.stringify(recipe),
        masks: { [SUBJECT.id]: mask }
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.edit.recipe).toEqual(recipe)
      // The background mask is the subject's inverse and has no image.
      expect(body.edit.masks).toEqual([
        { id: SUBJECT.id, url: maskUrl(id, SUBJECT.id) }
      ])
      expect(checkQuotaAvailable).toHaveBeenCalledWith(
        database,
        expect.objectContaining({ id: ACTOR1_ID }),
        render.length + mask.length
      )
      expect(saveMaskImage).toHaveBeenCalledTimes(1)
      expect(saveMaskImage).toHaveBeenCalledWith({
        actor: expect.objectContaining({ id: ACTOR1_ID }),
        buffer: expect.any(Buffer)
      })
      expect(await slotsOf(id)).toEqual([
        [`mask:${SUBJECT.id}`, `medias/mask-${masks}.png`]
      ])
      expect((await (await get(id)).json()).edit.masks).toEqual(body.edit.masks)
    })

    it.each([
      ['a subject mask', SUBJECT],
      ['a brush mask', BRUSH]
    ])('answers 422 for %s without its image', async (_, item) => {
      const id = await createMediaFor(ACTOR1_ID)

      const response = await save(id, {
        recipe: JSON.stringify(withMasks(item))
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Missing mask image' })
      expect(saveEditedImage).not.toHaveBeenCalled()
      expect(saveMaskImage).not.toHaveBeenCalled()
    })

    it('answers a mask with no adjustment as saved, storing nothing and editing no post', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const statusId = await postWithMedia(id)
      vi.mocked(refreshPostsForEditedMedia).mockResolvedValue({
        updated: [statusId],
        skipped: []
      })
      await save(id, { apply_to_posts: 'update' })
      vi.mocked(saveEditedImage).mockClear()
      saveMaskImage.mockClear()
      vi.mocked(refreshPostsForEditedMedia).mockClear()

      // A brush mask and a subject mask (with its background) with every
      // slider at zero draw nothing, so the render is the same picture.
      const response = await save(id, {
        recipe: JSON.stringify(
          withMasks(
            { ...BRUSH, adjustments: {} },
            { ...SUBJECT, adjustments: { exposure: 0 } }
          )
        ),
        base_version: '1',
        apply_to_posts: 'update',
        masks: { [BRUSH.id]: mask, [SUBJECT.id]: mask }
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.edit.version).toBe(1)
      expect(body.edit.recipe).toEqual(RECIPE)
      expect(body.posts).toEqual({ updated: [], skipped: [] })
      expect(saveEditedImage).not.toHaveBeenCalled()
      expect(saveMaskImage).not.toHaveBeenCalled()
      expect(refreshPostsForEditedMedia).not.toHaveBeenCalled()
      expect(await slotsOf(id)).toEqual([])
    })

    it('still renders when a mask part is for a subject only its background adjusts', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      await save(id)
      vi.mocked(saveEditedImage).mockClear()

      const response = await save(id, {
        recipe: JSON.stringify(
          withMasks({ ...SUBJECT, adjustments: {} }, BACKGROUND)
        ),
        base_version: '1',
        masks: { [SUBJECT.id]: mask }
      })

      expect(response.status).toBe(200)
      expect((await response.json()).edit.version).toBe(2)
      expect(saveEditedImage).toHaveBeenCalledTimes(1)
    })

    it('keeps a stored mask whose image did not change', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: { [SUBJECT.id]: mask }
      })
      const stored = await slotsOf(id)
      saveMaskImage.mockClear()

      const response = await save(id, {
        base_version: '1',
        recipe: JSON.stringify(
          withMasks({ ...SUBJECT, adjustments: { exposure: 0.6 } })
        )
      })

      expect(response.status).toBe(200)
      expect(saveMaskImage).not.toHaveBeenCalled()
      expect(await slotsOf(id)).toEqual(stored)
      expect(deleteMediaFile).not.toHaveBeenCalledWith(database, stored[0][1])
    })

    it('replaces a changed mask and deletes the old file after the commit', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      const first = await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: { [SUBJECT.id]: mask }
      })
      const firstUrl = (await first.json()).edit.masks[0].url
      const oldPath = `medias/mask-${masks}.png`

      // Same recipe, new pixels: a brush refinement of the subject.
      const response = await save(id, {
        base_version: '1',
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: { [SUBJECT.id]: mask }
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.edit.version).toBe(2)
      expect(body.edit.masks[0].url).not.toBe(firstUrl)
      expect(await slotsOf(id)).toEqual([
        [`mask:${SUBJECT.id}`, `medias/mask-${masks}.png`]
      ])
      expect(deleteMediaFile).toHaveBeenCalledWith(database, oldPath)
    })

    it('removes the mask a recipe dropped and deletes its file', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT, BRUSH)),
        masks: { [SUBJECT.id]: mask, [BRUSH.id]: mask }
      })
      // The files of one save can share a created_at, so look them up by slot.
      const slots = await slotsOf(id)
      const subjectSlot = slots.find(([slot]) => slot === `mask:${SUBJECT.id}`)!
      const brushSlot = slots.find(([slot]) => slot === `mask:${BRUSH.id}`)!
      const usageBefore = await database.getStorageUsageForAccount({
        accountId: await accountId()
      })

      const response = await save(id, {
        base_version: '1',
        recipe: JSON.stringify(withMasks(SUBJECT))
      })

      expect(response.status).toBe(200)
      expect((await response.json()).edit.masks).toEqual([
        { id: SUBJECT.id, url: maskUrl(id, SUBJECT.id) }
      ])
      expect(await slotsOf(id)).toEqual([subjectSlot])
      expect(deleteMediaFile).toHaveBeenCalledWith(database, brushSlot[1])
      expect(deleteMediaFile).not.toHaveBeenCalledWith(database, subjectSlot[1])
      // The new 500-byte render is counted, the 40-byte mask is freed, and
      // the superseded render (no post shows it) is pruned.
      expect(
        await database.getStorageUsageForAccount({
          accountId: await accountId()
        })
      ).toBe(usageBefore + 500 - 40 - 500)
    })

    it.each([
      ['a background mask', BACKGROUND.id, withMasks(SUBJECT, BACKGROUND)],
      ['a mask the recipe does not have', 'zzzz9999', withMasks(SUBJECT)]
    ])('answers 422 for an image of %s', async (_, maskId, recipe) => {
      const id = await createMediaFor(ACTOR1_ID)

      const response = await save(id, {
        recipe: JSON.stringify(recipe),
        masks: { [SUBJECT.id]: mask, [maskId]: mask }
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'Unexpected mask image'
      })
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it.each([
      ['a JPEG part', async () => ({ type: 'image/jpeg' })],
      ['a mask id that is not 8 characters', async () => ({ id: 'ABC' })],
      ['bytes that are not a PNG', async () => ({ bytes: render })],
      [
        'a mask over 1024 px',
        async () => ({ bytes: await maskPng(2048, 1536) })
      ],
      [
        'a mask of another shape',
        async () => ({ bytes: await maskPng(1024, 1024) })
      ]
    ])('answers 422 for %s', async (_, make) => {
      const options: { type?: string; id?: string; bytes?: Buffer } =
        await make()
      const id = await createMediaFor(ACTOR1_ID)

      const response = await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: {
          [options.id ?? SUBJECT.id]: new File(
            [new Uint8Array(options.bytes ?? mask)],
            'mask.png',
            { type: options.type ?? 'image/png' }
          )
        }
      })

      expect(response.status).toBe(422)
      expect(saveEditedImage).not.toHaveBeenCalled()
      expect(saveMaskImage).not.toHaveBeenCalled()
    })

    it('accepts a smaller mask in the source shape', async () => {
      const id = await createMediaFor(ACTOR1_ID)

      const response = await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: { [SUBJECT.id]: await maskPng(400, 300) }
      })

      expect(response.status).toBe(200)
    })

    it('answers 413 for a mask part over 2 MiB', async () => {
      const id = await createMediaFor(ACTOR1_ID)

      const response = await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: {
          [SUBJECT.id]: new File(
            [new Uint8Array(2 * 1024 * 1024 + 1)],
            'mask.png',
            { type: 'image/png' }
          )
        }
      })

      expect(response.status).toBe(413)
      expect(saveEditedImage).not.toHaveBeenCalled()
    })

    it('answers 413 when the render and the masks together do not fit the quota', async () => {
      vi.mocked(checkQuotaAvailable).mockImplementation(
        async (_database, _actor, bytes) => ({
          // Room for the render, not for the render and its mask.
          available: bytes <= render.length,
          used: 0,
          limit: render.length
        })
      )
      const id = await createMediaFor(ACTOR1_ID)

      const response = await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: { [SUBJECT.id]: mask }
      })

      expect(response.status).toBe(413)
      expect(saveEditedImage).not.toHaveBeenCalled()
      expect(saveMaskImage).not.toHaveBeenCalled()
    })

    it('deletes the masks it stored when another save lands first, and keeps the stored ones', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      await save(id, {
        recipe: JSON.stringify(withMasks(SUBJECT)),
        masks: { [SUBJECT.id]: mask }
      })
      const stored = await slotsOf(id)
      vi.mocked(deleteMediaFile).mockClear()
      saveEditedImage.mockImplementationOnce(async () => {
        await database.applyMediaEdit({
          mediaId: id,
          accountId: await accountId(),
          baseVersion: 1,
          saveId: 'other-tab',
          recipe: JSON.stringify(withMasks(SUBJECT)),
          render: {
            path: 'medias/other-tab-render.webp',
            bytes: 10,
            mimeType: 'image/webp',
            width: SOURCE_WIDTH,
            height: SOURCE_HEIGHT,
            blurhash: null,
            focus: null
          },
          masks: [{ id: SUBJECT.id, image: null }]
        })
        return {
          path: 'medias/lost-render.webp',
          bytes: 500,
          mimeType: 'image/webp',
          width: SOURCE_WIDTH,
          height: SOURCE_HEIGHT,
          blurhash: null,
          focus: null
        }
      })

      const response = await save(id, {
        base_version: '1',
        recipe: JSON.stringify(withMasks(SUBJECT, BRUSH)),
        masks: { [BRUSH.id]: mask }
      })

      expect(response.status).toBe(409)
      expect(deleteMediaFile).toHaveBeenCalledWith(
        database,
        'medias/lost-render.webp'
      )
      expect(deleteMediaFile).toHaveBeenCalledWith(
        database,
        `medias/mask-${masks}.png`
      )
      expect(deleteMediaFile).not.toHaveBeenCalledWith(database, stored[0][1])
      expect(await slotsOf(id)).toEqual(stored)
    })

    it('stores a new mask image even when the recipe is unchanged', async () => {
      const id = await createMediaFor(ACTOR1_ID)
      await save(id, {
        recipe: JSON.stringify(withMasks(BRUSH)),
        masks: { [BRUSH.id]: mask }
      })
      saveEditedImage.mockClear()

      const response = await save(id, {
        base_version: '1',
        recipe: JSON.stringify(withMasks(BRUSH)),
        masks: { [BRUSH.id]: mask }
      })

      expect(response.status).toBe(200)
      expect((await response.json()).edit.version).toBe(2)
      expect(saveEditedImage).toHaveBeenCalledTimes(1)
    })
  })
})
