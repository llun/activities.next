import { Database } from '@/lib/database/types'
import { getMediaFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'
import { Media, UpdateNoteAttachment } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import {
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
  media: Pick<Media, 'blurhash' | 'focus' | 'thumbnail'> | null | undefined,
  host: string
): AttachmentMediaMetadata => ({
  blurhash: media?.blurhash ?? null,
  focus: media?.focus ?? null,
  thumbnailUrl: media?.thumbnail
    ? getMediaFileUrl(host, media.thumbnail.path)
    : null
})

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

/**
 * Resolves the snapshot for a set of attachment media ids in one query,
 * scoped to the actor's ACCOUNT — the same scope the upload routes use, so a
 * second persona on one account can attach media the first one uploaded.
 *
 * Only the id is ever taken from the caller: `POST /api/v1/accounts/outbox`
 * accepts whole attachment objects from the client, so the placeholder and
 * focal point must be read back from the owner's own media row rather than
 * trusted from the request body.
 *
 * Returns a map keyed by media id; an id with no owned row is simply absent,
 * and callers fall back to `EMPTY_ATTACHMENT_MEDIA_METADATA`.
 */
export const resolveAttachmentMediaMetadata = async ({
  database,
  currentActor,
  mediaIds
}: {
  database: Database
  currentActor: Actor
  mediaIds: string[]
}): Promise<Map<string, AttachmentMediaMetadata>> => {
  const accountId = currentActor.account?.id
  if (!accountId || mediaIds.length === 0) return new Map()

  const mediaRows = await database.getMediaByIdsForAccount({
    mediaIds,
    accountId
  })
  return new Map(
    mediaRows.map((media) => [
      String(media.id),
      getAttachmentMediaMetadata(media, currentActor.domain)
    ])
  )
}

/**
 * Attaches the resolved snapshot to each attachment, ready for
 * `database.updateNote`. An attachment whose media row is gone (or which
 * carries no media id at all) keeps the empty snapshot rather than being
 * dropped — the edit still has to write the row.
 */
export const withAttachmentMediaMetadata = async ({
  database,
  currentActor,
  attachments
}: {
  database: Database
  currentActor: Actor
  attachments: PostBoxAttachment[]
}): Promise<UpdateNoteAttachment[]> => {
  const metadataById = await resolveAttachmentMediaMetadata({
    database,
    currentActor,
    mediaIds: attachments
      .map((attachment) => attachment.id)
      .filter((id): id is string => Boolean(id))
  })
  return attachments.map((attachment) => ({
    ...attachment,
    ...(attachment.id
      ? (metadataById.get(String(attachment.id)) ??
        EMPTY_ATTACHMENT_MEDIA_METADATA)
      : EMPTY_ATTACHMENT_MEDIA_METADATA)
  }))
}
