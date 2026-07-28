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
import { getQuotaLimit } from './quota'

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
    database.getStorageUsageForAccount.mockResolvedValue(
      Number.MAX_SAFE_INTEGER
    )

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

  const readStoredThumbnail = async () => {
    const files = await fs.readdir(mediaRoot)
    const match = files.find((file) => file.endsWith('-thumbnail.webp'))
    if (!match) throw new Error(`No stored thumbnail in [${files.join(', ')}]`)
    return sharp(await fs.readFile(path.join(mediaRoot, match))).metadata()
  }

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
    const file = new File(
      [Buffer.from('video-bytes')],
      '/etc/cron.d/evil.mp4',
      {
        type: 'video/mp4'
      }
    )

    await createStorage().saveFile(actor, { file })

    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        original: expect.objectContaining({ fileName: 'evil.mp4' })
      })
    )
  })

  // Regression: the video was written into the media root and the preview frame
  // extracted from it only afterwards, so a clip ffmpeg cannot decode left the
  // bytes on disk with no `medias` row — and a row is the only handle anything
  // but `scripts/maintenance/cleanupMediaStorage.ts` has on a stored path. The
  // S3 driver never had the gap: it extracts from its temp file before it
  // uploads, so a failed extraction stores nothing.
  it('stores nothing when the preview frame cannot be extracted', async () => {
    vi.mocked(extractVideoImage).mockRejectedValue(new Error('ffmpeg failed'))
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    // The extraction's own error, not a `MediaValidationError`: a storage-side
    // fault stays a logged 500 rather than the 422 a client will not retry.
    await expect(createStorage().saveFile(actor, { file })).rejects.toThrow(
      'ffmpeg failed'
    )

    expect(await fs.readdir(mediaRoot)).toEqual([])
    expect(database.createMedia).not.toHaveBeenCalled()
    // Nor may the temp copy the extraction read outlive the failure.
    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    await expect(fs.access(tempPath)).rejects.toThrow()
  })

  it('removes the temp video once probing finishes', async () => {
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    await expect(fs.access(tempPath)).rejects.toThrow()
  })

  // The temp copy is built from the supplied name, so it needs the entry-point
  // guard the S3 driver already has: `path.join` resolves `..`, and it takes
  // three of them to escape — the first is absorbed by the random prefix's own
  // segment, which is why the separator between prefix and name is load-bearing.
  it('writes the temp video inside the temp directory for a traversing name', async () => {
    const file = new File(
      [Buffer.from('video-bytes')],
      '../../../../etc/cron.d/evil.mp4',
      { type: 'video/mp4' }
    )

    await createStorage().saveFile(actor, { file })

    expect(extractVideoImage).toHaveBeenCalledTimes(1)
    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    expect(path.resolve(path.dirname(tempPath))).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(tempPath)).toMatch(/^[0-9a-f]{16}-evil\.mp4$/)
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

  // Which of the two thumbnail sources wins was untested on this driver, so the
  // precedence could be inverted here — reintroducing exactly the bug the S3
  // driver had — with nothing failing. The file count matters as much as the
  // dimensions: a variant that writes both and then picks one leaves the loser
  // on disk with no `medias` row to reclaim it by.
  it.each([
    {
      description:
        'prefers a caller-supplied thumbnail over the extracted video frame',
      suppliedThumbnail: { width: 400, height: 300 },
      stored: { width: 400, height: 300 }
    },
    {
      description:
        'falls back to the extracted video frame when no thumbnail is supplied',
      suppliedThumbnail: null,
      // The mocked `extractVideoImage` frame.
      stored: { width: 1, height: 1 }
    }
  ])('$description', async ({ suppliedThumbnail, stored }) => {
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, {
      file,
      ...(suppliedThumbnail
        ? {
            thumbnail: await createPngFile(
              suppliedThumbnail.width,
              suppliedThumbnail.height
            )
          }
        : null)
    })

    // The video plus exactly one thumbnail — the losing source is not written.
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(2)
    await expect(readStoredThumbnail()).resolves.toMatchObject(stored)
  })
})

