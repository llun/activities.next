import type { ExportFileName } from '@/lib/services/exports/accountExports'
import type { SerializedBulkImport } from '@/lib/services/imports/serializeBulkImport'

export type { BulkImportType } from '@/lib/services/imports/types'
export type { SerializedBulkImport } from '@/lib/services/imports/serializeBulkImport'

export type BulkImportMode = 'merge' | 'overwrite'
export type BulkImportResponse = SerializedBulkImport

/** Actor-scoped URL for one of the CSV files served by `/api/v1/exports`. */
export const csvExportUrl = (file: ExportFileName, actorId: string): string => {
  const query = new URLSearchParams({ actorId })
  return `/api/v1/exports/${encodeURIComponent(file)}?${query.toString()}`
}
