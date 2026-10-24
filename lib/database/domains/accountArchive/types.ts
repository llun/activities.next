// Parameter and result types of the account archive (user export) domain.
import type {
  AccountArchive,
  AccountArchiveOptions,
  AccountArchiveStatus
} from '@/lib/types/domain/accountArchive'

export type CreateAccountArchiveParams = {
  id: string
  accountId: string
  options: AccountArchiveOptions
}
export type GetAccountArchiveParams = { id: string }
export type GetAccountArchivesForAccountParams = {
  accountId: string
  limit: number
}
export type GetActiveAccountArchiveParams = { accountId: string }
export type GetLatestRequestedAccountArchiveParams = { accountId: string }
export type UpdateAccountArchiveParams = {
  id: string
  /** When set, the update only applies while the row still has one of these. */
  onlyIfStatus?: AccountArchiveStatus[]
  /**
   * Compare-and-set on the stored cursor: the update only applies while
   * `progress` still equals this text (null means "not written yet"), so two
   * workers that picked up the same slice cannot both advance it.
   */
  onlyIfProgress?: string | null
  status?: AccountArchiveStatus
  progress?: string | null
  storagePath?: string | null
  bytes?: number | null
  error?: string | null
  readyAt?: number | null
  expiresAt?: number | null
}
export type GetExpiredAccountArchivesParams = { now: number; limit: number }
export type DeleteAccountArchivesForAccountParams = { accountId: string }

export interface AccountArchiveDatabase {
  /**
   * Inserts a queued export. Rejects with a unique-constraint error while the
   * account still has a queued or running one (the partial unique index).
   */
  createAccountArchive(
    params: CreateAccountArchiveParams
  ): Promise<AccountArchive>
  getAccountArchive(
    params: GetAccountArchiveParams
  ): Promise<AccountArchive | null>
  /** Newest first. */
  getAccountArchivesForAccount(
    params: GetAccountArchivesForAccountParams
  ): Promise<AccountArchive[]>
  /** The queued or running export of the account, if any. */
  getActiveAccountArchive(
    params: GetActiveAccountArchiveParams
  ): Promise<AccountArchive | null>
  /**
   * The newest export that counts against the request limit: any that was not
   * a failure (a failed export never produced a file, so it does not lock the
   * owner out for a week).
   */
  getLatestRequestedAccountArchive(
    params: GetLatestRequestedAccountArchiveParams
  ): Promise<AccountArchive | null>
  /** Returns the updated row, or null when it is gone or `onlyIfStatus` failed. */
  updateAccountArchive(
    params: UpdateAccountArchiveParams
  ): Promise<AccountArchive | null>
  /** Ready exports whose `expiresAt` has passed, oldest first. */
  getExpiredAccountArchives(
    params: GetExpiredAccountArchivesParams
  ): Promise<AccountArchive[]>
  deleteAccountArchivesForAccount(
    params: DeleteAccountArchivesForAccountParams
  ): Promise<void>
}
