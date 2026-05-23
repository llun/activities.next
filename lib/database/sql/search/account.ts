import { Knex } from 'knex'

import {
  ReindexSearchDocumentsResult,
  SearchAccountsParams
} from '@/lib/types/database/operations'

import { deleteSearchDocument } from './documents'

export const searchAccountIds = async (
  _database: Knex,
  _params: SearchAccountsParams
): Promise<string[]> => []

export const indexActorSearchDocument = async (
  _database: Knex,
  _params: { id: string }
): Promise<void> => {}

export const deleteActorSearchDocument = async (
  database: Knex,
  { id }: { id: string }
): Promise<void> => {
  await deleteSearchDocument(database, { entityType: 'account', entityId: id })
}

export const reindexSearchAccounts = async (
  _database?: Knex,
  _params?: unknown
): Promise<ReindexSearchDocumentsResult> => ({
  indexed: 0,
  nextCursor: null
})
