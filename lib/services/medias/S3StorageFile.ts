import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'
import { format } from 'date-fns/format'
import fs from 'fs/promises'
import { IncomingMessage } from 'http'
import sharp from 'sharp'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeReadableStream } from 'stream/web'

import { getConfig } from '@/lib/config'
import { MediaStorageS3Config } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { generateAltText } from '@/lib/services/altText/openai'
import {
  buildUploadMediaDetails,
  getGallerySettingsOrDefaults
} from '@/lib/services/gallery/uploadMediaDetails'
import { PRESIGNED_ANALYSIS_MAX_BYTES } from '@/lib/services/medias/constants'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { extractVideoMeta } from '@/lib/services/medias/extractVideoMeta'
import {
  FALLBACK_STORED_FILE_NAME,
  createMediaTempFilePath,
  getStoredMediaExtension,
  sanitizeStoredFileName
} from '@/lib/services/medias/fileName'
import {
  ImageAnalysisResult,
  analyzeImageBuffer
} from '@/lib/services/medias/imageAnalysis'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  type ImageOutputFormat,
  encodeImageOutput,
  getImageOutputFormatDetail
} from '@/lib/services/medias/imageOutputFormat'
import { getOwnerMediaAttachment } from '@/lib/services/medias/mediaDetails'
import { getMediaFileUrl } from '@/lib/services/medias/mediaFileUrl'
import {
  PresignedUploadValidationError,
  probePresignedMedia
} from '@/lib/services/medias/presignedProbe'
import { checkQuotaAvailable } from '@/lib/services/medias/quota'
import {
  MEDIA_OBJECT_KEY_PREFIX,
  isObjectStorageMediaKey
} from '@/lib/services/medias/reservedPaths'
import { saveMediaFile } from '@/lib/services/medias/saveMediaFile'
import { createStoredImagePipeline } from '@/lib/services/medias/storedImagePipeline'
import { readValidThumbnail } from '@/lib/services/medias/thumbnailInput'
import {
  ImageRenditionOutput,
  MediaSchema,
  MediaStorage,
  MediaStorageGetFileOutput,
  MediaStorageGetRedirectOutput,
  MediaStorageSaveFileOutput,
  MediaType,
  PresigedMediaInput,
  PresignedUrlOutput,
  SaveFileOptions,
  ThumbnailStorageOutput
} from '@/lib/services/medias/types'
import { getMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import { extractVideoPreviewFrame } from '@/lib/services/medias/videoPreview'
import { getAcceptedVideoDimensions } from '@/lib/services/medias/videoProbe'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { Media } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { createByteLimitTransform } from '@/lib/utils/streamLimit'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const normalizeContentType = (contentType?: string | string[]) => {
  const value = Array.isArray(contentType) ? contentType[0] : contentType
  return value?.split(';')[0]?.trim().toLowerCase() ?? ''
}

// The SDK's Node body is an IncomingMessage with `transformToWebStream` mixed
// in; a plain Readable or an existing web stream are accepted for other
// runtimes and S3-compatible clients.
const toWebReadableStream = (body: unknown): ReadableStream | null => {
  const sdkBody = body as { transformToWebStream?: () => ReadableStream }
  if (typeof sdkBody?.transformToWebStream === 'function') {
    return sdkBody.transformToWebStream()
  }
  if (body instanceof ReadableStream) return body
  if (body instanceof Readable) return Readable.toWeb(body) as ReadableStream
  return null
}

// The download side of `toWebReadableStream`: a Node stream to pipe into a
// file. `transformToByteArray` covers an SDK body with neither stream form.
const toNodeReadable = async (body: unknown): Promise<Readable> => {
  if (body instanceof Readable) return body
  if (body instanceof ReadableStream) {
    return Readable.fromWeb(body as NodeReadableStream)
  }
  const sdkBody = body as {
    transformToWebStream?: () => ReadableStream
    transformToByteArray?: () => Promise<Uint8Array>
  }
  if (typeof sdkBody?.transformToWebStream === 'function') {
    return Readable.fromWeb(
      sdkBody.transformToWebStream() as NodeReadableStream
    )
  }
  if (typeof sdkBody?.transformToByteArray === 'function') {
    return Readable.from([Buffer.from(await sdkBody.transformToByteArray())])
  }
  throw new Error('Unable to read presigned media object body')
}

const sha1HexToBase64 = (checksum: string) =>
  Buffer.from(checksum, 'hex').toString('base64')

export { PresignedUploadValidationError }

const isS3NotFoundError = (error: unknown) => {
  const nodeError = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    nodeError.name === 'NoSuchKey' ||
    nodeError.name === 'NotFound' ||
    nodeError.$metadata?.httpStatusCode === 404
  )
}

