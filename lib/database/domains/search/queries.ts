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
import {
  deleteHashtagSearchDocument,
  indexHashtagSearchDocument,
  indexHashtagSearchDocuments,
  reindexSearchHashtags,
  searchHashtags
} from '@/lib/database/domains/search/hashtags'
import {
  deleteStatusSearchDocument,
  indexStatusSearchDocument,
  reindexSearchStatuses,
  searchStatusIds
} from '@/lib/database/domains/search/statuses'

export const searchQueries = {
  upsertSearchDocument,
  deleteSearchDocument,
  searchDocuments,
  searchAccountIds,
  indexActorSearchDocument,
  deleteActorSearchDocument,
  reindexSearchAccounts,
  searchHashtags,
  indexHashtagSearchDocument,
  indexHashtagSearchDocuments,
  deleteHashtagSearchDocument,
  reindexSearchHashtags,
  searchStatusIds,
  indexStatusSearchDocument,
  deleteStatusSearchDocument,
  reindexSearchStatuses
}
