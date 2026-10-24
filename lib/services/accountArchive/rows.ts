import type {
  AccountExportCursor,
  AccountExportTableName
} from '@/lib/database/domains/accountExport/types'
import type { Database } from '@/lib/database/types'

/** Reads every row of a (small) table into memory, a page at a time. */
export const readAllExportRows = async (
  database: Database,
  table: AccountExportTableName,
  actorId: string,
  pageSize: number
): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = []
  let after: AccountExportCursor | null = null
  do {
    const page = await database.getAccountExportRows({
      table,
      actorId,
      after,
      limit: pageSize
    })
    rows.push(...page.rows)
    after = page.next
  } while (after)
  return rows
}

/** Groups rows by the value of `key`. */
export const groupBy = <Row extends Record<string, unknown>>(
  rows: Row[],
  key: string
): Map<string, Row[]> => {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const id = String(row[key])
    const group = groups.get(id)
    if (group) group.push(row)
    else groups.set(id, [row])
  }
  return groups
}

export const toIso = (value: unknown): string | null =>
  typeof value === 'number' ? new Date(value).toISOString() : null
