import type { PresignedUrlOutput } from '@/lib/services/medias/types'
import type { UploadedAttachment } from '@/lib/types/domain/attachment'
import { getMediaWidthAndHeight } from '@/lib/utils/getMediaWidthAndHeight'
import { waitFor } from '@/lib/utils/waitFor'

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

export const uploadAttachment = async (
  file: File
): Promise<UploadedAttachment | null> => {
  const result = await createUploadPresignedUrl({ media: file })
  if (!result) {
    const media = await uploadMedia({ media: file })
    if (!media) return null
    return {
      type: 'upload',
      id: media.id,
      mediaType: media.mime_type,
      url: media.url,
      posterUrl: media.preview_url,
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

  return completion.completed
}