// Mirrors `S3StorageFile.test.ts`'s block of the same name: a thumbnail
// uploaded beside the file is client input on both drivers, and the two must
// answer it identically.
describe('LocalFileStorage.saveFile with a caller-supplied thumbnail', () => {
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

  // A PNG with an intact header and a missing body: it passes the cheap header
  // check and only fails once the encoder reaches the bytes that are not there.
  const createTruncatedPngFile = async (width: number, height: number) => {
    const file = await createPngFile(width, height)
    const bytes = new Uint8Array(await file.arrayBuffer())
    return new File(
      [bytes.subarray(0, Math.floor(bytes.length * 0.6))],
      'cut.png',
      {
        type: 'image/png'
      }
    )
  }

  // The dedicated thumbnail endpoint (PUT /api/v1/media/:id) has to answer the
  // same bytes the same way — it used to reach sharp unguarded and 500.
  it('refuses unreadable bytes on the standalone thumbnail path', async () => {
    const thumbnail = new File([Buffer.from('not-an-image')], 'evil.png', {
      type: 'image/png'
    })

    await expect(
      createStorage().saveThumbnail(actor, thumbnail)
    ).rejects.toThrow(MediaValidationError)
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(0)
  })

  // `MediaSchema.thumbnail` accepts every ACCEPTED_FILE_TYPES entry, videos
  // included. Reaching sharp with one rejects with a plain Error — a 500, not
  // the 422 every other bad upload gets — and by then the original is already
  // written with no `medias` row to reclaim it by.
  it('refuses a thumbnail that is not an image before storing anything', async () => {
    const thumbnail = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await expect(
      createStorage().saveFile(actor, {
        file: await createPngFile(800, 600),
        thumbnail
      })
    ).rejects.toThrow(MediaValidationError)
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(0)
    expect(database.createMedia).not.toHaveBeenCalled()
  })

  // `createMedia` meters the thumbnail's bytes too, so the pre-check has to
  // reserve for them — otherwise an upload that fits only without its thumbnail
  // is accepted and leaves the account over its quota.
  it('counts the thumbnail against the account quota', async () => {
    const file = await createPngFile(800, 600)
    const thumbnail = await createPngFile(400, 300)
    // Exactly enough room for the original on its own.
    database.getStorageUsageForAccount.mockResolvedValue(
      getQuotaLimit() - file.size
    )

    await expect(
      createStorage().saveFile(actor, { file, thumbnail })
    ).rejects.toThrow(MediaValidationError)
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(0)
    // The same upload without the thumbnail still fits, so the thumbnail's
    // bytes are what tipped it over.
    await expect(
      createStorage().saveFile(actor, { file })
    ).resolves.toBeTruthy()
  })

  // The case a header parse would let through: the driver has to decode the
  // thumbnail fully before it stores the original, or the encoder is the first
  // thing to notice and the caller gets a 500 for its own corrupt bytes.
  it('refuses a truncated thumbnail before storing anything', async () => {
    await expect(
      createStorage().saveFile(actor, {
        file: await createPngFile(800, 600),
        thumbnail: await createTruncatedPngFile(400, 300)
      })
    ).rejects.toThrow(MediaValidationError)
    expect(database.createMedia).not.toHaveBeenCalled()
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(0)
  })

  it('refuses truncated bytes on the standalone thumbnail path', async () => {
    await expect(
      createStorage().saveThumbnail(
        actor,
        await createTruncatedPngFile(400, 300)
      )
    ).rejects.toThrow(MediaValidationError)
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(0)
  })

  // The row is written last, so a database failure leaves both files stored and
  // unreferenced — the same reclaim as a missing row.
  it('reclaims both stored files when the media row write fails', async () => {
    database.createMedia.mockRejectedValue(new Error('deadlock detected'))

    await expect(
      createStorage().saveFile(actor, {
        file: await createPngFile(800, 600),
        thumbnail: await createPngFile(400, 300)
      })
    ).rejects.toThrow('deadlock detected')
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(0)
  })

  // A row is the only handle anything else has on these paths, so without one
  // both stored files are unreachable.
  it('reclaims both stored files when the media row cannot be created', async () => {
    database.createMedia.mockResolvedValue(null as never)

    await expect(
      createStorage().saveFile(actor, {
        file: await createPngFile(800, 600),
        thumbnail: await createPngFile(400, 300)
      })
    ).rejects.toThrow('Fail to store media')
    await expect(fs.readdir(mediaRoot)).resolves.toHaveLength(0)
  })
})
