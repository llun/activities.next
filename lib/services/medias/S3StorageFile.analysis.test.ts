import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { S3FileStorage } from '@/lib/services/medias/S3StorageFile'
import {
  ONE_PIXEL_PNG,
  arrangePresignedDefaults,
  createPresignedFixtures
} from '@/lib/services/medias/S3StorageFile.helpers'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import { extractVideoMetaFromFile } from '@/lib/services/medias/extractVideoMeta'

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

describe('S3FileStorage presigned upload analysis', () => {
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
    // The analysis failed, but the details were committed with the
    // verification (and no description or blurhash is written).
    expect(database.markMediaUploadVerified).toHaveBeenCalledWith(
      expect.objectContaining({ details: { inGallery: false } })
    )
    expect(database.updateMedia).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: 'media-video-1', type: 'video' })
  })
})
