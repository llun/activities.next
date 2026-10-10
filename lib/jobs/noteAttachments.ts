import { BaseNote, getAttachments, getStatusUrl } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import {
  AnimationMetadataItem,
  resolveAnimationMetadata
} from '@/lib/services/medias/animationMetadata'
import { normalizeBlurhash } from '@/lib/services/medias/imageAnalysis'
import { Document } from '@/lib/types/activitypub/objects'
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
 * Stores the attachments of a remote note as `attachments` rows with no media
 * row of their own: the BlurHash and focal point the note carries (when
 * valid), and for videos the playback type and preview the author's server
 * reports. Rows are created in the note's order, a millisecond apart from its
 * `published` time.
 */
export const createRemoteAttachments = async ({
  database,
  statusId,
  note,
  withoutFitness = false
}: {
  database: Database
  statusId: string
  note: BaseNote
  withoutFitness?: boolean
}) => {
  const attachments = getRemoteAttachmentDocuments(note, { withoutFitness })
  if (attachments.length === 0) return

  const actorId = normalizeActorId(note.attributedTo) ?? note.attributedTo
  const publishedAt = new Date(note.published).getTime()

  let animationMetadata: Record<string, AnimationMetadataItem> = {}
  if (attachments.some((att) => att.mediaType.startsWith('video'))) {
    try {
      animationMetadata = await resolveAnimationMetadata({
        statusUrl: getStatusUrl(note) || note.id,
        statusId,
        authorId: actorId,
        attachments: attachments.map((att) => ({
          url: att.url,
          mediaType: att.mediaType
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

  await Promise.all(
    attachments.map(async (attachment, index) => {
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

      return database.createAttachment({
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
      })
    })
  )
}
