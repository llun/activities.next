// Test-only helpers that seed or inspect state the public `Database` interface
// has no production caller for. Plain `(db, params)` functions over Kysely, so
// a test passes `db` from `createTestDatabase()`. Prefer a public facade method
// when one already does the job (e.g. `setServerSettings` to write a setting).
import type { Db } from '@/lib/database/kysely'
import type {
  DeleteServerSettingParams,
  QueueJob,
  QueueJobStatus
} from '@/lib/types/database/operations'

/** The queue job with `id`, or `null`. Same shape as `Database.getQueueJobById`. */
export const getQueueJobById = async (
  db: Db,
  id: string
): Promise<QueueJob | null> => {
  const row = await db
    .selectFrom('queue_jobs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    payload: row.payload as QueueJob['payload'],
    attempts: row.attempts,
    maxRetries: row.max_retries,
    nextRunAt: row.next_run_at,
    status: row.status as QueueJobStatus,
    claimToken: row.claim_token ?? null,
    lastErrorMessage: row.last_error_message,
    lastErrorStack: row.last_error_stack,
    // Nullable only in the schema dump; createQueueJob always sets both.
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  }
}

/** Deletes a server setting; `true` when a row was removed. */
export const deleteServerSetting = async (
  db: Db,
  { key }: DeleteServerSettingParams
): Promise<boolean> => {
  const result = await db
    .deleteFrom('server_settings')
    .where('key', '=', key)
    .executeTakeFirst()
  return Number(result.numDeletedRows) > 0
}
