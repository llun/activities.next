import { Knex } from 'knex'

import {
  ReindexSearchDocumentsResult,
  SearchStatusesParams
} from '@/lib/types/database/operations'

import { deleteSearchDocument } from './documents'

export const searchStatusIds = async (
  _database: Knex,
  _params: SearchStatusesParams
): Promise<string[]> => []

export const indexStatusSearchDocument = async (
  _database: Knex,
  _params: { statusId: string }
): Promise<void> => {}

export const deleteStatusSearchDocument = async (
  database: Knex,
  { statusId }: { statusId: string }
): Promise<void> => {
  await deleteSearchDocument(database, {
    entityType: 'status',
    entityId: statusId
  })
}

export const reindexSearchStatuses = async (
  _database?: Knex,
  _params?: unknown
): Promise<ReindexSearchDocumentsResult> => ({
  indexed: 0,
  nextCursor: null
})
