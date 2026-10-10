import type { Knex } from 'knex'

/**
 * The stored files photo edits keep beside the live one: every
 * `media_edit_files` path (the uploaded original and earlier renders), and the
 * presigned upload key the original slot records, which a re-PUT through the
 * still-valid URL can recreate. The storage cleanup counts them as referenced;
 * without them every edited photo's original would look orphaned.
 */
export const getMediaEditReferencedPaths = async (
  database: Knex
): Promise<string[]> => {
  if (!(await database.schema.hasTable('media_edit_files'))) return []

  const paths: string[] = []
  const rows = await database('media_edit_files').select(
    'slot',
    'path',
    'metaData'
  )
  for (const row of rows) {
    if (typeof row.path === 'string' && row.path) paths.push(row.path)
    if (row.slot !== 'original') continue
    try {
      const metaData =
        typeof row.metaData === 'string'
          ? JSON.parse(row.metaData)
          : row.metaData
      const clientPath = metaData?.upload?.clientPath
      if (typeof clientPath === 'string' && clientPath) paths.push(clientPath)
    } catch {
      // A corrupt row still keeps its own path.
    }
  }
  return paths
}
