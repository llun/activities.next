import { S3Client } from '@aws-sdk/client-s3'
import { vi } from 'vitest'

import { Database } from '@/lib/database/types'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import { extractVideoMetaFromFile } from '@/lib/services/medias/extractVideoMeta'
import { Actor } from '@/lib/types/domain/actor'

// A real 1x1 PNG, so the video preview and image branches run sharp for real
// rather than against a stand-in the production code could never receive.
export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

// Every upload body this driver sends is an in-memory Buffer — a video's own
// bytes, an image's encoded output. Rejecting anything else is what keeps the
// temp-file round trip `_uploadImageBufferToS3` used to perform from coming
// back; that function's own comment explains why it must not. Draining a
// stream here instead would quietly accept the regression, so every `send`
// mock in this file routes its body through here.
export const readUploadBody = (body: unknown): Buffer => {
  if (!Buffer.isBuffer(body)) {
    throw new Error(
      `Expected an in-memory Buffer upload body, got ${typeof body}`
    )
  }
  return body
}

export const createPresignedFixtures = () => {
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

  return { send, actor, checksumHex, checksumBase64, database }
}

export type PresignedFixtures = ReturnType<typeof createPresignedFixtures>

/**
 * Arranges the mocks every presigned-upload-completion test starts from: an
 * S3 client whose `send` is the fixture's, a pending image upload, and a
 * database that verifies it. Call it from `beforeEach` after clearing mocks.
 */
export const arrangePresignedDefaults = ({
  send,
  actor,
  checksumHex,
  checksumBase64,
  database
}: PresignedFixtures) => {
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
}
