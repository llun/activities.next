import { Knex } from 'knex'

import { SearchDatabase } from '@/lib/types/database/operations'

import {
  deleteActorSearchDocument,
  indexActorSearchDocument,
  reindexSearchAccounts,
  searchAccountIds
} from './account'
import {
  deleteSearchDocument,
  getSearchTokens,
  searchDocuments,
  upsertSearchDocument
} from './documents'
import {
  deleteHashtagSearchDocument,
  indexHashtagSearchDocument,
  normalizeHashtagSearchName,
  reindexSearchHashtags,
  searchHashtags
} from './hashtag'
import {
  deleteStatusSearchDocument,
  indexStatusSearchDocument,
  reindexSearchStatuses,
  searchStatusIds
} from './status'

export const SearchSQLDatabaseMixin = (database: Knex): SearchDatabase => ({
  upsertSearchDocument: (params) => upsertSearchDocument(database, params),
  deleteSearchDocument: (params) => deleteSearchDocument(database, params),
  searchDocuments: (params) => searchDocuments(database, params),
  searchAccountIds: (params) => searchAccountIds(database, params),
  indexActorSearchDocument: (params) =>
    indexActorSearchDocument(database, params),
  deleteActorSearchDocument: (params) =>
    deleteActorSearchDocument(database, params),
  reindexSearchAccounts: (params) => reindexSearchAccounts(database, params),
  searchHashtags: (params) => searchHashtags(database, params),
  indexHashtagSearchDocument: (params) =>
    indexHashtagSearchDocument(database, params),
  deleteHashtagSearchDocument: (params) =>
    deleteHashtagSearchDocument(database, params),
  reindexSearchHashtags: (params) => reindexSearchHashtags(database, params),
  searchStatusIds: (params) => searchStatusIds(database, params),
  indexStatusSearchDocument: (params) =>
    indexStatusSearchDocument(database, params),
  deleteStatusSearchDocument: (params) =>
    deleteStatusSearchDocument(database, params),
  reindexSearchStatuses: (params) => reindexSearchStatuses(database, params)
})

export {
  deleteActorSearchDocument,
  deleteHashtagSearchDocument,
  deleteSearchDocument,
  deleteStatusSearchDocument,
  getSearchTokens,
  indexActorSearchDocument,
  indexHashtagSearchDocument,
  indexStatusSearchDocument,
  normalizeHashtagSearchName,
  reindexSearchAccounts,
  reindexSearchHashtags,
  reindexSearchStatuses,
  searchAccountIds,
  searchDocuments,
  searchHashtags,
  searchStatusIds,
  upsertSearchDocument
}
