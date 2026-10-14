import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { getDialectName } from '@/lib/database/kysely/dialect'

// Whether the table exists: in the connection's current schema on
// PostgreSQL, as any `table` entry of sqlite_master on SQLite.
const hasTable = async (db: Db, name: string): Promise<boolean> => {
  const result =
    getDialectName(db) === 'sqlite'
      ? await sql`select 1 from sqlite_master where type = 'table' and name = ${name}`.execute(
          db
        )
      : await sql`select 1 from information_schema.tables where table_name = ${name} and table_schema = current_schema()`.execute(
          db
        )
  return result.rows.length > 0
}

/**
 * The stored files photo edits keep beside the live one: every
 * `media_edit_files` path (the uploaded original and earlier renders), and the
 * presigned upload key the original slot records, which a re-PUT through the
 * still-valid URL can recreate. The storage cleanup counts them as referenced;
 * without them every edited photo's original would look orphaned.
 */
export const getMediaEditReferencedPaths = async (
  db: Db
): Promise<string[]> => {
  if (!(await hasTable(db, 'media_edit_files'))) return []

  const paths: string[] = []
  const rows = await db
    .selectFrom('media_edit_files')
    .select(['slot', 'path', 'metaData'])
    .execute()
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
