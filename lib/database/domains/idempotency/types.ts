// Parameter and result types of the idempotency domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export const IDEMPOTENCY_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type GetIdempotentStatusIdParams = { actorId: string; key: string }
export type SaveIdempotencyKeyParams = {
  actorId: string
  key: string
  statusId: string
  contentHash?: string | null
  createdAt?: Date | number
}
export type DeleteExpiredIdempotencyKeysParams = {
  olderThan?: Date
}

export type IdempotencyKeyRecord = {
  actorId: string
  key: string
  statusId: string
  contentHash: string | null
  createdAt: number | null
}

export class IdempotencyConflictError extends Error {
  constructor(
    message = 'Idempotency-Key has already been used with different request parameters'
  ) {
    super(message)
    this.name = 'IdempotencyConflictError'
  }
}

export class IdempotencyDeletedError extends Error {
  readonly statusId: string

  constructor(
    statusId: string,
    message = 'The status associated with this Idempotency-Key was deleted'
  ) {
    super(message)
    this.name = 'IdempotencyDeletedError'
    this.statusId = statusId
  }
}

export interface IdempotencyDatabase {
  getIdempotentStatusId(
    params: GetIdempotentStatusIdParams
  ): Promise<string | null>
  getIdempotencyKey(
    params: GetIdempotentStatusIdParams
  ): Promise<IdempotencyKeyRecord | null>
  saveIdempotencyKey(params: SaveIdempotencyKeyParams): Promise<void>
  deleteExpiredIdempotencyKeys(
    params?: DeleteExpiredIdempotencyKeysParams
  ): Promise<number>
}
