import { Knex } from 'knex'

import {
  ReindexSearchDocumentsResult,
  SearchAccountsParams
} from '@/lib/types/database/operations'

import { deleteSearchDocument } from './documents'
import { throwUnimplementedSearchMethod } from './notImplemented'

export const searchAccountIds = async (
  _database: Knex,
  _params: SearchAccountsParams
): Promise<string[]> => throwUnimplementedSearchMethod('searchAccountIds')

export const indexActorSearchDocument = async (
  _database: Knex,
  _params: { id: string }
): Promise<void> => throwUnimplementedSearchMethod('indexActorSearchDocument')

export const deleteActorSearchDocument = async (
  database: Knex,
  { id }: { id: string }
): Promise<void> => {
  await deleteSearchDocument(database, { entityType: 'account', entityId: id })
}

export const reindexSearchAccounts = async (
  _database?: Knex,
  _params?: unknown
): Promise<ReindexSearchDocumentsResult> =>
  throwUnimplementedSearchMethod('reindexSearchAccounts')
