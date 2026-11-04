import { Database } from '@/lib/database/types'
import { deleteMediaFile } from '@/lib/services/medias'
import { ROUTE_MAP_ATTACHMENT_NAME } from '@/lib/types/domain/routeMap'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export { ROUTE_MAP_ATTACHMENT_NAME }

/**
 * Whether an attachment a status shows is a generated route map: it carries
 * the route map name, or its file is the map a fitness file of that status
 * records in `mapImagePath` (the signal hydration and the gallery use). The
 * path also recognises a map whose name an edit rewrote before edits kept it.
 */
export const isRouteMapAttachment = (
  attachment: { name?: string | null; url: string },
  mapImagePaths: ReadonlyArray<string | null | undefined>
) =>
  attachment.name === ROUTE_MAP_ATTACHMENT_NAME ||
  mapImagePaths.some(
    (mapImagePath) =>
      Boolean(mapImagePath) &&
      getAttachmentMediaPath(attachment.url) === mapImagePath
  )

/**
 * The route map attachments a fitness file owns on its status.
 *
 * Matched by name AND by the file's recorded `mapImagePath`, so a status
 * carrying two activities (a merged same-ride post) never has one file's
 * regeneration delete the other's map.
 */
export const findRouteMapAttachments = async ({
  database,
  statusId,
  mapImagePath
}: {
  database: Database
  statusId: string
  mapImagePath?: string | null
}) => {
  if (!mapImagePath) return []

  return (await database.getAttachmentsWithMedia({ statusId })).filter(
    (attachment) =>
      attachment.name === ROUTE_MAP_ATTACHMENT_NAME &&
      getAttachmentMediaPath(attachment.url) === mapImagePath
  )
}

/**
 * Drops route map attachments and the media rows/files behind them.
 *
 * Shared by both jobs that replace a route map, and always called once the map it removes is
 * no longer the one the status should show — so a leftover file is the worst
 * thing a failure here can cost. Only the storage deletions are swallowed (a
 * missing object is not worth a retry); the database calls can throw, so every
 * call site contains them in a catch that neither fails the activity nor
 * reports it as a map-generation failure.
 */
export const removeRouteMapAttachmentsAndMedia = async ({
  database,
  accountId,
  statusId,
  attachmentIds,
  mediaIds
}: {
  database: Database
  accountId: string
  statusId: string
  attachmentIds: string[]
  mediaIds: string[]
}) => {
  if (attachmentIds.length > 0) {
    await database.deleteAttachmentsByIds({ attachmentIds })
  }

  for (const mediaId of mediaIds) {
    const media = await database.getMediaByIdForAccount({
      mediaId,
      accountId
    })

    // The row goes first and reports every file it kept (the map, its
    // thumbnail, and the uploaded original and earlier renders if the owner
    // edited the map in the photo editor), read under its row lock so a save
    // committing meanwhile cannot leave one behind.
    const deleted = await database.deleteMediaWithFiles({ mediaId })
    if (deleted.status !== 'deleted') {
      logger.warn({
        message: 'Failed to delete replaced map media database record',
        statusId,
        mediaId
      })
      continue
    }
    if (!media) continue

    const filePaths = deleted.files
    const deletionResults = await Promise.allSettled(
      filePaths.map((path) => deleteMediaFile(database, path))
    )

    deletionResults.forEach((result, index) => {
      if (result.status === 'rejected' || !result.value) {
        logger.warn({
          message: 'Failed to delete replaced map media file from storage',
          statusId,
          mediaId,
          path: filePaths[index],
          ...(result.status === 'rejected'
            ? { err: toLoggableError(result.reason) }
            : {})
        })
      }
    })
  }
}

/** Unique media ids behind a set of attachments. */
export const getAttachmentMediaIds = (
  attachments: Array<{ mediaId?: string | null }>
) => [
  ...new Set(
    attachments
      .map((attachment) => attachment.mediaId ?? null)
      .filter((value): value is string => Boolean(value))
  )
]
