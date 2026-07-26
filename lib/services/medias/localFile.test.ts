import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import sharp from 'sharp'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import { extractVideoMeta } from '@/lib/services/medias/extractVideoMeta'
import { Actor } from '@/lib/types/domain/actor'

import { MAX_HEIGHT, MAX_WIDTH } from './constants'
import { MediaValidationError } from './errors'
import { LocalFileStorage } from './localFile'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@/lib/services/medias/extractVideoMeta', () => ({
  extractVideoMeta: vi.fn()
}))

vi.mock('@/lib/services/medias/extractVideoImage', () => ({
  extractVideoImage: vi.fn()
}))

// A real 1x1 PNG, so the preview branch runs sharp for real rather than against
// a stand-in the production code could never receive: `extractVideoImage`
// resolves a frame or rejects, never null.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('LocalFileStorage.getFile', () => {
  let tempDir: string
  let mediaRoot: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activities-media-'))
    mediaRoot = path.join(tempDir, 'media')
    await fs.mkdir(mediaRoot)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const createStorage = () =>
    new LocalFileStorage(
      {
        type: MediaStorageType.LocalFile,
        path: mediaRoot
      },
      'llun.test',
      {} as Database
    )

  it('reads files inside the media root', async () => {
    await fs.writeFile(path.join(mediaRoot, 'avatar.png'), 'image-data')

    const result = await createStorage().getFile('avatar.png')

    expect(result).toMatchObject({
      type: 'buffer',
      contentType: 'image/png'
    })
    expect(result?.type === 'buffer' ? result.buffer.toString() : null).toBe(
      'image-data'
    )
  })

  it('returns null when a relative path escapes the media root', async () => {
    await fs.mkdir(path.join(mediaRoot, 'nested'))
    await fs.writeFile(path.join(tempDir, 'secret.png'), 'secret-data')

    const result = await createStorage().getFile('nested/../../secret.png')

    expect(result).toBeNull()
  })

  it('returns null when an absolute path escapes the media root', async () => {
    const outsidePath = path.join(tempDir, 'absolute-secret.png')
    await fs.writeFile(outsidePath, 'secret-data')

    const result = await createStorage().getFile(outsidePath)

    expect(result).toBeNull()
  })
})

