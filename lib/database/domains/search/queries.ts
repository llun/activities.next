import {
  deleteActorSearchDocument,
  indexActorSearchDocument,
  reindexSearchAccounts,
  searchAccountIds
} from '@/lib/database/domains/search/accounts'
import {
  deleteSearchDocument,
  searchDocuments,
  upsertSearchDocument
} from '@/lib/database/domains/search/documents'

// The facade getSQLDatabase binds with bindDb(). The hashtag and status
// halves of search are still Knex (lib/database/sql/search/).
export const searchQueries = {
  upsertSearchDocument,
  deleteSearchDocument,
  searchDocuments,
  searchAccountIds,
  indexActorSearchDocument,
  deleteActorSearchDocument,
  reindexSearchAccounts
}
