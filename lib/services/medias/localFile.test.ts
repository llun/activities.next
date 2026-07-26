import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import sharp from 'sharp'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
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

  const readStoredImage = async () => {
    const files = await fs.readdir(mediaRoot)
    expect(files).toHaveLength(1)
    return sharp(await fs.readFile(path.join(mediaRoot, files[0]))).metadata()
  }

  // Regression: `fit: 'inside'` enlarges by default, so every image below the
  // 4000x4000 cap was upscaled to fill it — an 800x600 route map was stored as
  // a 4000x3000 WebP roughly 7x the source's bytes, and no surface ever
  // displayed it at that size.
  it('stores an image below the cap at its original dimensions', async () => {
    const attachment = await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600)
    })

    await expect(readStoredImage()).resolves.toMatchObject({
      width: 800,
      height: 600
    })
    expect(attachment?.meta.original).toMatchObject({
      width: 800,
      height: 600
    })
  })

  it('scales an image above the cap down to fit', async () => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(MAX_WIDTH + 200, (MAX_HEIGHT + 200) / 2)
    })

    await expect(readStoredImage()).resolves.toMatchObject({
      width: MAX_WIDTH,
      height: MAX_HEIGHT / 2
    })
  })
})
