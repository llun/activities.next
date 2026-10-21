// Parameter and result types of the idempotency domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export const IDEMPOTENCY_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000

// How long a 'pending' key (from its createdAt) or a 'publishing' key (from
// its stateChangedAt) is presumed to belong to a request still running in
// another process. An older one is treated as 'publish_failed': its process
// most likely stopped before it could finish.
export const IDEMPOTENCY_PENDING_STALE_MS = 60_000

// How far the status create that claimed a key got:
// - 'pending': the create is still running (or its process stopped);
// - 'publishing': a request took the key to queue the federation job and is
//   waiting for the queue (or its process stopped);
// - 'publish_failed': the post is saved but its federation job could not be
//   queued, so a retry with the key queues it again;
// - 'complete': the queue accepted the job (a poll has none). Keys written
//   before the column existed are 'complete'.
export type IdempotencyKeyState =
  'pending' | 'publishing' | 'publish_failed' | 'complete'

export type GetIdempotencyKeyParams = { actorId: string; key: string }
export type SetIdempotencyKeyStateParams = {
  actorId: string
  key: string
  // Only the key still bound to this status, and still 'publishing', is
  // updated.
  statusId: string
  state: IdempotencyKeyState
}
export type ClaimIdempotencyKeyPublishParams = {
  actorId: string
  key: string
  statusId: string
  // Omitted for the create's own request, which takes the key from 'pending'.
  // A retry passes now - IDEMPOTENCY_PENDING_STALE_MS and takes it from
  // 'publish_failed', from a 'pending' claimed at or before this time, or
  // from a 'publishing' taken at or before it.
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
  getIdempotencyKey(
    params: GetIdempotencyKeyParams
  ): Promise<IdempotencyKeyRecord | null>
  setIdempotencyKeyState(params: SetIdempotencyKeyStateParams): Promise<void>
  // Moves the key to 'publishing' if the caller may queue its status's job,
  // and returns whether it did (see ClaimIdempotencyKeyPublishParams).
  claimIdempotencyKeyPublish(
    params: ClaimIdempotencyKeyPublishParams
  ): Promise<boolean>
  deleteExpiredIdempotencyKeys(
    params?: DeleteExpiredIdempotencyKeysParams
  ): Promise<number>
}
