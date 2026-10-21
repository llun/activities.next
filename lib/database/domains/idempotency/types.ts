// Parameter and result types of the idempotency domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export const IDEMPOTENCY_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000

// How long a 'pending' key is presumed to belong to a create still running in
// another process. An older one is treated as 'publish_failed': its process
// most likely stopped before it could finish.
export const IDEMPOTENCY_PENDING_STALE_MS = 60_000

// How far the status create that claimed a key got:
// - 'pending': the create is still running (or its process stopped);
// - 'publish_failed': the post is saved but its federation job could not be
//   queued, so a retry with the key queues it again;
// - 'complete': a request took the key to queue the job (and moves it back to
//   'publish_failed' if the queue refuses). Keys written before the column existed,
//   and keys saved by saveIdempotencyKey, are 'complete'.
export type IdempotencyKeyState = 'pending' | 'publish_failed' | 'complete'

export type GetIdempotentStatusIdParams = { actorId: string; key: string }
export type SaveIdempotencyKeyParams = {
  actorId: string
  key: string
  statusId: string
  contentHash?: string | null
  createdAt?: Date | number
}
export type SetIdempotencyKeyStateParams = {
  actorId: string
  key: string
  // Only the key still bound to this status is updated.
  statusId: string
  state: IdempotencyKeyState
}
export type ClaimIdempotencyKeyPublishParams = {
  actorId: string
  key: string
  statusId: string
  // Omitted for the create's own request, which takes the key from 'pending'.
  // A retry passes now - IDEMPOTENCY_PENDING_STALE_MS and takes it from
  // 'publish_failed', or from a 'pending' claimed at or before this time.
  staleBefore?: Date
}
export type DeleteExpiredIdempotencyKeysParams = {
  olderThan?: Date
}

export type IdempotencyKeyRecord = {
  actorId: string
  key: string
  statusId: string
  contentHash: string | null
  state: IdempotencyKeyState
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

// A retry while the create that claimed the key may still be running
// elsewhere (409, retryable).
export class IdempotencyInProgressError extends Error {
  constructor(
    message = 'A request with this Idempotency-Key is still being processed'
  ) {
    super(message)
    this.name = 'IdempotencyInProgressError'
  }
}

// The post is saved but its federation job could not be queued (503). A retry
// with the same Idempotency-Key queues it again; without a key nothing will.
export class StatusPublishFailedError extends Error {
  constructor(hasIdempotencyKey: boolean) {
    super(
      hasIdempotencyKey
        ? 'Your post was saved but could not be sent yet; retry with the same Idempotency-Key'
        : 'Your post was saved but could not be sent'
    )
    this.name = 'StatusPublishFailedError'
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
  setIdempotencyKeyState(params: SetIdempotencyKeyStateParams): Promise<void>
  // Moves the key to 'complete' if the caller may queue its status's job, and
  // returns whether it did (see ClaimIdempotencyKeyPublishParams).
  claimIdempotencyKeyPublish(
    params: ClaimIdempotencyKeyPublishParams
  ): Promise<boolean>
  deleteExpiredIdempotencyKeys(
    params?: DeleteExpiredIdempotencyKeysParams
  ): Promise<number>
}
