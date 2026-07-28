import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, resolve } from 'path'
import sharp from 'sharp'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { S3FileStorage } from '@/lib/services/medias/S3StorageFile'
import {
  MAX_FILE_SIZE,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import { extractVideoMeta } from '@/lib/services/medias/extractVideoMeta'
import { getMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import { Actor } from '@/lib/types/domain/actor'
import { StreamByteLimitError } from '@/lib/utils/streamLimit'

vi.mock('@aws-sdk/client-s3', () => {
  const makeCommand = (name: string) =>
    vi.fn().mockImplementation(function command(input) {
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

vi.mock('@/lib/services/medias/uploadSizeLimit', () => ({
  getMaxMediaUploadSize: vi.fn()
}))

vi.mock('@/lib/services/medias/extractVideoMeta', () => ({
  extractVideoMeta: vi.fn()
}))

vi.mock('@/lib/services/medias/extractVideoImage', () => ({
  extractVideoImage: vi.fn()
}))

// A real 1x1 PNG, so the video preview and image branches run sharp for real
// rather than against a stand-in the production code could never receive.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('S3FileStorage presigned upload completion', () => {
  const send = vi.fn()
  const actor = {
    id: 'actor-1',
    account: { id: 'account-1' }
  } as Actor
  const checksumHex = 'a9993e364706816aba3e25717850c26c9cd0d89d'
  const checksumBase64 = Buffer.from(checksumHex, 'hex').toString('base64')

  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn(),
    getMediaByIdForAccount: vi.fn(),
    getStorageUsageForAccount: vi.fn(),
    markMediaUploadVerified: vi.fn(),
    deleteMedia: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    database.createMedia.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: 1024,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10
        },
        fileName: 'upload.png'
      }
    } as never)
    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: 1024,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'image/png',
            size: 1024
          }
        },
        fileName: 'upload.png'
      }
    } as never)
    database.markMediaUploadVerified.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: 1024,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'verified',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'image/png',
            size: 1024,
            verifiedAt: 1
          }
        },
        fileName: 'upload.png'
      }
    } as never)
    database.deleteMedia.mockResolvedValue(true)
  })

  it('uses the configured endpoint for the S3 client without treating hostname as the endpoint', () => {
    new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'auto',
        hostname: 'static.llun.social',
        endpoint: 'https://account.r2.cloudflarestorage.com'
      },
      'llun.test',
      database
    )

    expect(S3Client).toHaveBeenCalledWith({
      region: 'auto',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      forcePathStyle: true
    })
  })

  it('signs checksum headers required by browser presigned uploads', async () => {
    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    const result = await storage.getPresigedForSaveFileUrl(actor, {
      fileName: 'upload.png',
      checksum: checksumHex,
      width: 10,
      height: 10,
      contentType: 'image/png',
      size: 1024
    })

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ChecksumSHA1: checksumBase64,
        Metadata: {
          checksumSha1: checksumHex
        }
      })
    )
    expect(getSignedUrl).toHaveBeenCalledTimes(1)
    const presignOptions = (getSignedUrl as jest.Mock).mock.calls[0][2]
    expect(presignOptions.expiresIn).toBe(600)
    expect(presignOptions.unhoistableHeaders.has('x-amz-checksum-sha1')).toBe(
      true
    )
    expect(
      presignOptions.unhoistableHeaders.has('x-amz-meta-checksumsha1')
    ).toBe(true)
    expect(result).toMatchObject({
      url: 'https://storage.example/upload',
      headers: {
        'x-amz-checksum-sha1': checksumBase64,
        'x-amz-meta-checksumsha1': checksumHex
      }
    })
  })

  // Regression: `fileName` is a plain client-supplied string on this path, and
  // it used to reach both the object key (via `extname`) and the stored row
  // verbatim.
  it('reduces a traversing presigned file name to an inert basename', async () => {
    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    await storage.getPresigedForSaveFileUrl(actor, {
      fileName: '../../../../etc/cron.d/upload.html',
      checksum: checksumHex,
      width: 10,
      height: 10,
      contentType: 'image/png',
      size: 1024
    })

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.stringMatching(
          /^medias\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{16}\.png$/
        )
      })
    )
    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        original: expect.objectContaining({ fileName: 'upload.html' })
      })
    )
  })

  it('rejects oversized presigned uploads before marking media usable', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 2048,
          ContentType: 'image/png',
          ChecksumSHA1: checksumBase64
        }
      }
      if (command instanceof DeleteObjectCommand) {
        return {}
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    await expect(
      storage.completePresignedUpload(actor, 'media-1')
    ).rejects.toThrow('does not match expected size')
    expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
    expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
  })

  it('uses checksum metadata when S3 checksum fields are unavailable', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 1024,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    await expect(
      storage.completePresignedUpload(actor, 'media-1')
    ).resolves.toMatchObject({ id: 'media-1' })
    expect(database.markMediaUploadVerified).toHaveBeenCalled()
    expect(database.deleteMedia).not.toHaveBeenCalled()
  })

  it('does not request checksum mode when verifying presigned uploads', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 1024,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    await storage.completePresignedUpload(actor, 'media-1')

    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Key: 'medias/2026-01-01/upload.png'
    })
  })

  it('rejects uploads when no S3 checksum or checksum metadata is available', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 1024,
          ContentType: 'image/png',
          Metadata: {}
        }
      }
      if (command instanceof DeleteObjectCommand) {
        return {}
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    await expect(
      storage.completePresignedUpload(actor, 'media-1')
    ).rejects.toThrow('Uploaded object does not include expected checksum')
    expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
    expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
  })

  it('does not delete media records for transient verification errors', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        throw new Error('S3 timeout')
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    await expect(
      storage.completePresignedUpload(actor, 'media-1')
    ).rejects.toThrow('S3 timeout')
    expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
    expect(database.deleteMedia).not.toHaveBeenCalled()
  })
})

