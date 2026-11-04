import { getMediaEditFilePathsFromFiles } from '@/lib/database/domains/mediaEdit/queries'
import { Database } from '@/lib/database/types'
import { deleteMediaFile } from '@/lib/services/medias'
import { toCanonicalMediaId } from '@/lib/services/statuses/mediaIds'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/** The attachment name every generated route map is stored under. */
export const ROUTE_MAP_ATTACHMENT_NAME = 'Activity route map'

/**
 * Every stored file each media keeps, by canonical media id: its live file
 * (read only for media of `accountId`) and the files its photo-editor edits
 * keep. That is where a route map's recorded `mapImagePath` survives once the
 * map is re-rendered: "Update posts" moves the attachment's url to the render
 * while the uploaded original stays in the edit's original slot, and a
 * "Gallery only" revert makes that original the live file again while the
 * post keeps the render.
 */
export const getMediaFilePaths = async ({
  database,
  accountId,
  mediaIds
}: {
  database: Database
  accountId?: string | null
  mediaIds: string[]
}) => {
  const paths = new Map<string, Set<string>>()
  const ids = [...new Set(mediaIds.map(toCanonicalMediaId))]
  if (ids.length === 0) return paths

  const add = (mediaId: string, filePaths: string[]) => {
    const key = toCanonicalMediaId(mediaId)
    const set = paths.get(key) ?? new Set<string>()
    filePaths.forEach((path) => set.add(path))
    paths.set(key, set)
  }
  const readLive = async () => {
    const media = accountId
      ? await database.getMediaByIdsForAccount({ mediaIds: ids, accountId })
      : []
    media.forEach((item) => add(item.id, [item.original.path]))
    return media
      .map((item) => `${item.id}:${item.edit?.version ?? 0}`)
      .sort()
      .join()
  }

  // The live file and the edit files are two statements, and a save or revert
  // committing between them moves the original from one to the other unseen
  // (a revert: live still the render, original slot already gone). Every save
  // and revert moves the edit version, so the reads are re-taken until the
  // versions stand still around the edit-files read.
  let versions = await readLive()
  for (let attempt = 0; attempt < 3; attempt++) {
    const editFiles = await database.listMediaEditFiles({ mediaIds: ids })
    editFiles.forEach((file) =>
      add(file.mediaId, getMediaEditFilePathsFromFiles([file]))
    )
    const after = await readLive()
    if (after === versions) break
    versions = after
  }
  return paths
}

/**
 * The route map attachments a fitness file owns on its status.
 *
 * Matched by the file's recorded `mapImagePath` against the attachment's own
 * url (an untouched map) and the files of the media behind it (a map the
 * photo editor re-rendered, see getMediaFilePaths). Never by the name, which
 * an edit that resends the media does not keep. A status carrying two
 * activities (a merged same-ride post) has one map per file, each at its own
 * path, so one file's regeneration never deletes the other's map.
 */
export const findRouteMapAttachments = async ({
  database,
  accountId,
  statusId,
  mapImagePath
}: {
  database: Database
  accountId?: string | null
  statusId: string
  mapImagePath?: string | null
}) => {
  if (!mapImagePath) return []

  const attachments = await database.getAttachmentsWithMedia({ statusId })
  const mediaPaths = await getMediaFilePaths({
    database,
    accountId,
    mediaIds: getAttachmentMediaIds(attachments)
  })
  return attachments.filter(
    (attachment) =>
      getAttachmentMediaPath(attachment.url) === mapImagePath ||
      Boolean(
        attachment.mediaId &&
        mediaPaths
          .get(toCanonicalMediaId(attachment.mediaId))
          ?.has(mapImagePath)
      )
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
