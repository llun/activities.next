import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getMediaFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'

// `/?media=12,13`: the media a "Post" action in Gallery hands the composer.
export const COMPOSER_MEDIA_QUERY_PARAM = 'media'

// A media id on the wire is the decimal `medias.id`.
const MEDIA_ID_PATTERN = /^\d{1,10}$/

/**
 * The ids a `?media=` value names, in order and without repeats. Anything that
 * is not a decimal id is dropped, and so is everything past `limit`.
 */
export const parseComposerMediaParam = (
  value: string | string[] | undefined,
  limit: number
): string[] => {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '')
  const ids: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (MEDIA_ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id)
  }
  return ids.slice(0, Math.max(0, limit))
}

/**
 * The attachments to open the composer with: the actor's OWN media that no
 * status uses and whose upload has finished. Any other id in the URL is
 * ignored, so a link can never put somebody else's file, or a photo a post
 * already uses, into a new post. The alt text is the media row's description.
 */
export const getComposerPrefillAttachments = async ({
  database,
  actorId,
  mediaIds
}: {
  database: Pick<Database, 'getUnattachedMedia'>
  actorId: string
  mediaIds: string[]
}): Promise<PostBoxAttachment[]> => {
  if (mediaIds.length === 0) return []
  const host = getConfig().host
  const medias = await database.getUnattachedMedia({ actorId, mediaIds })
  const byId = new Map(medias.map((media) => [media.id, media]))
  return mediaIds.flatMap((id): PostBoxAttachment[] => {
    const media = byId.get(id)
    if (!media || media.original.metaData.upload?.state === 'pending') return []
    return [
      {
        type: 'upload',
        id: media.id,
        mediaType: media.original.mimeType,
        url: getMediaFileUrl(host, media.original.path),
        width: media.original.metaData.width ?? 0,
        height: media.original.metaData.height ?? 0,
        ...(media.thumbnail
          ? { posterUrl: getMediaFileUrl(host, media.thumbnail.path) }
          : {}),
        ...(media.description ? { name: media.description } : {})
      }
    ]
  })
}