describe('S3FileStorage saveFile with a video', () => {
  const send = vi.fn()
  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor

  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn(),
    getStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

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

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockResolvedValue({})
    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createMedia.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/clip.mp4',
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
    // `extractVideoImage` resolves a real frame or rejects — it never resolves
    // null — so the thumbnail branch runs here exactly as it does in production.
    vi.mocked(extractVideoImage).mockResolvedValue(ONE_PIXEL_PNG)
  })

  // Regression: the temp path was `join(tmpdir(), randomHex + file.name)`, and
  // `path.join` resolves `..`. Three `..` are needed to escape: the first is
  // absorbed by the 16-character random prefix's own segment (which is why
  // `../../evil.mp4` merely lands back on a predictable `<tmpdir>/evil.mp4`).
  it('writes the temp video inside the temp directory for a traversing name', async () => {
    const file = new File(
      [Buffer.from('video-bytes')],
      '../../../../etc/cron.d/evil.mp4',
      { type: 'video/mp4' }
    )

    await createStorage().saveFile(actor, { file })

    expect(extractVideoImage).toHaveBeenCalledTimes(1)
    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    expect(resolve(dirname(tempPath))).toBe(resolve(tmpdir()))
    expect(basename(tempPath)).toMatch(/^[0-9a-f]{16}-evil\.mp4$/)
  })

  // Regression: without the separator the random prefix is cancelled out, so
  // every upload of this name resolves to the same `<tmpdir>/evil.mp4` and one
  // upload can overwrite another's temp file mid-probe.
  it('keeps the random prefix effective for a name starting with a parent reference', async () => {
    const file = new File([Buffer.from('video-bytes')], '../../evil.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    expect(basename(tempPath)).toMatch(/^[0-9a-f]{16}-evil\.mp4$/)
  })

  it('removes the temp video once probing finishes', async () => {
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    await expect(fs.access(tempPath)).rejects.toThrow()
  })

  it('removes the temp video when probing fails', async () => {
    vi.mocked(extractVideoMeta).mockRejectedValue(new Error('ffprobe failed'))
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await expect(createStorage().saveFile(actor, { file })).rejects.toThrow(
      'ffprobe failed'
    )

    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    await expect(fs.access(tempPath)).rejects.toThrow()
  })

  // The realistic failure: ffmpeg finds no decodable frame, so
  // `extractVideoImage` rejects. The temp file must still go.
  it('removes the temp video when preview extraction fails', async () => {
    vi.mocked(extractVideoImage).mockRejectedValue(new Error('ffmpeg failed'))
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await expect(createStorage().saveFile(actor, { file })).rejects.toThrow(
      'ffmpeg failed'
    )

    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    await expect(fs.access(tempPath)).rejects.toThrow()
  })

  it.each([
    {
      description: 'derives the object key extension from the content type',
      fileName: 'clip.mp4/../../../evil.html',
      contentType: 'video/mp4',
      expectedExtension: '.mp4'
    },
    {
      description: 'stores quicktime uploads under the mp4 extension',
      fileName: 'MOVIE.MOV',
      contentType: 'video/quicktime',
      expectedExtension: '.mp4'
    },
    {
      description: 'keeps webm uploads under the webm extension',
      fileName: 'clip.webm',
      contentType: 'video/webm',
      expectedExtension: '.webm'
    }
  ])('$description', async ({ fileName, contentType, expectedExtension }) => {
    const file = new File([Buffer.from('video-bytes')], fileName, {
      type: contentType
    })

    await createStorage().saveFile(actor, { file })

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.stringMatching(
          new RegExp(
            `^medias/\\d{4}-\\d{2}-\\d{2}/[0-9a-f]{16}\\${expectedExtension}$`
          )
        )
      })
    )
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

  // `saveFile`'s image branch is a separate `createMedia` call from the video
  // branch above, so it needs its own coverage.
  it('stores a sanitized original file name for an image', async () => {
    database.createMedia.mockResolvedValue({
      id: 'media-2',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/photo.webp',
        bytes: ONE_PIXEL_PNG.length,
        mimeType: 'image/png',
        metaData: { width: 1, height: 1 },
        fileName: 'evil.png'
      }
    } as never)
    const file = new File([ONE_PIXEL_PNG], '/etc/cron.d/evil.png', {
      type: 'image/png'
    })

    await createStorage().saveFile(actor, { file })

    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        original: expect.objectContaining({ fileName: 'evil.png' })
      })
    )
  })
})