const getObjectMetadataChecksumSha1 = (
  metadata: Record<string, string> | undefined
) =>
  metadata?.checksumsha1 ??
  metadata?.checksumSha1 ??
  metadata?.['checksum-sha1'] ??
  null

const PRESIGNED_UPLOAD_UNHOISTABLE_HEADERS = new Set([
  'x-amz-checksum-sha1',
  'x-amz-meta-checksumsha1'
])

const PRESIGNED_UPLOAD_SIGNED_HEADERS = new Set(['content-type'])

interface UploadImageOptions {
  isThumbnail?: boolean
  format?: ImageOutputFormat
  manualFocus?: { x: number; y: number } | null
}

export class S3FileStorage implements MediaStorage {
  private static _instance: MediaStorage

  private _config: MediaStorageS3Config
  private _host: string
  private _database: Database

  private _client: S3Client

  static getStorage(
    config: MediaStorageS3Config,
    host: string,
    database: Database
  ) {
    if (!S3FileStorage._instance) {
      S3FileStorage._instance = new S3FileStorage(config, host, database)
    }
    return S3FileStorage._instance
  }

  constructor(config: MediaStorageS3Config, host: string, database: Database) {
    this._config = config
    this._host = host
    this._database = database
    this._client = createStorageS3Client(config)
  }

