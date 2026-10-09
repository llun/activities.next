import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { RESOLVE_MEDIA_PLACE_JOB_NAME } from '@/lib/jobs/names'
import {
  PresignedUploadValidationError,
  S3FileStorage
} from '@/lib/services/medias/S3StorageFile'
import {
  ONE_PIXEL_PNG,
  arrangePresignedDefaults,
  createPresignedFixtures,
  readUploadBody
} from '@/lib/services/medias/S3StorageFile.helpers'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import { extractVideoMetaFromFile } from '@/lib/services/medias/extractVideoMeta'
import { StreamByteLimitError } from '@/lib/utils/streamLimit'

vi.mock('@aws-sdk/client-s3', () => {
  const makeCommand = (name: string) =>
    vi.fn().mockImplementation(function command(
      this: { input?: unknown; name?: string },
      input: unknown
    ) {
      this.input = input
      this.name = name
    })

  return {
    S3Client: vi.fn(),
    HeadObjectCommand: makeCommand('HeadObjectCommand'),
    DeleteObjectCommand: makeCommand('DeleteObjectCommand'),
    GetObjectCommand: makeCommand('GetObjectCommand'),
    PutObjectCommand: makeCommand('PutObjectCommand')
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://storage.example/upload')
}))

vi.mock('@/lib/services/medias/extractVideoMeta', () => ({
  extractVideoMeta: vi.fn(),
  extractVideoMetaFromFile: vi.fn()
}))

vi.mock('@/lib/services/medias/extractVideoImage', () => ({
  extractVideoImage: vi.fn()
}))

const mockGetConfig = vi.fn().mockReturnValue({})
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

const mockMaxUploadSize = vi.fn()
vi.mock('@/lib/services/medias/uploadSizeLimit', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/services/medias/uploadSizeLimit')>()
  return {
    ...actual,
    getMaxMediaUploadSize: (
      ...args: Parameters<typeof actual.getMaxMediaUploadSize>
    ) => mockMaxUploadSize(...args) ?? actual.getMaxMediaUploadSize(...args)
  }
})

// Lookups are published as jobs after verification; none runs in this suite.
const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

const mockGenerateAltText = vi.fn()
vi.mock('@/lib/services/altText/openai', () => ({
  generateAltText: (...args: unknown[]) => mockGenerateAltText(...args)
}))