// Regression: the image branch called `createMedia` with no `thumbnail` key at
// all, so a client that uploaded one (MediaSchema accepts it, and
// handleSyncMediaUpload passes it straight through) got it stored on a
// filesystem instance and silently dropped on an object-storage one — the same
// upload produced a different `meta.small`/`preview_url` per backend. The video
// branch had the matching gap: it always used the extracted frame and ignored a
// caller-supplied thumbnail. Mirrors `localFile.test.ts`.
describe('S3FileStorage saveFile with a caller-supplied thumbnail', () => {
  const send = vi.fn()
  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor
  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getStorageUsageForAccount: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  // Every PutObjectCommand with the bytes it actually uploaded. The storage
  // deletes its temp file as soon as `send` resolves, so an image stream has to
  // be drained inside the mock.
  let uploads: { key: string; body: Buffer }[]

  beforeEach(() => {
    vi.clearAllMocks()
    uploads = []
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockImplementation(async (command) => {
      if (!(command instanceof PutObjectCommand)) {
        throw new Error('Unexpected command')
      }
      const { Key, Body } = command.input
      const chunks: Buffer[] = []
      if (Buffer.isBuffer(Body)) {
        chunks.push(Body)
      } else {
        for await (const chunk of Body as Readable) {
          chunks.push(Buffer.from(chunk))
        }
      }
      uploads.push({ key: String(Key), body: Buffer.concat(chunks) })
      return {}
    })
    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createMedia.mockImplementation((async (params: unknown) => ({
      id: 'media-1',
      actorId: actor.id,
      ...(params as object)
    })) as never)
    vi.mocked(extractVideoMeta).mockResolvedValue({
      streams: [{ codec_type: 'video', width: 10, height: 10 }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
    })
    vi.mocked(extractVideoImage).mockResolvedValue(ONE_PIXEL_PNG)
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

  // Thumbnails are uploaded under the same prefix as the original, suffixed
  // `-thumbnail`, so each helper has to pick out the object it means.
  const uploaded = (kind: 'original' | 'thumbnail') => {
    const match = uploads.find(
      (upload) =>
        upload.key.endsWith('-thumbnail.webp') === (kind === 'thumbnail')
    )
    if (!match) {
      throw new Error(
        `No uploaded ${kind} in [${uploads.map((upload) => upload.key).join(', ')}]`
      )
    }
    return match
  }

  it('uploads a caller-supplied thumbnail alongside the image', async () => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600),
      thumbnail: await createPngFile(400, 300)
    })

    expect(uploads).toHaveLength(2)
    await expect(
      sharp(uploaded('thumbnail').body).metadata()
    ).resolves.toMatchObject({ width: 400, height: 300, format: 'webp' })
  })

  // `thumbnail.bytes` is metered: `createMedia` adds it to the account's usage
  // counter, so it has to describe the stored WebP (`outputInfo`) rather than
  // the uploaded PNG.
  it('records the stored thumbnail on the media row', async () => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600),
      thumbnail: await createPngFile(400, 300)
    })

    const thumbnail = uploaded('thumbnail')
    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnail: {
          path: thumbnail.key,
          bytes: thumbnail.body.length,
          mimeType: 'image/webp',
          metaData: { width: 400, height: 300 }
        }
      })
    )
  })

  it('reports the stored thumbnail as meta.small on the attachment', async () => {
    const attachment = await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600),
      thumbnail: await createPngFile(400, 300)
    })

    expect(attachment?.meta.small).toMatchObject({ width: 400, height: 300 })
    expect(attachment?.preview_url).toBe(
      `https://llun.test/api/v1/files/${uploaded('thumbnail').key}`
    )
  })

  it('stores no thumbnail for an image uploaded without one', async () => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600)
    })

    expect(uploads).toHaveLength(1)
    expect(database.createMedia).toHaveBeenCalledWith(
      expect.not.objectContaining({ thumbnail: expect.anything() })
    )
  })

  it('prefers a caller-supplied thumbnail over the extracted video frame', async () => {
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, {
      file,
      thumbnail: await createPngFile(400, 300)
    })

    // The video plus one thumbnail — the 1x1 preview frame is not uploaded.
    expect(uploads).toHaveLength(2)
    await expect(
      sharp(uploaded('thumbnail').body).metadata()
    ).resolves.toMatchObject({ width: 400, height: 300 })
  })

  it('falls back to the extracted video frame when no thumbnail is supplied', async () => {
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    await expect(
      sharp(uploaded('thumbnail').body).metadata()
    ).resolves.toMatchObject({ width: 1, height: 1 })
  })
})

