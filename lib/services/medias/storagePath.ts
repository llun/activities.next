import path from 'path'

import { logger } from '@/lib/utils/logger'

/**
 * The absolute path `filePath` names inside `storageRootPath`, or null when it
 * escapes that root.
 *
 * Every filesystem path a local storage driver builds goes through here — the
 * media driver and the fitness-file driver both. A stored path is data: it
 * reaches a driver from a `medias` / `fitness_files` row, from a URL path
 * segment, or from an archive entry, and `path.resolve` walks straight out of
 * the root given `../` or an absolute path. The escape is silent, because the
 * read or the unlink simply lands somewhere else on disk.
 *
 * The root itself resolves to itself rather than to null; only a path that
 * leaves the root is refused.
 *
 * The check is LEXICAL — it never calls `fs.realpath` — so a symlink planted
 * inside the root and pointing outside it resolves to a path that passes. That
 * is a residual rather than a regression (both predecessors were lexical too)
 * and nothing here creates symlinks in either storage root: the Strava archive
 * reader decompresses entries into memory rather than onto disk, so there is no
 * zip-slip route to plant one. Anything that gains the ability to create a link
 * under a storage root needs this to become a `realpath` comparison.
 */
export const resolveStorageFilePath = (
  storageRootPath: string,
  filePath: string
): string | null => {
  const storageRoot = path.resolve(storageRootPath)
  const fullPath = path.resolve(storageRoot, filePath)
  const storageRootPrefix = storageRoot.endsWith(path.sep)
    ? storageRoot
    : `${storageRoot}${path.sep}`

  if (fullPath !== storageRoot && !fullPath.startsWith(storageRootPrefix)) {
    // The refusal is unreachable from today's callers, which is exactly why it
    // is worth a line: this check exists for a caller nobody has written yet
    // and for a row that should not hold what it holds. Without it the only
    // symptom is a delete that quietly did nothing, or a read shaped like a 404.
    logger.warn({
      message: 'Refused a storage path outside the storage root',
      storageRootPath,
      filePath
    })
    return null
  }

  return fullPath
}

/**
 * `resolveStorageFilePath` for a caller with nothing meaningful to return when
 * the path escapes — a write path, where the alternative to throwing is
 * creating a file somewhere the driver does not own.
 *
 * The write paths generate their own names today, so this is the belt rather
 * than the braces. It is applied anyway so the confinement is a property of the
 * driver rather than a claim about who calls it: the read/delete asymmetry this
 * replaced was exactly that claim, and it held only until someone added a
 * caller.
 */
export const assertStorageFilePath = (
  storageRootPath: string,
  filePath: string
): string => {
  const fullPath = resolveStorageFilePath(storageRootPath, filePath)
  if (!fullPath) {
    throw new Error('Storage path escapes storage root')
  }
  return fullPath
}
