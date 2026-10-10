import { getBaseURL } from '@/lib/config'
import { toMediaRowId } from '@/lib/database/sql/media'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'

/**
 * The canonical spelling of a media row id (`'12'` for `'012'` and `'12.0'`),
 * so ids that name one row compare equal. Anything that is not a row id is
 * returned unchanged.
 */
export const toCanonicalMediaId = (mediaId: string): string => {
  const rowId = toMediaRowId(mediaId)
  return rowId === null ? mediaId : String(rowId)
}

const getMediaUrl = (path: string) => `${getBaseURL()}/api/v1/files/${path}`

export const getAttachmentsFromMediaIds = async (
  database: Database,
  currentActor: Actor,
  mediaIds: string[]
): Promise<PostBoxAttachment[] | null> => {
  if (mediaIds.length === 0) return []

  const accountId = currentActor.account?.id
  if (!accountId) return null

  const medias = await Promise.all(
    mediaIds.map((mediaId) =>
      database.getMediaByIdForAccount({
        mediaId,
        accountId
      })
    )
  )

  const attachments: PostBoxAttachment[] = []
  for (const media of medias) {
    if (!media) return null
    // The lookup is account-scoped, but a status is authored by one actor and
    // an OAuth token is bound to one actor: attaching a sibling actor's media
    // (sequential ids) would publish media that token was never granted.
    if (media.actorId !== currentActor.id) return null
    if (media.original.metaData.upload?.state === 'pending') {
      return null
    }

    attachments.push({
      type: 'upload',
      id: media.id,
      mediaType: media.original.mimeType,
      url: getMediaUrl(media.original.path),
      width: media.original.metaData.width,
      height: media.original.metaData.height,
      ...(media.thumbnail
        ? { posterUrl: getMediaUrl(media.thumbnail.path) }
        : {}),
      ...(media.description ? { name: media.description } : {})
    })
  }

  return attachments
}

/**
 * Maps ids a client hands back for a status's own attachments to the `medias`
 * row ids the media paths address.
 *
 * The status entity publishes `media_attachments[].id` as the ATTACHMENT row's
 * uuid (`getMastodonAttachment`), while `media_ids`, `media_attributes[][id]`
 * and `PUT /api/v1/media/:id` all address the numeric `medias` row id that the
 * upload answered with. Mastodon has one id where this instance has two, so a
 * third-party client editing a post it did not just upload to — dragging a
 * focal point in Elk or Ivory, say — can only send the uuid, which
 * `toMediaRowId` rejects outright and the edit answers 422.
 *
 * Resolving here keeps emission narrow and acceptance permanent, the rule the
 * rest of this instance's ids already follow: an id that is already a media id
 * passes through untouched, and an unknown id is left alone so it fails its
 * own validation rather than being silently remapped.
 */
export const resolveStatusAttachmentMediaIds = (
  status: Status,
  ids: string[]
): string[] => {
  const mediaIdByAttachmentId = new Map(
    // Only a Note (and the Poll that extends it) carries attachments; an
    // Announce has none to map, and the edit route rejects one anyway.
    (status.type === StatusType.enum.Note ||
    status.type === StatusType.enum.Poll
      ? status.attachments
      : []
    ).flatMap((attachment) =>
      attachment.mediaId ? [[attachment.id, String(attachment.mediaId)]] : []
    )
  )
  if (mediaIdByAttachmentId.size === 0) return ids
  return ids.map((id) => mediaIdByAttachmentId.get(id) ?? id)
}