describe('S3FileStorage getFile', () => {
  const send = vi.fn()
  const database = {} as unknown as jest.Mocked<Database>
  const storageConfig = {
    type: MediaStorageType.ObjectStorage,
    bucket: 'bucket',
    region: 'us-east-1',
    endpoint: 'https://s3.example.com',
    // The env-only storage cap, left at the built-in default.
    maxFileSize: MAX_FILE_SIZE
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from('image-bytes')]),
      // Larger than the built-in default, smaller than the raised admin cap.
      ContentLength: 300 * 1024 * 1024,
      ContentType: 'image/png'
    })
  })

  // Regression: the read-back guard used to read the env-only storage config,
  // so media accepted under an admin-raised media.maxFileSize could never be
  // served back out.
  it('bounds the buffer by the resolved cap rather than the storage config', async () => {
    vi.mocked(getMaxMediaUploadSize).mockResolvedValue(500 * 1024 * 1024)
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    await expect(storage.getFile('medias/upload.png')).resolves.toMatchObject({
      type: 'buffer',
      contentType: 'image/png'
    })
    expect(getMaxMediaUploadSize).toHaveBeenCalledWith(database)
  })

  it('refuses to buffer an object above the resolved cap', async () => {
    vi.mocked(getMaxMediaUploadSize).mockResolvedValue(MAX_FILE_SIZE)
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    await expect(storage.getFile('medias/upload.png')).rejects.toThrow(
      StreamByteLimitError
    )
  })
})

