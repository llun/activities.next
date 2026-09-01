import { isUniqueConstraintError } from './isUniqueConstraintError'

/**
 * Outcome of an insert guarded against a concurrent duplicate.
 *
 * `recovered: false` — this call performed the insert and owns the row it just
 * wrote, so the caller should run its post-insert side effects.
 * `recovered: true` — a concurrent writer won the same unique key; `existing`
 * is the winner's row, and the caller must NOT re-run non-idempotent side
 * effects (they belong to the winner).
 */
export type DuplicateInsertOutcome<T> =
  { recovered: false } | { recovered: true; existing: T }

/**
 * Run an insert that races on a unique key, and recover the winner's row when
 * a concurrent writer got there first.
 *
 * The two federated-delivery jobs that create statuses (`createNoteJob`,
 * `createPollJob`) each guard with a `getStatus` check before inserting, but
 * two concurrent deliveries of the same object both pass that check and both
 * insert — one wins, the other hits the unique constraint. Returning the
 * winner's row lets the loser no-op instead of failing, and the discriminated
 * `recovered` flag is what tells the caller it was a no-op so it does not
 * re-run createTag / createAttachment / increaseHashtagCounter etc. on top of
 * the winner's.
 *
 * A unique-constraint error whose row cannot then be found is re-thrown
 * unchanged — the original behaviour of the inline catch blocks this replaces.
 */
export const recoverFromDuplicateInsert = async <T>({
  insert,
  getExisting
}: {
  insert: () => Promise<void>
  getExisting: () => Promise<T | null>
}): Promise<DuplicateInsertOutcome<T>> => {
  try {
    await insert()
    return { recovered: false }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await getExisting()
      if (existing) return { recovered: true, existing }
    }
    throw error
  }
}
