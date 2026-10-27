import { randomUUID } from 'node:crypto'

import type { Database } from '@/lib/database/types'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import type { AccountImport } from '@/lib/types/domain/accountImport'

export type CreateImportResult =
  | { type: 'created'; accountImport: AccountImport }
  | { type: 'active'; accountImport: AccountImport }

export const createQueuedAccountImport = async ({
  database,
  actorId,
  accountId,
  uploadedBytes
}: {
  database: Database
  actorId: string
  accountId: string
  uploadedBytes?: number
}): Promise<CreateImportResult> => {
  const active = await database.getActiveAccountImport({ actorId })
  if (active) return { type: 'active', accountImport: active }

  try {
    const accountImport = await database.createAccountImport({
      id: randomUUID(),
      actorId,
      accountId,
      options: '{}',
      ...(uploadedBytes === undefined ? null : { uploadedBytes })
    })
    return { type: 'created', accountImport }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const raced = await database.getActiveAccountImport({ actorId })
    if (raced) return { type: 'active', accountImport: raced }
    throw error
  }
}