describe('S3FileStorage image output format', () => {
  const send = vi.fn()
  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor
  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getStorageUsageForAccount: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>
  const storageConfig = {
    type: MediaStorageType.ObjectStorage,
    bucket: 'bucket',
    region: 'us-east-1',
    endpoint: 'https://s3.example.com'
  } as const

  const createPngFile = async () => {
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
    return new File([new Uint8Array(buffer)], 'route-map.png', {
      type: 'image/png'
    })
  }

  const putObjectInput = () =>
    vi.mocked(PutObjectCommand).mock.calls[0][0] as {
      Key: string
      ContentType: string
    }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockResolvedValue({})
    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createMedia.mockImplementation((async (params: unknown) => ({
      id: 'media-1',
      actorId: actor.id,
      ...(params as object)
    })) as never)
  })

  it('uploads images as webp by default', async () => {
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    await storage.saveFile(actor, { file: await createPngFile() })

    expect(putObjectInput()).toMatchObject({ ContentType: 'image/webp' })
    expect(putObjectInput().Key).toMatch(
      /^medias\/\d{4}-\d{2}-\d{2}\/\w+\.webp$/
    )
  })

  it('uploads a jpeg rendition without creating a media row', async () => {
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    const rendition = await storage.saveImageRendition(
      actor,
      await createPngFile(),
      'jpeg'
    )

    expect(putObjectInput()).toMatchObject({ ContentType: 'image/jpeg' })
    expect(putObjectInput().Key).toMatch(
      /^medias\/\d{4}-\d{2}-\d{2}\/\w+\.jpg$/
    )
    expect(rendition).toMatchObject({
      path: putObjectInput().Key,
      mimeType: 'image/jpeg',
      url: `https://llun.test/api/v1/files/${putObjectInput().Key}`
    })
    expect(database.createMedia).not.toHaveBeenCalled()
  })
})

describe('S3FileStorage saveFile image sizing', () => {
  const send = vi.fn()
  const actor = { id: 'actor-1' } as Actor
  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getStorageUsageForAccount: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  // The uploaded WebPs, captured off each PutObjectCommand body. The storage
  // deletes its temp file as soon as `send` resolves, so the stream has to be
  // drained inside the mock.
  let uploadedBodies: Buffer[]

  beforeEach(() => {
    vi.clearAllMocks()
    uploadedBodies = []
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockImplementation(async (command) => {
      if (command instanceof PutObjectCommand) {
        const chunks: Buffer[] = []
        for await (const chunk of command.input.Body as Readable) {
          chunks.push(Buffer.from(chunk))
        }
        uploadedBodies.push(Buffer.concat(chunks))
        return {}
      }
      throw new Error('Unexpected command')
    })
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

  const readUploadedImage = async () => {
    expect(uploadedBodies).toHaveLength(1)
    return sharp(uploadedBodies[0]).metadata()
  }

  // Regression: `fit: 'inside'` enlarges by default, so the MAX_WIDTH/MAX_HEIGHT
  // box was an upscale rather than a cap. Asserting on the uploaded bytes is
  // what catches it: `original.metaData` is read from the INPUT image, so it
  // reported the source dimensions either way.
  it.each([
    {
      description: 'uploads an image below the cap at its own dimensions',
      source: { width: 800, height: 600 },
      uploaded: { width: 800, height: 600 }
    },
    {
      description: 'scales an image above the cap down to fit',
      source: { width: MAX_WIDTH + 200, height: (MAX_HEIGHT + 200) / 2 },
      uploaded: { width: MAX_WIDTH, height: MAX_HEIGHT / 2 }
    }
  ])('$description', async ({ source, uploaded }) => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(source.width, source.height)
    })

    await expect(readUploadedImage()).resolves.toMatchObject(uploaded)
  })

  // The thumbnail path is where the upscale reached the database: unlike the
  // original, the returned `metaData`/`bytes` come from `outputInfo` — the
  // stored WebP — so an upscaled thumbnail was reported as 4000x3000 in the
  // Mastodon attachment's `meta.small` and charged to the account's quota.
  it('records the thumbnail dimensions actually uploaded', async () => {
    const thumbnail = await createStorage().saveThumbnail(
      actor,
      await createPngFile(800, 600)
    )

    expect(thumbnail?.metaData).toEqual({ width: 800, height: 600 })
    await expect(readUploadedImage()).resolves.toMatchObject({
      width: 800,
      height: 600
    })
  })
})
