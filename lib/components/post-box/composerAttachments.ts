import type { updateNote } from '@/lib/client'
import {
  Attachment,
  PostBoxAttachment,
  isFitnessAttachment
} from '@/lib/types/domain/attachment'
import { EditableStatus } from '@/lib/types/domain/status'

export type UpdateNoteResponse = Awaited<ReturnType<typeof updateNote>>
export type UpdateNoteMediaAttachment =
  UpdateNoteResponse['mediaAttachments'][number]

export const isEditableStatusMediaAttachment = (
  attachment: Attachment
): attachment is Attachment & { mediaId: string } =>
  Boolean(attachment.mediaId) && !isFitnessAttachment(attachment)

export const getEditableStatusAttachments = (
  status: Pick<EditableStatus, 'attachments'>
): PostBoxAttachment[] =>
  status.attachments.flatMap((attachment) => {
    if (!isEditableStatusMediaAttachment(attachment)) return []

    return [
      {
        type: 'upload',
        id: attachment.mediaId,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width ?? 0,
        height: attachment.height ?? 0,
        name: attachment.name
      }
    ]
  })

export const getPreservedStatusAttachments = (
  attachments: Attachment[]
): Attachment[] =>
  attachments.filter(
    (attachment) => !isEditableStatusMediaAttachment(attachment)
  )

export const getAttachmentIds = (
  attachments: Pick<PostBoxAttachment, 'id'>[]
): string[] => attachments.map((attachment) => attachment.id)

export const areAttachmentIdsEqualInOrder = (
  current: Pick<PostBoxAttachment, 'id'>[],
  baseline: Pick<PostBoxAttachment, 'id'>[]
): boolean => {
  const currentIds = getAttachmentIds(current)
  const baselineIds = getAttachmentIds(baseline)
  if (currentIds.length !== baselineIds.length) return false
  return currentIds.every((id, index) => id === baselineIds[index])
}

export const getTimestamp = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    return Number.isNaN(timestamp) ? fallback : timestamp
  }
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isNaN(timestamp) ? fallback : timestamp
  }
  return fallback
}

export const getMediaAttachmentDimensions = (
  mediaAttachment: UpdateNoteMediaAttachment,
  fallback?: Pick<PostBoxAttachment, 'width' | 'height'>
): { width?: number; height?: number } => {
  const meta = (
    'meta' in mediaAttachment ? mediaAttachment.meta : undefined
  ) as
    | {
        original?: { width?: number; height?: number }
        width?: number
        height?: number
      }
    | null
    | undefined

  return {
    width: meta?.original?.width ?? meta?.width ?? fallback?.width,
    height: meta?.original?.height ?? meta?.height ?? fallback?.height
  }
}

export const getMediaTypeFromMastodonAttachment = (
  attachment: Pick<UpdateNoteMediaAttachment, 'type'>
): string => {
  switch (attachment.type) {
    case 'image':
      return 'image/jpeg'
    case 'gifv':
    case 'video':
      return 'video/mp4'
    case 'audio':
      return 'audio/mpeg'
    default:
      return 'application/octet-stream'
  }
}

export interface GetStatusAttachmentsFromUpdateResponseParams {
  actorId: string
  existingAttachments: Attachment[]
  mediaAttachments: UpdateNoteMediaAttachment[]
  statusId: string
  uploadedAttachments: PostBoxAttachment[]
  updatedAt: number
}

export const getStatusAttachmentsFromUpdateResponse = ({
  actorId,
  existingAttachments,
  mediaAttachments,
  statusId,
  uploadedAttachments,
  updatedAt
}: GetStatusAttachmentsFromUpdateResponseParams): Attachment[] => {
  const updatedMediaAttachments: Attachment[] = mediaAttachments.map(
    (mediaAttachment, index) => {
      // Mastodon returns media attachments in the submitted order; keep this
      // order-sensitive pairing so Attachment.id comes from the server while
      // mediaId and fallback metadata come from the uploaded media ids.
      const uploadedAttachment = uploadedAttachments[index]
      const existingAttachment = existingAttachments.find(
        (attachment) =>
          attachment.id === mediaAttachment.id ||
          attachment.mediaId === uploadedAttachment?.id ||
          attachment.url === mediaAttachment.url
      )
      const dimensions = getMediaAttachmentDimensions(
        mediaAttachment,
        uploadedAttachment
      )
      const attachmentCreatedAt = existingAttachment?.createdAt ?? updatedAt

      return {
        id: mediaAttachment.id,
        actorId,
        statusId,
        type: 'Document',
        mediaType:
          existingAttachment?.mediaType ??
          uploadedAttachment?.mediaType ??
          getMediaTypeFromMastodonAttachment(mediaAttachment),
        url: mediaAttachment.url,
        width: dimensions.width ?? existingAttachment?.width,
        height: dimensions.height ?? existingAttachment?.height,
        name:
          mediaAttachment.description ??
          existingAttachment?.name ??
          uploadedAttachment?.name ??
          '',
        mediaId: existingAttachment
          ? (existingAttachment.mediaId ?? null)
          : (uploadedAttachment?.id ?? null),
        createdAt: attachmentCreatedAt,
        updatedAt
      }
    }
  )

  const preservedAttachments: Attachment[] = getPreservedStatusAttachments(
    existingAttachments
  )
    .filter(
      (attachment) =>
        !mediaAttachments.some(
          (mediaAttachment) =>
            mediaAttachment.id === attachment.id ||
            mediaAttachment.url === attachment.url
        )
    )
    .map((attachment) => ({
      ...attachment,
      statusId,
      updatedAt
    }))

  return [...updatedMediaAttachments, ...preservedAttachments]
}