describe('LocalFileStorage image output format', () => {
  let tempDir: string
  let mediaRoot: string

  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor

  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getStorageUsageForAccount: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  const createPngFile = async (name = 'route-map.png') => {
    const buffer = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: { r: 255, g: 59, b: 48 }
      }
    })
      .png()
      .toBuffer()
    return new File([new Uint8Array(buffer)], name, { type: 'image/png' })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activities-media-'))
    mediaRoot = path.join(tempDir, 'media')
    await fs.mkdir(mediaRoot)

    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createMedia.mockImplementation((async (params: unknown) => ({
      id: 'media-1',
      actorId: actor.id,
      ...(params as object)
    })) as never)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const createStorage = () =>
    new LocalFileStorage(
      { type: MediaStorageType.LocalFile, path: mediaRoot },
      'llun.test',
      database
    )

  const readStored = async (storedPath: string) =>
    sharp(await fs.readFile(path.join(mediaRoot, storedPath))).metadata()

  const readStoredFormat = async (storedPath: string) =>
    (await readStored(storedPath)).format

  it('stores uploads as webp by default', async () => {
    const stored = await createStorage().saveFile(actor, {
      file: await createPngFile()
    })

    const storedPath = vi.mocked(database.createMedia).mock.calls[0][0].original
      .path
    expect(storedPath).toMatch(/\.webp$/)
    expect(await readStoredFormat(storedPath)).toBe('webp')
    expect(stored?.url).toBe(`https://llun.test/api/v1/files/${storedPath}`)
  })

  it('stores a jpeg rendition without creating a media row', async () => {
    const rendition = await createStorage().saveImageRendition(
      actor,
      await createPngFile(),
      'jpeg'
    )

    expect(rendition?.mimeType).toBe('image/jpeg')
    expect(rendition?.path).toMatch(/\.jpg$/)
    expect(rendition?.url).toBe(
      `https://llun.test/api/v1/files/${rendition?.path}`
    )
    expect(await readStoredFormat(rendition!.path)).toBe('jpeg')
    expect(database.createMedia).not.toHaveBeenCalled()

    // The reported size and dimensions describe the file that was WRITTEN, not
    // the image that came in — the same reason saveThumbnail reads outputInfo.
    const stored = await readStored(rendition!.path)
    expect(rendition?.bytes).toBe(
      (await fs.stat(path.join(mediaRoot, rendition!.path))).size
    )
    expect(rendition?.metaData).toEqual({
      width: stored.width,
      height: stored.height
    })
  })

  it('stores a webp rendition when webp is requested', async () => {
    const rendition = await createStorage().saveImageRendition(
      actor,
      await createPngFile(),
      'webp'
    )

    expect(rendition?.mimeType).toBe('image/webp')
    expect(rendition?.path).toMatch(/\.webp$/)
    expect(await readStoredFormat(rendition!.path)).toBe('webp')
  })

  it('returns null when the rendition input is not an image', async () => {
    const rendition = await createStorage().saveImageRendition(
      actor,
      new File(['not-an-image'], 'route.tcx', {
        type: 'application/vnd.garmin.tcx+xml'
      }),
      'jpeg'
    )

    expect(rendition).toBeNull()
  })

  it('rejects a rendition that would exceed the account quota', async () => {
    database.getStorageUsageForAccount.mockResolvedValue(Number.MAX_SAFE_INTEGER)

    await expect(
      createStorage().saveImageRendition(actor, await createPngFile(), 'jpeg')
    ).rejects.toThrow(MediaValidationError)
    expect(await fs.readdir(mediaRoot)).toEqual([])
  })
})

describe('LocalFileStorage.saveFile image sizing', () => {
  let tempDir: string
  let mediaRoot: string

  const actor = { id: 'actor-1' } as Actor

  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getStorageUsageForAccount: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activities-media-'))
    mediaRoot = path.join(tempDir, 'media')
    await fs.mkdir(mediaRoot)

    database.getActorFromId.mockResolvedValue({
      id: 'actor-1',
      account: { id: 'account-1' }
    } as never)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createMedia.mockImplementation((async (params: unknown) => ({
      id: 'media-1',
      ...(params as object)
    })) as never)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const createStorage = () =>
    new LocalFileStorage(
      {
        type: MediaStorageType.LocalFile,
        path: mediaRoot
      },
      'llun.test',
      database
    )

  const createPngFile = async (width: number, height: number) => {
    const buffer = await sharp({
      create: { width, height, channels: 3, background: '#3366cc' }
    })
      .png()
      .toBuffer()
    return new File([new Uint8Array(buffer)], 'route-map.png', {
      type: 'image/png'
    })
  }

  // Thumbnails are written alongside the original as `<prefix>-thumbnail.webp`,
  // so each helper has to pick out the file it means.
  const readStored = async (kind: 'original' | 'thumbnail') => {
    const files = await fs.readdir(mediaRoot)
    const match = files.find(
      (file) => file.endsWith('-thumbnail.webp') === (kind === 'thumbnail')
    )
    if (!match) throw new Error(`No stored ${kind} in [${files.join(', ')}]`)
    return sharp(await fs.readFile(path.join(mediaRoot, match))).metadata()
  }

  const readStoredImage = () => readStored('original')

  // Regression: `fit: 'inside'` enlarges by default, so the MAX_WIDTH/MAX_HEIGHT
  // box was an upscale rather than a cap — an 800x600 route map was stored as a
  // 4000x3000 WebP, at a size no surface ever displays. Asserting on the bytes
  // actually written is what catches it: `original.metaData` is read from the
  // INPUT image, so it reported 800x600 either way.
  it.each([
    {
      description: 'stores an image below the cap at its own dimensions',
      source: { width: 800, height: 600 },
      stored: { width: 800, height: 600 }
    },
    {
      description: 'scales an image above the cap down to fit',
      source: { width: MAX_WIDTH + 200, height: (MAX_HEIGHT + 200) / 2 },
      stored: { width: MAX_WIDTH, height: MAX_HEIGHT / 2 }
    }
  ])('$description', async ({ source, stored }) => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(source.width, source.height)
    })

    await expect(readStoredImage()).resolves.toMatchObject(stored)
  })

  // The thumbnail path is where the upscale reached the database: unlike the
  // original, `thumbnail.metaData`/`bytes` come from `outputInfo` — the stored
  // WebP — so an upscaled thumbnail was reported as 4000x3000 in the Mastodon
  // attachment's `meta.small` and charged to the account's storage quota.
  it('records the thumbnail dimensions actually stored', async () => {
    const thumbnail = await createStorage().saveThumbnail(
      actor,
      await createPngFile(800, 600)
    )

    expect(thumbnail?.metaData).toEqual({ width: 800, height: 600 })
    await expect(readStored('thumbnail')).resolves.toMatchObject({
      width: 800,
      height: 600
    })
  })

  it('reports the stored thumbnail as meta.small on the attachment', async () => {
    const attachment = await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600),
      thumbnail: await createPngFile(400, 300)
    })

    expect(attachment?.meta.small).toMatchObject({
      width: 400,
      height: 300
    })
  })
})

