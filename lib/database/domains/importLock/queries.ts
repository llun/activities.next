import crypto from 'node:crypto'

import type {
  AcquireImportLockParams,
  ReleaseImportLockParams
} from '@/lib/database/domains/importLock/types'
import type { Db } from '@/lib/database/kysely'

export const acquireImportLock = async (
  db: Db,
  { lockKey, ttlMs, now = Date.now() }: AcquireImportLockParams
): Promise<{ token: string } | null> => {
  const token = crypto.randomUUID()
  const expiresAt = now + Math.max(0, ttlMs)

  // Drop an expired lock first so a crashed holder can never block forever.
  await db
    .deleteFrom('fitness_import_locks')
    .where('lockKey', '=', lockKey)
    .where('expiresAt', '<=', now)
    .execute()

  // Claim the key. If a live lock still holds it, the insert is ignored.
  await db
    .insertInto('fitness_import_locks')
    .values({ lockKey, token, expiresAt })
    .onConflict((oc) => oc.column('lockKey').doNothing())
    .execute()

  // We hold the lock only if the persisted token is the one we just wrote.
  const row = await db
    .selectFrom('fitness_import_locks')
    .select('token')
    .where('lockKey', '=', lockKey)
    .limit(1)
    .executeTakeFirst()
  return row && row.token === token ? { token } : null
}

export const releaseImportLock = async (
  db: Db,
  { lockKey, token }: ReleaseImportLockParams
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('fitness_import_locks')
    .where('lockKey', '=', lockKey)
    .where('token', '=', token)
    .executeTakeFirst()
  return Number(numDeletedRows) > 0
}

export const importLockQueries = { acquireImportLock, releaseImportLock }
