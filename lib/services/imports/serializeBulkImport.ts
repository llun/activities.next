import type {
  BulkImport,
  BulkImportRow,
  BulkImportState
} from '@/lib/database/domains/bulkImport/types'
import type {
  BulkImportRowData,
  BulkImportType
} from '@/lib/services/imports/types'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export interface SerializedBulkImportRow {
  rowIndex: number
  data: BulkImportRowData
  error: string | null
}

export interface SerializedBulkImport {
  id: string
  type: BulkImportType
  mode: 'overwrite' | 'merge'
  state: BulkImportState
  originalFilename: string
  totalItems: number
  processedItems: number
  importedItems: number
  failedItems: number
  createdAt: string
  finishedAt: string | null
  failedRows?: SerializedBulkImportRow[]
}

export const serializeBulkImport = (
  bulkImport: BulkImport,
  failedRows?: Array<Pick<BulkImportRow, 'rowIndex' | 'data' | 'error'>>
): SerializedBulkImport => ({
  id: bulkImport.id,
  type: bulkImport.type,
  mode: bulkImport.overwrite ? 'overwrite' : 'merge',
  state: bulkImport.state,
  originalFilename: bulkImport.originalFilename,
  totalItems: bulkImport.totalItems,
  processedItems: bulkImport.processedItems,
  importedItems: bulkImport.importedItems,
  failedItems: bulkImport.processedItems - bulkImport.importedItems,
  createdAt: getISOTimeUTC(bulkImport.createdAt),
  finishedAt:
    bulkImport.finishedAt !== null
      ? getISOTimeUTC(bulkImport.finishedAt)
      : null,
  ...(failedRows !== undefined && Array.isArray(failedRows)
    ? {
        failedRows: failedRows.map((r) => ({
          rowIndex: r.rowIndex,
          data: r.data,
          error: r.error
        }))
      }
    : {})
})
