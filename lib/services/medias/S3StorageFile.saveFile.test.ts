import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, resolve } from 'path'
import sharp from 'sharp'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { S3FileStorage } from '@/lib/services/medias/S3StorageFile'
import {
  ONE_PIXEL_PNG,
  readUploadBody
} from '@/lib/services/medias/S3StorageFile.helpers'
import {
  MAX_FILE_SIZE,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import { extractVideoMeta } from '@/lib/services/medias/extractVideoMeta'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { Actor } from '@/lib/types/domain/actor'

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

  it('uploads a photo edit render as webp with no EXIF and no media row', async () => {
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#336699' }
    })
      .jpeg()
      .withExif({ IFD0: { Make: 'LeakyCam' } })
      .toBuffer()
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    const render = await storage.saveEditedImage({
      actor,
      buffer: jpeg,
      manualFocus: { x: 0.5, y: -0.25 }
    })

    expect(putObjectInput()).toMatchObject({ ContentType: 'image/webp' })
    expect(putObjectInput().Key).toMatch(
      /^medias\/\d{4}-\d{2}-\d{2}\/\w+\.webp$/
    )
    // The same shape the local driver answers.
    expect(render).toEqual({
      path: putObjectInput().Key,
      bytes: uploadedBodies[0].length,
      mimeType: 'image/webp',
      width: 40,
      height: 30,
      blurhash: expect.any(String),
      focus: { x: 0.5, y: -0.25 }
    })
    const stored = await sharp(uploadedBodies[0]).metadata()
    expect(stored.format).toBe('webp')
    expect(stored.exif).toBeUndefined()
    expect(uploadedBodies[0].includes('LeakyCam')).toBe(false)
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