describe('S3FileStorage presigned upload completion', () => {
  const fixtures = createPresignedFixtures()
  const { send, actor, checksumHex, checksumBase64, database } = fixtures

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({})
    mockGenerateAltText.mockReset()
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
    mockMaxUploadSize.mockReset()
    arrangePresignedDefaults(fixtures)
  })

  describe('upload details and metadata', () => {
    const createStorage = () =>
      new S3FileStorage(
        {
          type: MediaStorageType.ObjectStorage,
          bucket: 'bucket',
          region: 'us-east-1',
          endpoint: 'https://s3.example.com'
        },
        'llun.test',
        database
      )

    const gallery = database as unknown as {
      getGallerySettings: ReturnType<typeof vi.fn>
      findGalleryGearByDeviceKey: ReturnType<typeof vi.fn>
      createGalleryGearWithinLimit: ReturnType<typeof vi.fn>
      getGalleryGearNamesByIds: ReturnType<typeof vi.fn>
    }

    const settings = (overrides: Record<string, unknown> = {}) => ({
      autoDescribe: true,
      galleryDefault: 'never',
      defaultPlacePrecision: 'exact',
      ...overrides
    })

    // Wires one presigned upload of `body` through completion and returns the
    // PutObject bodies the driver sent.
    const completeUpload = async (
      body: Buffer,
      mimeType: string,
      fileName: string,
      options: { keepVerifyMock?: boolean; updateMediaRejects?: boolean } = {}
    ) => {
      const path = `medias/2026-01-01/${fileName}`
      const row = (state: 'pending' | 'verified') => ({
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path,
          bytes: body.length,
          mimeType,
          metaData: {
            width: 8,
            height: 8,
            upload: {
              state,
              checksumSha1: checksumHex,
              checksumSha1Base64: checksumBase64,
              contentType: mimeType,
              size: body.length
            }
          },
          fileName
        }
      })
      database.getMediaByIdForAccount.mockResolvedValue(row('pending') as never)
      if (!options.keepVerifyMock) {
        database.markMediaUploadVerified.mockResolvedValue({
          transitioned: true,
          media: row('verified')
        } as never)
      }
      if (options.updateMediaRejects) {
        database.updateMedia.mockRejectedValue(new Error('db down'))
      } else {
        database.updateMedia.mockImplementation((async () => ({
          media: row('verified')
        })) as never)
      }
      gallery.findGalleryGearByDeviceKey.mockResolvedValue(null)
      gallery.createGalleryGearWithinLimit.mockResolvedValue({
        status: 'created',
        gear: { id: 'gear-1' }
      })
      gallery.getGalleryGearNamesByIds.mockResolvedValue({})

      const puts: Buffer[] = []
      deletedKeys = []
      send.mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand) {
          return {
            ContentLength: body.length,
            ContentType: mimeType,
            Metadata: { checksumsha1: checksumHex }
          }
        }
        if (command instanceof GetObjectCommand) {
          return { Body: Readable.from([body]) }
        }
        if (command instanceof PutObjectCommand) {
          puts.push(readUploadBody(command.input.Body))
          return {}
        }
        if (command instanceof DeleteObjectCommand) {
          deletedKeys.push(command.input.Key as string)
          return {}
        }
        throw new Error('Unexpected command')
      })

      lastResult = await createStorage().completePresignedUpload(
        actor,
        'media-1'
      )
      return puts
    }
    let deletedKeys: string[] = []
    let lastResult: unknown = null
    const putKeys = () =>
      vi
        .mocked(PutObjectCommand)
        .mock.calls.map(([input]) => input.Key as string)

    const jpegWithExif = () =>
      sharp({
        create: { width: 8, height: 8, channels: 3, background: '#808080' }
      })
        .jpeg()
        .withExif({
          IFD0: { Make: 'Canon', Model: 'Canon EOS R5' },
          IFD2: { DateTimeOriginal: '2024:05:06 07:08:09' },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '51/1 30/1 0/1',
            GPSLongitudeRef: 'W',
            GPSLongitude: '0/1 7/1 30/1'
          }
        })
        .toBuffer()

    beforeEach(() => {
      gallery.getGallerySettings = vi.fn().mockResolvedValue(settings())
      gallery.findGalleryGearByDeviceKey = vi.fn()
      gallery.createGalleryGearWithinLimit = vi.fn()
      gallery.getGalleryGearNamesByIds = vi.fn()
    })

    it('persists the EXIF details read from the original bytes', async () => {
      gallery.getGallerySettings.mockResolvedValue(
        settings({ defaultPlacePrecision: 'area' })
      )
      await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg')

      expect(database.markMediaUploadVerified).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            inGallery: false,
            takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
            cameraGearId: 'gear-1',
            placeLatitude: 51.5,
            placeLongitude: -0.125,
            placePrecision: 'area'
          })
        })
      )
    })

    it('queues the place lookup for a photo with GPS, whatever its precision', async () => {
      gallery.getGallerySettings.mockResolvedValue(
        settings({ defaultPlacePrecision: 'hidden' })
      )
      database.markMediaUploadVerified.mockClear()

      await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg')

      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith({
        id: expect.stringMatching(/^[0-9a-f]{64}$/),
        name: RESOLVE_MEDIA_PLACE_JOB_NAME,
        data: { mediaId: expect.any(String) }
      })
    })

    it('does not fail the upload when the queue fails', async () => {
      mockPublish.mockRejectedValue(new Error('queue down'))

      await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg')

      expect(lastResult).toMatchObject({ id: expect.any(String) })
    })

    it('queues nothing for a photo without GPS', async () => {
      const plain = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#808080' }
      })
        .jpeg()
        .toBuffer()

      await completeUpload(plain, 'image/jpeg', 'photo.jpg')

      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('stores the original again without its EXIF and accounts for the new size', async () => {
      const original = await jpegWithExif()
      expect((await sharp(original).metadata()).exif).toBeDefined()

      const puts = await completeUpload(original, 'image/jpeg', 'photo.jpg')

      expect(puts).toHaveLength(1)
      const stored = await sharp(puts[0]).metadata()
      expect(stored.format).toBe('jpeg')
      expect(stored.exif).toBeUndefined()
      // The stripped copy goes to a fresh key beside the client's object,
      // never over it, and the row is swapped to it on verification.
      const [strippedKey] = putKeys()
      expect(strippedKey).toMatch(/^medias\/2026-01-01\/[0-9a-f]{16}\.jpg$/)
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'bucket',
          Key: strippedKey,
          ContentType: 'image/jpeg'
        })
      )
      expect(database.markMediaUploadVerified).toHaveBeenCalledWith(
        expect.objectContaining({
          originalBytes: puts[0].length,
          originalPath: strippedKey,
          clientPath: 'medias/2026-01-01/photo.jpg'
        })
      )
      // Only once the swap is committed does the unstripped object go.
      expect(deletedKeys).toEqual(['medias/2026-01-01/photo.jpg'])
    })

    it('keeps the upload pending and intact for a retry when verification fails', async () => {
      database.markMediaUploadVerified.mockRejectedValueOnce(
        new Error('database unavailable')
      )
      const original = await jpegWithExif()

      await expect(
        completeUpload(original, 'image/jpeg', 'photo.jpg')
      ).rejects.toThrow('database unavailable')

      // The client's object is untouched and the row survives; only this
      // attempt's stripped copy is removed.
      const [strippedKey] = putKeys()
      expect(deletedKeys).toEqual([strippedKey])
      expect(database.deleteMedia).not.toHaveBeenCalled()

      // The retry validates the same bytes and completes.
      vi.mocked(PutObjectCommand).mockClear()
      await completeUpload(original, 'image/jpeg', 'photo.jpg')
      const [retryKey] = putKeys()
      expect(database.markMediaUploadVerified).toHaveBeenLastCalledWith(
        expect.objectContaining({ originalPath: retryKey })
      )
      expect(deletedKeys).toEqual(['medias/2026-01-01/photo.jpg'])
      expect(database.deleteMedia).not.toHaveBeenCalled()
      expect(lastResult).toMatchObject({ id: 'media-1' })
    })

    it('leaves the swap to the completion that verified first', async () => {
      const verifiedRow = {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/winner.jpg',
          bytes: 10,
          mimeType: 'image/jpeg',
          metaData: { width: 8, height: 8, upload: { state: 'verified' } },
          fileName: 'photo.jpg'
        }
      }
      // A queued result outranks the default `completeUpload` installs.
      database.markMediaUploadVerified.mockResolvedValueOnce({
        transitioned: false,
        media: verifiedRow
      } as never)

      await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg')

      const [strippedKey] = putKeys()
      // Its own copy is discarded; the winner's original and row are kept,
      // and the winner's decoration is not redone.
      expect(deletedKeys).toEqual([strippedKey])
      expect(database.deleteMedia).not.toHaveBeenCalled()
      expect(database.updateMedia).not.toHaveBeenCalled()
      expect(lastResult).toMatchObject({
        id: 'media-1',
        url: expect.stringContaining('medias/2026-01-01/winner.jpg')
      })
    })

    it('does not delete an upload a concurrent completion verified', async () => {
      const verifiedRow = {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/winner.jpg',
          bytes: 10,
          mimeType: 'image/jpeg',
          metaData: { width: 8, height: 8, upload: { state: 'verified' } },
          fileName: 'photo.jpg'
        }
      }
      database.getMediaByIdForAccount
        .mockResolvedValueOnce({
          ...verifiedRow,
          original: {
            ...verifiedRow.original,
            path: 'medias/2026-01-01/photo.jpg',
            metaData: {
              width: 8,
              height: 8,
              upload: { state: 'pending', size: 10, contentType: 'image/jpeg' }
            }
          }
        } as never)
        .mockResolvedValueOnce(verifiedRow as never)
      deletedKeys = []
      // The winner removed the client's object after its swap.
      send.mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand) {
          throw Object.assign(new Error('missing'), { name: 'NotFound' })
        }
        if (command instanceof DeleteObjectCommand) {
          deletedKeys.push(command.input.Key as string)
          return {}
        }
        throw new Error('Unexpected command')
      })

      const result = await createStorage().completePresignedUpload(
        actor,
        'media-1'
      )

      expect(result).toMatchObject({ id: 'media-1' })
      expect(deletedKeys).toEqual([])
      expect(database.deleteMedia).not.toHaveBeenCalled()
    })

    it('refuses and removes an image that cannot be re-encoded', async () => {
      // A JPEG header followed by junk passes sharp's metadata probe but not a
      // decode.
      const truncated = (await jpegWithExif()).subarray(0, 300)
      const probe = vi
        .spyOn(sharp.prototype, 'toBuffer')
        .mockRejectedValueOnce(new Error('decode failed'))

      await expect(
        completeUpload(truncated, 'image/jpeg', 'photo.jpg')
      ).rejects.toThrow(PresignedUploadValidationError)
      probe.mockRestore()

      expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
      expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
    })

    // Seeded noise stored with mozjpeg at a low quality: re-encoding it with
    // plain libjpeg comes out larger than the upload even at q85.
    const smallNoisyJpeg = async () => {
      const raw = Buffer.alloc(128 * 128 * 3)
      let seed = 12345
      for (let i = 0; i < raw.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        raw[i] = (seed >> 16) & 255
      }
      return sharp(raw, { raw: { width: 128, height: 128, channels: 3 } })
        .jpeg({ quality: 50, mozjpeg: true })
        .withExif({ IFD0: { Make: 'Canon' } })
        .toBuffer()
    }

    it('refuses and removes an image whose stripped copy exceeds the file limit', async () => {
      const original = await smallNoisyJpeg()
      mockMaxUploadSize.mockResolvedValue(original.length + 100)

      await expect(
        completeUpload(original, 'image/jpeg', 'photo.jpg')
      ).rejects.toThrow(PresignedUploadValidationError)

      // Nothing was written, the row and the client's object are removed.
      expect(putKeys()).toEqual([])
      expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
      expect(deletedKeys).toEqual(['medias/2026-01-01/photo.jpg'])
      expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
    })

    it('refuses and removes an image whose growth pushes the account past its quota', async () => {
      const original = await smallNoisyJpeg()
      mockGetConfig.mockReturnValue({
        mediaStorage: { quotaPerAccount: original.length + 10 }
      })
      // The pending original is already counted in the usage.
      database.getStorageUsageForAccount.mockResolvedValue(original.length)

      await expect(
        completeUpload(original, 'image/jpeg', 'photo.jpg')
      ).rejects.toThrow(/quota/i)

      expect(putKeys()).toEqual([])
      expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
      expect(deletedKeys).toEqual(['medias/2026-01-01/photo.jpg'])
      expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
    })

    it('re-encodes at a lower quality when the first strip grows', async () => {
      const original = await smallNoisyJpeg()
      const toBuffer = vi.spyOn(sharp.prototype, 'jpeg')

      await completeUpload(original, 'image/jpeg', 'photo.jpg')

      const qualities = toBuffer.mock.calls.map(
        ([options]) => (options as { quality?: number } | undefined)?.quality
      )
      expect(qualities).toEqual(expect.arrayContaining([95, 85]))
      toBuffer.mockRestore()
    })

    it('does not rewrite a video', async () => {
      const puts = await completeUpload(
        Buffer.from('video-bytes'),
        'video/mp4',
        'clip.mp4'
      )

      expect(puts).toHaveLength(1) // only the preview thumbnail
      expect(database.markMediaUploadVerified).toHaveBeenCalledWith(
        expect.not.objectContaining({ originalBytes: expect.anything() })
      )
    })

    it.each([
      ['always', true],
      ['never', false]
    ])(
      'applies galleryDefault %s to an image and a video',
      async (galleryDefault, inGallery) => {
        gallery.getGallerySettings.mockResolvedValue(
          settings({ galleryDefault })
        )

        await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg')
        expect(database.markMediaUploadVerified).toHaveBeenLastCalledWith(
          expect.objectContaining({
            details: expect.objectContaining({ inGallery })
          })
        )

        await completeUpload(Buffer.from('video-bytes'), 'video/mp4', 'a.mp4')
        expect(database.markMediaUploadVerified).toHaveBeenLastCalledWith(
          expect.objectContaining({
            details: expect.objectContaining({ inGallery })
          })
        )
      }
    )

    it('keeps the details when the analysis throws', async () => {
      gallery.getGallerySettings.mockResolvedValue(
        settings({ galleryDefault: 'always' })
      )
      vi.mocked(extractVideoImage).mockRejectedValue(new Error('ffmpeg'))

      await completeUpload(Buffer.from('video-bytes'), 'video/mp4', 'a.mp4')

      expect(database.markMediaUploadVerified).toHaveBeenCalledWith(
        expect.objectContaining({ details: { inGallery: true } })
      )
      expect(database.updateMedia).not.toHaveBeenCalled()
    })

    // The details travel with the verification, so a failing decoration write
    // (after the client's original is gone) cannot lose them.
    it('still has the details when the post-verify updateMedia rejects', async () => {
      gallery.getGallerySettings.mockResolvedValue(
        settings({ galleryDefault: 'always' })
      )
      let row: Record<string, unknown> | undefined
      database.markMediaUploadVerified.mockImplementation((async (params: {
        details?: Record<string, unknown>
      }) => {
        row = { details: params.details }
        return {
          transitioned: true,
          media: {
            id: 'media-1',
            actorId: 'actor-1',
            original: {
              path: 'medias/2026-01-01/photo.jpg',
              bytes: 1,
              mimeType: 'image/jpeg',
              metaData: { width: 8, height: 8 }
            },
            details: params.details
          }
        }
      }) as never)

      await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg', {
        keepVerifyMock: true,
        updateMediaRejects: true
      })

      expect(database.updateMedia).toHaveBeenCalled()
      expect(row).toEqual({
        details: expect.objectContaining({ inGallery: true })
      })
    })

    it('does not generate alt text when autoDescribe is off', async () => {
      mockGetConfig.mockReturnValue({
        altText: {
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKey: 'test-key',
          model: 'gpt-4o-mini'
        }
      })
      gallery.getGallerySettings.mockResolvedValue(
        settings({ autoDescribe: false })
      )

      await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg')

      expect(mockGenerateAltText).not.toHaveBeenCalled()
    })

    it('generates alt text when autoDescribe is on', async () => {
      mockGetConfig.mockReturnValue({
        altText: {
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKey: 'test-key',
          model: 'gpt-4o-mini'
        }
      })
      mockGenerateAltText.mockResolvedValue('A grey square')

      await completeUpload(await jpegWithExif(), 'image/jpeg', 'photo.jpg')

      expect(mockGenerateAltText).toHaveBeenCalledTimes(1)
    })
  })

  // Regression (F101, F102): completion only compared the object with the
  // client's own claims, and a failed byte analysis was logged and the upload
  // returned as verified — so any bytes could be hosted under an accepted
  // media type. The bytes are now probed BEFORE the row is marked usable, and
  // anything that is not the declared media type is deleted with its row.
  describe('probing the uploaded bytes', () => {
    const pendingMedia = (mimeType: string, size: number) => ({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.bin',
        bytes: size,
        mimeType,
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: mimeType,
            size
          }
        },
        fileName: 'upload.bin'
      }
    })

    const createStorage = () =>
      new S3FileStorage(
        {
          type: MediaStorageType.ObjectStorage,
          bucket: 'bucket',
          region: 'us-east-1',
          endpoint: 'https://s3.example.com'
        },
        'llun.test',
        database
      )

    const serveObject = (
      contentType: string,
      size: number,
      body: Buffer | null | (() => never)
    ) => {
      send.mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand) {
          return {
            ContentLength: size,
            ContentType: contentType,
            ChecksumSHA1: checksumBase64
          }
        }
        if (command instanceof GetObjectCommand) {
          if (typeof body === 'function') body()
          if (body === null) return { Body: undefined }
          return { Body: Readable.from([body]) }
        }
        if (
          command instanceof DeleteObjectCommand ||
          command instanceof PutObjectCommand
        ) {
          return {}
        }
        throw new Error('Unexpected command')
      })
    }

    // Completion streams the object to a temp file. Point the temp directory
    // at a per-test folder so every path can assert it left nothing behind:
    // a leak here is a full upload (up to the media size cap) per completion.
    let tempDirectory: string
    let originalTmpDir: string | undefined
    beforeEach(async () => {
      originalTmpDir = process.env.TMPDIR
      tempDirectory = await fs.mkdtemp(`${tmpdir()}/presigned-completion-`)
      process.env.TMPDIR = tempDirectory
    })
    afterEach(async () => {
      if (originalTmpDir === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = originalTmpDir
      await fs.rm(tempDirectory, { recursive: true, force: true })
    })
    const expectNoTempFiles = async () => {
      // Guard against the redirect itself silently not applying.
      expect(tmpdir()).toBe(tempDirectory)
      await expect(fs.readdir(tempDirectory)).resolves.toEqual([])
    }

    const expectRefusedAndDeleted = async () => {
      await expect(
        createStorage().completePresignedUpload(actor, 'media-1')
      ).rejects.toThrow(PresignedUploadValidationError)
      expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
      expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'bucket',
        Key: 'medias/2026-01-01/upload.bin'
      })
    }

    it('refuses HTML uploaded as image/png', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>')
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('image/png', html.length) as never
      )
      serveObject('image/png', html.length, html)

      await expectRefusedAndDeleted()
      await expectNoTempFiles()
    })

    it('refuses an object that has no body', async () => {
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('image/png', ONE_PIXEL_PNG.length) as never
      )
      serveObject('image/png', ONE_PIXEL_PNG.length, null)

      const error = await createStorage()
        .completePresignedUpload(actor, 'media-1')
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(PresignedUploadValidationError)
      expect((error as Error).message).toBe('Uploaded object is missing')
      expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
      expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
      await expectNoTempFiles()
    })

    // HEAD and GET are separate reads: the object can be replaced between
    // them, so the download itself is capped at the size HEAD vouched for.
    it('stops downloading at the declared size and removes the partial file', async () => {
      const declared = ONE_PIXEL_PNG.length
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('image/png', declared) as never
      )
      serveObject(
        'image/png',
        declared,
        Buffer.concat([ONE_PIXEL_PNG, Buffer.alloc(64 * 1024)])
      )

      await expect(
        createStorage().completePresignedUpload(actor, 'media-1')
      ).rejects.toThrow(StreamByteLimitError)
      expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
      await expectNoTempFiles()
    })

    it('refuses a JPEG declared as image/png', async () => {
      const jpeg = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#000' }
      })
        .jpeg()
        .toBuffer()
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('image/png', jpeg.length) as never
      )
      serveObject('image/png', jpeg.length, jpeg)

      await expectRefusedAndDeleted()
    })

    it('refuses a video ffprobe cannot read', async () => {
      vi.mocked(extractVideoMetaFromFile).mockRejectedValue(
        new Error('ffprobe exited with code 1')
      )
      const bytes = Buffer.from('not-a-video')
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('video/mp4', bytes.length) as never
      )
      serveObject('video/mp4', bytes.length, bytes)

      await expectRefusedAndDeleted()
    })

    it('refuses a video container with no video stream', async () => {
      vi.mocked(extractVideoMetaFromFile).mockResolvedValue({
        streams: [{ codec_type: 'audio' }],
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
      })
      const bytes = Buffer.from('audio-only')
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('video/mp4', bytes.length) as never
      )
      serveObject('video/mp4', bytes.length, bytes)

      await expectRefusedAndDeleted()
    })

    it('refuses audio/mp4 that has no audio stream', async () => {
      vi.mocked(extractVideoMetaFromFile).mockResolvedValue({
        streams: [],
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
      })
      const bytes = Buffer.from('empty')
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('audio/mp4', bytes.length) as never
      )
      serveObject('audio/mp4', bytes.length, bytes)

      await expectRefusedAndDeleted()
    })

    // The analysis cap used to exempt a large upload from every byte check.
    it('probes a video above the analysis cap too', async () => {
      vi.mocked(extractVideoMetaFromFile).mockRejectedValue(
        new Error('ffprobe exited with code 1')
      )
      const size = 150 * 1024 * 1024
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('video/mp4', size) as never
      )
      serveObject('video/mp4', size, Buffer.from('not-a-video'))

      await expectRefusedAndDeleted()
    })

    it('records the probed dimensions instead of the declared ones', async () => {
      const png = await sharp({
        create: { width: 64, height: 48, channels: 3, background: '#123456' }
      })
        .png()
        .toBuffer()
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('image/png', png.length) as never
      )
      serveObject('image/png', png.length, png)

      await createStorage().completePresignedUpload(actor, 'media-1')

      expect(database.markMediaUploadVerified).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: { width: 64, height: 48 } })
      )
      expect(database.deleteMedia).not.toHaveBeenCalled()
      await expectNoTempFiles()
    })

    it('keeps the row and object when reading the object fails transiently', async () => {
      const png = ONE_PIXEL_PNG
      database.getMediaByIdForAccount.mockResolvedValue(
        pendingMedia('image/png', png.length) as never
      )
      serveObject('image/png', png.length, () => {
        throw Object.assign(new Error('socket hang up'), {
          name: 'TimeoutError'
        })
      })

      await expect(
        createStorage().completePresignedUpload(actor, 'media-1')
      ).rejects.toThrow('socket hang up')
      expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
      expect(database.deleteMedia).not.toHaveBeenCalled()
      expect(DeleteObjectCommand).not.toHaveBeenCalled()
      await expectNoTempFiles()
    })
  })
})
