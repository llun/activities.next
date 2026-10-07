import {
  DeleteObjectCommand,
  GetObjectCommand,
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
import {
  PresignedUploadValidationError,
  S3FileStorage
} from '@/lib/services/medias/S3StorageFile'
import {
  MAX_FILE_SIZE,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import {
  extractVideoMeta,
  extractVideoMetaFromFile
} from '@/lib/services/medias/extractVideoMeta'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { Actor } from '@/lib/types/domain/actor'
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

const mockGenerateAltText = vi.fn()
vi.mock('@/lib/services/altText/openai', () => ({
  generateAltText: (...args: unknown[]) => mockGenerateAltText(...args)
}))

// A real 1x1 PNG, so the video preview and image branches run sharp for real
// rather than against a stand-in the production code could never receive.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

// Every upload body this driver sends is an in-memory Buffer — a video's own
// bytes, an image's encoded output. Rejecting anything else is what keeps the
// temp-file round trip `_uploadImageBufferToS3` used to perform from coming
// back; that function's own comment explains why it must not. Draining a
// stream here instead would quietly accept the regression, so every `send`
// mock in this file routes its body through here.
const readUploadBody = (body: unknown): Buffer => {
  if (!Buffer.isBuffer(body)) {
    throw new Error(
      `Expected an in-memory Buffer upload body, got ${typeof body}`
    )
  }
  return body
}

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
    updateMedia: vi.fn(),
    deleteMedia: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({})
    mockGenerateAltText.mockReset()
    // The presigned video path extracts through the real
    // `extractVideoPreviewFrame`, which writes a temp copy and delegates to
    // `extractVideoImage`; the default keeps an unconfigured call from
    // resolving `undefined` into sharp.
    vi.mocked(extractVideoImage).mockResolvedValue(ONE_PIXEL_PNG)
    // Completion probes the uploaded bytes; a presigned video is a real mp4
    // unless a test says otherwise.
    vi.mocked(extractVideoMetaFromFile).mockResolvedValue({
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
    })
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
      transitioned: true,
      media: {
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
      }
    } as never)
    database.deleteMedia.mockResolvedValue(true)
    database.updateMedia.mockResolvedValue(null)
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
        'Content-Type': 'image/png',
        'x-amz-checksum-sha1': checksumBase64,
        'x-amz-meta-checksumsha1': checksumHex
      }
    })
  })

  // Regression (F030): the presigner leaves Content-Type out of the signature
  // unless asked, so the URL holder could PUT `text/html` under a media key and
  // have the files route serve it from this origin. Runs the REAL presigner on
  // the exact command and options the driver built, so the assertion is on the
  // URL S3 will verify, not on how the mock was called.
  it('binds the declared content type into the presigned signature', async () => {
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
      fileName: 'upload.png',
      checksum: checksumHex,
      width: 10,
      height: 10,
      contentType: 'image/png',
      size: 1024
    })

    const [, command, options] = (getSignedUrl as jest.Mock).mock.calls[0]
    const actualS3 =
      await vi.importActual<typeof import('@aws-sdk/client-s3')>(
        '@aws-sdk/client-s3'
      )
    const { getSignedUrl: realGetSignedUrl } = await vi.importActual<
      typeof import('@aws-sdk/s3-request-presigner')
    >('@aws-sdk/s3-request-presigner')
    const realClient = new actualS3.S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
    })
    const url = await realGetSignedUrl(
      realClient,
      new actualS3.PutObjectCommand(
        (
          command as {
            input: ConstructorParameters<typeof PutObjectCommand>[0]
          }
        ).input
      ),
      options
    )

    const signedHeaders = new URL(url).searchParams
      .get('X-Amz-SignedHeaders')
      ?.split(';')
    expect(signedHeaders).toContain('content-type')
    expect(signedHeaders).toContain('content-length')
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
      if (command instanceof GetObjectCommand) {
        return { Body: Readable.from([ONE_PIXEL_PNG]) }
      }
      // Completion rewrites an image without its metadata.
      if (command instanceof PutObjectCommand) return {}
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
      if (command instanceof GetObjectCommand) {
        return { Body: Readable.from([ONE_PIXEL_PNG]) }
      }
      // Completion rewrites an image without its metadata.
      if (command instanceof PutObjectCommand) return {}
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

  it('analyzes image and updates blurhash on completePresignedUpload', async () => {
    const pngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer()

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: pngBuffer.length,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'image/png',
            size: pngBuffer.length
          }
        },
        fileName: 'upload.png'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        }
      }
    } as never)

    database.updateMedia.mockResolvedValue({
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        },
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focusX: 0,
        focusY: 0
      }
    } as never)

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: pngBuffer.length,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(pngBuffer)
          }
        }
      }
      // Completion rewrites an image without its metadata.
      if (command instanceof PutObjectCommand) return {}
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

    expect(database.updateMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-1',
        blurhash: expect.any(String),
        focus: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number)
        })
      })
    )
    // An image is analysed directly; the video preview-frame path must not run.
    expect(extractVideoImage).not.toHaveBeenCalled()
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

  it('generates alt text and updates description on completePresignedUpload when altText is configured', async () => {
    const pngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer()

    const altTextConfig = {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    }
    mockGetConfig.mockReturnValue({ altText: altTextConfig })
    mockGenerateAltText.mockResolvedValue('A generated alt text description')

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: pngBuffer.length,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'image/png',
            size: pngBuffer.length
          }
        },
        fileName: 'upload.png'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        }
      }
    } as never)

    database.updateMedia.mockResolvedValue({
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        },
        description: 'A generated alt text description',
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focusX: 0,
        focusY: 0
      }
    } as never)

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: pngBuffer.length,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(pngBuffer)
          }
        }
      }
      // Completion rewrites an image without its metadata.
      if (command instanceof PutObjectCommand) return {}
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

    const result = await storage.completePresignedUpload(actor, 'media-1')

    expect(mockGenerateAltText).toHaveBeenCalledWith(
      altTextConfig,
      expect.any(Buffer),
      'image/png'
    )
    expect(database.updateMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-1',
        description: 'A generated alt text description'
      })
    )
    expect(result?.description).toBe('A generated alt text description')
  })

  it('does not generate alt text or overwrite description if media already has a description', async () => {
    const pngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer()

    mockGetConfig.mockReturnValue({
      altText: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini'
      }
    })

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      description: 'Existing description',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: pngBuffer.length,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'image/png',
            size: pngBuffer.length
          }
        },
        fileName: 'upload.png'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        description: 'Existing description',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        }
      }
    } as never)

    database.updateMedia.mockResolvedValue({
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        description: 'Existing description',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        },
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focusX: 0,
        focusY: 0
      }
    } as never)

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: pngBuffer.length,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(pngBuffer)
          }
        }
      }
      // Completion rewrites an image without its metadata.
      if (command instanceof PutObjectCommand) return {}
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

    const result = await storage.completePresignedUpload(actor, 'media-1')

    expect(mockGenerateAltText).not.toHaveBeenCalled()
    expect(database.updateMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-1',
        description: undefined
      })
    )
    expect(result?.description).toBe('Existing description')
  })

  it('completes presigned upload successfully when generateAltText throws or returns null', async () => {
    const pngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer()

    mockGetConfig.mockReturnValue({
      altText: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini'
      }
    })
    mockGenerateAltText.mockRejectedValue(new Error('OpenAI timeout'))

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: pngBuffer.length,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'image/png',
            size: pngBuffer.length
          }
        },
        fileName: 'upload.png'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        }
      }
    } as never)

    database.updateMedia.mockResolvedValue({
      media: {
        id: 'media-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/upload.png',
          bytes: pngBuffer.length,
          mimeType: 'image/png',
          metaData: {
            width: 10,
            height: 10,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'upload.png'
        },
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focusX: 0,
        focusY: 0
      }
    } as never)

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: pngBuffer.length,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(pngBuffer)
          }
        }
      }
      // Completion rewrites an image without its metadata.
      if (command instanceof PutObjectCommand) return {}
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

    const result = await storage.completePresignedUpload(actor, 'media-1')

    expect(mockGenerateAltText).toHaveBeenCalled()
    expect(result).toMatchObject({ id: 'media-1' })
  })

  it('does not analyze or generate alt text for non-image, non-video uploads', async () => {
    mockGetConfig.mockReturnValue({
      altText: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini'
      }
    })

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-audio-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/voice.m4a',
        bytes: 2048,
        mimeType: 'audio/mp4',
        metaData: {
          width: 0,
          height: 0,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'audio/mp4',
            size: 2048
          }
        },
        fileName: 'voice.m4a'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-audio-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/voice.m4a',
          bytes: 2048,
          mimeType: 'audio/mp4',
          metaData: {
            width: 0,
            height: 0,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'voice.m4a'
        }
      }
    } as never)

    vi.mocked(extractVideoMetaFromFile).mockResolvedValue({
      streams: [{ codec_type: 'audio' }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
    })
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 2048,
          ContentType: 'audio/mp4',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return { Body: Readable.from([Buffer.alloc(2048)]) }
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

    const result = await storage.completePresignedUpload(actor, 'media-audio-1')

    expect(extractVideoImage).not.toHaveBeenCalled()
    expect(mockGenerateAltText).not.toHaveBeenCalled()
    expect(database.updateMedia).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: 'media-audio-1', type: 'audio' })
  })

  it('analyzes a video preview frame and generates alt text on completePresignedUpload', async () => {
    const videoBuffer = Buffer.from('video-bytes')
    const videoFrame = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 128, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    const altTextConfig = {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    }
    mockGetConfig.mockReturnValue({ altText: altTextConfig })
    mockGenerateAltText.mockResolvedValue('A generated video description')
    vi.mocked(extractVideoImage).mockResolvedValue(videoFrame)

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-video-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/video.mp4',
        bytes: videoBuffer.length,
        mimeType: 'video/mp4',
        metaData: {
          width: 1920,
          height: 1080,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'video/mp4',
            size: videoBuffer.length
          }
        },
        fileName: 'video.mp4'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-video-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/video.mp4',
          bytes: videoBuffer.length,
          mimeType: 'video/mp4',
          metaData: {
            width: 1920,
            height: 1080,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'video.mp4'
        }
      }
    } as never)

    database.updateMedia.mockResolvedValue({
      media: {
        id: 'media-video-1',
        actorId: 'actor-1',
        description: 'A generated video description',
        original: {
          path: 'medias/2026-01-01/video.mp4',
          bytes: videoBuffer.length,
          mimeType: 'video/mp4',
          metaData: {
            width: 1920,
            height: 1080,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'video.mp4'
        },
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focusX: 0,
        focusY: 0
      }
    } as never)

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: videoBuffer.length,
          ContentType: 'video/mp4',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(videoBuffer)
          }
        }
      }
      if (
        command instanceof PutObjectCommand ||
        command instanceof DeleteObjectCommand
      ) {
        return {}
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        hostname: 'storage.llun.dev'
      },
      'llun.test',
      database
    )

    const result = await storage.completePresignedUpload(actor, 'media-video-1')

    expect(extractVideoImage).toHaveBeenCalledTimes(1)
    expect(mockGenerateAltText).toHaveBeenCalledWith(
      altTextConfig,
      videoFrame,
      'image/jpeg'
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: expect.stringMatching(
            /^medias\/\d{4}-\d{2}-\d{2}\/[a-f0-9]+-thumbnail\.webp$/
          ),
          ContentType: 'image/webp'
        })
      })
    )
    expect(database.updateMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media-video-1',
        blurhash: expect.any(String),
        focus: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number)
        }),
        description: 'A generated video description',
        thumbnail: expect.objectContaining({
          path: expect.stringMatching(
            /^medias\/\d{4}-\d{2}-\d{2}\/[a-f0-9]+-thumbnail\.webp$/
          ),
          bytes: expect.any(Number),
          mimeType: 'image/webp',
          metaData: expect.objectContaining({
            width: expect.any(Number),
            height: expect.any(Number)
          })
        })
      })
    )
    expect(result?.description).toBe('A generated video description')
  })

  it('cleans up uploaded thumbnail when database updateMedia fails', async () => {
    const videoBuffer = Buffer.from('video-bytes')
    const videoFrame = ONE_PIXEL_PNG
    mockGetConfig.mockReturnValue({
      altText: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini'
      }
    })
    mockGenerateAltText.mockResolvedValue('A generated video description')
    vi.mocked(extractVideoImage).mockResolvedValue(videoFrame)

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-video-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/video.mp4',
        bytes: videoBuffer.length,
        mimeType: 'video/mp4',
        metaData: {
          width: 1920,
          height: 1080,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'video/mp4',
            size: videoBuffer.length
          }
        },
        fileName: 'video.mp4'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-video-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/video.mp4',
          bytes: videoBuffer.length,
          mimeType: 'video/mp4',
          metaData: {
            width: 1920,
            height: 1080,
            upload: { state: 'completed' }
          },
          fileName: 'video.mp4'
        }
      }
    } as never)

    database.updateMedia.mockRejectedValue(new Error('db update failed'))

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: videoBuffer.length,
          ContentType: 'video/mp4',
          ChecksumSHA1: checksumBase64,
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(videoBuffer)
          }
        }
      }
      if (
        command instanceof PutObjectCommand ||
        command instanceof DeleteObjectCommand
      ) {
        return {}
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        hostname: 'storage.llun.dev'
      },
      'llun.test',
      database
    )

    const result = await storage.completePresignedUpload(actor, 'media-video-1')
    expect(result?.id).toBe('media-video-1')

    const deleteCall = send.mock.calls.find(
      ([cmd]) => cmd instanceof DeleteObjectCommand
    )
    expect(deleteCall).toBeDefined()
    expect(deleteCall?.[0].input.Key).toMatch(
      /^medias\/\d{4}-\d{2}-\d{2}\/[a-f0-9]+-thumbnail\.webp$/
    )
  })

  it('cleans up replacedThumbnailPath when updateMedia returns one', async () => {
    const videoBuffer = Buffer.from('video-bytes')
    const videoFrame = ONE_PIXEL_PNG
    mockGetConfig.mockReturnValue({
      altText: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini'
      }
    })
    mockGenerateAltText.mockResolvedValue('A generated video description')
    vi.mocked(extractVideoImage).mockResolvedValue(videoFrame)

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-video-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/video.mp4',
        bytes: videoBuffer.length,
        mimeType: 'video/mp4',
        metaData: {
          width: 1920,
          height: 1080,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'video/mp4',
            size: videoBuffer.length
          }
        },
        fileName: 'video.mp4'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-video-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/video.mp4',
          bytes: videoBuffer.length,
          mimeType: 'video/mp4',
          metaData: {
            width: 1920,
            height: 1080,
            upload: { state: 'completed' }
          },
          fileName: 'video.mp4'
        }
      }
    } as never)

    database.updateMedia.mockResolvedValue({
      media: {
        id: 'media-video-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/video.mp4',
          bytes: videoBuffer.length,
          mimeType: 'video/mp4',
          metaData: {
            width: 1920,
            height: 1080,
            upload: { state: 'completed' }
          },
          fileName: 'video.mp4'
        },
        thumbnail: {
          path: 'medias/2026-01-01/new-thumbnail.webp',
          bytes: 100,
          mimeType: 'image/webp',
          metaData: { width: 10, height: 10 }
        }
      },
      replacedThumbnailPath: 'medias/2026-01-01/old-thumbnail.webp'
    } as never)

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: videoBuffer.length,
          ContentType: 'video/mp4',
          ChecksumSHA1: checksumBase64,
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(videoBuffer)
          }
        }
      }
      if (
        command instanceof PutObjectCommand ||
        command instanceof DeleteObjectCommand
      ) {
        return {}
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        hostname: 'storage.llun.dev'
      },
      'llun.test',
      database
    )

    await storage.completePresignedUpload(actor, 'media-video-1')

    const deleteCall = send.mock.calls.find(
      ([cmd]) =>
        cmd instanceof DeleteObjectCommand &&
        cmd.input.Key === 'medias/2026-01-01/old-thumbnail.webp'
    )
    expect(deleteCall).toBeDefined()
  })

  // Frame extraction is best-effort: the upload is already verified, so a clip
  // ffmpeg cannot decode must not turn a completed presigned upload into an error.
  it('completes presigned upload when the video preview frame cannot be extracted', async () => {
    const videoBuffer = Buffer.from('video-bytes')
    mockGetConfig.mockReturnValue({
      altText: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini'
      }
    })
    vi.mocked(extractVideoImage).mockRejectedValue(new Error('ffmpeg failed'))

    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-video-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/video.mp4',
        bytes: videoBuffer.length,
        mimeType: 'video/mp4',
        metaData: {
          width: 1920,
          height: 1080,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            checksumSha1Base64: checksumBase64,
            contentType: 'video/mp4',
            size: videoBuffer.length
          }
        },
        fileName: 'video.mp4'
      }
    } as never)

    database.markMediaUploadVerified.mockResolvedValue({
      transitioned: true,
      media: {
        id: 'media-video-1',
        actorId: 'actor-1',
        original: {
          path: 'medias/2026-01-01/video.mp4',
          bytes: videoBuffer.length,
          mimeType: 'video/mp4',
          metaData: {
            width: 1920,
            height: 1080,
            upload: {
              state: 'verified',
              verifiedAt: Date.now()
            }
          },
          fileName: 'video.mp4'
        }
      }
    } as never)

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: videoBuffer.length,
          ContentType: 'video/mp4',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array(videoBuffer)
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

    const result = await storage.completePresignedUpload(actor, 'media-video-1')

    expect(extractVideoImage).toHaveBeenCalledTimes(1)
    expect(mockGenerateAltText).not.toHaveBeenCalled()
    // The analysis failed, but the details still reach the row (and no
    // description or blurhash is written).
    expect(database.updateMedia).toHaveBeenCalledWith({
      mediaId: 'media-video-1',
      accountId: 'account-1',
      details: { inGallery: false }
    })
    expect(result).toMatchObject({ id: 'media-video-1', type: 'video' })
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
      fileName: string
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
      database.markMediaUploadVerified.mockResolvedValue({
        transitioned: true,
        media: row('verified')
      } as never)
      database.updateMedia.mockImplementation((async (params: {
        details?: Record<string, unknown>
      }) => ({
        media: {
          ...row('verified'),
          details: params.details
        }
      })) as never)
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

      expect(database.updateMedia).toHaveBeenCalledWith(
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
          originalPath: strippedKey
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
        expect(database.updateMedia).toHaveBeenLastCalledWith(
          expect.objectContaining({
            details: expect.objectContaining({ inGallery })
          })
        )

        await completeUpload(Buffer.from('video-bytes'), 'video/mp4', 'a.mp4')
        expect(database.updateMedia).toHaveBeenLastCalledWith(
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

      expect(database.updateMedia).toHaveBeenCalledWith({
        mediaId: 'media-1',
        accountId: 'account-1',
        details: { inGallery: true }
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

describe('S3FileStorage saveFile with a video', () => {
  const send = vi.fn()
  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor
  // The bytes the temp copy held when the extraction was handed its path.
  let extractedFrom: Buffer | null

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
    // null — so the thumbnail branch runs here exactly as it does in
    // production. ffmpeg reads the path it is given, so the mock does too: an
    // implementation that never wrote the temp copy — or that removed it too
    // early — fails here instead of passing on a path alone.
    extractedFrom = null
    vi.mocked(extractVideoImage).mockImplementation(async (filePath) => {
      extractedFrom = await fs.readFile(filePath)
      return ONE_PIXEL_PNG
    })
  })

  // The temp name is server-derived, so a traversing name cannot reach it —
  // the earlier `join(tmpdir(), randomHex + file.name)` needed three `..` to
  // escape, and with fewer it cancelled the prefix out onto a predictable
  // `<tmpdir>/evil.mp4`. ffmpeg also picks its demuxer from the path, and
  // `image2` beats content probing for an image extension paired with a `%0Nd`
  // pattern, so a good mp4 named `IMG_%04d.jpg` failed to open at all. All
  // three rows exercise the same production path — the name is not read at
  // all any more — and are kept apart to name each hazard they retire.
  it.each([
    { description: 'for a traversing name', fileName: '../../../../evil.mp4' },
    { description: 'for a parent reference', fileName: '../../evil.mp4' },
    { description: 'for an image sequence pattern', fileName: 'IMG_%04d.jpg' }
  ])(
    'builds the temp video name from the content type $description',
    async ({ fileName }) => {
      const file = new File([Buffer.from('video-bytes')], fileName, {
        type: 'video/mp4'
      })

      await createStorage().saveFile(actor, { file })

      expect(extractVideoImage).toHaveBeenCalledTimes(1)
      const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
      expect(resolve(dirname(tempPath))).toBe(resolve(tmpdir()))
      expect(basename(tempPath)).toMatch(/^[0-9a-f]{16}-video\.mp4$/)
    }
  )

  // The temp path only means anything if the bytes are actually there when
  // ffmpeg opens it — the `beforeEach` mock reads the file it is handed, so
  // dropping the write fails every video test here rather than passing green.
  it('hands the extraction a temp copy of the uploaded video', async () => {
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    expect(extractedFrom).toEqual(Buffer.from('video-bytes'))
  })

  it('removes the temp video once the frame is extracted', async () => {
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await createStorage().saveFile(actor, { file })

    expect(extractVideoImage).toHaveBeenCalledTimes(1)
    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    await expect(fs.access(tempPath)).rejects.toThrow()
  })

  // The realistic failure: ffmpeg finds no decodable frame, so
  // `extractVideoImage` rejects. Extraction runs before the
  // `PutObjectCommand`, so nothing is stored — a stored object with no `medias`
  // row is unreachable by everything except the cleanup script — and the temp
  // file must still go. Mirrors `localFile.test.ts`.
  it('stores nothing when the preview frame cannot be extracted', async () => {
    vi.mocked(extractVideoImage).mockRejectedValue(new Error('ffmpeg failed'))
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await expect(createStorage().saveFile(actor, { file })).rejects.toThrow(
      'ffmpeg failed'
    )

    expect(send).not.toHaveBeenCalled()
    expect(database.createMedia).not.toHaveBeenCalled()
    expect(extractVideoImage).toHaveBeenCalledTimes(1)
    const tempPath = vi.mocked(extractVideoImage).mock.calls[0][0]
    await expect(fs.access(tempPath)).rejects.toThrow()
  })

  // An audio-only mp4 — a voice memo, or an mp4 with its video track stripped —
  // is the systematic case for this branch, and the browser labels it
  // `video/mp4` from the extension. It is the caller's 422, so it must be
  // decided from the probe alone, before ffmpeg is ever spawned: extracting
  // first turned it into a logged 500 the client would retry.
  it('rejects a container with no video stream without extracting a frame', async () => {
    vi.mocked(extractVideoMeta).mockResolvedValue({
      streams: [{ codec_type: 'audio' }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
    })
    const file = new File([Buffer.from('audio-bytes')], 'memo.mp4', {
      type: 'video/mp4'
    })

    await expect(createStorage().saveFile(actor, { file })).rejects.toThrow(
      MediaValidationError
    )

    expect(extractVideoImage).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(database.createMedia).not.toHaveBeenCalled()
  })

  // Regression (F000): probed dimensions were recorded but never bounded, and
  // every decoded frame costs memory in proportion to its area.
  it('rejects a video above the dimension cap without extracting a frame', async () => {
    vi.mocked(extractVideoMeta).mockResolvedValue({
      streams: [{ codec_type: 'video', width: 15360, height: 8640 }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
    })
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await expect(createStorage().saveFile(actor, { file })).rejects.toThrow(
      MediaValidationError
    )

    expect(extractVideoImage).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(database.createMedia).not.toHaveBeenCalled()
  })

  it('stores nothing and writes no temp video when probing fails', async () => {
    vi.mocked(extractVideoMeta).mockRejectedValue(new Error('ffprobe failed'))
    const file = new File([Buffer.from('video-bytes')], 'clip.mp4', {
      type: 'video/mp4'
    })

    await expect(createStorage().saveFile(actor, { file })).rejects.toThrow(
      'ffprobe failed'
    )

    expect(extractVideoImage).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(database.createMedia).not.toHaveBeenCalled()
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

  // The image and video branches share one `createMedia` call, but the
  // original's path and metadata come from a different helper in each, so the
  // image branch needs its own coverage.
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

  // Every PutObjectCommand with the bytes it actually uploaded.
  let uploads: { key: string; body: Buffer }[]
  let deletedKeys: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    uploads = []
    deletedKeys = []
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectCommand) {
        deletedKeys.push(String(command.input.Key))
        return {}
      }
      if (!(command instanceof PutObjectCommand)) {
        throw new Error('Unexpected command')
      }
      const { Key, Body } = command.input
      uploads.push({ key: String(Key), body: readUploadBody(Body) })
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

  // Gives the invariant `readUploadBody` enforces a name, so it is discoverable
  // as a test rather than only as a helper that throws mid-upload. `toEqual` on
  // the mapped array rather than `.every(…)` so a failure names which body went
  // back to being a stream, and covers the count — an empty array satisfies
  // `.every()` vacuously.
  it('uploads images as in-memory buffers, not file-backed streams', async () => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600),
      thumbnail: await createPngFile(400, 300)
    })

    const bodies = vi
      .mocked(PutObjectCommand)
      .mock.calls.map(([input]) => input.Body)
    expect(bodies.map((body) => Buffer.isBuffer(body))).toEqual([true, true])
  })

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

  // Both fixtures above sit inside the 4000x4000 box, where the input and the
  // stored file have the same dimensions — so only an above-cap thumbnail
  // distinguishes `outputInfo` from the input `metaData`. Reporting the input's
  // dimensions is the bug #1334 fixed on the original's side.
  it('records an above-cap thumbnail at the dimensions it was stored at', async () => {
    await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600),
      thumbnail: await createPngFile(MAX_WIDTH + 200, (MAX_HEIGHT + 200) / 2)
    })

    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnail: expect.objectContaining({
          metaData: { width: MAX_WIDTH, height: MAX_HEIGHT / 2 }
        })
      })
    )
    await expect(
      sharp(uploaded('thumbnail').body).metadata()
    ).resolves.toMatchObject({ width: MAX_WIDTH, height: MAX_HEIGHT / 2 })
    // The original is bounded independently and is well inside the box.
    await expect(
      sharp(uploaded('original').body).metadata()
    ).resolves.toMatchObject({ width: 800, height: 600 })
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

  // `description` and `focus` are spread into the same `createMedia` call the
  // thumbnail is, so the refactor that unified the two branches could have
  // dropped them without any other test noticing.
  it('keeps the description and focus alongside the thumbnail', async () => {
    const attachment = await createStorage().saveFile(actor, {
      file: await createPngFile(800, 600),
      thumbnail: await createPngFile(400, 300),
      description: 'A blue square',
      focus: { x: 0.5, y: -0.25 }
    })

    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'A blue square',
        focus: { x: 0.5, y: -0.25 }
      })
    )
    expect(attachment?.description).toBe('A blue square')
    expect(attachment?.meta.focus).toEqual({ x: 0.5, y: -0.25 })
  })

  // `MediaSchema.thumbnail` accepts every ACCEPTED_FILE_TYPES entry, videos
  // included. Reaching sharp with one rejects with a plain Error — a 500, not
  // the 422 every other bad upload gets — and by then the original is already
  // in the bucket with no `medias` row to reclaim it by.
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
    expect(uploads).toHaveLength(0)
    expect(database.createMedia).not.toHaveBeenCalled()
  })

  // The dedicated thumbnail endpoint (PUT /api/v1/media/:id) has to answer the
  // same bytes the same way — it used to reach sharp unguarded and 500.
  it('refuses unreadable bytes on the standalone thumbnail path', async () => {
    const thumbnail = new File([Buffer.from('not-an-image')], 'evil.png', {
      type: 'image/png'
    })

    await expect(
      createStorage().saveThumbnail(actor, thumbnail)
    ).rejects.toThrow(MediaValidationError)
    expect(uploads).toHaveLength(0)
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
    expect(uploads).toHaveLength(0)
    // The same upload without the thumbnail still fits, so the thumbnail's
    // bytes are what tipped it over.
    await expect(
      createStorage().saveFile(actor, { file })
    ).resolves.toBeTruthy()
  })

  // What is left after that check is a storage fault, not bad input: it must
  // keep its own error — a logged 500, not a 422 telling the caller its
  // perfectly good thumbnail was rejected — while still reclaiming the original.
  it('reclaims the stored original when the thumbnail upload fails', async () => {
    const failure = new Error('S3 unavailable')
    let puts = 0
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectCommand) {
        deletedKeys.push(String(command.input.Key))
        return {}
      }
      puts += 1
      // The second PutObject is the thumbnail; the original is already stored.
      if (puts === 2) throw failure
      uploads.push({ key: String(command.input.Key), body: Buffer.alloc(0) })
      return {}
    })

    await expect(
      createStorage().saveFile(actor, {
        file: await createPngFile(800, 600),
        thumbnail: await createPngFile(400, 300)
      })
    ).rejects.toThrow(failure)
    expect(database.createMedia).not.toHaveBeenCalled()
    expect(deletedKeys).toEqual([uploads[0].key])
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
    expect(uploads).toHaveLength(0)
    expect(database.createMedia).not.toHaveBeenCalled()
  })

  it('refuses truncated bytes on the standalone thumbnail path', async () => {
    await expect(
      createStorage().saveThumbnail(
        actor,
        await createTruncatedPngFile(400, 300)
      )
    ).rejects.toThrow(MediaValidationError)
  })

  // The row is written last, so a database failure leaves both objects stored
  // and unreferenced — the same reclaim as a missing row.
  it('reclaims both stored objects when the media row write fails', async () => {
    database.createMedia.mockRejectedValue(new Error('deadlock detected'))

    await expect(
      createStorage().saveFile(actor, {
        file: await createPngFile(800, 600),
        thumbnail: await createPngFile(400, 300)
      })
    ).rejects.toThrow('deadlock detected')
    expect(deletedKeys).toEqual(uploads.map((upload) => upload.key))
    expect(deletedKeys).toHaveLength(2)
  })

  // A row is the only handle anything else has on these paths, so without one
  // both stored objects are unreachable.
  it('reclaims both stored objects when the media row cannot be created', async () => {
    database.createMedia.mockResolvedValue(null as never)

    await expect(
      createStorage().saveFile(actor, {
        file: await createPngFile(800, 600),
        thumbnail: await createPngFile(400, 300)
      })
    ).rejects.toThrow('Fail to store media')
    expect(deletedKeys).toEqual(uploads.map((upload) => upload.key))
    expect(deletedKeys).toHaveLength(2)
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

  it.each([
    {
      description:
        'prefers a caller-supplied thumbnail over the extracted video frame',
      suppliedThumbnail: { width: 400, height: 300 },
      storedThumbnail: { width: 400, height: 300 }
    },
    {
      description:
        'falls back to the extracted video frame when no thumbnail is supplied',
      suppliedThumbnail: null,
      // The mocked `extractVideoImage` frame.
      storedThumbnail: { width: 1, height: 1 }
    }
  ])('$description', async ({ suppliedThumbnail, storedThumbnail }) => {
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

    // The video plus exactly one thumbnail — the losing source is not uploaded.
    expect(uploads).toHaveLength(2)
    await expect(
      sharp(uploaded('thumbnail').body).metadata()
    ).resolves.toMatchObject(storedThumbnail)
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

  // Regression (F052): the route serving this is unauthenticated, and the
  // object used to be buffered whole — up to `media.maxFileSize` per request.
  it('streams the object rather than buffering it', async () => {
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    const result = await storage.getFile('medias/upload.png')

    expect(result).toMatchObject({
      type: 'stream',
      contentType: 'image/png',
      contentLength: 300 * 1024 * 1024
    })
    if (result?.type !== 'stream') throw new Error('expected a stream')
    expect(result.stream).toBeInstanceOf(ReadableStream)
    await expect(new Response(result.stream).text()).resolves.toBe(
      'image-bytes'
    )
  })

  // Regression (F095): the route does no row lookup, so any key in the bucket
  // was readable by anyone who could name it.
  it.each([
    'secrets/backup.sql',
    'fitness/2026-07-30/a1b2c3d4e5f60718.fit',
    'mediasx/upload.png',
    'medias/%2e%2e/secrets/backup.sql',
    'medias/..%2fsecrets/backup.sql',
    'medias\\..\\secrets/backup.sql',
    // S3 keys are case-sensitive and a leading `/` is part of the key: the
    // canonical form folds both away, so only the raw-key check refuses these.
    'Medias/upload.png',
    '/medias/upload.png'
  ])('refuses the key %j outside the media prefix', async (key: string) => {
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    await expect(storage.getFile(key)).resolves.toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('does not redirect to a key outside the media prefix', async () => {
    const storage = new S3FileStorage(
      { ...storageConfig, hostname: 'cdn.example.test' },
      'llun.test',
      database
    )

    await expect(
      storage.getFile('medias/%2e%2e/secrets/backup.sql')
    ).resolves.toBeNull()
    await expect(
      storage.getFile('medias/2026-07-30/a1b2c3d4e5f60718.webp')
    ).resolves.toEqual({
      type: 'redirect',
      redirectUrl:
        'https://cdn.example.test/medias/2026-07-30/a1b2c3d4e5f60718.webp'
    })
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

  // This block is the only cover `saveImageRendition` has, and it is the third
  // caller of `_uploadImageBufferToS3`. Capturing the body rather than
  // discarding it puts the rendition path behind the same buffer guard as the
  // other two, and gives `rendition.bytes` something real to be checked against.
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
        uploadedBodies.push(readUploadBody(command.input.Body))
      }
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
    // `bytes` and `metaData` come from the encode's `OutputInfo`. They are not
    // what catches a return to the temp file — `readUploadBody` throws upstream,
    // before this line ever runs. What they catch is the other way `OutputInfo`
    // goes wrong: reporting the INPUT image's size and dimensions instead,
    // which uploads a perfectly valid Buffer and so slips past every type
    // guard. Tying `bytes` to the bytes actually uploaded is what makes that
    // visible. The 40x30 source is under the cap, so the stored image keeps its
    // dimensions.
    expect(rendition?.bytes).toBe(uploadedBodies[0].length)
    expect(rendition?.metaData).toEqual({ width: 40, height: 30 })
    expect(database.createMedia).not.toHaveBeenCalled()
  })

  // Regression (F100): the encode kept the upload's EXIF, so a phone photo
  // posted from a Mastodon client published its GPS position and device to
  // anyone with the media URL. Orientation is applied by `.rotate()` first.
  it('strips EXIF, including GPS, from the stored image', async () => {
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#336699' }
    })
      .jpeg()
      .withExif({
        IFD0: { Make: 'LeakyCam', Model: 'Model X' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 0/1' }
      })
      .toBuffer()
    expect((await sharp(jpeg).metadata()).exif).toBeDefined()
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    await storage.saveFile(actor, {
      file: new File([new Uint8Array(jpeg)], 'photo.jpg', {
        type: 'image/jpeg'
      })
    })

    expect(uploadedBodies).toHaveLength(1)
    const stored = await sharp(uploadedBodies[0]).metadata()
    expect(stored.exif).toBeUndefined()
    expect(uploadedBodies[0].includes('LeakyCam')).toBe(false)
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

  // The uploaded WebPs, captured off each PutObjectCommand body.
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
        uploadedBodies.push(readUploadBody(command.input.Body))
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

  it('computes blurhash and smart focus on S3 saveFile', async () => {
    const result = await createStorage().saveFile(actor, {
      file: await createPngFile(200, 150)
    })

    expect(result?.blurhash).toBeDefined()
    expect(typeof result?.blurhash).toBe('string')
    expect(database.createMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        blurhash: expect.any(String),
        focus: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number)
        })
      })
    )
  })

  it('computes blurhash on S3 saveThumbnail', async () => {
    const thumbnail = await createStorage().saveThumbnail(
      actor,
      await createPngFile(100, 100)
    )

    expect(thumbnail?.blurhash).toBeDefined()
    expect(typeof thumbnail?.blurhash).toBe('string')
  })
})
