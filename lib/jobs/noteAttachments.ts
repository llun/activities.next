import { BaseNote, getAttachments, getStatusUrl } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import {
  AnimationMetadataItem,
  resolveAnimationMetadata
} from '@/lib/services/medias/animationMetadata'
import { normalizeBlurhash } from '@/lib/services/medias/imageAnalysis'
import { Document } from '@/lib/types/activitypub/objects'
import { CreateAttachmentParams } from '@/lib/types/database/operations'
import { isFitnessAttachment } from '@/lib/types/domain/attachment'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { isValidFocalPoint } from '@/lib/utils/focalPoint'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const isFitnessDocument = (document: Document) =>
  isFitnessAttachment({
    mediaType: document.mediaType,
    url: document.url,
    name: document.name ?? ''
  })

/**
 * The media documents of a remote note, in order. With `withoutFitness` the
 * fitness files (`.fit`, `.gpx`, `.tcx`) are left out: an Update compares and
 * replaces only the photos, videos and audio of a post.
 */
export const getRemoteAttachmentDocuments = (
  note: BaseNote,
  { withoutFitness = false }: { withoutFitness?: boolean } = {}
): Document[] =>
  getAttachments(note).filter(
    (attachment) =>
      attachment.type === 'Document' &&
      !(withoutFitness && isFitnessDocument(attachment))
  )

/**
 * The `attachments` rows a remote note's media documents become, with no
 * media row of their own: the BlurHash and focal point the note carries (when
 * valid), and for videos the playback type and preview the author's server
 * reports. Each row's `createdAt` is a millisecond per position in the note's
 * FULL attachment list after its `published` time, so the order holds against
 * the fitness rows an Update keeps (they were stored the same way).
 */
export const buildRemoteAttachments = async ({
  statusId,
  note,
  withoutFitness = false
}: {
  statusId: string
  note: BaseNote
  withoutFitness?: boolean
}): Promise<CreateAttachmentParams[]> => {
  const documents = getRemoteAttachmentDocuments(note)
  const attachments = documents
    .map((attachment, index) => ({ attachment, index }))
    .filter(
      ({ attachment }) => !(withoutFitness && isFitnessDocument(attachment))
    )
  if (attachments.length === 0) return []

  const actorId = normalizeActorId(note.attributedTo) ?? note.attributedTo
  const publishedAt = new Date(note.published).getTime()

  let animationMetadata: Record<string, AnimationMetadataItem> = {}
  if (
    attachments.some(({ attachment }) =>
      attachment.mediaType.startsWith('video')
    )
  ) {
    try {
      animationMetadata = await resolveAnimationMetadata({
        statusUrl: getStatusUrl(note) || note.id,
        statusId,
        authorId: actorId,
        attachments: attachments.map(({ attachment }) => ({
          url: attachment.url,
          mediaType: attachment.mediaType
        }))
      })
    } catch (error) {
      logger.warn({
        message: 'Failed to resolve animation metadata for a remote note',
        statusId,
        err: toLoggableError(error)
      })
    }
  }

  return attachments.map(({ attachment, index }) => {
    // Store what the normalizer returns, not the value it was handed:
    // it validates the trimmed form, so a padded hash approved here and
    // persisted verbatim would fail `decode` on every render.
    const blurhash = normalizeBlurhash(attachment.blurhash)
    const focus =
      attachment.focalPoint &&
      isValidFocalPoint(attachment.focalPoint[0], attachment.focalPoint[1])
        ? { x: attachment.focalPoint[0], y: attachment.focalPoint[1] }
        : null

    const meta = animationMetadata[attachment.url]
    const playbackType =
      meta && meta.playbackType !== 'unknown' ? meta.playbackType : undefined
    const thumbnailUrl = meta?.previewUrl ?? attachment.thumbnailUrl ?? null

    return {
      actorId,
      statusId,
      mediaType: attachment.mediaType,
      height: attachment.height,
      width: attachment.width,
      name: attachment.name || '',
      url: attachment.url,
      blurhash,
      focus,
      playbackType,
      thumbnailUrl,
      createdAt: publishedAt + index
    }
  })
}

/** Stores the attachments of a remote note (see `buildRemoteAttachments`). */
export const createRemoteAttachments = async ({
  database,
  statusId,
  note
}: {
  database: Database
  statusId: string
  note: BaseNote
}) => {
  const attachments = await buildRemoteAttachments({ statusId, note })
  await Promise.all(
    attachments.map((attachment) => database.createAttachment(attachment))
  )
}
