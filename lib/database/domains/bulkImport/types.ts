import type {
  BulkImportRowData,
  BulkImportType
} from '@/lib/services/imports/types'

export type BulkImportState = 'scheduled' | 'in_progress' | 'finished'
export type BulkImportRowState = 'pending' | 'imported' | 'failed'

export interface BulkImport {
  id: string
  actorId: string
  type: BulkImportType
  overwrite: boolean
  state: BulkImportState
  originalFilename: string
  totalItems: number
  processedItems: number
  importedItems: number
  overwriteDone: boolean
  nextRowIndex: number
  lastError: string | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface BulkImportRow {
  id: string
  importId: string
  rowIndex: number
  data: BulkImportRowData
  state: BulkImportRowState
  error: string | null
}

export interface CreateBulkImportParams {
  id: string
  actorId: string
  type: BulkImportType
  overwrite: boolean
  originalFilename: string
  rows: BulkImportRowData[]
}

export interface GetBulkImportParams {
  id: string
  actorId: string
}

export interface GetBulkImportByIdParams {
  id: string
}

export interface GetBulkImportsParams {
  actorId: string
  limit?: number
}

export interface GetBulkImportRowsParams {
  importId: string
  fromRowIndex: number
  limit: number
  state?: BulkImportRowState
}

export interface MarkBulkImportRowProcessedParams {
  importId: string
  rowId: string
  imported: boolean
  error?: string | null
}

export interface UpdateBulkImportParams {
  id: string
  state?: BulkImportState
  nextRowIndex?: number
  overwriteDone?: boolean
  lastError?: string | null
  finishedAt?: number | null
}

export interface GetBulkImportFailedRowsParams {
  importId: string
  limit?: number
}

export interface BulkImportDatabase {
  createBulkImport(params: CreateBulkImportParams): Promise<BulkImport | null>
  getBulkImport(params: GetBulkImportParams): Promise<BulkImport | null>
  getBulkImportById(params: GetBulkImportByIdParams): Promise<BulkImport | null>
  getBulkImports(params: GetBulkImportsParams): Promise<BulkImport[]>
  getBulkImportRows(params: GetBulkImportRowsParams): Promise<BulkImportRow[]>
  markBulkImportRowProcessed(
    params: MarkBulkImportRowProcessedParams
  ): Promise<boolean>
  updateBulkImport(params: UpdateBulkImportParams): Promise<void>
  getBulkImportFailedRows(
    params: GetBulkImportFailedRowsParams
  ): Promise<BulkImportRow[]>
}
