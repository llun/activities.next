// Parameter and result types of the idempotency domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export type GetIdempotentStatusIdParams = { actorId: string; key: string }
export type SaveIdempotencyKeyParams = {
  actorId: string
  key: string
  statusId: string
}

export interface IdempotencyDatabase {
  getIdempotentStatusId(
    params: GetIdempotentStatusIdParams
  ): Promise<string | null>
  saveIdempotencyKey(params: SaveIdempotencyKeyParams): Promise<void>
}
