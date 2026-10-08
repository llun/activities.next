import type {
  MediaStorageSaveFileOutput,
  PresignedUrlOutput
} from '@/lib/services/medias/types'
import type {
  MediaPlacePrecision,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'
import type {
  Attachment,
  UploadedAttachment
} from '@/lib/types/domain/attachment'
import { getMediaWidthAndHeight } from '@/lib/utils/getMediaWidthAndHeight'
import { toIdPathSegment } from '@/lib/utils/urlToId'
import { waitFor } from '@/lib/utils/waitFor'

import { parseApiError } from './http'

export interface UploadMediaParams {
  media: File
  thumbnail?: File
  description?: string
}

export const uploadMedia = async ({
  media,
  thumbnail,
  description
}: UploadMediaParams) => {
  const path = '/api/v2/media'
  const form = new FormData()
  form.append('file', media)
  if (thumbnail) form.append('thumbnail', thumbnail)
  if (description) form.append('description', description)
  const response = await fetch(path, {
    method: 'POST',
    body: form
  })
  if (response.status !== 200) return null
  return response.json()
}

export interface CreateUploadPresignedUrlParams {
  media: File
}

export const createUploadPresignedUrl = async ({
  media
}: CreateUploadPresignedUrlParams): Promise<{
  presigned: PresignedUrlOutput
} | null> => {
  const path = '/api/v1/medias/presigned'
  const checksum = await crypto.subtle.digest(
    'SHA-1',
    await media.arrayBuffer()
  )
  const hashArray = Array.from(new Uint8Array(checksum))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  const widthAndHeight = await getMediaWidthAndHeight(media)
  const body = {
    fileName: media.name,
    checksum: hashHex,
    contentType: media.type,
    size: media.size,
    ...widthAndHeight
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (response.status === 404) return null
  if (response.status !== 200) throw new Error('Failed to get presigned URL')
  return response.json()
}

export interface UploadFileToPresignedUrlParams {
  presignedUrl: string
  media: File
  headers?: Record<string, string>
}

export const uploadFileToPresignedUrl = async ({
  presignedUrl,
  media,
  headers = {}
}: UploadFileToPresignedUrlParams) => {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: media,
    headers: { 'Content-Type': media.type, ...headers }
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to upload to storage: ${response.status} ${response.statusText}${errorText ? `. ${errorText}` : ''}`
    )
  }
  return response
}

export interface CompleteUploadPresignedUrlParams {
  mediaId: string
}

export const completeUploadPresignedUrl = async ({
  mediaId
}: CompleteUploadPresignedUrlParams): Promise<UploadedAttachment | null> => {
  const result = await completeUploadPresignedUrlRequest({ mediaId })
  return result.ok ? result.attachment : null
}

type CompleteUploadPresignedUrlResult =
  { ok: true; attachment: UploadedAttachment } | { ok: false; status: number }

const completeUploadPresignedUrlRequest = async ({
  mediaId
}: {
  mediaId: string
}): Promise<CompleteUploadPresignedUrlResult> => {
  const response = await fetch('/api/v1/medias/presigned', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ mediaId }),
    signal: AbortSignal.timeout(30_000)
  })
  if (response.status !== 200) {
    return { ok: false, status: response.status }
  }

  const result = (await response.json()) as {
    media: PresignedUrlOutput['saveFileOutput']
  }

  return {
    ok: true,
    attachment: {
      type: 'upload',
      id: result.media.id,
      mediaType: result.media.mime_type,
      url: result.media.url,
      posterUrl: result.media.preview_url ?? undefined,
      width: result.media.meta.original.width,
      height: result.media.meta.original.height,
      name: result.media.description ?? undefined
    }
  }
}

const isPermanentCompletionFailure = (status: number) =>
  status >= 400 && status < 500

const shouldCleanupAfterPermanentCompletionFailure = (status: number) =>
  status === 401 || status === 403

type CompleteUploadPresignedUrlWithRetryResult =
  | { completed: UploadedAttachment; shouldCleanup: false }
  | { completed: null; shouldCleanup: boolean }

const MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS = 3
const PRESIGNED_UPLOAD_COMPLETION_RETRY_DELAY_MS = 250

const completeUploadPresignedUrlWithRetry = async ({
  mediaId
}: {
  mediaId: string
}): Promise<CompleteUploadPresignedUrlWithRetryResult> => {
  for (
    let attempt = 1;
    attempt <= MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const completed = await completeUploadPresignedUrlRequest({ mediaId })
      if (completed.ok) {
        return { completed: completed.attachment, shouldCleanup: false }
      }
      if (isPermanentCompletionFailure(completed.status)) {
        return {
          completed: null,
          shouldCleanup: shouldCleanupAfterPermanentCompletionFailure(
            completed.status
          )
        }
      }
    } catch {
      if (attempt === MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS) {
        return { completed: null, shouldCleanup: true }
      }
    }

    if (attempt < MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS) {
      await waitFor(
        PRESIGNED_UPLOAD_COMPLETION_RETRY_DELAY_MS * 2 ** (attempt - 1)
      )
    }
  }

  return { completed: null, shouldCleanup: true }
}

const cleanupPendingUploadMedia = async (mediaId: string) => {
  await fetch(`/api/v1/accounts/media/${mediaId}`, {
    method: 'DELETE'
  }).catch(() => undefined)
}

export interface UploadMediaThumbnailParams {
  mediaId: string
  thumbnail: File
}

export const uploadMediaThumbnail = async ({
  mediaId,
  thumbnail
}: UploadMediaThumbnailParams): Promise<
  PresignedUrlOutput['saveFileOutput'] | null
> => {
  try {
    const form = new FormData()
    form.append('thumbnail', thumbnail)
    const response = await fetch(`/api/v1/media/${mediaId}`, {
      method: 'PUT',
      body: form
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export const uploadAttachment = async (
  file: File,
  posterFile?: File
): Promise<UploadedAttachment | null> => {
  const result = await createUploadPresignedUrl({ media: file })
  if (!result) {
    const media = await uploadMedia({ media: file, thumbnail: posterFile })
    if (!media) return null
    return {
      type: 'upload',
      id: media.id,
      mediaType: media.mime_type,
      url: media.url,
      posterUrl: media.preview_url ?? undefined,
      width: media.meta.original.width,
      height: media.meta.original.height,
      name: media.description ?? undefined
    }
  }

  const { url: presignedUrl, saveFileOutput, headers } = result.presigned
  await uploadFileToPresignedUrl({ media: file, presignedUrl, headers })
  const completion = await completeUploadPresignedUrlWithRetry({
    mediaId: saveFileOutput.id
  })
  if (!completion.completed) {
    if (completion.shouldCleanup) {
      await cleanupPendingUploadMedia(saveFileOutput.id)
    }
    return null
  }

  let finalAttachment = completion.completed
  if (posterFile && !finalAttachment.posterUrl) {
    const updated = await uploadMediaThumbnail({
      mediaId: saveFileOutput.id,
      thumbnail: posterFile
    })
    if (updated?.preview_url) {
      finalAttachment = {
        ...finalAttachment,
        posterUrl: updated.preview_url
      }
    }
  }

  return finalAttachment
}

export interface GetActorMediaParams {
  actorId: string
  maxCreatedAt?: number
  limit?: number
}

export const getActorMedia = async ({
  actorId,
  maxCreatedAt,
  limit = 25
}: GetActorMediaParams): Promise<Attachment[]> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(`${window.origin}/api/v1/accounts/${encodedId}/media`)
  if (maxCreatedAt) {
    url.searchParams.append('max_created_at', `${maxCreatedAt}`)
  }
  if (limit) {
    url.searchParams.append('limit', `${limit}`)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) return []
  return response.json()
}

/**
 * The fields `PUT /api/v1/media/:id` accepts beyond Mastodon's `description`
 * and `focus`. A key that is absent is left alone; `null` clears the value.
 * Wire names are snake_case, as the Mastodon-style API expects.
 */
export interface UpdateMediaDetailsFields {
  description?: string | null
  subject_name?: string | null
  subject_scientific_name?: string | null
  subject_category?: MediaSubjectCategory | null
  /** A GBIF usage key (digits). `null` clears it. */
  subject_taxon_key?: string | null
  camera_gear_id?: string | null
  lens_gear_id?: string | null
  place_name?: string | null
  place_latitude?: number | null
  place_longitude?: number | null
  place_precision?: MediaPlacePrecision | null
  in_gallery?: boolean
}

/** Owner's own media entity (Mastodon `MediaAttachment` plus `details`). */
export const getMedia = async (
  mediaId: string
): Promise<MediaStorageSaveFileOutput> => {
  const response = await fetch(`/api/v1/media/${encodeURIComponent(mediaId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Failed to load media.'))
  }
  return response.json()
}

/**
 * Saves the details of an uploaded media: description, subject, gear, place,
 * gallery membership. Sends only the keys given, so a caller changing one field
 * never rewrites the rest. Resolves to the updated entity, `details` included.
 */
export const updateMediaDetails = async (
  mediaId: string,
  fields: UpdateMediaDetailsFields
): Promise<MediaStorageSaveFileOutput> => {
  const response = await fetch(`/api/v1/media/${encodeURIComponent(mediaId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  })
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to save media details.')
    )
  }
  return response.json()
}

/**
 * Asks the instance's alt text service to describe a stored media. Returns the
 * text WITHOUT saving it — show it to the author and save it with
 * `updateMediaDetails`. Rejects with the server's message when alt text is not
 * configured or generation failed.
 */
export const describeMedia = async (mediaId: string): Promise<string> => {
  const response = await fetch(
    `/api/v1/media/${encodeURIComponent(mediaId)}/describe`,
    { method: 'POST', headers: { Accept: 'application/json' } }
  )
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, 'Failed to generate a description.')
    )
  }
  const data = (await response.json()) as { description: string }
  return data.description
}
