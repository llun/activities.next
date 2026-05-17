import { getBaseURL } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'

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
      ...(media.description || media.original.fileName
        ? { name: media.description || media.original.fileName }
        : {})
    })
  }

  return attachments
}
