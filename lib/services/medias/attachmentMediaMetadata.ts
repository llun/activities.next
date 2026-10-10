import { getBaseURL } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getLiveThumbnail } from '@/lib/services/medias/getMediaAttachment'
import {
  MEDIA_FILE_URL_PATH,
  getMediaFileUrl
} from '@/lib/services/medias/mediaFileUrl'
import { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'
import { Media, UpdateNoteAttachment } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import {
  Attachment,
  AttachmentMediaMetadata,
  PostBoxAttachment
} from '@/lib/types/domain/attachment'

export const EMPTY_ATTACHMENT_MEDIA_METADATA: AttachmentMediaMetadata = {
  blurhash: null,
  focus: null,
  thumbnailUrl: null
}

/**
 * Reads the snapshot off a stored `medias` row. `host` is the instance host the
 * stored paths are served from — the owning local actor's domain.
 */
export const getAttachmentMediaMetadata = (
  media:
    Pick<Media, 'blurhash' | 'focus' | 'thumbnail' | 'edit'> | null | undefined,
  host: string
): AttachmentMediaMetadata => {
  const thumbnail = media ? getLiveThumbnail(media) : undefined
  return {
    blurhash: media?.blurhash ?? null,
    focus: media?.focus ?? null,
    thumbnailUrl: thumbnail ? getMediaFileUrl(host, thumbnail.path) : null
  }
}

/**
 * Reads the snapshot off the entity `saveMedia` returns, for the import jobs
 * that store a file and attach it in the same step.
 *
 * `preview_url` falls back to the ORIGINAL url when the row has no thumbnail
 * (see `getMediaAttachment`), so `meta.small` — present only for a real stored
 * thumbnail — is what decides whether there is a thumbnail URL to snapshot.
 * Taking `preview_url` unconditionally would file the full-size image as the
 * post's preview.
 */
export const getSavedMediaAttachmentMetadata = (
  saved: MediaStorageSaveFileOutput
): AttachmentMediaMetadata => ({
  blurhash: saved.blurhash ?? null,
  focus: saved.meta.focus ?? null,
  thumbnailUrl: saved.meta.small ? (saved.preview_url ?? null) : null
})

const showsLiveFile = (url: string, media: Pick<Media, 'original'>) =>
  url.endsWith(`${MEDIA_FILE_URL_PATH}${media.original.path}`)

type ExistingAttachment = Pick<
  Attachment,
  'mediaId' | 'url' | 'blurhash' | 'focus' | 'thumbnailUrl'
>

/**
 * The snapshot an attachment keeps when it still shows an earlier file of an
 * edited photo (a post saved "Gallery only" keeps the render it was published
 * with): the BlurHash, focal point and thumbnail stored with that file on the
 * status's own attachment row. The media row now describes another image, so
 * copying its values would federate a placeholder and focal point that do not
 * match the image at `url`. Null when the attachment shows the live file, the
 * photo was never edited, or the status has no row for that file.
 */
const getEarlierFileSnapshot = (
  attachment: PostBoxAttachment,
  media: Pick<Media, 'id' | 'original' | 'edit'>,
  existingAttachments: ExistingAttachment[]
): AttachmentMediaMetadata | null => {
  if (!media.edit?.version) return null
  if (showsLiveFile(attachment.url, media)) return null
  const existing = existingAttachments.find(
    (item) =>
      item.mediaId != null &&
      String(item.mediaId) === String(media.id) &&
      item.url === attachment.url
  )
  if (!existing) return null
  return {
    blurhash: existing.blurhash ?? null,
    focus: existing.focus ?? null,
    thumbnailUrl: existing.thumbnailUrl ?? null
  }
}

/**
 * The file an attachment of an edited photo may show. The url, type and size
 * come from the client (the composer, `POST /api/v1/accounts/outbox`, a
 * refresh that started before another save committed), so a stale one could
 * point the post at an earlier render that has been, or is about to be,
 * pruned. Only two files are taken as sent: the media's live file, and on an
 * edit the file this status already shows for that media (a "Gallery only"
 * post keeps its render). Anything else is replaced by the live file. A photo
 * never edited has no other file to point at, so it is left as sent.
 */
const withTrustedFile = (
  attachment: PostBoxAttachment,
  media: Pick<Media, 'id' | 'original' | 'edit'>,
  existingAttachments: Pick<Attachment, 'mediaId' | 'url'>[]
): PostBoxAttachment => {
  if (!media.edit?.version) return attachment
  if (showsLiveFile(attachment.url, media)) return attachment
  const kept = existingAttachments.some(
    (item) =>
      item.mediaId != null &&
      String(item.mediaId) === String(media.id) &&
      item.url === attachment.url
  )
  if (kept) return attachment
  const { width, height } = media.original.metaData
  return {
    ...attachment,
    // The same base the server-built attachments use (`media_ids`, the
    // posts refresh), so the file reads the same whichever path wrote it.
    url: `${getBaseURL()}${MEDIA_FILE_URL_PATH}${media.original.path}`,
    mediaType: media.original.mimeType,
    width: typeof width === 'number' ? width : attachment.width,
    height: typeof height === 'number' ? height : attachment.height
  }
}

/**
 * Resolves each attachment against the owner's own media rows in one query,
 * scoped to the actor's ACCOUNT — the same scope the upload routes use, so a
 * second persona on one account can attach media the first one uploaded.
 *
 * Only the id is ever trusted from the caller: `POST /api/v1/accounts/outbox`
 * accepts whole attachment objects from the client, so the file
 * (`withTrustedFile`), placeholder and focal point are read back from the
 * owner's media row. `metadata` is null when the id names no owned row; such
 * an attachment is returned unchanged.
 *
 * An attachment still showing an earlier file of an edited photo keeps what
 * the status's row recorded for that file (`existingAttachments`, the status's
 * attachments before the edit; empty for a new post).
 */
export const resolveOwnedAttachments = async ({
  database,
  currentActor,
  attachments,
  existingAttachments = []
}: {
  database: Database
  currentActor: Actor
  attachments: PostBoxAttachment[]
  existingAttachments?: ExistingAttachment[]
}): Promise<
  { attachment: PostBoxAttachment; metadata: AttachmentMediaMetadata | null }[]
> => {
  const accountId = currentActor.account?.id
  const mediaIds = attachments
    .map((attachment) => attachment.id)
    .filter((id): id is string => Boolean(id))
  const mediaRows =
    accountId && mediaIds.length > 0
      ? await database.getMediaByIdsForAccount({ mediaIds, accountId })
      : []
  const mediaById = new Map(mediaRows.map((media) => [String(media.id), media]))
  return attachments.map((attachment) => {
    const media = attachment.id
      ? mediaById.get(String(attachment.id))
      : undefined
    if (!media) return { attachment, metadata: null }
    const trusted = withTrustedFile(attachment, media, existingAttachments)
    return {
      attachment: trusted,
      metadata:
        getEarlierFileSnapshot(trusted, media, existingAttachments) ??
        getAttachmentMediaMetadata(media, currentActor.domain)
    }
  })
}

/**
 * Attaches the resolved snapshot to each attachment, ready for
 * `database.updateNote`. An attachment whose media row is gone (or which
 * carries no media id at all) keeps the empty snapshot rather than being
 * dropped — the edit still has to write the row.
 */
export const withAttachmentMediaMetadata = async (params: {
  database: Database
  currentActor: Actor
  attachments: PostBoxAttachment[]
  existingAttachments?: ExistingAttachment[]
}): Promise<UpdateNoteAttachment[]> =>
  (await resolveOwnedAttachments(params)).map(({ attachment, metadata }) => ({
    ...attachment,
    ...(metadata ?? EMPTY_ATTACHMENT_MEDIA_METADATA)
  }))