describe('LocalFileStorage.saveFile with a video', () => {
  let tempDir: string
  let mediaRoot: string

  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor

  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn(),
    getStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activities-media-'))
    mediaRoot = path.join(tempDir, 'media')
    await fs.mkdir(mediaRoot)

    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createMedia.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'clip.mp4',
        bytes: 11,
        mimeType: 'video/mp4',
        metaData: { width: 10, height: 10 },
        fileName: 'clip.mp4'
      }
    } as never)
    vi.mocked(extractVideoMeta).mockResolvedValue({
      streams: [{ codec_type: 'video', width: 10, height: 10 }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
    })
    vi.mocked(extractVideoImage).mockResolvedValue(ONE_PIXEL_PNG)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const createStorage = () =>
    new LocalFileStorage(
      {
        type: MediaStorageType.LocalFile,
        path: mediaRoot
      },
      'llun.test',
      database
    )

  // A guard, not a regression: this driver always built its path from a
  // generated prefix plus an extension, and `path.extname` can never return a
  // separator, so a supplied name never reached the path here. The traversal
  // was in the S3 driver's temp file. Keep the guard so that stays true.
  it('keeps a traversing file name inside the media root', async () => {
    const file = new File([Buffer.from('video-bytes')], '../../evil.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    const storedPath = vi.mocked(database.createMedia).mock.calls[0][0].original
      .path
    expect(storedPath).toMatch(/^[0-9a-f]{16}\.mp4$/)
    // The video plus the WebP thumbnail rendered from the preview frame.
    const stored = await fs.readdir(mediaRoot)
    expect(stored).toContain(storedPath)
    expect(stored).toHaveLength(2)
  })

  it('stores a sanitized original file name', async () => {
    const file = new File([Buffer.from('video-bytes')], '/etc/cron.d/evil.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        original: expect.objectContaining({ fileName: 'evil.mp4' })
      })
    )
  })

  it('derives the stored extension from the content type', async () => {
    const file = new File([Buffer.from('video-bytes')], 'MOVIE.MOV', {
      type: 'video/quicktime'
    })

    await createStorage().saveFile(actor, { file })

    // `endsWith('.mov')` used to miss the uppercase spelling and store the file
    // as `.MOV`, which local `getFile` then served as `video/quicktime`.
    const storedPath = vi.mocked(database.createMedia).mock.calls[0][0].original
      .path
    expect(storedPath).toMatch(/^[0-9a-f]{16}\.mp4$/)
  })
})

