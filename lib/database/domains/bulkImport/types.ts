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
  // Units of overwrite pre-pass work finished so far; names the continuation.
  overwriteProgress: number
  // The lists of a lists import were created; never done twice.
  listsPrepared: boolean
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
  overwriteProgress?: number
  listsPrepared?: boolean
  lastError?: string | null
  finishedAt?: number | null
}

export interface UpdateBulkImportRowDataParams {
  importId: string
  rowId: string
  data: BulkImportRowData
}

export interface ClaimBulkImportRunParams {
  id: string
  runToken: string
  leaseMs: number
}

export type ClaimBulkImportRunResult =
  | { claimed: true }
  // claimedUntil is when the live claim lapses (null: it was just released).
  | { claimed: false; claimedUntil: number | null }

export interface ReleaseBulkImportRunParams {
  id: string
  runToken: string
}

export interface RenewBulkImportRunParams {
  id: string
  runToken: string
  leaseMs: number
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
  updateBulkImportRowData(params: UpdateBulkImportRowDataParams): Promise<void>
  claimBulkImportRun(
    params: ClaimBulkImportRunParams
  ): Promise<ClaimBulkImportRunResult>
  releaseBulkImportRun(params: ReleaseBulkImportRunParams): Promise<void>
  // False when the run no longer holds the claim (another run took it over).
  renewBulkImportRun(params: RenewBulkImportRunParams): Promise<boolean>
  getBulkImportFailedRows(
    params: GetBulkImportFailedRowsParams
  ): Promise<BulkImportRow[]>
}
