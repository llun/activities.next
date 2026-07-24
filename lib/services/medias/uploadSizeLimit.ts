import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

/**
 * The instance's per-file upload cap — the `media.maxFileSize` server setting,
 * resolved env -> database -> default.
 *
 * This check used to be a synchronous Zod `.refine` on `FileSchema` reading
 * `getConfig().mediaStorage?.maxFileSize ?? MAX_FILE_SIZE`, which got the
 * database-backed setting wrong in both directions: a cap an admin lowered
 * (with no env var set) was never enforced, and a cap they raised above the
 * built-in default was rejected anyway — while `/api/v[12]/instance` advertised
 * the resolved value as `image_size_limit`/`video_size_limit`. Resolving it
 * needs a database read, so the check moved out of the schema and into the
 * async handlers that accept an upload.
 */
export const getMaxMediaUploadSize = async (
  database?: Database | null
): Promise<number> =>
  (await getResolvedServerSettings(database)).media.maxFileSize

/**
 * True when any of the given uploads exceeds the resolved cap. Sizes are bytes;
 * absent entries (an optional thumbnail, say) are ignored.
 */
export const exceedsMaxMediaUploadSize = async (
  sizes: (number | undefined | null)[],
  database?: Database | null
): Promise<boolean> => {
  const present = sizes.filter(
    (size): size is number => typeof size === 'number'
  )
  if (present.length === 0) return false

  const maxFileSize = await getMaxMediaUploadSize(database)
  return present.some((size) => size > maxFileSize)
}
