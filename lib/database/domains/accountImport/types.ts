// Parameter and result types of the account import domain.
import type {
  AccountImport,
  AccountImportItem,
  AccountImportStatus
} from '@/lib/types/domain/accountImport'

export type CreateAccountImportParams = {
  id: string
  accountId: string
  actorId: string
  /** Raw JSON text the request carried; the row keeps it verbatim. */
  options: string
}

export type GetAccountImportParams = { id: string; actorId: string }

export type ListAccountImportsParams = {
  actorId: string
  limit: number
}

export type ClaimAccountImportRunParams = {
  id: string
  runToken: string
  leaseMs: number
}

export type RenewAccountImportRunParams = {
  id: string
  runToken: string
  leaseMs: number
}

export type ReleaseAccountImportRunParams = {
  id: string
  runToken: string
}

export type UpdateAccountImportParams = {
  id: string
  /** When set, the update only applies while the row still has one of these. */
  onlyIfStatus?: AccountImportStatus[]
  status?: AccountImportStatus
  kind?: string | null
  progress?: string | null
  phase?: string | null
  cursor?: string | null
  uploadedBytes?: number
  runToken?: string | null
  claimedUntil?: number | null
  lastErrorCode?: string | null
  startedAt?: number | null
  finishedAt?: number | null
}

export type UpsertAccountImportItemsParams = {
  importId: string
  actorId: string
  items: { kind: string; sourceId: string; position: number }[]
}

export type GetAccountImportItemsParams = {
  importId: string
  /** Only items at a position after this one (the cursor of the last read). */
  afterPosition?: number
  limit: number
}

export type MarkAccountImportItemParams = {
  id: string
  state: AccountImportItemState
  reason?: string | null
  targetId?: string | null
}

export type ResetRetryableAccountImportItemsParams = {
  importId: string
  reasons: string[]
}

export type ClaimAccountImportRunResult =
  | { claimed: true }
  | {
      claimed: false
      runToken: string | null
      claimedUntil: number | null
    }

export type AccountImportItemState = AccountImportItem['state']

export interface AccountImportDatabase {
  createAccountImport(params: CreateAccountImportParams): Promise<AccountImport>
  getAccountImport(
    params: GetAccountImportParams
  ): Promise<AccountImport | null>
  listAccountImports(params: ListAccountImportsParams): Promise<AccountImport[]>
  getActiveAccountImport(params: {
    actorId: string
  }): Promise<AccountImport | null>
  countAccountImportStartsSince(params: {
    actorId: string
    since: number
  }): Promise<number>
  updateAccountImport(params: UpdateAccountImportParams): Promise<boolean>
  claimAccountImportRun(
    params: ClaimAccountImportRunParams
  ): Promise<ClaimAccountImportRunResult>
  renewAccountImportRun(params: RenewAccountImportRunParams): Promise<boolean>
  releaseAccountImportRun(params: ReleaseAccountImportRunParams): Promise<void>
  upsertAccountImportItems(
    params: UpsertAccountImportItemsParams
  ): Promise<void>
  getAccountImportItems(
    params: GetAccountImportItemsParams
  ): Promise<AccountImportItem[]>
  markAccountImportItem(params: MarkAccountImportItemParams): Promise<boolean>
  resetRetryableAccountImportItems(
    params: ResetRetryableAccountImportItemsParams
  ): Promise<number>
  deleteAccountImportsForActor(params: { actorId: string }): Promise<void>
}