  async getFile(filePath: string) {
    // `GET /api/v1/files/...` is unauthenticated and does no row lookup, so
    // without this it would read (or redirect to) ANY key in the bucket.
    if (!isObjectStorageMediaKey(filePath)) return null

    const { bucket, hostname } = this._config
    if (hostname) {
      return MediaStorageGetRedirectOutput.parse({
        type: 'redirect',
        redirectUrl: `https://${hostname}/${filePath}`
      })
    }

    const s3client = this._client
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: filePath
    })
    const object = await s3client.send(command)
    if (!object.Body) return null

    // Streamed straight through rather than buffered: the route is
    // unauthenticated, and a buffered read let anyone make the server hold a
    // whole object — up to `media.maxFileSize` — in memory per request.
    const stream = toWebReadableStream(object.Body)
    if (!stream) return null
    return MediaStorageGetFileOutput.parse({
      type: 'stream',
      contentType:
        object.ContentType ??
        (object.Body as IncomingMessage).headers?.['content-type'] ??
        'application/octet-stream',
      stream,
      contentLength:
        typeof object.ContentLength === 'number' &&
        Number.isFinite(object.ContentLength) &&
        object.ContentLength >= 0
          ? object.ContentLength
          : null
    })
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const { bucket } = this._config
      const s3client = this._client
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: filePath
      })
      await s3client.send(command)
      return true
    } catch (e) {
      const error = e as Error
      // If file doesn't exist (NoSuchKey), consider it already deleted (success)
      if (error.name === 'NoSuchKey') {
        return true
      }
      logger.error({
        message: 'Failed to delete file from S3',
        filePath,
        error: error.message
      })
      return false
    }
  }

  isPresigedSupported() {
    return true
  }

  async getPresigedForSaveFileUrl(
    actor: Actor,
    presignedMedia: PresigedMediaInput
  ) {
    // Check quota before generating presigned URL
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      presignedMedia.size
    )
    if (!quotaCheck.available) {
      throw new Error(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    const { bucket } = this._config
    // The client supplies this one directly (there is no multipart part to read
    // it from), so it is the least trustworthy name of all.
    const fileName = sanitizeStoredFileName(presignedMedia.fileName)

    const currentTime = Date.now()
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')

    const ext = getStoredMediaExtension(presignedMedia.contentType, fileName)
    const mimeType =
      presignedMedia.contentType === 'video/quicktime'
        ? 'video/mp4'
        : presignedMedia.contentType
    const checksumSha1Base64 = sha1HexToBase64(presignedMedia.checksum)

    const key = `${MEDIA_OBJECT_KEY_PREFIX}${timeDirectory}/${randomPrefix}${ext}`
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: presignedMedia.contentType,
      ContentLength: presignedMedia.size,
      ChecksumSHA1: checksumSha1Base64,
      Metadata: {
        checksumSha1: presignedMedia.checksum
      }
    })
    const url = await getSignedUrl(this._client, command, {
      expiresIn: 600,
      unhoistableHeaders: PRESIGNED_UPLOAD_UNHOISTABLE_HEADERS,
      // The presigner leaves Content-Type UNSIGNED by default, so the holder of
      // this URL could store the object as `text/html` — and an object that is
      // never completed still sits in the bucket. Signing it binds the stored
      // type to the declared, allow-listed one.
      signableHeaders: PRESIGNED_UPLOAD_SIGNED_HEADERS
    })
    const storedMedia = await this._database.createMedia({
      actorId: actor.id,
      original: {
        path: key,
        bytes: presignedMedia.size,
        mimeType,
        metaData: {
          width: presignedMedia.width ?? 0,
          height: presignedMedia.height ?? 0,
          upload: {
            state: 'pending',
            checksumSha1: presignedMedia.checksum,
            checksumSha1Base64,
            contentType: presignedMedia.contentType,
            size: presignedMedia.size
          }
        },
        fileName
      }
    })
    if (!storedMedia) {
      return null
    }
    return PresignedUrlOutput.parse({
      url,
      saveFileOutput: {
        id: `${storedMedia.id}`,
        type: presignedMedia.contentType.startsWith('video')
          ? MediaType.enum.video
          : MediaType.enum.image,
        mime_type: mimeType,
        url: `https://${this._host}/api/v1/files/${key}`,
        preview_url: null,
        text_url: null,
        remote_url: null,
        preview_remote_url: null,
        meta: {
          original: {
            width: presignedMedia.width ?? 0,
            height: presignedMedia.height ?? 0,
            size: `${presignedMedia.width}x${presignedMedia.height}`,
            aspect: presignedMedia.width / presignedMedia.height
          }
        },
        description: null,
        blurhash: null
      },
      headers: {
        // Signed above, so the PUT must carry exactly this value.
        'Content-Type': presignedMedia.contentType,
        'x-amz-checksum-sha1': checksumSha1Base64,
        'x-amz-meta-checksumsha1': presignedMedia.checksum
      }
    })
  }

  async completePresignedUpload(actor: Actor, mediaId: string) {
    const accountId = actor.account?.id
    if (!accountId) {
      throw new Error('Actor account is required to complete media upload')
    }

    const media = await this._database.getMediaByIdForAccount({
      mediaId,
      accountId
    })
    if (!media) {
      return null
    }

    const upload = media.original.metaData.upload
    if (upload?.state === 'verified') {
      return await this._getSaveFileOutput(media)
    }
    if (!upload || upload.state !== 'pending') {
      throw new Error('Media upload is not pending verification')
    }

    try {
      const object = await this._client
        .send(
          new HeadObjectCommand({
            Bucket: this._config.bucket,
            Key: media.original.path
          })
        )
        .catch((error) => {
          if (isS3NotFoundError(error)) {
            throw new PresignedUploadValidationError(
              'Uploaded object is missing'
            )
          }
          throw error
        })
      const expectedSize = upload.size ?? media.original.bytes
      const expectedContentType = normalizeContentType(
        upload.contentType ?? media.original.mimeType
      )
      const actualContentType = normalizeContentType(object.ContentType)

      if (object.ContentLength !== expectedSize) {
        throw new PresignedUploadValidationError(
          'Uploaded object does not match expected size'
        )
      }
      if (actualContentType !== expectedContentType) {
        throw new PresignedUploadValidationError(
          'Uploaded object does not match expected content type'
        )
      }
      const metadataChecksumSha1 = getObjectMetadataChecksumSha1(
        object.Metadata
      )
      if (
        object.ChecksumSHA1 &&
        upload.checksumSha1Base64 &&
        object.ChecksumSHA1 !== upload.checksumSha1Base64
      ) {
        throw new PresignedUploadValidationError(
          'Uploaded object does not match expected checksum'
        )
      }
      if (
        !object.ChecksumSHA1 &&
        upload.checksumSha1 &&
        metadataChecksumSha1 !== upload.checksumSha1
      ) {
        throw new PresignedUploadValidationError(
          metadataChecksumSha1
            ? 'Uploaded object does not match expected checksum'
            : 'Uploaded object does not include expected checksum'
        )
      }

      // The bytes are the client's, not ours: the checks above only compare
      // them with the client's own claims. Probe them the way the sync upload
      // path does before the media becomes usable, and refuse (deleting object
      // and row) anything that is not the media type it was declared as.
      const extension = getStoredMediaExtension(
        media.original.mimeType,
        media.original.fileName ?? FALLBACK_STORED_FILE_NAME
      )
      const tempFilePath = await this._downloadObjectToTempFile(
        media.original.path,
        extension,
        expectedSize
      )
      try {
        const dimensions = await probePresignedMedia(
          tempFilePath,
          expectedContentType
        )

        // Read the details from the client's bytes BEFORE the metadata is
        // stripped from them, and before any size or analysis gate: the
        // owner's gallery default applies to every upload, however large.
        const prepared = await this._preparePresignedDetails(
          media,
          tempFilePath,
          expectedSize
        )

        // The object is public and the client's bytes still carry their EXIF
        // (GPS position, device serials), which the owner's place precision
        // exists to withhold. Write a copy without it to a NEW key and swap
        // that in as the original in the same update that marks the upload
        // verified. The client's object is left untouched until then, so a
        // retried or concurrent completion still finds the bytes it validates
        // against (an in-place overwrite made every retry fail the size check
        // and delete a good upload).
        const stripped = media.original.mimeType.startsWith('image')
          ? await this._stripPresignedImageMetadata(
              actor,
              media.original.path,
              tempFilePath,
              expectedContentType,
              expectedSize
            )
          : undefined

        let result
        try {
          result = await this._database.markMediaUploadVerified({
            mediaId,
            accountId,
            verifiedAt: Date.now(),
            dimensions,
            ...(stripped === undefined
              ? null
              : { originalBytes: stripped.bytes, originalPath: stripped.key })
          })
        } catch (error) {
          // The upload stays pending with the client's object intact, so a
          // retry starts over; only the copy made for this attempt goes.
          if (stripped) {
            await this.deleteFile(stripped.key).catch(() => false)
          }
          throw error
        }
        if (!result || !result.transitioned) {
          // Gone, or another completion verified it first: that call owns the
          // swap and the decoration, and this attempt's copy is unused.
          if (stripped) {
            await this.deleteFile(stripped.key).catch(() => false)
          }
          return result ? await this._getSaveFileOutput(result.media) : null
        }
        const verifiedMedia = result.media
        if (stripped) {
          await this._deleteReplacedPresignedOriginal(media.original.path)
        }

        const output = await this._decoratePresignedMedia(
          media,
          accountId,
          tempFilePath,
          expectedSize,
          prepared
        )
        return output ?? (await this._getSaveFileOutput(verifiedMedia))
      } finally {
        await fs.unlink(tempFilePath).catch(() => undefined)
      }
    } catch (error) {
      if (error instanceof PresignedUploadValidationError) {
        // A concurrent completion may have verified the upload and removed
        // the client's object while this one was reading it — the "missing"
        // seen here is then that call's cleanup, not a bad upload. Never
        // delete a row that is no longer pending.
        const current = await this._database
          .getMediaByIdForAccount({ mediaId, accountId })
          .catch(() => null)
        if (current?.original.metaData.upload?.state === 'verified') {
          return await this._getSaveFileOutput(current)
        }
        await this.deleteFile(media.original.path).catch(() => false)
        await this._database.deleteMedia({ mediaId }).catch(() => false)
      }
      throw error
    }
  }

  // The client's own object, replaced by the stripped copy the row now points
  // at. It still carries the EXIF the strip removed and the files route serves
  // any media key, so a failure to remove it is logged as an error rather than
  // swallowed.
  private async _deleteReplacedPresignedOriginal(key: string) {
    try {
      await this._client.send(
        new DeleteObjectCommand({ Bucket: this._config.bucket, Key: key })
      )
    } catch (error) {
      logger.error({
        message:
          'Failed to delete the unstripped original of a presigned image upload',
        key,
        err: toLoggableError(error)
      })
    }
  }

  // Streams the uploaded object to a server-named temp file, so probing a
  // large video holds none of it in memory. A missing object is the client's
  // failure; any other storage error is transient and propagates as-is, so
  // the row and object survive for a retry.
  private async _downloadObjectToTempFile(
    key: string,
    extension: string,
    maxBytes: number
  ): Promise<string> {
    const tempFilePath = createMediaTempFilePath(`presigned${extension}`)
    // `wx` (O_EXCL), as in `extractVideoPreviewFrame`: never follow or clobber
    // a file already at the path.
    const tempFile = await fs.open(tempFilePath, 'wx')
    try {
      const response = await this._client
        .send(new GetObjectCommand({ Bucket: this._config.bucket, Key: key }))
        .catch((error) => {
          if (isS3NotFoundError(error)) {
            throw new PresignedUploadValidationError(
              'Uploaded object is missing'
            )
          }
          throw error
        })
      if (!response.Body) {
        throw new PresignedUploadValidationError('Uploaded object is missing')
      }
      await pipeline(
        await toNodeReadable(response.Body),
        createByteLimitTransform(maxBytes, 'Presigned media object'),
        tempFile.createWriteStream()
      )
      return tempFilePath
    } catch (error) {
      await tempFile.close().catch(() => undefined)
      await fs.unlink(tempFilePath).catch(() => undefined)
      throw error
    }
  }

  // The upload's details (EXIF, gear, place, gallery membership), built from
  // the client's original bytes. Runs before the size and analysis gates and
  // outside their error handling, so a large video or a failed analysis still
  // gets the owner's `galleryDefault`. A video, an image over the analysis cap
  // or one that cannot be read has no EXIF here and gets `original: null`.
  // Never throws.
  private async _preparePresignedDetails(
    media: Media,
    tempFilePath: string,
    size: number
  ): Promise<{
    buffer: Buffer | null
    details: Partial<MediaDetailsRecord>
  }> {
    const isImage = media.original.mimeType.startsWith('image')
    const isVideo = media.original.mimeType.startsWith('video')
    if (!isImage && !isVideo) return { buffer: null, details: {} }

    let buffer: Buffer | null = null
    if (size <= PRESIGNED_ANALYSIS_MAX_BYTES) {
      buffer = await fs.readFile(tempFilePath).catch((error) => {
        logger.warn({
          message: 'Failed to read presigned media upload for analysis',
          err: toLoggableError(error)
        })
        return null
      })
    }
    const details = await buildUploadMediaDetails({
      database: this._database,
      actorId: media.actorId,
      original: isImage ? buffer : null
    })
    return { buffer, details }
  }

  // Stores a copy of the original without its metadata under a fresh key next
  // to it, and returns that key and its size. The re-encode keeps the declared
  // format (so the content type and extension stay valid) and applies the EXIF
  // orientation, which is the one piece of metadata that changes how the
  // pixels display — the probed dimensions already account for it. Failing to
  // produce a clean copy fails closed: the upload is refused and removed
  // rather than left public with its metadata. A transient storage error
  // propagates, leaving the upload pending (and the client's object as it
  // was) for a retry.
  //
  // The copy is re-encoded, so it can come out larger than what was uploaded
  // (and presign-time checks only saw the original). A copy larger than the
  // original is re-encoded once more at a lower quality; one that still
  // exceeds the per-file limit, or would push the account past its quota by
  // the growth, is refused like a failed re-encode — before anything is
  // written to storage.
  private async _stripPresignedImageMetadata(
    actor: Actor,
    key: string,
    tempFilePath: string,
    contentType: string,
    originalBytes: number
  ): Promise<{ key: string; bytes: number }> {
    let stripped: Buffer
    try {
      const encode = (quality: number) => {
        const image = sharp(tempFilePath).rotate()
        return contentType === 'image/png'
          ? image.png({ compressionLevel: quality === 95 ? 6 : 9 }).toBuffer()
          : image.jpeg({ quality }).toBuffer()
      }
      stripped = await encode(95)
      if (stripped.length > originalBytes) {
        stripped = await encode(85)
      }
    } catch (error) {
      logger.warn({
        message: 'Failed to strip metadata from a presigned image upload',
        err: toLoggableError(error)
      })
      throw new PresignedUploadValidationError(
        'Uploaded image could not be processed'
      )
    }
    const maxFileSize = await getMaxMediaUploadSize(this._database)
    if (stripped.length > maxFileSize) {
      throw new PresignedUploadValidationError(
        'Uploaded image is too large once its metadata is removed'
      )
    }
    const bytesDelta = stripped.length - originalBytes
    if (bytesDelta > 0) {
      const quotaCheck = await checkQuotaAvailable(
        this._database,
        actor,
        bytesDelta
      )
      if (!quotaCheck.available) {
        throw new PresignedUploadValidationError(
          'Storage quota exceeded once the uploaded image metadata is removed'
        )
      }
    }
    // Same directory and extension as the presigned key (both server-made),
    // new random name.
    const nameStart = key.lastIndexOf('/') + 1
    const extensionStart = key.lastIndexOf('.')
    const extension =
      extensionStart >= nameStart ? key.slice(extensionStart) : ''
    const strippedKey = `${key.slice(0, nameStart)}${crypto
      .randomBytes(8)
      .toString('hex')}${extension}`
    await this._client.send(
      new PutObjectCommand({
        Bucket: this._config.bucket,
        Key: strippedKey,
        ContentType: contentType,
        Body: stripped
      })
    )
    return { key: strippedKey, bytes: stripped.length }
  }

  // Blurhash, focus, alt text and a video's poster. Decoration only: the media
  // is already verified, so a failure here is logged and the upload stands.
  // Whatever happens to the analysis, the details built from the original
  // still reach the row. Returns the updated attachment, or null when nothing
  // was updated.
  private async _decoratePresignedMedia(
    media: Media,
    accountId: string,
    tempFilePath: string,
    size: number,
    prepared: { buffer: Buffer | null; details: Partial<MediaDetailsRecord> }
  ): Promise<MediaStorageSaveFileOutput | null> {
    const mediaId = media.id
    const { details, buffer } = prepared
    const isVideo = media.original.mimeType.startsWith('video')
    if (!media.original.mimeType.startsWith('image') && !isVideo) return null
    if (size > PRESIGNED_ANALYSIS_MAX_BYTES || !buffer) {
      return this._persistPresignedDetails(mediaId, accountId, details)
    }

    try {
      // A video is analysed and described from its representative preview
      // frame; the stored video itself is not an image sharp or the vision
      // model can read.
      const previewBuffer = isVideo
        ? await extractVideoPreviewFrame(
            buffer,
            getStoredMediaExtension(
              media.original.mimeType,
              media.original.fileName ?? FALLBACK_STORED_FILE_NAME
            )
          )
        : buffer
      const analysis = await analyzeImageBuffer(previewBuffer, {
        manualFocus: media.focus
      })
      let generatedDescription: string | null = null
      if (media.description == null) {
        const { altText } = getConfig()
        const { autoDescribe } = await getGallerySettingsOrDefaults(
          this._database,
          media.actorId
        )
        if (altText && autoDescribe) {
          // generateAltText never throws — its entire body is wrapped in
          // try/catch and it returns null on any failure, logging its own
          // warn. A try/catch here would be dead code that only double-logs
          // the same failure.
          generatedDescription = await generateAltText(
            altText,
            previewBuffer,
            isVideo ? 'image/jpeg' : media.original.mimeType
          )
        }
      }
      let storedThumbnail: {
        path: string
        outputInfo: { size: number; width?: number; height?: number }
        contentType: string
      } | null = null

      if (isVideo && previewBuffer) {
        const uploaded = await this._uploadImageBufferToS3(
          Date.now(),
          previewBuffer,
          { isThumbnail: true }
        )
        storedThumbnail = {
          path: uploaded.path,
          outputInfo: uploaded.outputInfo,
          contentType: uploaded.contentType
        }
      }

      if (
        !analysis.blurhash &&
        !analysis.focus &&
        !generatedDescription &&
        !storedThumbnail &&
        Object.keys(details).length === 0
      ) {
        return null
      }

      try {
        const updated = await this._database.updateMedia({
          mediaId,
          accountId,
          blurhash: analysis.blurhash,
          focus: analysis.focus ?? undefined,
          description: generatedDescription ?? undefined,
          details,
          ...(storedThumbnail
            ? {
                thumbnail: {
                  path: storedThumbnail.path,
                  bytes: storedThumbnail.outputInfo.size,
                  mimeType: storedThumbnail.contentType,
                  metaData: {
                    width: storedThumbnail.outputInfo.width ?? 0,
                    height: storedThumbnail.outputInfo.height ?? 0
                  }
                }
              }
            : {})
        })
        if (updated?.media) {
          if (updated.replacedThumbnailPath) {
            await this.deleteFile(updated.replacedThumbnailPath).catch(
              () => false
            )
          }
          return await this._getSaveFileOutput(updated.media)
        }
        if (storedThumbnail) {
          await this.deleteFile(storedThumbnail.path).catch(() => false)
        }
      } catch (updateError) {
        if (storedThumbnail) {
          await this.deleteFile(storedThumbnail.path).catch(() => false)
        }
        throw updateError
      }
    } catch (error) {
      logger.warn({
        message: 'Failed to analyze presigned media upload',
        err: toLoggableError(error)
      })
      return this._persistPresignedDetails(mediaId, accountId, details)
    }
    return null
  }

  // The fallback when the analysis cannot run: only the details are written.
  private async _persistPresignedDetails(
    mediaId: string,
    accountId: string,
    details: Partial<MediaDetailsRecord>
  ): Promise<MediaStorageSaveFileOutput | null> {
    if (Object.keys(details).length === 0) return null
    try {
      const updated = await this._database.updateMedia({
        mediaId,
        accountId,
        details
      })
      return updated?.media
        ? await this._getSaveFileOutput(updated.media)
        : null
    } catch (error) {
      logger.warn({
        message: 'Failed to store the details of a presigned media upload',
        err: toLoggableError(error)
      })
      return null
    }
  }

  async saveFile(actor: Actor, media: MediaSchema, options?: SaveFileOptions) {
    const currentTime = Date.now()
    return saveMediaFile({
      database: this._database,
      host: this._host,
      actor,
      media,
      withGalleryDetails: options?.withGalleryDetails,
      driver: {
        saveVideoFile: (file, options) =>
          this._uploadVideoToS3(currentTime, file, options),
        saveImageFile: (file, options) =>
          this._uploadImageToS3(currentTime, file, options),
        saveThumbnailBuffer: (buffer) =>
          this._uploadImageBufferToS3(currentTime, buffer, {
            isThumbnail: true
          }),
        deleteFile: (filePath) => this.deleteFile(filePath)
      }
    })
  }

  async saveThumbnail(
    actor: Actor,
    file: File
  ): Promise<ThumbnailStorageOutput | null> {
    if (!file.type.startsWith('image')) return null
    // Same validation saveFile applies, so the dedicated thumbnail endpoint
    // answers unusable bytes with the same 422 rather than a 500.
    const buffer = await readValidThumbnail(file)

    // Enforce the account quota like saveFile, so a thumbnail replacement can't
    // push usage past the limit.
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      file.size
    )
    if (!quotaCheck.available) {
      throw new MediaValidationError(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    // Use the stored image's actual size/dimensions (outputInfo), not the input
    // image's metadata.
    const { outputInfo, path, contentType, blurhash } =
      await this._uploadImageBufferToS3(Date.now(), buffer, {
        isThumbnail: true
      })
    return {
      path,
      bytes: outputInfo.size,
      mimeType: contentType,
      metaData: {
        width: outputInfo.width,
        height: outputInfo.height
      },
      blurhash
    }
  }

  async saveImageRendition(
    actor: Actor,
    file: File,
    imageFormat: ImageOutputFormat
  ): Promise<ImageRenditionOutput | null> {
    if (!file.type.startsWith('image')) return null

    // Refuse the write when the account is already over quota. Note the bytes
    // are not metered afterwards: usage is counter-based and those counters are
    // maintained alongside `medias` rows, which a rendition has none of. Keep
    // renditions few and small.
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      file.size
    )
    if (!quotaCheck.available) {
      throw new MediaValidationError(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    const { outputInfo, path, contentType } = await this._uploadImageToS3(
      Date.now(),
      file,
      { format: imageFormat }
    )
    return {
      path,
      url: getMediaFileUrl(this._host, path),
      bytes: outputInfo.size,
      mimeType: contentType,
      metaData: {
        width: outputInfo.width,
        height: outputInfo.height
      }
    }
  }

  private async _uploadImageToS3(
    currentTime: number,
    file: File,
    options: UploadImageOptions = {}
  ) {
    return this._uploadImageBufferToS3(
      currentTime,
      Buffer.from(await file.arrayBuffer()),
      options
    )
  }

  private async _uploadImageBufferToS3(
    currentTime: number,
    buffer: Buffer,
    {
      isThumbnail = false,
      format: imageFormat = DEFAULT_IMAGE_OUTPUT_FORMAT,
      manualFocus
    }: UploadImageOptions = {}
  ) {
    const { bucket } = this._config
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const { extension, contentType } = getImageOutputFormatDetail(imageFormat)

    const resizedImage = encodeImageOutput(
      createStoredImagePipeline(buffer),
      imageFormat
    )

    // `metadata()` reports the INPUT image; the `resolveWithObject` form of
    // `toBuffer()` resolves with the encoded bytes AND the OUTPUT info
    // (post-resize/re-encode dimensions and byte size). Read metadata from a
    // separate sharp instance so the two operations don't run concurrently on
    // the same pipeline.
    //
    // The encoded image is handed to S3 as a buffer rather than written to a
    // temp file and streamed back off disk. Nothing here wanted a file: the
    // round trip only existed to produce a stream body, and it cost a write, a
    // read and an unlink per upload plus a temp file to leak on a crash. It
    // also made `next build` warn that dynamic filesystem access forces the
    // whole project to be traced into the server bundle, because `tmpdir()`
    // and the `fs.open` on it are not statically analysable. A buffer body is
    // what `_uploadVideoToS3` already sends, for far larger payloads.
    const [metaData, { data: imageBody, info: outputInfo }, analysis] =
      await Promise.all([
        sharp(buffer).metadata(),
        // No `keepExif()`: EXIF carries GPS position and device identifiers,
        // and the stored file is public. Orientation is already applied by
        // the pipeline's `.rotate()`.
        resizedImage.toBuffer({ resolveWithObject: true }),
        analyzeImageBuffer(buffer, { manualFocus })
      ])

    const timeDirectory = format(currentTime, 'yyyy-MM-dd')
    const path = `${MEDIA_OBJECT_KEY_PREFIX}${timeDirectory}/${randomPrefix}${isThumbnail ? '-thumbnail' : ''}.${extension}`
    const s3client = this._client
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      ContentType: contentType,
      Body: imageBody
    })
    await s3client.send(command)
    // `previewImage` is always null here — it only exists so an image and a
    // video upload share one result shape in `saveFile`, as they do in the
    // local driver.
    return {
      image: resizedImage,
      metaData,
      outputInfo,
      path,
      contentType,
      previewImage: null,
      blurhash: analysis.blurhash,
      focus: analysis.focus
    }
  }

  // Mirrors `LocalFileStorage._saveVideoFile`: probe, validate, extract the
  // preview frame from a temp copy, and only then store.
  private async _uploadVideoToS3(
    currentTime: number,
    file: File,
    options: { manualFocus?: { x: number; y: number } | null } = {}
  ) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const probe = await extractVideoMeta(buffer)
    // Container, video stream and dimension cap — shared with the other
    // driver and the presigned completion.
    const metaData = getAcceptedVideoDimensions(probe)

    const ext = getStoredMediaExtension(file.type, file.name)
    // Input that is not a video the instance accepts was already rejected
    // above, without spawning ffmpeg. What can still fail here is the frame
    // itself, and it fails before anything is uploaded.
    const previewImage = await extractVideoPreviewFrame(buffer, ext)

    const { bucket } = this._config
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')
    const path = `${MEDIA_OBJECT_KEY_PREFIX}${timeDirectory}/${randomPrefix}${ext}`
    const s3client = this._client
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      ContentType: file.type,
      Body: buffer
    })
    await s3client.send(command)

    let analysis: ImageAnalysisResult = {
      blurhash: null,
      focus: options.manualFocus ?? null
    }
    if (previewImage) {
      analysis = await analyzeImageBuffer(previewImage, {
        manualFocus: options.manualFocus
      })
    }

    return {
      path,
      metaData,
      contentType: file.type,
      previewImage,
      blurhash: analysis.blurhash,
      focus: analysis.focus
    }
  }

  private _getSaveFileOutput(
    media: Media
  ): Promise<MediaStorageSaveFileOutput> {
    return getOwnerMediaAttachment(this._database, media, this._host)
  }
}
