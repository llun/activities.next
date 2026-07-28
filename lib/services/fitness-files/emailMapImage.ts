import { Database } from '@/lib/database/types'
import { deleteMediaFile } from '@/lib/services/medias'
import { logger } from '@/lib/utils/logger'

/**
 * Delete the JPEG copy of a route map kept for the activity-import email.
 *
 * The copy lives in media storage with no `medias` row of its own, so
 * `fitness_files.mapImageEmailPath` is its only reference and no generic
 * media-cleanup path can discover it. Every place that stops referencing a copy
 * — deleting the activity, reprocessing it, regenerating its map — has to delete
 * the file explicitly, or two things go wrong: the object is orphaned in
 * storage, and the route stays fetchable at its unchanged URL even after the
 * owner hid it behind a privacy location.
 *
 * Best-effort: the reference is being dropped regardless, so a storage failure
 * is logged rather than propagated.
 */
export const deleteEmailMapImage = async ({
  database,
  fitnessFileId,
  mapImageEmailPath
}: {
  database: Database
  fitnessFileId: string
  mapImageEmailPath?: string | null
}) => {
  if (!mapImageEmailPath) return

  const deleted = await deleteMediaFile(database, mapImageEmailPath).catch(
    () => false
  )
  if (!deleted) {
    logger.warn({
      message: 'Failed to delete route map email copy from storage',
      fitnessFileId,
      path: mapImageEmailPath
    })
  }
}
