// Parameter and result types of the Wahoo import domain (workout imports and
// history scans).

export type WahooImportStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'unsupported'

export interface WahooImport {
  id: string
  actorId: string
  providerUserId: string
  workoutId: string
  summaryId?: string
  summaryUpdatedAt?: number
  fitnessFileId?: string
  statusId?: string
  historyImportId?: string
  status: WahooImportStatus
  hadStatus?: boolean
  attempts: number
  lastError?: string
  created?: boolean
}

export type WahooHistoryStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface WahooHistoryImport {
  id: string
  actorId: string
  providerUserId: string
  fromDate: string
  toDate: string
  nextPage: number
  scanComplete: boolean
  total: number
  completed: number
  failed: number
  status: WahooHistoryStatus
  lastError?: string
}

export interface WahooImportDatabase {
  upsertWahooImport(params: {
    actorId: string
    providerUserId: string
    workoutId: string
    summaryId?: string
    summaryUpdatedAt?: number
    historyImportId?: string
  }): Promise<WahooImport>
  getWahooImport(id: string): Promise<WahooImport | null>
  getWahooImportsByActor(params: {
    actorId: string
    statuses: WahooImportStatus[]
    limit?: number
  }): Promise<WahooImport[]>
  updateWahooImport(
    id: string,
    values: Partial<
      Pick<
        WahooImport,
        | 'status'
        | 'fitnessFileId'
        | 'statusId'
        | 'summaryId'
        | 'summaryUpdatedAt'
        | 'attempts'
      >
    > & { lastError?: string | null }
  ): Promise<void>
  markWahooImportFailed(
    id: string,
    status: 'failed' | 'unsupported',
    error: string
  ): Promise<void>
  markWahooImportPending(id: string): Promise<boolean>
  getLatestWahooHistoryImport(
    actorId: string
  ): Promise<WahooHistoryImport | null>
  getWahooHistoryImport(id: string): Promise<WahooHistoryImport | null>
  getWahooImportsByHistory(
    id: string,
    statuses?: WahooImportStatus[]
  ): Promise<WahooImport[]>
  cancelWahooHistoryImportsByActor(actorId: string): Promise<void>
  createWahooHistoryImport(params: {
    actorId: string
    providerUserId: string
    fromDate: string
    toDate: string
  }): Promise<WahooHistoryImport>
  updateWahooHistoryImport(
    id: string,
    values: Partial<
      Pick<
        WahooHistoryImport,
        | 'nextPage'
        | 'scanComplete'
        | 'total'
        | 'completed'
        | 'failed'
        | 'status'
      >
    > & { lastError?: string | null },
    expectedStatuses?: WahooHistoryStatus[]
  ): Promise<boolean>
  countWahooHistoryItems(id: string): Promise<{
    total: number
    completed: number
    failed: number
    pending: number
  }>
}
